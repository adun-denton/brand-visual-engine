import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { KernelStore } from '../src/kernel/store.ts';
import { fixtureServices } from '../src/fixture-services.ts';
import { syntheticProject, syntheticVisualOS } from '../src/fixtures-design-os.ts';
import { packet, reference, revise } from '../src/kernel/packets.ts';
import { contractGate, writePort } from '../src/kernel/gate.ts';
import { artifactMetadata, reconnect } from '../src/kernel/metadata.ts';
import { exploreWebsite } from '../src/modules/website/design.ts';
import type { ArtifactMetadata, NodePacket } from '../src/kernel/contracts.ts';

function setup(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'bve-boundary-review-'));
  const state = { root, store: new KernelStore(root, fixtureServices),
    reopen() { this.store.close(); this.store = new KernelStore(root, fixtureServices); } };
  t.after(() => { state.store.close(); rmSync(root, { recursive: true, force: true }); });
  const visual = state.store.put(syntheticVisualOS());
  const project = state.store.put(syntheticProject('branded', visual));
  const free = state.store.put(syntheticProject('freeroam', null));
  const round = exploreWebsite(project, 'review-round');
  round.candidates.forEach(c => state.store.put(c)); state.store.put(round.bundle);
  return Object.assign(state, { visual, project, free, round });
}
function reseal<T>(input: NodePacket<T>, changes: Partial<Omit<NodePacket<T>, 'integrity'>>): NodePacket<T> {
  const { integrity: _, ...body } = input; return packet({ ...body, ...changes });
}

// Advance state only after insertion; assertions cover the later boundary and persisted decisions.
test('F1: stale current dependency cannot replace an existing selection or append ledger events, including after reopen', t => {
  const x = setup(t), selected = x.round.candidates[0]!;
  const current = x.store.put(reseal(selected, { id: 'current-input', dependencies: [reference(x.project, 'current')] }));
  x.store.accept(x.project.id, 'landing-page', reference(selected), null, 'human', 'initial pinned selection');
  x.store.put(revise(x.project, x.project.payload, 'human', 'upstream revision'));
  x.reopen();
  const before = x.store.ledger(x.project.id), pointer = x.store.selected(x.project.id, 'landing-page');
  assert.throws(() => contractGate(current, writePort('design-artifact'), x.store.environment()), /stale dependency/);
  assert.throws(() => x.store.accept(x.project.id, 'landing-page', reference(current), pointer, 'human', 'stale attempt'), /stale dependency/);
  assert.deepEqual(x.store.ledger(x.project.id), before); assert.deepEqual(x.store.selected(x.project.id, 'landing-page'), pointer);
  x.reopen();
  assert.deepEqual(x.store.ledger(x.project.id), before); assert.deepEqual(x.store.selected(x.project.id, 'landing-page'), pointer);
  assert.deepEqual(x.store.get(reference(current)), current);
});

test('F1: advancing an explicitly current context also prevents acceptance without writes', t => {
  const x = setup(t);
  const current = x.store.put(reseal(x.round.candidates[0]!, { id: 'current-context', contextRefs: [reference(x.visual, 'current')] }));
  x.store.put(revise(x.visual, x.visual.payload, 'human', 'new brand context')); x.reopen();
  const before = x.store.ledger(x.project.id);
  assert.throws(() => x.store.accept(x.project.id, 'context', reference(current), null, 'human', 'stale context'), /stale dependency/);
  assert.deepEqual(x.store.ledger(x.project.id), before); assert.equal(x.store.selected(x.project.id, 'context'), null);
});

test('F1 control: intentionally pinned historical inputs and an older artifact revision remain acceptable', t => {
  const x = setup(t), original = x.round.candidates[0]!;
  const v2 = x.store.put(revise(original, { ...original.payload, state: { ...original.payload.state, thesis: 'Historical direction v2' } }, 'human', 'artifact revision'));
  x.store.put(revise(v2, { ...v2.payload, state: { ...v2.payload.state, thesis: 'Newer direction v3' } }, 'human', 'later artifact revision'));
  x.store.put(revise(x.project, x.project.payload, 'human', 'new project revision'));
  x.store.put(revise(x.visual, x.visual.payload, 'human', 'new upstream revision')); x.reopen();
  const before = x.store.ledger(x.project.id).events.length;
  x.store.accept(x.project.id, 'historical', reference(v2), null, 'human', 'explicit pinned history');
  assert.deepEqual(x.store.selected(x.project.id, 'historical'), reference(v2));
  assert.equal(x.store.ledger(x.project.id).events.length, before + 1);
  assert.deepEqual(x.store.get(reference(original)), original); assert.equal(x.store.currentVersion(x.visual.id), 2);
  x.reopen(); assert.deepEqual(x.store.selected(x.project.id, 'historical'), reference(v2));
});

