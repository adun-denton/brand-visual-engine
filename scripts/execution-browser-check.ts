import { chromium, expect } from "@playwright/test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startApp } from "../src/service/server.ts";
import { reference } from "../src/kernel/packets.ts";
import { offlineVisualProviders } from "./visual-fixture.ts";
import { OfflineRasterTransport } from "./execution-fixture.ts";
const evidence = resolve(process.env["BVE_EVIDENCE_DIR"] ?? "../v03-evidence");
mkdirSync(evidence, { recursive: true });
const roots: string[] = [];
const browser = await chromium.launch({
  headless: true,
  ...(process.env["BVE_CHROMIUM_EXECUTABLE"]
    ? { executablePath: process.env["BVE_CHROMIUM_EXECUTABLE"] }
    : {}),
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  }),
  page = await context.newPage(),
  errors: string[] = [],
  screens: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
const idle = async () => {
  await expect(page.locator("#visual-app")).not.toHaveAttribute(
    "aria-busy",
    "true",
  );
};
const shot = async (name: string) => {
  await page.screenshot({
    path: join(evidence, name + ".png"),
    fullPage: true,
  });
  screens.push(name + ".png");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
};
let app: Awaited<ReturnType<typeof startApp>> | undefined;
try {
  for (const offline of [false, true]) {
    const root = mkdtempSync(join(tmpdir(), "bve-execution-browser-"));
    roots.push(root);
    const transport = new OfflineRasterTransport();
    app = await startApp(
      root,
      0,
      undefined,
      offlineVisualProviders,
      offline ? { executionFixture: { testOnly: true, transport } } : undefined,
    );
    const p = app.visual.create({
        title: offline ? "Offline execution review" : "No executor review",
      }),
      u = app.visual.exploration.createWorkUnit(p.project.id, {
        version: 1,
        pageType: "homepage",
        label: "Homepage",
        source: "Fixture",
      });
    await page.goto(app.origin + "/visual");
    await idle();
    await page.locator("#project").selectOption(p.project.id);
    await idle();
    await page.locator("#page").selectOption(u.id + ":" + u.version);
    await idle();
    if (!offline) {
      await expect(
        page.getByText(
          "No connected executor. Preparation does not authorize execution.",
        ),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Execute · no connected executor" }),
      ).toBeDisabled();
      await shot("01-production-unavailable-desktop");
      await page.setViewportSize({ width: 390, height: 844 });
      await shot("02-production-unavailable-narrow");
      await page.setViewportSize({ width: 1440, height: 1000 });
      await app.close();
      app = undefined;
      continue;
    }
    const prepare = async (count: number, intent: string) => {
      await page.locator("#prepare [name=intent]").fill(intent);
      await page.locator("#prepare [name=count]").selectOption(String(count));
      await page.locator("#prepare [name=direction]").selectOption("fresh");
      await page.locator("#prepare button.primary").click();
      await idle();
    };
    const grant = async (specIndex = -1, submissions = 1) => {
      const panel = page.locator("#execution-panel");
      if ((await panel.getAttribute("open")) === null)
        await panel.locator("summary").click();
      const values = await page
        .locator("#execution-grant [name=spec] option")
        .evaluateAll((xs) =>
          xs.map((x) => (x as HTMLOptionElement).value).filter(Boolean),
        );
      await page
        .locator("#execution-grant [name=spec]")
        .selectOption(values.at(specIndex)!);
      for (const [key, value] of Object.entries({
        width: 64,
        height: 48,
        submissions,
        status: 12,
        cancels: 6,
        timeout: 1000,
        expires: 3600,
      }))
        await page
          .locator(`#execution-grant [name=${key}]`)
          .fill(String(value));
      await page.locator("#execution-grant input[type=checkbox]").check();
      await page
        .getByRole("button", { name: "Grant offline execution", exact: true })
        .click();
      await idle();
    };
    const runArticles = () => page.locator(".execution-run");
    const latest = () => runArticles().last();
    const action = async (name: string) => {
      await latest().getByRole("button", { name, exact: true }).click();
      await idle();
    };
    transport.mode = "mixed";
    await prepare(6, "Six bounded offline attempts");
    await grant(-1, 6);
    expect(transport.submissions.length).toBe(0);
    await shot("03-offline-prepared-desktop");
    await action("Execute granted slots");
    await expect(latest()).toContainText("Attempt 2 · invalid");
    expect(transport.submissions.length).toBe(6);
    expect(app.visual.state(p.project.id, reference(u)).candidates.length).toBe(
      3,
    );
    await shot("04-offline-partial-desktop");
    // Deliberate retry needs a new grant and a single original slot. No transport on preparation.
    await latest().locator('[data-execution-retry][data-slot="2"]').click();
    await expect(page.locator("#execution-grant")).toContainText(
      "new grant required",
    );
    await grant(-1, 1);
    expect(transport.submissions.length).toBe(6);
    transport.mode = "immediate";
    await action("Execute granted slots");
    expect(transport.submissions.length).toBe(7);
    await expect(latest()).toContainText("Attempt 2 · succeeded");
    await shot("05-offline-deliberate-retry");
    transport.mode = "running";
    await prepare(1, "Cancellation fixture");
    await grant();
    await action("Execute granted slots");
    await expect(latest()).toContainText("running");
    await action("Cancel this execution");
    await expect(latest()).toContainText("cancel requested / confirmed");
    await shot("06-offline-cancel-desktop");
    await latest().getByRole("button", { name: "Reconcile owned job" }).click();
    await idle();
    expect(app.visual.state(p.project.id, reference(u)).candidates.length).toBe(
      4,
    );
    transport.mode = "ambiguous";
    await prepare(1, "Uncertain send fixture");
    await grant();
    await action("Execute granted slots");
    await expect(latest()).toContainText("uncertain");
    await expect(
      latest().getByRole("button", { name: "Execute granted slots" }),
    ).toBeDisabled();
    await shot("07-offline-uncertain-desktop");
    const sent = transport.submissions.length;
    await page.reload();
    await idle();
    await page.locator("#project").selectOption(p.project.id);
    await idle();
    await page.locator("#page").selectOption(u.id + ":" + u.version);
    await idle();
    expect(transport.submissions.length).toBe(sent);
    await latest().getByRole("button", { name: "Reconcile owned job" }).click();
    await idle();
    expect(transport.submissions.length).toBe(sent);
    await shot("08-offline-reconciled-desktop");
    await page.setViewportSize({ width: 390, height: 844 });
    await shot("09-offline-sheet-narrow");
    await page.locator("#layout").selectOption("film");
    await shot("10-offline-filmstrip-narrow");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await shot("11-offline-filmstrip-desktop");
    const runs = app.visual.executions.state(p.project.id, reference(u));
    expect(runs.length).toBe(4);
    expect(
      runs
        .flatMap((r) => r.run.payload.state.calls)
        .filter((c) => c.kind === "submit").length,
    ).toBe(9);
    expect(errors).toEqual([]);
    const receipt = {
      check: "v03-execution-browser",
      candidate: process.env["BVE_CANDIDATE_COMMIT"] ?? "unpublished",
      node: process.version,
      browser: browser.version(),
      platform: process.platform,
      checks: [
        "production-unavailable",
        "explicit-grant-separate-execute",
        "count-six-partial-failure",
        "new-grant-manual-retry",
        "owned-cancellation-and-late-result",
        "uncertainty-no-resend-reload-reconcile",
        "both-layouts-desktop-narrow",
      ],
      screenshots: screens,
      errors,
      actualModelCalls: 0,
      actualImageProviderCalls: 0,
      offlineSubmissions: transport.submissions.length,
      offlineStatusCalls: transport.polls.length,
      offlineCancellationCalls: transport.cancellations.length,
    };
    writeFileSync(
      join(evidence, "execution.json"),
      JSON.stringify(receipt, null, 2),
    );
    console.log(JSON.stringify(receipt));
    await app.close();
    app = undefined;
  }
} finally {
  if (app) await app.close();
  await browser.close();
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}
