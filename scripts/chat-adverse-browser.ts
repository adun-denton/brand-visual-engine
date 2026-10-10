// Real browser boundary regressions with synthetic validators/media; no accounts or inference.
import type { Browser } from "@playwright/test";
import { expect } from "@playwright/test";
import { createServer, request } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startApp } from "../src/service/server.ts";
import { ChatAuth } from "../src/service/chat-auth.ts";
import { ChatFixture } from "./chat-fixture.ts";
import { seedRepairPage } from "./inference-repair-fixture.ts";
import { syntheticCompositionImage } from "./composition-fixture.ts";
import { reference } from "../src/kernel/packets.ts";
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}
export async function chatAdverseBrowser(browser: Browser, evidence: string) {
  const app = await startApp(mkdtempSync(join(tmpdir(), "bve-chat-adverse-")), 0, undefined, undefined, { chatDriver: new ChatFixture(), aiResponseFixture: true });
  const foreign = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(`<a href="${app.origin}/auth/callback?state=valid-synthetic&code=synthetic">Return</a><a href="${app.origin}/auth/callback?state=wrong&code=synthetic">Wrong return</a>`);
  });
  const originalCallback = ChatAuth.prototype.callback;
  const callbacks: { state: string | null; site: string | undefined }[] = [];
  let calls = 0;
  try {
    // Replace only validation. Production HTTP guards and routing remain in place.
    ChatAuth.prototype.callback = async function(params) {
      calls++;
      if (params.get("state") !== "valid-synthetic") throw Error("Wrong synthetic state");
      return { connected: true };
    };
    await new Promise<void>((r) => foreign.listen(0, "0.0.0.0", r));
    const foreignPort = (foreign.address() as { port: number }).port;
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      app.server.prependListener("request", (req) => {
        const url = new URL(req.url ?? "/", app.origin);
        if (url.pathname === "/auth/callback") callbacks.push({ state: url.searchParams.get("state"), site: req.headers["sec-fetch-site"] as string | undefined });
      });
      await page.goto(`http://localhost:${foreignPort}`);
      const response = page.waitForResponse((r) => r.url().includes("/auth/callback"));
      await page.getByRole("link", { name: "Return", exact: true }).click();
      expect((await response).status()).toBe(200);
      expect(calls).toBe(1);
      expect(callbacks[0]!.site).toBe("cross-site");
      await expect(page.locator("body")).toContainText("ChatGPT connected");
      await page.screenshot({ path: join(evidence, "foreign-callback.png") });
      await page.goto(`http://localhost:${foreignPort}`);
      const wrong = page.waitForResponse((r) => r.url().includes("/auth/callback"));
      await page.getByRole("link", { name: "Wrong return", exact: true }).click();
      expect((await wrong).status()).toBe(400);
      expect(calls).toBe(2);
      console.log("Chat adverse: valid and wrong-state browser navigations passed");
      const wrongHost = await new Promise<number>((resolve, reject) => {
        const req = request(app.origin + "/auth/callback?state=valid-synthetic", { headers: { Host: "untrusted.invalid", "Sec-Fetch-Site": "cross-site" } }, (res) => { res.resume(); resolve(res.statusCode!); });
        req.setTimeout(5000, () => req.destroy(Error("Wrong-host control timed out")));
        req.on("error", reject); req.end();
      });
      expect(wrongHost).toBe(403);
      console.log("Chat adverse: wrong Host rejected");
      for (const [method, path] of [["GET", "/api/v1/session"], ["POST", "/api/v1/chat/send"], ["POST", "/auth/callback"], ["POST", "/api/v1/chat/tool"]] as const) {
        const rejected = await fetch(app.origin + path, { method, signal: AbortSignal.timeout(5000), headers: { Origin: `http://localhost:${foreignPort}`, "Sec-Fetch-Site": "cross-site" } });
        expect(rejected.status).toBe(403);
      }
      const nonNavigation = await fetch(app.origin + "/auth/callback?state=valid-synthetic", { signal: AbortSignal.timeout(5000), headers: { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": "empty" } });
      expect(nonNavigation.status).toBe(403);
      expect(calls).toBe(2);
    } finally { await context.close(); ChatAuth.prototype.callback = originalCallback; }
    console.log("Chat adverse: callback and rejection controls passed");
    const image = await syntheticCompositionImage();
    const uploads: unknown[] = [];
    for (const returned of [false, true]) for (const delay of ["read", "response"]) {
      console.log(`Chat adverse: upload returned=${returned} delay=${delay}`);
      const a = app.workspace.create({ title: `Alpha ${returned} ${delay}`, mode: "freeroam", visualOS: null, palette: null }).project!;
      const b = app.workspace.create({ title: `Beta ${returned} ${delay}`, mode: "freeroam", visualOS: null, palette: null }).project!;
      let job: string | null = null;
      if (returned) {
        const p = await seedRepairPage(app.pages, a.id);
        await app.pages.addMedia(a.id, { expectedProject: reference(app.workspace.project(a.id)), file: image.toString("base64"), origin: null, label: "Synthetic original", role: "placeable", permission: "Mechanical fixture" });
        const m = app.pages.state(a.id).media.at(-1)!;
        app.pages.save(a.id, { artifact: reference(p), page: { ...p.payload.state.page, media: { hero: null }, root: { ...p.payload.state.page.root, children: [...p.payload.state.page.root.children!, { id: "image", kind: "media", slot: "hero", alt: "Synthetic", decorative: false }] } }, reason: "Mechanical fixture" });
        await app.pages.place(a.id, { artifact: { ...reference(p), version: 2 }, slot: "hero", media: reference(m), reason: "Mechanical fixture" });
        const active = app.pages.state(a.id).pages.at(-1)!;
        app.chat.send({ projectId: a.id, clientId: `adverse-${delay}`, text: "Keep original pixels", focus: { view: "studio", page: reference(active), resources: [], target: { page: reference(active), media: reference(m), slot: "hero", shape: "rectangle", bounds: { x: 0, y: 0, width: m.payload.state.image.width, height: m.payload.state.image.height } } } });
        await expect.poll(() => app.chat.state(a.id).jobs.length).toBe(1);
        job = app.chat.state(a.id).jobs[0]!.id;
      }
      const context = await browser.newContext();
      const ready = deferred(), release = deferred();
      try {
        if (delay === "read") await context.addInitScript(() => {
          const Original = FileReader;
          const pending: (() => void)[] = [];
          Object.assign(window, { bveReadReady: false, bveReleaseRead: () => pending.splice(0).forEach((f) => f()) });
          window.FileReader = class extends Original {
            override readAsDataURL(file: Blob) {
              const onload = this.onload;
              this.onload = (event) => { pending.push(() => onload?.call(this, event)); Object.assign(window, { bveReadReady: true }); };
              super.readAsDataURL(file);
            }
          };
        });
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        const posted: { projectId: string; input: { job: string | null } }[] = [];
        await page.route("**/api/v1/chat/attach", async (route) => {
          posted.push(route.request().postDataJSON());
          const response = await route.fetch();
          ready.resolve();
          if (delay === "response") await release.promise;
          await route.fulfill({ response });
        });
        await page.goto(app.origin);
        await page.locator(`[data-action=open][data-id="${a.id}"]`).click();
        await expect(page.locator(`[data-action=open][data-id="${a.id}"]`)).toHaveClass(/active/);
        if (returned) {
          const chooser = page.waitForEvent("filechooser");
          await page.locator(`[data-chat-return="${job}"]`).click();
          await (await chooser).setFiles({ name: "returned.png", mimeType: "image/png", buffer: image });
        } else await page.locator("#chat-attach").setInputFiles({ name: "reference.png", mimeType: "image/png", buffer: image });
        if (delay === "read") await expect.poll(() => page.evaluate(() => (window as unknown as { bveReadReady: boolean }).bveReadReady)).toBe(true);
        else await ready.promise;
        await page.locator(`[data-action=open][data-id="${b.id}"]`).click();
        await expect(page.locator(`[data-action=open][data-id="${b.id}"]`)).toHaveClass(/active/);
        if (delay === "read") await page.evaluate(() => (window as unknown as { bveReleaseRead: () => void }).bveReleaseRead());
        else release.resolve();
        await expect(page.locator("#notice")).toContainText(delay === "read" ? "Attachment cancelled" : "original project");
        expect(app.pages.state(b.id).media.length).toBe(0);
        await expect(page.locator("[data-chat-remove]")).toHaveCount(0);
        if (delay === "read") { expect(posted).toEqual([]); expect(app.pages.state(a.id).media.length).toBe(returned ? 1 : 0); }
        else {
          expect(posted).toEqual([{ projectId: a.id, input: expect.objectContaining({ job }) }]);
          expect(app.pages.state(a.id).media.length).toBe(returned ? 2 : 1);
          if (returned) expect(app.chat.state(a.id).jobs[0]!.candidate).not.toBeNull();
        }
        // No A handles are included after a late response, even when returning to A.
        await page.locator(`[data-action=open][data-id="${a.id}"]`).click();
        await expect(page.locator(`[data-action=open][data-id="${a.id}"]`)).toHaveClass(/active/);
        await expect(page.locator("[data-chat-remove]")).toHaveCount(0);
        expect(errors).toEqual([]);
        uploads.push({ returned, delay, posted: posted.map((p) => ({ projectId: p.projectId, job: p.input.job })), betaMedia: 0, betaReferences: 0, passed: true });
      } finally { release.resolve(); await context.close(); }
    }
    writeFileSync(join(evidence, "adverse-receipt.json"), JSON.stringify({ callback: { callbacks, calls, wrongState: 400, wrongHost: 403, foreignAPIs: 403, nonNavigation: 403 }, uploads, realAccountCalls: 0, realImageCalls: 0, passed: true }, null, 2) + "\n");
    console.log("Chat adverse browser: foreign-site callback and four delayed project/job upload controls passed; zero account/image calls.");
  } finally {
    ChatAuth.prototype.callback = originalCallback;
    foreign.closeAllConnections();
    await new Promise<void>((r) => foreign.close(() => r()));
    await app.close();
  }
}
