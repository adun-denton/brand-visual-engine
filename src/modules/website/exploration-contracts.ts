import type { Value, VersionRef } from "../../kernel/contracts.ts";
import type { ImageInfo } from "../../service/assets.ts";
import {
  record,
  string,
  id,
  ref,
  list,
  choice,
  integer,
  InputError,
} from "../../service/validation.ts";
import { parseImageInfo } from "./workspace-contracts.ts";
import { canonical, digest, atPath } from "../../kernel/packets.ts";
import {
  checksum,
  validateBinaryMask,
  MAX_REGION_PIXELS,
} from "../../kernel/raster.ts";
export const explorationRoles = {
  "raster-concept": "design-artifact",
  "page-work-unit": "work-record",
  "raster-selections": "work-record",
  "raster-specification": "work-record",
  "raster-batch": "work-record",
  "raster-receipt": "work-record",
  "raster-metrics": "work-record",
  "raster-membership": "work-record",
} as const;
export type ExplorationKind = keyof typeof explorationRoles;
export interface WorkUnit {
  version: 1;
  pageType: "homepage" | "about" | "custom";
  label: string;
  source: string;
}
export interface RasterConcept {
  version: 1;
  representation: "raster-v1";
  media: VersionRef;
  image: ImageInfo;
  orientation: "encoded-top-left";
  origin: "synthetic" | "imported" | "generated" | "semantic-screenshot";
}
export type Anchor =
  | { kind: "whole" }
  | {
      kind: "rectangle" | "ellipse";
      x: number;
      y: number;
      width: number;
      height: number;
    }
  | {
      kind: "mask";
      width: number;
      height: number;
      pixels: number[];
      hash: string;
    };
export interface Preservation {
  predicate: "retained-bytes" | "outside-mask-pixels";
  target: string;
}
export interface SelectionEntry {
  id: string;
  candidate: VersionRef;
  integrity: string;
  image: ImageInfo;
  orientation: "encoded-top-left";
  coordinates: "normalized-original";
  anchor: Anchor;
  intent: "inspiration" | "include" | "exact";
  preservation: Preservation | null;
  notes: { id: string; text: string; source: string }[];
}
export interface Selections {
  version: 1;
  workUnit: VersionRef;
  entries: SelectionEntry[];
}
export interface Metric {
  key: string;
  status: "requested" | "inferred" | "observed";
  value: Value;
  provenance: string;
  scale:
    | { kind: "continuous"; min: number; max: number; unit: string }
    | { kind: "category"; options: string[] };
}
export interface Membership {
  version: 1;
  workUnit: VersionRef;
  candidate: VersionRef;
  integrity: string;
  derivation: VersionRef[];
}
export interface Metrics {
  version: 1;
  candidate: VersionRef;
  integrity: string;
  values: Metric[];
}
export interface Specification {
  version: 1;
  compiler: "raster-input-v1";
  project: VersionRef;
  workUnit: VersionRef;
  medium: "website-raster";
  operation: "create" | "refine" | "refresh" | "branch";
  selections: VersionRef | null;
  selectionSnapshot: Selections | null;
  rawIntent: string;
  count: number;
  resources: {
    media: VersionRef;
    image: ImageInfo;
    rights: string;
    style: "included" | "excluded";
    content: "included" | "excluded";
  }[];
  direction: "fresh" | "follow";
  brand:
    | { enabled: false }
    | {
        enabled: true;
        source: VersionRef;
        integrity: string;
        values: Record<string, Value>;
      };
  sourceScopes: {
    entryId: string;
    style: "included" | "excluded";
    content: "included" | "excluded";
  }[];
  facts: { path: string; value: Value }[];
  constraints: { path: string; value: Value }[];
  metricRequests: Metric[];
  provenance: string;
  executionAuthorization: null;
}
export type AttemptStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "invalid"
  | "failed"
  | "cancelled"
  | "uncertain";
