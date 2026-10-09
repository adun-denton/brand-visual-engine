// Synthetic, offline workflow. Private fixture IPC is the only transport-count channel.
import { chromium, expect } from '@playwright/test';
import { startFixture, stopFixture } from './provider-browser-lifecycle.ts';
import type {
  FixtureProcess,
  FixtureReceipt,
} from './provider-browser-lifecycle.ts';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  cpSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { Workspace } from '../src/service/workspace.ts';
import { reference } from '../src/kernel/packets.ts';
import type {
  DesignArtifact,
  NodePacket,
  IterationBundle,
  VersionRef,
} from '../src/kernel/contracts.ts';
import type { NativeJob } from '../src/modules/website/workspace-contracts.ts';
import type {
  RegionOperation,
  RegionSelection,
  RegionImage,
  RegionComparison,
} from '../src/modules/website/region-contracts.ts';
import { canonicalPixels } from '../src/service/regions.ts';
import { outsidePixelDifference } from '../src/kernel/raster.ts';
const runtime = mkdtempSync(join(tmpdir(), 'bve-region-browser-')),
  evidence = resolve(process.env['BVE_EVIDENCE_DIR'] ?? 'docs/evidence');
mkdirSync(evidence, { recursive: true });
const authored = async (color: string, corner = '#173f45') =>
  sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#f3ede0"/><rect x="30" y="30" width="140" height="140" fill="${corner}"/><circle cx="700" cy="360" r="180" fill="${color}"/><path d="M110 810 L440 280 L780 810Z" fill="#173f45"/><rect x="60" y="900" width="904" height="70" fill="#fff"/></svg>`,
    ),
  )
    .png()
    .toBuffer();
const sourceBytes = await authored('#de8159'),
  rawBytes = await authored('#719876', '#de8159');
const w = new Workspace(runtime),
  p = w.create({
    title: 'Synthetic regional finish study',
    mode: 'freeroam',
    visualOS: null,
    palette: null,
  }).project!,
  pid = p.id;
await w.addReference(
  pid,
  reference(p),
  await authored('#719876'),
  'Sage finish, preserve form',
  'material',
  'hero',
);
const project = w.project(pid);
const initial = w.explore(pid, {
    expectedProject: reference(project),
    count: 3,
    base: null,
  }),
  design = (initial.bundles!.at(-1)! as NodePacket<IterationBundle>).payload
    .candidates[0]!;
w.native(pid, {
  expectedProject: reference(project),
  artifact: design,
  scope: 'hero',
  instructions: 'Authored offline source',
  preservation: ['Protect corner'],
});
const sourceJob = w
  .state(pid)
  .artifacts!.find(
    (a) => a.payload.kind === 'website-native-job',
  ) as NodePacket<DesignArtifact<NativeJob>>;
await w.importNative(
  pid,
  {
    job: reference(sourceJob),
    manifestProject: reference(project),
    originalArtifact: design,
  },
  sourceBytes,
);
const source = w
  .state(pid)
  .artifacts!.find((a) => a.payload.kind === 'website-image')!;
w.close();
let fixture: FixtureProcess | null = await startFixture(runtime, 0, 'fixture');
let origin = fixture.origin;
const receipts: FixtureReceipt[] = [],
  submissions: VersionRef[] = [],
  errors: string[] = [];
const browser = await chromium
  .launch({
    headless: true,
    ...(process.env['BVE_CHROMIUM_EXECUTABLE']
      ? { executablePath: process.env['BVE_CHROMIUM_EXECUTABLE'] }
      : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  .catch(async (error) => {
    if (fixture) {
      await stopFixture(fixture);
      fixture = null;
    }
    throw error;
  });
let context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  }),
  page = await context.newPage();
const listen = () => {
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (
      r.method() === 'POST' &&
      new URL(r.url()).pathname === '/api/v1/provider/submit'
    )
      submissions.push(r.postDataJSON().input.job);
  });
};
listen();
const state = async () =>
  (await (
    await fetch(origin + '/api/v1/workspace?project=' + pid)
  ).json()) as ReturnType<Workspace['state']>;
