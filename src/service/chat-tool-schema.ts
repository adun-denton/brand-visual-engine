import { inferenceOutputSchema } from "../modules/website/inference-contracts.ts";
import type { ChatTool } from "./chat-contracts.ts";
const text = { type: "string" },
  texts = { type: "array", items: text },
  pointer = {
    type: "object",
    properties: {
      id: text,
      version: { type: "integer" },
      freshness: { type: "string", enum: ["pinned"] },
    },
    required: ["id", "version", "freshness"],
    additionalProperties: false,
  };
const object = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
export const chatToolInputSchemas: Record<ChatTool, unknown> = {
  read_context: object({}, []),
  update_draft: object(
    {
      brief: object(
        {
          title: text,
          intent: text,
          audience: text,
          offer: text,
          response: text,
          content: texts,
          exclusions: texts,
          commitments: texts,
          unresolved: texts,
          palette: { anyOf: [{ type: "null" }, texts] },
        },
        [],
      ),
      assumptions: texts,
    },
    ["brief"],
  ),
  prepare_design: object(
    {
      operation: { type: "string", enum: ["create", "revise", "critique"] },
      instruction: text,
      locks: {
        type: "array",
        items: object(
          {
            nodeId: text,
            field: { type: "string", enum: ["text", "subtree", "style"] },
            value: {},
          },
          ["nodeId", "field", "value"],
        ),
      },
    },
    ["operation", "instruction"],
  ),
  submit_candidates: object(
    { request: pointer, response: inferenceOutputSchema },
    ["request", "response"],
  ),
  focus_candidate: object({ candidate: pointer }, ["candidate"]),
  prepare_image: object(
    {
      instruction: text,
      preset: {
        type: "string",
        enum: ["strict-region", "preserve-form-change-finish", "explore"],
      },
    },
    ["instruction", "preset"],
  ),
};
export const chatMcpSchema = (name: ChatTool) =>
  object(
    {
      actionId: {
        type: "string",
        description:
          "Unique action identity within this frozen turn. Repeat the same ID only to inspect the same prior receipt.",
      },
      input: chatToolInputSchemas[name],
    },
    ["actionId", "input"],
  );
