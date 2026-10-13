import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  admissionFixture,
  probeScope,
  probeRequestInput,
  advanceProject,
  admissionRows,
  originalAdmissionProbes,
  type AdmissionFixture,
} from "../scripts/auxiliary-admission-probes.ts";
import { packet, reference, revise, canonical } from "../src/kernel/packets.ts";
import { seedRepairPage } from "../scripts/inference-repair-fixture.ts";
import { pageSignature } from "../src/modules/website/page.ts";
import { ReconstructionFixture } from "../scripts/reconstruction-fixture.ts";
import {
  visualFixture,
  offlineVisualProviders,
} from "../scripts/visual-fixture.ts";
import type {
  Work,
  ReconstructionResult,
} from "../src/modules/website/reconstruction-contracts.ts";
import { startApp } from "../src/service/server.ts";

async function setup(t: test.TestContext) {
  const s = await admissionFixture();
  t.after(() => s.close());
  return s;
}
const request = async (
  s: AdmissionFixture,
  extra: Record<string, unknown> = {},
) =>
  (
    await s.app.reconstruction.prepare(s.p.id, {
      ...probeRequestInput(s),
      ...extra,
    })
  ).request;
const bridge = (s: AdmissionFixture, q: any, timeoutMs = 10000) =>
  s.app.auxiliary.bridge(s.p.id, {
    request: reference(q),
    integrity: q.integrity,
    timeoutMs,
  });
async function send(
  s: AdmissionFixture,
  scope: any,
  text = "Deliberate scoped turn",
) {
  const job = s.app.auxiliary.send(s.p.id, { scope: reference(scope), text });
  await job.completion;
  return job;
}
function damage(s: AdmissionFixture, id: string, mode: string) {
  const db = new DatabaseSync(join(s.root, "kernel.sqlite"));
  try {
    if (mode === "all")
      db.prepare("DELETE FROM kernel_packets WHERE id=?").run(id);
    else if (mode === "latest")
      db.prepare("DELETE FROM kernel_packets WHERE id=? AND version=2").run(id);
    else if (mode === "historical")
      db.prepare("DELETE FROM kernel_packets WHERE id=? AND version=1").run(id);
    else if (mode === "corrupt-all")
      db.prepare("UPDATE kernel_packets SET body='not-json' WHERE id=?").run(
        id,
      );
    else
      db.prepare(
        "UPDATE kernel_packets SET body='{}' WHERE id=? AND version=?",
      ).run(id, mode === "corrupt-latest" ? 2 : 1);
  } finally {
    db.close();
  }
}
async function rejectsUnchanged(
  s: AdmissionFixture,
  action: () => unknown | Promise<unknown>,
  pattern: RegExp,
) {
  const before = admissionRows(s),
    calls = s.driver.calls;
  await assert.rejects(async () => {
    const result: any = await action();
    if (result?.completion) await result.completion;
  }, pattern);
  assert.equal(admissionRows(s), before);
  assert.equal(s.driver.calls, calls);
}

test("R1/R2 exact original reviewer probes reject loss and stale authority without replenishment or writes", async () => {
  const evidence = await originalAdmissionProbes();
  assert.equal(evidence.R1.driverCalls, 1);
  assert.equal(evidence.R2.driverCalls, 0);
  assert.ok(
    evidence.R1.rejectedWritesByteEquivalent &&
      evidence.R2.rejectedWritesByteEquivalent,
  );
});

