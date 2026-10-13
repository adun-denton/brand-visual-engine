import type {
  VersionRef,
  Value,
  DesignArtifact,
  NodePacket,
} from "../../kernel/contracts.ts";
import type { ImageInfo } from "../../service/assets.ts";
import type { Page, Lock, MediaState } from "./page.ts";
import { parsePage, pageSignature } from "./page.ts";
import { parseLocks } from "./inference-contracts.ts";
import { canonical } from "../../kernel/packets.ts";
import {
  record,
  list,
  string,
  integer as positiveInteger,
  choice,
  id,
  InputError,
} from "../../service/validation.ts";
import { exactRef, hash } from "./exploration-contracts.ts";
import { parseImageInfo } from "./workspace-contracts.ts";
function integer(value: unknown, min: number, max: number) {
  const n = positiveInteger(value, max);
  if (n < min) throw new InputError("Invalid bounded reconstruction number");
  return n;
}
export const reconstructionRoles = {
  "reconstruction-request": "work-record",
  "reconstruction-control": "work-record",
  "reconstruction-result": "work-record",
  "reconstruction-review": "work-record",
} as const;
export type ReconstructionKind = keyof typeof reconstructionRoles;
export type Work<T> = NodePacket<DesignArtifact<T>>;
export interface ReconstructionSource {
  candidate: VersionRef;
  integrity: string;
  membership: VersionRef;
  membershipIntegrity: string;
  media: VersionRef;
  mediaIntegrity: string;
  image: ImageInfo;
  rights: string;
}
export interface ReconstructionResource {
  handle: string;
  label: string;
  role: "reference" | "placeable";
  media: VersionRef;
  integrity: string;
  state: MediaState;
}
export interface ReconstructionRequest {
  version: 1;
  project: VersionRef;
  workUnit: VersionRef;
  source: ReconstructionSource;
  instruction: string;
  count: number;
  slots: number[];
  viewports: { width: number; height: number }[];
  brand:
    | { enabled: false }
    | {
        enabled: true;
        source: VersionRef;
        integrity: string;
        values: Record<string, Value>;
      };
  base: null | { ref: VersionRef; signature: string; page: Page };
  locks: Lock[];
  resources: ReconstructionResource[];
  evidence: { ref: VersionRef; integrity: string; text: string }[];
  context: Record<string, Value>;
  grammar: { name: "bve.page"; version: 1 };
  previousControl: VersionRef | null;
  epoch: number;
  heads: {
    project: number;
    workUnit: number;
    source: number;
    base: number | null;
    brand: number | null;
  };
  limits: { maxReceipts: 1; maxCandidates: number; automaticRetry: false };
}
export interface ReconstructionControl {
  version: 1;
  workUnit: VersionRef;
  request: VersionRef;
  requestHash: string;
  status: "pending" | "returned" | "cancelled";
  result: VersionRef | null;
  reason: string;
}
export interface ReconstructionSubmission {
  schema: "bve.reconstruction-result";
  version: 1;
  request: VersionRef;
  requestHash: string;
  project: VersionRef;
  source: { candidate: VersionRef; integrity: string };
  baseSignature: string | null;
  receiptId: string;
  slots: { slot: number; candidate: unknown }[];
  findings: string[];
  provenance: { kind: "authored-test-fixture"; generation: false };
}
export interface ReconstructionResult {
  version: 1;
  workUnit: VersionRef;
  request: VersionRef;
  requestHash: string;
  responseHash: string;
  receiptId: string;
  outcome: "current" | "historical";
  proposals: { slot: number; ref: VersionRef; signature: string }[];
  findings: string[];
  response: ReconstructionSubmission;
}
export interface ReconstructionReview {
  version: 1;
  workUnit: VersionRef;
  request: VersionRef;
  result: VersionRef;
  proposal: VersionRef;
  signature: string;
  reason: string;
}
export const controlId = (u: VersionRef) => "reconstruction-control-" + u.id;
export const resultId = (q: VersionRef) => "reconstruction-result-" + q.id;
export const same = (
  a: VersionRef | null | undefined,
  b: VersionRef | null | undefined,
) => a?.id === b?.id && a?.version === b?.version;
export function explicitContext(
  q: Pick<ReconstructionRequest, "brand" | "evidence">,
): Record<string, Value> {
  const context: Record<string, Value> = {};
  // Keep the accepted PageState context vocabulary. Brand data is a frozen value
  // disclosure, never a live reference or an inferred style/default override.
  if (q.brand.enabled)
    context["commitments"] = [
      "Explicit approved Brand snapshot: " + canonical(q.brand.values),
    ];
  if (q.evidence.length)
    context["unresolved"] = q.evidence.map(
      (e) => "Explicit human handoff evidence: " + e.text,
    );
  return context;
}
export function parseSource(x: unknown): ReconstructionSource {
  const s = record(x, [
    "candidate",
    "integrity",
    "membership",
    "membershipIntegrity",
    "media",
    "mediaIntegrity",
    "image",
    "rights",
  ]);
  return {
    candidate: exactRef(s["candidate"]),
    integrity: hash(s["integrity"]),
    membership: exactRef(s["membership"]),
    membershipIntegrity: hash(s["membershipIntegrity"]),
    media: exactRef(s["media"]),
    mediaIntegrity: hash(s["mediaIntegrity"]),
    image: parseImageInfo(s["image"]),
    rights: string(s["rights"]),
  };
}
export function parseReconstructionRequest(x: unknown): ReconstructionRequest {
  const r = record(x, [
    "version",
    "project",
    "workUnit",
    "source",
    "instruction",
    "count",
    "slots",
    "viewports",
    "brand",
    "base",
    "locks",
    "resources",
    "evidence",
    "context",
    "grammar",
    "previousControl",
    "epoch",
    "heads",
    "limits",
  ]);
  if (r["version"] !== 1) throw new InputError("Reconstruction schema version");
  const count = integer(r["count"], 1, 6),
    slots = list(r["slots"], (n) => integer(n, 1, 6), 6);
  if (
    canonical(slots) !==
    canonical(Array.from({ length: count }, (_, i) => i + 1))
  )
    throw new InputError("Reconstruction slots/count mismatch");
  const viewports = list(
    r["viewports"],
    (v) => {
      const t = record(v, ["width", "height"]);
      return {
        width: integer(t["width"], 320, 4096),
        height: integer(t["height"], 200, 4096),
      };
    },
    3,
  );
  if (
    !viewports.length ||
    new Set(viewports.map((v) => v.width + ":" + v.height)).size !==
      viewports.length
  )
    throw new InputError("Choose unique requested viewports");
  const b = record(r["brand"], ["enabled", "source", "integrity", "values"]);
  let brand: ReconstructionRequest["brand"];
  if (b["enabled"] === false) {
    if (Object.keys(b).length !== 1)
      throw new InputError("Brand off has no inherited values");
    brand = { enabled: false };
  } else if (b["enabled"] === true) {
    const values = record(b["values"], Object.keys(Object(b["values"])));
    canonical(values);
    brand = {
      enabled: true,
      source: exactRef(b["source"]),
      integrity: hash(b["integrity"]),
      values: values as Record<string, Value>,
    };
  } else throw new InputError("Choose Brand explicitly");
  let base: ReconstructionRequest["base"] = null;
  if (r["base"] !== null) {
    const a = record(r["base"], ["ref", "signature", "page"]);
    base = {
      ref: exactRef(a["ref"]),
      signature: hash(a["signature"]),
      page: parsePage(a["page"]),
    };
  }
  const locks = parseLocks(r["locks"]);
  const resources = list(
    r["resources"],
    (v) => {
      const a = record(v, [
        "handle",
        "label",
        "role",
        "media",
        "integrity",
        "state",
      ]);
      const s = record(a["state"], ["image", "label", "role", "permission"]);
      return {
        handle: id(a["handle"]),
        label: string(a["label"], 200),
        role: choice(a["role"], ["reference", "placeable"]),
        media: exactRef(a["media"]),
        integrity: hash(a["integrity"]),
        state: {
          image: parseImageInfo(s["image"]),
          label: string(s["label"], 200),
          role: choice(s["role"], ["reference", "placeable"]),
          permission: string(s["permission"]),
        },
      };
    },
    32,
  );
  if (
    new Set(resources.map((v) => v.handle)).size !== resources.length ||
    new Set(resources.map((v) => v.media.id + ":" + v.media.version)).size !==
      resources.length
  )
    throw new InputError("Duplicate reconstruction resource");
  const evidence = list(
    r["evidence"],
    (v) => {
      const e = record(v, ["ref", "integrity", "text"]);
      return {
        ref: exactRef(e["ref"]),
        integrity: hash(e["integrity"]),
        text: string(e["text"]),
      };
    },
    16,
  );
  if (
    new Set(evidence.map((v) => v.ref.id + ":" + v.ref.version)).size !==
    evidence.length
  )
    throw new InputError("Duplicate explicit evidence");
  const context = record(r["context"], ["commitments", "unresolved"]) as Record<
    string,
    Value
  >;
  if (canonical(context) !== canonical(explicitContext({ brand, evidence })))
    throw new InputError("Reconstruction explicit context mismatch");
  if (
    canonical(r["grammar"]) !== canonical({ name: "bve.page", version: 1 }) ||
    canonical(r["limits"]) !==
      canonical({ maxReceipts: 1, maxCandidates: count, automaticRetry: false })
  )
    throw new InputError("Reconstruction grammar/intake bounds");
  const h = record(r["heads"], [
    "project",
    "workUnit",
    "source",
    "base",
    "brand",
  ]);
  const heads = {
    project: integer(h["project"], 1, 1000000),
    workUnit: integer(h["workUnit"], 1, 1000000),
    source: integer(h["source"], 1, 1000000),
    base: h["base"] === null ? null : integer(h["base"], 1, 1000000),
    brand: h["brand"] === null ? null : integer(h["brand"], 1, 1000000),
  };
  if (
    (base === null) !== (heads.base === null) ||
    !brand.enabled !== (heads.brand === null)
  )
    throw new InputError("Incomplete expected head binding");
  return {
    version: 1,
    project: exactRef(r["project"]),
    workUnit: exactRef(r["workUnit"]),
    source: parseSource(r["source"]),
    instruction: string(r["instruction"], 12000),
    count,
    slots,
    viewports,
    brand,
    base,
    locks,
    resources,
    evidence,
    context,
    grammar: { name: "bve.page", version: 1 },
    previousControl:
      r["previousControl"] === null ? null : exactRef(r["previousControl"]),
    epoch: integer(r["epoch"], 1, 1000000),
    heads,
    limits: { maxReceipts: 1, maxCandidates: count, automaticRetry: false },
  };
}
export function parseSubmission(x: unknown): ReconstructionSubmission {
  const r = record(x, [
    "schema",
    "version",
    "request",
    "requestHash",
    "project",
    "source",
    "baseSignature",
    "receiptId",
    "slots",
    "findings",
    "provenance",
  ]);
  if (
    r["schema"] !== "bve.reconstruction-result" ||
    r["version"] !== 1 ||
    canonical(r["provenance"]) !==
      canonical({ kind: "authored-test-fixture", generation: false })
  )
    throw new InputError(
      "V07 intake requires authored offline fixture provenance; no production transport",
    );
  const s = record(r["source"], ["candidate", "integrity"]);
  return {
    schema: "bve.reconstruction-result",
    version: 1,
    request: exactRef(r["request"]),
    requestHash: hash(r["requestHash"]),
    project: exactRef(r["project"]),
    source: {
      candidate: exactRef(s["candidate"]),
      integrity: hash(s["integrity"]),
    },
    baseSignature:
      r["baseSignature"] === null ? null : hash(r["baseSignature"]),
    receiptId: id(r["receiptId"]),
    slots: list(
      r["slots"],
      (v) => {
        const t = record(v, ["slot", "candidate"]);
        return { slot: integer(t["slot"], 1, 6), candidate: t["candidate"] };
      },
      6,
    ),
    findings: list(r["findings"], (v) => string(v), 100),
    provenance: { kind: "authored-test-fixture", generation: false },
  };
}
export function parseControl(x: unknown): ReconstructionControl {
  const r = record(x, [
    "version",
    "workUnit",
    "request",
    "requestHash",
    "status",
    "result",
    "reason",
  ]);
  if (r["version"] !== 1)
    throw new InputError("Reconstruction control version");
  const status = choice(r["status"], ["pending", "returned", "cancelled"]);
  const result = r["result"] === null ? null : exactRef(r["result"]);
  if ((status === "returned") !== (result !== null))
    throw new InputError("Control result/status mismatch");
  return {
    version: 1,
    workUnit: exactRef(r["workUnit"]),
    request: exactRef(r["request"]),
    requestHash: hash(r["requestHash"]),
    status,
    result,
    reason: string(r["reason"]),
  };
}
export function parseReconstructionResult(x: unknown): ReconstructionResult {
  const r = record(x, [
    "version",
    "workUnit",
    "request",
    "requestHash",
    "responseHash",
    "receiptId",
    "outcome",
    "proposals",
    "findings",
    "response",
  ]);
  if (r["version"] !== 1) throw new InputError("Result version");
  return {
    version: 1,
    workUnit: exactRef(r["workUnit"]),
    request: exactRef(r["request"]),
    requestHash: hash(r["requestHash"]),
    responseHash: hash(r["responseHash"]),
    receiptId: id(r["receiptId"]),
    outcome: choice(r["outcome"], ["current", "historical"]),
    proposals: list(
      r["proposals"],
      (v) => {
        const t = record(v, ["slot", "ref", "signature"]);
        return {
          slot: integer(t["slot"], 1, 6),
          ref: exactRef(t["ref"]),
          signature: hash(t["signature"]),
        };
      },
      6,
    ),
    findings: list(r["findings"], (v) => string(v), 300),
    response: parseSubmission(r["response"]),
  };
}
export function parseReview(x: unknown): ReconstructionReview {
  const r = record(x, [
    "version",
    "workUnit",
    "request",
    "result",
    "proposal",
    "signature",
    "reason",
  ]);
  if (r["version"] !== 1) throw new InputError("Review version");
  return {
    version: 1,
    workUnit: exactRef(r["workUnit"]),
    request: exactRef(r["request"]),
    result: exactRef(r["result"]),
    proposal: exactRef(r["proposal"]),
    signature: hash(r["signature"]),
    reason: string(r["reason"]),
  };
}
export function validateReconstructionRecord(p: Record<string, unknown>) {
  if (!Object.hasOwn(reconstructionRoles, String(p["kind"]))) return false;
  record(p, ["moduleId", "kind", "scope", "lockedValues", "state"]);
  if (
    p["scope"] !== "reconstruction" ||
    Object.keys(record(p["lockedValues"], [])).length
  )
    throw new InputError("Invalid reconstruction work-record scope");
  const parsers = {
    "reconstruction-request": parseReconstructionRequest,
    "reconstruction-control": parseControl,
    "reconstruction-result": parseReconstructionResult,
    "reconstruction-review": parseReview,
  };
  parsers[p["kind"] as ReconstructionKind](p["state"]);
  return true;
}
