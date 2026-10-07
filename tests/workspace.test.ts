import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readdirSync,
  rmSync,
  cpSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { request as httpRequest } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { Workspace } from '../src/service/workspace.ts';
import { startApp } from '../src/service/server.ts';
import { MAX_IMAGE_BYTES, decode } from '../src/service/assets.ts';
import { reference, canonical, packet } from '../src/kernel/packets.ts';
import { artifactMetadata } from '../src/kernel/metadata.ts';
import type {
  DesignArtifact,
  IterationBundle,
  ModuleProject,
  NodePacket,
  VersionRef,
} from '../src/kernel/contracts.ts';
import type {
  ImageState,
  NativeJob,
} from '../src/modules/website/workspace-contracts.ts';
import { Store } from '../src/modules/website/legacy-store.ts';
import { importLegacyWebsite } from '../src/modules/website/legacy-import.ts';
import { website, sourceRaster } from '../src/fixtures.ts';
const image = () =>
  sharp({
    create: { width: 120, height: 80, channels: 3, background: '#de8159' },
  })
    .png()
    .toBuffer();
function setup(t: test.TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'bve-workspace-'));
  const w = new Workspace(root);
  t.after(() => {
    try {
      w.close();
    } catch {}
    rmSync(root, { recursive: true, force: true });
  });
  return { root, w };
}
function create(w: Workspace, mode = 'freeroam') {
  return w.create({
    title: 'Synthetic studio',
    mode,
    visualOS: null,
    palette: mode === 'branded' ? ['#173f45', '#f3ede0', '#de8159'] : null,
  }).project!;
}
function explore(w: Workspace, p: NodePacket<ModuleProject>) {
  const s = w.explore(p.id, {
    expectedProject: reference(p),
    count: 3,
    base: null,
  });
  const bundle = s.bundles!.at(-1) as NodePacket<IterationBundle>;
  return { bundle, first: bundle.payload.candidates[0]! };
}
function accepted(w: Workspace, p: NodePacket<ModuleProject>) {
  const { bundle, first } = explore(w, p);
  const s = w.select(p.id, {
    bundle: reference(bundle),
    candidate: first,
    reason: 'Choose coherent direction',
  });
  w.accept(p.id, {
    artifact: first,
    bundle: reference(s.bundles!.at(-1)!),
    expected: null,
    reason: 'Fits synthetic brief',
    slot: 'design',
    allowHistorical: false,
  });
  return first;
}
function native(w: Workspace, p: NodePacket<ModuleProject>, a: VersionRef) {
  const s = w.native(p.id, {
    expectedProject: reference(p),
    artifact: a,
    scope: 'hero',
    instructions: 'Create a calm synthetic home-care image',
    preservation: ['Palette', 'No literal text'],
  });
  return s
    .artifacts!.filter((a) => a.payload.kind === 'website-native-job')
    .at(-1) as NodePacket<DesignArtifact<NativeJob>>;
}
function binding(j: NodePacket<DesignArtifact<NativeJob>>) {
  return {
    job: reference(j),
    manifestProject: j.payload.state.manifest.project,
    originalArtifact: j.payload.state.manifest.artifact,
  };
}
function currentJob(w: Workspace, pid: string) {
  return w
    .state(pid)
    .artifacts!.filter((a) => a.payload.kind === 'website-native-job')
    .at(-1) as NodePacket<DesignArtifact<NativeJob>>;
}
function selections(w: Workspace, pid: string) {
  return {
    ledger: w.kernel.ledger(pid).events.filter((e) => e.kind === 'acceptance'),
    design: w.kernel.selected(pid, 'design'),
    hero: w.kernel.selected(pid, 'hero'),
  };
}
test('both hydration modes persist sparse context; explicit mount preserves old Freeroam revision', (t) => {
  const { w } = setup(t),
    free = create(w),
    brand = create(w, 'branded');
  assert.equal(free.payload.resolvedContext.fields['palette']!.effective, null);
  assert.equal(
    brand.payload.resolvedContext.fields['palette']!.effective!.origin,
    'inherited',
  );
  assert.equal(
    brand.payload.resolvedContext.fields['density']!.reviewRequired,
    true,
  );
  const mounted = w.mount(free.id, {
    expectedProject: reference(free),
    visualOS: brand.payload.visualOSRef,
    reason: 'Explicit mount',
  }).project!;
  assert.equal(mounted.payload.mode, 'branded');
  assert.equal(
    w.kernel.get<ModuleProject>(reference(free)).payload.mode,
    'freeroam',
  );
  assert.equal(w.kernel.currentVersion(brand.payload.visualOSRef!.id), 1);
});
test('service current-input acceptance rejects after brief revision without audit/pointer writes; historical reads and comparisons survive', (t) => {
  const { w } = setup(t),
    p = create(w);
  const previous = accepted(w, p),
    { bundle, first } = explore(w, p);
  const s = w.select(p.id, {
    bundle: reference(bundle),
    candidate: first,
    reason: 'Select later round',
  });
  w.reviseProject(p.id, {
    expectedProject: reference(p),
    brief: { intent: 'New intended response' },
    reason: 'Revise intent',
  });
  const before = selections(w, p.id);
  assert.throws(
    () =>
      w.accept(p.id, {
        artifact: first,
        bundle: reference(s.bundles!.at(-1)!),
        expected: previous,
        reason: 'Stale choice',
        slot: 'design',
        allowHistorical: false,
      }),
    /stale/,
  );
  assert.deepEqual(selections(w, p.id), before);
  assert.equal(w.read(p.id, previous).id, previous.id);
  const v = w.project(p.id).version;
  w.reviseProject(p.id, {
    expectedProject: reference(w.project(p.id)),
    comparison: [previous, first],
    reason: 'Compare historical directions',
  });
  assert.equal(w.project(p.id).version, v);
});
test('references validate owner/type and revise without losing accepted history; reviewed proposals keep sources and uncertainty', async (t) => {
  const { w } = setup(t),
    p = create(w),
    chosen = accepted(w, p),
    other = create(w);
  const referenceBefore = selections(w, p.id);
  await assert.rejects(
    w.addReference(
      p.id,
      reference(p),
      Buffer.from('invalid reference'),
      'Invalid',
      'composition',
      'hero',
    ),
    /PNG/,
  );
  assert.deepEqual(selections(w, p.id), referenceBefore);
  assert.equal(readdirSync(join(w.assets.root, '..', 'quarantine')).length, 1);
  await w.addReference(
    p.id,
    reference(p),
    await image(),
    'Synthetic palette',
    'palette',
    'hero',
  );
  const s = w.state(p.id),
    r = s.references![0]!;
  assert.equal(s.accepted!.design!.id, chosen.id);
  const before = w.kernel.ledger(other.id);
  assert.throws(
    () =>
      w.reviseProject(other.id, {
        expectedProject: reference(other),
        references: [r],
        reason: 'Wrong project',
      }),
    /different project/,
  );
  assert.deepEqual(w.kernel.ledger(other.id), before);
  assert.throws(
    () =>
      w.reviseProject(p.id, {
        expectedProject: reference(s.project!),
        references: [{ ...r, artifact: chosen }],
        reason: 'Wrong type',
      }),
    /Wrong reference/,
  );
  w.direction(p.id, {
    expectedProject: reference(s.project!),
    proposal: {
      title: 'Calm and practical',
      rationale: 'Reference palette reduces contrast noise',
      constraints: ['Keep content'],
      uncertainty: 'Spacing needs designer review',
      unresolved: ['Motion'],
      sourceReferences: [r.artifact],
      reviewed: true,
      source: 'Operator-reviewed synthetic native proposal',
    },
  });
  const proposal = w
    .state(p.id)
    .artifacts!.find((a) => a.payload.kind === 'website-direction')!;
  assert.equal(proposal.approval, 'proposal');
  assert.deepEqual(
    (proposal.payload.state as { unresolved: string[] }).unresolved,
    ['Motion'],
  );
  assert.equal(w.kernel.selected(p.id, 'design')!.id, chosen.id);
});
test('PNG JPEG WebP fully decode; corrupt, truncated, excessive dimensions, animated and oversize inputs reject', async () => {
  const png = await image();
  assert.equal((await decode(png)).format, 'png');
  for (const format of ['jpeg', 'webp'] as const) {
    const b = await sharp(png)[format]().toBuffer();
    assert.equal((await decode(b)).format, format);
  }
  await assert.rejects(decode(Buffer.from('<svg/>')), /PNG/);
  await assert.rejects(decode(png.subarray(0, 50)), /decoded/);
  await assert.rejects(decode(Buffer.alloc(MAX_IMAGE_BYTES + 1)), /8 MiB/);
  const second = await sharp(png).negate().png().toBuffer();
  const animated = await sharp([png, second], { join: { animated: true } })
    .webp()
    .toBuffer();
  await assert.rejects(decode(animated), /dimensions/);
  const huge = await sharp({
    create: { width: 8193, height: 2, channels: 3, background: '#ffffff' },
  })
    .png()
    .toBuffer();
  await assert.rejects(decode(huge), /dimensions/);
});
test('invalid, oversize and wrong original bindings persist invalid outcomes with unchanged acceptance', async (t) => {
  const { w } = setup(t),
    p = create(w),
    a = accepted(w, p);
  let j = native(w, p, a);
  const before = selections(w, p.id);
  await assert.rejects(
    w.importNative(p.id, binding(j), Buffer.from('invalid image')),
    /PNG/,
  );
  j = currentJob(w, p.id);
  assert.equal(j.payload.state.outcomes.at(-1)!.kind, 'invalid');
  await assert.rejects(
    w.importNative(p.id, binding(j), Buffer.alloc(MAX_IMAGE_BYTES + 1)),
    /8 MiB/,
  );
  j = currentJob(w, p.id);
  await assert.rejects(
    w.importNative(
      p.id,
      { ...binding(j), originalArtifact: { ...a, version: 99 } },
      await image(),
    ),
    /binding mismatch/,
  );
  assert.deepEqual(selections(w, p.id), before);
  assert.equal(currentJob(w, p.id).payload.state.outputs.length, 0);
  assert.deepEqual(
    currentJob(w, p.id).payload.state.outcomes.map((o) => o.kind),
    ['invalid', 'invalid', 'invalid'],
  );
});
test('wrong-project native import, wrong scope acceptance and stale job version fail without acceptance changes', async (t) => {
  const { w } = setup(t),
    p = create(w),
    a = accepted(w, p),
    j = native(w, p, a),
    other = create(w);
  const before = selections(w, other.id);
  await assert.rejects(
    w.importNative(other.id, binding(j), await image()),
    /different project/,
  );
  assert.deepEqual(selections(w, other.id), before);
  assert.equal(currentJob(w, p.id).version, 1);
  await w.importNative(p.id, binding(j), await image());
  const result = currentJob(w, p.id).payload.state.outputs[0]!;
  assert.throws(
    () =>
      w.accept(p.id, {
        artifact: result,
        bundle: null,
        expected: null,
        reason: 'Wrong scope',
        slot: 'services',
        allowHistorical: false,
      }),
    /scope/,
  );
  await assert.rejects(
    w.importNative(p.id, binding(j), await image()),
    /Job changed/,
  );
  assert.equal(w.kernel.selected(p.id, 'hero'), null);
});
test('duplicate result stays one candidate; late return original binding cannot overwrite newer accepted work', async (t) => {
  const { w } = setup(t),
    p = create(w),
    a = accepted(w, p),
    j = native(w, p, a);
  await w.importNative(p.id, binding(j), await image());
  let job = currentJob(w, p.id);
  const first = job.payload.state.outputs[0]!;
  w.accept(p.id, {
    artifact: first,
    bundle: null,
    expected: null,
    reason: 'First image accepted',
    slot: 'hero',
    allowHistorical: false,
  });
  await w.importNative(p.id, binding(job), await image());
  job = currentJob(w, p.id);
  assert.equal(job.payload.state.outputs.length, 1);
  assert.equal(job.payload.state.outcomes.at(-1)!.kind, 'duplicate');
  w.reviseProject(p.id, {
    expectedProject: reference(w.project(p.id)),
    brief: { intent: 'A new brief' },
    reason: 'Upstream revision',
  });
  const bytes = await sharp(await image())
    .negate()
    .png()
    .toBuffer();
  await w.importNative(p.id, binding(job), bytes);
  job = currentJob(w, p.id);
  const late = job.payload.state.outputs[1]!;
  assert.equal(job.payload.state.outcomes.at(-1)!.kind, 'late');
  assert.deepEqual(w.kernel.selected(p.id, 'hero'), first);
  const s = w.read(p.id, late).payload.state as ImageState;
  assert.deepEqual(s.originalArtifact, a);
  assert.equal(s.job!.id, j.id);
  assert.equal(s.seed, null);
  const before = selections(w, p.id);
  assert.throws(
    () =>
      w.accept(p.id, {
        artifact: late,
        bundle: null,
        expected: first,
        reason: 'No historical acknowledgement',
        slot: 'hero',
        allowHistorical: false,
      }),
    /Historical/,
  );
  assert.deepEqual(selections(w, p.id), before);
  w.accept(p.id, {
    artifact: late,
    bundle: null,
    expected: first,
    reason: 'Explicitly reviewed original input',
    slot: 'hero',
    allowHistorical: true,
  });
  assert.deepEqual(w.kernel.selected(p.id, 'hero'), late);
});
test('abandoned/cancelled returns retained against original job but cannot be accepted', async (t) => {
  for (const status of ['cancelled', 'abandoned']) {
    const { w } = setup(t),
      p = create(w),
      a = accepted(w, p),
      j = native(w, p, a);
    w.cancel(p.id, { job: reference(j), status, reason: 'Close locally' });
    const job = currentJob(w, p.id);
    await w.importNative(p.id, binding(job), await image());
    const end = currentJob(w, p.id);
    assert.equal(end.payload.state.status, status);
    assert.equal(end.payload.state.outcomes.at(-1)!.kind, 'late-cancelled');
    assert.equal(w.kernel.selected(p.id, 'hero'), null);
    assert.throws(
      () =>
        w.accept(p.id, {
          artifact: end.payload.state.outputs[0],
          bundle: null,
          expected: null,
          reason: 'Cancelled result',
          slot: 'hero',
          allowHistorical: true,
        }),
      /retained only/,
    );
  }
});
test('fresh service and closed-root copied restore reconstruct brief references comparisons proposals native links and acceptance; legacy unchanged', async (t) => {
  const { root, w } = setup(t);
  const legacy = new Store(root);
  legacy.createProject(website());
  const asset = legacy.addAsset(website().id, 'hero', sourceRaster());
  legacy.close();
  const oldDb = readFileSync(join(root, 'workspace.sqlite'));
  // Reopen the service only after the legacy store closes: it never runs legacy recovery/mutations.
  w.close();
  const ws = new Workspace(root);
  t.after(() => {
    try {
      ws.close();
    } catch {}
  });
  assert.equal(ws.legacy.exists(asset.id, asset.checksum), true);
  const p = create(ws, 'branded'),
    a = accepted(ws, p);
  await ws.addReference(
    p.id,
    reference(p),
    await image(),
    'Synthetic image',
    'composition',
    'landing-page',
  );
  const current = ws.project(p.id);
  ws.reviseProject(p.id, {
    expectedProject: reference(current),
    comparison: [a],
    reason: 'Keep earlier comparison',
  });
  const job = native(ws, current, a);
  await ws.importNative(p.id, binding(job), await image());
  const output = currentJob(ws, p.id).payload.state.outputs[0]!;
  ws.accept(p.id, {
    artifact: output,
    bundle: null,
    expected: null,
    reason: 'Inspect decoded image',
    slot: 'hero',
    allowHistorical: false,
  });
  ws.direction(p.id, {
    expectedProject: reference(ws.project(p.id)),
    proposal: {
      title: 'Backup proposal',
      rationale: 'Keep quiet space',
      constraints: ['Content'],
      uncertainty: 'Designer pending',
      unresolved: ['Motion'],
      sourceReferences: [ws.state(p.id).references![0]!.artifact],
      reviewed: true,
      source: 'Synthetic reviewed native proposal',
    },
  });
  const before = canonical(ws.state(p.id));
  ws.close();
  assert.deepEqual(readFileSync(join(root, 'workspace.sqlite')), oldDb);
  const backup = mkdtempSync(join(tmpdir(), 'bve-copy-'));
  t.after(() => rmSync(backup, { recursive: true, force: true }));
  cpSync(root, backup, { recursive: true });
  const restored = new Workspace(backup);
  assert.equal(canonical(restored.state(p.id)), before);
  assert.equal(restored.legacy.exists(asset.id, asset.checksum), true);
  assert.equal(
    restored.kernel.get<DesignArtifact<NativeJob>>(reference(job)).payload.state
      .manifest.model,
    null,
  );
  restored.close();
});
test('portable metadata known mismatches reject; missing pointers do not mount context', (t) => {
  const { w } = setup(t),
    p = create(w),
    a = accepted(w, p),
    other = create(w);
  const artifact = w.read(p.id, a);
  const metadata = artifactMetadata(artifact, p, null, null, (r) =>
    w.kernel.lookup(r),
  );
  const before = w.project(p.id).payload.mode;
  assert.throws(
    () =>
      w.inspectMetadata({
        ...metadata,
        project: reference(other),
        ledgerProjectId: other.id,
      }),
    /owner/,
  );
  assert.equal(
    w.inspectMetadata({
      ...metadata,
      artifact: { ...a, id: 'missing-artifact' },
      project: { ...reference(p), id: 'missing-project' },
      ledgerProjectId: 'missing-project',
    }).missing.length,
    2,
  );
  assert.equal(w.project(p.id).payload.mode, before);
});
test('HTTP host/origin/token/method/nested/file boundaries reject; valid browser requests persist and fresh session token changes', async (t) => {
  const { root } = setup(t),
    app = await startApp(root);
  t.after(async () => {
    try {
      await app.close();
    } catch {}
  });
  let response = await fetch(app.origin + '/api/v1/session');
  const session = (await response.json()) as { token: string };
  const headers = {
    'Content-Type': 'application/json',
    Origin: app.origin,
    'X-BVE-Token': session.token,
  };
  const body = JSON.stringify({
    title: 'HTTP project',
    mode: 'freeroam',
    visualOS: null,
    palette: null,
  });
  for (const bad of [
    { ...headers, Origin: 'https://evil.example' },
    { ...headers, 'X-BVE-Token': 'wrong' },
  ]) {
    response = await fetch(app.origin + '/api/v1/projects', {
      method: 'POST',
      headers: bad,
      body,
    });
    assert.equal(response.status, 403);
  }
  const hostStatus = await new Promise<number>((resolve, reject) => {
    const req = httpRequest(
      app.origin + '/api/v1/projects',
      { method: 'POST', headers: { ...headers, Host: 'evil.example' } },
      (res) => {
        res.resume();
        resolve(res.statusCode!);
      },
    );
    req.on('error', reject);
    req.end(body);
  });
  assert.equal(hostStatus, 403);
  response = await fetch(app.origin + '/api/v1/projects', {
    method: 'POST',
    headers,
    body,
  });
  assert.equal(response.status, 200);
  const state = (await response.json()) as {
    project: NodePacket<ModuleProject>;
  };
  response = await fetch(app.origin + '/api/v1/revise', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      projectId: state.project.id,
      input: {
        expectedProject: reference(state.project),
        brief: { intent: { filePath: '/etc/passwd' } },
        reason: 'Reject nested object',
      },
    }),
  });
  assert.equal(response.status, 400);
  assert.equal(app.workspace.project(state.project.id).version, 1);
  response = await fetch(app.origin + '/api/v1/reference', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      projectId: state.project.id,
      input: {
        expectedProject: reference(state.project),
        filePath: '/etc/passwd',
        file: 'AAAA',
        label: 'Bad',
        role: 'imagery',
        scope: 'hero',
      },
    }),
  });
  assert.equal(response.status, 400);
  response = await fetch(app.origin + '/../../etc/passwd');
  assert.equal(response.status, 404);
  await app.close();
  const restarted = await startApp(root);
  t.after(() => restarted.close());
  const fresh = (await (
    await fetch(restarted.origin + '/api/v1/session')
  ).json()) as { token: string; projects: unknown[] };
  assert.notEqual(fresh.token, session.token);
  assert.equal(fresh.projects.length, 1);
});
test('corrupted returned image fails read and acceptance with no acceptance writes', async (t) => {
  const { root, w } = setup(t),
    p = create(w),
    a = accepted(w, p),
    j = native(w, p, a);
  await w.importNative(p.id, binding(j), await image());
  const output = currentJob(w, p.id).payload.state.outputs[0]!;
  const s = w.read(p.id, output).payload.state as ImageState;
  writeFileSync(join(root, 'native-assets', s.image.id), 'corruption');
  const before = selections(w, p.id);
  await assert.rejects(w.image(p.id, output), /corrupt/);
  assert.throws(
    () =>
      w.accept(p.id, {
        artifact: output,
        bundle: null,
        expected: null,
        reason: 'Corrupt input',
        slot: 'hero',
        allowHistorical: false,
      }),
    /corrupt/,
  );
  assert.deepEqual(selections(w, p.id), before);
});