for (const mode of [
  "all",
  "latest",
  "historical",
  "corrupt-all",
  "corrupt-latest",
  "corrupt-historical",
]) {
  test(`R1 canonical ${mode} turn evidence cannot restore allowance or infer terminal history`, async (t) => {
    const s = await setup(t),
      scope = probeScope(s, 3),
      job = await send(s, scope);
    damage(s, job.turn.id, mode);
    await rejectsUnchanged(
      s,
      () =>
        s.app.auxiliary.send(s.p.id, {
          scope: reference(scope),
          text: "After evidence loss",
        }),
      /history unavailable/,
    );
    assert.equal(s.driver.calls, 1);
    assert.ok(
      s.app.workspace.kernel
        .ledger(s.p.id)
        .events.some((e) => e.subject.id === job.turn.id),
    );
  });
}
test("R1 known empty history and permitted continuation preserve order, bound and explicit Apply", async (t) => {
  const s = await setup(t),
    scope = probeScope(s, 3);
  await send(s, scope, "First");
  await send(s, scope, "Second");
  await send(s, scope, "Third");
  assert.deepEqual(
    s.driver.inputs.map((i) => i.history.length),
    [0, 2, 4],
  );
  assert.deepEqual(
    s.driver.inputs[2].history
      .filter((x: any) => x.role === "user")
      .map((x: any) => x.text),
    ["First", "Second"],
  );
  await rejectsUnchanged(
    s,
    () =>
      s.app.auxiliary.send(s.p.id, {
        scope: reference(scope),
        text: "Exhausted fourth",
      }),
    /Fresh scope/,
  );
  const proposal = s.app.auxiliary
    .state(s.p.id, reference(s.u))
    .proposals.at(-1)!;
  const applied = s.app.auxiliary.action(s.p.id, {
    proposal: reference(proposal),
    session: s.session,
    actionId: "apply",
    decision: "apply",
    expected: s.draft.token,
  });
  assert.equal(applied.action.payload.state.decision, "applied");
  assert.ok(applied.values?.intent);
  assert.throws(
    () =>
      s.app.auxiliary.send(s.p.id, {
        scope: reference(scope),
        text: "Old token cannot continue",
      }),
    /revision|navigation/,
  );
});
test("R1 recoverable immutable turn binding isolates another scope's missing terminal version", async (t) => {
  const s = await setup(t),
    old = probeScope(s, 3),
    first = await send(s, old);
  damage(s, first.turn.id, "latest");
  const fresh = probeScope(s, 1);
  await send(s, fresh);
  assert.equal(s.driver.calls, 2);
  assert.deepEqual(s.driver.inputs[1].history, []);
});
test("R1 wholly unknown history is conservative within its project and does not affect a separate project", async (t) => {
  const s = await setup(t),
    old = probeScope(s, 1),
    first = await send(s, old);
  damage(s, first.turn.id, "all");
  const fresh = probeScope(s, 1);
  await rejectsUnchanged(
    s,
    () =>
      s.app.auxiliary.send(s.p.id, {
        scope: reference(fresh),
        text: "Unknown history is not empty",
      }),
    /history unavailable/,
  );
  const p = s.app.visual.create({ title: "Separate authored project" }).project,
    u = s.app.visual.exploration.createWorkUnit(p.id, {
      version: 1,
      pageType: "homepage",
      label: "Home",
      source: "Authored",
    }),
    c = await s.app.visual.exploration.importCandidate(
      p.id,
      reference(u),
      await visualFixture(1),
      "Synthetic rights",
    ),
    session = s.app.auxiliary.open().session;
  const target = {
      ...s.target,
      session,
      projectId: p.id,
      workUnit: reference(u),
    },
    draft = s.app.auxiliary.observe(p.id, {
      target,
      expected: null,
      values: { intent: "Separate draft" },
    }),
    other = { ...s, p, u, c, session, target, draft };
  await send(other, probeScope(other));
  assert.equal(s.driver.calls, 2);
  assert.deepEqual(s.driver.inputs[1].history, []);
});
test("R1 unknown lost canonical identity is not classified from unrelated evidence or ID text", async (t) => {
  const s = await setup(t),
    note = s.app.memory.saveNote(s.p.id, {
      expected: null,
      note: {
        version: 1,
        scope: reference(s.u),
        text: "Authored unrelated note",
        source: "human-authored",
        evidence: [],
      },
    });
  damage(s, note.id, "all");
  const scope = probeScope(s);
  await rejectsUnchanged(
    s,
    () =>
      s.app.auxiliary.send(s.p.id, {
        scope: reference(scope),
        text: "No inferred history",
      }),
    /history unavailable/,
  );
  assert.equal(s.driver.calls, 0);
});
test("R1 cold reopen with a new explicit UI session cannot reset unknown canonical history", async (t) => {
  const s = await setup(t),
    scope = probeScope(s),
    first = await send(s, scope);
  damage(s, first.turn.id, "all");
  await s.app.close();
  const app = await startApp(s.root, 0, undefined, offlineVisualProviders, {
    auxiliaryFixture: { testOnly: true, driver: s.driver },
  });
  try {
    assert.throws(
      () =>
        app.auxiliary.observe(s.p.id, {
          target: s.target,
          expected: s.draft.token,
          values: { intent: "No draft restoration" },
        }),
      /session unavailable/,
    );
    const session = app.auxiliary.open().session,
      target = { ...s.target, session },
      draft = app.auxiliary.observe(s.p.id, {
        target,
        expected: null,
        values: { intent: "Deliberate new draft" },
      }),
      reopened = { ...s, app, session, target, draft };
    const fresh = probeScope(reopened);
    await rejectsUnchanged(
      reopened,
      () =>
        app.auxiliary.send(s.p.id, {
          scope: reference(fresh),
          text: "New session cannot infer empty history",
        }),
      /history unavailable/,
    );
    assert.equal(s.driver.calls, 1);
  } finally {
    await app.close();
  }
});
test("R1 turn evidence is rechecked inside the admission transaction with complete rollback", async (t) => {
  const s = await setup(t),
    scope = probeScope(s, 3),
    first = await send(s, scope),
    kernel = s.app.workspace.kernel,
    original = kernel.putMany.bind(kernel);
  let afterLoss = "";
  kernel.putMany = (packets, guard) => {
    if (
      (packets[0]?.payload as any)?.kind === "auxiliary-turn" &&
      packets[0]?.version === 1
    ) {
      damage(s, first.turn.id, "latest");
      afterLoss = admissionRows(s);
    }
    return original(packets, guard);
  };
  assert.throws(
    () =>
      s.app.auxiliary.send(s.p.id, {
        scope: reference(scope),
        text: "Admission race",
      }),
    /history unavailable/,
  );
  assert.equal(admissionRows(s), afterLoss);
  assert.equal(s.driver.calls, 1);
});
test("R1 loss during awaited image preparation denies dispatch and retains only truthful failed attempt bookkeeping", async (t) => {
  const s = await setup(t),
    scope = probeScope(s, 3),
    first = await send(s, scope),
    original = s.app.auxiliary.images.bind(s.app.auxiliary);
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  s.app.auxiliary.images = async (facts) => {
    await held;
    return original(facts);
  };
  const second = s.app.auxiliary.send(s.p.id, {
    scope: reference(scope),
    text: "Awaited preparation",
  });
  damage(s, first.turn.id, "historical");
  release();
  await assert.rejects(second.completion, /history unavailable/);
  assert.equal(s.driver.calls, 1);
  const current = s.app.workspace.kernel.get<any>({
    id: second.turn.id,
    version: 2,
    freshness: "pinned",
  });
  assert.equal(current.payload.state.status, "failed");
  assert.deepEqual(current.payload.state.proposals, []);
});

