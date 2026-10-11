import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp } from "../src/service/server.ts";
import { VisualWorkspace } from "../src/service/visual-workspace.ts";
import { canonical, reference, packet } from "../src/kernel/packets.ts";
import {
  visualFixture,
  offlineVisualProviders,
} from "../scripts/visual-fixture.ts";
import { normalizedPoint, regionBetween } from "../src/web/visual-geometry.ts";
import { requestControls } from "../src/modules/website/visual-controls.ts";
async function setup(t: test.TestContext) {
  const root = mkdtempSync(join(tmpdir(), "bve-visual-test-"));
  const app = await startApp(root, 0, undefined, offlineVisualProviders);
  t.after(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });
  const v = new VisualWorkspace(app.workspace),
    p = v.create({ title: "Visual fixture" }),
    unit = v.exploration.createWorkUnit(p.project.id, {
      version: 1,
      pageType: "homepage",
      label: "Homepage",
      source: "Fixture",
    });
  const session = await (
    await fetch(app.origin + "/api/v1/visual/session")
  ).json();
  const headers = {
    "Content-Type": "application/json",
    Origin: app.origin,
    "X-BVE-Token": session.token,
  };
  const post = (action: string, input: unknown, overrides = {}) =>
    fetch(app.origin + "/api/v1/visual/" + action, {
      method: "POST",
      headers: { ...headers, ...overrides },
      body: JSON.stringify({ projectId: p.project.id, input }),
    });
  return { root, app, v, p, unit, post, headers };
}
const preparation = (s: Awaited<ReturnType<typeof setup>>) => ({
  expectedProject: s.p.project,
  unit: reference(s.unit),
  selections: null,
  intent: "Prepare synthetic visual direction",
  count: 1,
  direction: "fresh",
  brand: null,
  operation: "create",
  requests: [],
  level1: [],
});
test("visual HTTP protects token/origin, rejects malformed and unowned/stale operations without writes", async (t) => {
  const s = await setup(t),
    before = canonical(s.app.workspace.kernel.latestPackets()),
    events = canonical(s.app.workspace.kernel.ledger(s.p.project.id));
  for (const headers of [
    { "X-BVE-Token": "wrong" },
    { Origin: "https://foreign.invalid" },
  ])
    assert.equal(
      (await s.post("prepare", preparation(s), headers)).status,
      403,
    );
  for (const input of [
    { ...preparation(s), count: 0 },
    { ...preparation(s), count: 7 },
    { ...preparation(s), count: 1.5 },
    { ...preparation(s), count: 1, extra: true },
    { ...preparation(s), intent: "<script>alert(1)</script>" },
    { ...preparation(s), unit: { ...reference(s.unit), version: 99 } },
  ])
    assert.notEqual((await s.post("prepare", input)).status, 200);
  assert.equal((await s.post("registerSynthetic", {})).status, 404);
  assert.equal(canonical(s.app.workspace.kernel.latestPackets()), before);
  assert.equal(
    canonical(s.app.workspace.kernel.ledger(s.p.project.id)),
    events,
  );
});
test("visual imports fully decode exact formats, reject raw markup and corrupt closure", async (t) => {
  const s = await setup(t);
  for (const format of ["png", "jpeg", "webp"] as const) {
    const bytes = await visualFixture(0, format);
    const r = await s.post("import", {
      expectedProject: s.p.project,
      unit: reference(s.unit),
      file: bytes.toString("base64"),
      permission: "Synthetic rights",
      previous: null,
    });
    assert.equal(r.status, 200);
    const c = await r.json();
    const query = new URLSearchParams({
      project: s.p.project.id,
      id: c.id,
      version: String(c.version),
    });
    const image = await fetch(s.app.origin + "/api/v1/visual/image?" + query);
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), bytes);
    writeFileSync(
      join(s.app.workspace.assets.root, c.payload.state.image.id),
      Buffer.from("corrupt"),
    );
    assert.notEqual(
      (await fetch(s.app.origin + "/api/v1/visual/image?" + query)).status,
      200,
    );
  }
  const before = canonical(s.app.workspace.kernel.ledger(s.p.project.id));
  assert.notEqual(
    (
      await s.post("import", {
        expectedProject: s.p.project,
        unit: reference(s.unit),
        file: Buffer.from("<svg/>").toString("base64"),
        permission: "Fixture",
        previous: null,
      })
    ).status,
    200,
  );
  assert.equal(
    canonical(s.app.workspace.kernel.ledger(s.p.project.id)),
    before,
  );
});
test("visual preparation freezes all four influence combinations and counts 1/6 without execution or brand leakage", async (t) => {
  const s = await setup(t);
  const brand = packet({
    type: "visual-os",
    id: "approved-visual-test-brand",
    approval: "accepted",
    payload: {
      values: {
        color: { value: "#112233", approved: true },
        privateProposal: { value: "excluded", approved: false },
      },
      placeholders: {},
    },
  });
  s.app.workspace.kernel.put(brand);
  for (const direction of ["fresh", "follow"])
    for (const enabled of [false, true])
      for (const count of [1, 6]) {
        const r = await s.post("prepare", {
          ...preparation(s),
          direction,
          count,
          brand: enabled ? reference(brand) : null,
          requests: [{ key: "section-count", value: 4, entryId: null }],
          level1: [{ key: "accent-color", value: "#112233", entryId: null }],
        });
        assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
        const result = await r.json();
        assert.equal(result.batch.payload.state.attempts.length, count);
        assert.ok(
          result.batch.payload.state.attempts.every(
            (a: { status: string }) => a.status === "pending",
          ),
        );
        assert.equal(
          result.specification.payload.state.executionAuthorization,
          null,
        );
        assert.equal(
          result.specification.payload.state.metricRequests[0].status,
          "requested",
        );
        assert.equal(
          result.specification.payload.state.constraints[0].path,
          "request.page--accent-color",
        );
        assert.equal(result.specification.payload.state.brand.enabled, enabled);
        if (enabled)
          assert.deepEqual(result.specification.payload.state.brand.values, {
            color: "#112233",
          });
      }
});
test("selection CAS, page ownership, annotation sanitation and unsupported exact regions reject without mutation", async (t) => {
  const s = await setup(t),
    c = await s.v.exploration.importCandidate(
      s.p.project.id,
      reference(s.unit),
      await visualFixture(0),
      "Fixture rights",
    );
  const base = {
    expectedProject: s.p.project,
    unit: reference(s.unit),
    previous: null,
    entries: [
      {
        id: "source",
        candidate: reference(c),
        anchor: { kind: "whole" },
        intent: "inspiration",
        target: null,
        notes: [{ id: "note", text: "Use this layout" }],
      },
    ],
  };
  const first = await s.post("selections", base);
  assert.equal(first.status, 200);
  const sel = await first.json();
  const other = s.v.exploration.createWorkUnit(s.p.project.id, {
    version: 1,
    pageType: "about",
    label: "About",
    source: "Fixture",
  });
  const before = canonical(s.app.workspace.kernel.ledger(s.p.project.id));
  assert.equal((await s.post("selections", base)).status, 409);
  for (const entries of [
    [
      {
        ...base.entries[0],
        notes: [{ id: "note", text: "<img onerror=alert(1)>" }],
      },
    ],
    [
      {
        ...base.entries[0],
        intent: "exact",
        target: "target",
        anchor: { kind: "rectangle", x: 0, y: 0, width: 0.1, height: 0.1 },
      },
    ],
  ])
    assert.notEqual(
      (
        await s.post("selections", {
          ...base,
          previous: reference(sel),
          entries,
        })
      ).status,
      200,
    );
  assert.notEqual(
    (await s.post("selections", { ...base, unit: reference(other) })).status,
    200,
  );
  const foreign = s.v.create({ title: "Other" });
  const foreignUnit = s.v.exploration.createWorkUnit(foreign.project.id, {
    version: 1,
    pageType: "homepage",
    label: "Home",
    source: "Fixture",
  });
  assert.notEqual(
    (await s.post("selections", { ...base, unit: reference(foreignUnit) }))
      .status,
    200,
  );
  assert.equal(
    canonical(s.app.workspace.kernel.ledger(s.p.project.id)),
    before,
  );
});
test("prepared spec and batch roll back together when final packet fails gate", async (t) => {
  const s = await setup(t);
  const kernel = s.app.workspace.kernel,
    put = kernel.putMany.bind(kernel),
    before = canonical(kernel.latestPackets()),
    events = canonical(kernel.ledger(s.p.project.id));
  kernel.putMany = (packets) =>
    put(
      packets.map((p, i) =>
        i === packets.length - 1 ? { ...p, integrity: "0".repeat(64) } : p,
      ),
    );
  assert.notEqual((await s.post("prepare", preparation(s))).status, 200);
  assert.equal(canonical(kernel.latestPackets()), before);
  assert.equal(canonical(kernel.ledger(s.p.project.id)), events);
  kernel.putMany = put;
  assert.equal((await s.post("prepare", preparation(s))).status, 200);
});
test("requested inventory keeps six direct and 21 Tune concepts, static unavailable dynamics and strict types", async (t) => {
  const s = await setup(t);
  assert.equal(requestControls.filter((c) => c.level === 1).length, 6);
  assert.equal(requestControls.filter((c) => c.level === 2).length, 21);
  assert.equal(requestControls.filter((c) => c.unavailable).length, 5);
  for (const request of [
    { key: "motion-speed", value: 2, entryId: null },
    { key: "section-count", value: 2.5, entryId: null },
    { key: "column-structure", value: 2, entryId: null },
    { key: "visual-density", value: 11, entryId: null },
    { key: "visual-density", value: 4, entryId: "missing" },
  ])
    assert.notEqual(
      (await s.post("prepare", { ...preparation(s), requests: [request] }))
        .status,
      200,
    );
});
test("geometry uses displayed raster bounds including letterbox and zoom, rejects outside points", () => {
  assert.equal(
    normalizedPoint(10, 50, { x: 100, y: 20, width: 200, height: 300 }),
    null,
  );
  assert.deepEqual(
    normalizedPoint(200, 170, { x: 100, y: 20, width: 200, height: 300 }),
    { x: 0.5, y: 0.5 },
  );
  assert.deepEqual(
    normalizedPoint(300, 320, { x: 100, y: 20, width: 400, height: 600 }),
    { x: 0.5, y: 0.5 },
  );
  assert.deepEqual(regionBetween({ x: 0.8, y: 0.9 }, { x: 0.2, y: 0.3 }), {
    x: 0.2,
    y: 0.3,
    width: 0.6000000000000001,
    height: 0.6000000000000001,
  });
});

