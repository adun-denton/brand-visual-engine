import { checkMemoryRepairs } from "./memory-repair-browser-check.ts";
/** Explicitly offline interaction proof. No accounts, models, executors or image generation. */
import { chromium, expect } from "@playwright/test";
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
import { reference, canonical } from "../src/kernel/packets.ts";
import { parseIndex } from "../src/modules/website/memory-contracts.ts";
import { OfflineRasterTransport } from "./execution-fixture.ts";
import { visualFixture, offlineVisualProviders } from "./visual-fixture.ts";
const evidence =
  process.env["BVE_EVIDENCE_DIR"] ??
  mkdtempSync(join(tmpdir(), "bve-memory-evidence-"));
mkdirSync(evidence, { recursive: true });
const runtime = mkdtempSync(join(tmpdir(), "bve-memory-browser-")),
  transport = new OfflineRasterTransport();
const browser = await chromium.launch({
  headless: true,
  ...(process.env["BVE_CHROMIUM_EXECUTABLE"]
    ? { executablePath: process.env["BVE_CHROMIUM_EXECUTABLE"] }
    : {}),
});
let app = await startApp(runtime, 0, undefined, offlineVisualProviders, {
  executionFixture: { testOnly: true, transport },
});
const errors: string[] = [],
  screens: string[] = [],
  checks: string[] = [];
