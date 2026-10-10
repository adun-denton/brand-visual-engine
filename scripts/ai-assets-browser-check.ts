// Mechanical UI rehearsal. This authored response is not actual AI/provider evidence.
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
import { startApp } from '../src/service/server.ts';
import type { RunningApp } from '../src/service/server.ts';
import { aiFixture } from './ai-direction-fixture.ts';
import { syntheticCompositionImage } from './composition-fixture.ts';
import { reference } from '../src/kernel/packets.ts';
import type {
  NodePacket,
  DesignArtifact,
  ModuleProject,
} from '../src/kernel/contracts.ts';
import type { WebsiteDesignState } from '../src/modules/website/design.ts';
import { parseSpec } from '../src/modules/website/ai-contracts.ts';
const evidence = resolve(process.env['BVE_EVIDENCE_DIR'] ?? 'docs/evidence'),
  root = mkdtempSync(join(tmpdir(), 'bve-ai-browser-'));
mkdirSync(evidence, { recursive: true });
const hash = (b: Buffer | string) =>
  createHash('sha256').update(b).digest('hex');
let app: RunningApp | null = await startApp(root, 0, undefined, undefined, {
  aiResponseFixture: true,
});
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
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
const view = async (name: string) => {
  console.log("AI-assets view:", name);
  await page.getByRole('button', { name, exact: true }).click();
};
const submit = async (selector: string, message: string) => {
  console.log("AI-assets submit:", selector);
  await page
    .locator(selector + ' button')
    .last()
    .click();
  // A repeated operation can leave the same notice visible while the next request runs.
  // Wait for the application action (including rendering) before reading its outcome.
  await expect(page.locator('#app')).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#notice')).toContainText(message);
};
const overflow = async () => {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
};
const download = async (selector: string, name: string) => {
  const event = page.waitForEvent('download');
  void event.catch(() => {});
  await page.locator(selector).click();
  const d = await event;
  const p = join(evidence, name);
  await d.saveAs(p);
  return readFileSync(p);
};
try {
  await page.addInitScript(() => { try { localStorage.setItem('bve.advanced','true'); } catch {} });
  await page.goto(app.origin);
  await page.locator('#create [name=title]').fill('AI asset loop rehearsal');
  await page.locator('#create button[type=submit]').click();
  await expect(page.locator('.workspace-title h1')).toHaveText(
    'AI asset loop rehearsal',
  );
  const p = app.workspace.state().projects[0]! as NodePacket<ModuleProject>;
  const pid = p.id;
  await view('02  Explore & compare');
  await page.locator('#explore [name=count]').selectOption('1');
  await submit('#explore', 'AI direction request saved');
  expect(app.workspace.state(pid).bundles!.length).toBe(0);
  const requestBytes = await download(
    '.ai-request a',
    'ai-direction-request.json',
  );
  const q = JSON.parse(requestBytes.toString()) as {
    request: unknown;
    count: number;
  };
  expect(q.count).toBe(1);
  await submit('.ai-api-prepare', 'API direction request saved');
  await view('05  Images & assistant');
  await expect(page.locator('.api-job')).toContainText('directions');
  await expect(page.locator('[data-action=provider-submit]')).toBeDisabled();
  await view('02  Explore & compare');
  const response = aiFixture(p, 1);
  writeFileSync(
    join(evidence, 'authored-mechanical-response.json'),
    JSON.stringify(response, null, 2) + '\n',
  );
  await page
    .locator('.ai-import [name=file]')
    .setInputFiles(join(evidence, 'authored-mechanical-response.json'));
  await page
    .locator('.ai-import [name=source]')
    .fill('Authored mechanical browser fixture; no AI call');
  await page.locator('.ai-import [name=authorship]').check();
  await submit('.ai-import', 'AI candidates applied');
  await page.locator('.candidate [data-action=select]').click();
  await expect(page.locator('#notice')).toContainText('Direction selected');
  await page
    .locator('#accept-design [name=reason]')
    .fill('Synthetic exact direction acceptance; no designer evaluation');
  await submit('#accept-design', 'accepted');
  const first = app.workspace
    .state(pid)
    .artifacts!.find((a) => a.payload.kind === 'website-design')!;
  await view('03  Native handoff');
  await expect(page.locator('#native [name=artifact]')).toHaveValue(
    JSON.stringify(reference(first)),
  );
  await expect(page.locator('#native [name=instructions]')).toHaveValue(
    response.candidates[0]!.imageNeeds[0]!.prompt,
  );
  await page.locator('#native [name=scope]').selectOption('services');
  await expect(page.locator('#native [name=instructions]')).toHaveValue(
    response.candidates[0]!.imageNeeds[1]!.prompt,
  );
  await page
    .locator('#native [name=instructions]')
    .fill('Explicit override retained in immutable request.');
  await submit('#native', 'Original request and input binding saved');
  expect(
    app.workspace
      .state(pid)
      .artifacts!.find((a) => a.payload.kind === 'website-native-job')!.payload
      .state,
  ).toMatchObject({
    manifest: {
      instructions: 'Explicit override retained in immutable request.',
    },
  });
  await view('05  Images & assistant');
  await expect(page.locator('#provider-prepare [name=artifact]')).toHaveValue(
    JSON.stringify(reference(first)),
  );
  await expect(page.locator('#provider-prepare [name=size]')).toHaveValue(
    '1536x1024',
  );
  expect(app.providers.status().configured).toBe(false);
  // Second AI-authored fixture request provides another context, without modifying first acceptance.
  await view('02  Explore & compare');
  await page.locator('#explore [name=count]').selectOption('1');
  await submit('#explore', 'AI direction request saved');
  const secondResponse = aiFixture(p, 2);
  secondResponse.candidates = [secondResponse.candidates[1]!];
  writeFileSync(
    join(evidence, 'second-mechanical-response.json'),
    JSON.stringify(secondResponse, null, 2) + '\n',
  );
  const pending = page.locator('.ai-import').last();
  await pending
    .locator('[name=file]')
    .setInputFiles(join(evidence, 'second-mechanical-response.json'));
  await pending
    .locator('[name=source]')
    .fill('Authored second mechanical fixture; no AI call');
  await pending.locator('[name=authorship]').check();
  await pending.locator('button').click();
  await expect(page.locator('#notice')).toContainText('AI candidates applied');
  await view('08  Project assets');
  const bytes = await syntheticCompositionImage();
  writeFileSync(join(evidence, 'supplied-original.png'), bytes);
  await page
    .locator('#asset-add [name=file]')
    .setInputFiles(join(evidence, 'supplied-original.png'));
  await page
    .locator('#asset-add [name=label]')
    .fill('Reusable synthetic original');
  await page
    .locator('#asset-add [name=permission]')
    .fill('Authored synthetic raster; no private reference or AI image claim.');
  await submit('#asset-add', 'Exact asset added');
  await expect(page.locator('.direction-place button')).toBeDisabled();
  await page.locator('.asset-role [name=role]').selectOption('placeable');
  await submit('.asset-role', 'New asset role revision');
  const place = async (index: number) => {
    const choices = await page
      .locator('.direction-place [name=target] option')
      .evaluateAll((os) =>
        os.map((o) => ({
          value: (o as HTMLOptionElement).value,
          text: o.textContent,
        })),
      );
    const target = choices.find((o) =>
      o.text!.startsWith('Authored test direction ' + (index + 1)),
    )!;
    await page
      .locator('.direction-place [name=target]')
      .selectOption(target.value);
    await page
      .locator('.direction-place [name=alt]')
      .fill('Authored synthetic shapes for mechanical rehearsal');
    await page
      .locator('.direction-place [name=reason]')
      .fill('Compare exact same original bytes in this direction');
    await submit('.direction-place', 'New direction placement revision');
  };
  await place(0);
  await place(1);
  const designs = app.workspace
    .state(pid)
    .artifacts!.filter(
      (a) => a.payload.kind === 'website-design',
    ) as NodePacket<DesignArtifact<WebsiteDesignState>>[];
  expect(
    designs.map(
      (d) =>
        parseSpec(d.payload.state.parameters['ai']).page.sections[0]!.blocks.at(
          -1,
        )!.image!.checksum,
    ),
  ).toEqual([hash(bytes), hash(bytes)]);
  expect(app.workspace.state(pid).accepted!.design).toEqual(reference(first));
  await page.locator('.asset-history summary').count();
  await page.getByText('Version history', { exact: true }).click();
  await submit('.asset-history', 'New direction placement revision');
  await expect(page.locator('.asset-history-result')).toContainText(
    'Exact v1 · reference',
  );
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await overflow();
    await page.screenshot({
      path: join(evidence, `assets-${width}.png`),
      fullPage: true,
    });
  }
  await view('02  Explore & compare');
  const rounds = await page
    .locator('#round option')
    .evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
  for (const round of rounds) {
    await page.locator('#round').selectOption(round);
    await page.locator('.candidate [data-compare]').check();
  }
  await page
    .locator('#comparison [name=reason]')
    .fill('Exact same owned bytes compared under both structured directions.');
  await submit('#comparison', 'Comparison saved');
  await expect(page.locator('.comparison-grid iframe')).toHaveCount(2);
  const direct = await context.newPage();
  for (const width of [1440, 390]) {
    await direct.setViewportSize({ width, height: 1000 });
    await direct.goto(
      app.origin +
        `/api/v1/direction/preview?project=${pid}&id=${designs[0]!.id}&version=${designs[0]!.version}`,
    );
    await expect(direct.locator('img')).toBeVisible();
    expect(
      await direct.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await direct.keyboard.press('Tab');
    await expect(
      direct.getByRole('link', { name: 'Skip to content' }),
    ).toBeFocused();
    await direct.screenshot({
      path: join(evidence, `direction-page-${width}.png`),
      fullPage: true,
    });
    await direct.goto(
      app.origin +
        `/api/v1/direction/preview?project=${pid}&id=${designs[1]!.id}&version=${designs[1]!.version}`,
    );
    await expect(direct.locator('img')).toBeVisible();
    await direct.screenshot({
      path: join(evidence, `alternate-direction-page-${width}.png`),
      fullPage: true,
    });
  }
  await direct.close();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await overflow();
    const iframe = page.frameLocator('.ai-direction-preview iframe').first();
    await expect(iframe.locator('img')).toBeVisible();
    expect(
      await iframe
        .locator('img')
        .evaluate(
          (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
        ),
    ).toBe(true);
    await page
      .locator('.ai-direction-preview')
      .first()
      .screenshot({ path: join(evidence, `direction-${width}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await view('07  Compose page');
  await page
    .locator('#composition-start [name=direction]')
    .selectOption(JSON.stringify(reference(designs[0]!)));
  await submit('#composition-start', 'composition draft');
  await page
    .locator('#composition-editor [name=title]')
    .fill('Visible AI page edit survives reopen');
  await submit('#composition-editor', 'draft');
  expect(app.workspace.state(pid).accepted!.composition).toBe(null);
  await submit('#composition-review', 'review');
  await submit('#composition-accept', 'accepted');
  const accepted = app.workspace.state(pid).accepted!.composition!;
  const pkg = await download('#composition-export', 'accepted-ai-handoff.tar');
  expect(pkg.includes(Buffer.from(hash(bytes) + '.png'))).toBe(true);
  expect(pkg.includes(Buffer.from('provider-budget'))).toBe(false);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.locator('#composition-width').click();
    await overflow();
    await page.screenshot({ path: join(evidence, `composition-${width}.png`) });
  }
  await page.reload();
  await page
    .getByRole('button', { name: 'AI asset loop rehearsal', exact: true })
    .click();
  await view('07  Compose page');
  await expect(page.locator('#composition-editor [name=title]')).toHaveValue(
    'Visible AI page edit survives reopen',
  );
  console.log("AI-assets closing original runtime");
  await app.close();
  console.log("AI-assets original runtime closed");
  app = null;
  const copy = root + '-closed-copy';
  cpSync(root, copy, { recursive: true });
  app = await startApp(copy, 0, undefined, undefined, {
    aiResponseFixture: true,
  });
  await page.addInitScript(() => { try { localStorage.setItem('bve.advanced','true'); } catch {} });
  await page.goto(app.origin);
  await page
    .getByRole('button', { name: 'AI asset loop rehearsal', exact: true })
    .click();
  await view('07  Compose page');
  await expect(page.locator('#composition-editor [name=title]')).toHaveValue(
    'Visible AI page edit survives reopen',
  );
  await expect(page.locator('#composition-status')).toContainText(
    'Explicitly accepted',
  );
  expect(
    await download('#composition-export', 'reopened-ai-handoff.tar'),
  ).toEqual(pkg);
  await view('08  Project assets');
  await expect(page.locator('.project-asset')).toContainText(
    'Reusable synthetic original',
  );
  await expect(page.locator('.asset-role [name=role]')).toHaveValue(
    'placeable',
  );
  await page.getByText('Version history', { exact: true }).click();
  await submit('.asset-history', '');
  await expect(page.locator('.asset-history-result')).toContainText(
    'Exact v1 · reference',
  );
  expect(errors).toEqual([]);
  const receipt = {
    check: 'ai-assets-browser',
    node: process.version,
    platform: process.platform,
    browser: browser.version(),
    widths: [1440, 390],
    requestSHA256: hash(requestBytes),
    packageSHA256: hash(pkg),
    packageBytes: pkg.length,
    assetSHA256: hash(bytes),
    accepted,
    errors,
    realProviderCalls: 0,
    offlineTransportCalls: 0,
    actualAIGeneration: false,
    assessment:
      'AI technical mechanical rehearsal; authored synthetic response is not actual AI/provider proof or designer approval',
    checks: [
      'pending no fallback',
      'request download/native response intake',
      'selected direction defaults and explicit override',
      'reference to placeable version',
      'same asset under two directions',
      'old accepted direction unchanged',
      'historical original and role',
      'structured image previews',
      'visible edit/save/navigate/reload/closed-copy reopen',
      'explicit acceptance and byte-identical downloaded handoff',
    ],
  };
  writeFileSync(
    join(evidence, 'ai-assets-browser-check.json'),
    JSON.stringify(receipt, null, 2) + '\n',
  );
  console.log(JSON.stringify(receipt));
} catch (error) {
  console.error({
    notice: await page.locator('#notice').textContent(),
    errors,
  });
  await page.screenshot({ path: join(evidence, 'ai-assets-failure.png') });
  throw error;
} finally {
  await browser.close();
  if (app) await app.close();
}
