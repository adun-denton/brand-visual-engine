/** Additive exchange schemas. Semantic candidate grammar remains the existing schema. */
import { inferenceOutputSchema } from "./inference-contracts.ts";
const pointer = {
  type: "object",
  additionalProperties: false,
  required: ["id", "version", "freshness"],
  properties: {
    id: { type: "string", pattern: "^[A-Za-z0-9_-]+$", maxLength: 160 },
    version: { type: "integer", minimum: 1 },
    freshness: { const: "pinned" },
  },
};
const digest = { type: "string", pattern: "^[a-f0-9]{64}$" };
const text = (max: number) => ({
  type: "string",
  minLength: 1,
  maxLength: max,
  pattern: "\\S",
});
const nullable = (schema: object) => ({ anyOf: [{ type: "null" }, schema] });
const viewport = {
  type: "object",
  additionalProperties: false,
  required: ["width", "height"],
  properties: {
    width: { type: "integer", minimum: 320, maximum: 4096 },
    height: { type: "integer", minimum: 200, maximum: 4096 },
  },
};
export const reconstructionPreparationSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: [
    "expectedProject",
    "workUnit",
    "source",
    "integrity",
    "expectedControl",
    "instruction",
    "count",
    "viewports",
    "brand",
    "base",
    "baseSignature",
    "resources",
    "evidence",
  ],
  properties: {
    expectedProject: pointer,
    workUnit: pointer,
    source: pointer,
    integrity: digest,
    expectedControl: nullable(pointer),
    instruction: text(12000),
    count: { type: "integer", minimum: 1, maximum: 6 },
    viewports: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      uniqueItems: true,
      items: viewport,
    },
    brand: nullable(pointer),
    base: nullable(pointer),
    baseSignature: nullable(digest),
    locks: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["nodeId", "field", "value"],
        properties: {
          nodeId: { type: "string", pattern: "^[A-Za-z0-9_-]+$" },
          field: { enum: ["text", "subtree", "style"] },
          value: {},
        },
      },
    },
    resources: {
      type: "array",
      maxItems: 32,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["media", "label", "role"],
        properties: {
          media: pointer,
          label: text(200),
          role: { enum: ["reference", "placeable"] },
        },
      },
    },
    evidence: {
      type: "array",
      maxItems: 16,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ref", "integrity"],
        properties: { ref: pointer, integrity: digest },
      },
    },
  },
};
export const reconstructionOutputSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: [
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
  ],
  properties: {
    schema: { const: "bve.reconstruction-result" },
    version: { const: 1 },
    request: pointer,
    requestHash: digest,
    project: pointer,
    source: {
      type: "object",
      additionalProperties: false,
      required: ["candidate", "integrity"],
      properties: { candidate: pointer, integrity: digest },
    },
    baseSignature: nullable(digest),
    receiptId: { type: "string", pattern: "^[A-Za-z0-9_-]+$", maxLength: 160 },
    slots: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["slot", "candidate"],
        properties: {
          slot: { type: "integer", minimum: 1, maximum: 6 },
          candidate: inferenceOutputSchema.properties.candidates.items,
        },
      },
    },
    findings: { type: "array", maxItems: 100, items: text(4000) },
    provenance: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "generation"],
      properties: {
        kind: { const: "authored-test-fixture" },
        generation: { const: false },
      },
    },
  },
  $defs: inferenceOutputSchema.$defs,
};
