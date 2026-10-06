import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/store.ts';
import { candidateRaster, completeFixture, providerFixture, regionFixture, sourceRaster, website } from '../src/fixtures.ts';
import { checksum, composite, outsideDifference, rasterBytes, validateRaster } from '../src/raster.ts';
import type { Provider } from '../src/contracts.ts';

function setup(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'bve-test-'));
  const store = new Store(root);
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const project = website(); store.createProject(project);
  const source = store.addAsset(project.id, 'hero', sourceRaster());
  const makeJob = (provider: Provider = 'fixture', regionId: string | null = null) => store.createJob({
    projectId: project.id, sectionId: 'hero', sourceVersionId: source.id, regionId, provider,
    recipeVersion: providerFixture().recipeVersion, instruction: providerFixture().instruction,
    referenceIds: providerFixture().referenceIds, settings: null });
  return { root, store, project, source, makeJob };
}

test('fictional fixture is complete, source-backed, unresolved, and deterministic', t => {
  const { store, project } = setup(t);
  assert.deepEqual(project.sections.map(s => s.kind), ['hero', 'services', 'proof', 'contact']);
  assert.equal(project.brief.source, 'synthetic');
  assert.ok(project.directions.every(d => d.status === 'proposal'));
  for (const ref of project.references) assert.ok(existsSync(new URL('../' + ref.path, import.meta.url)));
  assert.deepEqual(store.project(project.id), project);
  assert.deepEqual(rasterBytes(candidateRaster()), rasterBytes(candidateRaster()));
});

test('asset bytes and parent identity remain immutable across decisions', t => {
  const { store, project, source, makeJob } = setup(t);
  const original = store.readRaster(source.id);
  store.accept(project.id, 'hero', source.id, null, 'reviewer', 'original');
  const outputId = completeFixture(store, makeJob().id, 'success')!;
  store.accept(project.id, 'hero', outputId, source.id, 'reviewer', 'candidate');
  assert.deepEqual(store.readRaster(source.id), original);
  assert.equal(store.asset(outputId).parentId, source.id);
  assert.equal(store.decisions().length, 2);
});

test('strict region composite changes inside and preserves all outside channels and corner mark', t => {
  const { store, source } = setup(t);
  const region = store.createRegion(source.id, regionFixture().mask);
  const original = store.readRaster(source.id);
  const raw = candidateRaster();
  assert.ok(outsideDifference(original, raw, region) > 0); // Provider-like candidate changes outside.
  const result = composite(original, raw, region);
  assert.equal(outsideDifference(original, result, region), 0);
  assert.deepEqual(result.pixels.slice(0, 6), original.pixels.slice(0, 6));
  assert.ok(result.pixels.some((value, i) => value !== original.pixels[i]));
});

test('bad raster data and geometry-changing edits fail before persistence', t => {
  const { store, source } = setup(t);
  assert.throws(() => validateRaster({ width: 1, height: 1, pixels: [NaN, 0, 0] }), /invalid/);
  assert.throws(() => validateRaster({ width: 1, height: 1, pixels: [256, 0, 0] }), /invalid/);
  const region = store.createRegion(source.id, regionFixture().mask);
  assert.throws(() => composite(sourceRaster(), { width: 1, height: 1, pixels: [1, 2, 3] }, region), /geometry/);
  assert.throws(() => store.createRegion(source.id, [1]), /geometry/);
  assert.throws(() => store.createRegion(source.id, Array(48).fill(0)), /geometry/);
  assert.throws(() => store.createRegion(source.id, Array(48).fill(2)), /geometry/);
});

test('regions cannot be reused on another version even when dimensions match', t => {
  const { store, source, project } = setup(t);
  const region = store.createRegion(source.id, regionFixture().mask);
  const other = store.addAsset(project.id, 'hero', candidateRaster(), source.id);
  assert.throws(() => store.createJob({ projectId: project.id, sectionId: 'hero', sourceVersionId: other.id,
    regionId: region.id, provider: 'fixture', recipeVersion: 'fixture-v1', instruction: 'edit', referenceIds: [], settings: null }), /region source/);
});

test('cross-section parents, job sources, acceptance, and references are rejected', t => {
  const { store, source, project } = setup(t);
  assert.throws(() => store.addAsset(project.id, 'services', sourceRaster(), source.id), /parent scope/);
  assert.throws(() => store.accept(project.id, 'services', source.id, null, 'r', 'wrong'), /scope/);
  assert.throws(() => store.createJob({ projectId: project.id, sectionId: 'services', sourceVersionId: source.id,
    regionId: null, provider: 'fixture', recipeVersion: 'v1', instruction: 'x', referenceIds: [], settings: null }), /source scope/);
  assert.throws(() => store.createJob({ projectId: project.id, sectionId: 'services', sourceVersionId: null,
    regionId: null, provider: 'fixture', recipeVersion: 'v1', instruction: 'x', referenceIds: ['ref-composition'], settings: null }), /reference scope/);
});

