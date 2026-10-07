import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { KernelStore } from '../src/kernel/store.ts';
import { fixtureServices } from '../src/fixture-services.ts';
import { syntheticCapabilities, syntheticProject, syntheticVisualOS } from '../src/fixtures-design-os.ts';
import { canonical, packet, placeholder, reference, revise } from '../src/kernel/packets.ts';
import { localField, resolveContext } from '../src/kernel/context.ts';
import { contractGate, reviewChanges, writePort } from '../src/kernel/gate.ts';
import { artifactMetadata, reconnect } from '../src/kernel/metadata.ts';
import { resolveCapability, semanticVerifierStub } from '../src/kernel/capabilities.ts';
import { exploreWebsite, explorationTemplate } from '../src/modules/website/design.ts';
import type { IterationBundle, ModuleProject, NodePacket } from '../src/kernel/contracts.ts';
import { moduleRegistry } from '../src/modules/registry.ts';
import { Store } from '../src/store.ts';
import { importLegacyWebsite } from '../src/modules/website/legacy-import.ts';
import { website, sourceRaster, completeFixture } from '../src/fixtures.ts';

function setup(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'design-os-test-'));
  const store = new KernelStore(root, fixtureServices);
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const visual = store.put(syntheticVisualOS());
  const project = store.put(syntheticProject('branded', visual));
  return { root, store, visual, project };
}
function round(store: KernelStore, project: NodePacket<ModuleProject>, id = 'broad-round') {
  const result = exploreWebsite(project, id);
  result.candidates.forEach(c => store.put(c)); store.put(result.bundle); return result;
}
const reseal = (value: NodePacket<unknown>, change: Record<string, unknown>) => {
  const { integrity: _, ...body } = value; return packet({ ...body, ...change });
};

test('same Website contract supports sparse Branded and Freeroam without inventing approval', t => {
  const { store, visual, project } = setup(t);
  const free = store.put(syntheticProject('freeroam', null));
  assert.equal(project.type, free.type); assert.equal(project.payload.moduleId, free.payload.moduleId);
  assert.equal(project.payload.resolvedContext.fields['palette']!.effective!.origin, 'inherited');
  assert.equal(free.payload.resolvedContext.fields['palette']!.effective, null);
  assert.ok(free.payload.resolvedContext.fields['palette']!.placeholder!.prohibitedAssumptions.length);
  assert.equal(project.payload.resolvedContext.fields['unreviewedClaim']!.effective, null);
  assert.ok(project.payload.resolvedContext.fields['density']!.reviewRequired);
  assert.throws(() => resolveContext('freeroam', visual, {}, []), /silently mount/);
  for (const p of [project, free]) {
    const result = round(store, p, p.id + '-round');
    assert.equal(result.candidates[0]!.payload.scope, 'landing-page');
    assert.ok(result.bundle.payload.placeholders.length > 0);
  }
});

test('context persists all origins while local override wins, derived remains distinct, explicit unresolved stays honest', t => {
  const { store, visual, project } = setup(t);
  const local = { ...project.payload.localContext, palette: localField({ hasOverride: true, override: ['#000000'],
    hasDerived: true, derived: ['#ffffff'], placeholder: placeholder('palette', 'needs review'), reviewRequired: true }) };
  const next = revise(project, { ...project.payload, localContext: local,
    resolvedContext: resolveContext('branded', visual, local, ['palette']) }, 'human', 'reviewed override proposal');
  store.put(next); const f = store.get<ModuleProject>(reference(next)).payload.resolvedContext.fields['palette']!;
  assert.deepEqual(f.inherited!.value, visual.payload.values['palette']!.value);
  assert.deepEqual(f.derived!.value, ['#ffffff']); assert.deepEqual(f.localOverride!.value, ['#000000']);
  assert.equal(f.effective!.origin, 'local-override'); assert.equal(f.placeholder!.reason, 'needs review');
  assert.equal(store.currentVersion(visual.id), 1);
});

