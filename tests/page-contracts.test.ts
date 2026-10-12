import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Ajv2020 } from "ajv/dist/2020.js";
import { parsePage, preservation } from "../src/modules/website/page.ts";
import { pageGuidance } from "../src/modules/website/page-contracts.ts";
import { inferenceOutputSchema } from "../src/modules/website/inference-contracts.ts";
import { InputError } from "../src/service/validation.ts";
import { contractCases, contractPage } from "../scripts/page-contract-fixture.ts";
import { repairResult } from "../scripts/inference-repair-fixture.ts";
import { startApp } from "../src/service/server.ts";
import type { ChatDriver } from "../src/service/chat-contracts.ts";
import { Workspace } from "../src/service/workspace.ts";
import { Pages } from "../src/service/pages.ts";
import { reference } from "../src/kernel/packets.ts";

const schema = new Ajv2020({strict: true}).compile(inferenceOutputSchema);
const response = (page: unknown) => ({...repairResult({id: "request", integrity: "0".repeat(64)}), candidates: [{label: "Fixture", rationale: "Synthetic boundary", page, mediaRequirements: [], proposedActions: []}]});
const noMedia = (_: string): never => { throw new InputError("Unknown or invented media handle"); };

test("independent page-family boundaries classify shape and semantic-only rejection", () => {
  const families = new Set<string>();
  for (const c of contractCases()) {
    families.add(c.family);
    assert.equal(schema(response(c.page)), c.schema, c.family + ":" + c.name + ":schema");
    if (c.parser) assert.doesNotThrow(() => parsePage(c.page, noMedia), c.family + ":" + c.name);
    else assert.throws(() => parsePage(c.page, noMedia), InputError, c.family + ":" + c.name);
  }
  assert.deepEqual([...families].sort(), ["aggregate", "anchor", "count", "fields", "heading", "href", "identity", "kind", "language", "length", "media", "responsive", "root"]);
});

test("generated relationship guidance stays valid without changing style authority", () => {
  const p = contractPage(); p.root.children = structuredClone(pageGuidance.linkExample);
  assert.equal(schema(response(p)), true); assert.doesNotThrow(() => parsePage(p));
  assert.match(pageGuidance.validation, /shape.*Semantic intake/);
  assert.match(pageGuidance.identity, /not kernel\/artifact\/version IDs/);
});

