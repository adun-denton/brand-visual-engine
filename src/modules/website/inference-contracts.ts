import type { VersionRef, Value } from "../../kernel/contracts.ts";
import type { PageState, MediaState, Lock } from "./page.ts";
import { parsePage, parseStyle, styleProperties } from "./page.ts";
import { canonical } from "../../kernel/packets.ts";
import {
  record,
  string,
  list,
  ref,
  id,
  choice,
  InputError,
} from "../../service/validation.ts";
export interface Resource {
  handle: string;
  media: VersionRef;
  state: MediaState;
}
export interface InferenceRequest {
  project: VersionRef;
  base: VersionRef | null;
  baseSignature: string | null;
  baseState: PageState | null;
  operation: "create" | "revise" | "critique";
  instruction: string;
  context: Record<string, Value>;
  locks: Lock[];
  resources: Resource[];
  status: "awaiting" | "applied" | "cancelled";
}
export interface InferenceResult {
  request: VersionRef;
  requestHash: string;
  responseHash: string;
  outcome: "applied" | "historical";
  proposals: VersionRef[];
  findings: string[];
  source: string;
  aiAuthorship: boolean;
  executor: {
    kind: "session-attested" | "local-observed" | "test-fixture";
    model: string | null;
    settings: Value | null;
    usage: Value | null;
  };
  response: Value;
}
export function parseLocks(input: unknown): Lock[] {
  return list(
    input,
    (v) => {
      const r = record(v, ["nodeId", "field", "value"]);
      canonical(r["value"]);
      return {
        nodeId: id(r["nodeId"]),
        field: choice(r["field"], ["text", "subtree", "style"]),
        value: r["value"] as Value,
      };
    },
    100,
  );
}
export function parseRequest(input: unknown): InferenceRequest {
  const r = record(input, [
    "project",
    "base",
    "baseSignature",
    "baseState",
    "operation",
    "instruction",
    "context",
    "locks",
    "resources",
    "status",
  ]);
  const base = r["base"] === null ? null : ref(r["base"]);
  if (
    (base === null) !== (r["baseState"] === null) ||
    (base === null) !== (r["baseSignature"] === null)
  )
    throw new InputError("Incomplete base snapshot");
  let baseState: PageState | null = null;
  if (base) {
    const s = record(r["baseState"], ["page", "context", "rationale", "locks"]);
    baseState = {
      page: parsePage(s["page"]),
      context: r["context"] as Record<string, Value>,
      rationale: string(s["rationale"]),
      locks: parseLocks(s["locks"]),
    };
    canonical(s["context"]);
    baseState.context = s["context"] as Record<string, Value>;
  }
  const resources = list(
    r["resources"],
    (v) => {
      const s = record(v, ["handle", "media", "state"]);
      const state = record(s["state"], [
        "image",
        "label",
        "role",
        "permission",
      ]);
      // Media state is independently gated and relationally matched before use.
      choice(state["role"], ["reference", "placeable"]);
      return {
        handle: id(s["handle"]),
        media: ref(s["media"]),
        state: state as unknown as MediaState,
      };
    },
    32,
  );
  if (new Set(resources.map((r) => r.handle)).size !== resources.length)
    throw new InputError("Duplicate resource handle");
  canonical(r["context"]);
  return {
    project: ref(r["project"]),
    base,
    baseState,
    baseSignature: base ? string(r["baseSignature"], 64) : null,
    operation: choice(r["operation"], ["create", "revise", "critique"]),
    instruction: string(r["instruction"], 12000),
    context: r["context"] as Record<string, Value>,
    locks: parseLocks(r["locks"]),
    resources,
    status: choice(r["status"], ["awaiting", "applied", "cancelled"]),
  };
}
export function validateInferenceRecord(p: Record<string, unknown>): boolean {
  if (p["kind"] === "inference-request") {
    parseRequest(p["state"]);
    return true;
  }
  if (p["kind"] === "inference-result") {
    const r = record(p["state"], [
      "request",
      "requestHash",
      "responseHash",
      "outcome",
      "proposals",
      "findings",
      "source",
      "aiAuthorship",
      "executor",
      "response",
    ]);
    ref(r["request"]);
    for (const k of ["requestHash", "responseHash"])
      if (!/^[a-f0-9]{64}$/.test(string(r[k], 64)))
        throw new InputError("Invalid exchange hash");
    choice(r["outcome"], ["applied", "historical"]);
    list(r["proposals"], ref, 6);
    list(r["findings"], (v) => string(v), 100);
    string(r["source"]);
    if (r["aiAuthorship"] !== true)
      throw new InputError("AI authorship attestation required");
    const e = record(r["executor"], ["kind", "model", "settings", "usage"]);
    choice(e["kind"], ["session-attested", "local-observed", "test-fixture"]);
    if (e["model"] !== null) string(e["model"]);
    canonical(e["settings"]);
    canonical(e["usage"]);
    canonical(r["response"]);
    return true;
  }
  if (p["kind"] === "page-migration" || p["kind"] === "page-media-origin") {
    const r = record(p["state"], [
      "source",
      "target",
      "sourceIntegrity",
      "losses",
    ]);
    ref(r["source"]);
    ref(r["target"]);
    string(r["sourceIntegrity"], 64);
    list(r["losses"], (v) => string(v), 100);
    return true;
  }
  if (p["kind"] === "page-import") {
    const r = record(p["state"], ["target", "sourceHash", "sourceEvidence"]);
    ref(r["target"]);
    if (!/^[a-f0-9]{64}$/.test(string(r["sourceHash"], 64)))
      throw new InputError("Invalid source package hash");
    canonical(r["sourceEvidence"]);
    return true;
  }
  return false;
}
const nodeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "kind"],
  properties: {
    id: { type: "string", pattern: "^[a-zA-Z0-9_-]+$" },
    kind: {
      enum: [
        "container",
        "section",
        "heading",
        "text",
        "link",
        "list",
        "media",
      ],
    },
    text: { type: "string" },
    level: { type: "integer", minimum: 1, maximum: 6 },
    href: { type: "string" },
    items: { type: "array", items: { type: "string" } },
    slot: { type: "string" },
    alt: { type: "string" },
    decorative: { type: "boolean" },
    style: { $ref: "#/$defs/style" },
    children: { type: "array", items: { $ref: "#/$defs/node" } },
  },
};
export const inferenceOutputSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: [
    "schema",
    "version",
    "requestId",
    "requestHash",
    "candidates",
    "findings",
  ],
  properties: {
    schema: { const: "bve.inference-result" },
    version: { const: 1 },
    requestId: { type: "string" },
    requestHash: { type: "string" },
    findings: { type: "array", items: { type: "string" } },
    candidates: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "label",
          "rationale",
          "page",
          "mediaRequirements",
          "proposedActions",
        ],
        properties: {
          label: { type: "string" },
          rationale: { type: "string" },
          page: { $ref: "#/$defs/page" },
          mediaRequirements: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["slot", "instruction"],
              properties: {
                slot: { type: "string" },
                instruction: { type: "string" },
              },
            },
          },
          proposedActions: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
  $defs: {
    style: {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(
        styleProperties.map((p) => [p, { type: ["string", "number"] }]),
      ),
    },
    node: nodeSchema,
    page: {
      type: "object",
      additionalProperties: false,
      required: [
        "version",
        "title",
        "language",
        "root",
        "media",
        "responsive",
        "unresolved",
      ],
      properties: {
        version: { const: 1 },
        title: { type: "string" },
        language: { type: "string" },
        root: { $ref: "#/$defs/node" },
        media: {
          type: "object",
          additionalProperties: { type: ["string", "null"] },
        },
        responsive: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["maxWidth", "nodeId", "style"],
            properties: {
              maxWidth: { type: "integer" },
              nodeId: { type: "string" },
              style: { $ref: "#/$defs/style" },
            },
          },
        },
        unresolved: { type: "array", items: { type: "string" } },
      },
    },
  },
};
// Used by schema documentation to keep the CSS property list and actual parser in sync.
export const validateInferenceStyle = parseStyle;
