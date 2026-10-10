// AI technical guide rehearsal only. Fresh UI work; authored images; no live executor.
import { chromium, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  cpSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { Workspace } from '../src/service/workspace.ts';
import { reference, canonical } from '../src/kernel/packets.ts';
import type {
  NodePacket,
  DesignArtifact,
  VersionRef,
} from '../src/kernel/contracts.ts';
import type {
  NativeJob,
  ImageState,
} from '../src/modules/website/workspace-contracts.ts';
import type {
  RegionImage,
  RegionOperation,
  RegionSelection,
} from '../src/modules/website/region-contracts.ts';
import type { CompositionState } from '../src/modules/website/composition.ts';
import { canonicalPixels } from '../src/service/regions.ts';
import { outsidePixelDifference } from '../src/kernel/raster.ts';
import { startFixture, stopFixture } from './provider-browser-lifecycle.ts';
import type {
  FixtureProcess,
  FixtureReceipt,
} from './provider-browser-lifecycle.ts';

const evidence = resolve(process.env['BVE_EVIDENCE_DIR'] ?? 'docs/evidence');
mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(join(tmpdir(), 'bve-guide-rehearsal-'));
const backup = root + '-closed-copy';
const hash = (b: Buffer | string) =>
  createHash('sha256').update(b).digest('hex');
type Snapshot = ReturnType<Workspace['state']>;
const last = <T>(s: Snapshot, kind: string) =>
  s.artifacts!.filter((a) => a.payload.kind === kind).at(-1)! as NodePacket<
    DesignArtifact<T>
  >;
const steps: { name: string; elapsedMs: number; evidence: unknown }[] = [];
let stepStart = performance.now();
const record = (name: string, evidence: unknown) => {
  const now = performance.now();
  steps.push({ name, elapsedMs: Math.round(now - stepStart), evidence });
  stepStart = now;
};
const walk = (
  root: string,
  folder = root,
): { path: string; bytes: number; sha256: string }[] =>
  readdirSync(folder)
    .sort()
    .flatMap((name) => {
      const path = join(folder, name),
        s = statSync(path);
      return s.isDirectory()
        ? walk(root, path)
        : [
            {
              path: relative(root, path).split('\\').join('/'),
              bytes: s.size,
              sha256: hash(readFileSync(path)),
            },
          ];
    });
// Test the documented production entrypoint separately. Never use its signal-terminated root for backup.
async function cliStartup() {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const address = reservation.address();
  if (!address || typeof address === 'string')
    throw Error('Missing startup port');
  const port = address.port;
  await new Promise<void>((r) => reservation.close(() => r()));
  const env = {
    ...process.env,
    BVE_RUNTIME_ROOT: root + '-startup-only',
    BVE_PORT: String(port),
    OPENAI_API_KEY: '',
    BVE_PROVIDER_POLICY_FILE: '',
  };
  const child = spawn(process.execPath, ['scripts/dev.ts'], {
    cwd: resolve(import.meta.dirname, '..'),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '',
    timer: NodeJS.Timeout;
  const closed = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((r) => child.once('close', (code, signal) => r({ code, signal })));
  try {
    await Promise.race([
      new Promise<void>((r, reject) => {
        child.stdout!.on('data', (b) => {
          output += String(b);
          if (output.includes('Local workspace:')) r();
        });
        child.once('error', reject);
        void closed.then((x) =>
          reject(Error('CLI exited before readiness ' + JSON.stringify(x))),
        );
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error('CLI startup timeout')), 60000);
      }),
    ]);
    const response = await fetch(`http://127.0.0.1:${port}/`);
    expect(response.ok).toBe(true);
    expect(await response.text()).toContain('AI Design OS');
  } finally {
    clearTimeout(timer!);
    if (child.exitCode === null && child.signalCode === null)
      child.kill('SIGTERM');
    let shutdownTimer: NodeJS.Timeout;
    try {
      await Promise.race([
        closed,
        new Promise<never>((_, reject) => {
          shutdownTimer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(Error('CLI cleanup timeout'));
          }, 15000);
        }),
      ]);
    } finally {
      clearTimeout(shutdownTimer!);
    }
  }
  return {
    command: 'node scripts/dev.ts',
    runtimeRootOutsideCheckout: true,
    port,
    readOnlyPage: true,
    providerConfiguration: 'credential and policy explicitly empty',
    cleanup: await closed,
    backupBoundary: false,
    limit:
      'Windows signal termination is startup-probe cleanup, not graceful closure/backup evidence.',
  };
}
const cli = await cliStartup();
let fixture: FixtureProcess | null = await startFixture(
    root,
    0,
    'unconfigured',
  ),
  origin = fixture.origin;
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
  page: Page = await context.newPage(),
  pid = '';