const idle = () =>
  expect(page.locator('#app')).not.toHaveAttribute('aria-busy', 'true');
const region = () =>
  page.getByRole('button', { name: '06 Regional edit' }).click();
async function action(path: string, click: () => Promise<void>) {
  await idle();
  const pending = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' &&
      new URL(r.url()).pathname === '/api/v1/' + path,
  );
  await click();
  const response = await pending;
  expect(response.ok(), await response.text()).toBe(true);
  await idle();
  return response.json();
}
const operation = (index = 0) => page.locator('.region-operation').nth(index);
const comparisonRecovery: { phase: string; operation: VersionRef }[] = [];
async function restoredComparison(
  op: VersionRef,
  expected: Pick<RegionComparison, 'compared' | 'selected' | 'reason'>,
  accepted: VersionRef | null,
  phase: string,
) {
  const panel = page.locator(`.region-operation[data-operation*="${op.id}"]`),
    form = panel.locator('.region-comparison');
  await expect(form).toBeVisible();
  const fields = form.locator('[name=compared]');
  const checked: VersionRef[] = [];
  for (const field of await fields.all()) {
    const pointer = JSON.parse(await field.inputValue()) as VersionRef;
    const included = expected.compared.some(
      (r) => r.id === pointer.id && r.version === pointer.version,
    );
    if (included) await expect(field).toBeChecked();
    else await expect(field).not.toBeChecked();
    if (await field.isChecked()) checked.push(pointer);
  }
  expect(checked).toEqual(expected.compared);
  await expect(form.locator('[name=selected]')).toHaveValue(
    JSON.stringify(expected.selected),
  );
  await expect(form.locator('[name=reason]')).toHaveValue(expected.reason);
  await expect(form).toContainText(
    'Comparison selection does not accept an image; acceptance is a separate action.',
  );
  const selectedIndicator = panel.getByText('Selected in saved comparison', {
    exact: true,
  });
  await expect(selectedIndicator).toHaveCount(expected.selected ? 1 : 0);
  if (expected.selected)
    await expect(
      panel
        .locator(`.region-candidate[data-candidate*="${expected.selected.id}"]`)
        .getByText('Selected in saved comparison', { exact: true }),
    ).toBeVisible();
  else await expect(form).toContainText('Saved comparison is unresolved.');
  const snapshot = await state(),
    saved = snapshot
      .artifacts!.filter(
        (a) =>
          a.payload.kind === 'website-region-comparison' &&
          (a.payload.state as RegionComparison).operation.id === op.id,
      )
      .at(-1)!.payload.state as RegionComparison;
  expect(saved.compared).toEqual(expected.compared);
  expect(saved.selected).toEqual(expected.selected);
  expect(saved.reason).toBe(expected.reason);
  expect(snapshot.accepted!.hero).toEqual(accepted);
  comparisonRecovery.push({ phase, operation: op });
}
const noOverflow = async () =>
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
const screen = async (name: string) => {
  await page.locator('#notice').evaluate((el) => {
    el.textContent = '';
  });
  await page.screenshot({
    path: join(evidence, name + '.png'),
    fullPage: true,
  });
};
let nativeOperation: NodePacket<DesignArtifact<RegionOperation>>,
  apiOperation: NodePacket<DesignArtifact<RegionOperation>>;
