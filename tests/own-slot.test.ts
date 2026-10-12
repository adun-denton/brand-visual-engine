import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { Workspace } from "../src/service/workspace.ts";
import { Pages } from "../src/service/pages.ts";
import { startApp } from "../src/service/server.ts";
import type { ChatDriver } from "../src/service/chat-contracts.ts";
import { reference } from "../src/kernel/packets.ts";
import { pageSignature } from "../src/modules/website/page.ts";
import { repairPage, repairResult } from "../scripts/inference-repair-fixture.ts";
import { syntheticCompositionImage } from "../scripts/composition-fixture.ts";

const absentNames = ["constructor", "toString", "hasOwnProperty", "valueOf", "__proto__", "absent"];
const ownNames = ["constructor", "toString", "hasOwnProperty", "valueOf", "ordinary"];
function pageWithSlot(slot?: string, binding: string | null = null) {
  const page: any = repairPage("Synthetic own-slot boundary");
  page.root.children = slot ? [{id: "picture", kind: "media", slot, alt: "", decorative: false}] : [];
  page.media = slot ? {[slot]: binding} : {};
  return page;
}
function prepare(pages: Pages, pid: string, resources: unknown[] = []) {
  pages.prepare(pid, {expectedProject: reference(pages.workspace.project(pid)), base: null, operation: "create", instruction: "Synthetic own-slot boundary", resources, locks: []});
  return pages.state(pid).requests.at(-1)!;
}
function result(q: {id: string; integrity: string}, page: unknown, slots: string[]) {
  const out: any = repairResult(q);
  out.candidates[0].page = page;
  out.candidates[0].mediaRequirements = slots.map(slot => ({slot, instruction: "Synthetic need; proposed only"}));
  return out;
}
const applyInput = (q: Parameters<typeof reference>[0], response: unknown) => ({request: reference(q), response, source: "Synthetic own-slot fixture", model: null, aiAuthorship: true});
function heldDriver() {
  let context!: Parameters<ChatDriver["run"]>[0];
  const driver: ChatDriver = {kind: "test-fixture", close: async () => {}, run: async c => {
    context = c;
    await new Promise<void>(r => c.signal.addEventListener("abort", () => r(), {once: true}));
    return {status: "interrupted", model: null, usage: null};
  }};
  return {driver, context: () => context};
}
const focus = {view: "studio", page: null, resources: [], target: null};

test("new intake rejects absent inherited names and accepts own null/resolved/repeated needs without blacklisting", async () => {
  const root = mkdtempSync(join(tmpdir(), "bve-own-slot-"));
  const workspace = new Workspace(root, {aiResponseFixture: true});
  const pages = new Pages(workspace);
  const pid = workspace.create({title: "Synthetic own-slot controls", mode: "freeroam", visualOS: null, palette: null}).project!.id;
  try {
    for (const declared of [undefined, "unrelated"]) for (const slot of absentNames) {
      const q = prepare(pages, pid), before = workspace.kernel.latestPackets(), ledger = workspace.kernel.ledger(pid);
      await assert.rejects(pages.apply(pid, applyInput(q, result(q, pageWithSlot(declared), [slot]))), /Candidate 1:.*candidate.mediaRequirements\[0\].slot.*expected existing slot.*own page.media property/);
      assert.deepEqual(workspace.kernel.latestPackets(), before); assert.deepEqual(workspace.kernel.ledger(pid), ledger);
      assert.equal(pages.state(pid).pages.length, 0); assert.equal(pages.state(pid).results.length, 0); assert.deepEqual(pages.state(pid).accepted, {});
    }
    // These names are real local slots when declared; a blacklist would break them.
    for (const slot of ownNames) {
      const q = prepare(pages, pid);
      await pages.apply(pid, applyInput(q, result(q, pageWithSlot(slot), [slot, " \t" + slot + "\n"])));
      const saved = pages.state(pid).pages.at(-1)!.payload.state.page;
      assert.equal(Object.hasOwn(saved.media, slot), true); assert.equal(saved.media[slot], null);
    }
    const bytes = await syntheticCompositionImage("Own-slot synthetic asset");
    await pages.addMedia(pid, {expectedProject: reference(workspace.project(pid)), file: bytes.toString("base64"), origin: null, label: "Synthetic placeable", role: "placeable", permission: "Authored test fixture"});
    const media = pages.state(pid).media.at(-1)!;
    for (const slot of ownNames) {
      const q = prepare(pages, pid, [reference(media)]), handle = q.payload.state.resources[0]!.handle;
      await pages.apply(pid, applyInput(q, result(q, pageWithSlot(slot, handle), [slot, slot])));
      const saved = pages.state(pid).pages.at(-1)!.payload.state.page;
      assert.equal(Object.hasOwn(saved.media, slot), true); assert.deepEqual(saved.media[slot]!.asset, reference(media));
    }
    // A declared own slot does not relax the pre-existing resource role/handle gate.
    await pages.addMedia(pid, {expectedProject: reference(workspace.project(pid)), file: bytes.toString("base64"), origin: null, label: "Synthetic reference only", role: "reference", permission: "Authored test fixture"});
    const referenceOnly = pages.state(pid).media.at(-1)!;
    for (const handle of ["invented", "reference-only"]) {
      const q = prepare(pages, pid, [reference(referenceOnly)]), before = workspace.kernel.latestPackets();
      const binding = handle === "invented" ? handle : q.payload.state.resources[0]!.handle;
      await assert.rejects(pages.apply(pid, applyInput(q, result(q, pageWithSlot("constructor", binding), ["constructor"]))), /Unknown or invented media handle|Reference-only resource cannot be placed/);
      assert.deepEqual(workspace.kernel.latestPackets(), before);
    }
    assert.ok(Object.values(pages.state(pid).accepted).every(value => value === null));
    assert.deepEqual(workspace.assets.read(media.payload.state.image.id), bytes);
  } finally {workspace.close(); rmSync(root, {recursive: true, force: true});}
});

