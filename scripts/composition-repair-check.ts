import { chromium, expect } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Workspace } from '../src/service/workspace.ts';
import { reference } from '../src/kernel/packets.ts';
import { effectiveStyle } from '../src/modules/website/composition.ts';
import type { CompositionState } from '../src/modules/website/composition.ts';
import type { DesignArtifact, NodePacket } from '../src/kernel/contracts.ts';
import type { ImageState } from '../src/modules/website/workspace-contracts.ts';
import { seedComposition } from './composition-fixture.ts';
import { startFixture, stopFixture } from './provider-browser-lifecycle.ts';
/** Parse only this test's generated bounded archive; never extract source paths or links. */
function members(bytes: Buffer) {
  const files = new Map<string, Buffer>();
  for (let n = 0; n < bytes.length - 1024; ) {
    const h = bytes.subarray(n, n + 512),
      name = h.toString('ascii', 0, 100).split('\0')[0]!;
    expect(h.toString('ascii', 156, 157)).toBe('0');
    expect(
      /^(manifest\.json|index\.html|RECONSTRUCT\.md|assets\/[a-f0-9]{64}\.(png|jpg|webp))$/.test(
        name,
      ),
    ).toBe(true);
    expect(files.has(name)).toBe(false);
    const size = parseInt(h.toString('ascii', 124, 136).split('\0')[0]!, 8);
    expect(
      Number.isSafeInteger(size) && size > 0 && n + 512 + size <= bytes.length,
    ).toBe(true);
    files.set(name, bytes.subarray(n + 512, n + 512 + size));
    n += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}
async function imageGeometry(page: Page) {
  const images = page.locator('#hero img');
  await expect(images).toHaveCount(2);
  const boxes = [];
  for (const image of await images.all()) {
    await image.scrollIntoViewIfNeeded();
    boxes.push(
      await image.evaluate((el: HTMLImageElement) => {
        const r = el.getBoundingClientRect();
        return {
          x: r.x + scrollX,
          y: r.y + scrollY,
          width: r.width,
          height: r.height,
          src: el.getAttribute('src'),
          decoded: el.complete && el.naturalWidth === 720,
          centerVisible:
            document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) ===
            el,
        };
      }),
    );
  }
  const [a, b] = boxes as [(typeof boxes)[number], (typeof boxes)[number]];
  const overlap =
    Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return { boxes, overlap, distinct: a.src !== b.src };
}
async function globalVisibility(page: Page) {
  await page.goto(page.url().split('#')[0]!);
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  const skipVisible = await skip.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return (
      r.top >= 0 &&
      r.left >= 0 &&
      document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === el
    );
  });
  const contrast = await page
    .locator('header strong,header nav a,footer small,.skip')
    .evaluateAll((elements) =>
      elements.map((el) => {
        const luminance = (color: string) => {
          const values = color
            .match(/[\d.]+/g)!
            .slice(0, 3)
            .map(Number)
            .map((n) => n / 255)
            .map((n) =>
              n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4,
            );
          return (
            0.2126 * values[0]! + 0.7152 * values[1]! + 0.0722 * values[2]!
          );
        };
        const style = getComputedStyle(el),
          bg = getComputedStyle(document.body).backgroundColor,
          a = luminance(style.color),
          b = luminance(bg);
        return {
          tag: el.tagName,
          text: el.textContent,
          color: style.color,
          background: bg,
          contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
          outline: style.outlineWidth,
        };
      }),
    );
  await page.keyboard.press('Enter');
  expect(new URL(page.url()).hash).toBe('#main');
  return { contrast, skipVisible };
}
export async function checkCompositionRepairs(
  browser: Browser,
  evidence: string,
  baseline = false,
) {
  mkdirSync(evidence, { recursive: true });
  const root = mkdtempSync(join(tmpdir(), 'bve-composition-repair-'));
  const w = new Workspace(root),
    seed = await seedComposition(w),
    pid = seed.project.id;
  const descriptors = Object.fromEntries(
    Object.entries(seed.assets).map(([key, ref]) => [
      key,
      (w.read(pid, ref).payload.state as ImageState).image,
    ]),
  );
  w.close();
  const fixture = await startFixture(root, 0, 'fixture'),
    context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    page = await context.newPage(),
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let staticServer: ReturnType<typeof createServer> | null = null;
  try {
    const session = await context.request.get(
        fixture.origin + '/api/v1/session',
      ),
      token = (await session.json()).token;
    const post = async (action: string, input: unknown) =>
      context.request.post(fixture.origin + '/api/v1/composition/' + action, {
        headers: {
          Origin: fixture.origin,
          'X-BVE-Token': token,
          'Content-Type': 'application/json',
        },
        data: { projectId: pid, input },
      });
    const read = async () => {
      const r = await context.request.get(
        fixture.origin + '/api/v1/workspace?project=' + pid,
      );
      expect(r.ok()).toBe(true);
      return r.json();
    };
    const latest = (s: Awaited<ReturnType<typeof read>>) =>
      s.artifacts
        .filter(
          (a: NodePacket<DesignArtifact<unknown>>) =>
            a.payload.kind === 'website-composition',
        )
        .at(-1) as NodePacket<DesignArtifact<CompositionState>>;
    const start = await post('start', {
      expectedProject: reference(seed.project),
      direction: seed.direction,
      reason: 'Synthetic F1/F2 regression fixture.',
    });
    expect(start.ok()).toBe(true);
    let a = latest(await read());
    const content = structuredClone(a.payload.state.content);
    for (const s of content.sections) {
      let b = s.blocks.find((b) => b.kind === 'image');
      if (!b) {
        b = {
          id: s.id + '-image',
          kind: 'image',
          text: '',
          href: '',
          items: [],
          asset: null,
          image: null,
          alt: '',
          unresolved: '',
        };
        s.blocks.push(b);
      }
      b.asset = seed.assets[s.id];
      b.image = descriptors[s.id]!;
      b.alt = 'Synthetic original ' + s.id;
      b.unresolved = '';
      const st = effectiveStyle(content.style, s);
      s.overrides = {
        ...s.overrides,
        foreground: st.foreground,
        background: st.background,
      };
    }
    const hero = content.sections[0]!;
    hero.blocks.push({
      ...hero.blocks.find((b) => b.kind === 'image')!,
      id: 'hero-second-image',
      asset: seed.assets.replacement,
      image: descriptors['replacement']!,
      alt: 'Synthetic second hero, distinct owned bytes',
    });
    let r = await post('save', {
      expectedProject: reference(seed.project),
      expected: reference(a),
      direction: seed.direction,
      content,
      reason: 'Place two distinct hero images and readable section overrides.',
    });
    expect(r.ok(), await r.text()).toBe(true);
    a = latest(await read());
    const reviewAccept = async () => {
      let r = await post('review', {
        expectedProject: reference(seed.project),
        expected: reference(a),
        sections: ['hero', 'services', 'proof', 'contact'],
        reason: 'AI technical review; synthetic exceptions explicit.',
      });
      expect(r.ok()).toBe(true);
      a = latest(await read());
      r = await post('accept', {
        expectedProject: reference(seed.project),
        artifact: reference(a),
        expected: (await read()).accepted.composition,
        reason: 'Accept this exact synthetic regression control.',
      });
      expect(r.ok()).toBe(true);
    };
    await reviewAccept();
    const accepted = reference(a),
      before = await read(),
      invalid = structuredClone(a.payload.state.content);
    invalid.style.foreground = invalid.style.background;
    const bad = await post('save', {
      expectedProject: reference(seed.project),
      expected: reference(a),
      direction: seed.direction,
      content: invalid,
      reason: 'F2 all-section-overridden cream-on-cream globals.',
    });
    const f2 = {
      status: bad.status(),
      error: (await bad.json()).error,
      versionBefore: a.version,
      versionAfter: latest(await read()).version,
      ledgerBefore: before.ledger.events.length,
      ledgerAfter: (await read()).ledger.events.length,
      acceptedPreserved:
        JSON.stringify((await read()).accepted.composition) ===
        JSON.stringify(accepted),
    };
    if (baseline) {
      expect(bad.ok()).toBe(true);
      a = latest(await read());
      await reviewAccept();
    } else {
      expect(bad.status()).toBe(400);
      expect(f2.error).toContain('Global page text contrast');
      expect(f2.versionAfter).toBe(f2.versionBefore);
      expect(f2.ledgerAfter).toBe(f2.ledgerBefore);
      expect(f2.acceptedPreserved).toBe(true);
    }
    const pointer = reference(a),
      exportResponse = await context.request.get(
        fixture.origin +
          `/api/v1/composition/export?project=${pid}&id=${pointer.id}&version=${pointer.version}`,
      );
    expect(exportResponse.ok()).toBe(true);
    const bytes = await exportResponse.body(),
      files = members(bytes),
      manifest = JSON.parse(files.get('manifest.json')!.toString());
    expect(manifest.assets).toHaveLength(5);
    for (const asset of manifest.assets)
      expect(
        createHash('sha256').update(files.get(asset.path)!).digest('hex'),
      ).toBe(asset.checksum);
    writeFileSync(
      join(
        evidence,
        baseline
          ? 'repair-baseline-handoff.tar'
          : 'repair-accepted-handoff.tar',
      ),
      bytes,
    );
    staticServer = createServer((req, res) => {
      const path =
        new URL(req.url ?? '/', 'http://localhost').pathname.slice(1) ||
        'index.html';
      const file = files.get(path);
      if (!file) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, {
        'Content-Type': path.endsWith('.html')
          ? 'text/html'
          : path.endsWith('.png')
            ? 'image/png'
            : 'text/plain',
      });
      res.end(file);
    });
    await new Promise<void>((resolve) =>
      staticServer!.listen(0, '127.0.0.1', resolve),
    );
    const address = staticServer.address();
    if (!address || typeof address === 'string')
      throw Error('Missing static address');
    const observations = [];
    for (const width of [1440, 390])
      for (const source of ['preview', 'export']) {
        await page.setViewportSize({ width, height: 1000 });
        await page.goto(
          source === 'preview'
            ? fixture.origin +
                `/api/v1/composition/preview?project=${pid}&id=${pointer.id}&version=${pointer.version}`
            : `http://127.0.0.1:${address.port}/`,
        );
        const geometry = await imageGeometry(page),
          global = await globalVisibility(page);
        if (baseline) {
          if (width === 1440) {
            expect(geometry.overlap).toBeGreaterThan(0);
            expect(geometry.boxes.some((b) => !b.centerVisible)).toBe(true);
          } else expect(geometry.overlap).toBe(0);
          expect(global.contrast.every((e) => e.contrast === 1)).toBe(true);
        } else {
          expect(geometry.overlap).toBe(0);
          expect(geometry.distinct).toBe(true);
          expect(
            geometry.boxes.every((b) => b.decoded && b.centerVisible),
          ).toBe(true);
          expect(global.contrast.every((e) => e.contrast >= 4.5)).toBe(true);
          expect(global.skipVisible).toBe(true);
          expect(
            global.contrast.find((e) => e.text === 'Skip to content')!.outline,
          ).toBe('3px');
        }
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: join(
            evidence,
            `repair-${baseline ? 'baseline' : 'fixed'}-${source}-${width}.png`,
          ),
          fullPage: true,
        });
        observations.push({ width, source, geometry, global });
      }
    expect(errors).toEqual([]);
    const providerReceipt = await stopFixture(fixture);
    expect(providerReceipt.realProviderCalls).toBe(0);
    expect(providerReceipt.offlineTransportCalls).toBe(0);
    const receipt = {
      phase: baseline ? 'pre-repair reproduced' : 'repaired checks',
      node: process.version,
      platform: process.platform,
      browser: browser.version(),
      composition: pointer,
      packageSHA256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
      assets: manifest.assets,
      unresolved: manifest.unresolved,
      f2,
      observations,
      providerReceipt,
      errors,
    };
    writeFileSync(
      join(evidence, baseline ? 'repair-baseline.json' : 'repair-check.json'),
      JSON.stringify(receipt, null, 2) + '\n',
    );
    console.log(JSON.stringify(receipt));
    return receipt;
  } finally {
    await context.close();
    if (staticServer)
      await new Promise<void>((resolve, reject) =>
        staticServer!.close((e) => (e ? reject(e) : resolve())),
      );
    if (fixture.child.exitCode === null) await stopFixture(fixture);
  }
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env['BVE_CHROMIUM_EXECUTABLE']
      ? { executablePath: process.env['BVE_CHROMIUM_EXECUTABLE'] }
      : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    await checkCompositionRepairs(
      browser,
      resolve(process.env['BVE_EVIDENCE_DIR'] ?? 'docs/evidence'),
      process.env['BVE_REPAIR_BASELINE'] === '1',
    );
  } finally {
    await browser.close();
  }
}
