import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Workspace } from "../src/service/workspace.ts";
import { Pages } from "../src/service/pages.ts";
import { Chat } from "../src/service/chat.ts";
import type { ChatDriver, ChatTurn } from "../src/service/chat-contracts.ts";
import { ChatFixture } from "../scripts/chat-fixture.ts";
import { reference, digest } from "../src/kernel/packets.ts";
import {
  seedRepairPage,
  repairResult,
} from "../scripts/inference-repair-fixture.ts";
import { pageSignature } from "../src/modules/website/page.ts";
import { syntheticCompositionImage } from "../scripts/composition-fixture.ts";
const focus = { view: "studio", page: null, resources: [], target: null };
function setup(driver?: ChatDriver) {
  const root = mkdtempSync(join(tmpdir(), "bve-chat-test-")),
    w = new Workspace(root, { aiResponseFixture: true }),
    p = new Pages(w),
    chat = new Chat(root, w, p, driver);
  return {
    root,
    w,
    p,
    chat,
    close: async () => {
      await chat.close();
      w.close();
    },
  };
}
async function done(chat: Chat, pid: string) {
  for (let i = 0; i < 100; i++) {
    if (chat.state(pid).session.turns.at(-1)?.status !== "running") return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error("Fixture did not finish");
}
class Probe implements ChatDriver {
  kind = "test-fixture" as const;
  context: Parameters<ChatDriver["run"]>[0] | null = null;
  async run(c: Parameters<ChatDriver["run"]>[0]) {
    this.context = c;
    await new Promise<void>((r) =>
      c.signal.addEventListener("abort", () => r(), { once: true }),
    );
    return { status: "interrupted" as const, model: null, usage: null };
  }
  async close() {}
}
test("chat intake, arbitrary alternatives, exact refinement, explicit acceptance, restart and export", async () => {
  const s = setup(new ChatFixture());
  try {
    const v = s.chat.send({
      projectId: null,
      text: "Make a bicycle repair landing page",
      focus,
      clientId: "turn-start",
    });
    await done(s.chat, v.projectId);
    assert.equal(
      s.chat.state(v.projectId).session.turns[0]!.status,
      "completed",
    );
    assert.equal(s.p.state(v.projectId).pages.length, 2);
    const first = s.p.state(v.projectId).pages[0]!;
    assert.equal(s.p.state(v.projectId).accepted[first.id], null);
    s.chat.select(v.projectId, { candidate: reference(first), compare: true });
    s.chat.send({
      projectId: v.projectId,
      text: "Make it calmer and keep the heading",
      focus: { ...focus, page: reference(first) },
      clientId: "turn-revise",
    });
    await done(s.chat, v.projectId);
    const latest = s.p.state(v.projectId).pages.find((x) => x.id === first.id)!;
    assert.equal(latest.version, 2);
    assert.equal(
      latest.payload.state.page.root.children![0]!.text,
      first.payload.state.page.root.children![0]!.text,
    );
    s.chat.accept(v.projectId, {
      candidate: reference(latest),
      reviewedHash: pageSignature(latest.payload.state),
      acknowledgeFindings: true,
    });
    const bytes = (await s.p.export(v.projectId, reference(latest))).bytes;
    await s.chat.close();
    const reopened = new Chat(s.root, s.w, s.p);
    assert.equal(reopened.state(v.projectId).session.turns.length, 2);
    assert.equal(reopened.state(v.projectId).session.active!.version, 2);
    assert.deepEqual(
      (await s.p.export(v.projectId, reference(latest))).bytes,
      bytes,
    );
    await reopened.close();
  } finally {
    s.w.close();
  }
});
test("disconnected intake retains unknowns and never creates fake candidates", async () => {
  const s = setup();
  try {
    const v = s.chat.send({
      projectId: null,
      text: "A night garden exhibition",
      focus,
      clientId: "turn-disconnected",
    });
    assert.equal(v.session.turns[0]!.status, "disconnected");
    assert.equal(
      s.w.project(v.projectId).payload.localContext["audience"]!.override,
      "",
    );
    assert.equal(s.p.state(v.projectId).pages.length, 0);
    assert.equal(
      s.chat.send({
        projectId: null,
        text: "A night garden exhibition",
        focus,
        clientId: "turn-disconnected",
      }).projectId,
      v.projectId,
    );
    assert.equal(s.w.state().projects.length, 1);
  } finally {
    await s.close();
  }
});
test("scoped context excludes unchecked references, operational records and other projects; no acceptance/shell tool", async () => {
  const driver = new Probe(),
    s = setup(driver);
  try {
    const a = s.w.create({
        title: "Alpha",
        mode: "freeroam",
        visualOS: null,
        palette: null,
      }).project!,
      b = s.w.create({
        title: "Private Beta",
        mode: "freeroam",
        visualOS: null,
        palette: null,
      }).project!;
    await s.p.addMedia(a.id, {
      expectedProject: reference(a),
      origin: null,
      file: (await syntheticCompositionImage()).toString("base64"),
      label: "Unchecked private reference",
      role: "reference",
      permission: "Private",
    });
    const v = s.chat.send({
      projectId: a.id,
      text: "Explain focused design",
      focus: { ...focus, view: "history" },
      clientId: "turn-scope",
    });
    const context = await driver.context!.tool("read_context", "read", {});
    assert.ok(!JSON.stringify(context).includes("Unchecked private reference"));
    assert.ok(!JSON.stringify(context).includes(b.id));
    assert.equal((context as { view: string }).view, "history");
    await assert.rejects(driver.context!.tool("accept_page", "accept", {}));
    await assert.rejects(
      driver.context!.tool("exec_command", "shell", { cmd: "cat secrets" }),
    );
    await assert.rejects(
      s.chat.dispatch(
        b.id,
        v.session.turns[0]!.id,
        "read_context",
        "foreign",
        {},
      ),
    );
    assert.deepEqual(s.p.state(a.id).accepted, {});
  } finally {
    await s.close();
  }
});
test("action receipts deduplicate mutation and reject changed/missing/foreign request bindings", async () => {
  const driver = new Probe(),
    s = setup(driver);
  try {
    const a = s.w.create({
      title: "Receipt",
      mode: "freeroam",
      visualOS: null,
      palette: null,
    }).project!;
    s.chat.send({
      projectId: a.id,
      text: "Create",
      focus,
      clientId: "turn-receipts",
    });
    const tool = driver.context!.tool,
      input = { operation: "create", instruction: "Mechanical", locks: [] };
    const q = (await tool("prepare_design", "prepare", input)) as {
      request: import("../src/kernel/contracts.ts").VersionRef;
    };
    assert.deepEqual(await tool("prepare_design", "prepare", input), q);
    assert.equal(s.p.state(a.id).requests.length, 1);
    await assert.rejects(
      tool("prepare_design", "prepare", { ...input, instruction: "Changed" }),
    );
    await assert.rejects(
      tool("submit_candidates", "missing", {
        request: { ...q.request, id: "foreign" },
        response: {},
      }),
    );
    await assert.rejects(
      tool("submit_candidates", "malformed", {
        request: q.request,
        response: { schema: "broken" },
      }),
    );
    const req = s.p.request(a.id, q.request);
    const response = repairResult(req);
    const out = await tool("submit_candidates", "valid", {
      request: q.request,
      response,
    });
    assert.deepEqual(
      await tool("submit_candidates", "valid", {
        request: q.request,
        response,
      }),
      out,
    );
    assert.equal(s.p.state(a.id).pages.length, 1);
  } finally {
    await s.close();
  }
});
test("direct controls, stale project/base and cancellation prevent redirection or activation", async () => {
  for (const scenario of ["project", "base", "cancel"]) {
    const driver = new Probe(),
      s = setup(driver);
    try {
      const a = s.w.create({
          title: scenario,
          mode: "freeroam",
          visualOS: null,
          palette: null,
        }).project!,
        base = await seedRepairPage(s.p, a.id);
      s.chat.select(a.id, { candidate: reference(base), compare: false });
      s.chat.send({
        projectId: a.id,
        text: "Refine",
        focus: { ...focus, page: reference(base) },
        clientId: "turn-" + scenario,
      });
      const tool = driver.context!.tool;
      const q = (await tool("prepare_design", "prepare", {
        operation: "revise",
        instruction: "Mechanical",
      })) as { request: import("../src/kernel/contracts.ts").VersionRef };
      if (scenario === "project")
        s.w.reviseProject(a.id, {
          expectedProject: reference(a),
          brief: { intent: "Operator knob changed" },
          reason: "Explicit operator change",
        });
      if (scenario === "base")
        s.p.save(a.id, {
          artifact: reference(base),
          page: { ...base.payload.state.page, title: "Operator newer page" },
          reason: "Direct edit",
        });
      if (scenario === "cancel")
        s.chat.cancel(a.id, { turn: "turn-" + scenario });
      await assert.rejects(
        tool("submit_candidates", "late", {
          request: q.request,
          response: repairResult(s.p.request(a.id, q.request)),
        }),
      );
      assert.equal(s.chat.state(a.id).session.active!.version, 1);
      assert.equal(s.p.state(a.id).pages.length, 1);
      assert.equal(s.p.state(a.id).accepted[base.id], null);
    } finally {
      await s.close();
    }
  }
});
test("image geometry binds original pixels and returned original permission is explicit", async () => {
  const driver = new Probe(),
    s = setup(driver);
  try {
    const a = s.w.create({
      title: "Image",
      mode: "freeroam",
      visualOS: null,
      palette: null,
    }).project!;
    await s.p.addMedia(a.id, {
      expectedProject: reference(a),
      file: (await syntheticCompositionImage()).toString("base64"),
      origin: null,
      label: "Synthetic original",
      role: "placeable",
      permission: "Synthetic test permission",
    });
    const m = s.p.state(a.id).media[0]!;
    const base = await seedRepairPage(s.p, a.id);
    const page = {
      ...base.payload.state.page,
      media: { hero: null },
      root: {
        ...base.payload.state.page.root,
        children: [
          ...base.payload.state.page.root.children!,
          {
            id: "image",
            kind: "media" as const,
            slot: "hero",
            alt: "Synthetic original",
            decorative: false,
          },
        ],
      },
    };
    s.p.save(a.id, {
      artifact: reference(base),
      page,
      reason: "Mechanical slot",
    });
    await s.p.place(a.id, {
      artifact: { ...reference(base), version: 2 },
      slot: "hero",
      media: reference(m),
      reason: "Mechanical placement",
    });
    const p = s.p.state(a.id).pages[0]!;
    const target = {
      page: reference(p),
      media: reference(m),
      slot: "hero",
      shape: "rectangle",
      bounds: { x: 2, y: 3, width: 10, height: 12 },
      preset: "preserve-form-change-finish",
    };
    s.chat.send({
      projectId: a.id,
      text: "Make the handle thinner; keep the rest",
      focus: { ...focus, page: reference(p), target },
      clientId: "turn-image",
    });
    const j = (await driver.context!.tool("prepare_image", "job", {
      instruction: "Thin handle",
      preset: "strict-region",
    })) as { id: string; target: unknown; status: string; preset: string };
    assert.equal(j.status, "unavailable");
    assert.equal(j.preset, "preserve-form-change-finish");
    assert.deepEqual(j.target, target);
    assert.equal(
      s.chat.state(a.id).jobs[0]!.dimensions.width,
      m.payload.state.image.width,
    );
    const attached = await s.chat.attach(a.id, {
      file: (await syntheticCompositionImage()).toString("base64"),
      job: j.id,
    });
    assert.equal(
      s.p.media(a.id, attached.media).payload.state.role,
      "reference",
    );
    await assert.rejects(s.chat.place(a.id, { job: j.id }));
    await assert.rejects(
      s.chat.attach(a.id, { file: "bad", job: "foreign-job" }),
    );
  } finally {
    await s.close();
  }
});
test("uncertain restart retains receipts and does not replay; failed quota/auth has no automatic retries", async () => {
  const driver = new Probe(),
    s = setup(driver);
  try {
    const a = s.w.create({
      title: "Uncertain",
      mode: "freeroam",
      visualOS: null,
      palette: null,
    }).project!;
    s.chat.send({
      projectId: a.id,
      text: "Work",
      focus,
      clientId: "turn-uncertain",
    });
    await driver.context!.tool("prepare_design", "prepare", {
      operation: "create",
      instruction: "Mechanical",
    });
    s.chat.store.db
      .prepare("UPDATE actions SET status='executing' WHERE tid=?")
      .run("turn-uncertain");
    const other = new Chat(s.root, s.w, s.p);
    assert.equal(other.state(a.id).session.turns[0]!.status, "uncertain");
    assert.equal(s.p.state(a.id).requests.length, 1);
    await assert.rejects(
      other.dispatch(a.id, "turn-uncertain", "prepare_design", "prepare", {
        operation: "create",
        instruction: "Mechanical",
      }),
    );
    await other.close();
  } finally {
    await s.close();
  }
  let calls = 0;
  const failing: ChatDriver = {
    kind: "test-fixture",
    run: async () => {
      calls++;
      throw Error("quota or auth");
    },
    close: async () => {},
  };
  const s2 = setup(failing);
  try {
    const v = s2.chat.send({
      projectId: null,
      text: "A different fictional brief",
      focus,
      clientId: "turn-auth",
    });
    await done(s2.chat, v.projectId);
    assert.equal(s2.chat.state(v.projectId).session.turns[0]!.status, "failed");
    assert.equal(calls, 1);
    assert.equal(s2.p.state(v.projectId).pages.length, 0);
  } finally {
    await s2.close();
  }
});
test("injected image transport receives exact source/mask and returns guarded reusable original, while outside changes reject", async () => {
  const driver = new Probe(),
    s = setup(driver);
  try {
    const a = s.w.create({
        title: "Injected image",
        mode: "freeroam",
        visualOS: null,
        palette: null,
      }).project!,
      bytes = await syntheticCompositionImage();
    await s.p.addMedia(a.id, {
      expectedProject: reference(a),
      file: bytes.toString("base64"),
      origin: null,
      label: "Permitted synthetic",
      role: "placeable",
      permission: "Synthetic permission",
    });
    const m = s.p.state(a.id).media[0]!,
      base = await seedRepairPage(s.p, a.id);
    s.p.save(a.id, {
      artifact: reference(base),
      page: {
        ...base.payload.state.page,
        media: { hero: null },
        root: {
          ...base.payload.state.page.root,
          children: [
            ...base.payload.state.page.root.children!,
            {
              id: "image",
              kind: "media",
              slot: "hero",
              alt: "Synthetic",
              decorative: false,
            },
          ],
        },
      },
      reason: "Mechanical slot",
    });
    await s.p.place(a.id, {
      artifact: { ...reference(base), version: 2 },
      slot: "hero",
      media: reference(m),
      reason: "Mechanical",
    });
    const p = s.p.state(a.id).pages[0]!;
    let calls = 0;
    s.chat.imageDriver = {
      kind: "test-fixture",
      execute: async (i) => {
        calls++;
        assert.deepEqual(i.source, bytes);
        assert.equal(
          i.mask.length,
          m.payload.state.image.width * m.payload.state.image.height,
        );
        assert.ok(i.mask.some((x) => x === 0));
        assert.ok(i.mask.some((x) => x === 1));
        assert.equal(i.references.length, 0);
        return bytes;
      },
    };
    s.chat.send({
      projectId: a.id,
      text: "Edit",
      focus: {
        ...focus,
        page: reference(p),
        target: {
          page: reference(p),
          slot: "hero",
          media: reference(m),
          shape: "ellipse",
          bounds: { x: 2, y: 2, width: 10, height: 12 },
        },
      },
      clientId: "turn-injected-image",
    });
    const job = (await driver.context!.tool("prepare_image", "image", {
      instruction: "Thin handle",
      preset: "strict-region",
    })) as { id: string };
    await s.chat.executeImage(a.id, { job: job.id });
    await s.chat.executeImage(a.id, { job: job.id });
    assert.equal(calls, 1);
    await s.chat.permit(a.id, { job: job.id, confirmed: true });
    await s.chat.place(a.id, { job: job.id });
    assert.equal(s.p.state(a.id).pages[0]!.version, 4);
    assert.equal(s.p.state(a.id).accepted[p.id], null);
    const sharp = (await import("sharp")).default;
    const changed = await sharp({
      create: {
        width: m.payload.state.image.width,
        height: m.payload.state.image.height,
        channels: 4,
        background: "#ff0000",
      },
    })
      .png()
      .toBuffer();
    await assert.rejects(
      s.chat.attach(a.id, { job: job.id, file: changed.toString("base64") }),
      /outside/,
    );
  } finally {
    await s.close();
  }
});
test("turn identity cannot collide across projects or change its message; completed focus cannot override newer operator selection", async () => {
  const driver = new Probe(),
    s = setup(driver);
  try {
    const a = s.w.create({
        title: "A",
        mode: "freeroam",
        visualOS: null,
        palette: null,
      }).project!,
      b = s.w.create({
        title: "B",
        mode: "freeroam",
        visualOS: null,
        palette: null,
      }).project!,
      base = await seedRepairPage(s.p, a.id);
    s.chat.select(a.id, { candidate: reference(base), compare: false });
    s.chat.send({
      projectId: a.id,
      text: "Refine",
      focus: { ...focus, page: reference(base) },
      clientId: "turn-unique",
    });
    assert.throws(
      () =>
        s.chat.send({
          projectId: b.id,
          text: "Foreign",
          focus,
          clientId: "turn-unique",
        }),
      /another project/,
    );
    assert.throws(
      () =>
        s.chat.send({
          projectId: a.id,
          text: "Changed",
          focus,
          clientId: "turn-unique",
        }),
      /different message/,
    );
    const q = (await driver.context!.tool("prepare_design", "prepare", {
      operation: "revise",
      instruction: "Mechanical",
    })) as { request: import("../src/kernel/contracts.ts").VersionRef };
    const result = (await driver.context!.tool("submit_candidates", "submit", {
      request: q.request,
      response: repairResult(s.p.request(a.id, q.request), "Newer proposal"),
    })) as { candidates: import("../src/kernel/contracts.ts").VersionRef[] };
    await driver.context!.tool("focus_candidate", "focus", {
      candidate: result.candidates[0],
    });
    assert.equal(s.chat.state(a.id).activePage!.version, 1);
    s.chat.cancel(a.id, { turn: "turn-unique" });
    assert.equal(s.chat.state(a.id).activePage!.version, 1);
    assert.equal(s.chat.state(a.id).session.turns[0]!.status, "cancelled");
    assert.equal(s.chat.state(a.id).session.active!.version, 1);
  } finally {
    await s.close();
  }
});
