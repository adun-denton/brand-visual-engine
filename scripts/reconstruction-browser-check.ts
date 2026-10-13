import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
/** Authored offline reconstruction interaction; zero real account/model/image requests. */
import { chromium, expect } from "@playwright/test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { startApp } from "../src/service/server.ts";
import { reference, canonical } from "../src/kernel/packets.ts";
import { visualFixture, offlineVisualProviders } from "./visual-fixture.ts";
import { ReconstructionFixture } from "./reconstruction-fixture.ts";
const evidence = resolve(
  process.env["BVE_EVIDENCE_DIR"] ?? "/tmp/bve-reconstruction-browser",
);
mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(join(tmpdir(), "bve-reconstruction-browser-")),
  driver = new ReconstructionFixture();
let app = await startApp(root, 0, undefined, offlineVisualProviders, {
  reconstructionFixture: { testOnly: true, driver },
});
const project = app.visual.create({
    title: "Form / Field · reconstruction review",
  }).project,
  unit = app.visual.exploration.createWorkUnit(project.id, {
    version: 1,
    pageType: "homepage",
    label: "Homepage",
    source: "Authored interaction fixture",
  }),
  candidate = await app.visual.exploration.importCandidate(
    project.id,
    reference(unit),
    await visualFixture(0),
    "Hand-authored fixture rights",
  );
await app.pages.addMedia(project.id, {
  expectedProject: project,
  file: (await visualFixture(1)).toString("base64"),
  origin: null,
  label: "Authored placeable media",
  role: "placeable",
  permission: "Explicit synthetic media rights",
});
const browser = await chromium.launch({
    headless: true,
    ...(process.env["BVE_CHROMIUM_EXECUTABLE"]
      ? { executablePath: process.env["BVE_CHROMIUM_EXECUTABLE"] }
      : {}),
  }),
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  }),
  page = await context.newPage(),
  errors: string[] = [],
  requests: string[] = [],
  screens: string[] = [],
  checks: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) =>
  requests.push(r.method() + " " + new URL(r.url()).pathname),
);
const idle = async () =>
  expect(page.locator("#visual-app")).not.toHaveAttribute("aria-busy", "true");
