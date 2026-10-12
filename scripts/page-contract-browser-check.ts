// Existing PR10 shell only, injected synthetic transport; no product UX redesign.
import { chromium, expect } from "@playwright/test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { startApp } from "../src/service/server.ts";
import type { ChatDriver } from "../src/service/chat-contracts.ts";
import { contractPage } from "./page-contract-fixture.ts";
import { repairResult } from "./inference-repair-fixture.ts";

const evidence = resolve(process.env["BVE_EVIDENCE_DIR"] ?? "/tmp/bve-page-contract-browser");
mkdirSync(evidence, {recursive: true});
const root = mkdtempSync(join(tmpdir(), "bve-contract-browser-"));
let calls = 0;
const driver: ChatDriver = {kind: "test-fixture", close: async () => {}, run: async c => {
  calls++;
  const q = await c.tool("prepare_design", "prepare", {operation: "create", instruction: "Synthetic page contract boundary", locks: []}) as {request: {id: string}; requestHash: string};
  const response = repairResult({id: q.request.id, integrity: q.requestHash});
  response.candidates[0]!.page = contractPage();
  response.candidates.push(structuredClone(response.candidates[0]!));
  if (calls === 1) response.candidates[1]!.page.root.children![0]!.href = "#missing";
  await c.tool("submit_candidates", "submit", {request: q.request, response});
  c.delta("Synthetic valid link/target intake only; no generation claim.");
  return {status: "completed", model: null, usage: null};
}};
const app = await startApp(root, 0, undefined, undefined, {chatDriver: driver});
const browser = await chromium.launch({headless: true,
  ...(process.env["BVE_CHROMIUM_EXECUTABLE"] ? {executablePath: process.env["BVE_CHROMIUM_EXECUTABLE"]} : {}),
  args: ["--no-sandbox", "--disable-dev-shm-usage"]});
const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
try {
  await page.addInitScript(() => { localStorage.setItem("bve.advanced", "true"); });
  await page.goto(app.origin);
  await expect(page.locator("#chat-connection")).toHaveText("test fixture · no GPT call");
  await page.locator("#create [name=title]").fill("Synthetic R7 contract review");
  await page.locator("#create button[type=submit]").click();
  await expect(page.getByRole("heading", {name: "Design, inspect, decide."})).toBeVisible();
  await page.locator("#chat-message").fill("Synthetic malformed second candidate; no model call");
  await page.locator("#chat-send button[type=submit]").click();
  const diagnostic = "Candidate 2: Unknown local anchor #missing; at page.root.children[0].href (node forward); expected #target matching an existing local node id in this SAME candidate page (case-sensitive)";
  await expect(page.locator(".chat-reply").last()).toContainText(diagnostic);
  const pid = app.workspace.state().projects[0]!.id;
  const failed = app.pages.state(pid);
  expect(failed.pages).toHaveLength(0); expect(failed.results).toHaveLength(0); expect(failed.accepted).toEqual({});
  await expect(page.locator("#chat-send button[type=submit]")).toBeEnabled();
  await page.screenshot({path: join(evidence, "r7-rejection-desktop.png"), fullPage: true});
  await page.setViewportSize({width: 390, height: 844}); await page.reload();
  await page.locator(`[data-action=open][data-id="${pid}"]`).click();
  await expect(page.locator(".chat-reply").last()).toContainText(diagnostic);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path: join(evidence, "r7-rejection-narrow-reloaded.png"), fullPage: true});
  expect(calls).toBe(1); // Reload does not resubmit or retry.
  await page.locator("#chat-message").fill("Explicit synthetic valid next submission");
  await page.locator("#chat-send button[type=submit]").click();
  await expect(page.locator(".chat-reply").last()).toContainText("completed");
  expect(calls).toBe(2); expect(app.pages.state(pid).pages).toHaveLength(2); expect(app.pages.state(pid).results).toHaveLength(1);
  expect(Object.values(app.pages.state(pid).accepted).every(value => value === null)).toBe(true);
  await page.screenshot({path: join(evidence, "r7-valid-explicit-submission-narrow.png"), fullPage: true});
  expect(errors).toEqual([]);
  writeFileSync(join(evidence, "page-contract-browser.json"), JSON.stringify({passed: true, browser: browser.version(), diagnostic,
    checks: ["malformed second candidate rejects entire submission", "actionable candidate/node/path message", "zero candidates/results/acceptances on rejection", "390px reload retains failed history without retry", "explicit valid forward/backward/nested/repeated target intake", "valid submission creates candidates but no acceptance"],
    fixtureCalls: calls, accountCalls: 0, modelCalls: 0, errors}, null, 2) + "\n");
  console.log(JSON.stringify({passed: true, fixtureCalls: calls, accountCalls: 0, errors}));
} catch (error) {
  writeFileSync(join(evidence, "failed-page.html"), await page.content());
  writeFileSync(join(evidence, "failed-state.json"), JSON.stringify({calls, projects: app.workspace.state().projects.map(p => ({id: p.id, chat: app.chat.state(p.id)}))}, null, 2));
  throw error;
} finally { await browser.close(); await app.close(); rmSync(root, {recursive: true, force: true}); }
