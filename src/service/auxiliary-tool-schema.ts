import { reconstructionOutputSchema } from "../modules/website/reconstruction-schemas.ts";
const object = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: "object", additionalProperties: false, properties, required });
const ref = object({
  id: { type: "string", pattern: "^[A-Za-z0-9_-]+$" },
  version: { type: "integer", minimum: 1 },
  freshness: { const: "pinned" },
});
const hash = { type: "string", pattern: "^[a-f0-9]{64}$" };
export const auxiliaryToolSchemas = {
  read_scope: object({}),
  read_evidence: object({ ref, integrity: hash }),
  propose_edit: object({
    edits: {
      type: "array",
      minItems: 1,
      maxItems: 16,
      items: object({ field: { type: "string", maxLength: 100 }, after: {} }),
    },
    rationale: { type: "string", minLength: 1, maxLength: 4000 },
  }),
  recommend_prepare: object({
    text: { type: "string", minLength: 1, maxLength: 2000 },
  }),
};
export const bridgeToolSchemas = {
  read_scope: auxiliaryToolSchemas.read_scope,
  read_evidence: auxiliaryToolSchemas.read_evidence,
  submit_reconstruction: object({ response: reconstructionOutputSchema }),
};
