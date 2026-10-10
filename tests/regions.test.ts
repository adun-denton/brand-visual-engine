import type { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { Workspace } from '../src/service/workspace.ts';
import { Providers } from '../src/service/providers.ts';
import {
  Regions,
  canonicalPixels,
  drawMask,
  validateRegionLinks,
} from '../src/service/regions.ts';
import { IMAGE_MODELS, ASSISTANT_MODELS } from '../src/service/openai.ts';
import { reference } from '../src/kernel/packets.ts';
import { regionView } from '../src/web/regions.ts';
import {
  compositePixels,
  outsidePixelDifference,
  validateBinaryMask,
} from '../src/kernel/raster.ts';
import type {
  RegionOperation,
  RegionSelection,
  RegionImage,
  RegionComparison,
} from '../src/modules/website/region-contracts.ts';
import type { NativeJob } from '../src/modules/website/workspace-contracts.ts';
import type {
  DesignArtifact,
  NodePacket,
  VersionRef,
  IterationBundle,
} from '../src/kernel/contracts.ts';
import type { TestContext } from 'node:test';
const pixels = (w = 120, h = 80, color = '#de8159') =>
  sharp({ create: { width: w, height: h, channels: 4, background: color } })
    .png()
    .toBuffer();
const last = <T>(w: Workspace, pid: string, kind: string) =>
  w
    .state(pid)
    .artifacts!.filter((a) => a.payload.kind === kind)
    .at(-1) as NodePacket<DesignArtifact<T>>;
async function setup(
  t: TestContext,
  bytes?: Buffer,
  mode: 'branded' | 'freeroam' = 'freeroam',
) {
  const root = mkdtempSync(join(tmpdir(), 'bve-region-test-'));
  const w = new Workspace(root, { directionFixture: true });
  let calls = 0,
    closed = false;
  const additionalConnections: Workspace[] = [];
  const providers = new Providers(w, {
    apiKey: 'synthetic-only-key',
    imageModel: IMAGE_MODELS[0],
    assistantModel: ASSISTANT_MODELS[0],
    timeoutMs: 2000,
    policy: {
      runId: 'region-test',
      approval: 'Injected offline test only',
      maxCalls: 5,
      capUSD: 5,
      reserveUSD: 1,
      models: [...IMAGE_MODELS],
      alternativeCallBoundApproved: true,
    },
    transport: async (_url, init) => {
      calls++;
      assert.ok(init.body instanceof FormData);
      assert.equal(init.body.has('mask'), false);
      assert.equal(init.body.has('seed'), false);
      return new Response(
        JSON.stringify({
          data: [{ b64_json: (await pixels()).toString('base64') }],
          usage: { total_tokens: 8 },
        }),
        { headers: { 'x-request-id': 'req_region_fixture' } },
      );
    },
  });
  const regions = new Regions(w, providers);
  t.after(async () => {
    await providers.close();
    for (const connection of additionalConnections) connection.close();
    if (!closed) w.close();
    rmSync(root, { recursive: true, force: true });
  });
  const p = w.create({
    title: 'Synthetic region studio',
    mode,
    visualOS: null,
    palette: mode === 'branded' ? ['#173f45', '#f3ede0', '#de8159'] : null,
  }).project!;
  await w.addReference(
    p.id,
    reference(p),
    await pixels(),
    'Synthetic finish reference',
    'material',
    'hero',
  );
  const current = w.project(p.id);
  const bundle = w
    .explore(p.id, {
      expectedProject: reference(current),
      count: 3,
      base: null,
    })
    .bundles!.at(-1) as NodePacket<IterationBundle>;
  w.native(p.id, {
    expectedProject: reference(current),
    artifact: bundle.payload.candidates[0],
    scope: 'hero',
    instructions: 'Synthetic source',
    preservation: ['Keep artwork'],
  });
  const job = last<NativeJob>(w, p.id, 'website-native-job'),
    sourceBytes = bytes ?? (await pixels());
  await w.importNative(
    p.id,
    {
      job: reference(job),
      manifestProject: reference(current),
      originalArtifact: bundle.payload.candidates[0],
    },
    sourceBytes,
  );
  const source = last(w, p.id, 'website-image');
  const raster = await canonicalPixels(sourceBytes);
  const input = {
    expectedProject: reference(current),
    source: reference(source),
    previous: null,
    expectedSelection: null,
    width: raster.width,
    height: raster.height,
    coordinateSystem: 'pixel-top-left',
    shape: 'ellipse',
    bounds: {
      x: Math.floor(raster.width / 4),
      y: Math.floor(raster.height / 4),
      width: Math.floor(raster.width / 2),
      height: Math.floor(raster.height / 2),
    },
  };
  await regions.select(p.id, input);
  const selection = last<RegionSelection>(w, p.id, 'website-region-selection');
  const prepare = (path = 'native', extra: object = {}) => {
    regions.prepare(p.id, {
      expectedProject: reference(w.project(p.id)),
      selection: reference(selection),
      instructions: 'Change orange material to sage; protect the corner',
      preservation: 'strict-composite',
      preset: 'preserve-form-change-finish',
      path,
      controls: path === 'api' ? { size: '1024x1024', quality: 'low' } : null,
      references: [w.state(p.id).references![0]!.artifact],
      ...extra,
    });
    return last<RegionOperation>(w, p.id, 'website-region-operation');
  };
  const nativeReturn = async (
    op: NodePacket<DesignArtifact<RegionOperation>>,
    bytes: Buffer,
  ) => {
    const job = w.read(p.id, op.payload.state.execution) as NodePacket<
      DesignArtifact<NativeJob>
    >;
    await w.importNative(
      p.id,
      {
        job: reference(job),
        manifestProject: op.payload.state.project,
        originalArtifact: op.payload.state.source,
      },
      bytes,
    );
    const raw = last(w, p.id, 'website-image');
    regions.collect(p.id, { operation: reference(op), raw: reference(raw) });
    return last<RegionImage>(w, p.id, 'website-region-image');
  };
  return {
    w,
    regions,
    providers,
    p,
    source,
    selection,
    input,
    sourceBytes,
    prepare,
    nativeReturn,
    root,
    close: async () => {
      await providers.close();
      w.close();
      closed = true;
    },
    track: (connection: Workspace) => additionalConnections.push(connection),
    calls: () => calls,
  };
}
test('production binary RGBA composite supports 1254-square, preserves RGB and alpha outside, and retains the fixture semantics', async () => {
  const source = await canonicalPixels(await pixels(1254, 1254, '#de815980')),
    raw = await canonicalPixels(await pixels(1254, 1254, '#71987640'));
  const mask = drawMask(1254, 1254, 'ellipse', {
    x: 400,
    y: 400,
    width: 300,
    height: 300,
  });
  assert.ok(outsidePixelDifference(source, raw, mask).rgb > 0);
  assert.ok(outsidePixelDifference(source, raw, mask).alpha > 0);
  const result = compositePixels(source, raw, mask);
  assert.deepEqual(outsidePixelDifference(source, result, mask), {
    rgb: 0,
    alpha: 0,
  });
  for (let p = 0; p < mask.length; p++)
    for (let c = 0; c < 4; c++)
      assert.equal(
        result.pixels[p * 4 + c],
        (mask[p] ? raw : source).pixels[p * 4 + c],
      );
  for (const bad of [
    Buffer.alloc(1),
    Buffer.alloc(mask.length),
    Buffer.alloc(mask.length, 2),
  ])
    assert.throws(() => validateBinaryMask(bad, 1254, 1254), /mask/);
  assert.throws(
    () =>
      drawMask(4000, 4000, 'rectangle', { x: 0, y: 0, width: 1, height: 1 }),
    /4 MP/,
  );
  assert.throws(
    () => compositePixels(source, { ...raw, width: 1 }, mask),
    /raster/,
  );
});
test('PNG JPEG WebP canonical rasters and EXIF orientation use displayed source coordinates without flattening alpha', async () => {
  const base = await pixels(180, 90, '#de815980');
  for (const format of ['png', 'jpeg', 'webp'] as const) {
    const data = await sharp(base)[format]().toBuffer(),
      raster = await canonicalPixels(data);
    assert.equal(raster.width, 180);
    assert.equal(raster.height, 90);
    assert.equal(raster.channels, 4);
    assert.equal(raster.pixels[3], format === 'jpeg' ? 255 : 128);
  }
  const oriented = await sharp(base)
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const raster = await canonicalPixels(oriented);
  assert.equal(raster.width, 90);
  assert.equal(raster.height, 180);
});
test('selection rejects source/version/dimension/coordinate/mask mismatches without writes; annotations preserve original bytes', async (t) => {
  const s = await setup(t),
    before = s.w.state(s.p.id);
  for (const change of [
    { width: 80 },
    { coordinateSystem: 'screen' },
    { bounds: { x: -1, y: 0, width: 10, height: 10 } },
    { bounds: { x: 100, y: 0, width: 30, height: 5 } },
    { mask: Buffer.alloc(9600, 2).toString('base64') },
    { mask: 'AA==' },
  ])
    await assert.rejects(s.regions.select(s.p.id, { ...s.input, ...change }));
  const foreign = s.w.create({
    title: 'Foreign',
    mode: 'freeroam',
    visualOS: null,
    palette: null,
  }).project!;
  await assert.rejects(
    s.regions.select(foreign.id, {
      ...s.input,
      expectedProject: reference(foreign),
    }),
    /project/,
  );
  assert.deepEqual(s.w.state(s.p.id).ledger, before.ledger);
  assert.deepEqual(s.w.state(s.p.id).accepted, before.accepted);
  await s.regions.select(s.p.id, {
    ...s.input,
    previous: reference(s.selection),
    expectedSelection: reference(s.selection),
    bounds: { x: 20, y: 20, width: 30, height: 30 },
  });
  const revised = last<RegionSelection>(
    s.w,
    s.p.id,
    'website-region-selection',
  );
  assert.equal(revised.id, s.selection.id);
  assert.equal(revised.version, 2);
  assert.notEqual(
    revised.payload.state.mask.checksum,
    s.selection.payload.state.mask.checksum,
  );
  assert.deepEqual(
    (await s.w.originalImage(s.p.id, reference(s.source))).bytes,
    s.sourceBytes,
  );
  assert.deepEqual(
    s.w.read(s.p.id, reference(s.selection)).payload.state,
    s.selection.payload.state,
  );
});
test('native region bundle includes byte-exact source, bound binary/PNG mask, scoped reference roles and unknown native metadata', async (t) => {
  const s = await setup(t),
    op = s.prepare(),
    bundle = await s.regions.bundle(s.p.id, reference(op));
  assert.deepEqual(Buffer.from(bundle.files[0]!.data, 'base64'), s.sourceBytes);
  assert.equal(bundle.files[1]!.role, 'material');
  assert.equal(bundle.request.references[0]!.artifact.version, 1);
  const mask = Buffer.from(bundle.mask.data, 'base64');
  validateBinaryMask(mask, 120, 80);
  const guide = await sharp(Buffer.from(bundle.maskGuidancePNG.data, 'base64'))
    .greyscale()
    .raw()
    .toBuffer();
  assert.deepEqual(guide, Buffer.from(mask.map((v) => v * 255)));
  const m = bundle.native.manifest;
  for (const k of ['model', 'settings', 'seed', 'usage', 'providerId'] as const)
    assert.equal(m[k], null);
  assert.equal(bundle.request.recipe.mask, 'guidance-only');
  assert.equal(s.calls(), 0);
});
test('native raw and strict composite stay distinct, verify outside RGBA and survive closed-root recovery with acceptance history', async (t) => {
  const s = await setup(t),
    op = s.prepare(),
    raw = await s.nativeReturn(op, await pixels(120, 80, '#71987640'));
  assert.equal(s.w.kernel.selected(s.p.id, 'hero'), null);
  await assert.rejects(
    s.regions.accept(s.p.id, {
      candidate: reference(raw),
      expected: null,
      reason: 'Raw is not strict',
    }),
    /composite/,
  );
  await s.regions.compose(s.p.id, { candidate: reference(raw) });
  const composite = last<RegionImage>(s.w, s.p.id, 'website-region-image');
  assert.notEqual(composite.payload.state.image.id, raw.payload.state.image.id);
  assert.deepEqual(composite.payload.state.outsideDifference, {
    rgb: 0,
    alpha: 0,
  });
  const currentOp = last<RegionOperation>(
    s.w,
    s.p.id,
    'website-region-operation',
  );
  s.regions.compare(s.p.id, {
    operation: reference(currentOp),
    compared: [reference(raw), reference(composite)],
    selected: reference(composite),
    reason: 'Review local finish and hard-edge seam',
  });
  s.providers.compare(s.p.id, {
    compared: [reference(raw), reference(composite)],
    selected: reference(composite),
    reason: 'Shared image comparison preserves regional candidates',
  });
  await s.regions.accept(s.p.id, {
    candidate: reference(composite),
    expected: null,
    reason: 'Explicit technical acceptance',
  });
  const before = s.w.state(s.p.id),
    copied = s.root + '-closed-copy';
  await s.close();
  cpSync(s.root, copied, { recursive: true });
  const reopened = new Workspace(copied, { directionFixture: true });
  t.after(() => {
    reopened.close();
    rmSync(copied, { recursive: true, force: true });
  });
  assert.deepEqual(reopened.state(s.p.id), before);
  assert.deepEqual(
    (await reopened.originalImage(s.p.id, reference(s.source))).bytes,
    s.sourceBytes,
  );
  assert.deepEqual(reopened.read(s.p.id, reference(raw)), raw);
  assert.ok(
    reopened.state(s.p.id).ledger!.events.some((e) => e.kind === 'acceptance'),
  );
});
test('geometry-changing raw results remain recoverable but block strict composite and acceptance without ledger/pointer changes', async (t) => {
  const s = await setup(t),
    op = s.prepare(),
    raw = await s.nativeReturn(op, await pixels(121, 80, '#719876'));
  const before = s.w.state(s.p.id);
  await assert.rejects(
    s.regions.compose(s.p.id, { candidate: reference(raw) }),
    /geometry/,
  );
  await assert.rejects(
    s.regions.accept(s.p.id, {
      candidate: reference(raw),
      expected: null,
      reason: 'Strict',
    }),
    /composite/,
  );
  assert.deepEqual(s.w.state(s.p.id), before);
});
test('late result remains tied to its historical mask and cannot accept after a newer selection', async (t) => {
  const s = await setup(t),
    op = s.prepare();
  await s.regions.select(s.p.id, {
    ...s.input,
    previous: reference(s.selection),
    expectedSelection: reference(s.selection),
    bounds: { x: 0, y: 0, width: 10, height: 10 },
  });
  const raw = await s.nativeReturn(op, await pixels(120, 80, '#719876'));
  await s.regions.compose(s.p.id, { candidate: reference(raw) });
  const composite = last<RegionImage>(s.w, s.p.id, 'website-region-image'),
    before = s.w.state(s.p.id);
  assert.deepEqual(composite.payload.state.selection, reference(s.selection));
  await assert.rejects(
    s.regions.accept(s.p.id, {
      candidate: reference(composite),
      expected: null,
      reason: 'Old mask',
    }),
    /Region changed/,
  );
  assert.deepEqual(s.w.state(s.p.id), before);
});
test('concurrent selection revisions and composites have one winner and explicit conflict, retaining both original inputs', async (t) => {
  const s = await setup(t),
    op = s.prepare(),
    raw = await s.nativeReturn(op, await pixels(120, 80, '#719876'));
  const compose = await Promise.allSettled([
    s.regions.compose(s.p.id, { candidate: reference(raw) }),
    s.regions.compose(s.p.id, { candidate: reference(raw) }),
  ]);
  assert.deepEqual(compose.map((x) => x.status).sort(), [
    'fulfilled',
    'rejected',
  ]);
  const edit = {
    ...s.input,
    previous: reference(s.selection),
    expectedSelection: reference(s.selection),
    bounds: { x: 2, y: 2, width: 10, height: 10 },
  };
  const revisions = await Promise.allSettled([
    s.regions.select(s.p.id, edit),
    s.regions.select(s.p.id, edit),
  ]);
  assert.deepEqual(revisions.map((x) => x.status).sort(), [
    'fulfilled',
    'rejected',
  ]);
  assert.equal(last(s.w, s.p.id, 'website-region-selection').version, 2);
  assert.equal(
    last<RegionOperation>(s.w, s.p.id, 'website-region-operation').payload.state
      .outputs.length,
    2,
  );
});
test('competing region acceptance retains both candidates and cannot overwrite the first decision', async (t) => {
  const s = await setup(t),
    first = s.prepare('native', { preservation: 'review-raw' }),
    second = s.prepare('native', { preservation: 'review-raw' });
  const a = await s.nativeReturn(first, await pixels(120, 80, '#719876')),
    b = await s.nativeReturn(second, await pixels(120, 80, '#173f45'));
  await s.regions.accept(s.p.id, {
    candidate: reference(a),
    expected: null,
    reason: 'First review',
  });
  const before = s.w.state(s.p.id);
  await assert.rejects(
    s.regions.accept(s.p.id, {
      candidate: reference(b),
      expected: reference(a),
      reason: 'Old operation must not overwrite',
    }),
    /Accepted image changed/,
  );
  assert.deepEqual(s.w.state(s.p.id), before);
  assert.deepEqual(s.w.read(s.p.id, reference(b)), b);
});
test('unsupported preset/native/API controls and wrong reference roles/types reject before operation or execution writes', async (t) => {
  const s = await setup(t),
    before = s.w.state(s.p.id);
  for (const [path, extra] of [
    ['native', { controls: { seed: 3 } }],
    ['api', { controls: { size: '1024x1024', quality: 'low', mask: true } }],
    ['native', { preset: 'extend-canvas' }],
    ['native', { references: [reference(s.source)] }],
  ] as const)
    assert.throws(() => s.prepare(path, extra));
  assert.deepEqual(s.w.state(s.p.id), before);
  assert.equal(s.calls(), 0);
});
test('regional API uses the retained one-call adapter without mask, keeps requested recipe/reference evidence and separate local composition', async (t) => {
  const s = await setup(t),
    op = s.prepare('api');
  s.providers.submit(s.p.id, { job: op.payload.state.execution });
  await s.providers.wait();
  assert.equal(s.calls(), 1);
  const raw = last(s.w, s.p.id, 'website-api-image');
  s.regions.collect(s.p.id, { operation: reference(op), raw: reference(raw) });
  const candidate = last<RegionImage>(s.w, s.p.id, 'website-region-image');
  await s.regions.compose(s.p.id, { candidate: reference(candidate) });
  assert.equal(s.calls(), 1);
  assert.equal(op.payload.state.recipe.mask, 'unsupported');
  assert.equal(op.payload.state.references[0]!.role, 'material');
  assert.equal(op.payload.state.recipe.version, 'website-region-v1');
  assert.equal(s.w.kernel.selected(s.p.id, 'hero'), null);
});

test('1254-square native import, bound mask and strict RGBA composition exceed the old fixture limit without JSON rasters', async (t) => {
  const s = await setup(t, await pixels(1254, 1254, '#de815980')),
    op = s.prepare();
  const raw = await s.nativeReturn(op, await pixels(1254, 1254, '#71987640'));
  await s.regions.compose(s.p.id, { candidate: reference(raw) });
  const composite = last<RegionImage>(s.w, s.p.id, 'website-region-image');
  assert.equal(composite.payload.state.image.width, 1254);
  await s.regions.accept(s.p.id, {
    candidate: reference(composite),
    expected: null,
    reason: 'Verify 1254-square RGBA',
  });
  assert.deepEqual(s.w.kernel.selected(s.p.id, 'hero'), reference(composite));
});
test('ordinary image acceptance cannot bypass the regional preservation or freshness boundary', async (t) => {
  const s = await setup(t),
    op = s.prepare(),
    raw = await s.nativeReturn(op, await pixels());
  const before = s.w.state(s.p.id);
  assert.throws(
    () =>
      s.w.accept(s.p.id, {
        artifact: raw.payload.state.raw,
        bundle: null,
        expected: null,
        slot: 'hero',
        reason: 'Bypass strict composite',
        allowHistorical: true,
      }),
    /regional acceptance/,
  );
  assert.deepEqual(s.w.state(s.p.id), before);
});
test('acceptance revalidates module inputs inside the kernel transaction after an independent connection advances the project', async (t) => {
  const s = await setup(t),
    op = s.prepare('native', { preservation: 'review-raw' }),
    raw = await s.nativeReturn(op, await pixels());
  const other = new Workspace(s.root, { directionFixture: true });
  s.track(other);
  const accept = s.w.kernel.accept.bind(s.w.kernel);
  s.w.kernel.accept = (...args: Parameters<typeof accept>) => {
    other.reviseProject(s.p.id, {
      expectedProject: reference(other.project(s.p.id)),
      brief: { intent: 'Concurrent revision' },
      references: undefined,
      comparison: undefined,
      reason: 'Independent connection',
    });
    return accept(...args);
  };
  const events = s.w
    .state(s.p.id)
    .ledger!.events.filter((e) => e.kind === 'acceptance');
  await assert.rejects(
    s.regions.accept(s.p.id, {
      candidate: reference(raw),
      expected: null,
      reason: 'Old request',
    }),
    /Project changed/,
  );
  assert.deepEqual(
    s.w.state(s.p.id).ledger!.events.filter((e) => e.kind === 'acceptance'),
    events,
  );
  assert.equal(s.w.kernel.selected(s.p.id, 'hero'), null);
  assert.deepEqual(s.w.read(s.p.id, reference(raw)), raw);
});

test('selection and operation consumption reject wrong project/type/scope/recipe bindings without writes', async (t) => {
  const s = await setup(t),
    op = s.prepare(),
    before = s.w.state(s.p.id);
  const check = (a: NodePacket<DesignArtifact<unknown>>) =>
    validateRegionLinks(a, s.w.kernel, s.w.assets);
  check(s.selection);
  check(op);
  assert.throws(
    () => check({ ...s.selection, projectId: 'foreign-project' }),
    /owner/,
  );
  assert.throws(
    () =>
      check({
        ...s.selection,
        payload: { ...s.selection.payload, scope: 'services' },
      }),
    /scope/,
  );
  assert.throws(
    () =>
      check({
        ...op,
        payload: {
          ...op.payload,
          state: { ...op.payload.state, execution: reference(s.selection) },
        },
      }),
    /type/,
  );
  assert.throws(
    () =>
      check({
        ...op,
        payload: {
          ...op.payload,
          state: { ...op.payload.state, project: reference(s.source) },
        },
      }),
    /project/,
  );
  assert.throws(
    () =>
      check({
        ...op,
        payload: {
          ...op.payload,
          state: {
            ...op.payload.state,
            recipe: { ...op.payload.state.recipe, mask: 'unsupported' },
          },
        },
      }),
    /recipe/,
  );
  assert.deepEqual(s.w.state(s.p.id), before);
});
test('cancelled native regional returns remain bound to their original mask without becoming eligible for acceptance', async (t) => {
  const s = await setup(t),
    op = s.prepare('native', { preservation: 'review-raw' });
  s.w.cancel(s.p.id, {
    job: op.payload.state.execution,
    status: 'cancelled',
    reason: 'Explicit local closure',
  });
  const execution = last<NativeJob>(s.w, s.p.id, 'website-native-job');
  await s.w.importNative(
    s.p.id,
    {
      job: reference(execution),
      manifestProject: op.payload.state.project,
      originalArtifact: op.payload.state.source,
    },
    await pixels(),
  );
  s.regions.collect(s.p.id, {
    operation: reference(op),
    raw: reference(last(s.w, s.p.id, 'website-image')),
  });
  const raw = last<RegionImage>(s.w, s.p.id, 'website-region-image'),
    before = s.w.state(s.p.id);
  await assert.rejects(
    s.regions.accept(s.p.id, {
      candidate: reference(raw),
      expected: null,
      reason: 'Closed operation',
    }),
    /eligible/,
  );
  assert.deepEqual(s.w.state(s.p.id), before);
});
test('regional job/operation preparation and result/composite publication are atomic under storage failure; verified orphan assets are reusable', async (t) => {
  const s = await setup(t),
    before = s.w.state(s.p.id);
  (s.w.kernel as unknown as { db: DatabaseSync }).db.exec(
    "CREATE TEMP TRIGGER region_prepare_failure BEFORE INSERT ON kernel_packets WHEN json_extract(NEW.body,'$.payload.kind')='website-region-operation' BEGIN SELECT RAISE(ABORT,'injected operation failure'); END",
  );
  assert.throws(() => s.prepare(), /injected/);
  assert.deepEqual(s.w.state(s.p.id), before);
  (s.w.kernel as unknown as { db: DatabaseSync }).db.exec(
    'DROP TRIGGER region_prepare_failure',
  );
  const op = s.prepare(),
    raw = await s.nativeReturn(op, await pixels(120, 80, '#71987640')),
    prior = s.w.state(s.p.id);
  (s.w.kernel as unknown as { db: DatabaseSync }).db.exec(
    "CREATE TEMP TRIGGER region_result_failure BEFORE INSERT ON kernel_packets WHEN json_extract(NEW.body,'$.payload.kind')='website-region-image' BEGIN SELECT RAISE(ABORT,'injected result failure'); END",
  );
  await assert.rejects(
    s.regions.compose(s.p.id, { candidate: reference(raw) }),
    /injected/,
  );
  assert.deepEqual(s.w.state(s.p.id), prior);
  (s.w.kernel as unknown as { db: DatabaseSync }).db.exec(
    'DROP TRIGGER region_result_failure',
  );
  await s.regions.compose(s.p.id, { candidate: reference(raw) });
  assert.equal(
    last<RegionOperation>(s.w, s.p.id, 'website-region-operation').payload.state
      .outputs.length,
    2,
  );
});

test('Branded regional iteration preserves its shared context and approval while Website decisions stay local', async (t) => {
  const s = await setup(t, undefined, 'branded'),
    context = s.w.project(s.p.id).payload.visualOSRef!,
    sharedBefore = s.w.kernel.get(context),
    op = s.prepare();
  const raw = await s.nativeReturn(op, await pixels(120, 80, '#719876'));
  await s.regions.compose(s.p.id, { candidate: reference(raw) });
  const composite = last<RegionImage>(s.w, s.p.id, 'website-region-image');
  await s.regions.accept(s.p.id, {
    candidate: reference(composite),
    expected: null,
    reason: 'Section-only review',
  });
  assert.deepEqual(s.w.kernel.get(context), sharedBefore);
  assert.equal(s.w.project(s.p.id).payload.mode, 'branded');
  assert.equal(s.w.kernel.selected(s.p.id, 'services'), null);
  assert.equal(s.w.kernel.selected(s.p.id, 'design'), null);
});

test('a replacement-source selection invalidates older mask streams; competing initial section saves have one transaction winner', async (t) => {
  const s = await setup(t),
    oldOperation = s.prepare('native', { preservation: 'review-raw' });
  const newSource = async (color: string) => {
    s.w.native(s.p.id, {
      expectedProject: reference(s.w.project(s.p.id)),
      artifact: reference(s.source),
      scope: 'hero',
      instructions: 'Synthetic replacement source',
      preservation: [],
    });
    const job = last<NativeJob>(s.w, s.p.id, 'website-native-job');
    await s.w.importNative(
      s.p.id,
      {
        job: reference(job),
        manifestProject: job.payload.state.manifest.project,
        originalArtifact: reference(s.source),
      },
      await pixels(120, 80, color),
    );
    return last(s.w, s.p.id, 'website-image');
  };
  const replacement = await newSource('#173f45');
  await s.regions.select(s.p.id, {
    ...s.input,
    source: reference(replacement),
    expectedSelection: reference(s.selection),
  });
  const active = last<RegionSelection>(s.w, s.p.id, 'website-region-selection');
  assert.equal(s.w.kernel.currentVersion(s.selection.id), 1); // Own-version freshness alone would be insufficient.
  const oldRaw = await s.nativeReturn(
      oldOperation,
      await pixels(120, 80, '#719876'),
    ),
    before = s.w.state(s.p.id);
  await assert.rejects(
    s.regions.accept(s.p.id, {
      candidate: reference(oldRaw),
      expected: null,
      reason: 'Obsolete section selection',
    }),
    /newer section selection/,
  );
  assert.deepEqual(s.w.state(s.p.id), before);
  const a = await newSource('#de815940'),
    b = await newSource('#71987680');
  const results = await Promise.allSettled(
    [a, b].map((source) =>
      s.regions.select(s.p.id, {
        ...s.input,
        source: reference(source),
        expectedSelection: reference(active),
      }),
    ),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [
    'fulfilled',
    'rejected',
  ]);
  assert.equal(
    s.w
      .state(s.p.id)
      .artifacts!.filter((a) => a.payload.kind === 'website-region-selection')
      .length,
    3,
  );
  assert.equal(s.w.kernel.selected(s.p.id, 'hero'), null);
});

test('regional renderer restores the latest operation-bound comparison after outputs append and ignores foreign or mismatched bindings', async (t) => {
  const s = await setup(t),
    first = s.prepare(),
    second = s.prepare();
  const firstRaw = await s.nativeReturn(first, await pixels()),
    secondRaw = await s.nativeReturn(second, await pixels(120, 80, '#173f45'));
  const current = (id: string) =>
    s.w.state(s.p.id).artifacts!.find((a) => a.id === id)!;
  s.regions.compare(s.p.id, {
    operation: reference(current(first.id)),
    compared: [reference(firstRaw)],
    selected: reference(firstRaw),
    reason: 'First saved choice',
  });
  s.regions.compare(s.p.id, {
    operation: reference(current(second.id)),
    compared: [reference(secondRaw)],
    selected: reference(secondRaw),
    reason: 'Superseded second choice',
  });
  s.regions.compare(s.p.id, {
    operation: reference(current(second.id)),
    compared: [reference(secondRaw)],
    selected: null,
    reason: 'Latest "unresolved" & review',
  });
  const saved = last<RegionComparison>(
    s.w,
    s.p.id,
    'website-region-comparison',
  );
  await s.regions.compose(s.p.id, { candidate: reference(secondRaw) });
  assert.ok(current(second.id).version > saved.payload.state.operation.version);
  const snapshot = s.w.state(s.p.id);
  const render = (artifacts = snapshot.artifacts!) =>
    regionView({
      project: snapshot.project!,
      artifacts,
      references: snapshot.references!,
      accepted: snapshot.accepted!,
      apiAvailable: false,
      offline: true,
      imageUrl: (r) => `/image?id=${r.id}&version=${r.version}`,
      mutate: async () => {},
      act: async () => {},
      render: () => {},
      fileBase64: async () => '',
    });
  const form = (html: string, id: string) =>
    [
      ...html.matchAll(
        /<form class="region-comparison" data-operation="([^"]*)">([\s\S]*?)<\/form>/g,
      ),
    ].find((m) => m[1]!.includes(id))![2]!;
  const check = (html: string) => {
    const a = form(html, first.id),
      b = form(html, second.id);
    assert.ok(a.includes('value="First saved choice"'));
    assert.match(a, /<option value="[^"\n]*" selected>raw/);
    assert.ok(b.includes('value="Latest &quot;unresolved&quot; &amp; review"'));
    assert.ok(b.includes('<option value="null" selected>'));
    assert.equal(
      [...b.matchAll(/<input name="compared"[^>]* checked/g)].length,
      1,
    );
    const checked = [
      ...b.matchAll(/<input name="compared"[^>]* checked/g),
    ][0]![0];
    assert.ok(checked.includes(secondRaw.id));
    assert.ok(!html.includes('Decoy reason'));
  };
  check(render());
  const state = { ...saved.payload.state, reason: 'Decoy reason' };
  const decoys: NodePacket<DesignArtifact<RegionComparison>>[] = [
    { ...saved, projectId: 'foreign-project' },
    { ...saved, payload: { ...saved.payload, scope: 'contact' } },
    {
      ...saved,
      payload: {
        ...saved.payload,
        state: { ...state, source: { ...state.source, version: 99 } },
      },
    },
    {
      ...saved,
      payload: {
        ...saved.payload,
        state: { ...state, selection: { ...state.selection, version: 99 } },
      },
    },
    {
      ...saved,
      payload: {
        ...saved.payload,
        state: { ...state, operation: { ...state.operation, version: 99 } },
      },
    },
  ];
  for (const decoy of decoys)
    check(
      render([
        ...snapshot.artifacts!,
        {
          ...decoy,
          payload: {
            ...decoy.payload,
            state: { ...decoy.payload.state, reason: 'Decoy reason' },
          },
        },
      ]),
    );
  assert.deepEqual(s.w.state(s.p.id), snapshot);
  assert.equal(s.w.kernel.selected(s.p.id, 'hero'), null);
  assert.equal(s.calls(), 0);
});
