import sharp from "sharp";
import { checkVisualRepairs } from "./visual-repair-browser-check.ts";
import { chromium, expect } from "@playwright/test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startApp } from "../src/service/server.ts";
import { VisualWorkspace } from "../src/service/visual-workspace.ts";
import type { ModuleProject } from "../src/kernel/contracts.ts";
import {
  seedVisual,
  visualFixture,
  offlineVisualProviders,
} from "./visual-fixture.ts";
import { canonical, reference } from "../src/kernel/packets.ts";
import type {
  Selections,
  Specification,
} from "../src/modules/website/exploration-contracts.ts";
const evidence = resolve(process.env["BVE_EVIDENCE_DIR"] ?? "../v02-evidence");
mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(join(tmpdir(), "bve-visual-browser-"));
let app = await startApp(root, 0, undefined, offlineVisualProviders);
const seeded = await seedVisual(app.workspace);
const browser = await chromium.launch({
  headless: true,
  ...(process.env["BVE_CHROMIUM_EXECUTABLE"]
    ? { executablePath: process.env["BVE_CHROMIUM_EXECUTABLE"] }
    : {}),
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
const steps: { step: string; image: string }[] = [];
const idle = async () => {
  await expect(page.locator("#visual-app")).not.toHaveAttribute(
    "aria-busy",
    "true",
  );
};
const shot = async (name: string, step = name) => {
  await page.screenshot({ path: join(evidence, name + ".png") });
  steps.push({ step, image: name + ".png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
};
const reveal = async (id: string) => {
  if (!(await page.locator(id).isVisible()))
    await page.locator(id).locator("..").locator(":scope > summary").click();
};
const submit = async (id: string) => {
  await page
    .locator(id + " button")
    .first()
    .click();
  await idle();
};
const read = async () => {
  const pid = app.workspace
    .state()
    .projects.find(
      (p) =>
        (p.payload as ModuleProject).localContext["title"]?.override ===
        "Visual walkthrough",
    )!.id;
  const v = new VisualWorkspace(app.workspace);
  const unit = v
    .project(pid)
    .units.find((u) => u.payload.state.pageType === "homepage")!;
  return { pid, unit, state: v.state(pid, reference(unit)) };
};
try {
  await page.goto(app.origin + "/visual");
  await idle();
  await page.locator("#new-project input").fill("Visual walkthrough");
  await submit("#new-project");
  await submit("#new-page");
  await expect(page.locator("#page")).toContainText("Homepage");
  for (let i = 0; i < 3; i++) {
    await reveal("#import");
    await page.locator("#import input[type=file]").setInputFiles({
      name: "fixture-" + i + ".png",
      mimeType: "image/png",
      buffer: await visualFixture(i),
    });
    await page
      .locator("#import input[name=permission]")
      .fill("Hand-authored interaction fixture; synthetic rights");
    await page.locator("#import button").click();
    await idle();
    await expect(page.locator(".candidate")).toHaveCount(i + 1);
  }
  await shot(
    "01-a-desktop",
    "Create Homepage and import three raster candidates",
  );
  await page.locator("[data-whole]").first().click();
  await idle();
  await page
    .locator("#annotation textarea")
    .fill("Keep the quiet layout as a reference");
  await page.locator("#annotation select").selectOption("exact");
  await submit("#annotation");
  await page.locator("[data-open]").nth(1).click();
  await page.locator(".focus-view").scrollIntoViewIfNeeded();
  const image = page.locator(".original").first();
  await expect(image).toBeVisible();
  const box = await image.boundingBox();
  if (!box) throw Error("No image geometry");
  // Letterbox hit never creates a region.
  const canvas = await page.locator(".canvas").first().boundingBox();
  if (!canvas) throw Error("No canvas geometry");
  const before = await read();
  await page.mouse.move(canvas.x + 2, canvas.y + 2);
  await page.mouse.down();
  await page.mouse.move(canvas.x + 8, canvas.y + 8);
  await page.mouse.up();
  expect((await read()).state.records.length).toBe(before.state.records.length);
  await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
  await page.mouse.up();
  await idle();
  const s = await read();
  const selections = s.state.records.find(
    (p) => (p.payload as { kind: string }).kind === "raster-selections",
  )!;
  const selected = (selections.payload as { state: Selections }).state;
  const anchor = selected.entries[1]!.anchor;
  if (anchor.kind !== "rectangle") throw Error("Wrong shape");
  expect(anchor.x).toBeCloseTo(0.15, 2);
  expect(anchor.y).toBeCloseTo(0.2, 2);
  expect(anchor.width).toBeCloseTo(0.45, 2);
  expect(anchor.height).toBeCloseTo(0.3, 2);
  await page.locator("#annotation textarea").fill("Make this region green");
  await page.locator("#annotation select").selectOption("include");
  await submit("#annotation");
  await expect(page.locator("#annotation option[value=exact]")).toHaveAttribute(
    "disabled",
    "",
  );
  await shot("02-a-focus", "Rectangle source and independent localized note");
  const persisted = canonical((await read()).state.records);
  await page.locator("#layout").selectOption("film");
  expect(canonical((await read()).state.records)).toBe(persisted);
  await page.locator("[data-compare]").first().click();
  await page.locator("[data-compare]").nth(1).click();
  await expect(page.locator(".comparison .canvas")).toHaveCount(2);
  await page.locator(".focus-view").scrollIntoViewIfNeeded();
  await shot(
    "03-b-comparison",
    "Switch to Filmstrip and compare two concepts without changing sources",
  );
  await page.locator("#clear-compare").click();
  await page.locator("#zoom").selectOption("2");
  const z = await page.locator(".original").first().boundingBox();
  if (!z) throw Error("No zoom geometry");
  expect(z.width).toBeGreaterThan(box.width);
  expect(canonical((await read()).state.records)).toBe(persisted);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".focus-view").scrollIntoViewIfNeeded();
  await shot(
    "04-b-narrow",
    "Filmstrip at narrow viewport; original anchors persist",
  );
  await page.locator("#zoom").selectOption("1");
  await page.locator("[data-open]").nth(2).click();
  await page.locator(".region-access summary").click();
  await page.locator("#region-form select").selectOption("ellipse");
  for (const [name, value] of Object.entries({
    x: "10",
    y: "10",
    width: "30",
    height: "40",
  }))
    await page.locator(`#region-form [name=${name}]`).fill(value);
  await submit("#region-form");
  await page
    .locator("#annotation textarea")
    .fill("Use the balance of this oval");
  await submit("#annotation");
  await page.locator("#layout").selectOption("sheet");
  await page.locator(".contact-sheet").scrollIntoViewIfNeeded();
  await shot(
    "05-a-narrow",
    "Contact sheet at narrow viewport; keyboard-accessible ellipse input",
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page
    .locator("#prepare textarea")
    .fill(
      "Explore a fresh visual with the included region and retained reference asset",
    );
  await expect(page.locator("#prepare [name=count]")).toHaveValue("");
  await expect(page.locator("#prepare [name=direction]")).toHaveValue("");
  await page.locator("#prepare [name=count]").selectOption("1");
  await page.locator("#prepare [name=direction]").selectOption("fresh");
  await page.locator("#tune-panel > summary").click();
  await page.locator("[data-number=visual-density]").fill("4.5");
  await page.locator("#prepare button.primary").click();
  await idle();
  await expect(page.locator(".prepared")).toContainText(
    "1 pending attempts prepared",
  );
  const prepared = await read();
  const spec = (
    prepared.state.records.find(
      (p) => (p.payload as { kind: string }).kind === "raster-specification",
    )!.payload as { state: Specification }
  ).state;
  expect(spec.selectionSnapshot!.entries).toHaveLength(3);
  expect(spec.metricRequests[0]!.value).toBe(4.5);
  expect(spec.executionAuthorization).toBeNull();
  expect(spec.sourceScopes.every((s) => s.style === "excluded")).toBe(true);
  await page.locator(".prepared").scrollIntoViewIfNeeded();
  await shot(
    "06-prepared",
    "Explicit pending preparation and frozen input, no execution",
  );
  // Page isolation, six attempts, and return to canonical Home selections.
  await reveal("#new-page");
  await page.locator("#new-page [name=type]").selectOption("about");
  await submit("#new-page");
  await expect(page.locator(".candidate")).toHaveCount(0);
  await expect(page.locator(".selection-item")).toHaveCount(0);
  await page.locator("#prepare textarea").fill("About Us visual intent");
  await page.locator("#prepare [name=count]").selectOption("6");
  await page.locator("#prepare [name=direction]").selectOption("follow");
  await page.locator("#prepare button.primary").click();
  await idle();
  await expect(page.locator(".prepared")).toContainText(
    "6 pending attempts prepared",
  );
  await reveal("#import");
  // EXIF-rotated JPEG is intentionally displayed in encoded orientation.
  const exif = await sharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="300" fill="#ff0000"/><rect y="300" width="400" height="300" fill="#00ff00"/></svg>',
    ),
  )
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  await page.locator("#import input[type=file]").setInputFiles({
    name: "encoded-orientation.jpg",
    mimeType: "image/jpeg",
    buffer: exif,
  });
  await page
    .locator("#import input[name=permission]")
    .fill("Synthetic orientation probe");
  await page.locator("#import button").click();
  await idle();
  await page.locator(".focus-view").scrollIntoViewIfNeeded();
  const exifImage = page.locator(".original").first();
  expect(
    await exifImage.evaluate((img) => getComputedStyle(img).imageOrientation),
  ).toBe("none");
  const pixels = await sharp(await exifImage.screenshot())
    .raw()
    .toBuffer({ resolveWithObject: true });
  const offset =
    (Math.floor(pixels.info.height * 0.2) * pixels.info.width +
      Math.floor(pixels.info.width * 0.2)) *
    pixels.info.channels;
  expect(pixels.data[offset]).toBeGreaterThan(200);
  expect(pixels.data[offset + 1]).toBeLessThan(50);
  const saved = canonical(prepared.state.records);
  await page.locator("#page").selectOption(prepared.unit.id + ":1");
  await idle();
  expect(canonical((await read()).state.records)).toBe(saved);
  await reveal("#import");
  // Explicit raster revision never redirects original anchors.
  await page.locator("#import input[type=file]").setInputFiles({
    name: "revised.png",
    mimeType: "image/png",
    buffer: await visualFixture(5),
  });
  await page
    .locator("#import input[name=permission]")
    .fill("Synthetic revised source");
  await page
    .locator("#import [name=previous]")
    .selectOption(prepared.state.candidates[0]!.id + ":1");
  await page.locator("#import button").click();
  await idle();
  expect((await read()).state.candidates).toHaveLength(4);
  const revisionState = await read();
  const oldSelections = (
    revisionState.state.records.find(
      (p) => (p.payload as { kind: string }).kind === "raster-selections",
    )!.payload as { state: Selections }
  ).state;
  expect(oldSelections.entries[0]!.candidate.version).toBe(1);
  // Keyboard activation, visible focus, no essential hover-only actions.
  await page.locator("[data-whole]").last().focus();
  await page.keyboard.press("Enter");
  await idle();
  await expect(page.locator(".selection-item")).toHaveCount(4);
  const logical = canonical((await read()).state.records);
  const currentPid = revisionState.pid;
  await context.close();
  await app.close();
  app = await startApp(root, 0, undefined, offlineVisualProviders);
  const fresh = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const reopened = await fresh.newPage();
  await reopened.goto(app.origin + "/visual");
  await expect(reopened.locator("#project")).toContainText(
    "Visual walkthrough",
  );
  await reopened.locator("#project").selectOption(currentPid);
  await expect(reopened.locator(".selection-item")).toHaveCount(4);
  expect(canonical((await read()).state.records)).toBe(logical);
  await reopened.locator("#project").selectOption(seeded.p.project.id);
  await expect(reopened.locator(".candidate")).toHaveCount(6);
  await expect(reopened.locator(".contact-sheet")).toContainText(
    "succeeded / invalid / succeeded",
  );
  await reopened.locator(".history summary").first().click();
  await expect(reopened.locator(".slot.uncertain")).toHaveCount(1);
  await expect(reopened.locator(".slot.cancelled")).toHaveCount(2);
  await expect(reopened.locator(".slot.invalid")).toHaveCount(1);
  await reopened.locator("#layout").selectOption("film");
  await reopened.locator(".focus-view").scrollIntoViewIfNeeded();
  await reopened.screenshot({ path: join(evidence, "07-b-desktop.png") });
  steps.push({
    step: "Reopen shared synthetic six-candidate state with partial outcomes",
    image: "07-b-desktop.png",
  });
  // Draw on the zoomed, resized encoded raster and verify original coordinates.
  await reopened.locator("#zoom").selectOption("2");
  await reopened.locator(".focus-view").scrollIntoViewIfNeeded();
  const zoomed = await reopened.locator(".original").first().boundingBox();
  if (!zoomed) throw Error("No zoomed image");
  await reopened.mouse.move(
    zoomed.x + zoomed.width * 0.15,
    zoomed.y + zoomed.height * 0.1,
  );
  await reopened.mouse.down();
  await reopened.mouse.move(
    zoomed.x + zoomed.width * 0.35,
    zoomed.y + zoomed.height * 0.25,
  );
  await reopened.mouse.up();
  await expect(reopened.locator(".selection-item")).toHaveCount(1);
  const zoomRecords = new VisualWorkspace(app.workspace).state(
    seeded.p.project.id,
    reference(seeded.unit),
  ).records;
  const zoomAnchor = (
    zoomRecords.find(
      (p) => (p.payload as { kind: string }).kind === "raster-selections",
    )!.payload as { state: Selections }
  ).state.entries[0]!.anchor;
  if (zoomAnchor.kind !== "rectangle") throw Error("Wrong zoom anchor");
  expect(zoomAnchor.x).toBeCloseTo(0.15, 2);
  expect(zoomAnchor.y).toBeCloseTo(0.1, 2);
  expect(zoomAnchor.width).toBeCloseTo(0.2, 2);
  expect(zoomAnchor.height).toBeCloseTo(0.15, 2);
  expect(errors).toEqual([]);
  writeFileSync(
    join(evidence, "walkthrough.json"),
    JSON.stringify(
      {
        schema: "bve.visual-interaction-evidence",
        candidate: process.env["BVE_CANDIDATE_COMMIT"] ?? "local working tree",
        browser: browser.version(),
        platform: process.platform,
        steps,
        checks: [
          "pointer original geometry",
          "EXIF encoded orientation pixels",
          "pointer zoom geometry",
          "letterbox exclusion",
          "zoom/resize immutability",
          "non-drag ellipse",
          "independent notes and exact scope",
          "layout shared state",
          "counts 1/6 and explicit direction",
          "frozen requested metric",
          "page isolation",
          "raster replacement pins old anchors",
          "keyboard whole selection",
          "closed app restart",
          "partial/uncertain/cancelled states",
        ],
        errors,
        actualModelCalls: 0,
        actualImageProviderCalls: 0,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      check: "visual-workspace",
      steps: steps.length,
      geometry: true,
      persistence: true,
      errors,
      actualModelCalls: 0,
      actualImageProviderCalls: 0,
    }),
  );
  await fresh.close();
} finally {
  await browser.close();
  await app.close();
  rmSync(root, { recursive: true, force: true });
}
await checkVisualRepairs();
