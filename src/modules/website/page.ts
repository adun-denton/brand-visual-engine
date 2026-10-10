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
export const styleProperties = [
  "display",
  "flexDirection",
  "flexWrap",
  "justifyContent",
  "alignItems",
  "gap",
  "gridTemplateColumns",
  "gridColumn",
  "gridRow",
  "padding",
  "margin",
  "width",
  "maxWidth",
  "minHeight",
  "background",
  "color",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "textAlign",
  "border",
  "borderRadius",
  "objectFit",
  "aspectRatio",
  "opacity",
] as const;
const numericStyles = new Set([
  "gap",
  "padding",
  "margin",
  "width",
  "maxWidth",
  "minHeight",
  "fontSize",
  "letterSpacing",
  "borderRadius",
]);
const enumStyles: Record<string, readonly string[]> = {
  display: ["block", "flex", "grid", "inline", "inline-block", "none"],
  flexDirection: ["row", "column", "row-reverse", "column-reverse"],
  flexWrap: ["wrap", "nowrap"],
  justifyContent: [
    "start",
    "end",
    "center",
    "space-between",
    "space-around",
    "space-evenly",
  ],
  alignItems: ["start", "end", "center", "stretch", "baseline"],
  textAlign: ["left", "right", "center", "start", "end"],
  objectFit: ["cover", "contain"],
};
export function parseStyle(input: unknown): Record<string, string | number> {
  const r = record(input, [...styleProperties]);
  for (const [k, v] of Object.entries(r)) {
    if (enumStyles[k]) choice(v, enumStyles[k]!);
    else if (numericStyles.has(k)) {
      if (typeof v === "number") {
        if (
          !Number.isFinite(v) ||
          v < (k === "letterSpacing" ? -10 : 0) ||
          v > 4096
        )
          throw new InputError("Style dimension exceeds bounds");
      } else if (
        typeof v !== "string" ||
        !/^(auto|[0-9]+(?:\.[0-9]+)?(?:px|rem|em|ch|%|vw|vh))$/.test(v) ||
        parseFloat(v) > 4096
      )
        throw new InputError("Use a bounded dimension or auto");
    } else if (k === "background" || k === "color") {
      if (
        typeof v !== "string" ||
        !/^(#(?:[a-fA-F0-9]{3}|[a-fA-F0-9]{4}|[a-fA-F0-9]{6}|[a-fA-F0-9]{8})|transparent|currentColor)$/.test(
          v,
        )
      )
        throw new InputError("Use a hex color");
    } else if (k === "fontFamily") {
      if (
        typeof v !== "string" ||
        v.length > 150 ||
        !/^[A-Za-z0-9 ,'-]+$/.test(v)
      )
        throw new InputError("Use local font families");
    } else if (k === "gridTemplateColumns") {
      if (
        typeof v !== "string" ||
        v.length > 200 ||
        !/^(?:minmax\(0,[0-9.]+fr\)|[0-9.]+(?:fr|px|%|rem)|auto)(?: (?:minmax\(0,[0-9.]+fr\)|[0-9.]+(?:fr|px|%|rem)|auto))*$/.test(
          v,
        )
      )
        throw new InputError("Invalid grid columns");
    } else if (k === "gridColumn" || k === "gridRow") {
      if (
        typeof v !== "string" ||
        !/^(auto|[1-9][0-9]?(?: \/ (?:[1-9][0-9]?|span [1-9][0-9]?))?)$/.test(v)
      )
        throw new InputError("Invalid grid placement");
    } else if (k === "border") {
      if (
        typeof v !== "string" ||
        !/^(none|[0-9]{1,2}px (?:solid|dashed|dotted) (?:#(?:[a-fA-F0-9]{3}|[a-fA-F0-9]{4}|[a-fA-F0-9]{6}|[a-fA-F0-9]{8})|currentColor))$/.test(
          v,
        )
      )
        throw new InputError("Invalid border");
    } else if (k === "aspectRatio") {
      if (
        typeof v !== "string" ||
        !/^[1-9][0-9]{0,2} \/ [1-9][0-9]{0,2}$/.test(v)
      )
        throw new InputError("Invalid aspect ratio");
    } else {
      const bounds: Record<string, [number, number]> = {
        fontWeight: [100, 900],
        lineHeight: [0.8, 4],
        opacity: [0, 1],
      };
      const range = bounds[k]!;
      if (
        typeof v !== "number" ||
        !Number.isFinite(v) ||
        v < range[0] ||
        v > range[1]
      )
        throw new InputError("Invalid numeric style");
    }
  }
  return r as Record<string, string | number>;
}
export function parsePage(
  input: unknown,
  resolveMedia?: (handle: string) => MediaBinding,
): Page {
  const r = record(input, [
    "version",
    "title",
    "language",
    "root",
    "media",
    "responsive",
    "unresolved",
  ]);
  if (r["version"] !== 1) throw new InputError("Unsupported page grammar");
  const language = string(r["language"], 30);
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language))
    throw new InputError("Invalid language tag");
  const ids = new Set<string>();
  let count = 0;
  const slots = new Set<string>();
  const anchors: string[] = [];
  const element = (input: unknown, depth = 0): Element => {
    if (depth > 12 || ++count > 400)
      throw new InputError("Page element resource bound exceeded");
    const x = record(input, [
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
    ]);
    const node: Element = {
      id: id(x["id"]),
      kind: choice(x["kind"], [
        "container",
        "section",
        "heading",
        "text",
        "link",
        "list",
        "media",
      ]),
    };
    if (ids.has(node.id))
      throw new InputError("Duplicate local element identity");
    ids.add(node.id);
    if (x["style"] !== undefined) node.style = parseStyle(x["style"]);
    if (["heading", "text", "link"].includes(node.kind))
      node.text = string(x["text"], 8000);
    else if (x["text"] !== undefined)
      throw new InputError("Text belongs to text elements");
    if (node.kind === "heading") {
      if (
        !Number.isInteger(x["level"]) ||
        Number(x["level"]) < 1 ||
        Number(x["level"]) > 6
      )
        throw new InputError("Heading level must be explicit");
      node.level = Number(x["level"]);
    } else if (x["level"] !== undefined)
      throw new InputError("Level belongs to headings");
    if (node.kind === "link") {
      node.href = string(x["href"], 500);
      if (
        !/^(#[a-zA-Z0-9_-]+|\/(?:[a-zA-Z0-9_-]+\/?)*|https:\/\/[^\s<>"'\\]+|mailto:[a-zA-Z0-9._+@-]+|tel:[+0-9()-]+)$/.test(
          node.href,
        )
      )
        throw new InputError("Invalid link target");
      if (node.href.startsWith("#")) anchors.push(node.href.slice(1));
    } else if (x["href"] !== undefined)
      throw new InputError("Href belongs to links");
    if (node.kind === "list")
      node.items = list(x["items"], (v) => string(v, 2000), 100);
    else if (x["items"] !== undefined)
      throw new InputError("Items belong to lists");
    if (node.kind === "media") {
      node.slot = id(x["slot"]);
      slots.add(node.slot);
      node.alt = string(x["alt"], 1000, true);
      if (typeof x["decorative"] !== "boolean")
        throw new InputError("Declare decorative media explicitly");
      node.decorative = x["decorative"];
      if (node.decorative && node.alt)
        throw new InputError("Decorative media must use empty alt text");
    } else if (["slot", "alt", "decorative"].some((k) => x[k] !== undefined))
      throw new InputError("Media fields belong to media elements");
    if (["container", "section"].includes(node.kind))
      node.children = list(x["children"], (v) => element(v, depth + 1), 100);
    else if (x["children"] !== undefined)
      throw new InputError("Children belong to containers");
    return node;
  };
  const root = element(r["root"]);
  if (!["container", "section"].includes(root.kind))
    throw new InputError("Page root must contain elements");
  for (const a of anchors)
    if (!ids.has(a)) throw new InputError("Unknown local anchor");
  const mediaInput = record(r["media"], [...slots]);
  const media: Page["media"] = {};
  for (const slot of slots) {
    const v = mediaInput[slot];
    if (v === null) media[slot] = null;
    else if (resolveMedia) media[slot] = resolveMedia(string(v, 100));
    else {
      const b = record(v, ["asset", "image"]);
      const asset = ref(b["asset"]);
      if (asset.freshness !== "pinned")
        throw new InputError("Media requires an exact pinned version");
      media[slot] = { asset, image: parseImageInfo(b["image"]) };
    }
  }
  const responsive = list(
    r["responsive"],
    (v) => {
      const x = record(v, ["maxWidth", "nodeId", "style"]);
      if (
        !Number.isInteger(x["maxWidth"]) ||
        Number(x["maxWidth"]) < 240 ||
        Number(x["maxWidth"]) > 4096
      )
        throw new InputError("Invalid responsive viewport");
      const nodeId = id(x["nodeId"]);
      if (!ids.has(nodeId)) throw new InputError("Unknown responsive node");
      return {
        maxWidth: Number(x["maxWidth"]),
        nodeId,
        style: parseStyle(x["style"]),
      };
    },
    100,
  );
  return {
    version: 1,
    title: string(r["title"], 200),
    language,
    root,
    media,
    responsive,
    unresolved: list(r["unresolved"], (v) => string(v, 1000), 100),
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
  for (const lock of locks) {
    const node = nodes(page).find((n) => n.id === lock.nodeId);
    const actual = lock.field === "subtree" ? node : node?.[lock.field];
    if (actual === undefined || canonical(actual) !== canonical(lock.value))
      throw new InputError(
        "Preservation failed for " + lock.nodeId + "/" + lock.field,
      );
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