test("non-own need in candidate2 rejects service/HTTP/tool atomically; error replay and explicit correction stay separate", async () => {
  const root = mkdtempSync(join(tmpdir(), "bve-own-slot-atomic-")), held = heldDriver();
  const app = await startApp(root, 0, undefined, undefined, {chatDriver: held.driver, aiResponseFixture: true});
  try {
    const sent = app.chat.send({projectId: null, clientId: "own-slot-rejection", text: "Synthetic own-slot intake", focus});
    const tool = held.context().tool;
    const exported = await tool("prepare_design", "prepare", {operation: "create", instruction: "Synthetic own-slot intake", locks: []}) as {request: {id: string; version: number; freshness: "pinned"}};
    const q = app.pages.request(sent.projectId, exported.request);
    const packets = app.workspace.kernel.latestPackets(), ledger = app.workspace.kernel.ledger(sent.projectId), state = app.workspace.state(sent.projectId);
    const selection = app.chat.state(sent.projectId).session;
    const session = await (await fetch(app.origin + "/api/v1/session")).json() as {token: string};
    let executions = 0;
    const apply = app.pages.apply.bind(app.pages);
    app.pages.apply = (...args) => {executions++; return apply(...args);};
    for (const slot of absentNames) {
      const out = result(q, pageWithSlot(), []);
      out.candidates.push(result(q, pageWithSlot("ordinary"), ["ordinary", slot]).candidates[0]);
      const input = {request: reference(q), response: out}, expected = /Candidate 2:.*candidate.mediaRequirements\[1\].slot.*expected existing slot.*own page.media property/;
      await assert.rejects(app.pages.apply(sent.projectId, applyInput(q, out)), expected);
      await assert.rejects(tool("submit_candidates", "reject-" + slot, input), expected);
      const receipt = app.chat.store.action("own-slot-rejection", "reject-" + slot)!;
      assert.equal(receipt["status"], "completed");
      const error = JSON.parse(String(receipt["result"])); assert.deepEqual(Object.keys(error), ["error"]); assert.match(error.error, expected);
      const beforeReplay = executions;
      assert.deepEqual(await tool("submit_candidates", "reject-" + slot, input), error); assert.equal(executions, beforeReplay);
      assert.deepEqual(app.chat.store.action("own-slot-rejection", "reject-" + slot), receipt);
      const http = await fetch(app.origin + "/api/v1/page/apply", {method: "POST", headers: {Origin: app.origin, "Content-Type": "application/json", "X-BVE-Token": session.token}, body: JSON.stringify({projectId: sent.projectId, input: applyInput(q, out)})});
      const body = await http.json() as {error: string}; assert.equal(http.status, 400); assert.equal(body.error, error.error);
      assert.deepEqual(app.workspace.kernel.latestPackets(), packets); assert.deepEqual(app.workspace.kernel.ledger(sent.projectId), ledger); assert.deepEqual(app.workspace.state(sent.projectId), state);
      const current = app.chat.state(sent.projectId).session;
      assert.deepEqual(current.active, selection.active); assert.deepEqual(current.compared, selection.compared); assert.equal(current.selectionRevision, selection.selectionRevision);
      assert.deepEqual(current.turns[0]!.candidates, []); assert.deepEqual(app.pages.state(sent.projectId).accepted, {});
      assert.equal(app.pages.state(sent.projectId).pages.length, 0); assert.equal(app.pages.state(sent.projectId).results.length, 0); assert.equal(app.chat.store.jobs(sent.projectId).length, 0);
    }
    const corrected = result(q, pageWithSlot(), []);
    corrected.candidates.push(result(q, pageWithSlot("constructor"), ["constructor", " constructor "]).candidates[0]);
    const beforeCorrected = executions;
    await tool("submit_candidates", "explicit-corrected", {request: reference(q), response: corrected});
    assert.equal(executions, beforeCorrected + 1); assert.equal(app.pages.state(sent.projectId).pages.length, 2); assert.equal(app.pages.state(sent.projectId).results.length, 1);
    assert.ok(Object.values(app.pages.state(sent.projectId).accepted).every(value => value === null)); assert.equal(app.chat.store.jobs(sent.projectId).length, 0);
  } finally {await app.close(); rmSync(root, {recursive: true, force: true});}
});