for (const head of ["project", "work-unit", "source", "base", "brand"]) {
  test(`R2 pre-existing stale ${head} head rejects before bridge, driver or semantic writes`, async (t) => {
    const s = await setup(t);
    let base: any = null,
      brand: any = null;
    if (head === "base") base = await seedRepairPage(s.app.pages, s.p.id);
    if (head === "brand") {
      brand = packet({
        id: "approved-admission-brand",
        type: "visual-os",
        approval: "accepted",
        payload: {
          values: {
            approved: { value: "Authored approved value", approved: true },
          },
          placeholders: {},
        },
      });
      s.app.workspace.kernel.put(brand);
    }
    const q = await request(s, {
      base: base ? reference(base) : null,
      baseSignature: base ? pageSignature(base.payload.state) : null,
      brand: brand ? reference(brand) : null,
    });
    const target =
      head === "project"
        ? s.app.workspace.project(s.p.id)
        : head === "work-unit"
          ? s.u
          : head === "source"
            ? s.c
            : head === "base"
              ? base
              : brand;
    s.app.workspace.kernel.put(
      revise(
        target,
        target.payload,
        "synthetic-fixture",
        "Authored next head through normal gate",
      ),
    );
    await rejectsUnchanged(
      s,
      () => bridge(s, q),
      /superseded|current\/pending/,
    );
    assert.equal(s.driver.calls, 0);
  });
}
test("R2 head race across awaited schema preparation rejects with zero attempted bridge writes", async (t) => {
  const s = await setup(t),
    q = await request(s),
    pending = bridge(s, q);
  advanceProject(s);
  const before = admissionRows(s);
  await assert.rejects(pending, /superseded/);
  assert.equal(admissionRows(s), before);
  assert.equal(s.driver.calls, 0);
});
test("R2 image assembly head race is rechecked before atomic bridge admission", async (t) => {
  const s = await setup(t),
    q = await request(s),
    aux = s.app.auxiliary,
    original = aux.bridgeImages.bind(aux);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((r) => (entered = r)),
    held = new Promise<void>((r) => (release = r));
  aux.bridgeImages = async (request) => {
    entered();
    await held;
    return original(request);
  };
  const pending = bridge(s, q);
  await started;
  advanceProject(s);
  const before = admissionRows(s);
  release();
  await assert.rejects(pending, /superseded/);
  assert.equal(admissionRows(s), before);
  assert.equal(s.driver.calls, 0);
});
test("R2 transaction-boundary head race rolls back bridge insertion and releases persistence permit", async (t) => {
  const s = await setup(t),
    q = await request(s),
    kernel = s.app.workspace.kernel,
    original = kernel.putMany.bind(kernel);
  let before = "",
    captured: any;
  kernel.putMany = (packets, guard) => {
    if ((packets[0]?.payload as any)?.kind === "auxiliary-bridge") {
      captured = packets[0];
      advanceProject(s);
      before = admissionRows(s);
    }
    return original(packets, guard);
  };
  await assert.rejects(bridge(s, q), /superseded/);
  assert.equal(admissionRows(s), before);
  assert.equal(s.driver.calls, 0);
  assert.throws(() => kernel.put(captured), /scoped controller authority/);
  assert.equal(admissionRows(s), before);
});
test("R2 cancellation during awaited preparation rejects without an attempted bridge or driver call", async (t) => {
  const s = await setup(t),
    q = await request(s),
    pending = bridge(s, q),
    control = s.app.reconstruction.state(s.p.id, reference(s.u)).control!;
  s.app.reconstruction.cancel(s.p.id, {
    request: reference(q),
    expectedControl: reference(control),
    reason: "Explicit preparation cancellation",
  });
  const before = admissionRows(s);
  await assert.rejects(pending, /superseded/);
  assert.equal(admissionRows(s), before);
  assert.equal(s.driver.calls, 0);
});
test("R2 shutdown during awaited preparation rejects with no new records or transport", async (t) => {
  const s = await setup(t),
    q = await request(s),
    before = admissionRows(s),
    pending = bridge(s, q);
  await s.app.auxiliary.close();
  await assert.rejects(pending, /closing/);
  assert.equal(admissionRows(s), before);
  assert.equal(s.driver.calls, 0);
});
test("R2 expired preparation deadline rejects before writes or driver dispatch", async (t) => {
  const s = await setup(t),
    q = await request(s),
    before = admissionRows(s);
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const pending = bridge(s, q, 50);
  t.mock.timers.tick(100);
  await assert.rejects(pending, /timeout/);
  assert.equal(admissionRows(s), before);
  assert.equal(s.driver.calls, 0);
});
test("R2 final pre-dispatch check rejects authority changed just after admission; no semantic output is stored", async (t) => {
  const s = await setup(t),
    q = await request(s),
    kernel = s.app.workspace.kernel,
    original = kernel.putMany.bind(kernel);
  let once = false;
  kernel.putMany = (packets, guard) => {
    original(packets, guard);
    if (
      !once &&
      (packets[0]?.payload as any)?.kind === "auxiliary-bridge" &&
      packets[0]?.version === 1
    ) {
      once = true;
      advanceProject(s);
    }
  };
  const job = await bridge(s, q);
  await assert.rejects(job.completion, /superseded/);
  assert.equal(s.driver.calls, 0);
  const state = s.app.auxiliary.state(s.p.id, reference(s.u));
  assert.equal(state.bridges[0]!.payload.state.status, "failed");
  assert.equal(state.bridges[0]!.payload.state.result, null);
  assert.equal(
    s.app.reconstruction.state(s.p.id, reference(s.u)).history[0]!.result,
    null,
  );
  assert.deepEqual(kernel.acceptedSelections(s.p.id), []);
});
test("R2 concurrent bridge admission consumes one attempt; lost attempt identity does not restore authority", async (t) => {
  const s = await setup(t),
    q = await request(s),
    first = bridge(s, q),
    second = bridge(s, q);
  const rejected = assert.rejects(second, /already has/);
  await (
    await first
  ).completion;
  await rejected;
  assert.equal(s.driver.calls, 1);
  const b = s.app.auxiliary.state(s.p.id, reference(s.u)).bridges[0]!;
  damage(s, b.id, "all");
  await rejectsUnchanged(
    s,
    () => bridge(s, q),
    /already has|current\/pending|superseded/,
  );
  assert.equal(s.driver.calls, 1);
});
test("R2 current dispatch followed by head supersession retains valid historical intake atomically and cold reopen never replays", async (t) => {
  const s = await setup(t),
    q = await request(s);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((r) => (entered = r)),
    held = new Promise<void>((r) => (release = r));
  s.driver.handler = async (input) => {
    const response = await new ReconstructionFixture().run({
      request: input.request!,
      source: Buffer.alloc(0),
      resources: [],
      signal: input.signal,
    });
    await input.tool("submit_reconstruction", "staged-current", { response });
    entered();
    await held;
    return {
      reply: "Delivered authored historical result",
      provenance: { kind: "authored-test-fixture", generation: false },
    };
  };
  const job = await bridge(s, q);
  await started;
  advanceProject(s);
  release();
  await job.completion;
  const b = s.app.auxiliary.state(s.p.id, reference(s.u)).bridges[0]!;
  assert.equal(b.payload.state.status, "historical");
  const result = s.app.reconstruction.result(s.p.id, b.payload.state.result!);
  assert.equal(result.payload.state.outcome, "historical");
  assert.deepEqual(s.app.workspace.kernel.acceptedSelections(s.p.id), []);
  assert.equal(s.driver.calls, 1);
  await s.app.close();
  const reopened = await startApp(s.root, 0, undefined, offlineVisualProviders);
  try {
    assert.equal(
      reopened.auxiliary.state(s.p.id, reference(s.u)).bridges[0]!.payload.state
        .status,
      "historical",
    );
    assert.equal(reopened.auxiliary.availability().connected, false);
    assert.throws(
      () =>
        reopened.auxiliary.observe(s.p.id, {
          target: s.target,
          expected: s.draft.token,
          values: { intent: "No replay" },
        }),
      /session unavailable/,
    );
  } finally {
    await reopened.close();
  }
});
test("R2 current bridge preserves exact fresh input, paired acceptance and independent semantic export", async (t) => {
  const s = await setup(t),
    q = await request(s);
  await (
    await bridge(s, q)
  ).completion;
  const result = s.app.reconstruction.state(s.p.id, reference(s.u)).history[0]!
      .result! as Work<ReconstructionResult>,
    proposal = result.payload.state.proposals[0]!,
    control = s.app.reconstruction.state(s.p.id, reference(s.u)).control!;
  const accepted = s.app.reconstruction.accept(s.p.id, {
    request: reference(q),
    result: reference(result),
    proposal: proposal.ref,
    reviewedHash: proposal.signature,
    expectedControl: reference(control),
    expectedAcceptance: null,
    reason: "Explicit authored independent acceptance",
    acknowledgeFindings: true,
  });
  const archive = await s.app.pages.export(s.p.id, accepted.accepted);
  assert.ok(archive.bytes.length);
  assert.equal(s.driver.calls, 1);
  assert.deepEqual(s.driver.inputs[0].history, []);
  assert.equal(s.driver.inputs[0].thread.resume, false);
  assert.equal(
    Buffer.from(
      s.driver.inputs[0].images[0].input.url.split(",")[1],
      "base64",
    ).compare(s.app.workspace.assets.read(q.payload.state.source.image.id)),
    0,
  );
});