test('F1: associated bundle project freshness is rechecked, while a versioned pinned bundle succeeds', t => {
  const x = setup(t), candidate = x.round.candidates[0]!;
  const current = x.store.put(reseal(x.round.bundle, { id: 'bundle-current-project', payload: {
    ...x.round.bundle.payload, projectRef: reference(x.project, 'current') } }));
  const selected = x.store.select(reference(current), reference(candidate), 'human', 'choose');
  const pinned = x.store.select(reference(x.round.bundle), reference(candidate), 'human', 'pinned choice');
  x.store.put(revise(x.project, x.project.payload, 'human', 'upstream changed')); x.reopen();
  const before = x.store.ledger(x.project.id);
  assert.throws(() => x.store.accept(x.project.id, 'bundle', reference(candidate), null, 'human', 'stale bundle', reference(selected)), /stale dependency/);
  assert.deepEqual(x.store.ledger(x.project.id), before); assert.equal(x.store.selected(x.project.id, 'bundle'), null);
  x.store.accept(x.project.id, 'bundle', reference(candidate), null, 'human', 'pinned bundle accepted', reference(pinned));
  assert.deepEqual(x.store.selected(x.project.id, 'bundle'), reference(candidate));
});

test('F1: bundle context, explicit dependencies and base-state freshness fail atomically after advancement', t => {
  const x = setup(t), candidate = x.round.candidates[1]!, base = x.round.candidates[0]!;
  const bundles = [
    reseal(x.round.bundle, { id: 'bundle-context', contextRefs: [reference(x.visual, 'current')] }),
    reseal(x.round.bundle, { id: 'bundle-dependency', dependencies: [reference(x.project, 'current')] }),
    reseal(x.round.bundle, { id: 'bundle-base', payload: { ...x.round.bundle.payload, baseState: reference(base, 'current') } })
  ].map(b => x.store.select(reference(x.store.put(b)), reference(candidate), 'human', 'select'));
  x.store.put(revise(x.project, x.project.payload, 'human', 'new project'));
  x.store.put(revise(x.visual, x.visual.payload, 'human', 'new context'));
  x.store.put(revise(base, base.payload, 'human', 'new base')); x.reopen();
  const before = x.store.ledger(x.project.id);
  for (const bundle of bundles) {
    assert.throws(() => x.store.accept(x.project.id, bundle.id, reference(candidate), null, 'human', 'stale bundle input', reference(bundle)), /stale dependency/);
    assert.deepEqual(x.store.ledger(x.project.id), before); assert.equal(x.store.selected(x.project.id, bundle.id), null);
  }
});

test('F2: metadata construction rejects known wrong project and referenced types', t => {
  const x = setup(t), artifact = x.round.candidates[0]!;
  assert.throws(() => artifactMetadata(artifact, x.free, null, reference(x.round.bundle)), /metadata.*(owner|project)/);
  assert.throws(() => artifactMetadata(x.project, x.project, null, null), /metadata.*type/);
  assert.throws(() => artifactMetadata(artifact, artifact, null, null), /metadata.*type/);
  assert.throws(() => artifactMetadata(artifact, x.project, reference(x.project), null), /metadata.*type/);
  assert.throws(() => artifactMetadata(artifact, x.project, null, reference(artifact)), /metadata.*type/);
});

test('F2: import and reconnect reject foreign project, wrong ledger and metadata envelope ownership', t => {
  const x = setup(t), artifact = x.round.candidates[0]!;
  const good = artifactMetadata(artifact, x.project, reference(x.visual), reference(x.round.bundle));
  const wrongs = [
    { ...good, project: reference(x.free), ledgerProjectId: x.free.id },
    { ...good, ledgerProjectId: x.free.id }
  ];
  const before = x.store.ledger(x.project.id);
  for (const [index, metadata] of wrongs.entries()) {
    assert.throws(() => x.store.put(packet({ type: 'artifact-metadata', id: 'wrong-metadata-' + index, payload: metadata })), /metadata.*(owner|project|ledger)/);
    assert.throws(() => reconnect(metadata, ref => x.store.lookup(ref)), /metadata.*(owner|project|ledger)/);
    assert.equal(x.store.currentVersion('wrong-metadata-' + index), null);
  }
  assert.throws(() => x.store.put(packet({ type: 'artifact-metadata', id: 'wrong-envelope', projectId: x.free.id, payload: good })), /metadata.*(owner|project)/);
  assert.deepEqual(x.store.ledger(x.project.id), before);
});