test("exact R7 historical packets, accepted export/media bytes and successful receipts survive R8; fresh malformed intake rejects", async () => {
  const repo = resolve(import.meta.dirname, ".."), base = "dfcdae62cf7594efc6f8fc38dab16ffce391021c";
  assert.equal(execFileSync("git", ["rev-parse", base + "^{tree}"], {cwd: repo, encoding: "utf8"}).trim(), "9b73812ed016985ed83d904bf6a093cb0a3fc34b");
  const extracted = mkdtempSync(join(tmpdir(), "bve-r7-history-source-")), root = mkdtempSync(join(tmpdir(), "bve-r8-history-runtime-"));
  execFileSync("tar", ["-x", "-C", extracted], {input: execFileSync("git", ["archive", base, "src"], {cwd: repo})});
  const dependencyLink = join(extracted, "node_modules"); symlinkSync(join(repo, "node_modules"), dependencyLink, "junction");
  let prior: Awaited<ReturnType<typeof startApp>> | undefined, current: Awaited<ReturnType<typeof startApp>> | undefined;
  try {
    const old = await import(pathToFileURL(join(extracted, "src/service/server.ts")).href) as {startApp: typeof startApp};
    const historical = heldDriver(); prior = await old.startApp(root, 0, undefined, undefined, {chatDriver: historical.driver, aiResponseFixture: true});
    const sent = prior.chat.send({projectId: null, clientId: "r7-historical", text: "Synthetic historical inherited need", focus});
    const tool = historical.context().tool;
    const exported = await tool("prepare_design", "prepare", {operation: "create", instruction: "Synthetic historical inherited need", locks: []}) as {request: {id: string; version: number; freshness: "pinned"}};
    const q = prior.pages.request(sent.projectId, exported.request), response = result(q, pageWithSlot(), ["constructor"]), input = {request: reference(q), response};
    const rejectedInput = {request: reference(q), response: result(q, pageWithSlot(), ["absent"])};
    await assert.rejects(tool("submit_candidates", "historical-error", rejectedInput), /candidate.mediaRequirements\[0\].slot/);
    const errorReceipt = prior.chat.store.action("r7-historical", "historical-error"), historicalError = JSON.parse(String(errorReceipt!["result"]));
    assert.ok(!historicalError.error.includes("own page.media property"));
    const success = await tool("submit_candidates", "historical-success", input);
    const page = prior.pages.state(sent.projectId).pages[0]!;
    prior.pages.accept(sent.projectId, {artifact: reference(page), expected: null, reason: "Synthetic historical operator decision", reviewedHash: pageSignature(page.payload.state), acknowledgeFindings: true});
    const bytes = await syntheticCompositionImage("Historical synthetic original");
    await prior.pages.addMedia(sent.projectId, {expectedProject: reference(prior.workspace.project(sent.projectId)), file: bytes.toString("base64"), origin: null, label: "Historical synthetic original", role: "placeable", permission: "Authored fixture"});
    const media = prior.pages.state(sent.projectId).media[0]!;
    const packetSnapshot = prior.workspace.kernel.latestPackets(), ledger = prior.workspace.kernel.ledger(sent.projectId), accepted = prior.pages.state(sent.projectId).accepted;
    const receipt = prior.chat.store.action("r7-historical", "historical-success"), exportBytes = (await prior.pages.export(sent.projectId, reference(page))).bytes;
    prior.chat.cancel(sent.projectId, {turn: "r7-historical"}); await prior.close(); prior = undefined;

    const next = heldDriver(); current = await startApp(root, 0, undefined, undefined, {chatDriver: next.driver, aiResponseFixture: true});
    assert.deepEqual(current.workspace.kernel.latestPackets(), packetSnapshot); assert.deepEqual(current.workspace.kernel.ledger(sent.projectId), ledger); assert.deepEqual(current.pages.state(sent.projectId).accepted, accepted);
    assert.deepEqual(current.chat.store.action("r7-historical", "historical-success"), receipt);
    assert.deepEqual(current.chat.store.action("r7-historical", "historical-error"), errorReceipt);
    assert.deepEqual(await current.chat.dispatch(sent.projectId, "r7-historical", "submit_candidates", "historical-error", rejectedInput), historicalError);
    assert.deepEqual(await current.chat.dispatch(sent.projectId, "r7-historical", "submit_candidates", "historical-success", input), success);
    // Duplicate-result intake returns the already recorded result before the new relation gate.
    await current.pages.apply(sent.projectId, applyInput(q, response));
    assert.deepEqual(current.workspace.kernel.latestPackets(), packetSnapshot); assert.deepEqual(current.workspace.kernel.ledger(sent.projectId), ledger);
    assert.deepEqual((await current.pages.export(sent.projectId, reference(page))).bytes, exportBytes); assert.deepEqual(current.workspace.assets.read(media.payload.state.image.id), bytes);

    current.chat.send({projectId: sent.projectId, clientId: "r8-fresh", text: "Fresh synthetic intake", focus});
    const freshTool = next.context().tool;
    const freshExport = await freshTool("prepare_design", "fresh-prepare", {operation: "create", instruction: "Fresh synthetic intake", locks: []}) as {request: {id: string; version: number; freshness: "pinned"}};
    const freshQ = current.pages.request(sent.projectId, freshExport.request), freshResponse = result(freshQ, pageWithSlot(), ["constructor"]);
    const before = current.workspace.kernel.latestPackets(), beforeLedger = current.workspace.kernel.ledger(sent.projectId);
    await assert.rejects(freshTool("submit_candidates", "fresh-malformed", {request: reference(freshQ), response: freshResponse}), /Candidate 1:.*own page.media property/);
    assert.deepEqual(current.workspace.kernel.latestPackets(), before); assert.deepEqual(current.workspace.kernel.ledger(sent.projectId), beforeLedger); assert.deepEqual(current.pages.state(sent.projectId).accepted, accepted);
    assert.deepEqual(current.chat.store.action("r7-historical", "historical-success"), receipt);
    assert.deepEqual(current.chat.store.action("r7-historical", "historical-error"), errorReceipt);
    assert.deepEqual((await current.pages.export(sent.projectId, reference(page))).bytes, exportBytes); assert.deepEqual(current.workspace.assets.read(media.payload.state.image.id), bytes);
    assert.equal(current.pages.state(sent.projectId).pages.length, 1); assert.equal(current.pages.state(sent.projectId).results.length, 1); assert.equal(current.chat.store.jobs(sent.projectId).length, 0);
  } finally {
    await prior?.close(); await current?.close(); unlinkSync(dependencyLink);
    rmSync(extracted, {recursive: true, force: true}); rmSync(root, {recursive: true, force: true});
  }
});
