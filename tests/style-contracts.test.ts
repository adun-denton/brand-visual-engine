import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Ajv2020 } from "ajv/dist/2020.js";
import { parseStyle, styleProperties, styleSchema, styleGuidance } from "../src/modules/website/style-contracts.ts";
import { parsePage } from "../src/modules/website/page.ts";
import { inferenceOutputSchema } from "../src/modules/website/inference-contracts.ts";
import { repairPage, repairResult } from "../scripts/inference-repair-fixture.ts";
import { startApp } from "../src/service/server.ts";
import type { ChatDriver } from "../src/service/chat-contracts.ts";

const ajv = new Ajv2020({ strict: true });
const validateStyle = ajv.compile(styleSchema);
const validateResponse = ajv.compile(inferenceOutputSchema);
const accepted = (style: unknown) => { try { parseStyle(style); return true; } catch { return false; } };
const families: Record<string, { valid: unknown[]; invalid: unknown[] }> = {};
const add = (names: string[], valid: unknown[], invalid: unknown[]) => {
  for (const name of names) families[name] = {valid, invalid};
};
const enums = {
  display: ["block", "flex", "grid", "inline", "inline-block", "none"],
  flexDirection: ["row", "column", "row-reverse", "column-reverse"],
  flexWrap: ["wrap", "nowrap"],
  justifyContent: ["start", "end", "center", "space-between", "space-around", "space-evenly"],
  alignItems: ["start", "end", "center", "stretch", "baseline"],
  textAlign: ["left", "right", "center", "start", "end"],
  objectFit: ["cover", "contain"],
};
for (const [name, values] of Object.entries(enums)) add([name], values, ["inherit", "row wrap", "", 1]);
const dimensions = ["gap", "padding", "margin", "width", "maxWidth", "minHeight", "fontSize", "letterSpacing", "borderRadius"];
add(dimensions, [
  0, 0.25, 4096, "auto", ...["px", "rem", "em", "ch", "%", "vw", "vh"].map(u => "22.5" + u),
  "0px", "4096px", "4095.999px", "00004096.0000px",
  // The prior parser's parseFloat boundary rounds this scalar to4096.
  "4096.0000000000001px", "4096.00000000000045474735088646411895751953125px",
], [-11, 4097, "4096.0001px", "4096.00000000000045474735088646411895751953126px",
  "22px 7%", "0 auto", "22", "-1px", ".5em", "1e2px", "1calc(2px)", "inherit", "22pt", "22px\n"]);
add(["fontWeight"], [100, 700, 700.5, 900], [99, 901, "700", "bold"]);
add(["lineHeight"], [0.8, 1.05, 4], [0.79, 4.01, "1.05", "normal"]);
add(["opacity"], [0, 0.5, 1], [-0.01, 1.01, "1"]);
add(["color", "background"], ["#abc", "#AbCd", "#ABCdef", "#12345678", "transparent", "currentColor"],
  ["red", "#ab", "#abcde", "#ggg", "rgb(0,0,0)", "url(https://unrelated.invalid/private)", 0]);
add(["fontFamily"], ["Georgia, serif", "'Times New Roman', serif", "a".repeat(150), " "],
  ["a".repeat(151), '"Georgia"', "عربي", "font; background:url(secret)", "url(font)", 1]);
add(["gridTemplateColumns"], ["auto", "1fr 1fr 1fr", "minmax(0,1fr) auto", "20px 70% 2rem", ".fr"],
  ["repeat(3, 1fr)", "minmax(0, 1fr)", "1fr  1fr", "calc(2px)", "a".repeat(201), 3]);
add(["gridColumn", "gridRow"], ["auto", "1", "99", "1 / 3", "1 / span 99"],
  ["0", "100", "1/3", "span 2", "1 / span 100", 1]);
add(["border"], ["none", "0px solid #abc", "99px dashed #abcd", "1px dotted #12345678", "1px solid currentColor"],
  ["0 0 1px solid #abc", "100px solid #abc", "1px double #abc", "1px solid transparent", "1px solid red", 0]);