test("project revision during async image import rejects before media, membership or candidate writes", async (t) => {
  const s = await setup(t);
  const bytes = await visualFixture(0);
  const pending = s.v.command(s.p.project.id, "import", {
    expectedProject: s.p.project,
    unit: reference(s.unit),
    file: bytes.toString("base64"),
    permission: "Fixture",
    previous: null,
  });
  const { revise } = await import("../src/kernel/packets.ts");
  const p = s.app.workspace.project(s.p.project.id);
  s.app.workspace.kernel.put(
    revise(p, p.payload, "fixture", "Concurrent project revision"),
  );
  const before = canonical(s.app.workspace.kernel.latestPackets()),
    events = canonical(s.app.workspace.kernel.ledger(s.p.project.id));
  await assert.rejects(pending, /Project changed/);
  assert.equal(canonical(s.app.workspace.kernel.latestPackets()), before);
  assert.equal(
    canonical(s.app.workspace.kernel.ledger(s.p.project.id)),
    events,
  );
});

test("manual retry and cancellation preserve partial results, reference-only uncertainty and explicit lineage", async (t) => {
  const s = await setup(t);
  const { seedVisual } = await import("../scripts/visual-fixture.ts");
  const seeded = await seedVisual(s.app.workspace);
  const pid = seeded.p.project.id;
  const records = seeded.v.state(pid, reference(seeded.unit)).records;
  const batches = records.filter(
    (p) => (p.payload as { kind: string }).kind === "raster-batch",
  );
  const partial = batches.find((p) =>
    (
      p.payload as { state: { attempts: { status: string }[] } }
    ).state.attempts.some((a) => a.status === "invalid"),
  )!;
  const before = canonical(
    seeded.v.state(pid, reference(seeded.unit)).candidates,
  );
  const retry = (await seeded.v.command(pid, "retry", {
    expectedProject: seeded.p.project,
    unit: reference(seeded.unit),
    batch: reference(partial),
    slot: 2,
  })) as {
    payload: { state: { retryOf: unknown; attempts: { status: string }[] } };
  };
  assert.deepEqual(retry.payload.state.retryOf, {
    batch: reference(partial),
    slot: 2,
  });
  assert.ok(retry.payload.state.attempts.every((a) => a.status === "pending"));
  assert.equal(
    canonical(seeded.v.state(pid, reference(seeded.unit)).candidates),
    before,
  );
  const closed = batches.find((p) =>
    (
      p.payload as { state: { attempts: { status: string }[] } }
    ).state.attempts.some((a) => a.status === "uncertain"),
  )!;
  const cancelled = (await seeded.v.command(pid, "cancel", {
    expectedProject: seeded.p.project,
    unit: reference(seeded.unit),
    batch: reference(closed),
  })) as { integrity: string };
  assert.equal(cancelled.integrity, closed.integrity);
  assert.equal(
    canonical(seeded.v.state(pid, reference(seeded.unit)).candidates),
    before,
  );
});

