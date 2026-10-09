import { chromium, expect } from '@playwright/test';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  cpSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { Workspace } from '../src/service/workspace.ts';
import { seedComposition } from './composition-fixture.ts';
import { startFixture, stopFixture } from './provider-browser-lifecycle.ts';
import type {
  FixtureProcess,
  FixtureReceipt,
} from './provider-browser-lifecycle.ts';
import type { CompositionState } from '../src/modules/website/composition.ts';
import type {
  NodePacket,
  DesignArtifact,
  VersionRef,
} from '../src/kernel/contracts.ts';
const runtime = mkdtempSync(join(tmpdir(), 'bve-composition-browser-')),
  evidence = resolve(process.env['BVE_EVIDENCE_DIR'] ?? 'docs/evidence');
mkdirSync(evidence, { recursive: true });
const w = new Workspace(runtime),
  seed = await seedComposition(w),
  pid = seed.project.id;
w.close();
let fixture: FixtureProcess | null = await startFixture(runtime, 0, 'fixture'),
  origin = fixture.origin;
const receipts: FixtureReceipt[] = [],
  errors: string[] = [];
const browser = await chromium.launch({
  headless: true,
  ...(process.env['BVE_CHROMIUM_EXECUTABLE']
    ? { executablePath: process.env['BVE_CHROMIUM_EXECUTABLE'] }
    : {}),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
let context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  }),
  page = await context.newPage();
page.on('pageerror', (e) => errors.push(e.message));
const state = async () => {
  const r = await page.request.get(origin + '/api/v1/workspace?project=' + pid);
  expect(r.ok()).toBe(true);
  return r.json();
};
const composition = async (): Promise<
  NodePacket<DesignArtifact<CompositionState>>
> => {
  const s = await state();
  return s.artifacts
    .filter(
      (a: NodePacket<DesignArtifact<unknown>>) =>
        a.payload.kind === 'website-composition',
    )
    .at(-1);
};
const ptr = (p: { id: string; version: number }): VersionRef => ({
  id: p.id,
  version: p.version,
  freshness: 'pinned',
});
const previewUrl = (p: { id: string; version: number }) =>
  origin +
  `/api/v1/composition/preview?project=${pid}&id=${p.id}&version=${p.version}`;
