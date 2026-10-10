import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountChatDriver } from "../src/service/chat-process.ts";
import type { ChatAuth } from "../src/service/chat-auth.ts";
import type { ChatDriver, ChatTurn } from "../src/service/chat-contracts.ts";
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
for (const stage of ["already", "auth", "initialize", "thread", "images", "turn-start", "running", "completed"] as const) {
  test(`account driver cancellation boundary: ${stage}`, { timeout: 3000 }, async () => {
    const controller = new AbortController(), entered = deferred<void>(), gate = deferred<void>();
    const methods: string[] = [], persisted: string[] = [];
    let reservations = 0, grants = 0, releases = 0, closed = 0, processes = 0;
    const pause = async (at: string) => {
      if (stage === at) { entered.resolve(); await gate.promise; }
    };
    const auth = {
      policy: () => ({ maxTurns: 2, model: "gpt-6-luna" }),
      token: async () => { await pause("auth"); return "offline-synthetic"; },
      consumeTurn: () => { reservations++; },
    } as unknown as ChatAuth;
    const rpc = {
      onEvent: (_method: string, _params: Record<string, unknown>) => {},
      notify: (method: string) => { methods.push(method); },
      close: () => { closed++; },
      request: async (method: string, _params: unknown): Promise<Record<string, unknown>> => {
        methods.push(method);
        if (method === "initialize") { await pause("initialize"); return {}; }
        if (method === "thread/start") { await pause("thread"); return { thread: { id: "synthetic-thread" } }; }
        if (method === "turn/start") {
          await pause("turn-start");
          rpc.onEvent("turn/started", { threadId: "synthetic-thread", turn: { id: "synthetic-turn" } });
          if (stage === "running") entered.resolve();
          if (stage === "completed") rpc.onEvent("turn/completed", { threadId: "synthetic-thread", turn: { id: "synthetic-turn", status: "completed" } });
        }
        return {};
      },
    };
    const driver = new AccountChatDriver(mkdtempSync(join(tmpdir(), "bve-driver-adverse-")), auth, () => "http://127.0.0.1:1", () => {
      grants++; return { token: "offline-grant", release: () => { releases++; } };
    }, async () => { await pause("images"); return []; }, {
      verifyBinary: () => "codex-cli 0.162.1",
      createRpc: () => { processes++; return rpc; },
    });
    const context: Parameters<ChatDriver["run"]>[0] = {
      turn: { projectId: "synthetic-project", id: "synthetic-id", threadId: null, text: "synthetic", focus: { resources: [], target: null } } as unknown as ChatTurn,
      history: [], tool: async () => null, delta: () => {},
      thread: (id) => { persisted.push(id); }, protocolTurn: (id) => { persisted.push(id); }, signal: controller.signal,
    };
    const original = process.env["BVE_CODEX_BINARY"];
    process.env["BVE_CODEX_BINARY"] = "offline-injected-boundary";
    try {
      if (stage === "already") controller.abort();
      const result = driver.run(context);
      if (stage !== "already" && stage !== "completed") { await entered.promise; controller.abort(); }
      const receipt = await result; // Must settle while the deferred operation remains blocked.
      assert.equal(receipt.status, stage === "completed" ? "completed" : "interrupted");
      assert.equal(driver.owned.size, 0);
      assert.equal(releases, grants);
      assert.equal(closed, processes);
      if (["already", "auth", "initialize", "thread", "images"].includes(stage)) {
        assert.equal(methods.includes("turn/start"), false);
        assert.equal(reservations, 0);
      } else {
        assert.equal(reservations, 1); // No refund of a sent reservation.
        assert.equal(methods.filter((m) => m === "turn/start").length, 1);
      }
      if (stage === "running") {
        assert.equal(methods.includes("turn/interrupt"), true);
        assert.deepEqual(persisted, ["synthetic-thread", "synthetic-turn"]);
      }
      const beforeLateReply = [...persisted];
      gate.resolve();
      await new Promise((r) => setImmediate(r));
      assert.equal(methods.filter((m) => m === "turn/start").length, reservations);
      assert.deepEqual(persisted, beforeLateReply);
    } finally {
      gate.resolve();
      await driver.close();
      if (original === undefined) delete process.env["BVE_CODEX_BINARY"];
      else process.env["BVE_CODEX_BINARY"] = original;
    }
  });
}
