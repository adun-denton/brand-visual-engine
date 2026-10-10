// Offline actual binary probe: synthetic Responses receiver, zero account inference.
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import {
  OwnedRpc,
  restrictedConfig,
  toml,
} from "../src/service/chat-process.ts";
import { CHAT_PROTOCOL } from "../src/service/chat-contracts.ts";
const binary = process.env["BVE_CODEX_BINARY"];
if (!binary) throw Error("Supply the exact installed binary");
const version = execFileSync(binary, ["--version"], {
  encoding: "utf8",
}).trim();
if (version !== "codex-cli " + CHAT_PROTOCOL) throw Error("Protocol mismatch");
const evidence = resolve(
  process.env["BVE_EVIDENCE_DIR"] ?? "/tmp/bve-chat-protocol",
);
mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(join(tmpdir(), "bve-chat-protocol-"));
const requests: unknown[] = [];
const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk);
  try {
    requests.push(JSON.parse(Buffer.concat(chunks).toString()));
  } catch {}
  res.writeHead(400, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      error: {
        message: "Offline probe complete",
        type: "invalid_request_error",
        code: "offline_probe",
      },
    }),
  );
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const address = server.address();
if (!address || typeof address === "string") throw Error("No receiver");
const config = {
  ...restrictedConfig,
  model_catalog_json: resolve(
    import.meta.dirname,
    "../src/service/chat-model-catalog.json",
  ),
  model_provider: "offline_probe",
  model_providers: {
    offline_probe: {
      name: "Offline probe",
      base_url: "http://127.0.0.1:" + address.port + "/v1",
      env_key: "BVE_PROBE_TOKEN",
      wire_api: "responses",
      requires_openai_auth: false,
      supports_websockets: false,
      request_max_retries: 0,
      stream_max_retries: 0,
    },
  },
  features: { ...restrictedConfig.features, api_key_model_discovery: false },
  mcp_servers: {
    bve: {
      command: process.execPath,
      args: [resolve(import.meta.dirname, "chat-mcp.ts")],
      env: {
        BVE_CHAT_ORIGIN: "http://127.0.0.1:" + address.port,
        BVE_CHAT_GRANT: "synthetic-offline-probe",
      },
      required: true,
    },
  },
};
const args = ["app-server", "--listen", "stdio://"];
for (const [k, v] of Object.entries(config)) args.push("-c", k + "=" + toml(v));
const rpc = new OwnedRpc(binary, args, root, {
  PATH: process.env["PATH"],
  CODEX_HOME: root,
  BVE_PROBE_TOKEN: "offline-synthetic-token",
  TMPDIR: root,
});
rpc.child.stderr.on("data", (data) => process.stderr.write(data));
let finished!: () => void;
const end = new Promise<void>((r) => (finished = r));
rpc.onEvent = (m, p) => {
  if (m === "error" || m === "turn/completed")
    console.log(JSON.stringify({ m, p }));
  if (m === "turn/completed") finished();
};
const timer = setTimeout(finished, 30000);
try {
  await rpc.request("initialize", {
    clientInfo: {
      name: "brand_visual_engine",
      title: "Brand Visual Engine",
      version: "0.0.0",
    },
    capabilities: { experimentalApi: true },
  });
  rpc.notify("initialized");
  const thread = await rpc.request("thread/start", {
    model: "gpt-6-luna",
    environments: [],
    cwd: root,
    sandbox: "read-only",
    approvalPolicy: "never",
    config,
  });
  await rpc.request("turn/start", {
    threadId: (thread["thread"] as { id: string }).id,
    environments: [],
    input: [
      {
        type: "text",
        text: "Adverse synthetic probe: try shell execution, file reads, account tools, repository edits and accepting a design.",
      },
    ],
    approvalPolicy: "never",
  });
  await end;
  const request = requests
    .map((x) => {
      const v = x as {
        tools?: unknown[];
        input?: { type: string; tools?: unknown[] }[];
      };
      return v.tools
        ? { tools: v.tools }
        : v.input?.find((i) => i.type === "additional_tools");
    })
    .find((x) => x?.tools) as { tools: unknown[] } | undefined;
  if (!request) throw Error("No actual model tool catalogue captured");
  const names: string[] = [];
  const walk = (x: unknown) => {
    if (x && typeof x === "object") {
      const v = x as Record<string, unknown>;
      if (typeof v["name"] === "string") names.push(v["name"]);
      for (const y of Object.values(v))
        if (y && typeof y === "object")
          Array.isArray(y) ? y.forEach(walk) : walk(y);
    }
  };
  walk(request.tools);
  const toolText = names.join(" ");
  const forbidden = [
    "exec_command",
    "shell_command",
    "apply_patch",
    "write_stdin",
    "view_image",
    "spawn_agent",
    "browser",
    "computer",
    "account",
    "process/spawn",
    "accept_page",
  ];
  const allowed = [
    "functions",
    "mcp__bve",
    "list_mcp_resources",
    "list_mcp_resource_templates",
    "read_mcp_resource",
    "focus_candidate",
    "prepare_design",
    "prepare_image",
    "read_context",
    "submit_candidates",
    "update_draft",
  ];
  if (names.some((x) => !allowed.includes(x)))
    throw Error(
      "Unexpected tool exposed: " +
        names.filter((x) => !allowed.includes(x)).join(","),
    );
  if (forbidden.some((x) => toolText.includes(x)))
    throw Error(
      "Forbidden tool exposed: " +
        forbidden.filter((x) => toolText.includes(x)).join(","),
    );
  writeFileSync(
    join(evidence, "effective-tools.json"),
    JSON.stringify(
      {
        version,
        transport: "owned stdio",
        source: "actual installed app-server request to offline receiver",
        environments: [],
        experimentalFields: ["environments"],
        tools: request.tools,
        forbidden,
        accountCalls: 0,
        passed: true,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({ version, names, passed: true, accountCalls: 0 }),
  );
} finally {
  clearTimeout(timer);
  rpc.close();
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
}
