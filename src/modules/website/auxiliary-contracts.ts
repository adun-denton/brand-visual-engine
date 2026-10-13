import { object } from "../../kernel/validation-primitives.ts";
import type { VersionRef, Value } from "../../kernel/contracts.ts";
import { canonical, digest } from "../../kernel/packets.ts";
import {
  record,
  string,
  id,
  list,
  integer,
  choice,
  InputError,
} from "../../service/validation.ts";
import { exactRef, hash } from "./exploration-contracts.ts";
import { requestFields } from "./visual-controls.ts";
export const auxiliaryRoles = {
  "auxiliary-scope": "work-record",
  "auxiliary-turn": "work-record",
  "auxiliary-proposal": "work-record",
  "auxiliary-action": "work-record",
  "auxiliary-bridge": "work-record",
} as const;
export type AuxiliaryKind = keyof typeof auxiliaryRoles;
export const auxiliaryTools = [
  "read_scope",
  "read_evidence",
  "propose_edit",
  "recommend_prepare",
] as const;
export const bridgeTools = [
  "read_scope",
  "read_evidence",
  "submit_reconstruction",
] as const;
export type Focus =
  | {
      kind: "visual-page";
      unit: VersionRef;
      raster: null | { ref: VersionRef; integrity: string };
      region: null | {
        selections: VersionRef;
        integrity: string;
        entryId: string;
      };
    }
  | {
      kind: "semantic-page";
      unit: VersionRef;
      page: VersionRef;
      integrity: string;
      signature: string;
      placement: null | {
        slot: string;
        media: VersionRef;
        integrity: string;
        bounds: { x: number; y: number; width: number; height: number };
      };
    }
  | {
      kind: "reconstruction";
      unit: VersionRef;
      request: VersionRef;
      integrity: string;
      result: null | { ref: VersionRef; integrity: string };
    };