test('generation can start without a source; output remains an unaccepted candidate', t => {
  const { store, project } = setup(t);
  const job = store.createJob({ projectId: project.id, sectionId: 'services', sourceVersionId: null,
    regionId: null, provider: 'fixture', recipeVersion: 'fixture-v1', instruction: 'generate', referenceIds: [], settings: null });
  const id = completeFixture(store, job.id, 'success')!;
  assert.equal(store.asset(id).parentId, null);
  assert.equal(store.project(project.id).sections[1]!.acceptedVersionId, null);
  assert.equal(store.job(job.id).briefRevisionId, project.brief.id);
});

test('late completion attaches to its original source without replacing the newer selection', t => {
  const { store, source, project, makeJob } = setup(t);
  store.accept(project.id, 'hero', source.id, null, 'r', 'original');
  const late = makeJob(); store.transition(late.id, 'running');
  const newer = store.addAsset(project.id, 'hero', candidateRaster(), source.id);
  store.accept(project.id, 'hero', newer.id, source.id, 'r', 'newer');
  const output = store.finishJob(late.id, candidateRaster());
  assert.equal(output.parentId, source.id);
  assert.equal(store.project(project.id).sections[0]!.acceptedVersionId, newer.id);
  assert.equal(store.job(late.id).sourceProjectRevision, 1);
  assert.throws(() => store.accept(project.id, 'hero', output.id, source.id, 'r', 'stale'), /stale/);
  assert.equal(store.decisions().length, 2);
});

test('all deterministic outcome fixtures have explicit non-accepted results', t => {
  const { store, project, makeJob } = setup(t);
  for (const outcome of providerFixture().outcomes) {
    const job = makeJob(); const id = completeFixture(store, job.id, outcome);
    const expected = { success: 'succeeded', failure: 'failed', unknown: 'outcome_unknown', cancelled: 'cancelled' }[outcome];
    assert.equal(store.job(job.id).state, expected);
    assert.equal(Boolean(id), outcome === 'success');
    assert.equal(store.project(project.id).sections[0]!.acceptedVersionId, null);
    assert.equal(store.job(job.id).usage, null);
  }
});

test('duplicate and cancelled results cannot overwrite history or retry an unknown outcome', t => {
  const { store, makeJob } = setup(t);
  const done = makeJob(); completeFixture(store, done.id, 'success');
  assert.throws(() => store.finishJob(done.id, candidateRaster()), /cannot collect/);
  assert.equal(store.job(done.id).outputVersionIds.length, 1);
  const cancelled = makeJob(); store.transition(cancelled.id, 'cancelled');
  assert.throws(() => store.finishJob(cancelled.id, candidateRaster()), /cannot collect/);
  const unknown = makeJob(); completeFixture(store, unknown.id, 'unknown');
  assert.throws(() => store.transition(unknown.id, 'running'), /invalid/);
  // A known returned result can be reconciled as a candidate, without submitting again.
  store.finishJob(unknown.id, candidateRaster());
  assert.equal(store.job(unknown.id).state, 'succeeded');
});

test('invalid completion rolls back job; valid retry collects once', t => {
  const { store, makeJob } = setup(t);
  const job = makeJob(); store.transition(job.id, 'running');
  assert.throws(() => store.finishJob(job.id, { width: 1, height: 1, pixels: [] }), /invalid/);
  assert.equal(store.job(job.id).state, 'running');
  assert.deepEqual(store.job(job.id).outputVersionIds, []);
  store.finishJob(job.id, candidateRaster());
  assert.equal(store.job(job.id).outputVersionIds.length, 1);
});

test('native/provider unknown metadata remains null and live collection is unavailable', t => {
  const { store, makeJob } = setup(t);
  const native = makeJob('native');
  store.transition(native.id, 'awaiting_external_result');
  assert.equal(store.job(native.id).settings, null);
  assert.equal(store.job(native.id).providerId, null);
  assert.equal(store.job(native.id).usage, null);
  assert.throws(() => completeFixture(store, native.id, 'success'), /fixture provider/);
  assert.throws(() => store.finishJob(native.id, candidateRaster()), /not implemented/);
});

