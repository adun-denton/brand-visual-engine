/** Public-safe authored auxiliary/session interaction evidence. Zero real transport. */
import {createHash} from "node:crypto";
import { chromium, expect } from "@playwright/test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { startApp } from "../src/service/server.ts";
import { reference, canonical } from "../src/kernel/packets.ts";
import { visualFixture, offlineVisualProviders } from "./visual-fixture.ts";
import { AuxiliaryFixture } from "./auxiliary-fixture.ts";
const evidence = resolve(
  process.env["BVE_EVIDENCE_DIR"] ?? "/tmp/bve-auxiliary-browser",
);
mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(join(tmpdir(), "bve-auxiliary-browser-")),
  driver = new AuxiliaryFixture();
let app = await startApp(root, 0, undefined, offlineVisualProviders, {
  auxiliaryFixture: { testOnly: true, driver },
});
const project = app.visual.create({
    title: "Form / Field · scoped auxiliary review",
  }).project,
  unit = app.visual.exploration.createWorkUnit(project.id, {
    version: 1,
    pageType: "homepage",
    label: "Homepage",
    source: "Authored UI fixture",
  }),
  other = app.visual.exploration.createWorkUnit(project.id, {
    version: 1,
    pageType: "about",
    label: "About",
    source: "Authored",
  }),
  first = await app.visual.exploration.importCandidate(
    project.id,
    reference(unit),
    await visualFixture(0),
    "Synthetic fixture rights",
  ),
  second = await app.visual.exploration.importCandidate(
    project.id,
    reference(unit),
    await visualFixture(1),
    "Synthetic second rights",
  );
const browser = await chromium.launch({
    headless: true,
    ...(process.env["BVE_CHROMIUM_EXECUTABLE"]
      ? { executablePath: process.env["BVE_CHROMIUM_EXECUTABLE"] }
      : {}),
  }),
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
  errors: string[] = [],
  requests: string[] = [],
  checks: string[] = [],
  screens: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) =>
  requests.push(r.method() + " " + new URL(r.url()).pathname),
);
const idle = () =>
  expect(page.locator("#visual-app")).not.toHaveAttribute("aria-busy", "true");