add(["aspectRatio"], ["1 / 1", "16 / 9", "999 / 999"],
  ["16/9", "0 / 1", "1000 / 1", "1.5 / 1", 1]);

test("all27 style families have independent JSON Schema/parser valid and invalid boundary parity", () => {
  assert.equal(styleProperties.length, 27);
  assert.deepEqual(Object.keys(families).sort(), [...styleProperties].sort());
  for (const [property, values] of Object.entries(families)) {
    for (const [expected, cases] of [[true, values.valid], [false, [...values.invalid, null, true, {}, [], NaN, Infinity]]] as const) {
      for (const value of cases) {
        const style = {[property]: value};
        assert.equal(validateStyle(style), expected, property + " schema " + JSON.stringify(value));
        assert.equal(accepted(style), expected, property + " parser " + JSON.stringify(value));
      }
    }
  }
  for (const value of [-10, -0.1]) {
    assert.equal(validateStyle({letterSpacing: value}), true);
    assert.equal(accepted({letterSpacing: value}), true);
    assert.equal(validateStyle({padding: value}), false);
    assert.equal(accepted({padding: value}), false);
  }
  for (const value of [{position: "fixed"}, [], null, "padding:22px"]) {
    assert.equal(validateStyle(value), false); assert.equal(accepted(value), false);
  }
});

test("generated guidance example and full inference node/responsive styles use the same constraints", () => {
  assert.equal(validateStyle(styleGuidance.example), true);
  assert.deepEqual(parseStyle(styleGuidance.example), styleGuidance.example);
  const response = repairResult({id: "synthetic-request", integrity: "0".repeat(64)});
  const page = response.candidates[0]!.page;
  page.root.style = {...styleGuidance.example};
  page.responsive = [{maxWidth: 390, nodeId: "root", style: {gridTemplateColumns: "1fr", padding: 16, fontWeight: 700}}];
  assert.equal(validateResponse(response), true);
  assert.doesNotThrow(() => parsePage(page));
  for (const [property, value] of [["padding", "22px 7%"], ["margin", "0 auto"], ["fontWeight", "700"],
    ["lineHeight", "1.05"], ["gridTemplateColumns", "repeat(3, 1fr)"], ["border", "0 0 1px solid #abc"]] as const) {
    for (const location of ["node", "responsive"] as const) {
      const malformed = structuredClone(response);
      if (location === "node") malformed.candidates[0]!.page.root.children![0]!.style = {[property]: value};
      else malformed.candidates[0]!.page.responsive[0]!.style = {[property]: value};
      assert.equal(validateResponse(malformed), false, property + "/" + location);
      assert.throws(() => parsePage(malformed.candidates[0]!.page), error =>
        error instanceof Error && error.message.includes(property)
          && error.message.includes(location === "node" ? "page.root.children[0]" : "page.responsive[0]")
          && error.message.includes(location === "node" ? "node heading" : "node root")
          && error.message.includes("expected"));
    }
  }
});

test("scalar grammar and bound parity span leading zeros, all units and exact ceiling neighbors", () => {
  // Exercises values around the prior4096 parseFloat limit independently of the shared pattern.
  const legacy = (v: string) => /^(auto|[0-9]+(?:\.[0-9]+)?(?:px|rem|em|ch|%|vw|vh))$/.test(v) && !(parseFloat(v) > 4096);
  for (let n = 0; n <= 4200; n++) {
    for (const suffix of ["px", "rem", "%"]) {
      for (const value of [String(n) + suffix, "000" + n + ".25" + suffix]) {
        assert.equal(validateStyle({width: value}), legacy(value));
        assert.equal(accepted({width: value}), legacy(value));
      }
    }
  }
});

