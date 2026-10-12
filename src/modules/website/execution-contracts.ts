import type { VersionRef } from "../../kernel/contracts.ts";
import type { ImageInfo } from "../../service/assets.ts";
import type { SelectionEntry, Specification } from "./exploration-contracts.ts";
import { exactRef, hash, parseSelections } from "./exploration-contracts.ts";
import { parseImageInfo } from "./workspace-contracts.ts";
import {
  record,
  id,
  string,
  choice,
  list,
  integer,
  InputError,
  bool,
} from "../../service/validation.ts";
import { canonical } from "../../kernel/packets.ts";
export const executionRoles = {
  "raster-execution-request": "work-record",
  "raster-execution-grant": "work-record",
  "raster-execution": "work-record",
  "raster-execution-receipt": "work-record",
} as const;
export type ExecutionKind = keyof typeof executionRoles;
export interface AdapterIdentity {
  id: string;
  version: string;
  mode: "offline-test";
}
export interface ExecutionRequest {
  version: 1;
  compiler: "raster-execution-v1";
  spec: VersionRef;
  specHash: string;
  workUnit: VersionRef;
  width: number;
  height: number;
  count: number;
  operation: Specification["operation"];
  intent: string;
  direction: Specification["direction"];
  brand: Specification["brand"];
  facts: Specification["facts"];
  constraints: Specification["constraints"];
  requests: Specification["metricRequests"];
  sources: {
    entry: SelectionEntry | null;
    media: VersionRef;
    image: ImageInfo;
    rights: string;
    style: "included" | "excluded";
    content: "included" | "excluded";
  }[];
}
export interface Grant {
  version: 1;
  request: VersionRef;
  requestHash: string;
  spec: VersionRef;
  specHash: string;
  adapter: AdapterIdentity;
  slots: number[];
  maxSubmissions: number;
  maxStatusCalls: number;
  maxCancelCalls: number;
  timeoutMs: number;
  expiresAt: string;
  revoked: boolean;
  reason: string;
}
export type ExecutionStatus =
  | "pending"
  | "reserved"
  | "running"
  | "uncertain"
  | "succeeded"
  | "invalid"
  | "failed"
  | "cancelled";
