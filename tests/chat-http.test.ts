import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp } from "../src/service/server.ts";
import { ChatFixture } from "../scripts/chat-fixture.ts";

test(
  "shutdown with active chat polling drains HTTP before closing private stores; repeated close shares completion",
  { timeout: 5000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "bve-chat-close-"));
    const app = await startApp(root, 0, undefined, undefined, {
      chatDriver: new ChatFixture(),
      aiResponseFixture: true,
    });
    const turn = app.chat.send({
      projectId: null,
      text: "slow bicycle repair",
      clientId: "turn-close",
      focus: { view: "studio", page: null, resources: [], target: null },
    });
    let polling = true,
      reads = 0;
    const requests = (async () => {
      while (polling) {
        try {
          const response = await fetch(
            app.origin + "/api/v1/chat/state?project=" + turn.projectId,
          );
          await response.text();
          reads++;
        } catch {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    })();
    while (reads === 0) await new Promise((resolve) => setTimeout(resolve, 5));
    const first = app.close();
    assert.equal(app.close(), first);
    try {
      await first;
    } finally {
      polling = false;
      await requests;
    }
    assert.equal(app.server.listening, false);
    // Reopen only after full shutdown: no running turn or automatic mutation replay remains.
    const reopened = await startApp(root, 0);
    try {
      assert.equal(
        reopened.chat.state(turn.projectId).session.turns[0]!.status,
        "failed",
      );
      assert.equal(reopened.pages.state(turn.projectId).pages.length, 0);
    } finally {
      await reopened.close();
    }
  },
);
