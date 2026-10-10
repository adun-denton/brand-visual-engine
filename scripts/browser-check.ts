import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { Workspace } from '../src/service/workspace.ts';
import type { DesignArtifact, NodePacket } from '../src/kernel/contracts.ts';
import type { NativeJob } from '../src/modules/website/workspace-contracts.ts';
const runtime = mkdtempSync(join(tmpdir(), 'bve-browser-'));
const evidence = resolve(process.env['BVE_EVIDENCE_DIR'] ?? 'docs/evidence');
mkdirSync(evidence, { recursive: true });
const reservation = createServer();
reservation.listen(0, '127.0.0.1');
await once(reservation, 'listening');
const port = (reservation.address() as { port: number }).port;
await new Promise<void>((r) => reservation.close(() => r()));
const origin = 'http://127.0.0.1:' + port;
let service: ChildProcess | null = null;
async function start() {
  service = spawn(process.execPath, ['scripts/direction-fixture-service.ts'], {
    cwd: resolve(import.meta.dirname, '..'),
    env: {
      ...process.env,
      BVE_RUNTIME_ROOT: runtime,
      BVE_PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Service did not start')),
      15000,
    );
    service!.stdout!.on('data', (b) => {
      if (String(b).includes('Local workspace:')) {
        clearTimeout(timer);
        resolve();
      }
    });
    service!.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error('Service exited ' + code));
    });
  });
}
async function stop() {
  if (service) {
    service.kill('SIGTERM');
    await once(service, 'exit');
    service = null;
  }
}
await start();
const browser = await chromium.launch({
  headless: true,
  ...(process.env['BVE_CHROMIUM_EXECUTABLE']
    ? { executablePath: process.env['BVE_CHROMIUM_EXECUTABLE'] }
    : {}),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
let page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
const screen = async (name: string, fullPage = false, keepNotice = false) => {
  if (!keepNotice)
    await page.evaluate(
      () => (document.querySelector('#notice')!.textContent = ''),
    );
  await page.screenshot({ path: join(evidence, name + '.png'), fullPage });
};
const noOverflow = async () => {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
};
async function keyboardViews() {
  await page.getByRole('button', { name: '01 Brief & references' }).focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'A useful brief' }),
  ).toBeVisible();
  for (const [name, heading] of [
    ['02 Explore & compare', 'Find a direction worth pursuing.'],
    ['03 Native handoff', 'Take the request. Bring back the result.'],
    ['04 History', 'Every choice has a trail.'],
  ] as const) {
    await page.keyboard.press('Tab');
    const tab = page.getByRole('button', { name });
    await expect(tab).toBeFocused();
    await expect
      .poll(async () => {
        const box = await tab.boundingBox();
        return (
          !!box && box.x >= 0 && box.x + box.width <= page.viewportSize()!.width
        );
      })
      .toBe(true);
    expect(await tab.evaluate((el) => getComputedStyle(el).outlineWidth)).toBe(
      '3px',
    );
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    await expect(tab).toBeFocused();
  }
  await page.getByRole('button', { name: '01 Brief & references' }).click();
}
const image = join(
  resolve(import.meta.dirname, '..'),
  'fixtures/native-return.png',
);
const checksum = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex');
const referenceFile = {
  name: 'composition-reference.jpg',
  mimeType: 'image/jpeg',
  buffer: await sharp(readFileSync(image)).jpeg({ quality: 84 }).toBuffer(),
};
const returnFile = {
  name: 'synthetic-return.webp',
  mimeType: 'image/webp',
  buffer: await sharp(readFileSync(image)).webp({ quality: 81 }).toBuffer(),
};
type WorkspaceState = ReturnType<Workspace['state']>;
async function workspaceState(project: string): Promise<WorkspaceState> {
  const response = await page.request.get(
    origin + '/api/v1/workspace?project=' + encodeURIComponent(project),
  );
  expect(response.ok()).toBe(true);
  return response.json();
}
const jobOf = (s: WorkspaceState, id: string) =>
  s.artifacts!.find((a) => a.id === id) as NodePacket<
    DesignArtifact<NativeJob>
  >;