try {
  await page.goto(origin);
  await page.locator(`[data-action=open][data-id="${pid}"]`).click();
  await region();
  await expect(page.locator('#region-select button')).toBeEnabled();
  const overlay = page.locator('#region-overlay');
  await overlay.scrollIntoViewIfNeeded();
  const box = (await overlay.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.88, box.y + box.height * 0.55);
  await page.mouse.up();
  const expectedWidth = Math.floor(1024 * 0.88) - 512 + 1,
    expectedHeight = Math.floor(1024 * 0.55) - Math.floor(1024 / 6) + 1;
  const beforeMove = Number(
    await page.locator('#region-select [name=x]').inputValue(),
  );
  await overlay.press('ArrowRight');
  expect(
    Number(await page.locator('#region-select [name=x]').inputValue()),
  ).toBe(beforeMove + 1);
  await action('region/select', () =>
    page.locator('#region-select button').click(),
  );
  let snapshot = await state();
  const selection = snapshot.artifacts!.find(
    (a) => a.payload.kind === 'website-region-selection',
  ) as NodePacket<DesignArtifact<RegionSelection>>;
  expect(selection.payload.state.width).toBe(1024);
  expect(selection.payload.state.bounds.x).toBe(beforeMove + 1);
  expect(selection.payload.state.bounds.y).toBe(Math.floor(1024 / 6));
  expect(selection.payload.state.source).toEqual(reference(source));
  expect(selection.payload.state.bounds.width).toBe(expectedWidth);
  expect(selection.payload.state.bounds.height).toBe(expectedHeight);
  await page.locator('#region-select').scrollIntoViewIfNeeded();
  await noOverflow();
  await screen('region-selection-desktop');
  const prepare = page.locator('#region-prepare');
  await prepare
    .locator('[name=instructions]')
    .fill('Change orange finish to sage; protect the corner and silhouette.');
  await prepare.locator('[name=reference]').check();
  const prepared = await action('region/prepare', () =>
    prepare.getByRole('button', { name: 'Save regional request' }).click(),
  );
  nativeOperation = prepared.artifacts
    .filter(
      (a: NodePacket<DesignArtifact<unknown>>) =>
        a.payload.kind === 'website-region-operation',
    )
    .at(-1);
  const downloading = page.waitForEvent('download');
  await operation()
    .getByRole('button', { name: 'Export source / mask / references bundle' })
    .click();
  const download = await downloading,
    exported = JSON.parse(readFileSync((await download.path())!, 'utf8'));
  expect(Buffer.from(exported.files[0].data, 'base64')).toEqual(sourceBytes);
  expect(exported.files[1].role).toBe('material');
  expect(exported.selection.width).toBe(1024);
  expect(exported.selection.height).toBe(1024);
  expect(exported.native.manifest.model).toBeNull();
  expect(exported.request.recipe.mask).toBe('guidance-only');
  await operation().locator('.region-import input[type=file]').setInputFiles({
    name: 'authored-sage-raw.png',
    mimeType: 'image/png',
    buffer: rawBytes,
  });
  await action('import', () =>
    operation()
      .getByRole('button', { name: 'Import regional raw candidate' })
      .click(),
  );
  await action('region/collect', () =>
    operation()
      .getByRole('button', { name: 'Retain result in regional comparison' })
      .click(),
  );
  await action('region/compose', () =>
    operation()
      .getByRole('button', { name: 'Create strict local composite' })
      .click(),
  );
  snapshot = await state();
  const outputs = snapshot.artifacts!.filter(
    (a) => a.payload.kind === 'website-region-image',
  ) as NodePacket<DesignArtifact<RegionImage>>[];
  expect(outputs).toHaveLength(2);
  const composite = outputs.find(
    (a) => a.payload.state.variant === 'strict-composite',
  )!;
  const asset = async (r: VersionRef) =>
    Buffer.from(
      await (
        await fetch(
          origin +
            `/api/v1/asset?project=${pid}&id=${r.id}&version=${r.version}`,
        )
      ).arrayBuffer(),
    );
  const outputBytes = await asset(reference(composite)),
    mask = Buffer.from(exported.mask.data, 'base64');
  expect(
    outsidePixelDifference(
      await canonicalPixels(sourceBytes),
      await canonicalPixels(outputBytes),
      mask,
    ),
  ).toEqual({ rgb: 0, alpha: 0 });
  expect(
    outsidePixelDifference(
      await canonicalPixels(sourceBytes),
      await canonicalPixels(rawBytes),
      mask,
    ).rgb,
  ).toBeGreaterThan(0);
  writeFileSync(join(evidence, 'region-source.png'), sourceBytes);
  writeFileSync(join(evidence, 'region-raw.png'), rawBytes);
  writeFileSync(join(evidence, 'region-composite.png'), outputBytes);
  const comparison = operation().locator('.region-comparison');
  // A non-default subset must survive rendering; raw stays available but unchecked.
  await comparison.locator('[name=compared]').first().uncheck();
  const nativeDecision = {
    compared: [reference(composite)],
    selected: reference(composite),
    reason:
      'AI technical fixture review: inspect finish, protected corner and hard-edge seam.',
  };
  await comparison
    .locator('[name=selected]')
    .selectOption(JSON.stringify(reference(composite)));
  await comparison.locator('[name=reason]').fill(nativeDecision.reason);
  await action('region/compare', () => comparison.getByRole('button').click());
  expect((await state()).accepted!.hero).toBeNull();
  await restoredComparison(
    reference(nativeOperation),
    nativeDecision,
    null,
    'immediate selected save',
  );
  await page.getByRole('button', { name: '04 History', exact: true }).click();
  await region();
  await restoredComparison(
    reference(nativeOperation),
    nativeDecision,
    null,
    'tab navigation',
  );
  await page.reload();
  await page.locator(`[data-action=open][data-id="${pid}"]`).click();
  await region();
  await restoredComparison(
    reference(nativeOperation),
    nativeDecision,
    null,
    'page reload',
  );
  await operation().locator('.region-compare-grid').scrollIntoViewIfNeeded();
  await noOverflow();
  await expect(operation().locator('[data-region-crop]')).toHaveCount(3);
  await expect(
    operation().locator('[data-region-crop]').first(),
  ).toHaveAttribute('data-loaded', 'true');
  expect(
    JSON.parse(
      (await operation()
        .locator('[data-region-crop]')
        .first()
        .getAttribute('data-region-crop'))!,
    ),
  ).toEqual(selection.payload.state.bounds);
  await screen('region-comparison-desktop');
  await operation()
    .locator('.region-compare-grid')
    .screenshot({
      path: join(evidence, 'region-comparison-detail-desktop.png'),
    });
  await page.setViewportSize({ width: 390, height: 844 });
  await restoredComparison(
    reference(nativeOperation),
    nativeDecision,
    null,
    'mobile selected form',
  );
  await noOverflow();
  await screen('region-comparison-mobile');
  await operation()
    .locator('.region-candidate')
    .last()
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: join(evidence, 'region-comparison-mobile-viewport.png'),
  });
  await comparison.scrollIntoViewIfNeeded();
  await comparison.locator('[name=selected]').focus();
  await comparison.locator('[name=selected]').press('Tab');
  await expect(comparison.locator('[name=reason]')).toBeFocused();
  await page.screenshot({
    path: join(evidence, 'region-saved-decision-mobile.png'),
  });
  await comparison.screenshot({
    path: join(evidence, 'region-saved-form-mobile.png'),
  });
  const accept = operation()
    .locator('.region-candidate')
    .filter({
      has: page.getByRole('heading', {
        name: 'Strict local composite',
        exact: true,
      }),
    })
    .locator('.region-accept');
  await accept
    .locator('[name=reason]')
    .fill('Explicit offline fixture decision after inspecting the composite.');
  await action('region/accept', () => accept.getByRole('button').click());
  expect((await state()).accepted!.hero).toEqual(reference(composite));
  // Rebind the same original source for a new operation; do not reuse a changed image or stale acceptance baseline.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .locator('#region-source')
    .selectOption(JSON.stringify(reference(source)));
  await prepare.locator('[name=path]').selectOption('api');
  await prepare
    .locator('[name=instructions]')
    .fill('Synthetic API finish proposal. Preserve the corner.');
  await prepare.locator('[name=reference]').check();
  const apiPrepared = await action('region/prepare', () =>
    prepare.getByRole('button', { name: 'Save regional request' }).click(),
  );
  apiOperation = apiPrepared.artifacts
    .filter(
      (a: NodePacket<DesignArtifact<unknown>>) =>
        a.payload.kind === 'website-region-operation',
    )
    .at(-1);
  await action('provider/submit', () =>
    operation()
      .getByRole('button', { name: 'Submit this regional API attempt once' })
      .click(),
  );
  await expect(async () => {
    await idle();
    await operation()
      .getByRole('button', { name: 'Refresh regional outcomes' })
      .click();
    await idle();
    await expect(
      operation().getByText('returned', { exact: true }),
    ).toBeVisible();
  }).toPass({ timeout: 15000 });
  await action('region/collect', () =>
    operation()
      .getByRole('button', { name: 'Retain result in regional comparison' })
      .click(),
  );
  const apiRaw = (await state()).artifacts!.find(
    (a) =>
      a.payload.kind === 'website-region-image' &&
      (a.payload.state as RegionImage).operation.id === apiOperation.id,
  )!;
  const apiComparison = operation().locator('.region-comparison');
  await apiComparison
    .locator('[name=selected]')
    .selectOption(JSON.stringify(reference(apiRaw)));
  await apiComparison
    .locator('[name=reason]')
    .fill('Earlier API candidate selection; still not accepted.');
  await action('region/compare', () =>
    apiComparison.getByRole('button').click(),
  );
  await restoredComparison(
    reference(apiOperation),
    {
      compared: [reference(apiRaw)],
      selected: reference(apiRaw),
      reason: 'Earlier API candidate selection; still not accepted.',
    },
    reference(composite),
    'second operation selected save',
  );
  const apiDecision = {
    compared: [reference(apiRaw)],
    selected: null,
    reason:
      'Keep this API review unresolved: inspect "finish" & seam before accepting.',
  };
  await apiComparison.locator('[name=selected]').selectOption('null');
  await apiComparison.locator('[name=reason]').fill(apiDecision.reason);
  await action('region/compare', () =>
    apiComparison.getByRole('button').click(),
  );
  await restoredComparison(
    reference(apiOperation),
    apiDecision,
    reference(composite),
    'latest unresolved save',
  );
  await action('region/compose', () =>
    operation()
      .getByRole('button', { name: 'Create strict local composite' })
      .click(),
  );
  await expect(operation().locator('[name=compared]')).toHaveCount(2);
  await restoredComparison(
    reference(apiOperation),
    apiDecision,
    reference(composite),
    'candidate appended after comparison',
  );
  await restoredComparison(
    reference(nativeOperation),
    nativeDecision,
    reference(composite),
    'other operation remains selected',
  );
  await expect(
    page
      .locator(`.region-operation[data-operation*="${nativeOperation.id}"]`)
      .getByText('Accepted section image', { exact: true }),
  ).toHaveCount(1);
  await page.getByRole('button', { name: '04 History', exact: true }).click();
  await region();
  await restoredComparison(
    reference(apiOperation),
    apiDecision,
    reference(composite),
    'two-operation tab navigation',
  );
  await restoredComparison(
    reference(nativeOperation),
    nativeDecision,
    reference(composite),
    'two-operation tab navigation',
  );
  await apiComparison.scrollIntoViewIfNeeded();
  await screen('region-saved-decisions-desktop');
  await apiComparison.screenshot({
    path: join(evidence, 'region-unresolved-form-desktop.png'),
  });
  // A fresh browser context must read persisted decisions, without renderer-local state.
  await context.close();
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  page = await context.newPage();
  listen();
  await page.goto(origin);
  await page.locator(`[data-action=open][data-id="${pid}"]`).click();
  await region();
  await restoredComparison(
    reference(apiOperation),
    apiDecision,
    reference(composite),
    'fresh browser session',
  );
  await restoredComparison(
    reference(nativeOperation),
    nativeDecision,
    reference(composite),
    'fresh browser session',
  );
  await page
    .locator('#region-source')
    .selectOption(JSON.stringify(reference(source)));
  expect(submissions).toHaveLength(1);
  expect(submissions[0]!.id).toBe(apiOperation.payload.state.execution.id);
  await page.locator('#region-select [name=shape]').selectOption('rectangle');
  await page.locator('#region-select [name=x]').fill('25');
  await page.locator('#region-select [name=y]').fill('25');
  await page.locator('#region-select [name=width]').fill('150');
  await page.locator('#region-select [name=height]').fill('150');
  await action('region/select', () =>
    page.locator('#region-select button').click(),
  );
  await expect(
    operation().locator('[data-region-crop]').first(),
  ).toHaveAttribute(
    'data-region-crop',
    JSON.stringify(selection.payload.state.bounds),
  );
  const final = await state();
  expect(final.artifacts!.find((a) => a.id === selection.id)!.version).toBe(2);
  expect(final.accepted!.hero).toEqual(reference(composite));
  expect(await asset(reference(source))).toEqual(sourceBytes);
  await context.close();
  receipts.push(await stopFixture(fixture));
  fixture = null;
  const copy = runtime + '-closed-copy';
  cpSync(runtime, copy, { recursive: true });
  fixture = await startFixture(copy, 0, 'fixture');
  origin = fixture.origin;
  context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  page = await context.newPage();
  listen();
  await page.goto(origin);
  await page.locator(`[data-action=open][data-id="${pid}"]`).click();
  await region();
  expect(await state()).toEqual(final);
  await restoredComparison(
    reference(apiOperation),
    apiDecision,
    reference(composite),
    'closed-root mobile recovery',
  );
  await restoredComparison(
    reference(nativeOperation),
    nativeDecision,
    reference(composite),
    'closed-root mobile recovery',
  );
  await noOverflow();
  await expect(
    operation().locator('[data-region-crop]').first(),
  ).toHaveAttribute(
    'data-region-crop',
    JSON.stringify(selection.payload.state.bounds),
  );
  await expect(
    operation().locator('[data-region-crop]').first(),
  ).toHaveAttribute('data-loaded', 'true');
  await screen('region-reopened-mobile');
  await page
    .locator(
      `.region-operation[data-operation*="${nativeOperation.id}"] .region-comparison`,
    )
    .screenshot({
      path: join(evidence, 'region-restored-selected-form-mobile.png'),
    });
  await page
    .locator(
      `.region-operation[data-operation*="${apiOperation.id}"] .region-comparison`,
    )
    .screenshot({
      path: join(evidence, 'region-restored-unresolved-form-mobile.png'),
    });
  expect(errors).toEqual([]);
  await context.close();
  receipts.push(await stopFixture(fixture));
  fixture = null;
  expect(receipts.map((r) => r.offlineTransportCalls)).toEqual([1, 0]);
  const result = {
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      browser: browser.version(),
    },
    desktop: [1440, 1000],
    mobile: [390, 844],
    realProviderCalls: 0,
    nativeHostCalls: 0,
    offlineTransportCalls: 1,
    shutdownCounts: [1, 0],
    submittedAttempt: submissions[0],
    source: reference(source),
    selection: reference(selection),
    nativeOperation: reference(nativeOperation),
    apiOperation: reference(apiOperation),
    outsideDifference: { rgb: 0, alpha: 0 },
    comparisonRecovery,
    pageErrors: errors,
    checks: [
      'display-coordinate mapping',
      'keyboard selection',
      'byte-exact native bundle',
      'reference role and unknown native metadata',
      'raw/composite separate',
      'outside RGB and alpha',
      'comparison does not accept',
      'saved compared subset, selection, unresolved reason and indicators restored',
      'latest comparison isolated per operation',
      'appended candidate leaves saved decision unchanged',
      'immediate, tab, reload, fresh browser and closed-root form recovery',
      'explicit acceptance',
      'API exact once',
      'source checksum unchanged',
      'desktop/mobile overflow',
      'closed-root restart equality',
      'historical crop survives revised selection and reopen',
      'no page errors',
    ],
    evidence,
    disposableRoots: [runtime, copy],
  };
  writeFileSync(
    join(evidence, 'region-browser-check.json'),
    JSON.stringify(result, null, 2) + '\n',
  );
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
  if (fixture) await stopFixture(fixture);
}
