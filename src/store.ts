import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AssetVersion, Decision, Handoff, Job, JobState, Project, Provider, Raster, Region } from './contracts.ts';
import { checksum, composite, rasterBytes, validateRaster, validateRegion } from './raster.ts';

const transitions: Record<JobState, JobState[]> = {
  queued: ['running', 'awaiting_external_result', 'failed', 'cancelled'],
  running: ['outcome_unknown', 'failed', 'cancelled'],
  awaiting_external_result: ['outcome_unknown', 'failed', 'cancelled'],
  outcome_unknown: ['failed', 'cancelled'],
  succeeded: [], failed: [], cancelled: [],
};

/** Single trusted local process; not a network-facing service or a concurrent worker manager. */
export class Store {
  private db: DatabaseSync;
  private root: string;
  constructor(root: string) {
    this.root = resolve(root);
    mkdirSync(join(this.root, 'assets'), { recursive: true });
    this.db = new DatabaseSync(join(this.root, 'workspace.sqlite'));
    const version = this.db.prepare('PRAGMA user_version').get()!['user_version'];
    if (version !== 0 && version !== 1) {
      this.db.close();
      throw new Error('unsupported database schema; restore with matching application');
    }
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS regions(id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES assets(id), body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS decisions(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), body TEXT NOT NULL);
      PRAGMA user_version=1;`);
    // A process restart cannot prove that a running external operation stopped or never charged.
    for (const job of this.list<Job>('jobs')) {
      if (job.state === 'running') {
        job.state = 'outcome_unknown'; job.error = 'process restarted; reconcile before retry';
        this.replace('jobs', job.id, job);
      }
    }
  }
  close(): void { this.db.close(); }
  private transaction<T>(action: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = action(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private get<T>(table: string, id: string): T {
    const row = this.db.prepare(`SELECT body FROM ${table} WHERE id=?`).get(id);
    if (!row) throw new Error(`unknown ${table} identity`);
    return JSON.parse(row['body'] as string) as T;
  }
  private list<T>(table: string): T[] {
    return this.db.prepare(`SELECT body FROM ${table} ORDER BY id`).all()
      .map(row => JSON.parse(row['body'] as string) as T);
  }
  private replace(table: string, id: string, value: unknown): void {
    this.db.prepare(`UPDATE ${table} SET body=? WHERE id=?`).run(JSON.stringify(value), id);
  }
  project(id: string): Project { return this.get('projects', id); }
  asset(id: string): AssetVersion { return this.get('assets', id); }
  job(id: string): Job { return this.get('jobs', id); }
  region(id: string): Region { return this.get('regions', id); }
  decisions(): Decision[] { return this.list('decisions'); }
  private section(projectId: string, sectionId: string): Project['sections'][number] {
    const section = this.project(projectId).sections.find(s => s.id === sectionId);
    if (!section) throw new Error('unknown section');
    return section;
  }
  createProject(project: Project): void {
    const sectionIds = project.sections.map(s => s.id);
    const referenceIds = project.references.map(r => r.id);
    if (project.schemaVersion !== 1 || project.revision !== 0 || !project.id || !sectionIds.length
        || new Set(sectionIds).size !== sectionIds.length
        || new Set(referenceIds).size !== referenceIds.length
        || project.sections.some(s => s.acceptedVersionId !== null)
        || project.references.some(r => r.scope.some(id => !sectionIds.includes(id)))
        || project.directions.some(d => d.referenceIds.some(id => !referenceIds.includes(id)))) {
      throw new Error('invalid initial project');
    }
    this.db.prepare('INSERT INTO projects VALUES(?,?)').run(project.id, JSON.stringify(project));
  }
  addAsset(projectId: string, sectionId: string, raster: Raster,
      parentId: string | null = null, provider: Provider = 'fixture'): AssetVersion {
    this.section(projectId, sectionId);
    if (parentId) {
      const parent = this.asset(parentId);
      if (parent.projectId !== projectId || parent.sectionId !== sectionId) throw new Error('parent scope mismatch');
    }
    const bytes = rasterBytes(raster);
    const digest = checksum(bytes);
    const path = `assets/${digest}.rgb.json`;
    const full = join(this.root, path);
    if (existsSync(full)) {
      if (checksum(readFileSync(full)) !== digest) throw new Error('existing asset is corrupt');
    } else {
      const temporary = full + '.' + randomUUID() + '.tmp';
      writeFileSync(temporary, bytes, { flag: 'wx' });
      const fd = openSync(temporary, 'r');
      try { fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temporary, full);
      const directory = openSync(join(this.root, 'assets'), 'r');
      try { fsyncSync(directory); } finally { closeSync(directory); }
    }
    const asset: AssetVersion = { id: randomUUID(), projectId, sectionId, parentId,
      checksum: digest, width: raster.width, height: raster.height, path, provider };
    this.db.prepare('INSERT INTO assets VALUES(?,?,?)').run(asset.id, projectId, JSON.stringify(asset));
    return asset;
  }
  readRaster(id: string): Raster {
    const asset = this.asset(id);
    // No user filename is trusted; derive the content-addressed path from validated metadata.
    if (!/^[a-f0-9]{64}$/.test(asset.checksum) || asset.path !== `assets/${asset.checksum}.rgb.json`) {
      throw new Error('invalid asset path');
    }
    const bytes = readFileSync(join(this.root, asset.path));
    if (checksum(bytes) !== asset.checksum) throw new Error('asset checksum mismatch');
    const raster = JSON.parse(bytes.toString()) as Raster;
    validateRaster(raster);
    if (raster.width !== asset.width || raster.height !== asset.height) throw new Error('asset metadata mismatch');
    return raster;
  }
  createRegion(sourceVersionId: string, mask: number[]): Region {
    const source = this.readRaster(sourceVersionId);
    const region: Region = { id: randomUUID(), sourceVersionId, width: source.width,
      height: source.height, coordinateSystem: 'pixel-top-left', mask };
    validateRegion(region, source);
    this.db.prepare('INSERT INTO regions VALUES(?,?,?)').run(region.id, sourceVersionId, JSON.stringify(region));
    return region;
  }
  createJob(input: Pick<Job, 'projectId' | 'sectionId' | 'sourceVersionId' | 'regionId' | 'provider'
      | 'recipeVersion' | 'instruction' | 'referenceIds' | 'settings'>): Job {
    this.section(input.projectId, input.sectionId);
    const source = input.sourceVersionId ? this.asset(input.sourceVersionId) : null;
    if (source && (source.projectId !== input.projectId || source.sectionId !== input.sectionId)) throw new Error('source scope mismatch');
    if (source) this.readRaster(source.id);
    if (input.regionId && (!source || this.region(input.regionId).sourceVersionId !== source.id)) throw new Error('region source mismatch');
    const refs = this.project(input.projectId).references;
    if (input.referenceIds.some(id => !refs.some(r => r.id === id && r.scope.includes(input.sectionId)))) {
      throw new Error('reference scope mismatch');
    }
    if (input.provider !== 'fixture' && input.settings !== null) throw new Error('unverified provider settings');
    const project = this.project(input.projectId);
    const job: Job = { ...input, id: randomUUID(), providerId: null, usage: null,
      briefRevisionId: project.brief.id, sourceProjectRevision: project.revision,
      state: 'queued', outputVersionIds: [], error: null };
    this.db.prepare('INSERT INTO jobs VALUES(?,?,?)').run(job.id, job.projectId, JSON.stringify(job));
    return job;
  }
  transition(id: string, state: JobState): Job {
    const job = this.job(id);
    if (!transitions[job.state].includes(state)) throw new Error('invalid job transition');
    job.state = state;
    this.replace('jobs', id, job);
    return job;
  }
  finishJob(id: string, raster: Raster): AssetVersion {
    return this.transaction(() => {
      const job = this.job(id);
      if (!['running', 'awaiting_external_result', 'outcome_unknown'].includes(job.state)) throw new Error('job cannot collect result');
      if (job.provider !== 'fixture') throw new Error('live/native collection is not implemented');
      // S0 collects deterministic fixture results only; no live adapter is implemented.
      const result = job.regionId ? composite(this.readRaster(job.sourceVersionId!), raster, this.region(job.regionId)) : raster;
      const asset = this.addAsset(job.projectId, job.sectionId, result, job.sourceVersionId, job.provider);
      job.state = 'succeeded'; job.outputVersionIds = [asset.id]; job.error = null;
      this.replace('jobs', id, job);
      return asset;
    });
  }
  accept(projectId: string, sectionId: string, versionId: string,
      expectedCurrent: string | null, reviewer: string, reason: string): Decision {
    return this.transaction(() => {
      const project = this.project(projectId);
      const section = this.section(projectId, sectionId);
      const asset = this.asset(versionId);
      if (asset.projectId !== projectId || asset.sectionId !== sectionId) throw new Error('acceptance scope mismatch');
      if (section.acceptedVersionId !== expectedCurrent) throw new Error('stale acceptance');
      if (!reviewer.trim() || !reason.trim()) throw new Error('reviewer and reason required');
      this.readRaster(versionId);
      const decision: Decision = { id: randomUUID(), projectId, sectionId, previousVersionId: expectedCurrent,
        chosenVersionId: versionId, reviewer, reason, at: new Date().toISOString() };
      project.sections.find(s => s.id === sectionId)!.acceptedVersionId = versionId;
      project.revision++;
      this.replace('projects', projectId, project);
      this.db.prepare('INSERT INTO decisions VALUES(?,?,?)').run(decision.id, projectId, JSON.stringify(decision));
      return decision;
    });
  }
  handoff(projectId: string): Handoff {
    const project = this.project(projectId);
    const unresolved = [...project.brief.unresolved];
    const sections = project.sections.map(section => {
      const asset = section.acceptedVersionId ? this.asset(section.acceptedVersionId) : null;
      if (asset) this.readRaster(asset.id);
      else unresolved.push(`no accepted asset: ${section.id}`);
      if (Object.keys(section.overrides).length) unresolved.push(`review style override: ${section.id}`);
      return { id: section.id, kind: section.kind, text: section.text, overrides: section.overrides, asset };
    });
    return { schemaVersion: 1, projectId, projectRevision: project.revision, briefRevisionId: project.brief.id,
      style: project.style, sections, unresolved };
  }
}
