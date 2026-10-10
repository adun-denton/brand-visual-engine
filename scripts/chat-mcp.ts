// Owned stdio MCP bridge: a single frozen BVE turn, no filesystem/shell tools.
import { chatMcpSchema } from "../src/service/chat-tool-schema.ts";
import { createInterface } from "node:readline";
import { chatTools, toolDescriptions } from "../src/service/chat-contracts.ts";
const origin = process.env["BVE_CHAT_ORIGIN"],
  grant = process.env["BVE_CHAT_GRANT"];
if (!origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin) || !grant)
  throw new Error("Owned loopback binding required");
const send = (v: unknown) => process.stdout.write(JSON.stringify(v) + "\n");
const toolSchema = {
  type: "object",
  properties: {
    actionId: { type: "string" },
    input: { type: "object", additionalProperties: true },
  },
  required: ["actionId", "input"],
  additionalProperties: false,
};
createInterface({ input: process.stdin }).on("line", (line) => {
  void (async () => {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message["id"] === undefined) return;
    const id = message["id"];
    try {
      let result: unknown;
      switch (message["method"]) {
        case "initialize":
          result = {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "bve-scoped-actions", version: "1.0.0" },
          };
          break;
        case "ping":
          result = {};
          break;
        case "tools/list":
          result = {
            tools: chatTools.map((name) => ({
              name,
              description: toolDescriptions[name],
              inputSchema: chatMcpSchema(name),
            })),
          };
          break;
        case "tools/call": {
          const params = message["params"] as {
            name: string;
            arguments: unknown;
          };
          if (!chatTools.includes(params.name as (typeof chatTools)[number]))
            throw Error("Unsupported tool");
          const r = await fetch(origin + "/api/v1/chat/tool", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-BVE-Chat-Grant": grant,
              Origin: origin,
            },
            body: JSON.stringify({
              name: params.name,
              ...(params.arguments as object),
            }),
            signal: AbortSignal.timeout(30000),
          });
          const body = await r.json();
          result = {
            content: [{ type: "text", text: JSON.stringify(body) }],
            isError: !r.ok,
          };
          break;
        }
        default:
          throw Error("Only the declared tools are available");
      }
      send({ jsonrpc: "2.0", id, result });
    } catch {
      send({
        jsonrpc: "2.0",
        id,
        error: { code: -32600, message: "Scoped tool request rejected" },
      });
    }
  })();
});
