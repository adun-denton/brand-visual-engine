// Mechanical UI fixtures plus optional visual inspection of separately session-authored designs.
import { chromium, expect } from "@playwright/test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  cpSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { startApp } from "../src/service/server.ts";
import type { RunningApp } from "../src/service/server.ts";
import { reference } from "../src/kernel/packets.ts";
import { syntheticCompositionImage } from "./composition-fixture.ts";
const evidence = resolve(
  process.env["BVE_EVIDENCE_DIR"] ?? "/tmp/bve-pages-evidence",
);
mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(join(tmpdir(), "bve-pages-browser-"));
let app: RunningApp | null = await startApp(root, 0, undefined, undefined, {
  aiResponseFixture: true,
});
const browser = await chromium.launch({
  headless: true,
  ...(process.env["BVE_CHROMIUM_EXECUTABLE"]
    ? { executablePath: process.env["BVE_CHROMIUM_EXECUTABLE"] }
    : {}),
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
const submit = async (selector: string, message: string) => {
  await page.locator(selector).locator("button").last().click();
  await expect(page.locator("#app")).not.toHaveAttribute("aria-busy", "true");
  await expect(page.locator("#notice")).toContainText(message);
};
const download = async (selector: string, name: string) => {
  const event = page.waitForEvent("download");
  await page.locator(selector).click();
  const d = await event;
  const path = join(evidence, name);
  await d.saveAs(path);
  return readFileSync(path);
};
const overflow = async () =>
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
const screenshot = async (name: string) => {
  await overflow();
  await page.screenshot({
    path: join(evidence, name + ".png"),
    fullPage: true,
  });
};
try {
  await page.goto(app.origin);
  await page.locator("#create [name=title]").fill("Synthetic inference UI");
  await page.locator("#create button[type=submit]").click();
  await expect(
    page.getByRole("heading", { name: "Design, inspect, decide." }),
  ).toBeVisible();
  const pid = app.workspace.state().projects[0]!.id;
  await page
    .locator("#studio-prepare [name=instruction]")
    .fill(
      "Mechanical fixture: explore a page with six internal sections and an unresolved local media slot.",
    );
  await submit("#studio-prepare", "Scoped AI request saved");
  const request = JSON.parse(
    (
      await download(".studio-request a:first-of-type", "request.json")
    ).toString(),
  );
  const q = app.pages.state(pid).requests[0]!;
  expect(request.requestHash).toBe(q.integrity);
  const output = {
    schema: "bve.inference-result",
    version: 1,
    requestId: q.id,
    requestHash: q.integrity,
    candidates: [
      {
        label: "Authored mechanical fixture",
        rationale:
          "Mechanical fixture only; no AI call or design quality claim.",
        page: {
          version: 1,
          title: "Mechanical grid page",
          language: "en",
          root: {
            id: "root",
            kind: "container",
            style: {
              padding: 32,
              background: "#f3ede0",
              color: "#173f45",
              fontFamily: "system-ui,sans-serif",
            },
            children: [
              {
                id: "heading",
                kind: "heading",
                level: 1,
                text: "Synthetic page fixture",
                style: { fontSize: 42 },
              },
              {
                id: "grid",
                kind: "container",
                style: {
                  display: "grid",
                  gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)",
                  gap: 16,
                },
                children: Array.from({ length: 6 }, (_, i) => ({
                  id: "section-" + i,
                  kind: "section",
                  style: { padding: 20, border: "1px solid #173f45" },
                  children: [
                    {
                      id: "copy-" + i,
                      kind: "text",
                      text: "Independent local section " + (i + 1),
                    },
                  ],
                })),
              },
              {
                id: "media",
                kind: "media",
                slot: "hero-media",
                alt: "Synthetic geometry",
                decorative: false,
              },
            ],
          },
          media: { "hero-media": null },
          responsive: [
            {
              maxWidth: 640,
              nodeId: "grid",
              style: { gridTemplateColumns: "minmax(0,1fr)" },
            },
            { maxWidth: 640, nodeId: "root", style: { padding: 16 } },
          ],
          unresolved: ["Synthetic concept only."],
        },
        mediaRequirements: [
          {
            slot: "hero-media",
            instruction: "Place the authored mechanical raster fixture.",
          },
        ],
        proposedActions: ["Critique the active page"],
      },
    ],
    findings: ["No independent designer approval."],
  };
  const apply = async (out: unknown, qr = reference(q)) => {
    await page
      .locator("#studio-apply [name=request]")
      .selectOption(JSON.stringify(qr));
    await page
      .locator("#studio-apply [name=response]")
      .fill(JSON.stringify(out));
    await page
      .locator("#studio-apply [name=source]")
      .fill("Mechanical browser fixture; no AI call");
    await page.locator("#studio-apply [name=authorship]").check();
  };
  await apply({ ...output, requestHash: "0".repeat(64) });
  await submit("#studio-apply", "exact exported request/hash");
  expect(app.pages.state(pid).pages).toHaveLength(0);
  await apply(output);
  await submit("#studio-apply", "AI proposals saved");
  expect(app.pages.state(pid).pages).toHaveLength(1);
  expect(Object.values(app.pages.state(pid).accepted)).toEqual([null]);
  await expect(
    page
      .frameLocator('iframe[title="Active page preview"]')
      .getByRole("heading", { name: "Synthetic page fixture" }),
  ).toBeVisible();
  const bytes = await syntheticCompositionImage();
  await page
    .locator("#studio-media [name=file]")
    .setInputFiles({
      name: "fixture.png",
      mimeType: "image/png",
      buffer: bytes,
    });
  await page.locator("#studio-media [name=label]").fill("Mechanical original");
  await page
    .locator("#studio-media [name=permission]")
    .fill("Authored mechanical fixture");
  await submit("#studio-media", "Independent media saved");
  await submit("#studio-place", "Media placed in new page revision");
  expect(app.pages.state(pid).pages[0]!.version).toBe(2);
  await page.locator("#studio-accept [name=reviewed]").check();
  await submit("#studio-accept", "Exact page accepted");
  const accepted =
    app.pages.state(pid).accepted[app.pages.state(pid).pages[0]!.id]!;
  expect(accepted.version).toBe(2);
  const tar = await download('a[href*="/page/export"]', "accepted-page.tar");
  await screenshot("paired-desktop");
  await page.locator("#studio-prepare [name=operation]").selectOption("revise");
  await page
    .locator("#studio-prepare [name=instruction]")
    .fill("Mechanical fixture: revise spacing while preserving the heading.");
  await page.locator("#studio-prepare [name=lock]").selectOption("heading");
  await submit("#studio-prepare", "Scoped AI request saved");
  const revision = app.pages.state(pid).requests.at(-1)!;
  const exported = app.pages.exportRequest(pid, reference(revision));
  const draft = structuredClone(exported.base)!;
  draft.root.style!.padding = 48;
  const refined = {
    ...output,
    requestId: revision.id,
    requestHash: revision.integrity,
    candidates: [{ ...output.candidates[0]!, page: draft }],
  };
  const bad = structuredClone(refined);
  bad.candidates[0]!.page.root.children![0]!.text = "Lost lock";
  await apply(bad, reference(revision));
  await submit("#studio-apply", "Preservation failed");
  expect(app.pages.state(pid).pages[0]!.version).toBe(2);
  await apply(refined, reference(revision));
  await submit("#studio-apply", "AI proposals saved");
  expect(app.pages.state(pid).pages[0]!.version).toBe(3);
  expect(app.pages.state(pid).accepted[accepted.id]!.version).toBe(2);
  await page.locator("#studio-history [name=version]").selectOption("2");
  await submit("#studio-history", "AI proposals saved");
  await expect(
    page.locator('iframe[title="Earlier page preview"]'),
  ).toBeVisible();
  await page
    .locator("#studio-website [name=title]")
    .fill("Mechanical exact site");
  await submit("#studio-website", "Website proposal saved");
  await page.locator(".studio-website-accept input[type=checkbox]").check();
  await submit(".studio-website-accept", "Exact Website accepted");
  const website = app.pages.state(pid).websites[0]!;
  expect(website.payload.state.pages[0]!.artifact.version).toBe(2);
  const websiteTar = await download(
    'a[href*="/website/export"]',
    "accepted-website.tar",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#studio-width").selectOption("narrow");
  await screenshot("paired-narrow");
  await expect(
    page.frameLocator('iframe[title="Active page preview"]').locator("#grid"),
  ).toHaveCSS("grid-template-columns", /\d+px/);
  const before = JSON.stringify(app.pages.state(pid));
  await app.close();
  app = null;
  const restored = mkdtempSync(join(tmpdir(), "bve-pages-browser-restore-"));
  cpSync(root, restored, { recursive: true });
  app = await startApp(restored, 0, undefined, undefined, {
    aiResponseFixture: true,
  });
  expect(JSON.stringify(app.pages.state(pid))).toBe(before);
  expect((await app.pages.export(pid, accepted)).bytes).toEqual(tar);
  expect(
    (await app.pages.exportWebsite(pid, reference(website))).bytes,
  ).toEqual(websiteTar);
  await page.goto(app.origin);
  await page
    .getByRole("button", { name: "Synthetic inference UI", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Design, inspect, decide." }),
  ).toBeVisible();
  await screenshot("restored-narrow");
  if (process.env["BVE_SESSION_TRIAL_DIR"]) {
    await app.close();
    app = await startApp(
      join(resolve(process.env["BVE_SESSION_TRIAL_DIR"]), "runtime"),
    );
    await page.goto(app.origin);
    await page
      .getByRole("button", { name: "Fictional Fieldwork Repair", exact: true })
      .click();
    const pid = app.workspace.state().projects[0]!.id;
    const designs = app.pages.state(pid).pages;
    expect(designs).toHaveLength(3);
    expect(
      app.pages
        .state(pid)
        .results.every(
          (r) => r.payload.state.executor.kind === "session-attested",
        ),
    ).toBe(true);
    for (const design of designs) {
      await page
        .locator("#studio-active")
        .selectOption(JSON.stringify(reference(design)));
      for (const width of [1440, 390]) {
        await page.setViewportSize({
          width,
          height: width === 1440 ? 1000 : 844,
        });
        await page
          .locator("#studio-width")
          .selectOption(width === 390 ? "narrow" : "desktop");
        await screenshot(
          design.payload.state.page.title
            .split(" — ")[0]!
            .replace(/ /g, "-")
            .toLowerCase() +
            "-workspace-" +
            width,
        );
        const full = await context.newPage();
        await full.setViewportSize({
          width,
          height: width === 1440 ? 1000 : 844,
        });
        await full.goto(
          app.origin +
            "/api/v1/page/preview?project=" +
            pid +
            "&id=" +
            design.id +
            "&version=" +
            design.version,
        );
        await full.screenshot({
          path: join(
            evidence,
            design.payload.state.page.title
              .split(" — ")[0]!
              .replace(/ /g, "-")
              .toLowerCase() +
              "-" +
              width +
              ".png",
          ),
          fullPage: true,
        });
        expect(
          await full.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await full.close();
        const frame = page.frameLocator('iframe[title="Active page preview"]');
        await expect(frame.locator("h1")).toBeVisible();
        const scrolling = await frame
          .locator("html")
          .evaluate((el) => el.scrollWidth <= el.clientWidth);
        expect(scrolling).toBe(true);
      }
    }
  }
  expect(errors).toEqual([]);
  writeFileSync(
    join(evidence, "browser-receipt.json"),
    JSON.stringify(
      {
        browser: browser.version(),
        node: process.version,
        viewports: [1440, 390],
        errors,
        mechanical: true,
        sessionVisualInspection: !!process.env["BVE_SESSION_TRIAL_DIR"],
        checks: [
          "paired preview/instruction",
          "scoped JSON download",
          "malformed hash rejection",
          "independent media upload and exact placement",
          "separate explicit acceptance",
          "preservation rejection and full snapshot revision",
          "earlier-version comparison",
          "exact accepted Website route selection",
          "byte-identical closed-copy page and Website exports",
          "narrow overflow",
          "session designs remain unaccepted",
        ],
        pageExportSHA256: createHash("sha256").update(tar).digest("hex"),
        websiteExportSHA256: createHash("sha256")
          .update(websiteTar)
          .digest("hex"),
      },
      null,
      2,
    ) + "\n",
  );
  console.log("Inference workspace browser checks passed.");
} finally {
  await app?.close();
  await context.close();
  await browser.close();
}