const errors: string[] = [],
  submissions: string[] = [],
  receipts: FixtureReceipt[] = [],
  screens: string[] = [];
const listen = () => {
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (
      r.method() === 'POST' &&
      new URL(r.url()).pathname === '/api/v1/provider/submit'
    )
      submissions.push(r.url());
  });
};
listen();
const state = async () => {
  const r = await page.request.get(origin + '/api/v1/workspace?project=' + pid);
  expect(r.ok()).toBe(true);
  return (await r.json()) as Snapshot;
};
const idle = () =>
  expect(page.locator('#app')).not.toHaveAttribute('aria-busy', 'true');
async function action(path: string, click: () => Promise<void>) {
  await idle();
  const response = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === '/api/v1/' + path &&
      r.request().method() === 'POST',
  );
  await click();
  const r = await response;
  expect(r.ok(), await r.text()).toBe(true);
  await idle();
  return (await r.json()) as Snapshot;
}
const view = (label: string) =>
  page.getByRole('button', { name: label, exact: true }).click();
async function capture(name: string) {
  await page.evaluate(() => scrollTo(0, 0));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: join(evidence, name + '.png'),
    fullPage: true,
  });
  screens.push(name + '.png');
}
async function download(click: () => Promise<void>, name: string) {
  const pending = page.waitForEvent('download');
  await click();
  const d = await pending;
  await d.saveAs(join(evidence, name));
  expect(await d.failure()).toBeNull();
  return readFileSync(join(evidence, name));
}
const image = async (color: string, corner = '#173f45') =>
  sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#f3ede0"/><rect x="30" y="30" width="140" height="140" fill="${corner}"/><circle cx="700" cy="360" r="180" fill="${color}"/><path d="M110 810 L440 280 L780 810Z" fill="#173f45"/><rect x="60" y="900" width="904" height="70" fill="#fff"/><text x="80" y="944" font-size="26" fill="#173f45">AUTHORED REHEARSAL — NO PROVIDER CALL</text></svg>`,
    ),
  )
    .png()
    .toBuffer();
