import { pageLimits as limits, pageKinds, kindFields, pageTextSchema as textSchema, localIdentitySchema, localIdentityPattern, languagePattern, hrefPattern, trimmedPattern } from "./page-contracts.ts";
import { styleObjectSchema, styleValueDefinitions } from "./style-contracts.ts";
import type { VersionRef, Value } from "../../kernel/contracts.ts";
import type { PageState, MediaState, Lock } from "./page.ts";
import { parsePage, parseStyle } from "./page.ts";
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
    id: localIdentitySchema,
    kind: { enum: pageKinds },
    text: textSchema(limits.text),
    level: { type: "integer", minimum: 1, maximum: 6 },
    href: { ...textSchema(limits.href), pattern: trimmedPattern(hrefPattern) },
    items: { type: "array", maxItems: limits.entries, items: textSchema(limits.item) },
    slot: localIdentitySchema,
    alt: textSchema(limits.alt, true),
    decorative: { type: "boolean" },
    style: { $ref: "#/$defs/style" },
    children: { type: "array", maxItems: limits.entries, items: { $ref: "#/$defs/node" } },
  },
  allOf: [
    ...kindFields.map(({ kinds, fields }) => ({
      if: { properties: { kind: { enum: kinds } }, required: ["kind"] },
      then: { required: fields, properties: Object.fromEntries(fields.map(field => [field, {}])) },
      else: { not: { anyOf: fields.map(field => ({ required: [field], properties: { [field]: {} } })) } },
    })),
    {
      if: { properties: { decorative: { const: true } }, required: ["decorative"] },
      then: { properties: { alt: { type: "string", pattern: "^\\s*$" } } },
    },
  ],
};
export const inferenceOutputSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["schema", "version", "requestId", "requestHash", "candidates", "findings"],
  properties: {
    schema: { const: "bve.inference-result" },
    version: { const: 1 },
    requestId: localIdentitySchema,
    requestHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
    findings: { type: "array", maxItems: limits.entries, items: textSchema(limits.prose) },
    candidates: {
      type: "array", maxItems: limits.candidates,
      items: {
        type: "object", additionalProperties: false,
        required: ["label", "rationale", "page", "mediaRequirements", "proposedActions"],
        properties: {
          label: textSchema(limits.title),
          rationale: textSchema(limits.prose),
          page: { $ref: "#/$defs/page" },
          mediaRequirements: {
            type: "array", maxItems: limits.entries,
            items: {
              type: "object", additionalProperties: false, required: ["slot", "instruction"],
              properties: { slot: textSchema(limits.identity), instruction: textSchema(limits.prose) },
            },
          },
          proposedActions: { type: "array", maxItems: limits.actions, items: textSchema(limits.prose) },
        },
      },
    },
  },
  $defs: {
    ...styleValueDefinitions,
    style: styleObjectSchema,
    node: nodeSchema,
    page: {
      type: "object", additionalProperties: false,
      required: ["version", "title", "language", "root", "media", "responsive", "unresolved"],
      properties: {
        version: { const: 1 },
        title: textSchema(limits.title),
        language: { ...textSchema(limits.language), pattern: trimmedPattern(languagePattern) },
        root: { $ref: "#/$defs/node", properties: { kind: { enum: ["container", "section"] } }, type: "object" },
        media: {
          type: "object",
          propertyNames: { type: "string", maxLength: limits.identity, pattern: localIdentityPattern },
          additionalProperties: { anyOf: [ { type: "null" }, textSchema(limits.handle) ] },
        },
        responsive: {
          type: "array", maxItems: limits.entries,
          items: {
            type: "object", additionalProperties: false, required: ["maxWidth", "nodeId", "style"],
            properties: {
              maxWidth: { type: "integer", minimum: limits.viewportMin, maximum: limits.viewportMax },
              nodeId: localIdentitySchema,
              style: { $ref: "#/$defs/style" },
            },
          },
        },
        unresolved: { type: "array", maxItems: limits.entries, items: textSchema(limits.alt) },
      },
    },
  },
};
// Used by schema documentation to keep the CSS property list and actual parser in sync.
export const validateInferenceStyle = parseStyle;
