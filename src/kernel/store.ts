import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { IterationBundle, LedgerEvent, NodePacket, PortContract, ProjectLedger, VersionRef } from './contracts.ts';
import { contractGate, writePort } from './gate.ts';
import type { GateEnvironment } from './gate.ts';
import { digest, reference, revise } from './packets.ts';
export type KernelServices = Pick<GateEnvironment, 'assetExists' | 'moduleExists' | 'validateArtifact' | 'grantedPermissions'>;

/** Additive generic sidecar. Legacy workspace.sqlite and asset bytes are never migrated implicitly. */
export class KernelStore {
  private db: DatabaseSync;
  private services: KernelServices;
  constructor(root: string, services: KernelServices) {
    mkdirSync(root, { recursive: true }); this.services = services;
    this.db = new DatabaseSync(join(root, 'kernel.sqlite'));
    const version = this.db.prepare('PRAGMA user_version').get()!['user_version'];
    if (version !== 0 && version !== 1) { this.db.close(); throw new Error('unsupported kernel storage schema'); }
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS kernel_packets(id TEXT NOT NULL, version INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(id,version));
      CREATE TABLE IF NOT EXISTS kernel_events(project_id TEXT NOT NULL, sequence INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(project_id,sequence));
      CREATE TABLE IF NOT EXISTS kernel_selections(project_id TEXT NOT NULL, slot TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(project_id,slot));
      PRAGMA user_version=1;`);
  }
  close(): void { this.db.close(); }
  private transaction<T>(action: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = action(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  currentVersion(id: string): number | null {
    const row = this.db.prepare('SELECT MAX(version) AS version FROM kernel_packets WHERE id=?').get(id)!;
    return row['version'] as number | null;
  }
  lookup(ref: VersionRef): NodePacket<unknown> | null {
    const row = this.db.prepare('SELECT body FROM kernel_packets WHERE id=? AND version=?').get(ref.id, ref.version);
    if (!row) return null;
    const packet = JSON.parse(row['body'] as string) as NodePacket<unknown>;
    const { integrity, ...body } = packet;
    if (packet.id !== ref.id || packet.version !== ref.version || digest(body) !== integrity) throw new Error('stored packet integrity mismatch');
    return packet;
  }
  get<T>(ref: VersionRef): NodePacket<T> {
    const value = this.lookup(ref); if (!value) throw new Error('unknown packet version');
    return value as NodePacket<T>; // Consumers still validate their port before crossing a boundary.
  }
  environment(): GateEnvironment {
    return { ...this.services, lookup: ref => this.lookup(ref), currentVersion: id => this.currentVersion(id) };
  }
  private event(projectId: string, subject: VersionRef, kind: LedgerEvent['kind'], actor: string,
      reason: string, related: VersionRef[] = []): LedgerEvent {
    if (!actor.trim() || !reason.trim()) throw new Error('actor/reason required');
    const row = this.db.prepare('SELECT MAX(sequence) AS sequence FROM kernel_events WHERE project_id=?').get(projectId)!;
    const event: LedgerEvent = { id: randomUUID(), projectId, sequence: Number(row['sequence'] ?? 0) + 1,
      subject, kind, actor, reason, related, at: new Date().toISOString() };
    this.db.prepare('INSERT INTO kernel_events VALUES(?,?,?)').run(projectId, event.sequence, JSON.stringify(event));
    return event;
  }
  private insert<T>(input: NodePacket<T>, port: PortContract): NodePacket<T> {
    const latest = this.currentVersion(input.id);
    const previous = latest === null ? null : this.lookup({ id: input.id, version: latest, freshness: 'pinned' });
    contractGate(input, port, this.environment(), previous);
    this.db.prepare('INSERT INTO kernel_packets VALUES(?,?,?)').run(input.id, input.version, JSON.stringify(input));
    this.event(input.projectId ?? input.id, reference(input), 'revision', input.provenance.actor, input.provenance.source);
    return input;
  }
  put<T>(input: NodePacket<T>, port = writePort(input.type)): NodePacket<T> {
    return this.transaction(() => this.insert(input, port));
  }
  importSnapshot(projectId: string, packets: NodePacket<unknown>[], actor: string, reason: string): void {
    this.transaction(() => {
      if (!packets.length || packets.some(p => p.projectId !== projectId)) throw new Error('import scope mismatch');
      for (const input of packets) this.insert(input, writePort(input.type));
      this.event(projectId, reference(packets[0]!), 'legacy-import', actor, reason, packets.slice(1).map(p => reference(p)));
    });
  }
  ledger(projectId: string): ProjectLedger {
    return { projectId, events: this.db.prepare('SELECT body FROM kernel_events WHERE project_id=? ORDER BY sequence').all(projectId)
      .map(row => JSON.parse(row['body'] as string) as LedgerEvent) };
  }
  selected(projectId: string, slot: string): VersionRef | null {
    const row = this.db.prepare('SELECT body FROM kernel_selections WHERE project_id=? AND slot=?').get(projectId, slot);
    return row ? JSON.parse(row['body'] as string) as VersionRef : null;
  }
  select(bundleRef: VersionRef, candidate: VersionRef, actor: string, reason: string): NodePacket<IterationBundle> {
    return this.transaction(() => {
      const bundle = this.get<IterationBundle>(bundleRef);
      if (bundle.type !== 'iteration-bundle' || this.currentVersion(bundle.id) !== bundle.version) throw new Error('stale or invalid bundle selection');
      if (!bundle.payload.candidates.some(r => r.id === candidate.id && r.version === candidate.version)) throw new Error('candidate outside bundle');
      const next = revise(bundle, { ...bundle.payload, selection: candidate, status: 'selected' }, actor, reason);
      this.insert(next, writePort('iteration-bundle'));
      this.event(bundle.projectId!, reference(next), 'selection', actor, reason, [candidate]);
      return next;
    });
  }
  accept(projectId: string, slot: string, artifactRef: VersionRef, expected: VersionRef | null,
      actor: string, reason: string, bundleRef: VersionRef | null = null): LedgerEvent {
    return this.transaction(() => {
      if (!this.services.grantedPermissions.includes('accept')) throw new Error('acceptance permission denied');
      const artifact = this.get(artifactRef);
      if (artifact.type !== 'design-artifact' || artifact.projectId !== projectId) throw new Error('artifact acceptance scope mismatch');
      if (!slot.trim()) throw new Error('acceptance slot required');
      for (const asset of artifact.assets) if (!this.services.assetExists(asset.id, asset.checksum)) throw new Error('referenced asset unavailable or corrupt');
      if (artifactRef.freshness === 'current' && this.currentVersion(artifact.id) !== artifact.version) throw new Error('stale acceptance artifact');
      const current = this.selected(projectId, slot);
      if ((current?.id ?? null) !== (expected?.id ?? null) || (current?.version ?? null) !== (expected?.version ?? null)) throw new Error('stale acceptance');
      if (bundleRef) {
        const bundle = this.get<IterationBundle>(bundleRef);
        if (this.currentVersion(bundle.id) !== bundle.version) throw new Error('stale acceptance bundle');
        if (bundle.type !== 'iteration-bundle' || bundle.projectId !== projectId
          || bundle.payload.selection?.id !== artifactRef.id || bundle.payload.selection.version !== artifactRef.version) throw new Error('bundle selection mismatch');
      }
      const event = this.event(projectId, artifactRef, 'acceptance', actor, reason, bundleRef ? [bundleRef] : []);
      this.db.prepare('INSERT INTO kernel_selections VALUES(?,?,?) ON CONFLICT(project_id,slot) DO UPDATE SET body=excluded.body')
        .run(projectId, slot, JSON.stringify(artifactRef));
      return event;
    });
  }
}