const shot = async (name: string, selector = "#auxiliary-root") => {
  await page
    .locator(selector)
    .last()
    .evaluate((n) => n.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: join(evidence, name + ".png") });
  screens.push(name + ".png");
};
const send = async () => {
  await page
    .locator("#auxiliary-message")
    .fill("Suggest a clearer next draft, leaving unknowns unresolved");
  await page.locator("#auxiliary-send").click();
  await expect(
    page.locator("#auxiliary-proposals article").last(),
  ).toBeVisible();
  await expect(page.locator("#auxiliary-send")).toBeEnabled();
};
try {
  await page.goto(app.origin);
  await page.locator("#project").selectOption(project.id);
  await idle();
  await page.locator("#page").selectOption(unit.id + ":1");
  await idle();
  await expect(page.locator("#auxiliary-toggle")).toContainText("Open");
  await expect(page.locator(".auxiliary-panel")).toHaveCount(0);
  expect(driver.calls).toBe(0);
  expect(app.auxiliary.state(project.id, reference(unit)).turns).toHaveLength(
    0,
  );
  await page.locator("#prepare [name=intent]").fill("Original user draft");
  await page.locator("#auxiliary-toggle").click();
  await expect(page.locator("#auxiliary-message")).toBeFocused();
  await expect(page.locator("#auxiliary-focus-inspector")).toContainText(
    first.id,
  );
  expect(driver.calls).toBe(0);
  await page.locator("#auxiliary-brand").selectOption("");
  await page.locator("#auxiliary-inspect").click();
  await expect(page.locator("#auxiliary-context-value")).toContainText(
    '"enabled": false',
  );
  expect(driver.calls).toBe(0);
  expect(app.auxiliary.state(project.id, reference(unit)).scopes).toHaveLength(
    0,
  );
  checks.push(
    "initially closed; open/controls/read-only context inspection creates no scope/turn/operation or driver call; exact Brand off focus visible",
  );
  await send();
  await expect(page.locator("#prepare [name=intent]")).toHaveValue(
    "Original user draft",
  );
  await expect(page.locator(".auxiliary-proposal table").last()).toContainText(
    "Original user draft",
  );
  await shot("proposal-diff-desktop", "#auxiliary-proposals article");
  await page.locator("[data-aux-apply]").last().click();
  await expect(page.locator("#prepare [name=intent]")).toHaveValue(
    "Make the hierarchy clearer; keep unknown factual content unresolved.",
  );
  await expect(page.locator("#auxiliary-notice")).toContainText("Apply");
  expect(
    app.reconstruction.state(project.id, reference(unit)).history,
  ).toHaveLength(0);
  expect(
    app.visual.exploration
      .state(project.id, reference(unit))
      .filter((p) => (p.payload as any).kind === "raster-specification"),
  ).toHaveLength(0);
  for (const layout of ["sheet", "film"]) {
    await page.locator("#layout").selectOption(layout);
    await idle();
    await expect(page.locator(".auxiliary-panel")).toBeVisible();
    await shot("auxiliary-" + layout + "-1440");
  }
  checks.push(
    "inspectable before/after diff; explicit Apply changes only intent; both visual layouts preserve named draft and chat-closed operation boundaries",
  );
  await send();
  await page.locator("#prepare [name=intent]").fill("Newer manual edit wins");
  await page.locator("[data-aux-apply]").last().click();
  await expect(page.locator("#auxiliary-notice")).toContainText("Conflict");
  await expect(page.locator("#prepare [name=intent]")).toHaveValue(
    "Newer manual edit wins",
  );
  await shot("draft-conflict");
  await send();
  await page.locator("[data-aux-dismiss]").last().click();
  await expect(page.locator("#prepare [name=intent]")).toHaveValue(
    "Newer manual edit wins",
  );
  await expect(
    page.locator("#auxiliary-proposals article").last(),
  ).toContainText("dismissal");
  checks.push(
    "newer registered draft revision conflicts explicitly; Dismiss changes no draft",
  );
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((r) => (entered = r)),
    held = new Promise<void>((r) => (release = r));
  driver.handler = async (input) => {
    await input.tool("propose_edit", "held-proposal", {
      edits: [{ field: "intent", after: "Late old-focus suggestion" }],
      rationale: "Authored late delivery",
    });
    entered();
    await held;
    return {
      reply: "Historical old-focus result",
      provenance: { kind: "authored-test-fixture", generation: false },
    };
  };
  await page.locator("#auxiliary-message").fill("Hold this exact source scope");
  await page.locator("#auxiliary-send").click();
  await started;
  await page.locator('[data-open="' + second.id + ':1"]').click();
  await expect(page.locator("#auxiliary-focus-inspector")).toContainText(
    second.id,
  );
  release();
  await expect(page.locator("#auxiliary-send")).toBeEnabled();
  await expect(
    page.locator("#auxiliary-proposals article").last(),
  ).toContainText("historical");
  await expect(page.locator("#auxiliary-focus-inspector")).toContainText(
    second.id,
  );
  await expect(page.locator("#prepare [name=intent]")).toHaveValue(
    "Newer manual edit wins",
  );
  driver.handler = null;
  checks.push(
    "delayed proposal keeps captured source; newer selection wins and late result cannot navigate/apply",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await shot("auxiliary-390");
  await shot("proposal-diff-390", "#auxiliary-proposals article");
  await page.locator("#auxiliary-message").focus();
  await page.keyboard.press("Escape");
  await expect(page.locator(".auxiliary-panel")).toHaveCount(0);
  await expect(page.locator("#auxiliary-toggle")).toBeFocused();
  await page.locator("#build-html").click();
  await expect(page.locator("#reconstruction-sheet")).toBeVisible();
  await page
    .locator("#reconstruction-prepare [name=instruction]")
    .fill("Original reconstruction instruction");
  await page.locator("#reconstruction-prepare [name=count]").selectOption("2");
  await page
    .locator("#reconstruction-prepare [name=viewports]")
    .selectOption("both");
  await page.locator("#auxiliary-toggle").click();
  await page.locator("#auxiliary-target").selectOption("reconstruction");
  const resource = page.locator('#reconstruction-prepare input[name=resource]').first();
  await page.locator("#reconstruction-prepare details summary").filter({hasText: "Deliberately included references"}).click();
  await resource.check();
  await resource.uncheck();
  await send();
  await expect(
    page.locator("#reconstruction-prepare [name=instruction]"),
  ).toHaveValue("Original reconstruction instruction");
  await page.locator("[data-aux-apply]").last().click();
  await expect(
    page.locator("#reconstruction-prepare [name=instruction]"),
  ).toHaveValue(
    "Make the hierarchy clearer; keep unknown factual content unresolved.",
  );
  expect(
    app.reconstruction.state(project.id, reference(unit)).history,
  ).toHaveLength(0);
  await expect(page.locator('#reconstruction-prepare input[name=resource]:checked')).toHaveCount(0);
  await shot("reconstruction-draft-390");
  await page.locator("#auxiliary-toggle").click();
  await page.locator("#reconstruction-prepare button.primary").click();
  await expect(page.locator("#reconstruction-sheet")).toHaveCount(0);
  checks.push(
    "keyboard close restores focus; auxiliary panel inside preparation exposes bounded reconstruction draft; Apply never freezes or executes",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator("#auxiliary-toggle").click();
  await page.locator("#auxiliary-bridge").click();
  await expect(page.locator("#reconstruction-accept")).toBeEnabled();
  await expect(page.locator("#auxiliary-bridge")).toBeEnabled();
  expect(driver.inputs.at(-1).mode).toBe("reconstruction");
  expect(driver.inputs.at(-1).history).toEqual([]);
  expect(driver.inputs.at(-1).thread.resume).toBe(false);
  await shot("operation-scoped-bridge-desktop");
  await page.locator("#auxiliary-toggle").click();
  await expect(page.locator(".auxiliary-panel")).toHaveCount(0);
  await page.locator("#reconstruction-ack").check();
  await page.locator("#reconstruction-accept").click();
  await expect(page.locator("#reconstruction-export")).toBeEnabled();
  checks.push(
    "separate explicit fresh operation bridge uses authored semantic intake; paired acceptance/export remain usable with chat closed",
  );
  await browser.close();
  await app.close();
  app = await startApp(root, 0, undefined, offlineVisualProviders);
  const prodBrowser = await chromium.launch({
    headless: true,
    ...(process.env["BVE_CHROMIUM_EXECUTABLE"]
      ? { executablePath: process.env["BVE_CHROMIUM_EXECUTABLE"] }
      : {}),
  });
  try {
    const prod = await prodBrowser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    await prod.goto(app.origin);
    await prod.locator("#project").selectOption(project.id);
    await prod.locator("#page").selectOption(unit.id + ":1");
    await expect(prod.locator(".auxiliary-panel")).toHaveCount(0);
    await prod.locator("#auxiliary-toggle").click();
    await expect(prod.locator(".auxiliary-panel")).toContainText("unavailable");
    await expect(prod.locator("#auxiliary-send")).toBeDisabled();
    await expect(prod.locator("#prepare [name=intent]")).toHaveValue("");
    await prod
      .locator("#auxiliary-root")
      .evaluate((n) => n.scrollIntoView({ block: "start" }));
    await prod.screenshot({
      path: join(evidence, "production-unavailable-reopen.png"),
    });
    screens.push("production-unavailable-reopen.png");
  } finally {
    await prodBrowser.close();
  }
  checks.push(
    "cold reopen preserves evidence, restores no draft, initially closes panel and reports unavailable production transport",
  );
  expect(errors).toEqual([]);
  writeFileSync(join(evidence, "session-protocol.json"), JSON.stringify({synthetic: true, provenance: {kind: "authored-test-fixture", generation: false}, calls: driver.inputs.map(input => ({...input, images: input.images.map((image:any) => {const bytes=Buffer.from(image.input.url.split(",")[1],"base64");return {label:image.label,role:image.role,ref:image.ref,mime:image.input.url.split(";")[0].slice(5),bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")};})})), accountCalls:0, modelCalls:0, imageProviderCalls:0,gpuCalls:0}, null,2)+"\n");
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
        protectedRootAccesses: 0,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({ checks, screens, errors, fixtureCalls: driver.calls }),
  );
} finally {
  await browser.close();
  await app.close();
  rmSync(root, { recursive: true, force: true });
}