export interface ExecutionSlot {
  slot: number;
  status: ExecutionStatus;
  submissionId: string | null;
  jobId: string | null;
  cancelRequested: boolean;
  cancelConfirmed: boolean;
  receipt: VersionRef | null;
}
export interface Call {
  sequence: number;
  kind: "submit" | "status" | "cancel";
  slot: number;
  submissionId: string;
  jobId: string | null;
}
export interface Execution {
  version: 1;
  request: VersionRef;
  requestHash: string;
  spec: VersionRef;
  specHash: string;
  workUnit: VersionRef;
  grant: VersionRef;
  adapter: AdapterIdentity;
  provenance: "offline-fixture";
  slots: ExecutionSlot[];
  calls: Call[];
  retryOf: { execution: VersionRef; slot: number } | null;
}
export interface ExecutionReceipt {
  version: 1;
  receiptId: string;
  execution: VersionRef;
  requestHash: string;
  specHash: string;
  slot: number;
  submissionId: string;
  jobId: string;
  payloadHash: string;
  outcome: "succeeded" | "invalid" | "failed" | "historical";
  candidate: VersionRef | null;
  media: VersionRef | null;
  image: ImageInfo | null;
  observed: Record<string, unknown>;
  message: string;
  provenance: "offline-fixture";
}
export function adapter(x: unknown): AdapterIdentity {
  const r = record(x, ["id", "version", "mode"]);
  return {
    id: id(r["id"]),
    version: string(r["version"], 80),
    mode: choice(r["mode"], ["offline-test"]),
  };
}
export function zeroBound(x: unknown, max: number): number {
  if (!Number.isSafeInteger(x) || Number(x) < 0 || Number(x) > max)
    throw new InputError("Invalid call allowance");
  return Number(x);
}
export function parseExecution(
  kind: ExecutionKind,
  x: unknown,
): ExecutionRequest | Grant | Execution | ExecutionReceipt {
  const v = record(x, Object.keys(x as object));
  if (v["version"] !== 1)
    throw new InputError("Unsupported execution record version");
  if (kind === "raster-execution-request") {
    const r = record(x, [
      "version",
      "compiler",
      "spec",
      "specHash",
      "workUnit",
      "width",
      "height",
      "count",
      "operation",
      "intent",
      "direction",
      "brand",
      "facts",
      "constraints",
      "requests",
      "sources",
    ]);
    const unit = exactRef(r["workUnit"]);
    const width = integer(r["width"], 8192),
      height = integer(r["height"], 8192);
    if (width * height > 16000000)
      throw new InputError("Execution exceeds pixel bound");
    const sources = list(r["sources"], (s) => {
      const q = record(s, [
        "entry",
        "media",
        "image",
        "rights",
        "style",
        "content",
      ]);
      const style = choice(q["style"], ["included", "excluded"]),
        content = choice(q["content"], ["included", "excluded"]);
      if (style === "excluded" && content === "excluded")
        throw new InputError("Excluded source cannot enter execution input");
      return {
        entry:
          q["entry"] === null
            ? null
            : parseSelections({
                version: 1,
                workUnit: unit,
                entries: [q["entry"]],
              }).entries[0]!,
        media: exactRef(q["media"]),
        image: parseImageInfo(q["image"]),
        rights: string(q["rights"]),
        style,
        content,
      };
    });
    // Frozen domain values are compared to the exact specification again at the kernel gate.
    canonical([r["brand"], r["facts"], r["constraints"], r["requests"]]);
    return {
      version: 1,
      compiler: choice(r["compiler"], ["raster-execution-v1"]),
      spec: exactRef(r["spec"]),
      specHash: hash(r["specHash"]),
      workUnit: unit,
      width,
      height,
      count: integer(r["count"], 6),
      operation: choice(r["operation"], [
        "create",
        "refine",
        "refresh",
        "branch",
      ]),
      intent: string(r["intent"]),
      direction: choice(r["direction"], ["fresh", "follow"]),
      brand: r["brand"] as ExecutionRequest["brand"],
      facts: r["facts"] as ExecutionRequest["facts"],
      constraints: r["constraints"] as ExecutionRequest["constraints"],
      requests: r["requests"] as ExecutionRequest["requests"],
      sources,
    };
  }
  if (kind === "raster-execution-grant") {
    const r = record(x, [
      "version",
      "request",
      "requestHash",
      "spec",
      "specHash",
      "adapter",
      "slots",
      "maxSubmissions",
      "maxStatusCalls",
      "maxCancelCalls",
      "timeoutMs",
      "expiresAt",
      "revoked",
      "reason",
    ]);
    const slots = list(r["slots"], (s) => integer(s, 6), 6);
    if (!slots.length || new Set(slots).size !== slots.length)
      throw new InputError("Grant slots must be unique");
    const expiresAt = string(r["expiresAt"], 40);
    if (
      !Number.isFinite(Date.parse(expiresAt)) ||
      new Date(expiresAt).toISOString() !== expiresAt
    )
      throw new InputError("Invalid grant expiry");
    return {
      version: 1,
      request: exactRef(r["request"]),
      requestHash: hash(r["requestHash"]),
      spec: exactRef(r["spec"]),
      specHash: hash(r["specHash"]),
      adapter: adapter(r["adapter"]),
      slots,
      maxSubmissions: integer(r["maxSubmissions"], 6),
      maxStatusCalls: zeroBound(r["maxStatusCalls"], 24),
      maxCancelCalls: zeroBound(r["maxCancelCalls"], 6),
      timeoutMs: integer(r["timeoutMs"], 30000),
      expiresAt,
      revoked: bool(r["revoked"]),
      reason: string(r["reason"]),
    };
  }
  if (kind === "raster-execution") {
    const r = record(x, [
      "version",
      "request",
      "requestHash",
      "spec",
      "specHash",
      "workUnit",
      "grant",
      "adapter",
      "provenance",
      "slots",
      "calls",
      "retryOf",
    ]);
    const slots = list(
      r["slots"],
      (s) => {
        const q = record(s, [
          "slot",
          "status",
          "submissionId",
          "jobId",
          "cancelRequested",
          "cancelConfirmed",
          "receipt",
        ]);
        return {
          slot: integer(q["slot"], 6),
          status: choice(q["status"], [
            "pending",
            "reserved",
            "running",
            "uncertain",
            "succeeded",
            "invalid",
            "failed",
            "cancelled",
          ]),
          submissionId:
            q["submissionId"] === null ? null : id(q["submissionId"]),
          jobId: q["jobId"] === null ? null : id(q["jobId"]),
          cancelRequested: bool(q["cancelRequested"]),
          cancelConfirmed: bool(q["cancelConfirmed"]),
          receipt: q["receipt"] === null ? null : exactRef(q["receipt"]),
        };
      },
      6,
    );
    if (
      !slots.length ||
      new Set(slots.map((s) => s.slot)).size !== slots.length
    )
      throw new InputError("Invalid execution slots");
    const calls = list(
      r["calls"],
      (s) => {
        const q = record(s, [
          "sequence",
          "kind",
          "slot",
          "submissionId",
          "jobId",
        ]);
        return {
          sequence: integer(q["sequence"], 36),
          kind: choice(q["kind"], ["submit", "status", "cancel"]),
          slot: integer(q["slot"], 6),
          submissionId: id(q["submissionId"]),
          jobId: q["jobId"] === null ? null : id(q["jobId"]),
        };
      },
      36,
    );
    if (calls.some((c, i) => c.sequence !== i + 1))
      throw new InputError("Non-contiguous accounting");
    let retryOf: Execution["retryOf"] = null;
    if (r["retryOf"] !== null) {
      const q = record(r["retryOf"], ["execution", "slot"]);
      retryOf = {
        execution: exactRef(q["execution"]),
        slot: integer(q["slot"], 6),
      };
    }
    return {
      version: 1,
      request: exactRef(r["request"]),
      requestHash: hash(r["requestHash"]),
      spec: exactRef(r["spec"]),
      specHash: hash(r["specHash"]),
      workUnit: exactRef(r["workUnit"]),
      grant: exactRef(r["grant"]),
      adapter: adapter(r["adapter"]),
      provenance: choice(r["provenance"], ["offline-fixture"]),
      slots,
      calls,
      retryOf,
    };
  }
  const r = record(x, [
    "version",
    "receiptId",
    "execution",
    "requestHash",
    "specHash",
    "slot",
    "submissionId",
    "jobId",
    "payloadHash",
    "outcome",
    "candidate",
    "media",
    "image",
    "observed",
    "message",
    "provenance",
  ]);
  const observed = record(r["observed"], Object.keys(r["observed"] as object));
  if (canonical(observed).length > 12000)
    throw new InputError("Observation too large");
  return {
    version: 1,
    receiptId: id(r["receiptId"]),
    execution: exactRef(r["execution"]),
    requestHash: hash(r["requestHash"]),
    specHash: hash(r["specHash"]),
    slot: integer(r["slot"], 6),
    submissionId: id(r["submissionId"]),
    jobId: id(r["jobId"]),
    payloadHash: hash(r["payloadHash"]),
    outcome: choice(r["outcome"], [
      "succeeded",
      "invalid",
      "failed",
      "historical",
    ]),
    candidate: r["candidate"] === null ? null : exactRef(r["candidate"]),
    media: r["media"] === null ? null : exactRef(r["media"]),
    image: r["image"] === null ? null : parseImageInfo(r["image"]),
    observed,
    message: string(r["message"]),
    provenance: choice(r["provenance"], ["offline-fixture"]),
  };
}
export function validateExecutionRecord(p: Record<string, unknown>): boolean {
  if (!Object.hasOwn(executionRoles, String(p["kind"]))) return false;
  record(p, ["moduleId", "kind", "scope", "lockedValues", "state"]);
  if (
    p["moduleId"] !== "website" ||
    p["scope"] !== "page-execution" ||
    Object.keys(record(p["lockedValues"], [])).length
  )
    throw new InputError("Invalid execution ownership");
  if (
    canonical(parseExecution(p["kind"] as ExecutionKind, p["state"])) !==
    canonical(p["state"])
  )
    throw new InputError("Noncanonical execution record");
  return true;
}