export type DraftKind = "variation" | "reconstruction";
export interface DraftToken {
  id: string;
  revision: number;
  digest: string;
}
export interface DraftTarget {
  session: string;
  projectId: string;
  workUnit: VersionRef;
  kind: DraftKind;
  key: string;
}
export interface Scope {
  version: 1;
  session: string;
  workUnit: VersionRef;
  project: VersionRef;
  focus: Focus;
  brand: null | { ref: VersionRef; integrity: string };
  references: { ref: VersionRef; integrity: string; label: string }[];
  evidence: { ref: VersionRef; integrity: string }[];
  target: DraftTarget;
  draft: DraftToken;
  editable: string[];
  context: Record<string, unknown>;
  contextDigest: string;
  boundaryDigest: string;
  expiresAt: number;
  limits: {
    turns: number;
    tools: number;
    proposals: number;
    timeoutMs: number;
    automaticRetry: false;
  };
}
export interface Turn {
  version: 1;
  workUnit: VersionRef;
  scope: VersionRef;
  text: string;
  status:
    | "running"
    | "completed"
    | "historical"
    | "cancelled"
    | "expired"
    | "failed"
    | "interrupted";
  reply: string;
  detail: string;
  contextDigest: string;
  tools: {
    name: string;
    actionId: string;
    inputHash: string;
    resultHash: string;
  }[];
  proposals: VersionRef[];
  provenance: { kind: "authored-test-fixture"; generation: false };
}
export interface Proposal {
  version: 1;
  workUnit: VersionRef;
  scope: VersionRef;
  turn: VersionRef;
  contextDigest: string;
  target: DraftTarget;
  draft: DraftToken;
  edits: { field: string; before: Value | null; after: Value }[];
  rationale: string;
  historical: boolean;
  provenance: { kind: "authored-test-fixture"; generation: false };
}
export interface Action {
  version: 1;
  workUnit: VersionRef;
  proposal: VersionRef;
  session: string;
  actionId: string;
  inputHash: string;
  decision: "applied" | "dismissed" | "conflict";
  expected: DraftToken;
  result: DraftToken | null;
  detail: string;
}
export interface Bridge {
  version: 1;
  workUnit: VersionRef;
  request: VersionRef;
  requestHash: string;
  contextDigest: string;
  status:
    | "running"
    | "completed"
    | "historical"
    | "cancelled"
    | "expired"
    | "failed"
    | "interrupted";
  result: VersionRef | null;
  detail: string;
  tools: Turn["tools"];
  provenance: Turn["provenance"];
}
export function parseToken(x: unknown): DraftToken {
  const r = record(x, ["id", "revision", "digest"]);
  return {
    id: id(r["id"]),
    revision: integer(r["revision"], 1000000),
    digest: hash(r["digest"]),
  };
}
export function parseTarget(x: unknown): DraftTarget {
  const r = record(x, ["session", "projectId", "workUnit", "kind", "key"]);
  return {
    session: id(r["session"]),
    projectId: id(r["projectId"]),
    workUnit: exactRef(r["workUnit"]),
    kind: choice(r["kind"], ["variation", "reconstruction"]),
    key: string(r["key"], 200),
  };
}
function pointer(x: unknown) {
  const r = record(x, ["ref", "integrity"]);
  return { ref: exactRef(r["ref"]), integrity: hash(r["integrity"]) };
}
export function parseFocus(x: unknown): Focus {
  const v = record(x, [
    "kind",
    "unit",
    "raster",
    "region",
    "page",
    "integrity",
    "signature",
    "placement",
    "request",
    "result",
  ]);
  const kind = choice(v["kind"], [
    "visual-page",
    "semantic-page",
    "reconstruction",
  ]);
  if (kind === "visual-page") {
    const r = record(x, ["kind", "unit", "raster", "region"]);
    const region =
      r["region"] === null
        ? null
        : record(r["region"], ["selections", "integrity", "entryId"]);
    return {
      kind,
      unit: exactRef(r["unit"]),
      raster: r["raster"] === null ? null : pointer(r["raster"]),
      region: region
        ? {
            selections: exactRef(region["selections"]),
            integrity: hash(region["integrity"]),
            entryId: id(region["entryId"]),
          }
        : null,
    };
  }
  if (kind === "semantic-page") {
    const r = record(x, [
      "kind",
      "unit",
      "page",
      "integrity",
      "signature",
      "placement",
    ]);
    const p =
      r["placement"] === null
        ? null
        : record(r["placement"], ["slot", "media", "integrity", "bounds"]);
    let placement: Extract<Focus, { kind: "semantic-page" }>["placement"] =
      null;
    if (p) {
      const b = record(p["bounds"], ["x", "y", "width", "height"]);
      const bounds = {
        x: Number(b["x"]),
        y: Number(b["y"]),
        width: Number(b["width"]),
        height: Number(b["height"]),
      };
      if (
        Object.values(bounds).some((n) => !Number.isFinite(n)) ||
        bounds.x < 0 ||
        bounds.y < 0 ||
        bounds.width <= 0 ||
        bounds.height <= 0 ||
        bounds.x + bounds.width > 1 ||
        bounds.y + bounds.height > 1
      )
        throw new InputError("Invalid scoped placement geometry");
      placement = {
        slot: string(p["slot"], 160),
        media: exactRef(p["media"]),
        integrity: hash(p["integrity"]),
        bounds,
      };
    }
    return {
      kind,
      unit: exactRef(r["unit"]),
      page: exactRef(r["page"]),
      integrity: hash(r["integrity"]),
      signature: hash(r["signature"]),
      placement,
    };
  }
  const r = record(x, ["kind", "unit", "request", "integrity", "result"]);
  return {
    kind,
    unit: exactRef(r["unit"]),
    request: exactRef(r["request"]),
    integrity: hash(r["integrity"]),
    result: r["result"] === null ? null : pointer(r["result"]),
  };
}
export function fieldValue(
  kind: DraftKind,
  field: string,
  x: unknown,
  unset = false,
): Value | null {
  const allowed =
    kind === "reconstruction"
      ? ["instruction", "count", "viewports"].includes(field)
      : field === "intent" ||
        requestFields.some(
          (c) => "level" + c.level + ":" + c.key === field && !c.unavailable,
        );
  if (!allowed)
    throw new InputError("Unsupported auxiliary draft field: " + field);
  if (x === null && unset) return null;
  if (kind === "reconstruction") {
    if (field === "instruction")
      return typeof x === "string" && x.length <= 12000
        ? x
        : (() => {
            throw new InputError("Invalid instruction");
          })();
    if (field === "count") {
      const n = integer(x, 6);
      return n;
    }
    if (field === "viewports") {
      const values = list(
        x,
        (v) => {
          const r = record(v, ["width", "height"]),
            width = integer(r["width"], 4096),
            height = integer(r["height"], 4096);
          if (width < 320 || height < 200)
            throw new InputError("Invalid viewport");
          return { width, height };
        },
        3,
      );
      if (
        !values.length ||
        new Set(values.map((v) => canonical(v))).size !== values.length
      )
        throw new InputError("Viewport set missing/duplicated");
      return values as Value;
    }
  } else {
    if (field === "intent") {
      if (typeof x !== "string" || x.length > 12000)
        throw new InputError("Invalid intent");
      return x;
    }
    const [prefix, key, ...extra] = field.split(":");
    const c = requestFields.find(
      (c) => c.key === key && "level" + c.level === prefix && !c.unavailable,
    );
    if (c && !extra.length) {
      if (["scale", "count", "px"].includes(c.type)) {
        if (
          typeof x !== "number" ||
          !Number.isFinite(x) ||
          (c.type === "scale" && (x < 1 || x > 10)) ||
          (c.type !== "scale" &&
            (!Number.isSafeInteger(x) || x < 1 || x > 4096))
        )
          throw new InputError("Invalid requested tuning value");
        return x;
      }
      const s = string(x, 200);
      if (
        (c.type === "category" && !c.options?.includes(s)) ||
        (c.type === "color" && !/^#[a-f0-9]{6}$/i.test(s))
      )
        throw new InputError("Invalid requested tuning value");
      return s;
    }
  }
  throw new InputError("Unsupported auxiliary draft field: " + field);
}
export function draftValues(
  kind: DraftKind,
  x: unknown,
): Record<string, Value | null> {
  const r = object(x);
  if (Object.keys(r).length > 30) throw new InputError("Draft field bound");
  const out = Object.fromEntries(
    Object.entries(r).map(([k, v]) => [k, fieldValue(kind, k, v, true)]),
  );
  for (const key of kind === "variation"
    ? ["intent"]
    : ["instruction", "count", "viewports"])
    if (!Object.hasOwn(out, key))
      throw new InputError("Draft required field absent");
  return out;
}
export const targetKey = (t: DraftTarget) => canonical(t);
export const draftDigest = (
  target: DraftTarget,
  values: Record<string, Value | null>,
) => digest({ target, values });
export function parseScope(x: unknown): Scope {
  const r = record(x, [
    "version",
    "session",
    "workUnit",
    "project",
    "focus",
    "brand",
    "references",
    "evidence",
    "target",
    "draft",
    "editable",
    "context",
    "contextDigest",
    "boundaryDigest",
    "expiresAt",
    "limits",
  ]);
  if (r["version"] !== 1) throw new InputError("Unsupported auxiliary scope");
  const focus = parseFocus(r["focus"]),
    target = parseTarget(r["target"]);
  const editable = list(r["editable"], (v) => string(v, 100), 30);
  if (new Set(editable).size !== editable.length)
    throw new InputError("Duplicate editable field");
  for (const f of editable) fieldValue(target.kind, f, null, true);
  const references = list(
      r["references"],
      (v) => {
        const p = record(v, ["ref", "integrity", "label"]);
        return {
          ...pointer({ ref: p["ref"], integrity: p["integrity"] }),
          label: string(p["label"], 200),
        };
      },
      8,
    ),
    evidence = list(r["evidence"], pointer, 8);
  const limits = record(r["limits"], [
    "turns",
    "tools",
    "proposals",
    "timeoutMs",
    "automaticRetry",
  ]);
  const timeoutMs = integer(limits["timeoutMs"], 60000);
  if (timeoutMs < 50 || limits["automaticRetry"] !== false)
    throw new InputError("Invalid auxiliary lifecycle bound");
  if (
    typeof r["expiresAt"] !== "number" ||
    !Number.isSafeInteger(r["expiresAt"])
  )
    throw new InputError("Invalid auxiliary expiry");
  const context = object(r["context"]);
  if (Buffer.byteLength(canonical(context)) > 262144)
    throw new InputError("Auxiliary context bound");
  return {
    version: 1,
    session: id(r["session"]),
    workUnit: exactRef(r["workUnit"]),
    project: exactRef(r["project"]),
    focus,
    brand: r["brand"] === null ? null : pointer(r["brand"]),
    references,
    evidence,
    target,
    draft: parseToken(r["draft"]),
    editable,
    context,
    contextDigest: hash(r["contextDigest"]),
    boundaryDigest: hash(r["boundaryDigest"]),
    expiresAt: r["expiresAt"],
    limits: {
      turns: integer(limits["turns"], 6),
      tools: integer(limits["tools"], 8),
      proposals: integer(limits["proposals"], 4),
      timeoutMs,
      automaticRetry: false,
    },
  };
}
export const provenance = (x: unknown) => {
  const r = record(x, ["kind", "generation"]);
  if (r["kind"] !== "authored-test-fixture" || r["generation"] !== false)
    throw new InputError("Authored fixture provenance required");
  return { kind: "authored-test-fixture" as const, generation: false as const };
};
export function parseProposal(x: unknown): Proposal {
  const r = record(x, [
    "version",
    "workUnit",
    "scope",
    "turn",
    "contextDigest",
    "target",
    "draft",
    "edits",
    "rationale",
    "historical",
    "provenance",
  ]);
  const target = parseTarget(r["target"]);
  if (r["version"] !== 1 || typeof r["historical"] !== "boolean")
    throw new InputError("Proposal version/outcome");
  const edits = list(
    r["edits"],
    (v) => {
      const e = record(v, ["field", "before", "after"]);
      const field = string(e["field"], 100);
      return {
        field,
        before: fieldValue(target.kind, field, e["before"], true),
        after: fieldValue(target.kind, field, e["after"])!,
      };
    },
    16,
  );
  if (!edits.length || new Set(edits.map((e) => e.field)).size !== edits.length)
    throw new InputError("Invalid proposal edit set");
  return {
    version: 1,
    workUnit: exactRef(r["workUnit"]),
    scope: exactRef(r["scope"]),
    turn: exactRef(r["turn"]),
    contextDigest: hash(r["contextDigest"]),
    target,
    draft: parseToken(r["draft"]),
    edits,
    rationale: string(r["rationale"], 4000),
    historical: r["historical"],
    provenance: provenance(r["provenance"]),
  };
}
export function parseTools(x: unknown) {
  return list(
    x,
    (v) => {
      const r = record(v, ["name", "actionId", "inputHash", "resultHash"]);
      return {
        name: string(r["name"], 80),
        actionId: id(r["actionId"]),
        inputHash: hash(r["inputHash"]),
        resultHash: hash(r["resultHash"]),
      };
    },
    8,
  );
}
export function parseTurn(x: unknown): Turn {
  const r = record(x, [
    "version",
    "workUnit",
    "scope",
    "text",
    "status",
    "reply",
    "detail",
    "contextDigest",
    "tools",
    "proposals",
    "provenance",
  ]);
  if (r["version"] !== 1) throw new InputError("Turn version");
  if (typeof r["reply"] !== "string" || r["reply"].length > 16000)
    throw new InputError("Reply bound");
  return {
    version: 1,
    workUnit: exactRef(r["workUnit"]),
    scope: exactRef(r["scope"]),
    text: string(r["text"], 8000),
    status: choice(r["status"], [
      "running",
      "completed",
      "historical",
      "cancelled",
      "expired",
      "failed",
      "interrupted",
    ]),
    reply: r["reply"],
    detail: string(r["detail"], 2000),
    contextDigest: hash(r["contextDigest"]),
    tools: parseTools(r["tools"]),
    proposals: list(r["proposals"], exactRef, 4),
    provenance: provenance(r["provenance"]),
  };
}
export function parseAction(x: unknown): Action {
  const r = record(x, [
    "version",
    "workUnit",
    "proposal",
    "session",
    "actionId",
    "inputHash",
    "decision",
    "expected",
    "result",
    "detail",
  ]);
  if (r["version"] !== 1) throw new InputError("Action version");
  return {
    version: 1,
    workUnit: exactRef(r["workUnit"]),
    proposal: exactRef(r["proposal"]),
    session: id(r["session"]),
    actionId: id(r["actionId"]),
    inputHash: hash(r["inputHash"]),
    decision: choice(r["decision"], ["applied", "dismissed", "conflict"]),
    expected: parseToken(r["expected"]),
    result: r["result"] === null ? null : parseToken(r["result"]),
    detail: string(r["detail"], 2000),
  };
}
export function parseBridge(x: unknown): Bridge {
  const r = record(x, [
    "version",
    "workUnit",
    "request",
    "requestHash",
    "contextDigest",
    "status",
    "result",
    "detail",
    "tools",
    "provenance",
  ]);
  if (r["version"] !== 1) throw new InputError("Bridge version");
  return {
    version: 1,
    workUnit: exactRef(r["workUnit"]),
    request: exactRef(r["request"]),
    requestHash: hash(r["requestHash"]),
    contextDigest: hash(r["contextDigest"]),
    status: choice(r["status"], [
      "running",
      "completed",
      "historical",
      "cancelled",
      "expired",
      "failed",
      "interrupted",
    ]),
    result: r["result"] === null ? null : exactRef(r["result"]),
    detail: string(r["detail"], 2000),
    tools: parseTools(r["tools"]),
    provenance: provenance(r["provenance"]),
  };
}
export function parseAuxiliary(kind: string, x: unknown) {
  if (kind === "auxiliary-scope") return parseScope(x);
  if (kind === "auxiliary-turn") return parseTurn(x);
  if (kind === "auxiliary-proposal") return parseProposal(x);
  if (kind === "auxiliary-action") return parseAction(x);
  if (kind === "auxiliary-bridge") return parseBridge(x);
  throw new InputError("Unknown auxiliary evidence kind");
}