test("node/path diagnostics identify expected non-style rules without echoing unrelated content", () => {
  const probes: [string, (p: any) => void, RegExp][] = [
    ["anchor", p => p.root.children[0].href = "#missing", /Unknown local anchor #missing; at page.root.children\[0\].href \(node forward\); expected .*SAME candidate page/],
    ["duplicate", p => p.root.children[1].children[0].id = "forward", /Duplicate local element identity; first declared at page.root.children\[0\].*page.root.children\[1\].children\[0\].id \(node forward\); expected unique/],
    ["href", p => p.root.children[0].href = "javascript:private-sentinel", /Invalid link target.*page.root.children\[0\].href \(node forward\); expected/],
    ["responsive", p => p.responsive = [{maxWidth: 300, nodeId: "missing", style: {}}], /Unknown responsive node.*page.responsive\[0\].nodeId \(node missing\); expected existing local/],
    ["text", p => p.root.children[1].children[0].text = "", /page.root.children\[1\].children\[0\].text \(node target\); expected nonblank/],
    ["media", p => {p.root.children = [{id: "picture", kind: "media", slot: "slot", alt: "", decorative: false}]; p.media = {slot: "private-sentinel"};}, /page.media\["slot"\] \(node picture\); expected .*placeable/],
  ];
  for (const [name, mutate, diagnostic] of probes) {
    const p = contractPage(); p.title = "private-sentinel"; mutate(p);
    assert.throws(() => parsePage(p, noMedia), error => error instanceof InputError && diagnostic.test(error.message) && !error.message.includes("private-sentinel"), name);
  }
});

test("preservation stays exact and retains a lock path, node identity and expected field", () => {
  const page = parsePage(contractPage());
  for (const field of ["text", "subtree", "style"] as const) {
    const node = page.root.children![1]!.children![0]!;
    const value = field === "subtree" ? node : field === "text" ? node.text! : {};
    if (field === "style") node.style = {};
    assert.doesNotThrow(() => preservation(page, [{nodeId: "target", field, value: value as any}]));
    assert.throws(() => preservation(page, [{nodeId: "target", field, value: "private-sentinel"}]), error =>
      error instanceof InputError && /preservation\[0\].value \(node target\); expected exact frozen/.test(error.message) && !error.message.includes("private-sentinel"));
  }
});

test("adjacent response envelopes enforce existing value/count boundaries in schema", () => {
  for (const [field, max, valid] of [["label", 200, "x"], ["rationale", 4000, "x"], ["proposedActions", 32, ["x"]], ["mediaRequirements", 100, [{slot: "slot", instruction: "x"}]]] as const) {
    const out: any = response(contractPage());
    out.candidates[0][field] = typeof valid === "string" ? "x".repeat(max) : Array.from({length: max}, () => structuredClone(valid[0]));
    assert.equal(schema(out), true, field + " boundary");
    out.candidates[0][field] = typeof valid === "string" ? "x".repeat(max + 1) : Array.from({length: max + 1}, () => structuredClone(valid[0]));
    assert.equal(schema(out), false, field + " excessive");
  }
  const out: any = response(contractPage());
  for (const n of [6, 7]) { out.candidates = Array.from({length: n}, () => response(contractPage()).candidates[0]); assert.equal(schema(out), n === 6); }
  for (const n of [100, 101]) { out.candidates = []; out.findings = Array(n).fill("x"); assert.equal(schema(out), n === 100); }
  for (const value of ["", " ", "x".repeat(4001), 1]) {
    const r: any = response(contractPage()); r.candidates[0].mediaRequirements = [{slot: "slot", instruction: value}]; assert.equal(schema(r), false);
  }
});

test("service envelope boundaries remain accepted/rejected independently of schema", async () => {
  const root = mkdtempSync(join(tmpdir(), "bve-envelope-boundary-"));
  const workspace = new Workspace(root); const pages = new Pages(workspace);
  const pid = workspace.create({title: "Synthetic boundaries", mode: "freeroam", visualOS: null, palette: null}).project!.id;
  try {
    const probes: [string, number, (r: any, n: number) => void][] = [
      ["label", 200, (r, n) => r.candidates[0].label = "x".repeat(n)],
      ["rationale", 4000, (r, n) => r.candidates[0].rationale = "x".repeat(n)],
      ["actions", 32, (r, n) => r.candidates[0].proposedActions = Array(n).fill("x")],
      ["needs", 100, (r, n) => r.candidates[0].mediaRequirements = Array.from({length: n}, () => ({slot: "slot", instruction: "x"}))],
      ["findings", 100, (r, n) => r.findings = Array(n).fill("x")],
      ["candidates", 6, (r, n) => r.candidates = Array.from({length: n}, () => structuredClone(r.candidates[0]))],
    ];
    for (const [name, limit, mutate] of probes) for (const n of [limit, limit + 1]) {
      pages.prepare(pid, {expectedProject: reference(workspace.project(pid)), base: null, operation: "create", instruction: "Synthetic envelope boundary", resources: [], locks: []});
      const q = pages.state(pid).requests.at(-1)!;
      const out: any = repairResult(q); out.candidates[0].page.root.children = [{id: "picture", kind: "media", slot: "slot", alt: "", decorative: false}]; out.candidates[0].page.media = {slot: null};
      mutate(out, n);
      const before = workspace.kernel.latestPackets();
      const apply = () => pages.apply(pid, {request: reference(q), response: out, source: "Synthetic", model: null, aiAuthorship: true});
      assert.equal(schema(out), n === limit, name);
      if (n === limit) await apply();
      else { await assert.rejects(apply(), InputError, name); assert.deepEqual(workspace.kernel.latestPackets(), before); }
      assert.ok(Object.values(pages.state(pid).accepted).every(value => value === null));
    }
    // Retain and disclose this pre-existing envelope compatibility edge rather
    // than silently tightening its accepted language: `in` includes prototypes.
    pages.prepare(pid, {expectedProject: reference(workspace.project(pid)), base: null, operation: "create", instruction: "Synthetic membership edge", resources: [], locks: []});
    const q = pages.state(pid).requests.at(-1)!;
    const out: any = repairResult(q); out.candidates[0].mediaRequirements = [{slot: "constructor", instruction: "Proposed only"}];
    assert.equal(schema(out), true);
    await pages.apply(pid, {request: reference(q), response: out, source: "Synthetic compatibility edge", model: null, aiAuthorship: true});
    assert.ok(Object.values(pages.state(pid).accepted).every(value => value === null));
  } finally {workspace.close(); rmSync(root, {recursive: true, force: true});}
});

test("malformed second page rejects service, HTTP and tool atomically with idempotent error receipts", async () => {
  let context!: Parameters<ChatDriver["run"]>[0];
  const driver: ChatDriver = {kind: "test-fixture", close: async () => {}, run: async c => {
    context = c; await new Promise<void>(r => c.signal.addEventListener("abort", () => r(), {once: true}));
    return {status: "interrupted", model: null, usage: null};
  }};
  const root = mkdtempSync(join(tmpdir(), "bve-page-contract-"));
  const app = await startApp(root, 0, undefined, undefined, {chatDriver: driver});
  try {
    const sent = app.chat.send({projectId: null, clientId: "contract-rejection", text: "Synthetic intake", focus: {view: "studio", page: null, resources: [], target: null}});
    const q = await context.tool("prepare_design", "prepare-contract", {operation: "create", instruction: "Synthetic boundary", locks: []}) as {request: {id: string; version: number; freshness: "pinned"}; requestHash: string; pageGuidance: typeof pageGuidance; contract: string};
    assert.deepEqual(q.pageGuidance, pageGuidance); assert.ok(!q.contract.includes("No IDs"));
    const packets = app.workspace.kernel.latestPackets(), ledger = app.workspace.kernel.ledger(sent.projectId), selection = app.workspace.state(sent.projectId);
    const session = await (await fetch(app.origin + "/api/v1/session")).json() as {token: string};
    const probes: [string, (r: any) => void, RegExp][] = [
      ["anchor", r => r.candidates[1].page.root.children[0].href = "#missing", /Candidate 2:.*node forward.*expected .*SAME candidate page/],
      ["duplicate", r => r.candidates[1].page.root.children[1].children[0].id = "forward", /Candidate 2:.*Duplicate local.*children\[1\].children\[0\].id.*node forward.*expected/],
      ["href", r => r.candidates[1].page.root.children[0].href = "javascript:private-sentinel", /Candidate 2:.*Invalid link target.*children\[0\].href.*node forward.*expected/],
      ["responsive", r => r.candidates[1].page.responsive = [{maxWidth: 300, nodeId: "missing", style: {}}], /Candidate 2:.*page.responsive\[0\].nodeId.*node missing.*expected/],
      ["need", r => r.candidates[1].mediaRequirements = [{slot: "missing", instruction: "private-sentinel"}], /Candidate 2:.*candidate.mediaRequirements\[0\].slot.*expected existing slot/],
      ["label", r => r.candidates[1].label = " ", /Candidate 2:.*candidate.label.*expected/],
      ["rationale", r => r.candidates[1].rationale = " ", /Candidate 2:.*candidate.rationale.*expected/],
      ["action", r => r.candidates[1].proposedActions = [" "], /Candidate 2:.*candidate.proposedActions\[0\].*expected/],
    ];
    for (const [name, mutate, expected] of probes) {
      const out: any = {...response(contractPage()), requestId: q.request.id, requestHash: q.requestHash};
      out.candidates.push(structuredClone(out.candidates[0])); mutate(out);
      const input = {request: q.request, response: out, source: "Synthetic control", model: null, aiAuthorship: true};
      await assert.rejects(app.pages.apply(sent.projectId, input), expected);
      await assert.rejects(context.tool("submit_candidates", "reject-" + name, {request: q.request, response: out}), expected);
      const receipt = app.chat.store.action("contract-rejection", "reject-" + name)!;
      assert.equal(receipt["status"], "completed");
      const rejected = JSON.parse(String(receipt["result"])); assert.deepEqual(Object.keys(rejected), ["error"]);
      assert.match(rejected.error, expected); assert.ok(!rejected.error.includes("private-sentinel"));
      assert.deepEqual(await context.tool("submit_candidates", "reject-" + name, {request: q.request, response: out}), rejected);
      const http = await fetch(app.origin + "/api/v1/page/apply", {method: "POST", headers: {Origin: app.origin, "Content-Type": "application/json", "X-BVE-Token": session.token}, body: JSON.stringify({projectId: sent.projectId, input})});
      const body = await http.json() as {error: string}; assert.equal(http.status, 400); assert.equal(body.error, rejected.error);
      assert.deepEqual(app.workspace.kernel.latestPackets(), packets); assert.deepEqual(app.workspace.kernel.ledger(sent.projectId), ledger);
      assert.deepEqual(app.workspace.state(sent.projectId), selection); assert.deepEqual(app.pages.state(sent.projectId).accepted, {});
      assert.equal(app.pages.state(sent.projectId).pages.length, 0); assert.equal(app.pages.state(sent.projectId).results.length, 0);
      assert.deepEqual(app.chat.state(sent.projectId).session.turns[0]!.candidates, []); assert.equal(app.chat.store.jobs(sent.projectId).length, 0);
    }
  } finally { await app.close(); rmSync(root, {recursive: true, force: true}); }
});