test('native packet-group failure leaves no output/pointer and retry reuses verified orphan bytes', async (t) => {
  const { root, w } = setup(t),
    p = create(w),
    a = accepted(w, p),
    j = native(w, p, a),
    bytes = await image(),
    before = selections(w, p.id);
  const db = new DatabaseSync(join(root, 'kernel.sqlite'));
  db.exec(
    "CREATE TRIGGER reject_native_image BEFORE INSERT ON kernel_packets WHEN json_extract(NEW.body, '$.payload.kind')='website-image' BEGIN SELECT RAISE(ABORT,'injected native image failure'); END;",
  );
  await assert.rejects(w.importNative(p.id, binding(j), bytes), /injected/);
  assert.deepEqual(selections(w, p.id), before);
  let job = currentJob(w, p.id);
  assert.equal(job.payload.state.outputs.length, 0);
  assert.equal(job.payload.state.outcomes.at(-1)!.kind, 'invalid');
  assert.equal(
    w.assets.exists((await decode(bytes)).id, (await decode(bytes)).checksum),
    true,
  );
  db.exec('DROP TRIGGER reject_native_image');
  db.close();
  await w.importNative(p.id, binding(job), bytes);
  job = currentJob(w, p.id);
  assert.equal(job.payload.state.outputs.length, 1);
  assert.equal(w.kernel.selected(p.id, 'hero'), null);
});