export interface Attempt {
  slot: number;
  status: AttemptStatus;
  result: VersionRef | null;
  receipt: VersionRef | null;
}
export interface Batch {
  version: 1;
  spec: VersionRef;
  specHash: string;
  workUnit: VersionRef;
  attempts: Attempt[];
  retryOf: { batch: VersionRef; slot: number } | null;
  executionAuthorization: null;
  harness: "synthetic-registration";
}
export interface Receipt {
  version: 1;
  receiptId: string;
  batch: VersionRef;
  slot: number;
  specHash: string;
  submissionHash: string;
  outcome: Exclude<AttemptStatus, "pending" | "running">;
  result: VersionRef | null;
  evidence: { media: VersionRef; image: ImageInfo } | null;
  usage: null;
  message: string;
  derivation: VersionRef[];
}
export class ExplorationConflict extends Error {
  code = "EXPLORATION_CONFLICT" as const;
  status = 409;
}
export function exactRef(x: unknown): VersionRef {
  const r = ref(x);
  if (r.freshness !== "pinned")
    throw new InputError("Exact pinned version required");
  return r;
}
export function hash(x: unknown): string {
  const s = string(x, 64);
  if (!/^[a-f0-9]{64}$/.test(s)) throw new InputError("Invalid integrity");
  return s;
}
const version = (r: Record<string, unknown>) => {
  if (r["version"] !== 1)
    throw new InputError("Unsupported exploration version");
};
const equal = (a: unknown, b: unknown, message: string) => {
  if (canonical(a) !== canonical(b)) throw new InputError(message);
};
export function parseWorkUnit(x: unknown): WorkUnit {
  const r = record(x, ["version", "pageType", "label", "source"]);
  version(r);
  return {
    version: 1,
    pageType: choice(r["pageType"], ["homepage", "about", "custom"]),
    label: string(r["label"], 200),
    source: string(r["source"]),
  };
}
export function parseConcept(x: unknown): RasterConcept {
  const r = record(x, [
    "version",
    "representation",
    "media",
    "image",
    "orientation",
    "origin",
  ]);
  version(r);
  return {
    version: 1,
    representation: choice(r["representation"], ["raster-v1"]),
    media: exactRef(r["media"]),
    image: parseImageInfo(r["image"]),
    orientation: choice(r["orientation"], ["encoded-top-left"]),
    origin: choice(r["origin"], [
      "synthetic",
      "imported",
      "generated",
      "semantic-screenshot",
    ]),
  };
}
export function parseAnchor(x: unknown, image: ImageInfo): Anchor {
  const r = record(x, ["kind", "x", "y", "width", "height", "pixels", "hash"]),
    kind = choice(r["kind"], ["whole", "rectangle", "ellipse", "mask"]);
  if (kind === "whole") {
    record(x, ["kind"]);
    return { kind };
  }
  if (image.width * image.height > MAX_REGION_PIXELS)
    throw new InputError("Region exceeds 4 MP bound");
  if (kind === "mask") {
    record(x, ["kind", "width", "height", "pixels", "hash"]);
    const width = integer(r["width"], 8192),
      height = integer(r["height"], 8192),
      pixels = list(
        r["pixels"],
        (p) => {
          if (p !== 0 && p !== 1) throw new InputError("Binary mask required");
          return p;
        },
        MAX_REGION_PIXELS,
      );
    validateBinaryMask(Uint8Array.from(pixels), width, height);
    if (
      width !== image.width ||
      height !== image.height ||
      checksum(Uint8Array.from(pixels)) !== hash(r["hash"])
    )
      throw new InputError("Mask binding mismatch");
    return { kind, width, height, pixels, hash: hash(r["hash"]) };
  }
  record(x, ["kind", "x", "y", "width", "height"]);
  const n = (v: unknown) => {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1)
      throw new InputError("Invalid normalized geometry");
    return v;
  };
  const a = {
    kind,
    x: n(r["x"]),
    y: n(r["y"]),
    width: n(r["width"]),
    height: n(r["height"]),
  };
  if (!a.width || !a.height || a.x + a.width > 1 || a.y + a.height > 1)
    throw new InputError("Region outside original image");
  return a;
}
export function parseSelections(x: unknown): Selections {
  const r = record(x, ["version", "workUnit", "entries"]);
  version(r);
  const entries = list(r["entries"], (v) => {
    const e = record(v, [
      "id",
      "candidate",
      "integrity",
      "image",
      "orientation",
      "coordinates",
      "anchor",
      "intent",
      "preservation",
      "notes",
    ]);
    const image = parseImageInfo(e["image"]),
      anchor = parseAnchor(e["anchor"], image),
      intent = choice(e["intent"], ["inspiration", "include", "exact"]);
    let preservation: Preservation | null = null;
    if (e["preservation"] !== null) {
      const p = record(e["preservation"], ["predicate", "target"]);
      preservation = {
        predicate: choice(p["predicate"], [
          "retained-bytes",
          "outside-mask-pixels",
        ]),
        target: id(p["target"]),
      };
      if (
        intent !== "exact" ||
        (preservation.predicate === "outside-mask-pixels" &&
          anchor.kind !== "mask") ||
        (preservation.predicate === "retained-bytes" && anchor.kind !== "whole")
      )
        throw new InputError("Unsupported exact preservation scope");
    } else if (intent === "exact")
      throw new InputError("Exact requires comparison predicate and target");
    const notes = list(e["notes"], (n) => {
      const p = record(n, ["id", "text", "source"]);
      return {
        id: id(p["id"]),
        text: string(p["text"]),
        source: string(p["source"]),
      };
    });
    if (new Set(notes.map((n) => n.id)).size !== notes.length)
      throw new InputError("Duplicate note");
    return {
      id: id(e["id"]),
      candidate: exactRef(e["candidate"]),
      integrity: hash(e["integrity"]),
      image,
      orientation: choice(e["orientation"], ["encoded-top-left"]),
      coordinates: choice(e["coordinates"], ["normalized-original"]),
      anchor,
      intent,
      preservation,
      notes,
    };
  });
  if (new Set(entries.map((e) => e.id)).size !== entries.length)
    throw new InputError("Duplicate selection entry");
  const targets = new Map<string, string>();
  for (const e of entries)
    if (e.preservation) {
      const signature = digest({
          image: e.image,
          anchor: e.anchor,
          predicate: e.preservation.predicate,
        }),
        before = targets.get(e.preservation.target);
      if (before && before !== signature)
        throw new ExplorationConflict(
          "Incompatible exact locks on target " + e.preservation.target,
        );
      targets.set(e.preservation.target, signature);
    }
  return { version: 1, workUnit: exactRef(r["workUnit"]), entries };
}
export function parseMetric(x: unknown): Metric {
  const r = record(x, ["key", "status", "value", "provenance", "scale"]);
  canonical(r["value"]);
  const s = record(r["scale"], ["kind", "min", "max", "unit", "options"]);
  let scale: Metric["scale"];
  if (s["kind"] === "continuous") {
    record(s, ["kind", "min", "max", "unit"]);
    if (
      typeof s["min"] !== "number" ||
      typeof s["max"] !== "number" ||
      !Number.isFinite(s["min"]) ||
      !Number.isFinite(s["max"]) ||
      s["min"] >= s["max"] ||
      typeof r["value"] !== "number" ||
      r["value"] < s["min"] ||
      r["value"] > s["max"]
    )
      throw new InputError("Metric scale/value mismatch");
    scale = {
      kind: "continuous",
      min: s["min"],
      max: s["max"],
      unit: string(s["unit"], 100),
    };
  } else {
    record(s, ["kind", "options"]);
    choice(s["kind"], ["category"]);
    const options = list(s["options"], (v) => string(v, 100));
    if (
      !options.length ||
      new Set(options).size !== options.length ||
      !options.includes(r["value"] as string)
    )
      throw new InputError("Metric category mismatch");
    scale = { kind: "category", options };
  }
  return {
    key: id(r["key"]),
    status: choice(r["status"], ["requested", "inferred", "observed"]),
    value: r["value"] as Value,
    provenance: string(r["provenance"]),
    scale,
  };
}
export function parseMetrics(x: unknown): Metrics {
  const r = record(x, ["version", "candidate", "integrity", "values"]);
  version(r);
  return {
    version: 1,
    candidate: exactRef(r["candidate"]),
    integrity: hash(r["integrity"]),
    values: list(r["values"], parseMetric),
  };
}
export function parseSpecification(x: unknown): Specification {
  const r = record(x, [
    "version",
    "compiler",
    "project",
    "workUnit",
    "medium",
    "operation",
    "selections",
    "selectionSnapshot",
    "rawIntent",
    "count",
    "resources",
    "direction",
    "brand",
    "sourceScopes",
    "facts",
    "constraints",
    "metricRequests",
    "provenance",
    "executionAuthorization",
  ]);
  version(r);
  const b = record(r["brand"], ["enabled", "source", "integrity", "values"]);
  let brand: Specification["brand"];
  if (b["enabled"] === false) {
    record(b, ["enabled"]);
    brand = { enabled: false };
  } else {
    if (b["enabled"] !== true)
      throw new InputError("Explicit brand enabled value required");
    const values = record(b["values"], Object.keys(b["values"] as object));
    canonical(values);
    brand = {
      enabled: true,
      source: exactRef(b["source"]),
      integrity: hash(b["integrity"]),
      values: values as Record<string, Value>,
    };
  }
  const constraints = (v: unknown) =>
    list(v, (v) => {
      const c = record(v, ["path", "value"]);
      canonical(c["value"]);
      return { path: string(c["path"], 200), value: c["value"] as Value };
    });
  const facts = constraints(r["facts"]),
    locks = constraints(r["constraints"]),
    paths = new Map<string, string>();
  for (const c of [...facts, ...locks]) {
    const value = canonical(c.value),
      before = paths.get(c.path);
    if (before !== undefined && before !== value)
      throw new ExplorationConflict("Conflicting required values at " + c.path);
    paths.set(c.path, value);
  }
  // Required values on parent and child paths must agree before an operation can freeze.
  const required = [...facts, ...locks];
  for (const parent of required)
    for (const child of required)
      if (child.path.startsWith(parent.path + ".")) {
        const nested = atPath(
          parent.value,
          child.path.slice(parent.path.length + 1),
        );
        if (
          nested === undefined ||
          canonical(nested) !== canonical(child.value)
        )
          throw new ExplorationConflict(
            "Conflicting nested required values at " + child.path,
          );
      }
  const selections =
      r["selections"] === null ? null : exactRef(r["selections"]),
    selectionSnapshot =
      r["selectionSnapshot"] === null
        ? null
        : parseSelections(r["selectionSnapshot"]);
  if ((selections === null) !== (selectionSnapshot === null))
    throw new InputError("Missing selection snapshot");
  const direction = choice(r["direction"], ["fresh", "follow"]),
    sourceScopes = list(r["sourceScopes"], (v) => {
      const s = record(v, ["entryId", "style", "content"]);
      return {
        entryId: id(s["entryId"]),
        style: choice(s["style"], ["included", "excluded"]),
        content: choice(s["content"], ["included", "excluded"]),
      };
    });
  equal(
    sourceScopes.map((s) => s.entryId).sort(),
    (selectionSnapshot?.entries ?? []).map((e) => e.id).sort(),
    "Source inclusion must cover exact selections once",
  );
  for (const s of sourceScopes) {
    const e = selectionSnapshot!.entries.find((e) => e.id === s.entryId)!;
    if (
      (direction === "fresh" && s.style !== "excluded") ||
      (e.intent !== "inspiration" && s.content !== "included")
    )
      throw new ExplorationConflict(
        "Influence cannot erase inclusion/preservation or inherit style during fresh",
      );
  }
  const resources = list(r["resources"], (v) => {
    const s = record(v, ["media", "image", "rights", "style", "content"]);
    return {
      media: exactRef(s["media"]),
      image: parseImageInfo(s["image"]),
      rights: string(s["rights"]),
      style: choice(s["style"], ["included", "excluded"]),
      content: choice(s["content"], ["included", "excluded"]),
    };
  });
  if (direction === "fresh" && resources.some((s) => s.style !== "excluded"))
    throw new ExplorationConflict(
      "Fresh must explicitly exclude resource style",
    );
  const metricRequests = list(r["metricRequests"], parseMetric);
  if (metricRequests.some((m) => m.status !== "requested"))
    throw new InputError("Specification metrics are requests only");
  if (r["executionAuthorization"] !== null)
    throw new InputError("V01 has no execution authorization");
  return {
    version: 1,
    compiler: choice(r["compiler"], ["raster-input-v1"]),
    project: exactRef(r["project"]),
    workUnit: exactRef(r["workUnit"]),
    medium: choice(r["medium"], ["website-raster"]),
    operation: choice(r["operation"], [
      "create",
      "refine",
      "refresh",
      "branch",
    ]),
    selections,
    selectionSnapshot,
    rawIntent: string(r["rawIntent"]),
    count: integer(r["count"], 6),
    resources,
    direction,
    brand,
    sourceScopes,
    facts,
    constraints: locks,
    metricRequests,
    provenance: string(r["provenance"]),
    executionAuthorization: null,
  };
}
export function parseBatch(x: unknown): Batch {
  const r = record(x, [
    "version",
    "spec",
    "specHash",
    "workUnit",
    "attempts",
    "retryOf",
    "executionAuthorization",
    "harness",
  ]);
  version(r);
  if (r["executionAuthorization"] !== null)
    throw new InputError("V01 has no execution authorization");
  const attempts = list(
    r["attempts"],
    (v) => {
      const a = record(v, ["slot", "status", "result", "receipt"]);
      return {
        slot: integer(a["slot"], 6),
        status: choice(a["status"], [
          "pending",
          "running",
          "succeeded",
          "invalid",
          "failed",
          "cancelled",
          "uncertain",
        ]),
        result: a["result"] === null ? null : exactRef(a["result"]),
        receipt: a["receipt"] === null ? null : exactRef(a["receipt"]),
      };
    },
    6,
  );
  if (
    !attempts.length ||
    attempts.some(
      (a, i) =>
        a.slot !== i + 1 || (a.status === "succeeded") !== (a.result !== null),
    )
  )
    throw new InputError("Invalid ordered attempt slots");
  let retryOf: Batch["retryOf"] = null;
  if (r["retryOf"] !== null) {
    const b = record(r["retryOf"], ["batch", "slot"]);
    retryOf = { batch: exactRef(b["batch"]), slot: integer(b["slot"], 6) };
  }
  return {
    version: 1,
    spec: exactRef(r["spec"]),
    specHash: hash(r["specHash"]),
    workUnit: exactRef(r["workUnit"]),
    attempts,
    retryOf,
    executionAuthorization: null,
    harness: choice(r["harness"], ["synthetic-registration"]),
  };
}
export function parseReceipt(x: unknown): Receipt {
  const r = record(x, [
    "version",
    "receiptId",
    "batch",
    "slot",
    "specHash",
    "submissionHash",
    "outcome",
    "result",
    "evidence",
    "usage",
    "message",
    "derivation",
  ]);
  version(r);
  if (r["usage"] !== null)
    throw new InputError("Synthetic usage must remain unknown");
  const outcome = choice(r["outcome"], [
      "succeeded",
      "invalid",
      "failed",
      "cancelled",
      "uncertain",
    ]),
    result = r["result"] === null ? null : exactRef(r["result"]);
  if ((outcome === "succeeded") !== (result !== null))
    throw new InputError("Receipt result/outcome mismatch");
  return {
    version: 1,
    receiptId: id(r["receiptId"]),
    batch: exactRef(r["batch"]),
    slot: integer(r["slot"], 6),
    specHash: hash(r["specHash"]),
    submissionHash: hash(r["submissionHash"]),
    outcome,
    result,
    evidence:
      r["evidence"] === null
        ? null
        : (() => {
            const e = record(r["evidence"], ["media", "image"]);
            return {
              media: exactRef(e["media"]),
              image: parseImageInfo(e["image"]),
            };
          })(),
    usage: null,
    message: string(r["message"]),
    derivation: list(r["derivation"], exactRef),
  };
}
export function parseMembership(x: unknown): Membership {
  const r = record(x, [
    "version",
    "workUnit",
    "candidate",
    "integrity",
    "derivation",
  ]);
  version(r);
  return {
    version: 1,
    workUnit: exactRef(r["workUnit"]),
    candidate: exactRef(r["candidate"]),
    integrity: hash(r["integrity"]),
    derivation: list(r["derivation"], exactRef),
  };
}
export function parseExploration(kind: ExplorationKind, x: unknown) {
  switch (kind) {
    case "page-work-unit":
      return parseWorkUnit(x);
    case "raster-concept":
      return parseConcept(x);
    case "raster-selections":
      return parseSelections(x);
    case "raster-specification":
      return parseSpecification(x);
    case "raster-batch":
      return parseBatch(x);
    case "raster-receipt":
      return parseReceipt(x);
    case "raster-metrics":
      return parseMetrics(x);
    case "raster-membership":
      return parseMembership(x);
  }
}
export function validateExplorationRecord(p: Record<string, unknown>): boolean {
  if (!Object.hasOwn(explorationRoles, String(p["kind"]))) return false;
  record(p, ["moduleId", "kind", "scope", "lockedValues", "state"]);
  if (
    p["moduleId"] !== "website" ||
    p["scope"] !== "page-exploration" ||
    Object.keys(record(p["lockedValues"], [])).length
  )
    throw new InputError("Invalid exploration ownership");
  equal(
    parseExploration(p["kind"] as ExplorationKind, p["state"]),
    p["state"],
    "Noncanonical exploration state",
  );
  return true;
}