const shot = async (name: string) => {
  await page
    .locator("#reconstruction-root")
    .evaluate((n) => n.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: join(evidence, name + ".png") });
  screens.push(name + ".png");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
};
const open = async () => {
  await page.goto(app.origin);
  await page.locator("#project").selectOption(project.id);
  await idle();
  await page.locator("#page").selectOption(unit.id + ":1");
  await idle();
  await expect(page.locator("#build-html")).toBeEnabled();
  await expect(page.locator("#reconstruction-root")).toContainText(
    "HTML reconstruction",
  );
};
const prepare = async (count = "1", revision = false) => {
  await page
    .locator(revision ? "#reconstruction-revise" : "#build-html")
    .click();
  await expect(page.locator("#reconstruction-sheet")).toBeVisible();
  await page
    .locator("#reconstruction-prepare [name=instruction]")
    .fill(
      "Whole-raster authored reconstruction; responsive/factual intent unknown",
    );
  await page
    .locator("#reconstruction-prepare [name=count]")
    .selectOption(count);
  await page
    .locator("#reconstruction-prepare [name=viewports]")
    .selectOption("both");
  await page
    .locator("#reconstruction-prepare details")
    .first()
    .evaluate((n) => ((n as HTMLDetailsElement).open = true));
  await page.locator("#reconstruction-prepare [name=resource]").first().check();
  await page
    .locator("#reconstruction-prepare [name=role-0]")
    .selectOption("placeable");
  await page.locator("#reconstruction-prepare button.primary").click();
  await expect(page.locator("#reconstruction-sheet")).toHaveCount(0);
  await expect(page.locator("#reconstruction-fixture")).toBeEnabled();
};
try {
  await open();
  await expect(page.locator("#conversation")).toHaveCount(0);
  const before = canonical(app.workspace.kernel.latestPackets());
  await page.locator("#build-html").click();
  await expect(page.locator("#reconstruction-sheet")).toBeVisible();
  await expect(page.locator("#reconstruction-source-identity")).toContainText(
    candidate.id,
  );
  await expect(page.locator("#reconstruction-source-identity")).toContainText(
    candidate.integrity,
  );
  await expect(
    page.locator("#reconstruction-prepare [name=count]"),
  ).toHaveValue("");
  await page.locator("#reconstruction-prepare [name=brand]").selectOption("");
  await page.keyboard.press("Escape");
  await expect(page.locator("#build-html")).toBeFocused();
  expect(canonical(app.workspace.kernel.latestPackets())).toBe(before);
  expect(driver.calls).toBe(0);
  checks.push(
    "open/controls/close creates no request; keyboard returns focus; exact whole source labelled",
  );
  await prepare();
  await expect(page.locator(".reconstruction-identity")).toContainText(
    "Whole raster",
  );
  await page.locator("#reconstruction-fixture").click();
  await expect(page.locator("#reconstruction-accept")).toBeEnabled();
  await expect(page.locator("#reconstruction-notice")).toContainText("ready");
  await expect(
    page.locator('iframe[title="Semantic implementation preview"]'),
  ).toBeVisible();
  await expect(
    page
      .frameLocator('iframe[title="Semantic implementation preview"]')
      .locator("img"),
  ).toHaveCount(1);
  expect(
    await page
      .frameLocator('iframe[title="Semantic implementation preview"]')
      .locator("img")
      .evaluate(
        (n) =>
          (n as HTMLImageElement).complete &&
          (n as HTMLImageElement).naturalWidth > 0,
      ),
  ).toBe(true);
  for (const layout of ["sheet", "film"]) {
    await page.locator("#layout").selectOption(layout);
    await idle();
    await expect(page.locator("#reconstruction-accept")).toBeEnabled();
    await shot("compare-" + layout + "-1440");
  }
  await page.locator("#reconstruction-viewport").selectOption("1");
  await expect(
    page.locator('iframe[title="Semantic implementation preview"]'),
  ).toHaveAttribute("width", "390");
  await shot("requested-narrow-preview-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Implementation", exact: true })
    .click();
  await expect(page.locator("[data-side-pane=original]")).not.toBeVisible();
  await shot("compare-implementation-390");
  await page.getByRole("button", { name: "Original", exact: true }).click();
  await expect(
    page.locator("[data-side-pane=implementation]"),
  ).not.toBeVisible();
  await shot("compare-original-390");
  await page.locator("#reconstruction-ack").check();
  await page.locator("#reconstruction-accept").click();
  await expect(page.locator("#reconstruction-export")).toBeEnabled();
  const download = page.waitForEvent("download");
  await page.locator("#reconstruction-export").click();
  const output = await download;
  await output.saveAs(join(evidence, "accepted-semantic.tar"));
  const accepted = app.reconstruction.state(
      project.id,
      reference(unit),
    ).accepted!,
    exported = (await app.pages.export(project.id, accepted)).bytes;
  expect(readFileSync(join(evidence, "accepted-semantic.tar"))).toEqual(
    exported,
  );
  checks.push(
    "both layouts, desktop paired comparison, narrow toggle, exact requested viewport, explicit accept and independent semantic export",
  );
  const standalone = mkdtempSync(join(tmpdir(), "bve-semantic-standalone-"));
  execFileSync("tar", [
    "-x",
    "-f",
    join(evidence, "accepted-semantic.tar"),
    "-C",
    standalone,
  ]);
  const standalonePage = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    }),
    standaloneRequests: string[] = [];
  standalonePage.on("request", (r) => standaloneRequests.push(r.url()));
  await standalonePage.goto(pathToFileURL(join(standalone, "index.html")).href);
  await expect(
    standalonePage.getByRole("heading", {
      name: "Everyday, reimagined.",
      exact: true,
    }),
  ).toBeVisible();
  await expect(standalonePage.locator("img")).toHaveCount(1);
  expect(
    await standalonePage
      .locator("img")
      .evaluate(
        (n) =>
          (n as HTMLImageElement).complete &&
          (n as HTMLImageElement).naturalWidth > 0,
      ),
  ).toBe(true);
  expect(standaloneRequests.every((u) => u.startsWith("file:"))).toBe(true);
  await standalonePage.screenshot({
    path: join(evidence, "standalone-semantic-export.png"),
  });
  screens.push("standalone-semantic-export.png");
  await standalonePage.close();
  rmSync(standalone, { recursive: true, force: true });
  checks.push(
    "export opens independently via file URLs with its required media and no runtime/source/Brand dependency",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await prepare("1", true);
  await expect(page.locator(".reconstruction-identity")).toContainText(
    "Whole raster",
  );
  await page.locator("#reconstruction-fixture").click();
  await expect(page.locator("#reconstruction-accept")).toBeEnabled();
  const request = app.reconstruction.state(project.id, reference(unit)).control!
    .payload.state.request;
  // A new explicit server operation must make the old review fail visibly, without replacement.
  const q = app.reconstruction.request(project.id, request),
    s = q.payload.state;
  await app.reconstruction.prepare(project.id, {
    expectedProject: project,
    workUnit: reference(unit),
    source: s.source.candidate,
    integrity: s.source.integrity,
    expectedControl: reference(
      app.reconstruction.state(project.id, reference(unit)).control!,
    ),
    instruction: "Concurrent explicit operation",
    count: 1,
    viewports: s.viewports,
    brand: null,
    base: null,
    baseSignature: null,
    resources: [],
    evidence: [],
  });
  await page.locator("#reconstruction-ack").check();
  await page.locator("#reconstruction-accept").click();
  await expect(page.locator("#reconstruction-notice")).toContainText("stale");
  expect(
    app.reconstruction.state(project.id, reference(unit)).accepted,
  ).toEqual(accepted);
  await shot("stale-review-rejection");
  await page.locator("#reconstruction-return").click();
  await page.locator("#build-html").click();
  await page
    .locator("#reconstruction-prepare [name=instruction]")
    .fill("Explicit recovery after stale review");
  await page.locator("#reconstruction-prepare [name=count]").selectOption("6");
  await page
    .locator("#reconstruction-prepare [name=viewports]")
    .selectOption("both");
  await page.locator("#reconstruction-prepare button.primary").click();
  await expect(page.locator("#reconstruction-fixture")).toBeEnabled();
  await page.locator("#reconstruction-fixture").click();
  await expect(page.locator("#reconstruction-slot option")).toHaveCount(6);
  await shot("explicit-six-attempt-recovery");
  checks.push(
    "revision pins semantic base/source; stale acceptance rejects; new explicit six-attempt recovery",
  );
  expect(app.chat.state(project.id).session.turns).toHaveLength(0);
  expect(
    requests.filter((x) => /auth\/|chat\/send|chat\/connect|api-run/.test(x)),
  ).toEqual([]);
  const normal = driver.run.bind(driver);
  let release!: () => void, entered!: () => void;
  const enteredPromise = new Promise<void>((r) => (entered = r)),
    held = new Promise<void>((r) => (release = r));
  let hold = true;
  driver.run = async (args) => {
    if (hold) {
      hold = false;
      entered();
      await held;
    }
    return normal(args);
  };
  await prepare();
  await page.locator("#reconstruction-fixture").click();
  await enteredPromise;
  await expect(page.locator("#reconstruction-cancel")).toBeEnabled();
  const cancelled = app.reconstruction.state(project.id, reference(unit))
    .control!.payload.state.request;
  await page.locator("#reconstruction-cancel").click();
  await expect(page.locator("#reconstruction-cancel")).toHaveCount(0);
  await prepare();
  const newer = app.reconstruction.state(project.id, reference(unit)).control!
    .payload.state.request;
  release();
  await expect(page.locator("#reconstruction-notice")).toContainText(
    "Historical fixture result retained",
  );
  await expect(page.locator(".reconstruction-identity")).toContainText(
    newer.id,
  );
  await expect(page.locator("#reconstruction-accept")).toHaveCount(0);
  expect(
    app.reconstruction.state(project.id, reference(unit)).accepted,
  ).toEqual(accepted);
  await shot("cancelled-late-not-adopted");
  await page.locator("#reconstruction-fixture").click();
  await expect(page.locator("#reconstruction-accept")).toBeEnabled();
  checks.push(
    "Cancel remains usable during held fixture; late old result does not replace newer displayed operation or acceptance",
  );
  await context.close();
  await app.close();
  app = await startApp(root, 0, undefined, offlineVisualProviders);
  const fresh = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await fresh.goto(app.origin);
  await fresh.locator("#project").selectOption(project.id);
  await fresh.locator("#page").selectOption(unit.id + ":1");
  await expect(fresh.locator("#reconstruction-accept")).toBeEnabled();
  await expect(fresh.locator("#reconstruction-fixture")).toHaveCount(0);
  expect((await app.pages.export(project.id, accepted)).bytes).toEqual(
    exported,
  );
  await fresh.screenshot({ path: join(evidence, "cold-reopen.png") });
  screens.push("cold-reopen.png");
  await fresh.close();
  checks.push(
    "cold reopen restores exact operation/results with production execution unavailable",
  );
  // Ordinary production preparation must never expose the test driver button as executable.
  const prodPage = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await prodPage.goto(app.origin);
  await prodPage.locator("#project").selectOption(project.id);
  await prodPage.locator("#page").selectOption(unit.id + ":1");
  await prodPage.locator("#build-html").click();
  await prodPage
    .locator("#reconstruction-prepare [name=instruction]")
    .fill("Production unavailable operation");
  await prodPage
    .locator("#reconstruction-prepare [name=count]")
    .selectOption("1");
  await prodPage
    .locator("#reconstruction-prepare [name=viewports]")
    .selectOption("both");
  await prodPage.locator("#reconstruction-prepare button.primary").click();
  await expect(prodPage.locator("#reconstruction-fixture")).toBeDisabled();
  await expect(prodPage.locator("#reconstruction-root")).toContainText(
    "Reconstruction execution unavailable",
  );
  await prodPage.screenshot({
    path: join(evidence, "production-unavailable.png"),
  });
  screens.push("production-unavailable.png");
  await prodPage.close();
  expect(errors).toEqual([]);
  writeFileSync(
    join(evidence, "result.json"),
    JSON.stringify(
      {
        head: process.env["BVE_CANDIDATE_COMMIT"] ?? null,
        checks,
        screens,
        errors,
        requests,
        fixtureCalls: driver.calls,
        accountCalls: 0,
        modelCalls: 0,
        imageProviderCalls: 0,
        gpuCalls: 0,
        actualGeneration: false,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      checks,
      screens,
      errors,
      fixtureCalls: driver.calls,
      actualGeneration: false,
    }),
  );
} finally {
  await browser.close();
  await app.close();
  rmSync(root, { recursive: true, force: true });
}
