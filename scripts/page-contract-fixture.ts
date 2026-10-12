// Independent synthetic expectations for the pre-existing grammar. No live payloads.
import type { Page, Element } from "../src/modules/website/page.ts";
export function contractPage(): Page {
  return { version: 1, title: "Synthetic contract", language: "en",
    root: { id: "root", kind: "container", children: [
      { id: "forward", kind: "link", text: "Detail", href: "#target" },
      { id: "nest", kind: "section", children: [{ id: "target", kind: "text", text: "Detail" }] },
      { id: "backward", kind: "link", text: "Detail again", href: "#target" },
    ] }, media: {}, responsive: [], unresolved: [] };
}
export interface ContractCase { family: string; name: string; page: unknown; parser: boolean; schema: boolean }
export function contractCases(): ContractCase[] {
  const cases: ContractCase[] = [];
  const add = (family: string, name: string, mutate: (p: any) => void, parser = true, schema = parser) => {
    const page = contractPage(); mutate(page); cases.push({family, name, page, parser, schema});
  };
  add("identity", "forward/backward/nested/repeated targets", () => {});
  for (const value of ["a", "A_0-", "x".repeat(160), " \troot\n", "", " ", "x".repeat(161), "a.b", "a/b", "💡", null, 1])
    add("identity", "root id " + JSON.stringify(value), p => p.root.id = value, typeof value === "string" && ["a", "A_0-", "x".repeat(160), " \troot\n"].includes(value));
  add("identity", "duplicate trimmed id", p => p.root.children[1].children[0].id = " root ", false, true);
  add("anchor", "missing same-page target", p => p.root.children[0].href = "#missing", false, true);
  add("anchor", "case-sensitive target", p => p.root.children[0].href = "#Target", false, true);
  add("anchor", "target may be root", p => p.root.children[0].href = "#root");
  for (const value of ["/", "/abc", "/abc/def/", "https://example.invalid/x?y=#z", "mailto:a+b@example.invalid", "tel:+1(23)-4", " https://example.invalid \n", "javascript:alert(1)", "http://example.invalid", "//host.invalid", "/a?b", "#", "https://host.invalid/a b", "https://host.invalid/<x>", "https://host.invalid/\\x", "mailto:a?subject=x", "tel:1 2", "a".repeat(501), null])
    add("href", JSON.stringify(value), p => p.root.children[0].href = value, typeof value === "string" && ["/", "/abc", "/abc/def/", "https://example.invalid/x?y=#z", "mailto:a+b@example.invalid", "tel:+1(23)-4", " https://example.invalid \n"].includes(value));
  for (const value of [240, 4096, 239, 4097, 300.5, "300", null])
    add("responsive", "viewport " + value, p => p.responsive = [{maxWidth: value, nodeId: "root", style: {}}], value === 240 || value === 4096);
  add("responsive", "missing local reference", p => p.responsive = [{maxWidth: 240, nodeId: "missing", style: {}}], false, true);
  add("responsive", "trimmed/repeated local reference", p => p.responsive = Array.from({length: 100}, () => ({maxWidth: 240, nodeId: " root ", style: {}})));
  add("responsive", "101 entries", p => p.responsive = Array.from({length: 101}, () => ({maxWidth: 240, nodeId: "root", style: {}})), false);
  const validNodes: Element[] = [
    {id: "x", kind: "container", children: []}, {id: "x", kind: "section", children: []},
    {id: "x", kind: "heading", level: 1, text: "Heading"}, {id: "x", kind: "text", text: "Text"},
    {id: "x", kind: "link", text: "Link", href: "/"}, {id: "x", kind: "list", items: []},
    {id: "x", kind: "media", slot: "slot", alt: "", decorative: false},
  ];
  for (const node of validNodes) {
    const setup = (p: any) => { p.root.children = [structuredClone(node)]; p.media = node.kind === "media" ? {slot: null} : {}; };
    add("kind", node.kind + " required fields", setup);
    for (const field of Object.keys(node)) add("kind", node.kind + " missing " + field, p => { setup(p); delete p.root.children[0][field]; }, false);
    for (const [field, value] of Object.entries({text: "x", level: 1, href: "/", items: [], slot: "slot", alt: "", decorative: false, children: []})) {
      if (!(field in node)) add("kind", node.kind + " prohibited " + field, p => { setup(p); p.root.children[0][field] = value; }, false);
    }
  }
  for (const value of [1, 6, 0, 7, 1.5, "1", null]) add("heading", "level " + value, p => p.root.children = [{id: "x", kind: "heading", level: value, text: "X"}], value === 1 || value === 6);
  add("root", "section root", p => p.root.kind = "section");
  add("root", "leaf root", p => p.root = {id: "root", kind: "text", text: "x"}, false);
  add("fields", "unknown page field", p => p.secret = "not for diagnostics", false);
  add("fields", "unknown node field", p => p.root.secret = "not for diagnostics", false);
  add("fields", "wrong version", p => p.version = 2, false);
  for (const field of ["version", "title", "language", "root", "media", "responsive", "unresolved"])
    add("fields", "missing " + field, p => delete p[field], false);
  for (const value of ["en", "eng-12345678", " EN-us ", "e", "engl", "en-1", "en-123456789", "en-abc-abc-abc-abc-abc-abc-abc-abc", "", null])
    add("language", JSON.stringify(value), p => p.language = value, ["en", "eng-12345678", " EN-us "].includes(value as string));
  for (const [field, max] of [["title", 200], ["text", 8000], ["item", 2000], ["alt", 1000], ["unresolved", 1000]] as const) {
    for (const n of [0, 1, max, max + 1]) add("length", field + ":" + n, p => {
      const value = "x".repeat(n);
      if (field === "title") p.title = value;
      if (field === "text") p.root.children[1].children[0].text = value;
      if (field === "item") p.root.children = [{id: "x", kind: "list", items: [value]}];
      if (field === "alt") { p.root.children = [{id: "x", kind: "media", slot: "slot", alt: value, decorative: false}]; p.media = {slot: null}; }
      if (field === "unresolved") p.unresolved = [value];
    }, (n > 0 || field === "alt") && n <= max);
  }
  add("length", "UTF16 residual: astral title", p => p.title = "💡".repeat(101), false, true);
  for (const n of [100, 101]) {
    add("count", "children " + n, p => p.root.children = Array.from({length: n}, (_, i) => ({id: "t" + i, kind: "text", text: "x"})), n === 100);
    add("count", "items " + n, p => p.root.children = [{id: "x", kind: "list", items: Array(n).fill("x")}], n === 100);
    add("count", "unresolved " + n, p => p.unresolved = Array(n).fill("x"), n === 100);
  }
  for (const total of [400, 401]) add("aggregate", "nodes " + total, p => {
    p.root.children = Array.from({length: 4}, (_, i) => ({id: "group" + i, kind: "container", children: []}));
    for (let i = 5; i < total; i++) p.root.children[(i - 5) % 4].children.push({id: "t" + i, kind: "text", text: "x"});
  }, total === 400, true);
  for (const depth of [12, 13]) add("aggregate", "depth " + depth, p => {
    p.root.children = []; let parent = p.root;
    for (let i = 1; i <= depth; i++) { const child = {id: "d" + i, kind: "container", children: []}; parent.children.push(child); parent = child; }
  }, depth === 12, true);
  const media = (p: any) => { p.root.children = [{id: "media-node", kind: "media", slot: "slot", alt: "", decorative: false}]; p.media = {slot: null}; };
  add("media", "unresolved informational alt is accepted", media);
  add("media", "shared slot", p => { media(p); p.root.children.push({...p.root.children[0], id: "other"}); });
  add("media", "trimmed empty decorative alt", p => { media(p); p.root.children[0].decorative = true; p.root.children[0].alt = " \n\t"; });
  add("media", "nonempty decorative alt", p => { media(p); p.root.children[0].decorative = true; p.root.children[0].alt = "Not decorative"; }, false);
  add("media", "missing slot mapping", p => { media(p); p.media = {}; }, false, true);
  add("media", "extra slot mapping", p => { media(p); p.media.extra = null; }, false, true);
  add("media", "invented handle", p => { media(p); p.media.slot = "unknown-handle"; }, false, true);
  add("media", "empty handle", p => { media(p); p.media.slot = " "; }, false);
  return cases;
}
