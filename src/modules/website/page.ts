import { parseStyle, numericStyles, StyleError } from "./style-contracts.ts";
export { parseStyle, styleProperties } from "./style-contracts.ts";
import type { VersionRef, Value } from "../../kernel/contracts.ts";
import {
  record,
  string,
  list,
  id,
  ref,
  choice,
  InputError,
} from "../../service/validation.ts";
import { parseImageInfo } from "./workspace-contracts.ts";
import type { ImageInfo } from "../../service/assets.ts";
import { canonical, digest } from "../../kernel/packets.ts";
import { escapeHtml } from "./composition.ts";

import { pageLimits as limits, pageKinds, hrefPattern, languagePattern } from "./page-contracts.ts";

export class PageError extends InputError {}
export function pageAt<T>(path: string, nodeId: string | undefined, expected: string, parse: () => T): T {
  try { return parse(); }
  catch (error) {
    if (error instanceof InputError && !(error instanceof PageError) && !(error instanceof StyleError))
      throw new PageError(`${error.message}; at ${path}${nodeId ? ` (node ${nodeId})` : ""}; expected ${expected}`, error.status);
    throw error;
  }
}
const fail = (message: string): never => { throw new InputError(message); };
export interface MediaBinding {
  asset: VersionRef;
  image: ImageInfo;
}
export interface Element {
  id: string;
  kind:
    | "container"
    | "section"
    | "heading"
    | "text"
    | "link"
    | "list"
    | "media";
  text?: string;
  level?: number;
  href?: string;
  items?: string[];
  slot?: string;
  alt?: string;
  decorative?: boolean;
  style?: Record<string, string | number>;
  children?: Element[];
}
export interface Page {
  version: 1;
  title: string;
  language: string;
  root: Element;
  media: Record<string, MediaBinding | null>;
  responsive: {
    maxWidth: number;
    nodeId: string;
    style: Record<string, string | number>;
  }[];
  unresolved: string[];
}
export interface PageState {
  page: Page;
  context: Record<string, Value>;
  rationale: string;
  locks: Lock[];
}
export interface MediaState {
  image: ImageInfo;
  label: string;
  role: "reference" | "placeable";
  permission: string;
}
export interface WebsiteState {
  title: string;
  pages: {
    route: string;
    label: string;
    artifact: VersionRef;
    integrity: string;
  }[];
}
export interface Lock {
  nodeId: string;
  field: "text" | "subtree" | "style";
  value: Value;
}
export function parsePage(
  input: unknown,
  resolveMedia?: (handle: string) => MediaBinding,
): Page {
  const r = pageAt("page", undefined, "page fields version,title,language,root,media,responsive,unresolved only", () => record(input, [
    "version",
    "title",
    "language",
    "root",
    "media",
    "responsive",
    "unresolved",
  ]));
  pageAt("page.version", undefined, "page grammar version1", () => {
    if (r["version"] !== 1) fail("Unsupported page grammar");
  });
  const language = pageAt("page.language", undefined, "language tag of 2–3 ASCII letters and optional 2–8 alphanumeric subtags; max30 UTF-16 units", () => {
    const value = string(r["language"], limits.language);
    if (!new RegExp(languagePattern).test(value)) fail("Invalid language tag");
    return value;
  });
  const ids = new Set<string>();
  let count = 0;
  const slots = new Set<string>();
  const slotNodes = new Map<string, string>();
  const anchors: { target: string; nodeId: string; path: string }[] = [];
  const identityPaths = new Map<string, string>();
  const element = (input: unknown, depth = 0, path = "page.root"): Element => {
    pageAt(path, undefined, `maximum depth${limits.depth} (root0) and ${limits.nodes} total nodes`, () => {
      if (depth > limits.depth || ++count > limits.nodes) fail("Page element resource bound exceeded");
    });
    const x = pageAt(path, undefined, "only declared node fields for its kind", () => record(input, [
      "id",
      "kind",
      "text",
      "level",
      "href",
      "items",
      "slot",
      "alt",
      "decorative",
      "style",
      "children",
    ]));
    const localId = pageAt(path + ".id", undefined, "local id with ASCII letters/digits/underscore/hyphen; max160 UTF-16 units", () => id(x["id"]));
    const node: Element = {
      id: localId,
      kind: pageAt(path + ".kind", localId, pageKinds.join("/"), () => choice(x["kind"], pageKinds)),
    };
    const field = <T>(name: string, expected: string, parse: () => T) => pageAt(path + "." + name, node.id, expected, parse);
    field("id", "unique local identity within this same page", () => {
      if (ids.has(node.id)) fail("Duplicate local element identity; first declared at " + identityPaths.get(node.id));
    });
    ids.add(node.id);
    identityPaths.set(node.id, path);
    if (x["style"] !== undefined) node.style = parseStyle(x["style"], {path: path + ".style", nodeId: node.id});
    if (["heading", "text", "link"].includes(node.kind))
      node.text = field("text", "nonblank text; max8000 UTF-16 units", () => string(x["text"], limits.text));
    else if (x["text"] !== undefined)
      field("text", "text only on heading/text/link", () => fail("Text belongs to text elements"));
    if (node.kind === "heading") {
      field("level", "explicit integer heading level1–6", () => { if (
        !Number.isInteger(x["level"]) ||
        Number(x["level"]) < 1 ||
        Number(x["level"]) > 6
      )
        fail("Heading level must be explicit"); });
      node.level = Number(x["level"]);
    } else if (x["level"] !== undefined)
      field("level", "level only on heading", () => fail("Level belongs to headings"));
    if (node.kind === "link") {
      node.href = field("href", "#local-id, slash path, https://, mailto: or tel: under the page href grammar; max500 UTF-16 units", () => {
        const value = string(x["href"], limits.href);
        if (!new RegExp(hrefPattern).test(value)) fail("Invalid link target");
        return value;
      });
      if (node.href.startsWith("#")) anchors.push({target: node.href.slice(1), nodeId: node.id, path: path + ".href"});
    } else if (x["href"] !== undefined)
      field("href", "href only on link", () => fail("Href belongs to links"));
    if (node.kind === "list")
      node.items = field("items", "list of at most100 nonblank strings", () => {
        let index = 0;
        return list(x["items"], v => field(`items[${index++}]`, "nonblank list text; max2000 UTF-16 units", () => string(v, limits.item)), limits.entries);
      });
    else if (x["items"] !== undefined)
      field("items", "items only on list", () => fail("Items belong to lists"));
    if (node.kind === "media") {
      node.slot = field("slot", "local slot id; max160 UTF-16 units", () => id(x["slot"]));
      slots.add(node.slot);
      if (!slotNodes.has(node.slot)) slotNodes.set(node.slot, node.id);
      node.alt = field("alt", "alt string (may be empty); max1000 UTF-16 units", () => string(x["alt"], limits.alt, true));
      node.decorative = field("decorative", "explicit boolean", () => {
        if (typeof x["decorative"] !== "boolean") fail("Declare decorative media explicitly");
        return x["decorative"] as boolean;
      });
      if (node.decorative && node.alt)
        field("alt", "empty trimmed alt when decorative=true", () => fail("Decorative media must use empty alt text"));
    } else if (["slot", "alt", "decorative"].some((k) => x[k] !== undefined))
      pageAt(path, node.id, "slot/alt/decorative only on media", () => fail("Media fields belong to media elements"));
    if (["container", "section"].includes(node.kind)) {
      let childIndex = 0;
      node.children = field("children", "container/section children array with at most100 entries", () => list(x["children"], (v) => element(v, depth + 1, `${path}.children[${childIndex++}]`), limits.entries));
    }
    else if (x["children"] !== undefined)
      field("children", "children only on container/section", () => fail("Children belong to containers"));
    return node;
  };
  const root = element(r["root"]);
  if (!["container", "section"].includes(root.kind))
    pageAt("page.root.kind", root.id, "container or section root", () => fail("Page root must contain elements"));
  for (const a of anchors)
    if (!ids.has(a.target)) pageAt(a.path, a.nodeId, "#target matching an existing local node id in this SAME candidate page (case-sensitive)", () => fail("Unknown local anchor #" + a.target.slice(0, limits.identity)));
  const mediaInput = pageAt("page.media", undefined, "exactly the slots used by this page's media nodes", () => record(r["media"], [...slots]));
  const media: Page["media"] = {};
  for (const slot of slots) {
    const v = mediaInput[slot];
    if (v === null) media[slot] = null;
    else if (resolveMedia) media[slot] = pageAt(`page.media["${slot}"]`, slotNodes.get(slot), "null or an exact supplied placeable/upload handle owned by this request/project; max100 UTF-16 units", () => resolveMedia(string(v, limits.handle)));
    else media[slot] = pageAt(`page.media["${slot}"]`, slotNodes.get(slot), "null or an exact pinned media binding", () => {
      const b = record(v, ["asset", "image"]);
      const asset = ref(b["asset"]);
      if (asset.freshness !== "pinned")
        throw new InputError("Media requires an exact pinned version");
      return { asset, image: parseImageInfo(b["image"]) };
    });
  }
  let responsiveIndex = 0;
  const responsive = pageAt("page.responsive", undefined, "array of at most100 responsive rules", () => list(
    r["responsive"],
    (v) => {
      const index = responsiveIndex++;
      const path = `page.responsive[${index}]`;
      const x = pageAt(path, undefined, "maxWidth,nodeId,style only", () => record(v, ["maxWidth", "nodeId", "style"]));
      pageAt(path + ".maxWidth", undefined, "integer viewport240–4096", () => { if (
        !Number.isInteger(x["maxWidth"]) ||
        Number(x["maxWidth"]) < limits.viewportMin ||
        Number(x["maxWidth"]) > limits.viewportMax
      )
        fail("Invalid responsive viewport"); });
      const nodeId = pageAt(path + ".nodeId", undefined, "local node id; max160 UTF-16 units", () => id(x["nodeId"]));
      pageAt(path + ".nodeId", nodeId, "existing local node id in this SAME candidate page", () => {
        if (!ids.has(nodeId)) fail("Unknown responsive node");
      });
      return {
        maxWidth: Number(x["maxWidth"]),
        nodeId,
        style: parseStyle(x["style"], {path: `page.responsive[${index}].style`, nodeId}),
      };
    },
    limits.entries,
  ));
  return {
    version: 1,
    title: pageAt("page.title", undefined, "nonblank title; max200 UTF-16 units", () => string(r["title"], limits.title)),
    language,
    root,
    media,
    responsive,
    unresolved: pageAt("page.unresolved", undefined, "array of at most100 nonblank findings; each max1000 UTF-16 units", () => {
      let index = 0;
      return list(r["unresolved"], v => pageAt(`page.unresolved[${index++}]`, undefined, "nonblank finding; max1000 UTF-16 units", () => string(v, limits.alt)), limits.entries);
    }),
  };
}
export function nodes(page: Page): Element[] {
  const all: Element[] = [];
  const walk = (n: Element) => {
    all.push(n);
    n.children?.forEach(walk);
  };
  walk(page.root);
  return all;
}
export function preservation(page: Page, locks: Lock[]): void {
  for (const [index, lock] of locks.entries()) {
    const node = nodes(page).find((n) => n.id === lock.nodeId);
    const actual = lock.field === "subtree" ? node : node?.[lock.field];
    if (actual === undefined || canonical(actual) !== canonical(lock.value))
      pageAt(`preservation[${index}].value`, lock.nodeId, `exact frozen ${lock.field} value on the locked node`, () => fail("Preservation failed for " + lock.nodeId + "/" + lock.field));
  }
}
export function pageFindings(page: Page): string[] {
  return [
    ...page.unresolved,
    ...nodes(page).flatMap((n) =>
      n.kind === "media"
        ? [
            ...(!page.media[n.slot!] ? ["Unresolved media: " + n.slot] : []),
            ...(!n.decorative && !n.alt
              ? ["Missing informational alt text: " + n.id]
              : []),
          ]
        : [],
    ),
  ];
}
export const pageSignature = (s: PageState) => digest(s);
export function renderPage(
  page: Page,
  mediaUrl: (b: MediaBinding) => string,
  navigation = "",
  linkUrl: (href: string) => string = (x) => x,
): string {
  const css = (style: Record<string, string | number> = {}) =>
    Object.entries(style)
      .map(
        ([k, v]) =>
          k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()) +
          ":" +
          v +
          (typeof v === "number" && numericStyles.has(k) ? "px" : ""),
      )
      .join(";");
  const rules =
    nodes(page)
      .map((n) => `[id="${n.id}"]{${css(n.style)}}`)
      .join("") +
    page.responsive
      .map(
        (r) =>
          `@media(max-width:${r.maxWidth}px){[id="${r.nodeId}"]{${css(r.style)}}}`,
      )
      .join("");
  const e = escapeHtml;
  const render = (n: Element): string => {
    const attr = ` id="${e(n.id)}"`;
    if (n.kind === "heading")
      return `<h${n.level}${attr}>${e(n.text)}</h${n.level}>`;
    if (n.kind === "text") return `<p${attr}>${e(n.text)}</p>`;
    if (n.kind === "link")
      return `<a${attr} href="${e(linkUrl(n.href!))}">${e(n.text)}</a>`;
    if (n.kind === "list")
      return `<ul${attr}>${n.items!.map((i) => `<li>${e(i)}</li>`).join("")}</ul>`;
    if (n.kind === "media") {
      const b = page.media[n.slot!]!;
      return b
        ? `<img${attr} src="${e(mediaUrl(b))}" alt="${e(n.alt)}" width="${b.image.width}" height="${b.image.height}"${n.decorative ? ' role="presentation"' : ""}>`
        : `<div${attr} class="missing">Unresolved media: ${e(n.slot)}</div>`;
    }
    const tag = n.kind === "section" ? "section" : "div";
    return `<${tag}${attr}>${n.children!.map(render).join("")}</${tag}>`;
  };
  return `<!doctype html><html lang="${e(page.language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${e(page.title)}</title><style>*{box-sizing:border-box}body{margin:0;overflow-wrap:anywhere}img{display:block;max-width:100%;height:auto}a:focus-visible{outline:3px solid currentColor;outline-offset:4px}.missing{border:1px dashed currentColor;padding:24px}${rules}</style></head><body>${navigation}${render(page.root)}</body></html>`;
}
export function parseWebsite(input: unknown): WebsiteState {
  const r = record(input, ["title", "pages"]);
  const pages = list(
    r["pages"],
    (v) => {
      const x = record(v, ["route", "label", "artifact", "integrity"]);
      const route = string(x["route"], 200);
      if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(route))
        throw new InputError("Use a directory route with trailing slash");
      const artifact = ref(x["artifact"]);
      if (artifact.freshness !== "pinned")
        throw new InputError("Website requires pinned page revisions");
      const integrity = string(x["integrity"], 64);
      if (!/^[a-f0-9]{64}$/.test(integrity))
        throw new InputError("Invalid page integrity");
      return { route, label: string(x["label"], 200), artifact, integrity };
    },
    32,
  );
  if (
    !pages.length ||
    !pages.some((p) => p.route === "/") ||
    new Set(pages.map((p) => p.route)).size !== pages.length
  )
    throw new InputError("Unique routes and a root page are required");
  return { title: string(r["title"], 200), pages };
}
export function validatePageRecord(p: Record<string, unknown>): boolean {
  if (p["kind"] === "website-page") {
    if (
      p["scope"] !== "page" ||
      Object.keys(record(p["lockedValues"], [])).length
    )
      throw new InputError("Invalid independent page scope");
    const s = record(p["state"], ["page", "context", "rationale", "locks"]);
    const page = parsePage(s["page"]);
    const context = record(s["context"], [
      "title",
      "intent",
      "audience",
      "offer",
      "response",
      "content",
      "exclusions",
      "commitments",
      "unresolved",
      "palette",
      "typeface",
      "motion",
      "density",
    ]);
    const forbidRef = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(forbidRef);
      else if (v && typeof v === "object") {
        const x = v as Record<string, unknown>;
        if ("id" in x && "version" in x)
          throw new InputError(
            "Context must freeze values without object references",
          );
        Object.values(x).forEach(forbidRef);
      }
    };
    forbidRef(context);
    canonical(context);
    string(s["rationale"]);
    const locks = list(
      s["locks"],
      (v) => {
        const x = record(v, ["nodeId", "field", "value"]);
        canonical(x["value"]);
        return {
          nodeId: id(x["nodeId"]),
          field: choice(x["field"], ["text", "subtree", "style"]),
          value: x["value"] as Value,
        };
      },
      100,
    );
    preservation(page, locks);
    return true;
  }
  if (p["kind"] === "page-media") {
    const s = record(p["state"], ["image", "label", "role", "permission"]);
    parseImageInfo(s["image"]);
    string(s["label"], 200);
    choice(s["role"], ["reference", "placeable"]);
    string(s["permission"]);
    return true;
  }
  if (p["kind"] === "website-assembly") {
    parseWebsite(p["state"]);
    return true;
  }
  return false;
}