test('F2: foreign and unrelated same-project bundles are rejected at construction, import and reconnect', t => {
  const x = setup(t), artifact = x.round.candidates[0]!;
  const foreign = exploreWebsite(x.free, 'foreign-round'), unrelated = exploreWebsite(x.project, 'unrelated-round');
  for (const round of [foreign, unrelated]) { round.candidates.forEach(c => x.store.put(c)); x.store.put(round.bundle); }
  const good = artifactMetadata(artifact, x.project, reference(x.visual), reference(x.round.bundle));
  for (const [index, bundle] of [foreign.bundle, unrelated.bundle].entries()) {
    assert.throws(() => artifactMetadata(artifact, x.project, reference(x.visual), reference(bundle), ref => x.store.lookup(ref)), /metadata.*(bundle|owner|project)/);
    const wrong = { ...good, bundle: reference(bundle) };
    assert.throws(() => x.store.put(packet({ type: 'artifact-metadata', id: 'wrong-bundle-' + index, payload: wrong })), /metadata.*(bundle|owner|project)/);
    assert.throws(() => reconnect(wrong, ref => x.store.lookup(ref)), /metadata.*(bundle|owner|project)/);
  }
  const valid = artifactMetadata(artifact, x.project, reference(x.visual), reference(x.round.bundle), ref => x.store.lookup(ref));
  assert.equal(reconnect(valid, ref => x.store.lookup(ref)).missing.length, 0);
});

test('F2: each available pointer must have the declared object type and lookup identity', t => {
  const x = setup(t), artifact = x.round.candidates[0]!;
  const good = artifactMetadata(artifact, x.project, reference(x.visual), reference(x.round.bundle));
  for (const ref of [good.artifact, good.project, good.visualOS!, good.bundle!]) {
    const wrongType = packet({ type: 'bundle-template', id: ref.id, payload: {} });
    const lookup = (r: typeof ref) => r.id === ref.id ? wrongType : x.store.lookup(r);
    assert.throws(() => reconnect(good, lookup), /metadata.*type/);
    assert.throws(() => contractGate(packet({ type: 'artifact-metadata', id: 'wrong-type-' + ref.id, payload: good }),
      writePort('artifact-metadata'), { ...x.store.environment(), lookup }), /metadata.*type/);
  }
  assert.throws(() => reconnect(good, () => x.project), /metadata.*identity/);
});

test('F2 controls: correct historical provenance and wholly or partially missing portable pointers remain valid without mounting', t => {
  const x = setup(t), artifact = x.round.candidates[0]!;
  const good = artifactMetadata(artifact, x.project, reference(x.visual), reference(x.round.bundle));
  x.store.put(revise(x.project, x.project.payload, 'human', 'later project')); x.reopen();
  x.store.put(packet({ type: 'artifact-metadata', id: 'correct-metadata', payload: good }));
  assert.equal(reconnect(good, ref => x.store.lookup(ref)).missing.length, 0);
  for (const visible of [null, good.artifact.id, good.project.id, good.visualOS!.id, good.bundle!.id]) {
    const lookup = (ref: typeof good.artifact) => ref.id === visible ? x.store.lookup(ref) : null;
    const links = reconnect(good, lookup);
    assert.equal(links.available.length, visible === null ? 0 : 1); assert.equal(links.missing.length, visible === null ? 4 : 3);
    assert.equal(links.requiresExplicitMount, true); assert.deepEqual(links.suggestedVisualOS, good.visualOS);
    contractGate(packet({ type: 'artifact-metadata', id: 'portable-' + visible, payload: good }),
      writePort('artifact-metadata'), { ...x.store.environment(), lookup });
  }
  assert.equal(x.store.get<typeof x.free.payload>(reference(x.free)).payload.visualOSRef, null);
  assert.throws(() => reconnect({ ...good, ledgerProjectId: 'foreign-ledger' }, () => null), /metadata.*ledger/);
});

test('F2: previously stored wrong ownership is rejected after reopen despite a genuine artifact checksum', t => {
  const x = setup(t), artifact = x.round.candidates[0]!;
  const good = artifactMetadata(artifact, x.project, reference(x.visual), reference(x.round.bundle));
  const historicalBad = packet({ type: 'artifact-metadata', id: 'pre-repair-metadata',
    payload: { ...good, project: reference(x.free), ledgerProjectId: x.free.id } });
  // Simulate a checksum-valid record admitted by the earlier boundary without using the repaired gate.
  const db = new DatabaseSync(join(x.root, 'kernel.sqlite'));
  try { db.prepare('INSERT INTO kernel_packets VALUES(?,?,?)').run(historicalBad.id, 1, JSON.stringify(historicalBad)); } finally { db.close(); }
  x.reopen();
  const existing = x.store.get<ArtifactMetadata>(reference(historicalBad));
  assert.equal(existing.payload.artifactIntegrity, artifact.integrity);
  assert.throws(() => reconnect(existing.payload, ref => x.store.lookup(ref)), /metadata.*(owner|project)/);
});