const originals: Record<string, Buffer> = {
  hero: await image('#de8159'),
  services: await image('#b49c87'),
  proof: await image('#829799'),
  contact: await image('#b9ae75'),
  replacement: await image('#719876'),
  raw: await image('#96b78c', '#de8159'),
};
const images: Record<string, VersionRef> = {};
let direction: VersionRef, regional: VersionRef, composition: VersionRef;
const file = (name: string) => ({
  name: 'authored-' + name + '.png',
  mimeType: 'image/png',
  buffer: originals[name]!,
});
const asset = async (r: VersionRef) => {
  const response = await page.request.get(
    origin + `/api/v1/asset?project=${pid}&id=${r.id}&version=${r.version}`,
  );
  expect(response.ok()).toBe(true);
  return response.body();
};
const sameUnchangedSections = (before: Snapshot, after: Snapshot) => {
  for (const id of ['services', 'proof', 'contact'] as const)
    expect(after.accepted![id]).toEqual(before.accepted![id]);
};
try {
  await page.addInitScript(() => { try { localStorage.setItem('bve.advanced','true'); } catch {} });
  await page.goto(origin);
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('link', { name: 'Skip to workspace' }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
  await page
    .getByLabel('Workspace name')
    .fill('AI technical rehearsal — synthetic home care');
  const created = await action('projects', () =>
    page.getByRole('button', { name: 'Enter Website' }).click(),
  );
  pid = created.project!.id;
  await page.getByRole('button', { name: '01 Brief & references' }).click();
  await expect(page.locator('.mode-badge')).toContainText('freeroam');
  await page.getByLabel('Design intent').fill('Small tasks. A calmer home.');
  await page
    .getByLabel('Audience', { exact: true })
    .fill('Fictional busy households');
  await page
    .getByLabel('Offer', { exact: true })
    .fill('Synthetic routine home care');
  await page.getByLabel('Intended response').fill('Book a visit');
  await page
    .locator('#brief [name=content]')
    .fill('Routine care\nSeasonal checks\nSmall repairs');
  await page
    .getByLabel('Exclusions', { exact: true })
    .fill('No real booking or service claims');
  await page.getByLabel('Brand commitments').fill('Readable hierarchy');
  await page
    .getByLabel('Unresolved choices')
    .fill('Actual designer, real contact, motion');
  await action('revise', () =>
    page.getByRole('button', { name: 'Save brief revision' }).click(),
  );
  await page
    .locator('#add-reference input[type=file]')
    .setInputFiles(file('replacement'));
  await page
    .getByLabel('Label', { exact: true })
    .fill('Authored permitted sage finish');
  await page.locator('#add-reference [name=role]').selectOption('material');
  await page.locator('#add-reference [name=scope]').selectOption('hero');
  await action('reference', () =>
    page.getByRole('button', { name: 'Attach reference' }).click(),
  );
  const originalReference = await download(
    () =>
      page
        .getByRole('link', { name: 'Download reference image', exact: true })
        .click(),
    'reference-original.png',
  );
  expect(originalReference).toEqual(originals.replacement);
  await capture('guide-brief-desktop');
  record('fresh UI brief/reference entry', {
    project: reference((await state()).project!),
    referenceHash: hash(originalReference),
    seededStore: false,
  });
  await view('02 Explore & compare');
  await page.locator('#explore [name=count]').selectOption('3');
  await action('explore', () =>
    page
      .getByRole('button', { name: 'Explore directions', exact: true })
      .click(),
  );
  await page.locator('[data-compare]').nth(0).check();
  await page.locator('[data-compare]').nth(1).check();
  const rejection =
    'AI technical rehearsal: reject Direction 1 for this synthetic brief; select Direction 2 for clearer hierarchy. Designer judgment pending.';
  await page.locator('#comparison [name=reason]').fill(rejection);
  await action('revise', () => page.locator('#comparison button').click());
  await action('select', () =>
    page
      .locator('.candidate')
      .nth(1)
      .getByRole('button', { name: 'Select direction', exact: true })
      .click(),
  );
  expect((await state()).accepted!.design).toBeNull();
  await page
    .locator('#accept-design [name=reason]')
    .fill('AI synthetic technical choice only; human usefulness pending.');
  await action('accept', () =>
    page.getByRole('button', { name: 'Accept selected design' }).click(),
  );
  direction = (await state()).accepted!.design!;
  await capture('guide-direction-rejection');
  record(
    'comparison/rejection reason, provisional selection and separate acceptance',
    { direction, rejection },
  );
  async function importImage(
    scope: 'hero' | 'services' | 'proof' | 'contact',
    key: string,
  ) {
    await view('03 Native handoff');
    await page
      .locator('#native [name=artifact]')
      .selectOption(JSON.stringify(direction));
    await page.locator('#native [name=scope]').selectOption(scope);
    await page
      .locator('#native [name=instructions]')
      .fill('AI rehearsal authored ' + key + ' import; no host generation.');
    await page
      .locator('#native [name=preservation]')
      .fill('Keep other section assets and original bytes.');
    const snapshot = await action('native', () =>
      page.getByRole('button', { name: 'Create native request' }).click(),
    );
    const job = last<NativeJob>(snapshot, 'website-native-job');
    const panel = page.locator('.job').filter({
      hasText: 'AI rehearsal authored ' + key + ' import; no host generation.',
    });
    const exported = JSON.parse(
      (
        await download(
          () =>
            panel.getByRole('button', { name: 'Export request JSON' }).click(),
          'native-' + key + '.json',
        )
      ).toString(),
    );
    expect(exported.manifest.model).toBeNull();
    expect(exported.manifest.settings).toBeNull();
    expect(exported.manifest.scope).toBe(scope);
    await panel.locator('input[type=file]').setInputFiles(file(key));
    const result = await action('import', () =>
      panel
        .getByRole('button', { name: 'Import as candidate', exact: true })
        .click(),
    );
    const a = last<ImageState>(result, 'website-image');
    expect(result.accepted![scope]).toEqual(snapshot.accepted![scope]);
    expect(await asset(reference(a))).toEqual(originals[key]);
    await panel
      .locator('.accept-image [name=reason]')
      .fill(
        'Accept authored ' +
          key +
          ' for synthetic technical rehearsal; not designer approval.',
      );
    await action('accept', () =>
      panel.getByRole('button', { name: 'Accept section image' }).click(),
    );
    images[key] = reference(a);
    return {
      job: reference(job),
      image: reference(a),
      checksum: hash(originals[key]!),
    };
  }
  const imported = [];
  for (const scope of ['hero', 'services', 'proof', 'contact'] as const)
    imported.push(await importImage(scope, scope));
  const beforeReplace = await state();
  await importImage('hero', 'replacement');
  sameUnchangedSections(beforeReplace, await state());
  expect(await asset(images.hero!)).toEqual(originals.hero);
  await view('05 Images & assistant');
  await expect(page.locator('.provider-config')).toContainText(
    'API credentials unconfigured',
  );
  await expect(page.locator('.provider-config')).toContainText(
    'No approved run budget',
  );
  const compare = page.locator('#image-comparison');
  await compare
    .locator('[name=first]')
    .selectOption(JSON.stringify(images.hero));
  await compare
    .locator('[name=second]')
    .selectOption(JSON.stringify(images.replacement));
  await compare.locator('[name=selected]').selectOption('second');
  await compare
    .locator('[name=reason]')
    .fill('AI technical replacement comparison; both originals retained.');
  await action('provider/compare', () => compare.getByRole('button').click());
  const apiPrepare = page.locator('#provider-prepare');
  await apiPrepare.locator('[name=operation]').selectOption('generate');
  await apiPrepare
    .locator('[name=artifact]')
    .selectOption(JSON.stringify(direction));
  await apiPrepare
    .locator('[name=instructions]')
    .fill('AI rehearsal queued preparation only; do not submit.');
  await action('provider/prepare', () =>
    apiPrepare.getByRole('button', { name: 'Save immutable request' }).click(),
  );
  await expect(page.locator('[data-action=provider-submit]')).toBeDisabled();

  await capture('guide-section-replacement');
  record('four native fixture imports and isolated hero replacement', {
    imported,
    oldHero: images.hero,
    newHero: images.replacement,
    untouchedSections: true,
    hostCalls: 0,
    apiCalls: 0,
  });
  await view('06 Regional edit');
  await page
    .locator('#region-source')
    .selectOption(JSON.stringify(images.replacement));
  await expect(page.locator('#region-select button')).toBeEnabled();
  await page.locator('#region-select [name=shape]').selectOption('rectangle');
  for (const [key, value] of Object.entries({
    x: 510,
    y: 165,
    width: 390,
    height: 410,
  }))
    await page.locator(`#region-select [name=${key}]`).fill(String(value));
  await action('region/select', () =>
    page.locator('#region-select button').click(),
  );
  const selection = last<RegionSelection>(
    await state(),
    'website-region-selection',
  );
  expect(selection.payload.state.source).toEqual(images.replacement);
  const prepare = page.locator('#region-prepare');
  await prepare
    .locator('[name=instructions]')
    .fill(
      'Authored raw fixture changes finish and corner; strict composite must restore outside.',
    );
  await prepare.locator('[name=reference]').check();
  await action('region/prepare', () =>
    prepare.getByRole('button', { name: 'Save regional request' }).click(),
  );
  const operation = page.locator('.region-operation').first(),
    bundle = JSON.parse(
      (
        await download(
          () =>
            operation
              .getByRole('button', {
                name: 'Export source / mask / references bundle',
              })
              .click(),
          'regional-bundle.json',
        )
      ).toString(),
    );
  expect(Buffer.from(bundle.files[0].data, 'base64')).toEqual(
    originals.replacement,
  );
  expect(bundle.native.manifest.model).toBeNull();
  await operation.locator('input[type=file]').setInputFiles(file('raw'));
  await action('import', () =>
    operation
      .getByRole('button', { name: 'Import regional raw candidate' })
      .click(),
  );
  await action('region/collect', () =>
    operation
      .getByRole('button', { name: 'Retain result in regional comparison' })
      .click(),
  );
  await action('region/compose', () =>
    operation
      .getByRole('button', { name: 'Create strict local composite' })
      .click(),
  );
  const results = (await state()).artifacts!.filter(
    (a) => a.payload.kind === 'website-region-image',
  ) as NodePacket<DesignArtifact<RegionImage>>[];
  const composite = results.find(
    (a) => a.payload.state.variant === 'strict-composite',
  )!;
  regional = reference(composite);
  const compositeBytes = await asset(regional),
    mask = Buffer.from(bundle.mask.data, 'base64');
  const strictDiff = outsidePixelDifference(
      await canonicalPixels(originals.replacement!),
      await canonicalPixels(compositeBytes),
      mask,
    ),
    rawDiff = outsidePixelDifference(
      await canonicalPixels(originals.replacement!),
      await canonicalPixels(originals.raw!),
      mask,
    );
  expect(strictDiff).toEqual({ rgb: 0, alpha: 0 });
  expect(rawDiff.rgb).toBeGreaterThan(0);
  const rcomparison = operation.locator('.region-comparison');
  await rcomparison
    .locator('[name=selected]')
    .selectOption(JSON.stringify(regional));
  const regionalReason =
    'AI technical rehearsal: raw outside drift rejected; strict hard-edge composite selected, seam/designer review remains pending.';
  await rcomparison.locator('[name=reason]').fill(regionalReason);
  await action('region/compare', () => rcomparison.getByRole('button').click());
  const beforeRegional = await state();
  const acceptedPanel = operation
    .locator('.region-candidate')
    .filter({ hasText: 'Strict local composite' });
  await acceptedPanel
    .locator('[name=reason]')
    .fill(
      'AI technical acceptance of strict composite; zero outside changes; unresolved designer seam review.',
    );
  await action('region/accept', () =>
    acceptedPanel
      .getByRole('button', { name: 'Accept this exact regional candidate' })
      .click(),
  );
  sameUnchangedSections(beforeRegional, await state());
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(
      operation.locator('[data-region-crop]').first(),
    ).toHaveAttribute('data-loaded', 'true');
    await capture('guide-regional-' + width);
  }
  record('bound native region/raw/strict comparison and explicit acceptance', {
    selection: reference(selection),
    operation: reference(
      last<RegionOperation>(await state(), 'website-region-operation'),
    ),
    regional,
    rawDiff,
    strictDiff,
    reason: regionalReason,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await view('07 Compose page');
  await page
    .locator('#composition-start [name=direction]')
    .selectOption(JSON.stringify(direction));
  await action('composition/start', () =>
    page.getByRole('button', { name: 'Start composition' }).click(),
  );
  async function place(scope: string, chosen: VersionRef) {
    const section = page.locator(`.composition-section[data-section=${scope}]`);
    if ((await section.locator('select[name$="-asset"]').count()) === 0) {
      await section.locator('[id^=composition-add]').selectOption('image');
      await section
        .getByRole('button', { name: 'Add block to ' + scope })
        .click();
    }
    await section
      .locator('select[name$="-asset"]')
      .selectOption(JSON.stringify(chosen));
    await section
      .locator('input[name$="-alt"]')
      .fill('Authored synthetic ' + scope + ' image');
    await section.locator('input[name$="-unresolved"]').fill('');
  }
  for (const scope of ['hero', 'services', 'proof', 'contact'])
    await place(scope, scope === 'hero' ? regional : images[scope]!);
  await page
    .locator('#composition-editor [name=title]')
    .fill('AI rehearsal: fictional home care');
  await page
    .locator('#composition-editor [name=reason]')
    .fill(
      'Place exact owned authored assets; preserve unresolved real contact and designer choices.',
    );
  await action('composition/save', () =>
    page.getByRole('button', { name: 'Save immutable draft' }).click(),
  );
  const proof = page.locator('.composition-section[data-section=proof]');
  await proof.locator('details summary').click();
  await proof.locator('[name$="-spacing"]').fill('72');
  await action('composition/save', () =>
    page.getByRole('button', { name: 'Save immutable draft' }).click(),
  );
  await action('composition/review', () =>
    page.getByRole('button', { name: 'Record section review' }).click(),
  );
  const reviewed = last<CompositionState>(await state(), 'website-composition');
  await page
    .locator('#composition-editor [name=global-spacing]')
    .fill(String(reviewed.payload.state.content.style.spacing + 8));
  await action('composition/save', () =>
    page.getByRole('button', { name: 'Save immutable draft' }).click(),
  );
  let a = last<CompositionState>(await state(), 'website-composition');
  expect(a.payload.state.reviews.proof).toBeDefined();
  expect(a.payload.state.reviews.hero).toBeUndefined();
  await expect(
    page.locator('.composition-section[data-section=proof] h3'),
  ).toContainText('Reviewed');
  await expect(
    page.locator('.composition-section[data-section=hero] h3'),
  ).toContainText('Needs review');
  const preview = await context.newPage();
  preview.on('pageerror', (e) => errors.push(e.message));
  for (const width of [1440, 390]) {
    await preview.setViewportSize({ width, height: 1000 });
    await preview.goto(
      origin +
        `/api/v1/composition/preview?project=${pid}&id=${a.id}&version=${a.version}`,
    );
    await expect(preview.locator('img')).toHaveCount(4);
    expect(
      await preview
        .locator('img')
        .evaluateAll((xs) =>
          xs.every(
            (x) =>
              (x as HTMLImageElement).complete &&
              (x as HTMLImageElement).naturalWidth > 0,
          ),
        ),
    ).toBe(true);
    expect(
      await preview.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
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
    await expect.poll(() => new URL(preview.url()).hash).toBe('#main');
    await preview.keyboard.press('Tab');
    await expect(
      preview.getByRole('link', { name: 'Book a visit' }),
    ).toBeFocused();
    await preview.screenshot({
      path: join(evidence, 'guide-page-' + width + '.png'),
      fullPage: true,
    });
    screens.push('guide-page-' + width + '.png');
  }
  await preview.close();
  await page
    .locator('#composition-review [name=reason]')
    .fill(
      'AI technical desktop/narrow review; authored fixtures; real contact, motion and designer acceptance unresolved.',
    );
  await action('composition/review', () =>
    page.getByRole('button', { name: 'Record section review' }).click(),
  );
  await page
    .locator('#composition-compare [name=reason]')
    .fill(
      'AI rehearsal exact page revisions; proof override preserved after global spacing change.',
    );
  await page.locator('#composition-compare [name=selected]').check();
  await action('composition/compare', () =>
    page.locator('#composition-compare button').click(),
  );
  expect((await state()).accepted!.composition).toBeNull();
  await page
    .locator('#composition-accept [name=reason]')
    .fill(
      'AI technical accept exact synthetic page; no designer/real-contact/motion approval.',
    );
  await action('composition/accept', () =>
    page.getByRole('button', { name: 'Accept exact composition' }).click(),
  );
  composition = (await state()).accepted!.composition!;
  const handoff = await download(
    () => page.getByRole('link', { name: /Download accepted handoff/ }).click(),
    'guide-accepted-handoff.tar',
  );
  await capture('guide-accepted-controls');
  record(
    'page editing/override/global review, comparison and exact accepted handoff',
    {
      composition,
      handoffSHA256: hash(handoff),
      bytes: handoff.length,
      proofOverrideSurvived: true,
    },
  );
  const before = await state(),
    beforeAccepted = canonical(before.accepted),
    beforeArtifacts = canonical(before.artifacts),
    beforeLedger = canonical(before.ledger);
  await context.close();
  receipts.push(await stopFixture(fixture));
  fixture = null;
  const inventory = walk(root),
    inventoryHash = hash(JSON.stringify(inventory));
  cpSync(root, backup, { recursive: true, errorOnExist: true, force: false });
  expect(walk(backup)).toEqual(inventory);
  writeFileSync(
    join(evidence, 'closed-root-inventory.json'),
    JSON.stringify(
      {
        root,
        backup,
        matchingCode:
          process.env['BVE_CANDIDATE_COMMIT'] ??
          'local working tree based on418cc8d',
        inventorySHA256: inventoryHash,
        files: inventory,
      },
      null,
      2,
    ) + '\n',
  );
  fixture = await startFixture(backup, 0, 'unconfigured');
  origin = fixture.origin;
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  page = await context.newPage();
  listen();
  await page.addInitScript(() => { try { localStorage.setItem('bve.advanced','true'); } catch {} });
  await page.goto(origin);
  await page.locator(`[data-action=open][data-id="${pid}"]`).click();
  await view('01 Brief & references');
  await expect(page.getByLabel('Design intent')).toHaveValue(
    'Small tasks. A calmer home.',
  );
  await expect(
    page.getByRole('heading', { name: 'Authored permitted sage finish' }),
  ).toBeVisible();
  await view('02 Explore & compare');
  await expect(page.locator('.comparison-grid')).toContainText('Small tasks.');
  await view('04 History');
  await expect(page.locator('.saved-direction-comparisons')).toContainText(
    rejection,
  );
  await capture('guide-reopened-direction-reason');
  const directionComparison = last<{ reason: string }>(
    await state(),
    'website-comparison',
  );
  expect(directionComparison.payload.state.reason).toBe(rejection);
  await view('06 Regional edit');
  await expect(page.locator('.region-comparison [name=selected]')).toHaveValue(
    JSON.stringify(regional),
  );
  await expect(page.locator('.region-comparison [name=reason]')).toHaveValue(
    regionalReason,
  );
  await expect(
    page
      .locator('.region-candidate')
      .filter({ hasText: 'Strict local composite' }),
  ).toContainText('Accepted section image');
  await view('07 Compose page');
  await page.getByRole('button', { name: 'Open accepted revision' }).click();
  await expect(page.locator('#composition-status')).toContainText(
    'Explicitly accepted',
  );
  await expect(page.locator('#composition-editor [name=title]')).toHaveValue(
    'AI rehearsal: fictional home care',
  );
  await expect(
    page.locator('.composition-section[data-section=proof] [name$="-spacing"]'),
  ).toHaveValue('72');
  const restored = await download(
    () => page.getByRole('link', { name: /Download accepted handoff/ }).click(),
    'guide-restored-handoff.tar',
  );
  expect(restored).toEqual(handoff);
  for (const [name, r] of Object.entries(images))
    expect(await asset(r)).toEqual(originals[name]);
  expect(await asset(regional)).toEqual(compositeBytes);
  const after = await state();
  expect(canonical(after.accepted)).toBe(beforeAccepted);
  expect(canonical(after.artifacts)).toBe(beforeArtifacts);
  expect(canonical(after.ledger)).toBe(beforeLedger);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await capture('guide-reopened-' + width);
  }
  await context.close();
  receipts.push(await stopFixture(fixture));
  fixture = null;
  expect(
    receipts.every(
      (r) => r.offlineTransportCalls === 0 && r.realProviderCalls === 0,
    ),
  ).toBe(true);
  expect(submissions).toEqual([]);
  expect(errors).toEqual([]);
  record('graceful full-root copy and actual visible recovery', {
    inventorySHA256: inventoryHash,
    files: inventory.length,
    restoredHandoffSHA256: hash(restored),
    originalsVerified: 6,
    acceptedAndHistoryUnchanged: true,
  });
  const receipt = {
    check: 'phase-A-guide-rehearsal',
    assessment:
      'AI technical rehearsal; no designer judgment or owner disposition',
    candidate:
      process.env['BVE_CANDIDATE_COMMIT'] ??
      'local working tree based on418cc8d',
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    browser: browser.version(),
    guide: 'docs/operator-guide.md',
    cli,
    seededStore: false,
    authoredFixtures: Object.entries(originals).map(([name, b]) => ({
      name,
      sha256: hash(b),
      bytes: b.length,
    })),
    project: pid,
    direction: direction!,
    regional: regional!,
    composition: composition!,
    steps,
    screens,
    errors,
    providerReceipts: receipts,
    realProviderCalls: 0,
    nativeHostCalls: 0,
    apiSubmissions: submissions.length,
    generationTime:
      'No generation call occurred; step elapsedMs includes authored-image preparation and automated UI review, not a provider latency or human timing.',
    humanRubric: 'blank',
    ownerDecisions: 'pending',
    backup: {
      root,
      copy: backup,
      inventorySHA256: inventoryHash,
      matchingCodeRequired: true,
    },
    handoff: {
      sha256: hash(handoff),
      bytes: handoff.length,
      restoredEqual: true,
    },
    limits: [
      'Chromium technical rehearsal only; actual designer/brief/references, license and release pending.',
      'Test-only IPC confirms app/store closure; production CLI startup probe signal cleanup is separate.',
      'No live account/model/usage/billing or power-loss durability claim.',
    ],
  };
  writeFileSync(
    join(evidence, 'readiness-browser-check.json'),
    JSON.stringify(receipt, null, 2) + '\n',
  );
  console.log(JSON.stringify(receipt));
} catch (e) {
  // The rehearsal closes its context before some backup/receipt assertions. Diagnostics
  // must preserve the original error rather than replace it with a closed-page exception.
  const failure = {
    error: String(e),
    stack: e instanceof Error ? e.stack : null,
    errors,
    submissions,
    steps,
    notice: page.isClosed() ? null : await page.locator('#notice').textContent().catch(() => null),
  };
  console.error('Readiness failure:', JSON.stringify(failure));
  writeFileSync(
    join(evidence, 'readiness-failure.json'),
    JSON.stringify(failure, null, 2) + '\n',
  );
  throw e;
} finally {
  await context.close().catch(() => {});
  await browser.close();
  if (fixture) await stopFixture(fixture);
}