try {
  const p = app.visual.create({
      title: "Form / Field · project continuation fixture",
    }),
    pid = p.project.id,
    u = app.visual.exploration.createWorkUnit(pid, {
      version: 1,
      pageType: "homepage",
      label: "Homepage",
      source: "Synthetic browser fixture",
    }),
    about = app.visual.exploration.createWorkUnit(pid, {
      version: 1,
      pageType: "about",
      label: "About",
      source: "Synthetic browser fixture",
    }),
    other = app.visual.create({ title: "Second project · isolation fixture" }),
    foreign = app.visual.exploration.createWorkUnit(other.project.id, {
      version: 1,
      pageType: "homepage",
      label: "Other Homepage",
      source: "Synthetic fixture",
    }),
    c = await app.visual.exploration.importCandidate(
      pid,
      reference(u),
      await visualFixture(0),
      "Synthetic fixture rights",
    );
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => void d.accept());
  const shot = async (name: string) => {
    await expect(page.locator("#memory-create")).toBeEnabled();
    await page
      .locator("#memory-panel")
      .evaluate((n) => n.scrollIntoView({ block: "start" }));
    await page.screenshot({
      path: join(evidence, name + ".png"),
      fullPage: false,
    });
    screens.push(name + ".png");
  };
  const idle = async () =>
    expect(page.locator("#visual-app")).not.toHaveAttribute(
      "aria-busy",
      "true",
    );
  const panel = async () => {
    await idle();
    if (!(await page.locator("#memory-load").isVisible()))
      await page.locator("#memory-panel>summary").click();
  };
  const open = async (project: string, unit: string) => {
    await page.goto(app.origin + "/visual");
    await page.locator("#project").selectOption(project);
    await page.locator("#page").selectOption(unit);
    await panel();
    await panel();
    await page.locator("#memory-load").click();
    await expect(page.locator("#memory-status")).toContainText("loaded");
  };
  await open(pid, u.id + ":1");
  expect(await page.locator("[data-chat]").count()).toBe(0);
  await page
    .locator("#prepare textarea[name=intent]")
    .fill("Homepage unsaved intent kept apart from memory");
  await page.locator("#prepare select[name=count]").selectOption("2");
  await page
    .locator("[data-memory-evidence]:visible")
    .filter({ hasText: "raster-concept" })
    .first()
    .click();
  await expect(page.locator("#memory-evidence-json")).toContainText(
    '"origin": "imported"',
  );
  await page.locator("#memory-link-note").click();
  await page
    .locator("#memory-note-text")
    .fill(
      "Unresolved: explore calmer spacing; selected source is not accepted or a Brand rule.",
    );
  await page
    .locator("#memory-note button")
    .filter({ hasText: "Save handoff note" })
    .click();
  await expect(page.locator("#memory-status")).toContainText(
    "saved explicitly",
  );
  const saved = app.memory.state(pid, reference(u)).notes[0] as any;
  expect(saved.note.evidence[0].ref.id).toBe(c.id);
  await page.locator("#memory-create").click();
  await expect(page.locator("#memory-currency")).toHaveText("current");
  const first = app.memory.state(pid, reference(u)).capsules[0] as any;
  await shot("01-memory-sheet-desktop");
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#memory-download").click();
  const download = await downloadPromise,
    path = await download.path();
  const exported = readFileSync(path!, "utf8"),
    roundtrip = parseIndex(JSON.parse(exported));
  expect(roundtrip.scope?.id).toBe(u.id);
  expect(exported).toBe(app.memory.download(pid, first.ref).output);
  expect(exported).not.toContain(other.project.id);
  expect(download.suggestedFilename()).toMatch(
    /^project-continuation-capsule-[a-z0-9-]+\.json$/,
  );
  checks.push(
    "previewed deterministic schema-valid JSON download; no media or foreign project",
  );
  await page
    .locator("#memory-note-text")
    .fill("Unsent stale-view draft survives a denied save");
  app.memory.saveNote(pid, {
    expected: saved.ref,
    note: { ...saved.note, text: "Concurrent reader saved revision two" },
  });
  await page
    .locator("#memory-note button")
    .filter({ hasText: "Save handoff note" })
    .click();
  await expect(page.locator("#memory-status")).toContainText("changed");
  await expect(page.locator("#memory-note-text")).toHaveValue(
    "Unsent stale-view draft survives a denied save",
  );
  await expect(page.locator("#prepare textarea[name=intent]")).toHaveValue(
    "Homepage unsaved intent kept apart from memory",
  );
  await panel();
  await page.locator("#memory-load").click();
  await expect(page.locator("#memory-currency")).toHaveText("changed");
  await expect(page.locator("#memory-note-text")).toHaveValue(
    "Unsent stale-view draft survives a denied save",
  );
  await shot("02-memory-note-conflict-stale");
  checks.push(
    "concurrent note conflict preserves memory and V02 drafts; truthful stale capsule",
  );
  await page.locator("#memory-refresh").click();
  await expect(page.locator("#memory-currency")).toHaveText("current");
  expect(app.memory.download(pid, first.ref).output).toBe(exported);
  checks.push(
    "explicit refresh creates new immutable capsule; old snapshot unchanged",
  );
  await page.locator("#page").selectOption(about.id + ":1");
  await panel();
  await page.locator("#memory-load").click();
  await expect(page.locator("#memory-note-text")).toHaveValue("");
  await page.locator("#memory-note-text").fill("About draft is separate");
  await page.locator("#page").selectOption(u.id + ":1");
  await expect(page.locator("#memory-note-text")).toHaveValue(
    "Unsent stale-view draft survives a denied save",
  );
  await page.locator("#project").selectOption(other.project.id);
  await page.locator("#page").selectOption(foreign.id + ":1");
  await panel();
  await page.locator("#memory-load").click();
  await expect(page.locator("#memory-note-text")).toHaveValue("");
  await expect(page.locator("#memory-panel")).not.toContainText(
    "Concurrent reader",
  );
  checks.push(
    "project/page isolation and exact evidence without active-page redirection",
  );
  await open(pid, u.id + ":1");
  await page.locator("#layout").selectOption("film");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("[data-memory-capsule]").first().click();
  await shot("03-memory-filmstrip-narrow");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page
    .locator("[data-memory-evidence]:visible")
    .filter({ hasText: "raster-concept" })
    .first()
    .click();
  await expect(page.locator("#memory-create")).toBeEnabled();
  await page
    .locator(".memory-inspection")
    .evaluate((n) => n.scrollIntoView({ block: "start" }));
  await page.screenshot({
    path: join(evidence, "04-memory-exact-source-narrow.png"),
  });
  screens.push("04-memory-exact-source-narrow.png");
  checks.push("both layouts and narrow geometry with exact source inspection");
  await context.close();
  await app.close();
  app = await startApp(runtime, 0, undefined, offlineVisualProviders, {
    executionFixture: { testOnly: true, transport },
  });
  const freshContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    fresh = await freshContext.newPage();
  fresh.on("pageerror", (e) => errors.push(e.message));
  await fresh.goto(app.origin + "/visual");
  await fresh.locator("#project").selectOption(pid);
  await fresh.locator("#page").selectOption(u.id + ":1");
  await expect(fresh.locator("#visual-app")).not.toHaveAttribute(
    "aria-busy",
    "true",
  );
  await fresh.locator("#memory-panel>summary").click();
  await fresh.locator("#memory-load").click();
  await expect(fresh.locator("#memory-panel")).toContainText(
    "Concurrent reader saved revision two",
  );
  await expect(fresh.locator("#memory-note-text")).toHaveValue("");
  await expect(fresh.locator("#prepare textarea[name=intent]")).toHaveValue("");
  await fresh.locator("[data-memory-capsule]").first().click();
  await expect(fresh.locator("#memory-currency")).toHaveText("current");
  await fresh
    .locator("[data-memory-evidence]:visible")
    .filter({ hasText: "raster-concept" })
    .first()
    .click();
  await expect(fresh.locator("#memory-evidence-json")).toContainText(
    '"version": 1',
  );
  await expect(fresh.locator("#memory-create")).toBeEnabled();
  await fresh
    .locator("#memory-panel")
    .evaluate((n) => n.scrollIntoView({ block: "start" }));
  await fresh.screenshot({
    path: join(evidence, "05-memory-chat-free-reopen-desktop.png"),
  });
  screens.push("05-memory-chat-free-reopen-desktop.png");
  checks.push(
    "closed runtime and fresh browser reconstruct saved continuation without session drafts",
  );
  // Memory requests remain independent of serial dispatch. An ordinary Cancel/Revoke is reachable while both are pending.
  for (const action of ["cancel", "revoke"] as const) {
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r)),
      send = transport.submit.bind(transport);
    let entered!: () => void;
    const entry = new Promise<void>((r) => (entered = r));
    transport.submit = async (input) => {
      const ack = await send(input);
      entered();
      await hold;
      return ack;
    };
    const prepared = (await app.visual.command(pid, "prepare", {
      expectedProject: p.project,
      unit: reference(u),
      selections: null,
      intent: "Held offline fixture " + action,
      count: 6,
      direction: "fresh",
      brand: null,
      operation: "create",
      requests: [],
      level1: [],
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
        timeoutMs: 10000,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        reason: "Explicit held offline fixture",
      });
    app.visual.executions.prepare(pid, reference(grant));
    await fresh.locator("#page").selectOption(about.id + ":1");
    await expect(fresh.locator("#visual-app")).not.toHaveAttribute(
      "aria-busy",
      "true",
    );
    await fresh.locator("#page").selectOption(u.id + ":1");
    await expect(fresh.locator("#visual-app")).not.toHaveAttribute(
      "aria-busy",
      "true",
    );
    await fresh.locator("[data-execution-run]").last().click();
    await entry;
    let releaseMemory!: () => void;
    const memoryHold = new Promise<void>((r) => (releaseMemory = r));
    await fresh.route("**/api/v1/visual/memory/create", async (route) => {
      await memoryHold;
      await route.continue();
    });
    await fresh.locator("#memory-create").click();
    await expect(fresh.locator("#memory-status")).toContainText("saving");
    const button = fresh.locator("[data-execution-" + action + "]").last();
    await button.click({ timeout: 250 });
    await expect
      .poll(() =>
        action === "cancel"
          ? app.visual.executions.state(pid, reference(u)).at(-1)!.run.payload
              .state.slots[0]!.cancelRequested
          : ((
              app.workspace.kernel.lookup({
                ...reference(grant),
                version: 2,
              }) as
                | import("../src/kernel/contracts.ts").NodePacket<
                    import("../src/kernel/contracts.ts").DesignArtifact<
                      import("../src/modules/website/execution-contracts.ts").Grant
                    >
                  >
                | null
            )?.payload.state.revoked ?? false),
      )
      .toBe(true);
    releaseMemory();
    await expect(fresh.locator("#memory-status")).toContainText(
      "Frozen capsule saved",
    );
    release();
    await expect
      .poll(() => app.visual.executions.state(pid, reference(u)).at(-1)!.active)
      .toBe(false);
    await app.visual.executions.waitForDeliveries();
    expect(transport.submissions.length).toBe(action === "cancel" ? 1 : 2);
    expect(transport.polls.length).toBe(0);
    await fresh.unroute("**/api/v1/visual/memory/create");
    transport.submit = send;
    await fresh.locator("#memory-load").click();
    await expect(fresh.locator("#memory-status")).toContainText("loaded");
    await expect(fresh.locator("#memory-create")).toBeEnabled();
    await fresh
      .locator("#memory-panel")
      .evaluate((n) => n.scrollIntoView({ block: "start" }));
    await fresh.screenshot({
      path: join(evidence, "06-memory-held-" + action + ".png"),
    });
    screens.push("06-memory-held-" + action + ".png");
  }
  checks.push(
    "held six-slot dispatch plus held memory creation keeps ordinary Cancel/Revoke usable; one submitted slot per run; no polls or adoption",
  );
  expect(errors).toEqual([]);
  const receipt = {
    check: "v04-project-memory-browser",
    candidate: process.env["BVE_CANDIDATE_COMMIT"] ?? "unpublished",
    node: process.version,
    browser: browser.version(),
    platform: process.platform,
    checks,
    screenshots: screens,
    errors,
    offlineSubmissions: transport.submissions.length,
    offlineStatusCalls: transport.polls.length,
    offlineCancellationCalls: transport.cancellations.length,
    actualModelCalls: 0,
    actualImageProviderCalls: 0,
  };
  writeFileSync(
    join(evidence, "memory.json"),
    JSON.stringify(receipt, null, 2),
  );
  console.log(JSON.stringify(receipt));
  await freshContext.close();
  await checkMemoryRepairs(browser,evidence);
} finally {
  await app.close();
  await browser.close();
  rmSync(runtime, { recursive: true, force: true });
}