test('gate rejects forged context provenance even with a recomputed packet checksum', t => {
  const { store, project } = setup(t);
  const payload = structuredClone(project.payload);
  payload.resolvedContext.fields['palette']!.inherited!.value = ['forged'];
  payload.resolvedContext.fields['palette']!.effective!.value = ['forged'];
  assert.throws(() => store.put(revise(project, payload, 'actor', 'forged context')), /provenance/);
  assert.equal(store.currentVersion(project.id), 1);
});

test('only Website is implemented; kernel contracts have no Website/provider imports', () => {
  assert.deepEqual(moduleRegistry.map(m => [m.id, m.implementation]), [['website', 'implemented']]);
  const contracts = readFileSync(new URL('../src/kernel/contracts.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(contracts, /from .*website|from .*executor/i);
  const design = readFileSync(new URL('../src/modules/website/design.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(design, /openai|comfyui|chinvat|Provider/);
});

test('nine coherent candidates vary all four relative families, preserve shared locks, and never count as quality scores', t => {
  const { store, project } = setup(t); const result = round(store, project);
  assert.equal(new Set(result.candidates.map(c => canonical(c.payload.state.metrics))).size, 9);
  for (const c of result.candidates) {
    assert.deepEqual(c.payload.state.metrics.map(m => m.family), ['Structural', 'Spatial', 'Styling', 'Dynamics']);
    assert.equal(c.payload.state.intent, project.payload.resolvedContext.fields['intent']!.effective!.value);
    assert.deepEqual(c.payload.lockedValues, result.bundle.payload.locked);
    assert.equal(c.approval, 'proposal');
  }
  assert.equal(store.selected(project.id, 'landing-page'), null);
});

test('human selection versions a bundle and tighter refinement centers on selected multi-family state', t => {
  const { store, project, visual } = setup(t); const result = round(store, project);
  const base = result.candidates[4]!;
  const selected = store.select(reference(result.bundle), reference(base), 'human', 'choose direction');
  assert.equal(selected.version, 2); assert.equal(store.get<IterationBundle>(reference(result.bundle)).payload.selection, null);
  assert.deepEqual(selected.provenance.previous, reference(result.bundle));
  const refinement = exploreWebsite(project, 'refine', base, 3, 0.2);
  refinement.candidates.forEach(c => store.put(c)); store.put(refinement.bundle);
  assert.deepEqual(refinement.bundle.payload.baseState, reference(base));
  assert.deepEqual(refinement.bundle.payload.exploring, base.payload.state.metrics);
  for (const c of refinement.candidates) c.payload.state.metrics.forEach((m, i) => {
    assert.ok(Math.abs(m.relative - base.payload.state.metrics[i]!.relative) <= 0.1000001);
  });
  assert.equal(store.currentVersion(visual.id), 1); assert.equal(store.selected(project.id, 'landing-page'), null);
  assert.throws(() => store.select(reference(result.bundle), reference(base), 'h', 'stale'), /stale/);
});

test('templates serialize and roundtrip independently of provider prompts', t => {
  const { store } = setup(t);
  const template = store.put(packet({ type: 'bundle-template', id: 'template', payload: explorationTemplate }));
  assert.deepEqual(JSON.parse(JSON.stringify(template)), template);
  assert.throws(() => store.put(packet({ type: 'bundle-template', id: 'bad-template', payload: { ...explorationTemplate, providerPrompt: 'vendor-specific' } })), /unsupported template field/);
});

test('capability resolution validates request types and records unavailable or manual routes honestly', async t => {
  const { store, project } = setup(t); const registry = store.put(syntheticCapabilities());
  const request = { capabilityId: 'image.edit', inputType: 'design-artifact', outputType: 'design-artifact' };
  assert.equal(resolveCapability(registry.payload, request, 'human').status, 'available');
  for (const kind of ['cloud', 'local', 'chinvat'] as const) {
    const result = resolveCapability(registry.payload, request, kind);
    assert.equal(result.status, 'unavailable'); if (result.status === 'unavailable') assert.ok(result.placeholder.resolutionRoutes.length);
  }
  assert.equal(resolveCapability(registry.payload, { ...request, outputType: 'bogus' }).status, 'unavailable');
  assert.deepEqual(await semanticVerifierStub.verify(project, project), { status: 'not-run', findings: [] });
  assert.ok(registry.payload.executors.every(e => e.observedSettings === null));
});

test('ContractGate rejects schema/type/required/permission/integrity/version errors before persistence', t => {
  const { store } = setup(t); const template = packet({ type: 'bundle-template', id: 'gated', payload: explorationTemplate });
  const env = store.environment(); const port = writePort('bundle-template');
  assert.throws(() => contractGate(reseal(template, { schemaVersion: 2 }), port, env), /schema/);
  assert.throws(() => contractGate(template, writePort('visual-os'), env), /type/);
  assert.throws(() => contractGate(template, { ...port, requiredFields: ['not.present'] }, env), /required input/);
  assert.throws(() => contractGate(reseal(template, { permissions: ['admin'] }), port, env), /permission/);
  assert.throws(() => contractGate({ ...template, integrity: '0'.repeat(64) }, port, env), /integrity/);
  assert.throws(() => store.put(reseal(template, { version: 2 })), /initial version/);
  store.put(template);
  assert.throws(() => store.put(reseal(template, { version: 3, provenance: { actor: 'h', source: 'skip', previous: reference(template) } })), /lineage/);
  assert.equal(store.currentVersion(template.id), 1);
});

test('missing, stale and cross-project dependencies fail while pinned prior versions stay usable', t => {
  const { store, project, visual } = setup(t); const result = round(store, project);
  store.put(revise(visual, visual.payload, 'human', 'new upstream review'));
  const candidate = result.candidates[0]!;
  assert.throws(() => store.put(reseal(candidate, { id: 'missing', dependencies: [{ id: 'absent', version: 1, freshness: 'pinned' }] })), /unavailable/);
  assert.throws(() => store.put(reseal(candidate, { id: 'stale', dependencies: [reference(visual, 'current')] })), /stale/);
  store.put(reseal(candidate, { id: 'pinned-prior', dependencies: [reference(visual)] }));
  const free = store.put(syntheticProject('freeroam', null));
  assert.throws(() => store.put(reseal(candidate, { id: 'foreign', dependencies: [reference(free)] })), /scope/);
});

test('malformed nested shape, unresolved without Placeholder, unknown module and incorrect owners fail', t => {
  const { store, project } = setup(t);
  const free = syntheticProject('freeroam', null);
  const malformed = structuredClone(free.payload); malformed.resolvedContext.fields['palette']!.placeholder = null;
  assert.throws(() => store.put(reseal(free, { payload: malformed })), /Placeholder/);
  assert.throws(() => store.put(reseal(free, { payload: { ...free.payload, localContext: { bad: { hasOverride: 'yes' } } } })), /boolean/);
  assert.throws(() => store.put(reseal(free, { payload: { ...free.payload, moduleId: 'instagram' } })), /not implemented/);
  assert.throws(() => store.put(reseal(free, { projectId: 'wrong-owner' })), /identity/);
  const result = exploreWebsite(project, 'unowned');
  assert.throws(() => store.put(reseal(result.candidates[0]!, { projectId: 'missing-owner', dependencies: [] })), /owner/);
  assert.throws(() => store.put(reseal(result.candidates[0]!, { assets: [{ id: 'missing', checksum: 'a'.repeat(64) }] })), /asset/);
});

test('preservation contracts reject edits and review-on-change reports invalidation without semantic scoring', t => {
  const { store } = setup(t); const previous = store.put(packet({ type: 'bundle-template', id: 'preserve', payload: explorationTemplate }));
  const next = revise(previous, { ...explorationTemplate, scope: 'page', candidateCount: 3 }, 'human', 'refine');
  const port = { ...writePort('bundle-template'), preserve: ['scope'], reviewOnChange: ['candidateCount', 'scope', 'name'] };
  assert.throws(() => store.put(next, port), /preservation/);
  assert.deepEqual(reviewChanges(previous, next, port), ['candidateCount', 'scope']);
  assert.equal(store.currentVersion(previous.id), 1);
});

test('bundle candidate membership, shared lock, source, count and relative bounds are enforced', t => {
  const { store, project } = setup(t); const result = round(store, project); const bundle = result.bundle;
  assert.throws(() => store.put(revise(bundle, { ...bundle.payload, selection: { id: 'outside', version: 1, freshness: 'pinned' }, status: 'selected' }, 'h', 'invalid')), /selection/);
  assert.throws(() => store.put(revise(bundle, { ...bundle.payload, candidateCount: 8 }, 'h', 'invalid')), /incomplete/);
  assert.throws(() => store.put(revise(bundle, { ...bundle.payload, locked: { intent: 'changed' } }, 'h', 'invalid')), /shared lock/);
  assert.throws(() => store.put(revise(bundle, { ...bundle.payload, exploring: [{ family: 'Spatial', key: 'space', relative: 2 }] }, 'h', 'invalid')), /relative/);
  assert.throws(() => exploreWebsite(project, 'invalid', null, 17), /bounded/);
});

test('acceptance is local, explicit, append audited and compare-and-swap protected', t => {
  const { store, project, visual } = setup(t); const result = round(store, project); const candidate = result.candidates[0]!;
  const selected = store.select(reference(result.bundle), reference(candidate), 'human', 'pick');
  store.accept(project.id, 'landing-page', reference(candidate), null, 'human', 'accept local result', reference(selected));
  const count = store.ledger(project.id).events.length;
  assert.throws(() => store.accept(project.id, 'landing-page', reference(result.candidates[1]!), null, 'h', 'stale'), /stale/);
  assert.equal(store.ledger(project.id).events.length, count);
  assert.deepEqual(store.selected(project.id, 'landing-page'), reference(candidate));
  assert.equal(store.currentVersion(visual.id), 1); assert.equal(store.get(reference(candidate)).approval, 'proposal');
});

test('acceptance rollback preserves selected pointer and ledger if database write fails', t => {
  const { root, store, project } = setup(t); const result = round(store, project); const candidate = result.candidates[0]!;
  const before = store.ledger(project.id); const fault = new DatabaseSync(join(root, 'kernel.sqlite'));
  try {
    fault.exec("CREATE TRIGGER reject_selection BEFORE INSERT ON kernel_selections BEGIN SELECT RAISE(ABORT, 'fixture acceptance failure'); END;");
    assert.throws(() => store.accept(project.id, 'landing-page', reference(candidate), null, 'human', 'local'), /fixture acceptance failure/);
    assert.equal(store.selected(project.id, 'landing-page'), null); assert.deepEqual(store.ledger(project.id), before);
  } finally { fault.close(); }
});

test('packet and stored corruption are detected without silently repairing history', t => {
  const { root, store, project } = setup(t); const fault = new DatabaseSync(join(root, 'kernel.sqlite'));
  try {
    fault.prepare('UPDATE kernel_packets SET body=? WHERE id=?').run(JSON.stringify({ ...project, integrity: '0'.repeat(64) }), project.id);
    assert.throws(() => store.get(reference(project)), /integrity/);
  } finally { fault.close(); }
});

test('future kernel storage schema is refused without changing legacy or future state', () => {
  const root = mkdtempSync(join(tmpdir(), 'kernel-schema-'));
  try {
    let db = new DatabaseSync(join(root, 'kernel.sqlite')); db.exec('PRAGMA user_version=99'); db.close();
    assert.throws(() => new KernelStore(root, fixtureServices), /unsupported/);
    db = new DatabaseSync(join(root, 'kernel.sqlite')); assert.equal(db.prepare('PRAGMA user_version').get()!['user_version'], 99); db.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('metadata contains only stable provenance pointers and reconnects without mounting context', t => {
  const { store, project, visual } = setup(t); const result = round(store, project); const candidate = result.candidates[0]!;
  const metadata = artifactMetadata(candidate, project, reference(visual), reference(result.bundle));
  assert.ok(!JSON.stringify(metadata).includes('events')); assert.ok(!JSON.stringify(metadata).includes('values'));
  assert.equal(reconnect(metadata, ref => store.lookup(ref)).missing.length, 0);
  const foreign = reconnect(metadata, () => null); assert.equal(foreign.missing.length, 4); assert.equal(foreign.requiresExplicitMount, true);
  const free = syntheticProject('freeroam', null); assert.equal(free.payload.visualOSRef, null);
  assert.throws(() => reconnect({ ...metadata, artifactIntegrity: '0'.repeat(64) }, ref => store.lookup(ref)), /integrity/);
});

test('a separate process reconstructs both modes, bundles, decisions, provenance and unresolved fields', () => {
  const root = mkdtempSync(join(tmpdir(), 'design os restart '));
  try {
    const script = fileURLToPath(new URL('../scripts/design-os-fixture.ts', import.meta.url));
    for (const action of ['seed', 'inspect']) {
      const result = spawnSync(process.execPath, [script, action, root], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      if (action === 'inspect') {
        const data = JSON.parse(result.stdout); assert.equal(data.visualOSVersion, 1);
        for (const outcome of data.outcomes) {
          assert.equal(outcome.accepted, true); assert.equal(outcome.bundleVersion, 2); assert.equal(outcome.candidates, 9);
          assert.equal(outcome.hasSelection, true); assert.equal(outcome.hasAcceptance, true); assert.equal(outcome.missingMetadataRefs, 0);
          assert.ok(outcome.unresolved.includes('motion'));
        }
      }
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('checkout paths containing spaces run original suite including child-process restart', () => {
  const root = mkdtempSync(join(tmpdir(), 'bve checkout with spaces '));
  try {
    for (const path of ['src', 'scripts', 'fixtures', 'tests', 'package.json']) cpSync(fileURLToPath(new URL('../' + path, import.meta.url)), join(root, path), { recursive: true });
    const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', join(root, 'tests', 'spike.test.ts')], { encoding: 'utf8', env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT')) });
    assert.equal(result.status, 0, result.stdout + result.stderr); assert.match(result.stdout, /# pass 19/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('explicit legacy import preserves bytes, masks, version/job/decision links and cannot imply new approval', () => {
  const root = mkdtempSync(join(tmpdir(), 'legacy-import-')); const legacy = new Store(root);
  const kernel = new KernelStore(root, { ...fixtureServices, assetExists: (id, hash) => {
    try { const asset = legacy.asset(id); legacy.readRaster(id); return asset.checksum === hash; } catch { return false; }
  } });
  try {
    const old = website(); legacy.createProject(old); const source = legacy.addAsset(old.id, 'hero', sourceRaster());
    const region = legacy.createRegion(source.id, Array(48).fill(1));
    const job = legacy.createJob({ projectId: old.id, sectionId: 'hero', sourceVersionId: source.id, regionId: region.id,
      provider: 'fixture', recipeVersion: 'v1', instruction: 'synthetic', referenceIds: [], settings: null });
    const candidate = completeFixture(legacy, job.id, 'success')!;
    legacy.accept(old.id, 'hero', candidate, null, 'human', 'old local selection');
    const before = legacy.snapshot(old.id); const sourceBytes = readFileSync(join(root, source.path));
    const imported = importLegacyWebsite(legacy, kernel, old.id, 'operator', 'explicit snapshot mapping');
    assert.deepEqual(legacy.snapshot(old.id), before); assert.deepEqual(readFileSync(join(root, source.path)), sourceBytes);
    assert.deepEqual(imported.artifact.payload.state, before); assert.equal(imported.artifact.approval, 'proposal');
    assert.equal(imported.project.payload.mode, 'freeroam'); assert.equal(imported.project.payload.visualOSRef, null);
    assert.equal(kernel.selected(imported.project.id, 'hero'), null);
    assert.ok(kernel.ledger(imported.project.id).events.some(e => e.kind === 'legacy-import'));
    assert.throws(() => importLegacyWebsite(legacy, kernel, old.id, 'operator', 'duplicate'), /already imported/);
    writeFileSync(join(root, source.path), 'corrupt');
    assert.throws(() => kernel.accept(imported.project.id, 'site', reference(imported.artifact), null, 'human', 'corrupt'), /corrupt/);
  } finally { kernel.close(); legacy.close(); rmSync(root, { recursive: true, force: true }); }
});

test('serialized fixtures are generated from the same contracts and enter all runtime gates', t => {
  const { store } = setup(t); // Unique identities below use a second fixture workspace.
  const data = JSON.parse(readFileSync(new URL('../fixtures/design-os.json', import.meta.url), 'utf8'));
  const root = mkdtempSync(join(tmpdir(), 'serialized-contracts-')); const second = new KernelStore(root, fixtureServices);
  try {
    second.put(data.visualOS); second.put(data.template); second.put(data.capabilities);
    for (const mode of data.modes) {
      second.put(mode.project); for (const candidate of mode.candidates) second.put(candidate); second.put(mode.bundle);
      second.put(packet({ type: 'artifact-metadata', id: mode.project.id + '-metadata', payload: mode.metadata }));
    }
    assert.equal(store.currentVersion('visual-os-synthetic'), 1);
  } finally { second.close(); rmSync(root, { recursive: true, force: true }); }
});

test('failed explicit import rolls back all kernel packets and audit events', () => {
  const root = mkdtempSync(join(tmpdir(), 'legacy-import-failure-')); const legacy = new Store(root);
  const kernel = new KernelStore(root, fixtureServices); const db = new DatabaseSync(join(root, 'kernel.sqlite'));
  try {
    const old = website(); legacy.createProject(old); const before = legacy.snapshot(old.id);
    db.exec("CREATE TRIGGER reject_import BEFORE INSERT ON kernel_events WHEN json_extract(NEW.body,'$.kind')='legacy-import' BEGIN SELECT RAISE(ABORT, 'fixture import failure'); END;");
    assert.throws(() => importLegacyWebsite(legacy, kernel, old.id, 'operator', 'explicit import'), /fixture import failure/);
    assert.equal(kernel.currentVersion('legacy-website-' + old.id), null);
    assert.deepEqual(kernel.ledger('legacy-website-' + old.id).events, []); assert.deepEqual(legacy.snapshot(old.id), before);
  } finally { db.close(); kernel.close(); legacy.close(); rmSync(root, { recursive: true, force: true }); }
});

test('execution records store capability and observed executor evidence separately without inventing provider settings', t => {
  const { store, project } = setup(t); const result = round(store, project);
  const execution = store.put(packet({ type: 'execution-record', id: 'manual-execution', projectId: project.id,
    payload: { request: { capabilityId: 'image.edit', inputType: 'design-artifact', outputType: 'design-artifact' },
      executorId: 'manual-import', bundleRef: reference(result.bundle), state: 'awaiting', externalId: null, observedSettings: null } }));
  assert.equal(store.get<typeof execution.payload>(reference(execution)).payload.observedSettings, null);
  assert.throws(() => store.put(packet({ type: 'execution-record', id: 'invalid-execution', projectId: project.id,
    payload: { ...execution.payload, bundleRef: reference(project) } })), /bundle mismatch/);
});
