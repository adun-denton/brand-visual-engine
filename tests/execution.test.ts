import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, cpSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp } from "../src/service/server.ts";
import { Executions } from "../src/service/execution.ts";
import { OfflineRasterTransport } from "../scripts/execution-fixture.ts";
import {
  offlineVisualProviders,
  visualFixture,
} from "../scripts/visual-fixture.ts";
import { reference, canonical, packet, revise } from "../src/kernel/packets.ts";
import type {
  Execution,
  Grant,
} from "../src/modules/website/execution-contracts.ts";
async function setup(t: test.TestContext, count = 1) {
  const root = mkdtempSync(join(tmpdir(), "bve-v03-test-")),
    transport = new OfflineRasterTransport();
  let app = await startApp(root, 0, undefined, offlineVisualProviders, {
    executionFixture: { testOnly: true, transport },
  });
  t.after(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });
  const v = app.visual,
    p = v.create({ title: "Execution fixture" }),
    u = v.exploration.createWorkUnit(p.project.id, {
      version: 1,
      pageType: "homepage",
      label: "Homepage",
      source: "Fixture",
    });
  const prepared = (await v.command(p.project.id, "prepare", {
    expectedProject: p.project,
    unit: reference(u),
    selections: null,
    intent: "Offline exploration",
    count,
    direction: "fresh",
    brand: null,
    operation: "create",
    requests: [],
    level1: [],
  })) as Awaited<ReturnType<typeof v.exploration.prepareOperation>>;
  const e = v.executions,
    q = await e.compile(
      p.project.id,
      reference(prepared.specification),
      64,
      48,
    );
  const terms = {
    request: reference(q),
    adapter: transport.capabilities.adapter,
    slots: Array.from({ length: count }, (_, i) => i + 1),
    maxSubmissions: count,
    maxStatusCalls: 12,
    maxCancelCalls: 6,
    timeoutMs: 1000,
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    reason: "Explicit offline test grant",
  };
  const grant = e.grant(p.project.id, terms),
    run = e.prepare(p.project.id, reference(grant));
  return {
    root,
    transport,
    app,
    v,
    p,
    u,
    e,
    q,
    terms,
    grant,
    run,
    prepared,
    reopen: async () => {
      if (app.server.listening) await app.close();
      app = await startApp(root, 0, undefined, offlineVisualProviders, {
        executionFixture: { testOnly: true, transport },
      });
      return app;
    },
  };
}
test("count 1 and 6, concurrent/repeated Execute are bounded and mixed invalid output preserves neighbors", async (t) => {
  for (const count of [1, 6]) {
    const s = await setup(t, count);
    s.transport.mode = "mixed";
    await Promise.all([
      s.e.execute(s.p.project.id, reference(s.run)),
      s.e.execute(s.p.project.id, reference(s.run)),
    ]);
    const again = await s.e.execute(s.p.project.id, reference(s.run));
    assert.equal(s.transport.submissions.length, count);
    assert.equal(again.payload.state.calls.length, count);
    assert.equal(
      s.v.state(s.p.project.id, reference(s.u)).candidates.length,
      Math.ceil(count / 2),
    );
    assert.deepEqual(
      again.payload.state.slots.map((a) => a.status),
      Array.from({ length: count }, (_, i) =>
        i % 2 === 0 ? "succeeded" : "invalid",
      ),
    );
    assert.equal(
      s.prepared.batch.payload.state.harness,
      "synthetic-registration",
    );
    assert.equal(s.prepared.batch.payload.state.executionAuthorization, null);
    assert.equal(s.app.workspace.kernel.selected(s.p.project.id, "page"), null);
  }
});
test("missing executor, invalid grants/capabilities and wrong bindings consume no reservation", async (t) => {
  const s = await setup(t);
  const pid = s.p.project.id,
    before = canonical(s.app.workspace.kernel.ledger(pid));
  const no = new Executions(s.app.workspace);
  await assert.rejects(
    no.compile(pid, reference(s.prepared.specification), 64, 48),
    /No connected/,
  );
  for (const changes of [
    { slots: [0] },
    { slots: [7] },
    { maxSubmissions: 0 },
    { maxSubmissions: 2 },
    { maxStatusCalls: 25 },
    { maxCancelCalls: 7 },
    { expiresAt: new Date(0).toISOString() },
    { adapter: { ...s.terms.adapter, version: "other" } },
    { request: { ...s.terms.request, version: 99 } },
  ])
    assert.throws(() => s.e.grant(pid, { ...s.terms, ...changes }));
  s.transport.capabilities.maxWidth = 32;
  await assert.rejects(s.e.execute(pid, reference(s.run)), /dimensions/);
  assert.equal(s.transport.submissions.length, 0);
  assert.equal(canonical(s.app.workspace.kernel.ledger(pid)), before);
  assert.throws(() => s.e.prepare(pid, reference(s.prepared.batch)), /Foreign/);
});
test("expiry and revocation prevent dispatch, with immutable grant terms", async (t) => {
  const s = await setup(t);
  s.e.revoke(s.p.project.id, reference(s.grant));
  await assert.rejects(
    s.e.execute(s.p.project.id, reference(s.run)),
    /revoked/,
  );
  assert.equal(s.transport.submissions.length, 0);
  assert.throws(
    () =>
      s.app.workspace.kernel.put(
        revise(
          s.e.revoke(s.p.project.id, reference(s.grant)),
          {
            ...s.grant.payload,
            state: {
              ...s.grant.payload.state,
              revoked: true,
              maxSubmissions: 2,
            },
          },
          "test",
          "forge",
        ),
      ),
    /bounds|immutable/,
  );
  const clock = Date.now(),
    short = s.e.grant(s.p.project.id, {
      ...s.terms,
      expiresAt: new Date(clock + 3600000).toISOString(),
    }),
    run = s.e.prepare(s.p.project.id, reference(short));
  const mocked = t.mock.method(Date, "now", () => clock + 3600001);
  try {
    await assert.rejects(
      s.e.execute(s.p.project.id, reference(run)),
      /expired/,
    );
  } finally {
    mocked.mock.restore();
  }
  assert.equal(s.transport.submissions.length, 0);
});
test("ambiguous send and restart never resubmit; exact submission status returns historical evidence and manual retry uses new grant", async (t) => {
  const s = await setup(t);
  s.transport.mode = "ambiguous";
  const failed = await s.e.execute(s.p.project.id, reference(s.run));
  assert.equal(failed.payload.state.slots[0]!.status, "uncertain");
  const app = await s.reopen(),
    e = app.visual.executions;
  await e.execute(s.p.project.id, reference(s.run));
  assert.equal(s.transport.submissions.length, 1);
  const reconciled = await e.reconcile(s.p.project.id, reference(s.run), 1);
  assert.equal(
    s.transport.polls[0]!.submissionId,
    failed.payload.state.slots[0]!.submissionId,
  );
  assert.equal(reconciled.payload.state.slots[0]!.status, "uncertain");
  assert.ok(reconciled.payload.state.slots[0]!.receipt);
  assert.equal(
    app.visual.state(s.p.project.id, reference(s.u)).candidates.length,
    0,
  );
  const grant = e.grant(s.p.project.id, s.terms),
    retry = e.prepare(s.p.project.id, reference(grant), {
      execution: reference(reconciled),
      slot: 1,
    });
  s.transport.mode = "immediate";
  await e.execute(s.p.project.id, reference(retry));
  assert.equal(s.transport.submissions.length, 2);
  assert.equal(
    app.visual.state(s.p.project.id, reference(s.u)).candidates.length,
    1,
  );
  assert.equal(retry.payload.state.retryOf?.execution.id, s.run.id);
});
test("scoped cancellation intent is distinct from confirmation and late output remains historical", async (t) => {
  const s = await setup(t, 6);
  s.transport.mode = "running";
  const running = await s.e.execute(s.p.project.id, reference(s.run));
  assert.equal(s.transport.submissions.length, 1);
  const cancelled = await s.e.cancel(s.p.project.id, reference(running), null);
  assert.equal(cancelled.payload.state.slots[0]!.cancelConfirmed, true);
  assert.equal(cancelled.payload.state.slots[1]!.cancelConfirmed, false);
  await s.e.reconcile(s.p.project.id, reference(cancelled), 1);
  await s.e.execute(s.p.project.id, reference(s.run));
  assert.equal(s.transport.submissions.length, 1);
  assert.equal(s.transport.cancellations.length, 1);
  assert.equal(s.v.state(s.p.project.id, reference(s.u)).candidates.length, 0);
  await assert.rejects(
    s.e.cancel(s.p.project.id, reference(s.run), 7),
    /Unowned/,
  );
});
test("result replay is idempotent and conflicting payload fails without writes", async (t) => {
  const s = await setup(t);
  const run = await s.e.execute(s.p.project.id, reference(s.run)),
    result = [...s.transport.jobs.values()][0]!.result;
  const receipt = await s.e.intake(s.p.project.id, reference(run), result),
    before = canonical(s.app.workspace.kernel.ledger(s.p.project.id));
  assert.equal(
    (await s.e.intake(s.p.project.id, reference(run), result)).id,
    receipt.id,
  );
  await assert.rejects(
    s.e.intake(s.p.project.id, reference(run), {
      ...result,
      message: "conflict",
    }),
    /Conflicting/,
  );
  assert.equal(
    canonical(s.app.workspace.kernel.ledger(s.p.project.id)),
    before,
  );
});
test("storage failure is distinguishable from malformed media; retry intake atomically commits candidate and receipt", async (t) => {
  const s = await setup(t);
  s.transport.mode = "running";
  const running = await s.e.execute(s.p.project.id, reference(s.run)),
    result = [...s.transport.jobs.values()][0]!.result;
  const save = s.app.workspace.assets.save.bind(s.app.workspace.assets);
  s.app.workspace.assets.save = () => {
    throw new Error("Injected disk failure");
  };
  await assert.rejects(
    s.e.intake(s.p.project.id, reference(running), result),
    /disk failure/,
  );
  assert.equal(
    s.e.state(s.p.project.id, reference(s.u))[0]!.run.payload.state.slots[0]!
      .receipt,
    null,
  );
  assert.equal(s.v.state(s.p.project.id, reference(s.u)).candidates.length, 0);
  s.app.workspace.assets.save = save;
  await s.e.intake(s.p.project.id, reference(running), result);
  assert.equal(s.v.state(s.p.project.id, reference(s.u)).candidates.length, 1);
});
test("crashes before/after reservation and on possible send retain accounting without implicit resend", async (t) => {
  for (const failureAt of [1, 2, 3]) {
    const s = await setup(t),
      put = s.app.workspace.kernel.put.bind(s.app.workspace.kernel);
    let calls = 0;
    s.app.workspace.kernel.put = (p, ...args) => {
      if (++calls === failureAt)
        throw new Error("Injected transaction failure");
      return put(p, ...args);
    };
    await assert.rejects(
      s.e.execute(s.p.project.id, reference(s.run)),
      /transaction/,
    );
    s.app.workspace.kernel.put = put;
    const app = await s.reopen(),
      e = app.visual.executions;
    const recovered = e.recover(s.p.project.id, reference(s.run));
    if (failureAt === 1) {
      assert.equal(recovered.payload.state.calls.length, 0);
      assert.equal(s.transport.submissions.length, 0);
    } else {
      assert.equal(recovered.payload.state.slots[0]!.status, "uncertain");
      await e.execute(s.p.project.id, reference(recovered));
      assert.equal(s.transport.submissions.length, failureAt === 3 ? 1 : 0);
    }
  }
});
test("call allowances bound status and cancel; grant reuse cannot create another execution", async (t) => {
  const s = await setup(t);
  const g = s.e.grant(s.p.project.id, {
      ...s.terms,
      maxStatusCalls: 0,
      maxCancelCalls: 0,
    }),
    run = s.e.prepare(s.p.project.id, reference(g));
  assert.equal(s.e.prepare(s.p.project.id, reference(g)).id, run.id);
  s.transport.mode = "running";
  await s.e.execute(s.p.project.id, reference(run));
  await assert.rejects(
    s.e.reconcile(s.p.project.id, reference(run), 1),
    /allowance/,
  );
  await assert.rejects(
    s.e.cancel(s.p.project.id, reference(run), 1),
    /allowance/,
  );
  assert.equal(s.transport.polls.length, 0);
  assert.equal(s.transport.cancellations.length, 0);
  assert.equal(
    s.e.state(s.p.project.id, reference(s.u)).find((e) => e.run.id === run.id)!
      .run.payload.state.slots[0]!.cancelRequested,
    true,
  );
});
test("immutable compile closes exact included sources, excludes fresh inspiration, and survives replacement and closed restore", async (t) => {
  const s = await setup(t),
    pid = s.p.project.id,
    ex = s.v.exploration,
    source = await ex.importCandidate(
      pid,
      reference(s.u),
      await visualFixture(0),
      "Authored fixture rights",
      "synthetic",
    );
  const entry = {
    id: "include-source",
    candidate: reference(source),
    integrity: source.integrity,
    image: source.payload.state.image,
    orientation: "encoded-top-left",
    coordinates: "normalized-original",
    anchor: { kind: "whole" },
    intent: "include",
    preservation: null,
    notes: [{ id: "note", text: "Retain content; no style", source: "User" }],
  };
  const selections = ex.selections(pid, {
    version: 1,
    workUnit: reference(s.u),
    entries: [entry],
  });
  const spec = ex.freeze(pid, {
    ...s.prepared.specification.payload.state,
    selections: reference(selections),
    selectionSnapshot: selections.payload.state,
    sourceScopes: [
      { entryId: entry.id, style: "excluded", content: "included" },
    ],
    resources: [
      {
        media: source.payload.state.media,
        image: source.payload.state.image,
        rights: "Authored fixture rights",
        style: "excluded",
        content: "excluded",
      },
    ],
  });
  const q = await s.e.compile(pid, reference(spec), 64, 48);
  assert.equal(q.payload.state.sources.length, 1);
  assert.equal(q.payload.state.sources[0]!.rights, "Authored fixture rights");
  assert.equal(
    q.payload.state.sources[0]!.entry!.notes[0]!.text,
    "Retain content; no style",
  );
  await ex.importCandidate(
    pid,
    reference(s.u),
    await visualFixture(1),
    "Authored fixture rights",
    "synthetic",
    reference(source),
  );
  assert.equal(
    canonical((await s.e.compile(pid, reference(spec), 64, 48)).payload.state),
    canonical(q.payload.state),
  );
  await s.app.close();
  const backup = s.root + "-closed";
  cpSync(s.root, backup, { recursive: true });
  t.after(() => rmSync(backup, { recursive: true, force: true }));
  const restored = await startApp(
    backup,
    0,
    undefined,
    offlineVisualProviders,
    { executionFixture: { testOnly: true, transport: s.transport } },
  );
  try {
    assert.equal(
      canonical(
        (await restored.visual.executions.compile(pid, reference(spec), 64, 48))
          .payload.state,
      ),
      canonical(q.payload.state),
    );
    assert.equal(
      canonical(restored.workspace.kernel.get(reference(s.prepared.batch))),
      canonical(s.prepared.batch),
    );
    assert.equal(restored.workspace.kernel.selected(pid, "page"), null);
  } finally {
    await restored.close();
  }
  const app = await s.reopen();
  const before = canonical(app.workspace.kernel.ledger(pid));
  writeFileSync(
    join(s.root, "native-assets", source.payload.state.image.id),
    Buffer.from("corrupt"),
  );
  await assert.rejects(
    app.visual.executions.compile(pid, reference(spec), 64, 48),
  );
  assert.equal(canonical(app.workspace.kernel.ledger(pid)), before);
});
test("unsupported exact locks or source influence fail before reservation, with existing V01 spec unchanged", async (t) => {
  const s = await setup(t),
    pid = s.p.project.id,
    ex = s.v.exploration,
    c = await ex.importCandidate(
      pid,
      reference(s.u),
      await visualFixture(0),
      "Synthetic rights",
      "synthetic",
    );
  const sel = ex.selections(pid, {
    version: 1,
    workUnit: reference(s.u),
    entries: [
      {
        id: "lock",
        candidate: reference(c),
        integrity: c.integrity,
        image: c.payload.state.image,
        orientation: "encoded-top-left",
        coordinates: "normalized-original",
        anchor: { kind: "whole" },
        intent: "exact",
        preservation: { predicate: "retained-bytes", target: "output" },
        notes: [],
      },
    ],
  });
  const spec = ex.freeze(pid, {
    ...s.prepared.specification.payload.state,
    selections: reference(sel),
    selectionSnapshot: sel.payload.state,
    sourceScopes: [{ entryId: "lock", style: "excluded", content: "included" }],
  });
  const before = canonical(s.app.workspace.kernel.ledger(pid));
  await assert.rejects(
    s.e.compile(pid, reference(spec), 64, 48),
    /preservation/,
  );
  assert.equal(canonical(s.app.workspace.kernel.ledger(pid)), before);
  assert.equal(s.transport.submissions.length, 0);
  const include = ex.selections(
    pid,
    {
      ...sel.payload.state,
      entries: sel.payload.state.entries.map((e) => ({
        ...e,
        intent: "include",
        preservation: null,
      })),
    },
    reference(sel),
  );
  const follow = ex.freeze(pid, {
    ...spec.payload.state,
    selections: reference(include),
    selectionSnapshot: include.payload.state,
    direction: "follow",
    sourceScopes: [{ entryId: "lock", style: "included", content: "included" }],
  });
  s.transport.capabilities.sourceInfluence = ["content"];
  await assert.rejects(
    s.e.compile(pid, reference(follow), 64, 48),
    /influence/,
  );
  assert.equal(s.transport.submissions.length, 0);
});
test("foreign project/spec/grant, malformed envelope and wrong result dimensions fail without adoption", async (t) => {
  const s = await setup(t),
    other = s.v.create({ title: "Other" }),
    before = canonical(s.app.workspace.kernel.ledger(s.p.project.id));
  await assert.rejects(
    s.e.compile(other.project.id, reference(s.prepared.specification), 64, 48),
  );
  assert.throws(() => s.e.prepare(other.project.id, reference(s.grant)));
  await assert.rejects(
    s.v.command(s.p.project.id, "execute", {
      expectedProject: s.p.project,
      unit: reference(s.u),
      execution: reference(s.run),
      url: "https://ignored.invalid",
    }),
    /Unknown/,
  );
  assert.equal(
    canonical(s.app.workspace.kernel.ledger(s.p.project.id)),
    before,
  );
  s.transport.mode = "running";
  const run = await s.e.execute(s.p.project.id, reference(s.run)),
    result = [...s.transport.jobs.values()][0]!.result;
  for (const diff of [
    { requestHash: "0".repeat(64) },
    { specHash: "0".repeat(64) },
    { jobId: "foreign-job" },
    { submissionId: "foreign-send" },
    { slot: 6 },
  ])
    await assert.rejects(
      s.e.intake(s.p.project.id, reference(run), { ...result, ...diff }),
      /Unbound/,
    );
  const invalid = await s.e.intake(s.p.project.id, reference(run), {
    ...result,
    bytes: await visualFixture(0),
  });
  assert.equal(invalid.payload.state.outcome, "invalid");
  assert.equal(s.v.state(s.p.project.id, reference(s.u)).candidates.length, 0);
});
test("cancellation racing possible send prevents remaining slots and does not adopt late bytes", async (t) => {
  const s = await setup(t, 6),
    send = s.transport.submit.bind(s.transport);
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>((r) => (entered = r)),
    hold = new Promise<void>((r) => (release = r));
  s.transport.submit = async (input) => {
    const ack = await send(input);
    entered();
    await hold;
    return ack;
  };
  const flight = s.e.execute(s.p.project.id, reference(s.run));
  await started;
  await s.e.cancel(s.p.project.id, reference(s.run), null);
  release();
  const done = await flight;
  assert.equal(s.transport.submissions.length, 1);
  assert.equal(done.payload.state.slots[0]!.status, "uncertain");
  assert.equal(s.v.state(s.p.project.id, reference(s.u)).candidates.length, 0);
  assert.equal(s.transport.cancellations.length, 0);
  assert.ok(done.payload.state.slots[0]!.receipt);
});
test("database failure during intake leaves no partial candidate or receipt and permits identical recovery", async (t) => {
  const s = await setup(t);
  s.transport.mode = "running";
  const run = await s.e.execute(s.p.project.id, reference(s.run)),
    result = [...s.transport.jobs.values()][0]!.result,
    put = s.app.workspace.kernel.putMany.bind(s.app.workspace.kernel),
    before = canonical(s.app.workspace.kernel.ledger(s.p.project.id));
  s.app.workspace.kernel.putMany = (packets) => {
    put(packets, () => {
      throw new Error("Injected atomic commit failure");
    });
  };
  await assert.rejects(
    s.e.intake(s.p.project.id, reference(run), result),
    /atomic commit/,
  );
  assert.equal(
    canonical(s.app.workspace.kernel.ledger(s.p.project.id)),
    before,
  );
  assert.equal(s.v.state(s.p.project.id, reference(s.u)).candidates.length, 0);
  s.app.workspace.kernel.putMany = put;
  await s.e.intake(s.p.project.id, reference(run), result);
  assert.equal(s.v.state(s.p.project.id, reference(s.u)).candidates.length, 1);
});
test("revocation racing first send blocks undispatched slots and stale selection makes output historical", async (t) => {
  const s = await setup(t, 6);
  const send = s.transport.submit.bind(s.transport);
  s.transport.submit = async (input) => {
    const ack = await send(input);
    s.e.revoke(s.p.project.id, reference(s.grant));
    return ack;
  };
  await assert.rejects(
    s.e.execute(s.p.project.id, reference(s.run)),
    /revoked/,
  );
  assert.equal(s.transport.submissions.length, 1);
  const g = s.e.grant(s.p.project.id, {
      ...s.terms,
      slots: [2],
      maxSubmissions: 1,
    }),
    r = s.e.prepare(s.p.project.id, reference(g));
  s.transport.submit = send;
  s.transport.mode = "running";
  await s.e.execute(s.p.project.id, reference(r));
  const result = [...s.transport.jobs.values()].at(-1)!.result;
  const current = s.app.workspace.project(s.p.project.id);
  s.app.workspace.kernel.put(
    revise(
      current,
      { ...current.payload, artifactRefs: current.payload.artifactRefs },
      "test",
      "Advance project without acceptance",
    ),
  );
  const receipt = await s.e.intake(s.p.project.id, reference(r), result);
  assert.equal(receipt.payload.state.outcome, "historical");
  assert.equal(s.v.state(s.p.project.id, reference(s.u)).candidates.length, 1);
});
test("bounded timeout and status failure remain uncertain without resends or automatic polls", async (t) => {
  const s = await setup(t),
    send = s.transport.submit.bind(s.transport);
  s.transport.submit = async (input) => {
    const ack = await send(input);
    await new Promise((r) => setTimeout(r, 50));
    return ack;
  };
  const g = s.e.grant(s.p.project.id, {
      ...s.terms,
      timeoutMs: 5,
      maxStatusCalls: 1,
    }),
    run = s.e.prepare(s.p.project.id, reference(g));
  const result = await s.e.execute(s.p.project.id, reference(run));
  assert.equal(result.payload.state.slots[0]!.status, "uncertain");
  await s.e.waitForDeliveries();
  assert.equal(s.transport.submissions.length, 1);
  assert.equal(s.transport.polls.length, 0);
  assert.ok(
    s.e.state(s.p.project.id, reference(s.u)).find((e) => e.run.id === run.id)!
      .run.payload.state.slots[0]!.receipt,
  );
  const nextGrant = s.e.grant(s.p.project.id, {
    ...s.terms,
    maxStatusCalls: 1,
  });
  const pending = s.e.prepare(s.p.project.id, reference(nextGrant));
  s.transport.mode = "running";
  s.transport.submit = send;
  await s.e.execute(s.p.project.id, reference(pending));
  s.transport.status = async () => {
    throw new Error("Status transport failed");
  };
  const status = await s.e.reconcile(s.p.project.id, reference(pending), 1);
  assert.equal(
    status.payload.state.calls.filter((c) => c.kind === "status").length,
    1,
  );
  await assert.rejects(
    s.e.reconcile(s.p.project.id, reference(pending), 1),
    /allowance/,
  );
  assert.equal(s.v.state(s.p.project.id, reference(s.u)).candidates.length, 0);
});
test("direct kernel writes reject counter rollback, frozen request mutation, semantic-kind change and unauthorized reservations", async (t) => {
  const s = await setup(t);
  s.transport.mode = "running";
  const run = await s.e.execute(s.p.project.id, reference(s.run));
  for (const state of [
    { ...run.payload.state, calls: [] },
    {
      ...run.payload.state,
      slots: run.payload.state.slots.map((a) => ({
        ...a,
        status: "pending" as const,
      })),
    },
  ])
    assert.throws(() =>
      s.app.workspace.kernel.put(
        revise(run, { ...run.payload, state }, "test", "forge"),
      ),
    );
  assert.throws(
    () =>
      s.app.workspace.kernel.put(
        revise(
          s.q,
          {
            ...s.q.payload,
            state: { ...s.q.payload.state, intent: "mutated" },
          },
          "test",
          "forge",
        ),
      ),
    /immutable|compilation/,
  );
  assert.throws(
    () =>
      s.app.workspace.kernel.put(
        revise<unknown>(
          run,
          {
            ...run.payload,
            kind: "page-work-unit",
            scope: "page-exploration",
            state: {
              version: 1,
              pageType: "homepage",
              label: "Fake",
              source: "Fake",
            },
          },
          "test",
          "forge",
        ),
      ),
    /semantic kind/,
  );
  const pending = s.e.prepare(
    s.p.project.id,
    reference(s.e.grant(s.p.project.id, s.terms)),
  );
  s.e.revoke(s.p.project.id, pending.payload.state.grant);
  const { integrity: _, ...body } = run;
  const forged = packet({
    ...body,
    id: pending.id,
    version: 2,
    provenance: {
      actor: "test",
      source: "forge",
      previous: reference(pending),
    },
    payload: {
      ...pending.payload,
      state: {
        ...pending.payload.state,
        slots: run.payload.state.slots.map((a) => ({
          ...a,
          submissionId: null,
          jobId: null,
        })),
        calls: [],
      },
    },
  });
  assert.throws(() => s.app.workspace.kernel.put(forged), /reservation/);
});
test("fresh inspiration is absent from compiled transport sources and V01 synthetic batches cannot execute", async (t) => {
  const s = await setup(t),
    ex = s.v.exploration,
    pid = s.p.project.id,
    c = await ex.importCandidate(
      pid,
      reference(s.u),
      await visualFixture(0),
      "Synthetic source",
      "synthetic",
    ),
    sel = ex.selections(pid, {
      version: 1,
      workUnit: reference(s.u),
      entries: [
        {
          id: "excluded",
          candidate: reference(c),
          integrity: c.integrity,
          image: c.payload.state.image,
          orientation: "encoded-top-left",
          coordinates: "normalized-original",
          anchor: { kind: "whole" },
          intent: "inspiration",
          preservation: null,
          notes: [
            {
              id: "excluded-note",
              text: "Do not send this note",
              source: "User",
            },
          ],
        },
      ],
    });
  const spec = ex.freeze(pid, {
    ...s.prepared.specification.payload.state,
    selections: reference(sel),
    selectionSnapshot: sel.payload.state,
    sourceScopes: [
      { entryId: "excluded", style: "excluded", content: "excluded" },
    ],
  });
  const q = await s.e.compile(pid, reference(spec), 64, 48);
  assert.deepEqual(q.payload.state.sources, []);
  assert.ok(!canonical(q.payload.state).includes("Do not send this note"));
  await assert.rejects(
    s.e.execute(pid, reference(s.prepared.batch)),
    /Foreign/,
  );
  assert.equal(s.transport.submissions.length, 0);
});
test("explicit failed receipt, unknown status and cancellation denial retain independent evidence", async (t) => {
  const s = await setup(t, 6),
    send = s.transport.submit.bind(s.transport);
  s.transport.submit = async (input) => {
    const ack = await send(input);
    if (input.slot === 2)
      ack.result = {
        ...ack.result!,
        outcome: "failed",
        bytes: null,
        message: "Explicit offline terminal failure",
      };
    return ack;
  };
  const done = await s.e.execute(s.p.project.id, reference(s.run));
  assert.equal(done.payload.state.slots[1]!.status, "failed");
  assert.equal(s.v.state(s.p.project.id, reference(s.u)).candidates.length, 5);
  const grant = s.e.grant(s.p.project.id, {
      ...s.terms,
      slots: [2],
      maxSubmissions: 1,
    }),
    run = s.e.prepare(s.p.project.id, reference(grant), {
      execution: reference(done),
      slot: 2,
    });
  s.transport.submit = send;
  s.transport.mode = "running";
  await s.e.execute(s.p.project.id, reference(run));
  s.transport.cancel = async (job) => {
    s.transport.cancellations.push(job);
    return { confirmed: false };
  };
  const cancelled = await s.e.cancel(s.p.project.id, reference(run), 2);
  assert.equal(cancelled.payload.state.slots[0]!.cancelRequested, true);
  assert.equal(cancelled.payload.state.slots[0]!.cancelConfirmed, false);
  s.transport.status = async (job) => ({ state: "unknown", jobId: job.jobId });
  const unknown = await s.e.reconcile(s.p.project.id, reference(run), 2);
  assert.equal(unknown.payload.state.slots[0]!.status, "uncertain");
  assert.equal(s.transport.submissions.length, 7);
});
function controlled<T>() {
  let release!: (value: T) => void;
  const promise = new Promise<T>((r) => (release = r));
  return { promise, release };
}
async function timedRun(s: Awaited<ReturnType<typeof setup>>, overrides = {}) {
  const grant = s.e.grant(s.p.project.id, {
    ...s.terms,
    timeoutMs: 5,
    maxStatusCalls: 0,
    maxCancelCalls: 0,
    ...overrides,
  });
  return s.e.prepare(s.p.project.id, reference(grant));
}
test("R2 delivered late acknowledgement becomes one historical receipt with zero polls, adoption or continuation; closed reopen retains it", async (t) => {
  const s = await setup(t, 6),
    send = s.transport.submit.bind(s.transport),
    held = controlled<void>(),
    entered = controlled<void>();
  s.transport.submit = async (input) => {
    const ack = await send(input);
    entered.release();
    await held.promise;
    return ack;
  };
  const run = await timedRun(s),
    flight = s.e.execute(s.p.project.id, reference(run));
  await entered.promise;
  const timeout = await flight;
  assert.equal(timeout.payload.state.slots[0]!.status, "uncertain");
  assert.equal(s.transport.submissions.length, 1);
  assert.equal(timeout.payload.state.slots[0]!.receipt, null);
  held.release();
  await s.e.waitForDeliveries();
  const latest = s.e
    .state(s.p.project.id, reference(s.u))
    .find((e) => e.run.id === run.id)!;
  assert.ok(latest.run.payload.state.slots[0]!.jobId);
  const receipt = s.app.workspace.kernel.get<any>(
    latest.run.payload.state.slots[0]!.receipt!,
  );
  assert.equal(receipt.payload.state.outcome, "historical");
  assert.ok(receipt.payload.state.media);
  assert.equal(receipt.payload.state.candidate, null);
  assert.equal(s.v.state(s.p.project.id, reference(s.u)).candidates.length, 0);
  assert.equal(s.transport.submissions.length, 1);
  assert.equal(s.transport.polls.length, 0);
  assert.equal(latest.run.payload.state.calls.length, 1);
  assert.ok(
    latest.run.payload.state.slots
      .slice(1)
      .every((a) => a.status === "pending"),
  );
  const restored = await s.reopen();
  assert.equal(
    canonical(restored.workspace.kernel.get(reference(receipt))),
    canonical(receipt),
  );
  assert.equal(
    restored.visual.state(s.p.project.id, reference(s.u)).candidates.length,
    0,
  );
});
test("R2 concurrent explicit reconciliation and delivered receipt are idempotent; conflicting late identity/payload rejects", async (t) => {
  for (const conflict of ["none", "job", "payload"]) {
    const s = await setup(t),
      send = s.transport.submit.bind(s.transport),
      held = controlled<void>(),
      entered = controlled<void>();
    s.transport.submit = async (input) => {
      const ack = await send(input);
      entered.release();
      await held.promise;
      if (conflict === "job") return { ...ack, jobId: "foreign-job" };
      if (conflict === "payload")
        return {
          ...ack,
          result: { ...ack.result!, message: "conflicting payload" },
        };
      return ack;
    };
    const run = await timedRun(s, { maxStatusCalls: 1 });
    const flight = s.e.execute(s.p.project.id, reference(run));
    await entered.promise;
    await flight;
    const reconcile = s.e.reconcile(s.p.project.id, reference(run), 1);
    if (conflict !== "none") await reconcile;
    held.release();
    await reconcile;
    await s.e.waitForDeliveries();
    const state = s.e
      .state(s.p.project.id, reference(s.u))
      .find((e) => e.run.id === run.id)!;
    assert.equal(
      s.app.workspace.kernel
        .latestPackets()
        .filter((p) => (p.payload as any).kind === "raster-execution-receipt")
        .length,
      1,
    );
    assert.equal(s.transport.submissions.length, 1);
    assert.equal(s.transport.polls.length, 1);
    assert.equal(state.run.payload.state.calls.length, 2);
    assert.equal(
      s.v.state(s.p.project.id, reference(s.u)).candidates.length,
      0,
    );
    if (conflict !== "none") assert.ok(state.deliveryErrors.length);
    else assert.deepEqual(state.deliveryErrors, []);
  }
});
test("R2 invalid late media and late failure get independent historical receipts; late rejection is exposed without unhandled rejection", async (t) => {
  for (const outcome of ["invalid", "failed", "rejected"]) {
    const s = await setup(t),
      send = s.transport.submit.bind(s.transport),
      held = controlled<void>();
    s.transport.submit = async (input) => {
      const ack = await send(input);
      await held.promise;
      if (outcome === "rejected") throw new Error("Late transport rejection");
      return {
        ...ack,
        result: {
          ...ack.result!,
          ...(outcome === "invalid"
            ? { bytes: Buffer.from("invalid") }
            : { outcome: "failed" as const, bytes: null }),
          message: "Delayed " + outcome,
        },
      };
    };
    const run = await timedRun(s);
    await s.e.execute(s.p.project.id, reference(run));
    held.release();
    await s.e.waitForDeliveries();
    const state = s.e
      .state(s.p.project.id, reference(s.u))
      .find((e) => e.run.id === run.id)!;
    assert.equal(state.run.payload.state.slots[0]!.status, "uncertain");
    if (outcome === "rejected") {
      assert.equal(state.run.payload.state.slots[0]!.receipt, null);
      assert.equal(state.deliveryErrors[0]!.stage, "transport-rejection");
      assert.equal(state.deliveryErrors[0]!.retryable, false);
    } else {
      const receipt = s.app.workspace.kernel.get<any>(
        state.run.payload.state.slots[0]!.receipt!,
      );
      assert.equal(receipt.payload.state.outcome, "historical");
      assert.equal(receipt.payload.state.media, null);
      assert.match(
        receipt.payload.state.message,
        outcome === "invalid" ? /rejected/ : /Delayed failed/,
      );
    }
    assert.equal(s.transport.submissions.length, 1);
    assert.equal(s.transport.polls.length, 0);
    assert.equal(
      s.v.state(s.p.project.id, reference(s.u)).candidates.length,
      0,
    );
  }
});
test("R2 late asset and transaction storage failure retains response for deliberate no-call retry, not a fabricated invalid receipt", async (t) => {
  for (const failure of ["asset", "transaction"]) {
    const s = await setup(t),
      send = s.transport.submit.bind(s.transport),
      held = controlled<void>();
    s.transport.submit = async (input) => {
      const ack = await send(input);
      await held.promise;
      return ack;
    };
    const run = await timedRun(s);
    await s.e.execute(s.p.project.id, reference(run));
    const save = s.app.workspace.assets.save.bind(s.app.workspace.assets),
      put = s.app.workspace.kernel.putMany.bind(s.app.workspace.kernel);
    if (failure === "asset")
      s.app.workspace.assets.save = () => {
        throw new Error("Injected late asset storage failure");
      };
    else
      s.app.workspace.kernel.putMany = (packets) =>
        put(packets, () => {
          throw new Error("Injected late transaction storage failure");
        });
    held.release();
    await s.e.waitForDeliveries();
    let state = s.e
      .state(s.p.project.id, reference(s.u))
      .find((e) => e.run.id === run.id)!;
    assert.equal(state.run.payload.state.slots[0]!.receipt, null);
    assert.equal(state.deliveryErrors[0]!.stage, "received-intake");
    assert.equal(state.deliveryErrors[0]!.retryable, true);
    assert.match(state.deliveryErrors[0]!.message, /storage failure/);
    s.app.workspace.assets.save = save;
    s.app.workspace.kernel.putMany = put;
    await s.e.retryDelivery(s.p.project.id, reference(run), 1);
    state = s.e
      .state(s.p.project.id, reference(s.u))
      .find((e) => e.run.id === run.id)!;
    assert.ok(state.run.payload.state.slots[0]!.receipt);
    assert.deepEqual(state.deliveryErrors, []);
    assert.equal(s.transport.submissions.length, 1);
    assert.equal(s.transport.polls.length, 0);
    assert.equal(
      s.v.state(s.p.project.id, reference(s.u)).candidates.length,
      0,
    );
  }
});
test("R2 late status result and cancellation confirmation are retained without further calls or outcome mutation", async (t) => {
  const s = await setup(t),
    run = await timedRun(s, { maxStatusCalls: 1, maxCancelCalls: 1 });
  s.transport.mode = "running";
  await s.e.execute(s.p.project.id, reference(run));
  await s.e.waitForDeliveries();
  const status = s.transport.status.bind(s.transport),
    statusHold = controlled<void>();
  s.transport.status = async (job) => {
    const response = await status(job);
    await statusHold.promise;
    return response;
  };
  await s.e.reconcile(s.p.project.id, reference(run), 1);
  statusHold.release();
  await s.e.waitForDeliveries();
  let state = s.e
    .state(s.p.project.id, reference(s.u))
    .find((e) => e.run.id === run.id)!;
  assert.ok(state.run.payload.state.slots[0]!.receipt);
  assert.equal(s.transport.polls.length, 1);
  assert.equal(s.v.state(s.p.project.id, reference(s.u)).candidates.length, 0);
  const t2 = await setup(t),
    r2 = await timedRun(t2, { maxCancelCalls: 1 });
  t2.transport.mode = "running";
  await t2.e.execute(t2.p.project.id, reference(r2));
  await t2.e.waitForDeliveries();
  const cancel = t2.transport.cancel.bind(t2.transport),
    cancelHold = controlled<void>();
  t2.transport.cancel = async (job) => {
    const response = await cancel(job);
    await cancelHold.promise;
    return response;
  };
  await t2.e.cancel(t2.p.project.id, reference(r2), 1);
  const result = [...t2.transport.jobs.values()][0]!.result;
  const receipt = await t2.e.intake(t2.p.project.id, reference(r2), result);
  cancelHold.release();
  await t2.e.waitForDeliveries();
  state = t2.e
    .state(t2.p.project.id, reference(t2.u))
    .find((e) => e.run.id === r2.id)!;
  assert.equal(state.run.payload.state.slots[0]!.cancelConfirmed, true);
  assert.equal(state.run.payload.state.slots[0]!.status, "uncertain");
  assert.equal(
    canonical(t2.app.workspace.kernel.get(reference(receipt))),
    canonical(receipt),
  );
  assert.equal(t2.transport.cancellations.length, 1);
  assert.equal(t2.transport.polls.length, 0);
});
test("R2 service shutdown stops accepting unreceived responses; reopen remains uncertain and non-resending", async (t) => {
  const s = await setup(t),
    send = s.transport.submit.bind(s.transport),
    held = controlled<void>();
  s.transport.submit = async (input) => {
    const ack = await send(input);
    await held.promise;
    return ack;
  };
  const run = await timedRun(s);
  await s.e.execute(s.p.project.id, reference(run));
  await s.e.close();
  const restored = await s.reopen();
  held.release();
  await s.e.waitForDeliveries();
  const state = restored.visual.executions
    .state(s.p.project.id, reference(s.u))
    .find((e) => e.run.id === run.id)!;
  assert.equal(state.run.payload.state.slots[0]!.receipt, null);
  await restored.visual.executions.execute(s.p.project.id, reference(run));
  assert.equal(s.transport.submissions.length, 1);
  assert.equal(
    restored.visual.state(s.p.project.id, reference(s.u)).candidates.length,
    0,
  );
});
test("R2 shutdown drains intake already processing before closing storage and preserves its exact historical receipt", async (t) => {
  const s = await setup(t),
    send = s.transport.submit.bind(s.transport),
    response = controlled<void>(),
    processing = controlled<void>(),
    entered = controlled<void>();
  s.transport.submit = async (input) => {
    const ack = await send(input);
    await response.promise;
    return ack;
  };
  const intake = s.e.intake.bind(s.e);
  s.e.intake = async (...args) => {
    entered.release();
    await processing.promise;
    return intake(...args);
  };
  const run = await timedRun(s);
  await s.e.execute(s.p.project.id, reference(run));
  response.release();
  await entered.promise;
  let closed = false;
  const closing = s.app.close().then(() => {
    closed = true;
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(closed, false);
  processing.release();
  await closing;
  const reopened = await s.reopen();
  const state = reopened.visual.executions
    .state(s.p.project.id, reference(s.u))
    .find((e) => e.run.id === run.id)!;
  assert.ok(state.run.payload.state.slots[0]!.receipt);
  assert.equal(
    reopened.visual.state(s.p.project.id, reference(s.u)).candidates.length,
    0,
  );
  assert.equal(s.transport.submissions.length, 1);
});
