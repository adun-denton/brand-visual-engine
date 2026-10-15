/** Offline whole-raster Library/export interaction proof. No image generation or connected account. */
import { chromium, expect, type Page } from "@playwright/test";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp } from "../src/service/server.ts";
import { canonical, reference } from "../src/kernel/packets.ts";
import { checksum } from "../src/kernel/raster.ts";
import { parseRasterManifest } from "../src/modules/website/library-contracts.ts";
import { visualFixture, offlineVisualProviders } from "./visual-fixture.ts";
import { OfflineRasterTransport } from "./execution-fixture.ts";
const evidence =
  process.env["BVE_EVIDENCE_DIR"] ??
  mkdtempSync(join(tmpdir(), "bve-library-evidence-"));
mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(join(tmpdir(), "bve-library-browser-")),
  transport = new OfflineRasterTransport();
const browser = await chromium.launch({
  headless: true,
  ...(process.env["BVE_CHROMIUM_EXECUTABLE"]
    ? { executablePath: process.env["BVE_CHROMIUM_EXECUTABLE"] }
    : {}),
});
let app = await startApp(root, 0, undefined, offlineVisualProviders, {
  executionFixture: { testOnly: true, transport },
});
const errors: string[] = [],
  screens: string[] = [],
  checks: string[] = [];
