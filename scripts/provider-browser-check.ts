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
import { createServer } from 'node:net';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { Workspace } from '../src/service/workspace.ts';
import type {
  DesignArtifact,
  NodePacket,
  IterationBundle,
  VersionRef,
} from '../src/kernel/contracts.ts';
import type {
  ProviderJob,
  ApiImage,
} from '../src/modules/website/provider-contracts.ts';
import { reference } from '../src/kernel/packets.ts';
const runtime = mkdtempSync(join(tmpdir(), 'bve-provider-browser-')),
  evidence = resolve(process.env['BVE_EVIDENCE_DIR'] ?? 'docs/evidence');
mkdirSync(evidence, { recursive: true });
const reservation = createServer();
reservation.listen(0, '127.0.0.1');
await once(reservation, 'listening');
const port = (reservation.address() as { port: number }).port;
await new Promise<void>((r) => reservation.close(() => r()));
const origin = 'http://127.0.0.1:' + port;
let service: FixtureProcess | null = null;
let transportCalls = 0;
const shutdownReceipts: FixtureReceipt[] = [];
async function start(mode: string) {
  service = await startFixture(runtime, port, mode);
  expect(service.origin).toBe(origin);
}
async function stop() {
  if (service) {
    const stopped = service;
    service = null;
    const receipt = await stopFixture(stopped);
    shutdownReceipts.push(receipt);
    transportCalls += receipt.offlineTransportCalls;
  }
}
await start('unconfigured');
const browser = await chromium
  .launch({
    headless: true,
    ...(process.env['BVE_CHROMIUM_EXECUTABLE']
      ? { executablePath: process.env['BVE_CHROMIUM_EXECUTABLE'] }
      : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  .catch(async (e) => {
    await stop();
    throw e;
  });
let context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  }),
  page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
let pid = '';
const submissionRequests: VersionRef[] = [];
page.on('request', (request) => {
  if (
    request.method() === 'POST' &&
    new URL(request.url()).pathname === '/api/v1/provider/submit'
  )
    submissionRequests.push(request.postDataJSON().input.job as VersionRef);
});
let releasePreparation!: () => void;
const preparationDelivery = new Promise<void>((resolve) => {
  releasePreparation = resolve;
});
let preparationHeld!: (attempt: VersionRef) => void;
const heldPreparation = new Promise<VersionRef>((resolve) => {
  preparationHeld = resolve;
});
let successfulPreparations = 0;
// Deliberately hold the second successful prepare response while the old queued job is visible.
// Release is controlled by assertions, not elapsed time or an arbitrary sleep.
await page.route('**/api/v1/provider/prepare', async (route) => {
  const response = await route.fetch();
  if (response.ok() && ++successfulPreparations === 2) {
    const snapshot = (await response.json()) as ReturnType<Workspace['state']>;
    const attempt = snapshot
      .artifacts!.filter((a) => a.payload.kind === 'website-provider-job')
      .at(-1)!;
    preparationHeld(reference(attempt));
    await preparationDelivery;
  }
  await route.fulfill({ response });
});
async function state() {
  return (await (
    await fetch(origin + '/api/v1/workspace?project=' + pid)
  ).json()) as ReturnType<Workspace['state']>;
}
const screen = async (name: string) => {
  if (!name.includes('stale-error'))
    await page.evaluate(() => {
      document.querySelector('#notice')!.textContent = '';
    });
  if (name.includes('comparison') || name.includes('reopened'))
    await page
      .locator('.comparison')
      .screenshot({ path: join(evidence, name + '.png') });
  else if (name.includes('assistant'))
    await page
      .locator('.assistant-proposal')
      .screenshot({ path: join(evidence, name + '.png') });
  else if (name.includes('rate-limit'))
    await lastJob().screenshot({ path: join(evidence, name + '.png') });
  else {
    await page.locator('.provider-config').scrollIntoViewIfNeeded();
    await page.screenshot({
      path: join(evidence, name + '.png'),
      fullPage: false,
    });
  }
};
const noOverflow = async () =>
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
const apiView = async () => {
  await page.getByRole('button', { name: '05 Images & assistant' }).click();
  await expect(
    page.getByRole('heading', {
      name: 'Images & design assistant',
      exact: true,
    }),
  ).toBeVisible();
};
const lastJob = () => page.locator('.api-job').last();
const jobRow = (attempt: VersionRef) =>
  page.locator(`.api-job[data-attempt=${JSON.stringify(attempt.id)}]`);
const idle = () =>
  expect(page.locator('#app')).not.toHaveAttribute('aria-busy', 'true');
async function prepare(
  operation: string,
  instructions: string,
  artifact?: string,
  referenceInput = false,
): Promise<VersionRef> {
  await idle();
  const previousIds = await page
    .locator('.api-job')
    .evaluateAll((rows) =>
      rows.map((row) => (row as HTMLElement).dataset['attempt']!),
    );
  const f = page.locator('#provider-prepare');
  await f.locator('[name=operation]').selectOption(operation);
  await f.locator('[name=instructions]').fill(instructions);
  if (artifact) await f.locator('[name=artifact]').selectOption(artifact);
  if (referenceInput) await f.locator('[name=reference]').first().check();
  else
    for (const box of await f.locator('[name=reference]').all())
      await box.uncheck();
  const prepared = page.waitForResponse(
    (response) => {
      const request = response.request();
      if (
        request.method() !== 'POST' ||
        new URL(response.url()).pathname !== '/api/v1/provider/prepare'
      )
        return false;
      const body = request.postDataJSON();
      return (
        body.projectId === pid &&
        body.input.operation === operation &&
        body.input.instructions === instructions
      );
    },
    { timeout: 15000 },
  );
  await f.getByRole('button', { name: 'Save immutable request' }).click();
  const response = await prepared;
  expect(response.ok()).toBe(true);
  const snapshot = (await response.json()) as ReturnType<Workspace['state']>;
  const created = snapshot.artifacts!.filter(
    (a) =>
      a.payload.kind === 'website-provider-job' && !previousIds.includes(a.id),
  );
  expect(created).toHaveLength(1);
  const attempt = reference(created[0]!);
  const job = created[0]!.payload.state as ProviderJob;
  expect(job.request.project.id).toBe(pid);
  expect(job.request.attemptId).toBe(attempt.id);
  expect(job.request.operation).toBe(operation);
  expect(job.request.instructions).toBe(instructions);
  expect(job.status).toBe('queued');
  await expect(page.locator('.api-job')).toHaveCount(previousIds.length + 1);
  await expect(
    jobRow(attempt).getByText('queued', { exact: true }),
  ).toBeVisible();
  await idle();
  expect(
    JSON.parse(
      (await jobRow(attempt)
        .getByRole('button', { name: 'Submit this API attempt' })
        .getAttribute('data-job'))!,
    ),
  ).toEqual(attempt);
  return attempt;
}
async function submit(attempt: VersionRef, expected = 'returned') {
  await idle();
  const button = jobRow(attempt).getByRole('button', {
    name: 'Submit this API attempt',
  });
  expect(JSON.parse((await button.getAttribute('data-job'))!)).toEqual(attempt);
  await expect(button).toBeEnabled();
  const submitted = page.waitForResponse(
    (response) => {
      const request = response.request();
      if (
        request.method() !== 'POST' ||
        new URL(response.url()).pathname !== '/api/v1/provider/submit'
      )
        return false;
      const body = request.postDataJSON();
      return (
        body.projectId === pid &&
        body.input.job.id === attempt.id &&
        body.input.job.version === attempt.version
      );
    },
    { timeout: 15000 },
  );
  await button.click(); // Exactly one submission; only read-only refresh is polled below.
  expect((await submitted).ok()).toBe(true);
  await idle();
  await expect(async () => {
    await idle();
    const refreshed = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        new URL(response.url()).pathname === '/api/v1/workspace' &&
        new URL(response.url()).searchParams.get('project') === pid,
      { timeout: 15000 },
    );
    await page
      .getByRole('button', { name: 'Refresh provider outcomes' })
      .click();
    expect((await refreshed).ok()).toBe(true);
    await idle();
    await expect(
      jobRow(attempt).getByText(expected, { exact: true }),
    ).toBeVisible();
  }).toPass({ timeout: 15000 });
}
try {
  await page.goto(origin);
  await page.locator('#create [name=title]').fill('Synthetic provider studio');
  await page.getByRole('button', { name: 'Enter Website' }).click();
  await expect(
    page.getByRole('heading', { name: 'A useful brief' }),
  ).toBeVisible();
  pid = await page.evaluate(
    () =>
      document.querySelector<HTMLButtonElement>('.project.active')!.dataset[
        'id'
      ]!,
  );
  await page.getByRole('button', { name: '02 Explore & compare' }).click();
  await page
    .getByRole('button', { name: 'Explore directions', exact: true })
    .click();
  await expect(page.locator('.candidate')).toHaveCount(9);
  await apiView();
  await expect(page.getByText(/API credentials unconfigured/)).toBeVisible();
  const unconfiguredAttempt = await prepare(
    'assistant',
    'Synthetic unconfigured request',
  );
  await expect(
    jobRow(unconfiguredAttempt).getByRole('button', {
      name: 'Submit this API attempt',
    }),
  ).toBeDisabled();
  await screen('providers-unconfigured-desktop');
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow();
  await screen('providers-unconfigured-mobile');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await stop();
  await start('fixture');
  await page.reload();
  await page
    .getByRole('button', { name: 'Synthetic provider studio', exact: true })
    .click();
  const file = join(runtime, 'authored-reference.png');
  const referenceBytes = await sharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#173f45"/><circle cx="650" cy="350" r="180" fill="#de8159"/><text x="90" y="910" font-size="40" fill="#f3ede0">AUTHORED NATIVE / REFERENCE FIXTURE</text></svg>',
    ),
  )
    .png()
    .toBuffer();
  writeFileSync(file, referenceBytes);
  await page.getByRole('button', { name: '01 Brief & references' }).click();
  const add = page.locator('#add-reference');
  await add.locator('[name=file]').setInputFiles(file);
  await add.locator('[name=label]').fill('Authored composition reference');
  await add.locator('[name=scope]').selectOption('hero');
  await add.getByRole('button', { name: 'Attach reference' }).click();
  await expect(page.locator('.reference-card')).toHaveCount(1);
  await apiView();
  await jobRow(unconfiguredAttempt)
    .getByRole('button', { name: 'Submit this API attempt' })
    .click();
  await expect(page.locator('#notice')).toContainText('Project changed');
  await screen('providers-stale-error-desktop');
  let preparationCompleted = false;
  let heldAttempt!: VersionRef;
  const preparingAssistant = prepare(
    'assistant',
    'Propose a quiet synthetic direction',
    undefined,
    true,
  ).then((result) => {
    preparationCompleted = true;
    return result;
  });
  try {
    heldAttempt = await Promise.race([
      heldPreparation,
      preparingAssistant.then(() => heldPreparation),
    ]);
    await expect(page.locator('#app')).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('.api-job')).toHaveCount(1);
    await expect(lastJob().getByText('queued', { exact: true })).toBeVisible();
    expect(submissionRequests).toHaveLength(1); // Earlier intentional stale rejection only.
    const persisted = await state();
    const jobs = persisted.artifacts!.filter(
      (a) => a.payload.kind === 'website-provider-job',
    );
    expect(jobs).toHaveLength(2);
    expect(jobs.map((a) => (a.payload.state as ProviderJob).status)).toEqual([
      'queued',
      'queued',
    ]);
    expect(
      jobs.every(
        (a) => (a.payload.state as ProviderJob).observations.length === 0,
      ),
    ).toBe(true);
    expect(jobs.at(-1)!.id).toBe(heldAttempt.id);
    expect(preparationCompleted).toBe(false);
  } finally {
    releasePreparation();
  }
  const assistantAttempt = await preparingAssistant;
  expect(assistantAttempt).toEqual(heldAttempt);
  await submit(assistantAttempt);
  expect(submissionRequests).toEqual([unconfiguredAttempt, assistantAttempt]);
  const assistantState = await state();
  const oldJob = assistantState.artifacts!.find(
    (a) => a.id === unconfiguredAttempt.id,
  )!.payload.state as ProviderJob;
  const returnedAssistant = assistantState.artifacts!.find(
    (a) => a.id === assistantAttempt.id,
  )!.payload.state as ProviderJob;
  expect(oldJob.status).toBe('queued');
  expect(oldJob.observations).toEqual([]);
  expect(returnedAssistant.status).toBe('returned');
  expect(returnedAssistant.outputs).toHaveLength(1);
  expect(
    returnedAssistant.observations.filter((o) => o.kind === 'result'),
  ).toHaveLength(1);
  const review = jobRow(assistantAttempt).locator('.assistant-review');
  await review
    .locator('[name=rationale]')
    .fill('Human edited: keep a calm composition and test heading contrast.');
  await review
    .locator('[name=reason]')
    .fill('Reviewed fixture uncertainty; visual judgment remains open');
  await review.getByRole('button', { name: 'Record my edited review' }).click();
  await expect(
    page.getByRole('heading', { name: 'Human reviewed: Quiet, useful care' }),
  ).toBeVisible();
  await screen('providers-assistant-desktop');
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow();
  await screen('providers-assistant-mobile');
  await page.setViewportSize({ width: 1440, height: 1000 });
  const current = await state(),
    first = (current.bundles!.at(-1) as NodePacket<IterationBundle>).payload
      .candidates[0]!;
  const generationAttempt = await prepare(
    'generate',
    'Generate an authored offline fixture',
    JSON.stringify(first),
  );
  await submit(generationAttempt);
  let currentState = await state();
  const gen = currentState.artifacts!.find(
      (a) => a.id === generationAttempt.id,
    ) as NodePacket<DesignArtifact<ProviderJob>>,
    generated = gen.payload.state.outputs[0]!;
  // Retained native path: UI creates its original manifest and explicitly imports original bytes.
  await page.getByRole('button', { name: '03 Native handoff' }).click();
  const nf = page.locator('#native');
  await nf.locator('[name=artifact]').selectOption(JSON.stringify(first));
  await nf
    .locator('[name=instructions]')
    .fill('Native authored fixture for same-section comparison');
  await nf.getByRole('button', { name: 'Create native request' }).click();
  const native = page.locator('.job').last();
  await native.locator('.native-import [name=file]').setInputFiles(file);
  await native.getByRole('button', { name: 'Import as candidate' }).click();
  await expect(native.locator('.image-result')).toHaveCount(1);
  currentState = await state();
  const nativeImage = currentState
    .artifacts!.filter((a) => a.payload.kind === 'website-image')
    .at(-1)!;
  await apiView();
  const editAttempt = await prepare(
    'edit',
    'Refine using an owned input and selected reference',
    JSON.stringify(generated),
    true,
  );
  await submit(editAttempt);
  currentState = await state();
  const edit = currentState.artifacts!.find(
      (a) => a.id === editAttempt.id,
    ) as NodePacket<DesignArtifact<ProviderJob>>,
    edited = edit.payload.state.outputs[0]!;
  const compare = page.locator('#image-comparison');
  await compare
    .locator('[name=first]')
    .selectOption(JSON.stringify(reference(nativeImage)));
  await compare.locator('[name=second]').selectOption(JSON.stringify(edited));
  await compare.locator('[name=selected]').selectOption('second');
  await compare
    .locator('[name=reason]')
    .fill(
      'Compare authored native/API transport fixtures; select the second image',
    );
  await compare
    .getByRole('button', { name: 'Save image comparison / selection' })
    .click();
  await expect(page.locator('.comparison-grid .image-preview')).toHaveCount(2);
  await screen('providers-comparison-desktop');
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow();
  await screen('providers-comparison-mobile');
  await page.setViewportSize({ width: 1440, height: 1000 });
  const accept = jobRow(editAttempt).locator('.accept-image');
  await accept
    .locator('[name=reason]')
    .fill('Explicitly accept this synthetic API candidate');
  await accept
    .getByRole('button', { name: 'Accept API section image' })
    .click();
  currentState = await state();
  expect(currentState.accepted!.hero).toEqual(edited);
  const downloadEvent = page.waitForEvent('download');
  await jobRow(editAttempt)
    .getByRole('link', { name: 'Download API original' })
    .click();
  const download = await downloadEvent,
    path = join(runtime, 'api-original-download.png');
  await download.saveAs(path);
  const downloadedHash = createHash('sha256')
    .update(readFileSync(path))
    .digest('hex');
  const result = currentState.artifacts!.find((a) => a.id === edited.id)!
    .payload.state as ApiImage;
  expect(downloadedHash).toBe(result.image.checksum);
  const rateLimitAttempt = await prepare('assistant', 'fixture rate limit');
  await submit(rateLimitAttempt, 'failed');
  await expect(
    jobRow(rateLimitAttempt).getByText('rate-limit', { exact: true }),
  ).toBeVisible();
  await screen('providers-rate-limit-desktop');
  await page.getByRole('button', { name: '05 Images & assistant' }).focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('button', { name: '05 Images & assistant' }),
  ).toBeFocused();
  const before = await state();
  await context.close();
  await stop();
  cpSync(runtime, runtime + '-closed-copy', { recursive: true });
  await start('fixture');
  context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(origin);
  await page
    .getByRole('button', { name: 'Synthetic provider studio', exact: true })
    .click();
  await apiView();
  await noOverflow();
  await expect(page.locator('.comparison-grid .image-preview')).toHaveCount(2);
  await expect(
    page.getByRole('heading', { name: 'Human reviewed: Quiet, useful care' }),
  ).toBeVisible();
  const after = await state();
  expect(after.accepted).toEqual(before.accepted);
  expect(after.artifacts).toEqual(before.artifacts);
  expect(after.ledger).toEqual(before.ledger);
  await screen('providers-reopened-mobile');
  expect(errors).toEqual([]);
  await stop();
  expect(transportCalls).toBe(4);
  expect(shutdownReceipts.map((r) => r.offlineTransportCalls)).toEqual([
    0, 4, 0,
  ]);
  expect(shutdownReceipts.every((r) => r.realProviderCalls === 0)).toBe(true);
  expect(submissionRequests).toEqual([
    unconfiguredAttempt,
    assistantAttempt,
    generationAttempt,
    editAttempt,
    rateLimitAttempt,
  ]);
  expect(new Set(submissionRequests.map((a) => a.id)).size).toBe(5);
  const receipt =
    JSON.stringify(
      {
        runtime: process.version,
        platform: process.platform,
        architecture: process.arch,
        browser: browser.version(),
        desktop: '1440x1000',
        mobile: '390x844',
        realProviderCalls: 0,
        offlineTransportCalls: transportCalls,
        shutdown:
          'acknowledged test-only IPC; stores closed and child/stdio completed',
        shutdownReceipts,
        preparationSynchronization: {
          delayedResponse:
            'second successful preparation held until old-queued/busy/no-submit assertions complete',
          previousQueuedAttempt: unconfiguredAttempt,
          preparedAttempt: assistantAttempt,
          submissionRequests,
          intendedAssistantSubmissions: submissionRequests.filter(
            (a) => a.id === assistantAttempt.id,
          ).length,
          preparedAttemptReturned: returnedAssistant.status,
          staleAttemptUnchanged:
            oldJob.status === 'queued' && oldJob.observations.length === 0,
        },
        checks: [
          'unconfigured disabled submit',
          'stale request actionable error',
          'delayed prepare with old queued job; exact returned identity and idle before one submission',
          'five distinct HTTP submissions: one intentional stale rejection and four fixture calls',
          'text/vision fixture and human edited review',
          'generation/edit serialized adapter fixture',
          'manual native import unchanged',
          'same-section native/API comparison and explicit selection',
          'separate acceptance',
          'download original SHA-256',
          'rate limit without retry',
          'keyboard active-tab focus',
          'no horizontal overflow',
          'new process/context restart',
          'closed whole-root copy',
          'three acknowledged graceful IPC closes with exact transport counts',
          'reasoning-plus-final-message browser assistant',
          'accepted/artifact/ledger read-back equality',
        ],
        downloadChecksum: downloadedHash,
        pageErrors: errors,
      },
      null,
      2,
    ) + '\n';
  writeFileSync(join(evidence, 'provider-browser-check.json'), receipt);
  console.log('Provider browser evidence receipt:\n' + receipt);
  console.log(
    'Provider browser checks passed; offline transport only, 0 real provider calls.',
  );
} finally {
  releasePreparation();
  try {
    await context.close();
  } finally {
    try {
      await browser.close();
    } finally {
      await stop();
    }
  }
}