test("malformed second candidate and responsive styles write nothing; rejected chat receipts remain truthful and idempotent", async () => {
  let context!: Parameters<ChatDriver["run"]>[0];
  const driver: ChatDriver = {kind: "test-fixture", close: async () => {}, run: async c => {
    context = c; await new Promise<void>(r => c.signal.addEventListener("abort", () => r(), {once: true}));
    return {status: "interrupted", model: null, usage: null};
  }};
  const app = await startApp(mkdtempSync(join(tmpdir(), "bve-style-intake-")), 0, undefined, undefined, {chatDriver: driver});
  try {
    const sent = app.chat.send({projectId: null, clientId: "style-rejection", text: "Mechanical style intake; no live output", focus: {view: "studio", page: null, resources: [], target: null}});
    const q = await context.tool("prepare_design", "style-prepare", {operation: "create", instruction: "Synthetic alternative boundary", locks: []}) as {request: {id: string; version: number; freshness: "pinned"}; requestHash: string; styleGuidance: typeof styleGuidance};
    assert.deepEqual(q.styleGuidance, styleGuidance);
    const beforePackets = app.workspace.kernel.latestPackets();
    const beforeLedger = app.workspace.kernel.ledger(sent.projectId);
    for (const location of ["node", "responsive"] as const) {
      const response = repairResult({id: q.request.id, integrity: q.requestHash});
      response.candidates.push({...response.candidates[0]!, page: repairPage("Second synthetic alternative")});
      const page = response.candidates[1]!.page;
      if (location === "node") page.root.children![0]!.style = {fontWeight: "700"};
      else page.responsive = [{maxWidth: 390, nodeId: "heading", style: {padding: "22px 7%"}}];
      const input = {request: q.request, response};
      const actionId = "reject-" + location;
      await assert.rejects(context.tool("submit_candidates", actionId, input), error =>
        error instanceof Error && error.message.startsWith("Candidate 2:")
          && error.message.includes(location === "node" ? 'page.root.children[0].style["fontWeight"]' : 'page.responsive[0].style["padding"]')
          && error.message.includes("node heading") && error.message.includes("expected"));
      const receipt = app.chat.store.action("style-rejection", actionId)!;
      assert.equal(receipt["status"], "completed"); // completion of an error receipt, not submission success
      const rejection = JSON.parse(String(receipt["result"]));
      assert.deepEqual(Object.keys(rejection), ["error"]);
      assert.deepEqual(await context.tool("submit_candidates", actionId, input), rejection);
      assert.equal(app.pages.state(sent.projectId).pages.length, 0);
      assert.equal(app.pages.state(sent.projectId).results.length, 0);
      assert.deepEqual(app.chat.state(sent.projectId).session.turns[0]!.candidates, []);
      assert.equal(app.chat.store.jobs(sent.projectId).length, 0);
      assert.deepEqual(app.workspace.kernel.latestPackets(), beforePackets);
      assert.deepEqual(app.workspace.kernel.ledger(sent.projectId), beforeLedger);
      assert.deepEqual(app.pages.state(sent.projectId).accepted, {});
    }
    // HTTP errors carry the same actionable message and do not echo supplied private values.
    const response = repairResult({id: q.request.id, integrity: q.requestHash});
    response.candidates[0]!.page.root.style = {color: "url(https://unrelated.invalid/private-context)"};
    const session = await (await fetch(app.origin + "/api/v1/session")).json() as {token: string};
    const http = await fetch(app.origin + "/api/v1/page/apply", {method: "POST", headers: {Origin: app.origin, "Content-Type": "application/json", "X-BVE-Token": session.token},
      body: JSON.stringify({projectId: sent.projectId, input: {request: q.request, response, source: "Synthetic HTTP control", model: null, aiAuthorship: true}})});
    const body = await http.json() as {error: string};
    assert.equal(http.status, 400);
    assert.match(body.error, /Candidate 1:.*node root.*expected hex color/);
    assert.ok(!body.error.includes("private-context"));
    assert.equal(app.pages.state(sent.projectId).pages.length, 0);
    assert.equal(app.pages.state(sent.projectId).results.length, 0);
    assert.deepEqual(app.workspace.kernel.latestPackets(), beforePackets);
    assert.deepEqual(app.workspace.kernel.ledger(sent.projectId), beforeLedger);
    assert.deepEqual(app.pages.state(sent.projectId).accepted, {});
  } finally { await app.close(); }
});