const releases = new Set<() => void>();
try {
  const project = app.visual.create({
      title: "Form / Field · project raster Library",
    }).project,
    pid = project.id,
    e = app.visual.exploration;
  const home = e.createWorkUnit(pid, {
      version: 1,
      pageType: "homepage",
      label: "Homepage",
      source: "Synthetic fixture",
    }),
    about = e.createWorkUnit(pid, {
      version: 1,
      pageType: "about",
      label: "About",
      source: "Synthetic fixture",
    });
  const foreign = app.visual.create({ title: "Isolated project" }).project,
    other = e.createWorkUnit(foreign.id, {
      version: 1,
      pageType: "homepage",
      label: "Other Homepage",
      source: "Synthetic fixture",
    });
  const bytes = await visualFixture(0),
    c = await e.importCandidate(
      pid,
      reference(home),
      bytes,
      "Synthetic fixture rights; project-local reuse only",
    ),
    second = await e.importCandidate(
      pid,
      reference(home),
      await visualFixture(1),
      "Second fixture rights",
    );
  let context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    page = await context.newPage();
  const track = (p: Page) => {
    p.on("pageerror", (x) => errors.push(x.message));
  };
  track(page);
  const idle = async () =>
    expect(page.locator("#visual-app")).not.toHaveAttribute(
      "aria-busy",
      "true",
    );
  const open = async (projectId: string, unit: string) => {
    await page.goto(app.origin + "/visual");
    await page.locator("#project").selectOption(projectId);
    await page.locator("#page").selectOption(unit);
    await idle();
  };
  const panel = async () => {
    if (!(await page.locator("#library-load").isVisible()))
      await page.locator("#project-library>summary").click();
  };
  const shot = async (name: string, selector = "#project-library") => {
    await expect(page.locator("#library-load")).toBeEnabled();
    await page
      .locator(selector)
      .evaluate((n) => n.scrollIntoView({ block: "start" }));
    await page.screenshot({ path: join(evidence, name + ".png") });
    screens.push(name + ".png");
  };
  const integrity = () =>
    canonical({
      accepted: app.workspace.kernel.acceptedSelections(pid),
      project: app.workspace.project(pid),
      selections: app.workspace.kernel
        .latestPackets()
        .filter(
          (p) =>
            p.projectId === pid &&
            (p.payload as any).kind === "raster-selections",
        ),
    });
  await open(pid, home.id + ":1");
  await panel();
  await page.locator("#library-load").click();
  await expect(page.locator("#library-empty")).toBeVisible();
  await expect(page.locator("#prepare [name=count]")).toHaveValue("");
  await expect(page.locator("#prepare [name=direction]")).toHaveValue("");
  await expect(page.locator("#prepare [name=brand]")).toHaveValue("");
  await page
    .locator("#prepare [name=intent]")
    .fill("Unsent Homepage intent survives Library actions");
  await page
    .locator("#region-form")
    .evaluate(
      (n) => ((n.closest("details") as HTMLDetailsElement).open = true),
    );
  for (const [name, value] of Object.entries({
    x: "10",
    y: "10",
    width: "30",
    height: "20",
  }))
    await page.locator("#region-form [name=" + name + "]").fill(value);
  await page.locator("#region-form button").click();
  await idle();
  const before = integrity(),
    beforeEvents = canonical(app.workspace.kernel.ledger(pid));
  await page.locator("#raster-export").click();
  await expect(page.locator("#library-status")).toContainText(
    "Preview the focused whole raster",
  );
  await expect(page.locator(".library-preview")).toContainText(
    "Region selections are not exported",
  );
  expect((await app.library.state(pid)).coverage.total).toBe(0);
  expect(canonical(app.workspace.kernel.ledger(pid))).toBe(beforeEvents);
  await page.locator("#library-save").click();
  await expect(page.locator("#library-status")).toContainText(
    "Whole raster saved",
  );
  expect(integrity()).toBe(before);
  await expect(page.locator("#prepare [name=intent]")).toHaveValue(
    "Unsent Homepage intent survives Library actions",
  );
  const item = (await app.library.state(pid)).entries[0]!,
    preview = JSON.parse(
      (await page.locator("#library-manifest").textContent()) ?? "null",
    );
  expect(preview.source.candidate.id).toBe(c.id);
  expect(preview.raster.image.checksum).toBe(checksum(bytes));
  expect(preview.provenance.generationClaim).toBe("not-established");
  await shot("01-library-sheet-desktop");
  const savedEvents = canonical(app.workspace.kernel.ledger(pid));
  await page.locator("#library-save").click();
  await expect(page.locator("#library-status")).toContainText("already saved");
  expect(canonical(app.workspace.kernel.ledger(pid))).toBe(savedEvents);
  expect((await app.library.state(pid)).coverage.total).toBe(1);
  await page.locator("#library-target").selectOption(about.id + ":1");
  await page.locator("#library-reuse").click();
  await expect(page.locator("#library-status")).toContainText(
    "New candidate added on About",
  );
  expect(await page.locator("#page").inputValue()).toBe(home.id + ":1");
  expect(integrity()).toBe(before);
  await expect(page.locator("#prepare [name=intent]")).toHaveValue(
    "Unsent Homepage intent survives Library actions",
  );
  const reused = app.visual.state(pid, reference(about)).candidates[0]!;
  expect(reused.dependencies).toEqual([preview.source.media]);
  expect(
    app.visual
      .state(pid, reference(about))
      .records.filter((p) => (p.payload as any).kind === "raster-selections"),
  ).toHaveLength(0);
  const reuseEvents = canonical(app.workspace.kernel.ledger(pid));
  await page.locator("#library-reuse").click();
  await expect(page.locator("#library-status")).toContainText(
    "Existing reused candidate",
  );
  expect(canonical(app.workspace.kernel.ledger(pid))).toBe(reuseEvents);
  const originalPromise = page.waitForEvent("download");
  await page.locator("#library-original").click();
  const original = await originalPromise;
  await original.saveAs(join(evidence, "original.png"));
  expect(readFileSync(join(evidence, "original.png"))).toEqual(bytes);
  const packagePromise = page.waitForEvent("download");
  await page.locator("#library-package").click();
  const archive = await packagePromise;
  await archive.saveAs(join(evidence, "raster.tar"));
  const pack = readFileSync(join(evidence, "raster.tar")),
    expected = await app.library.export(
      pid,
      "package",
      item.ref,
      item.integrity,
    );
  expect(pack).toEqual(expected.bytes);
  parseRasterManifest(preview);
  expect(canonical(app.workspace.kernel.ledger(pid))).toBe(reuseEvents);
  expect(integrity()).toBe(before);
  checks.push(
    "empty state; explicit focused whole export despite region selection; save/reuse idempotency; named cross-page candidate without selection/acceptance/Brand/execution; exact offline original/package download",
  );
  await page.locator("#layout").selectOption("film");
  await page.setViewportSize({ width: 390, height: 844 });
  await shot("02-library-filmstrip-narrow", ".library-preview");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.locator("#page").selectOption(about.id + ":1");
  await idle();
  await panel();
  await page.locator("#library-load").click();
  await expect(page.locator("[data-library-inspect]")).toHaveCount(1);
  await page.locator("[data-library-inspect]").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#library-status")).toContainText(
    "Exact saved source previewed",
  );
  await expect(page.locator("[data-library-inspect]")).toBeFocused();
  await shot("03-library-reused-about-narrow", ".library-preview");
  await page.locator("#page").selectOption(home.id + ":1");
  await expect(page.locator("#prepare [name=intent]")).toHaveValue(
    "Unsent Homepage intent survives Library actions",
  );
  await page.locator("#project").selectOption(foreign.id);
  await page.locator("#page").selectOption(other.id + ":1");
  await panel();
  await page.locator("#library-load").click();
  await expect(page.locator("#library-empty")).toBeVisible();
  await expect(page.locator("[data-library-inspect]")).toHaveCount(0);
  await expect(page.locator("#prepare [name=intent]")).toHaveValue("");
  checks.push(
    "both layouts/narrow geometry; keyboard inspector focus retained; page/project draft and Library isolation",
  );
  await context.close();
  await app.close();
  app = await startApp(root, 0, undefined, offlineVisualProviders, {
    executionFixture: { testOnly: true, transport },
  });
  await app.visual.exploration.importCandidate(
    pid,
    reference(home),
    await visualFixture(2),
    "Replacement fixture rights",
    "imported",
    reference(c),
  );
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  page = await context.newPage();
  track(page);
  await open(pid, about.id + ":1");
  await panel();
  await page.locator("#library-load").click();
  await page.locator("[data-library-inspect]").click();
  await expect(page.locator("#library-rights")).toContainText(
    "Synthetic fixture rights",
  );
  const pinned = JSON.parse(
    (await page.locator("#library-manifest").textContent()) ?? "null",
  );
  expect(pinned.source.candidate.version).toBe(1);
  expect(pinned.raster.image.checksum).toBe(checksum(bytes));
  expect(
    app.visual.state(pid, reference(about)).candidates.map((x) => x.id),
  ).toContain(reused.id);
  await expect(page.locator("#prepare [name=intent]")).toHaveValue("");
  await shot("04-library-fresh-reader-desktop");
  checks.push(
    "closed runtime and fresh controller reopen; source replacement v2 cannot change saved v1 image/rights or reused candidate",
  );
  // A real service rejection through the ordinary UI, retaining valid preview/drafts and no partial entry.
  await page.locator("#page").selectOption(home.id + ":1");
  await idle();
  await page.locator('[data-open="' + second.id + ':1"]').click();
  const fault = app.workspace.assets.inspect.bind(app.workspace.assets);
  app.workspace.assets.inspect = async () => {
    throw new Error("Synthetic media unavailable; operation rejected");
  };
  const failedBefore = canonical(app.workspace.kernel.ledger(pid));
  await page.locator("#library-save").click();
  await expect(page.locator("#library-status")).toContainText(
    "Synthetic media unavailable",
  );
  expect(canonical(app.workspace.kernel.ledger(pid))).toBe(failedBefore);
  expect((await app.library.state(pid)).coverage.total).toBe(1);
  await shot("05-library-rejected-save-desktop");
  app.workspace.assets.inspect = fault;
  await page.locator("#library-save").click();
  await expect(page.locator("#library-status")).toContainText(
    "Whole raster saved",
  );
  expect((await app.library.state(pid)).coverage.total).toBe(2);
  checks.push(
    "ordinary rejected save reports failure without partial record; explicit manual retry succeeds",
  );
  // Held first-of-six transport plus held Library POST: ordinary Cancel and keyboard Revoke stay live.
  for (const action of ["cancel", "revoke"] as const) {
    const prepared = (await app.visual
      .command(pid, "prepare", {
        expectedProject: project,
        unit: reference(home),
        selections: null,
        intent: "Held offline Library interruption fixture",
        count: 6,
        direction: "fresh",
        brand: null,
        operation: "create",
        requests: [],
        level1: [],
      })
      .catch(async () => {
        const sel = app.visual
          .state(pid, reference(home))
          .records.find(
            (p) => (p.payload as any).kind === "raster-selections",
          )!;
        return app.visual.command(pid, "prepare", {
          expectedProject: project,
          unit: reference(home),
          selections: reference(sel),
          intent: "Held offline Library interruption fixture",
          count: 6,
          direction: "fresh",
          brand: null,
          operation: "refine",
          requests: [],
          level1: [],
        });
      })) as any;
    const request = await app.visual.executions.compile(
        pid,
        reference(prepared.specification),
        64,
        48,
      ),
      grant = app.visual.executions.grant(pid, {
        request: reference(request),
        adapter: transport.capabilities.adapter,
        slots: [1, 2, 3, 4, 5, 6],
        maxSubmissions: 6,
        maxStatusCalls: 0,
        maxCancelCalls: 0,
        timeoutMs: 30000,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        reason: "Explicit offline Library interruption fixture",
      }),
      run = app.visual.executions.prepare(pid, reference(grant));
    let release!: () => void, start!: () => void;
    const held = new Promise<void>((r) => (release = r)),
      started = new Promise<void>((r) => (start = r)),
      submit = transport.submit.bind(transport);
    releases.add(release);
    transport.submit = async (input) => {
      const ack = await submit(input);
      start();
      await held;
      return ack;
    };
    await page.reload();
    await page.locator("#project").selectOption(pid);
    await page.locator("#page").selectOption(home.id + ":1");
    await idle();
    await page.locator('[data-execution-run^="' + run.id + ':"]').click();
    await started;
    let continueLibrary!: () => void, libraryStarted!: () => void;
    const libraryHeld = new Promise<void>((r) => (continueLibrary = r)),
      libraryEntered = new Promise<void>((r) => (libraryStarted = r));
    releases.add(continueLibrary);
    await page.route("**/api/v1/visual/library/save", async (route) => {
      libraryStarted();
      await libraryHeld;
      await route.continue();
    });
    await page.locator("#library-save").click();
    await libraryEntered;
    await expect(page.locator("#library-status")).toContainText(
      "Reading or saving",
    );
    const interrupt = page.locator(
      "[data-execution-" + action + '^="' + run.id + ':"]',
    );
    await expect(interrupt).toBeEnabled();
    await interrupt.evaluate((n) => n.scrollIntoView({ block: "center" }));
    // This control does not navigate; the Library request is deliberately still held.
    if (action === "cancel") await interrupt.click({ timeout: 250, noWaitAfter: true });
    else {
      await interrupt.focus();
      await page.keyboard.press("Enter");
    }
    await expect
      .poll(() => {
        const r = app.visual.executions
          .state(pid, reference(home))
          .find((x) => x.run.id === run.id)!;
        return action === "cancel"
          ? r.run.payload.state.slots.some((x) => x.cancelRequested)
          : r.grant.payload.state.revoked;
      })
      .toBe(true);
    continueLibrary();
    await expect(page.locator("#library-load")).toBeEnabled();
    await shot("06-library-held-" + action + "-desktop");
    release();
    await app.visual.executions.waitForDeliveries();
    await page.unroute("**/api/v1/visual/library/save");
    transport.submit = submit;
    expect(
      transport.submissions.filter((x) => x.requestHash === request.integrity),
    ).toHaveLength(1);
  }
  expect(transport.polls).toHaveLength(0);
  expect(transport.cancellations).toHaveLength(0);
  checks.push(
    "held six-slot offline dispatch plus Library POST preserves ordinary Cancel/keyboard Revoke; one submit each, no transport polls/adoption",
  );
  await context.close();
  expect(errors).toEqual([]);
  const receipt = {
    check: "v05-raster-library-browser",
    candidate: process.env["BVE_CANDIDATE_COMMIT"] ?? "working-tree",
    node: process.version,
    browser: browser.version(),
    platform: process.platform,
    checks,
    screenshots: screens,
    errors,
    originalSHA256: checksum(bytes),
    packageSHA256: checksum(pack),
    packageBytes: pack.length,
    offlineSubmissions: transport.submissions.length,
    offlineStatusCalls: transport.polls.length,
    actualModelCalls: 0,
    actualImageProviderCalls: 0,
  };
  writeFileSync(
    join(evidence, "library.json"),
    JSON.stringify(receipt, null, 2) + "\n",
  );
  console.log(JSON.stringify(receipt));
} finally {
  for (const release of releases) release();
  await browser.close();
  await app.close();
  rmSync(root, { recursive: true, force: true });
}