const pinned = (p: { id: string; version: number }) => ({
  id: p.id,
  version: p.version,
  freshness: 'pinned',
});
const acceptance = (s: WorkspaceState) => ({
  accepted: s.accepted,
  events: s.ledger!.events.filter((e) => e.kind === 'acceptance'),
});
async function downloadOriginal(
  label: string,
  bytes: Buffer,
  extension: string,
) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: label, exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(
    `asset-${checksum(bytes)}.${extension}`,
  );
  const path = await download.path();
  expect(path).not.toBeNull();
  expect(readFileSync(path!)).toEqual(bytes);
}
try {
  await page.addInitScript(() => { try { localStorage.setItem('bve.advanced','true'); } catch {} });
  await page.goto(origin);
  await expect(
    page.getByRole('heading', { name: 'Make intent inspectable.' }),
  ).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('link', { name: 'Skip to workspace' }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
  await screen('entry-desktop');
  await page.getByLabel('Workspace name').fill('Fictional Home Care');
  await page.getByRole('button', { name: 'Enter Website' }).click();
  await page.getByRole('button', { name: '01 Brief & references' }).click();
  await expect(
    page.getByRole('heading', { name: 'A useful brief' }),
  ).toBeVisible();
  await expect(
    page.locator('.context-field').filter({ hasText: 'palette' }),
  ).toContainText('Placeholder');
  await keyboardViews();
  // Error recovery: invalid image is visible; corrected file then saves.
  await page.locator('#add-reference input[type=file]').setInputFiles({
    name: 'invalid.png',
    mimeType: 'image/png',
    buffer: Buffer.from('invalid'),
  });
  await page.getByLabel('Label', { exact: true }).fill('Composition reference');
  await page.getByRole('button', { name: 'Attach reference' }).click();
  await expect(page.locator('#notice')).toContainText('PNG');
  await page
    .locator('#add-reference input[type=file]')
    .setInputFiles(referenceFile);
  await page.getByRole('button', { name: 'Attach reference' }).click();
  await expect(
    page.getByRole('heading', { name: 'Composition reference' }),
  ).toBeVisible();
  await downloadOriginal(
    'Download reference image',
    referenceFile.buffer,
    'jpg',
  );
  await page.evaluate(
    () => (document.querySelector('#notice')!.textContent = ''),
  );
  await page.evaluate(() => scrollTo(0, 0));
  await screen('brief-desktop');
  await noOverflow();
  await page.getByRole('button', { name: '02 Explore & compare' }).click();
  await page
    .getByRole('button', { name: 'Explore directions', exact: true })
    .click();
  await expect(page.locator('.candidate')).toHaveCount(9);
  await page.locator('[data-compare]').nth(0).check();
  await page.locator('[data-compare]').nth(1).check();
  await page
    .locator('#comparison input[name=reason]')
    .fill('Calmer structure with clear service hierarchy');
  await page
    .getByRole('button', { name: 'Save comparison', exact: true })
    .click();
  await expect(page.locator('#notice')).toContainText('Comparison saved');
  await expect(page.locator('.comparison-grid article')).toHaveCount(2);
  await page.locator('.comparison').scrollIntoViewIfNeeded();
  await page.evaluate(
    () => (document.querySelector('#notice')!.textContent = ''),
  );
  await screen('comparison-desktop');
  await noOverflow();
  await page
    .getByRole('button', { name: 'Select direction', exact: true })
    .nth(1)
    .click();
  await page
    .locator('#accept-design input')
    .fill('The spacing supports the appointment request');
  await page.getByRole('button', { name: 'Accept selected design' }).click();
  await expect(page.locator('#notice')).toContainText('accepted');
  // Reference change keeps the accepted design and saved comparison, while invalidating old current candidates.
  await page.getByRole('button', { name: '01 Brief & references' }).click();
  await page
    .locator('#references select[name="role-0"]')
    .selectOption('palette');
  await page.getByRole('button', { name: 'Save reference revision' }).click();
  await expect(page.locator('#notice')).toContainText(
    'Reference revision saved',
  );
  await page.getByRole('button', { name: '02 Explore & compare' }).click();
  await page.locator('#accept-design input').fill('This request is stale');
  await page.getByRole('button', { name: 'Accept selected design' }).click();
  await expect(page.locator('#notice')).toContainText('stale');
  await page.getByRole('button', { name: '03 Native handoff' }).click();
  await page
    .locator('#native textarea[name=instructions]')
    .fill(
      'Create an abstract home-care illustration using the selected palette reference.',
    );
  await page
    .locator('#native textarea[name=preservation]')
    .fill('Preserve palette\nDo not draw literal headings');
  await page.getByRole('button', { name: 'Create native request' }).click();
  await expect(page.locator('.job')).toHaveCount(1);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export request JSON' }).click(),
  ]);
  const exportPath = join(runtime, 'export.json');
  await download.saveAs(exportPath);
  const exported = JSON.parse(readFileSync(exportPath, 'utf8'));
  expect(exported.manifest.references[0].role).toBe('palette');
  expect(exported.manifest.settings).toBe(null);
  expect(exported.input.artifact.id).toBe(exported.manifest.artifact.id);
  const reference = exported.manifest.references[0];
  const raw = await page.request.get(
    origin +
      '/api/v1/asset?project=' +
      exported.manifest.project.id +
      '&id=' +
      reference.artifact.id +
      '&version=' +
      reference.artifact.version,
  );
  expect(
    createHash('sha256')
      .update(await raw.body())
      .digest('hex'),
  ).toBe(reference.image.checksum);
  const originalTruth = acceptance(
    await workspaceState(exported.manifest.project.id),
  );
  await page.locator('.native-import input[type=file]').setInputFiles({
    name: 'invalid.png',
    mimeType: 'image/png',
    buffer: Buffer.from('invalid native image'),
  });
  await page.getByRole('button', { name: 'Import as candidate' }).click();
  await expect(page.locator('#notice')).toContainText('PNG');
  await expect(page.locator('.outcomes')).toContainText('invalid');
  await expect(page.locator('.image-result')).toHaveCount(0);
  let current = await workspaceState(exported.manifest.project.id);
  expect(jobOf(current, exported.manifest.jobId).version).toBe(
    exported.job.version + 1,
  );
  expect(acceptance(current)).toEqual(originalTruth);
  await page.locator('.job').scrollIntoViewIfNeeded();
  await screen('native-error-desktop', true, true);
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow();
  await screen('native-error-mobile', true, true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Correct the file in the owning form, with no navigation/reload or automatic retry.
  await page
    .locator('.native-import input[type=file]')
    .setInputFiles(returnFile);
  await page.getByRole('button', { name: 'Import as candidate' }).click();
  await expect(page.locator('.image-result')).toHaveCount(1);
  current = await workspaceState(exported.manifest.project.id);
  expect(acceptance(current)).toEqual(originalTruth);
  const output = jobOf(current, exported.manifest.jobId).payload.state
    .outputs[0]!;
  expect(current.artifacts!.find((a) => a.id === output.id)!.approval).toBe(
    'proposal',
  );
  await downloadOriginal('Download original result', returnFile.buffer, 'webp');
  // Another actor advances this exact job. The old form must reject, reconcile and never retry.
  const sessionToken = (
    await (await page.request.get(origin + '/api/v1/session')).json()
  ).token;
  const previousJob = jobOf(current, exported.manifest.jobId);
  const invalidResponse = await page.request.post(origin + '/api/v1/import', {
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      'X-BVE-Token': sessionToken,
    },
    data: {
      projectId: exported.manifest.project.id,
      input: {
        job: pinned(previousJob),
        manifestProject: exported.manifest.project,
        originalArtifact: exported.manifest.artifact,
        file: Buffer.from('second invalid attempt').toString('base64'),
      },
    },
  });
  expect(invalidResponse.status()).toBe(400);
  const advanced = await workspaceState(exported.manifest.project.id);
  expect(jobOf(advanced, exported.manifest.jobId).version).toBe(
    previousJob.version + 1,
  );
  await page
    .locator('.native-import input[type=file]')
    .setInputFiles(returnFile);
  await page.getByRole('button', { name: 'Import as candidate' }).click();
  await expect(page.locator('#notice')).toContainText('Job changed');
  current = await workspaceState(exported.manifest.project.id);
  expect(current).toEqual(advanced);
  expect(
    JSON.parse(
      (await page.locator('.native-import').getAttribute('data-job')) ?? '{}',
    ),
  ).toEqual(pinned(jobOf(current, exported.manifest.jobId)));
  expect(acceptance(current)).toEqual(originalTruth);
  await page
    .locator('.native-import input[type=file]')
    .setInputFiles(returnFile);
  await page.getByRole('button', { name: 'Import as candidate' }).click();
  await expect(page.locator('.outcomes')).toContainText('duplicate');
  await expect(page.locator('.image-result')).toHaveCount(1);
  await page
    .locator('.accept-image input[name=reason]')
    .fill('Manual synthetic result matches the requested palette');
  await page.getByRole('button', { name: 'Accept section image' }).click();
  await expect(page.locator('#notice')).toContainText('accepted');
  await page.evaluate(
    () => (document.querySelector('#notice')!.textContent = ''),
  );
  await page.locator('.job').scrollIntoViewIfNeeded();
  await screen('native-desktop', true);
  // Reviewed direction proposal via real UI import, using known source refs from the exported request.
  await page.getByRole('button', { name: '02 Explore & compare' }).click();
  await page.locator('#direction input[type=file]').setInputFiles({
    name: 'direction.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        title: 'Quiet practical care',
        rationale: 'The reference suggests generous space',
        constraints: ['Keep content'],
        uncertainty: 'Needs designer evaluation',
        unresolved: ['Motion'],
        sourceReferences: exported.manifest.references.map(
          (r: { artifact: unknown }) => r.artifact,
        ),
        reviewed: true,
        source: 'Operator-reviewed synthetic native fixture',
      }),
    ),
  });
  await page.getByRole('button', { name: 'Import reviewed proposal' }).click();
  await expect(page.locator('.proposal-preview')).toContainText(
    'no brand approval',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await keyboardViews();
  await page.getByRole('button', { name: '01 Brief & references' }).click();
  await noOverflow();
  await page.evaluate(() => scrollTo(0, 0));
  await screen('brief-mobile');
  await page.getByRole('button', { name: '02 Explore & compare' }).click();
  await page.locator('.comparison').scrollIntoViewIfNeeded();
  await noOverflow();
  await screen('comparison-mobile', true);
  await page.getByRole('button', { name: '03 Native handoff' }).click();
  await page.locator('.job').scrollIntoViewIfNeeded();
  await noOverflow();
  await screen('native-mobile', true);
  // New service process and entirely new browser context; inspect current and prior decisions.
  await context.close();
  await stop();
  await start();
  const fresh = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  page = await fresh.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('bve.advanced','true'); } catch {} });
  await page.goto(origin);
  await page
    .getByRole('button', { name: 'Fictional Home Care', exact: true })
    .click();
  await page.getByRole('button', { name: '04 History' }).click();
  await expect(page.getByText('Accepted v1', { exact: true })).toHaveCount(2);
  await page
    .getByRole('button', { name: 'View this accepted version' })
    .last()
    .click();
  await expect(
    page.getByRole('heading', { name: 'Immutable accepted version 1' }),
  ).toBeVisible();
  await noOverflow();
  await page.evaluate(() => scrollTo(0, 0));
  await screen('history-restart-desktop');
  await page.getByRole('button', { name: '01 Brief & references' }).click();
  await expect(page.locator('#references select[name="role-0"]')).toHaveValue(
    'palette',
  );
  await page.getByRole('button', { name: '03 Native handoff' }).click();
  await expect(page.locator('.image-result')).toHaveCount(1);
  const session = await (
    await page.request.get(origin + '/api/v1/session')
  ).json();
  const pid = session.projects[0].id;
  const persisted = await (
    await page.request.get(origin + '/api/v1/workspace?project=' + pid)
  ).json();
  const job = persisted.artifacts.find(
    (a: { payload: { kind: string } }) =>
      a.payload.kind === 'website-native-job',
  );
  expect(job.payload.state.manifest.jobId).toBe(exported.manifest.jobId);
  expect(job.payload.state.manifest.artifact).toEqual(
    exported.manifest.artifact,
  );
  expect(job.payload.state.manifest.settings).toBe(null);
  expect(
    persisted.artifacts.find(
      (a: { payload: { kind: string } }) =>
        a.payload.kind === 'website-direction',
    ).payload.state.unresolved,
  ).toEqual(['Motion']);
  // A closed original request can record an invalid attempt and a corrected late return,
  // but reconciliation must retain its closed status and disabled acceptance.
  await page
    .locator('#native textarea[name=instructions]')
    .fill('Closed handoff recovery control');
  await page.getByRole('button', { name: 'Create native request' }).click();
  const closedJob = page
    .locator('.job')
    .filter({ hasText: 'Closed handoff recovery control' });
  await closedJob.getByRole('button', { name: 'Abandon handoff' }).click();
  await expect(closedJob.locator('.job-heading')).toContainText('abandoned');
  const closedTruth = acceptance(await workspaceState(pid));
  await closedJob.locator('input[type=file]').setInputFiles({
    name: 'invalid.webp',
    mimeType: 'image/webp',
    buffer: Buffer.from('invalid closed return'),
  });
  await closedJob.getByRole('button', { name: 'Import as candidate' }).click();
  await expect(page.locator('#notice')).toContainText('PNG');
  await expect(closedJob.locator('.outcomes')).toContainText('invalid');
  await expect(closedJob.locator('.job-heading')).toContainText('abandoned');
  await closedJob.locator('input[type=file]').setInputFiles(returnFile);
  await closedJob.getByRole('button', { name: 'Import as candidate' }).click();
  await expect(closedJob.locator('.outcomes')).toContainText('late-cancelled');
  await expect(
    closedJob.getByRole('button', { name: 'Accept section image' }),
  ).toBeDisabled();
  expect(acceptance(await workspaceState(pid))).toEqual(closedTruth);
  const savedComparison = persisted.artifacts.find(
    (a: { payload: { kind: string } }) =>
      a.payload.kind === 'website-comparison',
  );
  await page
    .getByRole('button', { name: '+ New workspace', exact: true })
    .click();
  await page.getByLabel('Workspace name').fill('Branded Fixture');
  await page.getByRole('radio', { name: 'Branded', exact: false }).check();
  await page.getByRole('button', { name: 'Enter Website' }).click();
  await page.getByRole('button', { name: '01 Brief & references' }).click();
  await expect(
    page.locator('.context-field').filter({ hasText: 'palette' }),
  ).toContainText('inherited');
  await page.evaluate(() => scrollTo(0, 0));
  await screen('context-branded-desktop');
  await page
    .getByLabel('Use mounted palette, or leave unresolved without one')
    .uncheck();
  await page
    .locator('#brief input[name=palette]')
    .fill('#183749, #fcf4e7, #d78c65');
  await page.getByRole('button', { name: 'Save brief revision' }).click();
  await expect(
    page.locator('.context-field').filter({ hasText: 'palette' }),
  ).toContainText('Local override');
  await screen('context-override-desktop');
  async function compareActive(title: string) {
    await page.getByRole('button', { name: '02 Explore & compare' }).click();
    await page
      .getByRole('button', { name: 'Explore directions', exact: true })
      .click();
    await expect(page.locator('.candidate')).toHaveCount(9);
    await expect(page.locator('[data-compare]:checked')).toHaveCount(0);
    await page.locator('[data-compare]').nth(0).check();
    await expect(page.locator('[data-compare]').nth(0)).toBeChecked();
    await page.locator('[data-compare]').nth(1).check();
    await expect(page.locator('[data-compare]:checked')).toHaveCount(2);
    await expect(page.locator('.comparison-grid article')).toHaveCount(2);
    await page
      .locator('#comparison input[name=reason]')
      .fill(`Compare only ${title} directions`);
    await page
      .getByRole('button', { name: 'Save comparison', exact: true })
      .click();
    await expect(page.locator('#notice')).toContainText('Comparison saved');
    const session = await (
      await page.request.get(origin + '/api/v1/session')
    ).json();
    const project = session.projects.find(
      (p: { payload: { localContext: { title: { override: string } } } }) =>
        p.payload.localContext.title.override === title,
    );
    const current = await workspaceState(project.id);
    const comparison = current.artifacts!.find(
      (a) => a.payload.kind === 'website-comparison',
    )!;
    expect(current.artifacts!.every((a) => a.projectId === project.id)).toBe(
      true,
    );
    return { projectId: project.id, comparison };
  }
  const brandComparison = await compareActive('Branded Fixture');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.comparison').scrollIntoViewIfNeeded();
  await noOverflow();
  await screen('second-workspace-mobile');
  await page
    .getByRole('button', { name: '+ New workspace', exact: true })
    .click();
  await page.getByLabel('Workspace name').fill('Freeroam Comparison Fixture');
  await page.getByRole('radio', { name: 'Freeroam', exact: false }).check();
  await page.getByRole('button', { name: 'Enter Website' }).click();
  await page.getByRole('button', { name: '01 Brief & references' }).click();
  await expect(
    page.locator('.context-field').filter({ hasText: 'palette' }),
  ).toContainText('Placeholder');
  await compareActive('Freeroam Comparison Fixture');
  // Every transition restores only the owning saved comparison, including returning to A.
  for (const [title, id, comparison] of [
    ['Branded Fixture', brandComparison.projectId, brandComparison.comparison],
    ['Fictional Home Care', pid, savedComparison],
  ] as const) {
    await page
      .getByRole('button', { name: '+ New workspace', exact: true })
      .click();
    await expect(page.locator('#create')).toBeVisible();
    await expect(page.locator('#app')).not.toHaveAttribute('aria-busy', 'true');
    await page.getByRole('button', { name: title, exact: true }).click();
    await expect(page.locator('.workspace-title h1')).toHaveText(title);
    await expect(page.locator('#app')).not.toHaveAttribute('aria-busy', 'true');
    await page.getByRole('button', { name: '02 Explore & compare' }).click();
    await expect(page.locator('[data-compare]:checked')).toHaveCount(2);
    await expect(page.locator('.comparison-grid article')).toHaveCount(2);
    expect(
      (await workspaceState(id)).artifacts!.find((a) => a.id === comparison.id),
    ).toEqual(comparison);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('.comparison').scrollIntoViewIfNeeded();
  await screen('comparison-restored-desktop');
  expect(errors).toEqual([]);
  const report = {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    browser: browser.version(),
    viewports: [
      { width: 1440, height: 1000 },
      { width: 390, height: 844 },
    ],
    pageErrors: errors,
    workflow:
      'keyboard Tab/Enter and visible focus at both widths, JPEG reference/WebP result original downloads, comparison, stale acceptance, invalid native outcome/corrected upload without reload, stale job rejection/read-back without retry, candidate-only import, closed/late controls, proposal/restart/history, new Branded/Freeroam comparisons and restored owning comparisons',
    nativeEvidence: 'Authored synthetic attachment; no host generation',
    fixtureSHA256: createHash('sha256')
      .update(readFileSync(image))
      .digest('hex'),
    referenceSHA256: checksum(referenceFile.buffer),
    returnSHA256: checksum(returnFile.buffer),
    runtimeRoot: 'private temporary synthetic root outside checkout',
  };
  writeFileSync(
    join(evidence, 'browser-check.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report));
  await fresh.close();
} finally {
  await browser.close();
  await stop();
}