const open = async () => {
  await page.goto(origin);
  await page
    .getByRole('button', { name: 'Fieldwork composition fixture', exact: true })
    .click();
  await page.getByRole('button', { name: '07 Compose page' }).click();
};
const submit = async (id: string, button: string) => {
  const response = page.waitForResponse(
    (r) =>
      r.url().includes('/api/v1/composition/') &&
      r.request().method() === 'POST',
  );
  await page
    .locator('#' + id)
    .getByRole('button', { name: button, exact: true })
    .click();
  const r = await response;
  expect(r.ok(), await r.text()).toBe(true);
  await expect(page.locator('#app')).not.toHaveAttribute('aria-busy', 'true');
};
const noOverflow = async () =>
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
const savedVisible = async (text: string) => {
  await expect(page.locator('[name="s0-b0-text"]')).toHaveValue(text);
  await expect(page.locator('#composition-status')).toContainText(
    'Explicitly accepted',
  );
  await expect(page.locator('#composition-comparisons')).toContainText(
    'Compare final exact revision against the initial draft',
  );
  await expect(page.locator('[name="s2-spacing"]')).toHaveValue('72');
  await expect(page.locator('[name="global-spacing"]')).toHaveValue('80');
};
const downloadable = async (name: string) => {
  const download = page.waitForEvent('download');
  await page.locator('#composition-export').click();
  const d = await download,
    path = join(evidence, name);
  await d.saveAs(path);
  expect(await d.failure()).toBeNull();
  return readFileSync(path);
};
let final: NodePacket<DesignArtifact<CompositionState>>, packageBytes: Buffer;
const screens: unknown[] = [];
try {
  await open();
  await page
    .locator('#composition-start select')
    .selectOption(JSON.stringify(seed.direction));
  await submit('composition-start', 'Start composition');
  const initial = await composition();
  expect((await state()).accepted.composition).toBeNull();
  await page
    .locator('[name="s0-b0-text"]')
    .fill('Small tasks. More time at home.');
  await page.locator('[name="global-spacing"]').fill('80');
  await page.locator('[data-section="proof"] summary').click();
  await page.locator('[name="s2-spacing"]').fill('72');
  for (const [i, section] of [
    'hero',
    'services',
    'proof',
    'contact',
  ].entries()) {
    if (i > 0) {
      await page.locator(`#composition-add-${i}`).selectOption('image');
      await page.locator(`[data-block-add="${i}"]`).click();
    }
    const row = page
      .locator(`[data-section="${section}"] .composition-block`)
      .filter({ has: page.locator('select[name$="-asset"]') });
    await row
      .locator('select')
      .selectOption(
        JSON.stringify(
          seed.assets[section as 'hero' | 'services' | 'proof' | 'contact'],
        ),
      );
    await row
      .getByLabel('Alt text', { exact: true })
      .fill('Synthetic geometric home-care illustration: ' + section);
    await row
      .getByLabel('Unresolved image/accessibility note', { exact: true })
      .fill('');
  }
  // Exercise add/move/remove controls without changing the bounded four-section scope.
  await page.locator('#composition-add-1').selectOption('paragraph');
  await page.locator('[data-block-add="1"]').click();
  await page
    .locator('[data-section="services"] .composition-block')
    .last()
    .getByLabel('Text', { exact: true })
    .fill('Visible synthetic services detail.');
  await page.locator('[data-block-move="1,3"][data-offset="-1"]').click();
  await page.locator('[data-block-move="1,2"][data-offset="1"]').click();
  await page.locator('[data-section-move="2"][data-offset="-1"]').click();
  await page.locator('[data-section-move="1"][data-offset="1"]').click();
  await submit('composition-editor', 'Save immutable draft');
  const placed = await composition();
  expect(placed.version).toBe(initial.version + 1);
  await page.getByRole('button', { name: '01 Brief & references' }).click();
  await page.getByRole('button', { name: '07 Compose page' }).click();
  await expect(page.locator('[name="s0-b0-text"]')).toHaveValue(
    'Small tasks. More time at home.',
  );
  await page.reload();
  await page
    .getByRole('button', { name: 'Fieldwork composition fixture', exact: true })
    .click();
  await page.getByRole('button', { name: '07 Compose page' }).click();
  await expect(page.locator('[name="s1-b3-text"]')).toHaveValue(
    'Visible synthetic services detail.',
  );
  await submit('composition-review', 'Record section review');
  expect((await state()).accepted.composition).toBeNull();
  await submit('composition-accept', 'Accept exact composition');
  const accepted = await composition();
  // Replace the hero only using an exact owned alternative, with untouched reviewed sections.
  await page
    .locator('[name="s0-b3-asset"]')
    .selectOption(JSON.stringify(seed.assets.replacement));
  await page
    .locator('[name="s0-b0-text"]')
    .fill('Small tasks. A calmer home, together.');
  await submit('composition-editor', 'Save immutable draft');
  let candidate = await composition();
  expect((await state()).accepted.composition).toEqual(ptr(accepted));
  expect(candidate.payload.state.reviews.hero).toBeUndefined();
  for (const section of ['services', 'proof', 'contact'] as const) {
    expect(candidate.payload.state.reviews[section]).toEqual(
      accepted.payload.state.reviews[section],
    );
    expect(
      candidate.payload.state.content.sections.find((s) => s.id === section),
    ).toEqual(
      accepted.payload.state.content.sections.find((s) => s.id === section),
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow();
  await page.locator('#composition-width').click();
  await expect(page.locator('#composition-preview')).toHaveClass(/narrow/);
  await page
    .locator('[name="s1-b3-text"]')
    .fill('Visible services edit saved at 390 pixels.');
  await submit('composition-editor', 'Save immutable draft');
  candidate = await composition();
  expect(candidate.payload.state.reviews.services).toBeUndefined();
  await page.screenshot({
    path: join(evidence, 'composition-narrow-controls.png'),
  });
  await submit('composition-review', 'Record section review');
  await submit('composition-accept', 'Accept exact composition');
  final = await composition();
  await page
    .locator('#composition-compare [name="first"]')
    .fill(String(initial.version));
  await page
    .locator('#composition-compare [name="second"]')
    .fill(String(final.version));
  await page
    .locator('#composition-compare [name="reason"]')
    .fill('Compare final exact revision against the initial draft');
  await page.locator('#composition-compare [name="selected"]').check();
  await submit('composition-compare', 'Save comparison');
  await savedVisible('Small tasks. A calmer home, together.');
  await noOverflow();
  // Open historical version through controls; this must not reset silently to the latest draft.
  await page
    .locator('#composition-load [name="version"]')
    .fill(String(initial.version));
  await submitLoad();
  await expect(page.locator('#composition-status')).toContainText(
    'Historical revision',
  );
  await expect(page.locator('[name="s0-b0-text"]')).toHaveValue(
    'Small tasks. A calmer home.',
  );
  await page.locator('#composition-open-accepted').click();
  await savedVisible('Small tasks. A calmer home, together.');
  packageBytes = await downloadable('composition-handoff.tar');
  const hash = createHash('sha256').update(packageBytes).digest('hex');
  const packageResponse = await page.request.get(
    origin +
      `/api/v1/composition/export?project=${pid}&id=${final.id}&version=${final.version}`,
  );
  expect(packageResponse.headers()['x-bve-package-sha256']).toBe(hash);
  for (const width of [1440, 390]) {
    const preview = await context.newPage();
    preview.on('pageerror', (e) => errors.push(e.message));
    await preview.setViewportSize({ width, height: 1000 });
    await preview.goto(previewUrl(final));
    await expect(preview.getByRole('heading', { level: 1 })).toHaveText(
      'Small tasks. A calmer home, together.',
    );
    expect(
      await preview
        .locator('main section')
        .evaluateAll((xs) => xs.map((x) => x.id)),
    ).toEqual(['hero', 'services', 'proof', 'contact']);
    expect(
      await preview.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(preview.locator('img')).toHaveCount(4);
    for (const image of await preview.locator('img').all())
      expect(
        await image.evaluate(
          (img: HTMLImageElement) => img.complete && img.naturalWidth === 720,
        ),
      ).toBe(true);
    await preview.keyboard.press('Tab');
    await expect(
      preview.getByRole('link', { name: 'Skip to content' }),
    ).toBeFocused();
    expect(
      await preview
        .getByRole('link', { name: 'Skip to content' })
        .evaluate((el) => getComputedStyle(el).outlineWidth),
    ).toBe('3px');
    await preview.keyboard.press('Enter');
    await preview.getByRole('link', { name: 'Book a visit' }).click();
    expect(new URL(preview.url()).hash).toBe('#contact');
    const styling = await preview.locator('main section').evaluateAll((xs) =>
      xs.map((el) => ({
        id: el.id,
        color: getComputedStyle(el).color,
        background: getComputedStyle(el).backgroundColor,
        padding: getComputedStyle(el).paddingTop,
        font: getComputedStyle(el).fontSize,
      })),
    );
    screens.push({
      width,
      order: ['hero', 'services', 'proof', 'contact'],
      images: 4,
      overflow: false,
      styles: styling,
    });
    await preview.screenshot({
      path: join(evidence, `composition-page-${width}.png`),
      fullPage: true,
    });
    await preview.close();
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: '02 Explore & compare' }).click();
  const direction = page.locator('.candidate').nth(1);
  await direction.screenshot({
    path: join(evidence, 'composition-selected-direction.png'),
  });
  await page.getByRole('button', { name: '07 Compose page' }).click();
  await page.locator('#composition-status').scrollIntoViewIfNeeded();
  await page.screenshot({
    path: join(evidence, 'composition-desktop-controls.png'),
  });
  // Real graceful service closure and closed-copy boundary; reopen with a fresh browser/session token.
  receipts.push(await stopFixture(fixture));
  fixture = null;
  const copied = runtime + '-copy';
  cpSync(runtime, copied, { recursive: true });
  await context.close();
  fixture = await startFixture(copied, 0, 'fixture');
  origin = fixture.origin;
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await open();
  await savedVisible('Small tasks. A calmer home, together.');
  await expect(page.locator('[name="s1-b3-text"]')).toHaveValue(
    'Visible services edit saved at 390 pixels.',
  );
  expect((await state()).accepted.composition).toEqual(ptr(final));
  expect(await downloadable('composition-restored-handoff.tar')).toEqual(
    packageBytes,
  );
  await page.reload();
  await page
    .getByRole('button', { name: 'Fieldwork composition fixture', exact: true })
    .click();
  await page.getByRole('button', { name: '07 Compose page' }).click();
  await savedVisible('Small tasks. A calmer home, together.');
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow();
  await page.screenshot({
    path: join(evidence, 'composition-restored-visible.png'),
  });
  receipts.push(await stopFixture(fixture));
  fixture = null;
  expect(
    receipts.every(
      (r) => r.realProviderCalls === 0 && r.offlineTransportCalls === 0,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  const receipt = {
    check: 'composition-browser',
    node: process.version,
    platform: process.platform,
    browser: browser.version(),
    widths: [1440, 390],
    errors,
    providerReceipts: receipts,
    composition: ptr(final),
    packageSHA256: hash,
    packageBytes: packageBytes.length,
    assetInventory: final.payload.state.content.sections.flatMap((s) =>
      s.blocks
        .filter((b) => b.image)
        .map((b) => ({ section: s.id, artifact: b.asset, ...b.image })),
    ),
    checks: [
      'direction selection',
      'visible edits/save/navigation/reload',
      'block add/reorder',
      'section reorder',
      'override/global dependency review',
      'explicit acceptance separation',
      'local hero replacement with section isolation',
      '390px visible edit',
      'saved comparison and historical controls',
      'keyboard skip/action/focus',
      'responsive order/overflow/images',
      'accepted download',
      'gracefully closed copy visible recovery',
      'restored byte-identical download',
    ],
    screens,
    assessment: 'AI technical assessment; no designer approval',
    directionExceptions: [
      'Synthetic raster imagery replaces abstract CSS shapes.',
      'Editable blocks and navigation extend the initial direction.',
      'Proof uses an explicit 72px spacing override; global spacing is 80px.',
      'Motion remains unresolved; no animation or live booking service.',
      'Proof keeps the locked base background rather than the direction preview’s derived tint.',
      'System typography follows the pinned context; the direction mini-preview uses a decorative serif heading.',
    ],
    reconstruction: {
      status: 'pending coordinator execution',
      reason:
        'No separately approved model/executor supplied; package prepared under Task005 fallback.',
    },
  };
  writeFileSync(
    join(evidence, 'composition-browser-check.json'),
    JSON.stringify(receipt, null, 2) + '\n',
  );
  console.log(JSON.stringify(receipt));
} catch (error) {
  console.error(
    JSON.stringify({
      pageErrors: errors,
      notice: await page.locator('#notice').textContent(),
    }),
  );
  await page.screenshot({ path: join(evidence, 'composition-failure.png') });
  throw error;
} finally {
  await context.close();
  await browser.close();
  if (fixture) await stopFixture(fixture);
}
async function submitLoad() {
  await page.locator('#composition-load button').click();
  await expect(page.locator('#composition-status')).toContainText(
    'Historical revision',
  );
}