test('missing or corrupt assets are detected before acceptance or developer handoff', t => {
  const { store, source, project, root } = setup(t);
  store.accept(project.id, 'hero', source.id, null, 'r', 'initial');
  const path = join(root, source.path);
  const bytes = readFileSync(path);
  writeFileSync(path, 'corrupt');
  assert.throws(() => store.readRaster(source.id), /checksum/);
  assert.throws(() => store.handoff(project.id), /checksum/);
  assert.throws(() => store.addAsset(project.id, 'hero', sourceRaster()), /corrupt/);
  writeFileSync(path, bytes); unlinkSync(path);
  assert.throws(() => store.readRaster(source.id), /ENOENT/);
});

test('handoff matches accepted checksums, preserves section text, flags missing assets and overrides', t => {
  const { store, project, source, root } = setup(t);
  // Override is a declared fixture exception, not a silent change to a global style rule.
  const alternate = website(); alternate.id = 'override-project'; alternate.sections[1]!.overrides = { font: 'serif' };
  store.createProject(alternate);
  assert.ok(store.handoff(alternate.id).unresolved.includes('review style override: services'));
  store.accept(project.id, 'hero', source.id, null, 'r', 'fixture');
  const handoff = store.handoff(project.id);
  const asset = handoff.sections[0]!.asset!;
  assert.equal(checksum(readFileSync(join(root, asset.path))), asset.checksum);
  assert.deepEqual(handoff.sections.map(s => s.text), project.sections.map(s => s.text));
  assert.deepEqual(handoff.style, project.style);
  assert.ok(handoff.unresolved.includes('no accepted asset: services'));
});

test('a fresh process recovers accepted state and marks in-flight work unknown without submission', () => {
  const root = mkdtempSync(join(tmpdir(), 'bve-restart-'));
  try {
    const script = new URL('../scripts/restart-fixture.ts', import.meta.url);
    const seed = spawnSync(process.execPath, [script.pathname, 'seed', root], { encoding: 'utf8' });
    assert.equal(seed.status, 0, seed.stderr);
    const inspect = spawnSync(process.execPath, [script.pathname, 'inspect', root], { encoding: 'utf8' });
    assert.equal(inspect.status, 0, inspect.stderr);
    assert.deepEqual(JSON.parse(inspect.stdout), { accepted: true, state: 'outcome_unknown', outputs: [], decisionCount: 1 });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('future schema is refused without rewriting its version', () => {
  const root = mkdtempSync(join(tmpdir(), 'bve-schema-'));
  try {
    let db = new DatabaseSync(join(root, 'workspace.sqlite')); db.exec('PRAGMA user_version=99'); db.close();
    assert.throws(() => new Store(root), /unsupported database schema/);
    db = new DatabaseSync(join(root, 'workspace.sqlite'));
    assert.equal(db.prepare('PRAGMA user_version').get()!['user_version'], 99); db.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('database failure after file write leaves no output or acceptance and retry reuses safe bytes', t => {
  const { root, store, project, source, makeJob } = setup(t);
  store.accept(project.id, 'hero', source.id, null, 'r', 'initial');
  const job = makeJob(); store.transition(job.id, 'running');
  const fault = new DatabaseSync(join(root, 'workspace.sqlite'));
  try {
    fault.exec("CREATE TRIGGER fixture_failure BEFORE INSERT ON assets BEGIN SELECT RAISE(ABORT, 'fixture DB failure'); END;");
    assert.throws(() => store.finishJob(job.id, candidateRaster()), /fixture DB failure/);
    assert.equal(store.job(job.id).state, 'running');
    assert.deepEqual(store.job(job.id).outputVersionIds, []);
    assert.equal(store.project(project.id).sections[0]!.acceptedVersionId, source.id);
    const candidatePath = join(root, 'assets', checksum(rasterBytes(candidateRaster())) + '.rgb.json');
    assert.ok(existsSync(candidatePath)); // Harmless orphan, not an accepted/database asset.
    fault.exec('DROP TRIGGER fixture_failure');
    const output = store.finishJob(job.id, candidateRaster());
    assert.equal(store.job(job.id).outputVersionIds.length, 1);
    assert.equal(output.checksum, checksum(rasterBytes(candidateRaster())));
    assert.equal(store.project(project.id).sections[0]!.acceptedVersionId, source.id);
  } finally { fault.close(); }
});

test('section-local acceptance preserves every other section and global style', t => {
  const { store, project, source, makeJob } = setup(t);
  const services = store.addAsset(project.id, 'services', sourceRaster());
  store.accept(project.id, 'services', services.id, null, 'r', 'services');
  const before = store.project(project.id);
  const candidate = completeFixture(store, makeJob().id, 'success')!;
  store.accept(project.id, 'hero', candidate, null, 'r', 'hero candidate');
  const after = store.project(project.id);
  assert.deepEqual(after.sections.slice(1), before.sections.slice(1));
  assert.deepEqual(after.style, before.style);
  assert.equal(store.asset(candidate).parentId, source.id);
});
