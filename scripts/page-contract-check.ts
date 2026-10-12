// Bounded acceptance/output comparison against the exact reviewed parser, offline.
// Extracts the verified base into a disposable directory, never a user runtime.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parsePage } from "../src/modules/website/page.ts";
import { InputError } from "../src/service/validation.ts";
import { contractCases, contractPage } from "./page-contract-fixture.ts";
const base = "83a1e476166b8205eeb883cf910b2bde75dcd316";
const repo = resolve(import.meta.dirname, "..");
assert.equal(execFileSync("git", ["rev-parse", base + "^{tree}"], {cwd: repo, encoding: "utf8"}).trim(), "e0d426b8b1e4d28a64ae7214222598ff97d9e068");
const extracted = mkdtempSync(join(tmpdir(), "bve-reviewed-parser-"));
execFileSync("tar", ["-x", "-C", extracted], {input: execFileSync("git", ["archive", base, "src"], {cwd: repo})});
const modulePath = join(extracted, "src/modules/website/page.ts");
const reviewed = await import(pathToFileURL(resolve(modulePath)).href) as {parsePage: typeof parsePage};
const cases = contractCases().map(c => ({name: c.family + ":" + c.name, page: c.page}));
const values = [null, false, 0, 1, [], {}, "", " ", "root", " root ", "a-b_1", "root\n", "x".repeat(161), "💡", "#target", "/", "https://example.invalid", "javascript:private-sentinel"];
for (const field of ["title", "language", "version", "media", "responsive", "unresolved", "root"]) {
  for (const value of values) cases.push({name: field + ":" + JSON.stringify(value), page: {...contractPage(), [field]: value}});
}
for (const kind of ["container", "section", "heading", "text", "link", "list", "media", "unknown"]) {
  for (const field of ["id", "kind", "text", "level", "href", "items", "slot", "alt", "decorative", "children", "style", "unknown"]) {
    for (const value of values) {
      const p: any = contractPage();
      p.root.children = [{id: "node", kind, text: "x", level: 1, href: "/", items: [], slot: "slot", alt: "", decorative: false, children: []}];
      // Keep a kind's proper shape independent of the production schema.
      const owned: Record<string, string[]> = {container: ["children"], section: ["children"], heading: ["text", "level"], text: ["text"], link: ["text", "href"], list: ["items"], media: ["slot", "alt", "decorative"]};
      for (const key of Object.keys(p.root.children[0])) if (!["id", "kind", ...(owned[kind] ?? [])].includes(key)) delete p.root.children[0][key];
      p.root.children[0][field] = value; p.media = kind === "media" ? {slot: null} : {};
      cases.push({name: kind + ":" + field + ":" + JSON.stringify(value), page: p});
    }
  }
}
for (let n = 0; n <= 510; n++) {
  for (const field of ["id", "href"] as const) {
    const p = contractPage();
    if (field === "id") p.root.children![0]!.id = "x".repeat(n);
    else p.root.children![0]!.href = "https://" + "x".repeat(n);
    cases.push({name: field + ":length:" + n, page: p});
  }
}
const result = (parser: typeof parsePage, page: unknown) => {
  try { return {accepted: true, page: parser(page, () => { throw new InputError("Unknown media handle"); })}; }
  catch { return {accepted: false}; }
};
let accepted = 0;
for (const c of cases) {
  const before = result(reviewed.parsePage, c.page), after = result(parsePage, c.page);
  assert.deepEqual(after, before, c.name); // Includes normalized output, not just boolean parity.
  if (after.accepted) accepted++;
}
const evidence = {base, cases: cases.length, accepted, rejected: cases.length - accepted, acceptanceDivergences: 0, normalizedOutputDivergences: 0, synthetic: true, accountCalls: 0};
const dir = resolve(process.env["BVE_EVIDENCE_DIR"] ?? "/tmp/bve-page-contract"); mkdirSync(dir, {recursive: true});
writeFileSync(join(dir, "reviewed-parser-parity.json"), JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify(evidence));

rmSync(extracted, {recursive: true, force: true});
