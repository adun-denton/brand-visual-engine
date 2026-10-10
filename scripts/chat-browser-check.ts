// Form-free normal path with injected mechanical model/tool responses; zero GPT/image calls.
import { chromium, expect } from "@playwright/test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { startApp } from "../src/service/server.ts";
import { ChatFixture } from "./chat-fixture.ts";
import { reference } from "../src/kernel/packets.ts";
import { syntheticCompositionImage } from "./composition-fixture.ts";
const evidence = resolve(
  process.env["BVE_EVIDENCE_DIR"] ?? "/tmp/bve-chat-browser",
);
mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(join(tmpdir(), "bve-chat-browser-"));
const fixture = new ChatFixture();
let app = await startApp(root, 0, undefined, undefined, {
  chatDriver: fixture,
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
  }),
  page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
const send = async (text: string) => {
  const count = await page.locator(".chat-transcript .chat-reply").count();
  await page.locator("#chat-message").fill(text);
  await page.locator("#chat-send button[type=submit]").click();
  await expect(page.locator(".chat-transcript .chat-reply")).toHaveCount(
    count + 1,
  );
  await expect(
    page.locator(".chat-transcript .chat-reply").last(),
  ).toContainText("completed");
  await expect(page.locator("#chat-send button[type=submit]")).toBeEnabled();
  await expect(page.locator("#chat-message")).toHaveValue("");
};
const screen = async (name: string) => {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: join(evidence, name + ".png"),
    fullPage: true,
  });
};
try {
  await page.goto(app.origin);
  await expect(page.locator("#create")).not.toBeVisible();
  await send(
    "Make a landing page for a bicycle repair shop, friendly and practical",
  );
  await expect(page.locator("#chat-preview")).toBeVisible();
  await expect(page.locator("#studio-prepare")).not.toBeVisible();
  await expect(page.locator("[data-chat-candidate]")).toHaveCount(2);
  const pid = app.workspace.state().projects[0]!.id;
  const first = app.pages.state(pid).pages[0]!;
  await page.locator("[data-chat-candidate]").first().click();
  await page.locator("[data-chat-compare]").click();
  await page.getByRole("button", { name: "04  History", exact: true }).click();
  await expect(page.locator(".chat-transcript")).toContainText(
    "bicycle repair",
  );
  const before = fixture.calls;
  await page
    .getByRole("button", { name: "01  Brief & references", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Design workspace", exact: false })
    .click();
  expect(fixture.calls).toBe(before);
  await send("Make it calmer and keep the heading");
  await expect(page.locator("#chat-preview")).toBeVisible();
  const latest = app.pages.state(pid).pages.find((x) => x.id === first.id)!;
  expect(latest.version).toBe(2);
  expect(latest.payload.state.page.root.children![0]!.text).toBe(
    first.payload.state.page.root.children![0]!.text,
  );
  await page.locator("[data-chat-compare]").click();
  await expect(page.locator(".chat-comparison iframe")).toHaveCount(2);
  await screen("create-refine-compare-desktop");
  await page.locator("#chat-findings").check();
  await page.locator("[data-chat-accept]").click();
  await expect(
    page.getByRole("link", { name: "Export accepted page" }),
  ).toBeVisible();
  const accepted = app.pages.state(pid).accepted[first.id]!;
  const exportBefore = (await app.pages.export(pid, accepted)).bytes;
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export accepted page" }).click();
  await (await download).saveAs(join(evidence, "accepted-handoff.tar"));
  await page.setViewportSize({ width: 390, height: 844 });
  await screen("conversation-narrow");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await send("Give a critique of this candidate");
  expect(
    app.pages.state(pid).pages.find((x) => x.id === first.id)!.version,
  ).toBe(2);
  // Actual browser attachment: only deliberately included file receives a tool handle.
  const image = await syntheticCompositionImage();
  await page.locator("#chat-attach").setInputFiles({
    name: "synthetic.png",
    mimeType: "image/png",
    buffer: image,
  });
  await expect(page.locator("[data-chat-remove]")).toHaveCount(1);
  // Add a synthetic media slot to the independent page so direct canvas interaction has an exact target.
  await app.pages.addMedia(pid, {
    expectedProject: reference(app.workspace.project(pid)),
    file: image.toString("base64"),
    origin: null,
    label: "Synthetic canvas original",
    role: "placeable",
    permission: "Mechanical fixture permission",
  });
  const m = app.pages.state(pid).media.at(-1)!;
  const p = app.pages.state(pid).pages.find((x) => x.id === first.id)!;
  const mediaPage = {
    ...p.payload.state.page,
    media: { hero: null },
    root: {
      ...p.payload.state.page.root,
      children: [
        ...p.payload.state.page.root.children!,
        {
          id: "canvas-image",
          kind: "media" as const,
          slot: "hero",
          alt: "Synthetic product",
          decorative: false,
        },
      ],
    },
  };
  app.pages.save(pid, {
    artifact: reference(p),
    page: mediaPage,
    reason: "Mechanical image target fixture",
  });
  await app.pages.place(pid, {
    artifact: { ...reference(p), version: 3 },
    slot: "hero",
    media: reference(m),
    reason: "Mechanical exact placement",
  });
  await page.reload();
  await page.locator(`[data-action=open][data-id="${pid}"]`).click();
  await page
    .locator("[data-chat-candidate]")
    .filter({ hasText: "Calmer revision · v4" })
    .click();
  await expect(page.locator("[data-chat-image]")).toBeVisible();
  await page.locator("[data-chat-image]").click();
  await expect(page.locator("#chat-mask")).toBeVisible();
  await page.locator("#chat-mask").scrollIntoViewIfNeeded();
  const box = (await page.locator("#chat-mask").boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.7);
  await page.mouse.up();
  await expect(page.locator("#chat-mask-receipt")).toContainText(
    "Original pixels",
  );
  await send("Make the handle thinner; keep the rest");
  await expect(page.locator(".chat-image-job")).toContainText(
    "image engine unavailable",
  );
  const job = app.chat.state(pid).jobs.at(-1)!;
  expect(job.target.page.version).toBe(4);
  expect(job.target.media).toEqual(reference(m));
  expect(job.dimensions.width).toBe(m.payload.state.image.width);
  const chooser = page.waitForEvent("filechooser");
  await page.locator("[data-chat-return]").last().click();
  await (
    await chooser
  ).setFiles({
    name: "returned-synthetic.png",
    mimeType: "image/png",
    buffer: image,
  });
  await expect(page.locator("[data-chat-permit]")).toBeVisible();
  await page.locator("[data-chat-permit]").click();
  await expect(page.locator("#notice")).toContainText(
    "Usage permission confirmed",
  );
  await page.locator("[data-chat-place]").click();
  await expect(page.frameLocator("#chat-preview").locator("img")).toBeVisible();
  await expect
    .poll(() =>
      page
        .frameLocator("#chat-preview")
        .locator("img")
        .evaluate(
          (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
        ),
    )
    .toBe(true);
  await expect(page.locator("#notice")).toContainText("Image candidate chosen");
  await expect(page.locator("#notice")).not.toContainText("reference-only");
  expect(app.pages.state(pid).accepted[first.id]).toEqual(accepted);
  expect((await app.pages.export(pid, accepted)).bytes).toEqual(exportBefore);
  await screen("image-prepare-return-preview");
  // Stop retains exact accepted bytes. Switching view does not issue a model call.
  await page.locator("#chat-message").fill("slow refinement");
  await page.locator("#chat-send button[type=submit]").click();
  await expect(page.locator("#chat-stop")).toBeEnabled();
  await page.locator("#chat-stop").click();
  await expect(page.locator(".chat-reply").last()).toContainText("cancelled");
  expect((await app.pages.export(pid, accepted)).bytes).toEqual(exportBefore);
  await page.getByRole("button", { name: "+ New workspace" }).click();
  await expect(page.locator(".chat-transcript .chat-reply")).toHaveCount(0);
  await send("Make an exhibition site for a fictional night garden");
  await expect(page.locator("[data-chat-candidate]")).toHaveCount(2);
  const second = app.workspace.state().projects.find((x) => x.id !== pid)!;
  expect(app.pages.state(second.id).pages[0]!.payload.state.page.media).toEqual(
    {},
  );
  await screen("different-brief-zero-images");
  const port = Number(new URL(app.origin).port);
  await page.goto("about:blank");
  await app.close();
  app = await startApp(root, port, undefined, undefined, {
    chatDriver: new ChatFixture(),
    aiResponseFixture: true,
  });
  await page.goto(app.origin);
  await page.locator(`[data-action=open][data-id="${pid}"]`).click();
  await expect(page.locator(".chat-transcript")).toContainText(
    "bicycle repair",
  );
  expect((await app.pages.export(pid, accepted)).bytes).toEqual(exportBefore);
  expect(app.chat.state(pid).session.threadId).toContain("fixture-thread-");
  expect(errors).toEqual([]);
  expect(await page.locator("#chat-advanced").getAttribute("open")).toBe(null);
  writeFileSync(
    join(evidence, "receipt.json"),
    JSON.stringify(
      {
        root,
        scenarios: [
          "two distinct briefs",
          "zero images",
          "arbitrary alternatives",
          "exact heading refinement",
          "critique",
          "cross-view context",
          "reference attachment",
          "original mask geometry",
          "unavailable engine",
          "returned image permission and preview",
          "cancel",
          "restart accepted export",
        ],
        modelCalls: "injected mechanical fixture",
        realGPTCalls: 0,
        realImageCalls: 0,
        typedInputs: ["conversation text"],
        manualJSON: false,
        legacyFormInputsUsed: false,
        errors,
        passed: true,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "Chat browser: 12 scenarios passed; no legacy form input or JSON; zero GPT/image calls.",
  );
} catch (error) {
  await page
    .screenshot({ path: join(evidence, "failure.png"), fullPage: true })
    .catch(() => {});
  writeFileSync(
    join(evidence, "failure.json"),
    JSON.stringify(
      {
        errors,
        body: await page
          .locator("body")
          .innerText()
          .catch(() => ""),
        sessions: app.workspace
          .state()
          .projects.map((p) => app.chat.state(p.id)),
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await context.close();
  await browser.close();
  await app.close();
}