test("multiple saved selection sets require exact choice and incompatible exact locks never partially write", async (t) => {
  const s = await setup(t);
  const first = s.v.exploration.selections(s.p.project.id, {
    version: 1,
    workUnit: reference(s.unit),
    entries: [],
  });
  const second = s.v.exploration.selections(s.p.project.id, {
    version: 1,
    workUnit: reference(s.unit),
    entries: [],
  });
  assert.equal((await s.post("prepare", preparation(s))).status, 409);
  const updated = await s.post("selections", {
    expectedProject: s.p.project,
    unit: reference(s.unit),
    previous: reference(first),
    entries: [],
  });
  assert.equal(updated.status, 200);
  const current = await updated.json();
  assert.equal(
    s.v.exploration.read(s.p.project.id, reference(second), "raster-selections")
      .integrity,
    second.integrity,
  );
  const candidates = [];
  for (let i = 0; i < 2; i++)
    candidates.push(
      await s.v.exploration.importCandidate(
        s.p.project.id,
        reference(s.unit),
        await visualFixture(i),
        "Synthetic rights",
      ),
    );
  const before = canonical(s.app.workspace.kernel.ledger(s.p.project.id));
  const conflict = await s.post("selections", {
    expectedProject: s.p.project,
    unit: reference(s.unit),
    previous: reference(current),
    entries: candidates.map((c, i) => ({
      id: "source-" + i,
      candidate: reference(c),
      anchor: { kind: "whole" },
      intent: "exact",
      target: "same-asset",
      notes: [],
    })),
  });
  assert.notEqual(conflict.status, 200);
  assert.match((await conflict.json()).error, /Incompatible exact locks/);
  assert.equal(
    canonical(s.app.workspace.kernel.ledger(s.p.project.id)),
    before,
  );
});
