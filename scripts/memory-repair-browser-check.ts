import { expect, type Browser } from "@playwright/test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { startApp } from "../src/service/server.ts";
import { reference } from "../src/kernel/packets.ts";
import { parseIndex } from "../src/modules/website/memory-contracts.ts";
import { offlineVisualProviders } from "./visual-fixture.ts";
export async function checkMemoryRepairs(browser: Browser, evidence: string) {
  const root = mkdtempSync(join(tmpdir(), "bve-memory-loss-browser-"));
  let app = await startApp(root, 0, undefined, offlineVisualProviders);
  const screens: string[] = [],
    errors: string[] = [];
  let context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  try {
    const pid = app.visual.create({
        title: "Missing primary evidence · synthetic fixture",
      }).project.id,
      u = app.visual.exploration.createWorkUnit(pid, {
        version: 1,
        pageType: "homepage",
        label: "Homepage",
        source: "Synthetic loss probe",
      }),
      other = app.visual.exploration.createWorkUnit(pid, {
        version: 1,
        pageType: "about",
        label: "About",
        source: "Synthetic fixture",
      }),
      n = app.memory.saveNote(pid, {
        expected: null,
        note: {
          version: 1,
          scope: reference(u),
          text: "Sole saved handoff note: do not infer missing content",
          source: "human-authored",
          evidence: [],
        },
      });
    app.memory.createCapsule(pid, { scope: reference(u), previous: null });
    const db = new DatabaseSync(join(root, "kernel.sqlite"));
    db.prepare("DELETE FROM kernel_packets WHERE id=? AND version=1").run(n.id);
    db.close();
    let page = await context.newPage();
    const enter = async () => {
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(app.origin + "/visual");
      await page.locator("#project").selectOption(pid);
      await expect(page.locator("#visual-app")).not.toHaveAttribute(
        "aria-busy",
        "true",
      );
      await page.locator("#page").selectOption(u.id + ":1");
      await expect(page.locator("#visual-app")).not.toHaveAttribute(
        "aria-busy",
        "true",
      );
      await page.locator("#memory-panel>summary").click();
      await page.locator("#memory-load").click();
      await expect(page.locator("#memory-status")).toContainText("loaded");
    };
    await enter();
    const exact = () =>
      page.locator('[data-memory-evidence="' + n.id + ':1"]:visible');
    await expect(exact()).toHaveCount(1);
    await expect(exact().locator("..")).toContainText("missing");
    await expect(exact().locator("..")).toContainText("page scope unknown");
    await exact().click();
    await expect(page.locator("#memory-evidence-json")).toContainText(
      '"status": "missing"',
    );
    await expect(page.locator("#memory-evidence-json")).toContainText(
      '"summary": null',
    );
    await page.locator("#memory-create").click();
    await expect(page.locator("#memory-currency")).toHaveText("incomplete");
    await expect(page.locator("#memory-availability")).toContainText(
      "1 missing",
    );
    const shot = async (name: string) => {
      await expect(page.locator("#memory-create")).toBeEnabled();
      await page
        .locator("#memory-panel")
        .evaluate((n) => n.scrollIntoView({ block: "start" }));
      await page.screenshot({ path: join(evidence, name + ".png") });
      screens.push(name + ".png");
    };
    await shot("08-r1-missing-primary-sheet-desktop");
    const downloadEvent = page.waitForEvent("download");
    await page.locator("#memory-download").click();
    const downloaded = await downloadEvent,
      path = await downloaded.path(),
      index = parseIndex(JSON.parse(readFileSync(path!, "utf8")));
    expect(
      index.entries.some(
        (e) =>
          e.ref.id === n.id && e.status === "missing" && e.summary === null,
      ),
    ).toBe(true);
    await page.locator("#page").selectOption(other.id + ":1");
    await expect(page.locator("#visual-app")).not.toHaveAttribute(
      "aria-busy",
      "true",
    );
    await page.locator("#memory-panel>summary").click();
    await page.locator("#memory-load").click();
    await expect(exact()).toHaveCount(1);
    await expect(exact().locator("..")).toContainText("page scope unknown");
    await page.locator("#page").selectOption(u.id + ":1");
    await expect(page.locator("#visual-app")).not.toHaveAttribute(
      "aria-busy",
      "true",
    );
    await page.locator("#layout").selectOption("film");
    await page.setViewportSize({ width: 390, height: 844 });
    await shot("09-r1-missing-primary-filmstrip-narrow");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await context.close();
    await app.close();
    app = await startApp(root, 0, undefined, offlineVisualProviders);
    context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    page = await context.newPage();
    await enter();
    await expect(exact()).toHaveCount(1);
    await page.locator("[data-memory-capsule]").first().click();
    await expect(page.locator("#memory-currency")).toHaveText("incomplete");
    await expect(page.locator("#memory-availability")).toContainText(
      "1 missing",
    );
    await shot("10-r1-missing-primary-fresh-reader");
    expect(errors).toEqual([]);
    const receipt = {
      check: "v04-repairs-r12",
      candidate: process.env["BVE_CANDIDATE_COMMIT"] ?? "working-tree",
      browser: browser.version(),
      platform: process.platform,
      ledgerKnownMissingPrimary: true,
      scopeUnknownNoMembership: true,
      incompleteSnapshotDownload: true,
      freshReaderRetainsLoss: true,
      errors,
      screenshots: screens,
      actualModelCalls: 0,
      actualImageProviderCalls: 0,
    };
    writeFileSync(
      join(evidence, "memory-repairs.json"),
      JSON.stringify(receipt, null, 2),
    );
    console.log(JSON.stringify(receipt));
  } finally {
    await context.close();
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
}
