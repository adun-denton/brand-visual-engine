import { ChatFixture } from "../scripts/chat-fixture.ts";
import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  cpSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { startApp } from "../src/service/server.ts";
import {
  reference,
  canonical,
  packet,
  digest,
  revise,
} from "../src/kernel/packets.ts";
import { pageSignature } from "../src/modules/website/page.ts";
import { indexDigest } from "../src/modules/website/memory-contracts.ts";
import {
  controlId,
  resultId,
  type Work,
  type ReconstructionRequest,
} from "../src/modules/website/reconstruction-contracts.ts";
import {
  visualFixture,
  offlineVisualProviders,
} from "../scripts/visual-fixture.ts";
import { ReconstructionFixture } from "../scripts/reconstruction-fixture.ts";
import { seedRepairPage } from "../scripts/inference-repair-fixture.ts";
async function setup(t: test.TestContext, fixture = true) {
  const root = mkdtempSync(join(tmpdir(), "bve-reconstruction-test-")),
    driver = new ReconstructionFixture();
  let app = await startApp(
    root,
    0,
    undefined,
    offlineVisualProviders,
    fixture
      ? {
          reconstructionFixture: { testOnly: true, driver },
          aiResponseFixture: true,
        }
      : { aiResponseFixture: true },
  );
  t.after(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });
  const p = app.visual.create({ title: "Synthetic reconstruction" }).project,
    u = app.visual.exploration.createWorkUnit(p.id, {
      version: 1,
      pageType: "homepage",
      label: "Homepage",
      source: "Authored test",
    }),
    about = app.visual.exploration.createWorkUnit(p.id, {
      version: 1,
      pageType: "about",
      label: "About",
      source: "Authored test",
    }),
    c = await app.visual.exploration.importCandidate(
      p.id,
      reference(u),
      await visualFixture(0),
      "Authored synthetic source rights",
    );
  return {
    root,
    app,
    driver,
    p,
    u,
    about,
    c,
    reopen: async (copy = root) => {
      await app.close();
      app = await startApp(copy, 0, undefined, offlineVisualProviders);
      return app;
    },
  };
}
type S = Awaited<ReturnType<typeof setup>>;
const input = (s: S, extra: Record<string, unknown> = {}) => ({
  expectedProject: s.p,
  workUnit: reference(s.u),
  source: reference(s.c),
  integrity: s.c.integrity,
  expectedControl: s.app.reconstruction.state(s.p.id, reference(s.u)).control
    ? reference(s.app.reconstruction.state(s.p.id, reference(s.u)).control!)
    : null,
  instruction: "Reconstruct this exact whole raster; disclose unknowns",
  count: 1,
  viewports: [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ],
  brand: null,
  base: null,
  baseSignature: null,
  resources: [],
  evidence: [],
  ...extra,
});
const snapshot = (s: S) =>
  canonical({
    packets: s.app.workspace.kernel.latestPackets(),
    ledger: s.app.workspace.kernel.ledger(s.p.id),
    accepted: s.app.workspace.kernel.acceptedSelections(s.p.id),
  });
const response = (s: S, q: Work<ReconstructionRequest>) =>
  s.driver.run({
    request: q,
    source: Buffer.alloc(0),
    resources: [],
    signal: new AbortController().signal,
  });
async function apply(s: S, q: Work<ReconstructionRequest>) {
  return s.app.reconstruction.apply(s.p.id, {
    request: reference(q),
    response: await response(s, q),
  });
}
function accept(
  s: S,
  q: Work<ReconstructionRequest>,
  result: any,
  extra: Record<string, unknown> = {},
) {
  const proposal = result.payload.state.proposals[0];
  return s.app.reconstruction.accept(s.p.id, {
    request: reference(q),
    result: reference(result),
    proposal: proposal.ref,
    reviewedHash: proposal.signature,
    expectedControl: reference(
      s.app.reconstruction.state(s.p.id, reference(s.u)).control!,
    ),
    expectedAcceptance: s.app.reconstruction.state(s.p.id, reference(s.u))
      .accepted,
    reason: "Explicit synthetic review",
    acknowledgeFindings: true,
    ...extra,
  });
}

test("count1/count6 prepare/intake/review/export/revise/cold reopen stay chat-closed and media-only", async (t) => {
  const s = await setup(t);
  for (const count of [1, 6]) {
    const q = (await s.app.reconstruction.prepare(s.p.id, input(s, { count })))
      .request;
    assert.equal(q.payload.state.slots.length, count);
    assert.deepEqual(q.payload.state.context, {});
    const { result } = (await s.app.reconstruction.execute(s.p.id, {
      request: reference(q),
    })) as any;
    assert.equal(result.payload.state.proposals.length, count);
    assert.equal(result.payload.state.outcome, "current");
    const before = snapshot(s);
    const replay = await s.app.reconstruction.apply(s.p.id, {
      request: reference(q),
      response: result.payload.state.response,
    });
    assert.equal(replay.duplicate, true);
    assert.equal(snapshot(s), before);
    const accepted = accept(s, q, result);
    const page = s.app.pages.page(s.p.id, accepted.accepted);
    assert.equal(page.provenance.actor, "authored-test-fixture");
    assert.deepEqual(page.dependencies, []);
    assert.deepEqual(page.contextRefs, []);
    const exportBefore = await s.app.pages.export(s.p.id, accepted.accepted);
    assert.ok(exportBefore.bytes.includes(Buffer.from("index.html")));
    const oldRasterSelections = s.app.workspace.kernel.selected(s.p.id, "page");
    const revision = (
      await s.app.reconstruction.prepare(
        s.p.id,
        input(s, {
          base: accepted.accepted,
          baseSignature: pageSignature(page.payload.state),
          count: 1,
        }),
      )
    ).request;
    const revised = (await apply(s, revision)).result;
    assert.notEqual(revised.payload.state.proposals[0]!.ref.id, page.id);
    assert.deepEqual(
      s.app.pages.page(s.p.id, revised.payload.state.proposals[0]!.ref).payload
        .state.context,
      {},
    );
    assert.equal(
      s.app.workspace.kernel.selected(s.p.id, "page"),
      oldRasterSelections,
    );
    assert.equal(s.app.workspace.kernel.selected(s.p.id, "website"), null);
    assert.equal(s.app.chat.state(s.p.id).session.turns.length, 0);
  }
  const q = s.app.reconstruction.request(
      s.p.id,
      s.app.reconstruction.state(s.p.id, reference(s.u)).control!.payload.state
        .request,
    ),
    r = s.app.reconstruction.result(s.p.id, {
      id: resultId(reference(q)),
      version: 1,
      freshness: "pinned",
    });
  const a = accept(s, q, r),
    bytes = (await s.app.pages.export(s.p.id, a.accepted)).bytes;
  await s.app.close();
  const copy = s.root + "-closed-copy";
  cpSync(s.root, copy, { recursive: true });
  const reopened = await s.reopen(copy);
  try {
    assert.equal(reopened.reconstruction.availability().connected, false);
    assert.deepEqual(
      (await reopened.pages.export(s.p.id, a.accepted)).bytes,
      bytes,
    );
    assert.equal(
      reopened.reconstruction.state(s.p.id, reference(s.u)).accepted?.id,
      a.accepted.id,
    );
  } finally {
    await reopened.close();
    rmSync(copy, { recursive: true, force: true });
  }
});

test("Brand off excludes project defaults, base context, chat and notes; explicit approved Brand/evidence is frozen", async (t) => {
  const s = await setup(t);
  const legacy = await seedRepairPage(s.app.pages, s.p.id);
  assert.ok(Object.keys(legacy.payload.state.context).length);
  const note = s.app.memory.saveNote(s.p.id, {
      expected: null,
      note: {
        version: 1,
        scope: reference(s.about),
        text: "Explicit evidence sentinel",
        source: "human-authored",
        evidence: [],
      },
    }),
    brand = packet({
      type: "visual-os",
      id: "approved-reconstruction-brand",
      approval: "accepted",
      payload: {
        values: {
          approved: { value: "Brand approved sentinel", approved: true },
          privateDraft: {
            value: "Excluded Brand draft sentinel",
            approved: false,
          },
        },
        placeholders: {},
      },
    });
  s.app.workspace.kernel.put(brand);
  const historyDriver = new ChatFixture();
  s.app.chat.driver = historyDriver;
  s.app.chat.send({
    projectId: s.p.id,
    clientId: "excluded-history",
    text: "Excluded historical chat sentinel",
    focus: { view: "studio", page: null, resources: [], target: null },
  });
  await Promise.all([...s.app.chat.pending]);
  s.p = reference(s.app.workspace.project(s.p.id));
  const historyBody = s.app.chat.store.db
    .prepare("SELECT body FROM sessions WHERE pid=?")
    .get(s.p.id)!["body"];
  const off = (
    await s.app.reconstruction.prepare(
      s.p.id,
      input(s, {
        base: reference(legacy),
        baseSignature: pageSignature(legacy.payload.state),
      }),
    )
  ).request;
  assert.deepEqual(off.payload.state.context, {});
  assert.ok(
    !canonical(off.payload.state).includes("Excluded historical chat sentinel"),
  );
  assert.equal(historyDriver.calls, 1);
  assert.equal(
    s.app.chat.store.db
      .prepare("SELECT body FROM sessions WHERE pid=?")
      .get(s.p.id)!["body"],
    historyBody,
  );
  assert.ok(
    !canonical(off.payload.state).includes(
      "Request a fictional home-care appointment",
    ),
  );
  assert.ok(
    !canonical(off.payload.state).includes("Explicit evidence sentinel"),
  );
  const on = (
    await s.app.reconstruction.prepare(
      s.p.id,
      input(s, {
        brand: reference(brand),
        evidence: [{ ref: reference(note), integrity: note.integrity }],
      }),
    )
  ).request;
  assert.equal(
    on.payload.state.context["commitments"] &&
      canonical(on.payload.state.context["commitments"]).includes(
        "Brand approved sentinel",
      ),
    true,
  );
  assert.ok(
    !canonical(on.payload.state).includes("Excluded Brand draft sentinel"),
  );
  const before = canonical(on);
  s.app.memory.saveNote(s.p.id, {
    expected: reference(note),
    note: { ...note.payload.state, text: "Later human revision" },
  });
  assert.equal(
    canonical(s.app.reconstruction.request(s.p.id, reference(on))),
    before,
  );
  const { result } = await apply(s, on);
  assert.equal(
    s.app.pages.page(s.p.id, result.payload.state.proposals[0]!.ref).payload
      .state.context["commitments"] &&
      canonical(
        s.app.pages.page(s.p.id, result.payload.state.proposals[0]!.ref).payload
          .state.context,
      ).includes("Brand approved sentinel"),
    true,
  );
});

test("unset count, wrong page/project/integrity, unavailable raster and invented context reject before freezing", async (t) => {
  const s = await setup(t);
  const foreign = s.app.visual.create({ title: "Foreign project" }).project;
  for (const extra of [
    { count: null },
    { count: 0 },
    { count: 7 },
    { workUnit: reference(s.about) },
    { expectedProject: foreign },
    { integrity: "a".repeat(64) },
    { context: { palette: "forged" } },
  ]) {
    const before = snapshot(s);
    await assert.rejects(s.app.reconstruction.prepare(s.p.id, input(s, extra)));
    assert.equal(snapshot(s), before);
  }
  const brokenInput = input(s),
    path = join(s.app.workspace.assets.root, s.c.payload.state.image.id),
    bytes = readFileSync(path);
  writeFileSync(path, Buffer.alloc(bytes.length));
  const before = snapshot(s);
  await assert.rejects(s.app.reconstruction.prepare(s.p.id, brokenInput));
  assert.equal(snapshot(s), before);
  writeFileSync(path, bytes);
});

test("references remain unplaceable; deliberate placeable media is the only output asset closure", async (t) => {
  const s = await setup(t);
  await s.app.pages.addMedia(s.p.id, {
    expectedProject: s.p,
    file: (await visualFixture(1)).toString("base64"),
    origin: null,
    label: "Explicit media",
    role: "placeable",
    permission: "Authored media rights",
  });
  const m = s.app.pages
    .state(s.p.id)
    .media.find((m) => m.payload.state.label === "Explicit media")!;
  let q = (
      await s.app.reconstruction.prepare(
        s.p.id,
        input(s, {
          resources: [
            { media: reference(m), label: "Reference only", role: "reference" },
          ],
        }),
      )
    ).request,
    out = await response(s, q);
  (out.slots[0]!.candidate as any).page.media.hero = "media-1";
  const before = snapshot(s);
  await assert.rejects(
    s.app.reconstruction.apply(s.p.id, {
      request: reference(q),
      response: out,
    }),
    /reference-only/,
  );
  assert.equal(snapshot(s), before);
  q = (
    await s.app.reconstruction.prepare(
      s.p.id,
      input(s, {
        resources: [
          {
            media: reference(m),
            label: "Explicit placement",
            role: "placeable",
          },
        ],
      }),
    )
  ).request;
  const { result } = await apply(s, q),
    a = accept(s, q, result),
    page = s.app.pages.page(s.p.id, a.accepted);
  assert.deepEqual(page.dependencies, [reference(m)]);
  assert.ok(!page.dependencies.some((r) => r.id === s.c.id));
  assert.ok(
    (await s.app.pages.export(s.p.id, a.accepted)).bytes.includes(
      s.app.workspace.assets.read(m.payload.state.image.id),
    ),
  );
  await assert.rejects(
    s.app.reconstruction.prepare(
      s.p.id,
      input(s, {
        resources: [
          {
            media: s.c.payload.state.media,
            label: "Target raster",
            role: "placeable",
          },
        ],
      }),
    ),
    /target raster/,
  );
});

test("malformed second candidate and all binding/slot/provenance errors reject atomically; conflicting receipts reject", async (t) => {
  const s = await setup(t),
    q = (await s.app.reconstruction.prepare(s.p.id, input(s, { count: 2 })))
      .request,
    valid = await response(s, q);
  const variants: any[] = [];
  let bad = structuredClone(valid);
  (bad.slots[1]!.candidate as any).page.root.style = { script: "bad" };
  variants.push(bad);
  bad = structuredClone(valid);
  (bad.slots[1]!.candidate as any).mediaRequirements = [
    { slot: "constructor", instruction: "Absent inherited slot" },
  ];
  variants.push(bad);
  for (const extra of [
    { requestHash: "a".repeat(64) },
    { project: { ...s.p, id: "foreign" } },
    { source: { candidate: reference(s.c), integrity: "a".repeat(64) } },
    { baseSignature: "a".repeat(64) },
    { slots: [valid.slots[0]] },
    { slots: [valid.slots[0], valid.slots[0]] },
    { provenance: { kind: "actual-model", generation: true } },
  ])
    variants.push({ ...valid, ...extra });
  for (const out of variants) {
    const before = snapshot(s);
    await assert.rejects(
      s.app.reconstruction.apply(s.p.id, {
        request: reference(q),
        response: out,
      }),
    );
    assert.equal(snapshot(s), before);
  }
  const { result } = await s.app.reconstruction.apply(s.p.id, {
    request: reference(q),
    response: valid,
  });
  const before = snapshot(s);
  await assert.rejects(
    s.app.reconstruction.apply(s.p.id, {
      request: reference(q),
      response: { ...valid, findings: ["Conflicting reuse"] },
    }),
    /Conflicting/,
  );
  assert.equal(snapshot(s), before);
  assert.equal(result.payload.state.proposals.length, 2);
});

test("cancelled, superseded and source-stale valid results are historical; new explicit operation permits deliberate reuse", async (t) => {
  const s = await setup(t);
  const q = (await s.app.reconstruction.prepare(s.p.id, input(s))).request,
    c = s.app.reconstruction.state(s.p.id, reference(s.u)).control!;
  s.app.reconstruction.cancel(s.p.id, {
    request: reference(q),
    expectedControl: reference(c),
    reason: "Explicit cancellation",
  });
  const historical = (await apply(s, q)).result;
  assert.equal(historical.payload.state.outcome, "historical");
  assert.throws(() => accept(s, q, historical), /stale/);
  assert.equal(
    s.app.reconstruction.state(s.p.id, reference(s.u)).control!.payload.state
      .result,
    null,
  );
  const old = (await s.app.reconstruction.prepare(s.p.id, input(s))).request,
    newer = (await s.app.reconstruction.prepare(s.p.id, input(s))).request;
  const out = (await apply(s, old)).result;
  assert.equal(out.payload.state.outcome, "historical");
  assert.equal(
    s.app.reconstruction.state(s.p.id, reference(s.u)).control!.payload.state
      .request.id,
    newer.id,
  );
  const replaced = await s.app.visual.exploration.importCandidate(
    s.p.id,
    reference(s.u),
    await visualFixture(2),
    "Replacement rights",
    "imported",
    reference(s.c),
  );
  assert.equal(replaced.version, 2);
  const stale = (await apply(s, newer)).result;
  assert.equal(stale.payload.state.outcome, "historical");
  assert.throws(() => accept(s, newer, stale), /stale/);
  const explicit = (await s.app.reconstruction.prepare(s.p.id, input(s)))
    .request;
  assert.equal(explicit.payload.state.source.candidate.version, 1);
  assert.equal(explicit.payload.state.heads.source, 2);
  const fresh = (await apply(s, explicit)).result;
  assert.equal(fresh.payload.state.outcome, "current");
  assert.ok(accept(s, explicit, fresh));
});

test("final-gate races roll back all proposals/receipts; acceptance CAS and review rollback are atomic", async (t) => {
  const s = await setup(t),
    q = (await s.app.reconstruction.prepare(s.p.id, input(s))).request,
    out = await response(s, q),
    original = s.app.workspace.kernel.putMany.bind(s.app.workspace.kernel);
  let afterRace = "";
  s.app.workspace.kernel.putMany = (packets, guard) => {
    if (
      packets.some((p) => (p.payload as any).kind === "reconstruction-result")
    ) {
      const c = s.app.reconstruction.state(s.p.id, reference(s.u)).control!;
      s.app.reconstruction.cancel(s.p.id, {
        request: reference(q),
        expectedControl: reference(c),
        reason: "Concurrent cancel race",
      });
      afterRace = snapshot(s);
    }
    return original(packets, guard);
  };
  await assert.rejects(
    s.app.reconstruction.apply(s.p.id, {
      request: reference(q),
      response: out,
    }),
    /final gate changed/,
  );
  assert.equal(snapshot(s), afterRace);
  s.app.workspace.kernel.putMany = original;
  const next = (await s.app.reconstruction.prepare(s.p.id, input(s))).request,
    { result } = await apply(s, next),
    before = snapshot(s);
  assert.throws(() =>
    accept(s, next, result, { reviewedHash: "a".repeat(64) }),
  );
  assert.throws(
    () => accept(s, next, result, { expectedAcceptance: reference(s.c) }),
    /acceptance changed/,
  );
  assert.equal(snapshot(s), before);
  const kernel = s.app.workspace.kernel as any,
    insert = kernel.insert.bind(kernel);
  kernel.insert = (p: any, port: any) => {
    if (p.payload.kind === "reconstruction-review")
      throw Error("Injected review storage failure");
    return insert(p, port);
  };
  assert.throws(() => accept(s, next, result), /storage failure/);
  assert.equal(snapshot(s), before);
  kernel.insert = insert;
  assert.ok(accept(s, next, result));
});

test("HTTP token/ownership/exact bindings and production unavailability retain zero partial persistence", async (t) => {
  const s = await setup(t),
    session = (await (
      await fetch(s.app.origin + "/api/v1/session")
    ).json()) as any,
    q = (await s.app.reconstruction.prepare(s.p.id, input(s, { count: 2 })))
      .request,
    out = await response(s, q);
  (out.slots[1]!.candidate as any).page.root.children.push({
    id: "bad",
    kind: "link",
    href: "#absent",
    text: "Invalid local link",
  });
  const before = snapshot(s);
  for (const token of ["wrong", session.token]) {
    const response = await fetch(
      s.app.origin + "/api/v1/visual/reconstruction/apply",
      {
        method: "POST",
        headers: {
          Origin: s.app.origin,
          "Content-Type": "application/json",
          "X-BVE-Token": token,
        },
        body: JSON.stringify({
          projectId: s.p.id,
          input: { request: reference(q), response: out },
        }),
      },
    );
    assert.equal(response.status, token === "wrong" ? 403 : 400);
  }
  assert.equal(snapshot(s), before);
  const production = await setup(t, false),
    frozen = (
      await production.app.reconstruction.prepare(
        production.p.id,
        input(production),
      )
    ).request;
  assert.equal(production.app.reconstruction.availability().connected, false);
  await assert.rejects(
    production.app.reconstruction.execute(production.p.id, {
      request: reference(frozen),
    }),
    /unavailable/,
  );
  await assert.rejects(
    production.app.reconstruction.apply(production.p.id, {
      request: reference(frozen),
      response: await response(production, frozen),
    }),
    /unavailable/,
  );
});

test("direct persistence forgeries reject coherent context/source/output changes and reconstruction kind swaps", async (t) => {
  const s = await setup(t),
    q = (await s.app.reconstruction.prepare(s.p.id, input(s))).request;
  const { integrity: _, ...body } = q;
  for (const state of [
    { ...q.payload.state, context: { palette: "Hidden project style" } },
    {
      ...q.payload.state,
      source: { ...q.payload.state.source, integrity: "a".repeat(64) },
    },
    { ...q.payload.state, count: 6 },
  ]) {
    const before = snapshot(s);
    assert.throws(() =>
      s.app.workspace.kernel.put(
        packet({
          ...body,
          id: "forged-" + Math.random().toString(36).slice(2),
          payload: { ...body.payload, state },
        }),
      ),
    );
    assert.equal(snapshot(s), before);
  }
  const before = snapshot(s);
  assert.throws(
    () =>
      s.app.workspace.kernel.put(
        revise(
          q,
          {
            moduleId: "website",
            kind: "project-handoff-note",
            scope: "x",
            lockedValues: {},
            state: {
              version: 1,
              scope: null,
              text: "Kind escape",
              source: "human-authored",
              evidence: [],
            },
          } as any,
          "x",
          "forged kind change",
        ),
      ),
    /kind cannot change/,
  );
  assert.equal(snapshot(s), before);
  const { result } = await apply(s, q),
    afterIntake = snapshot(s),
    { integrity: __, ...rb } = result;
  const wrong = { ...result.payload.state, responseHash: "a".repeat(64) };
  assert.throws(() =>
    s.app.workspace.kernel.put(
      packet({
        ...rb,
        id: "forged-result",
        payload: { ...rb.payload, state: wrong },
      }),
    ),
  );
  assert.equal(snapshot(s), afterIntake);
});

test("memory indexes all reconstruction evidence, rejects coherent omission, retains old capsules and discovers lost primary versions", async (t) => {
  const s = await setup(t),
    old = s.app.memory.createCapsule(s.p.id, {
      scope: reference(s.u),
      previous: null,
    }),
    oldBytes = s.app.memory.download(s.p.id, reference(old)).output,
    q = (await s.app.reconstruction.prepare(s.p.id, input(s))).request,
    { result } = await apply(s, q),
    review = accept(s, q, result).review;
  const index = s.app.memory.index(s.p.id, reference(s.u));
  for (const p of [q, result, review])
    assert.ok(index.entries.some((e) => e.ref.id === p.id));
  assert.equal(s.app.memory.download(s.p.id, reference(old)).output, oldBytes);
  assert.equal(
    s.app.memory.capsule(s.p.id, reference(old)).currency.status,
    "changed",
  );
  const cap = s.app.memory.createCapsule(s.p.id, {
      scope: reference(s.u),
      previous: null,
    }),
    forged = structuredClone(cap.payload.state);
  forged.snapshot.entries = forged.snapshot.entries.filter(
    (e) => e.ref.id !== review.id,
  );
  forged.snapshot.events = forged.snapshot.events.filter(
    (e) => e.subject.id !== review.id,
  );
  forged.snapshot.coverage.entries = forged.snapshot.entries.length;
  forged.snapshot.coverage.events = forged.snapshot.events.length;
  forged.snapshot.digest = indexDigest(forged.snapshot);
  const { integrity: _, ...cb } = cap,
    before = snapshot(s);
  assert.throws(
    () =>
      s.app.workspace.kernel.put(
        packet({
          ...cb,
          id: "forged-reconstruction-capsule",
          dependencies: cap.dependencies.filter((r) => r.id !== review.id),
          payload: { ...cb.payload, state: forged },
        }),
      ),
    /completeness/,
  );
  assert.equal(snapshot(s), before);
  const db = new DatabaseSync(join(s.root, "kernel.sqlite"));
  db.prepare("DELETE FROM kernel_packets WHERE id=?").run(review.id);
  db.close();
  await s.app.close();
  const reopened = await s.reopen();
  assert.ok(
    reopened.memory
      .index(s.p.id, reference(s.u))
      .entries.some((e) => e.ref.id === review.id && e.status === "missing"),
  );
  assert.ok(
    reopened.memory.capsule(s.p.id, reference(cap)).currency.availability
      .missing > 0,
  );
  const fresh = reopened.memory.createCapsule(s.p.id, {
    scope: reference(s.u),
    previous: null,
  });
  assert.equal(
    reopened.memory.capsule(s.p.id, reference(fresh)).currency.status,
    "incomplete",
  );
  assert.equal(
    reopened.memory.download(s.p.id, reference(old)).output,
    oldBytes,
  );
});

test("accepted semantic export stays byte-exact with source raster and Brand unavailable in a closed disposable copy", async (t) => {
  const s = await setup(t),
    brand = packet({
      type: "visual-os",
      id: "export-brand",
      approval: "accepted",
      payload: {
        values: { color: { value: "Approved frozen color", approved: true } },
        placeholders: {},
      },
    });
  s.app.workspace.kernel.put(brand);
  const q = (
      await s.app.reconstruction.prepare(
        s.p.id,
        input(s, { brand: reference(brand) }),
      )
    ).request,
    { result } = await apply(s, q),
    a = accept(s, q, result),
    before = (await s.app.pages.export(s.p.id, a.accepted)).bytes;
  await s.app.close();
  const copy = s.root + "-export-copy";
  cpSync(s.root, copy, { recursive: true });
  const db = new DatabaseSync(join(copy, "kernel.sqlite"));
  db.prepare("DELETE FROM kernel_packets WHERE id IN (?,?)").run(
    s.c.id,
    brand.id,
  );
  db.close();
  const reopened = await s.reopen(copy);
  try {
    assert.deepEqual(
      (await reopened.pages.export(s.p.id, a.accepted)).bytes,
      before,
    );
    const page = reopened.pages.page(s.p.id, a.accepted);
    assert.deepEqual(page.dependencies, []);
    assert.ok(page.payload.state.context["commitments"]);
  } finally {
    await reopened.close();
    rmSync(copy, { recursive: true, force: true });
  }
});

test("two-project/two-page ownership stays exact even when raster bytes are identical", async (t) => {
  const s = await setup(t),
    other = s.app.visual.create({ title: "Second project" }).project,
    unit = s.app.visual.exploration.createWorkUnit(other.id, {
      version: 1,
      pageType: "homepage",
      label: "Second Home",
      source: "Synthetic owner",
    }),
    c = await s.app.visual.exploration.importCandidate(
      other.id,
      reference(unit),
      await visualFixture(0),
      "Second project rights",
    );
  assert.equal(c.payload.state.image.id, s.c.payload.state.image.id);
  const before = snapshot(s);
  await assert.rejects(
    s.app.reconstruction.prepare(
      s.p.id,
      input(s, { source: reference(c), integrity: c.integrity }),
    ),
  );
  assert.equal(snapshot(s), before);
  const q = (
    await s.app.reconstruction.prepare(other.id, {
      ...input(s),
      expectedProject: other,
      workUnit: reference(unit),
      source: reference(c),
      integrity: c.integrity,
      expectedControl: null,
    })
  ).request;
  const out = await response(s, q),
    after = snapshot(s);
  await assert.rejects(
    s.app.reconstruction.apply(s.p.id, {
      request: reference(q),
      response: out,
    }),
    /ownership/,
  );
  assert.equal(snapshot(s), after);
  assert.equal(
    s.app.reconstruction.state(s.p.id, reference(s.about)).history.length,
    0,
  );
});

test("shared preservation locks survive explicit base reconstruction; direct forged output context rolls back atomically", async (t) => {
  const s = await setup(t),
    old = await seedRepairPage(s.app.pages, s.p.id),
    locked = s.app.pages.proposal(s.p.id, {
      ...old.payload.state,
      locks: [
        {
          nodeId: "heading",
          field: "text",
          value: old.payload.state.page.root.children![0]!.text!,
        },
      ],
    });
  s.app.workspace.kernel.put(locked);
  const q = (
      await s.app.reconstruction.prepare(
        s.p.id,
        input(s, {
          base: reference(locked),
          baseSignature: pageSignature(locked.payload.state),
        }),
      )
    ).request,
    bad = await response(s, q);
  (bad.slots[0]!.candidate as any).page.root.children[0].text =
    "Changed locked heading";
  const before = snapshot(s);
  await assert.rejects(
    s.app.reconstruction.apply(s.p.id, {
      request: reference(q),
      response: bad,
    }),
    /preservation|locked|Preserv/,
  );
  assert.equal(snapshot(s), before);
  const good = (await apply(s, q)).result;
  assert.deepEqual(
    s.app.pages.page(s.p.id, good.payload.state.proposals[0]!.ref).payload.state
      .locks,
    locked.payload.state.locks,
  );
  const next = (await s.app.reconstruction.prepare(s.p.id, input(s))).request,
    out = await response(s, next),
    candidate = out.slots[0]!.candidate as any,
    page = s.app.pages.proposal(
      s.p.id,
      {
        page: candidate.page,
        context: { intent: "Forged hidden render context" },
        locks: [],
        rationale: candidate.rationale,
      },
      null,
      "authored-test-fixture",
    ),
    result = packet({
      type: "work-record",
      id: resultId(reference(next)),
      projectId: s.p.id,
      dependencies: [reference(s.u), reference(next), reference(page)],
      payload: {
        moduleId: "website",
        kind: "reconstruction-result",
        scope: "reconstruction",
        lockedValues: {},
        state: {
          version: 1,
          workUnit: reference(s.u),
          request: reference(next),
          requestHash: next.integrity,
          responseHash: digest(out),
          receiptId: out.receiptId,
          outcome: "current",
          proposals: [
            {
              slot: 1,
              ref: reference(page),
              signature: pageSignature(page.payload.state),
            },
          ],
          findings: out.findings,
          response: out,
        },
      },
    });
  const state = snapshot(s);
  assert.throws(
    () => s.app.workspace.kernel.putMany([page, result]),
    /semantic proposal mismatch/,
  );
  assert.equal(snapshot(s), state);
});

test("source-byte loss in final intake gate rejects every proposal and receipt", async (t) => {
  const s = await setup(t),
    q = (await s.app.reconstruction.prepare(s.p.id, input(s))).request,
    out = await response(s, q),
    before = snapshot(s),
    path = join(s.app.workspace.assets.root, s.c.payload.state.image.id),
    bytes = readFileSync(path),
    original = s.app.workspace.kernel.putMany.bind(s.app.workspace.kernel);
  s.app.workspace.kernel.putMany = (packets, guard) => {
    writeFileSync(path, Buffer.alloc(bytes.length));
    return original(packets, guard);
  };
  await assert.rejects(
    s.app.reconstruction.apply(s.p.id, {
      request: reference(q),
      response: out,
    }),
    /unavailable|corrupt/,
  );
  assert.equal(snapshot(s), before);
  s.app.workspace.kernel.putMany = original;
  writeFileSync(path, bytes);
});

test("shutdown aborts an owned offline fixture before HTTP drain and never stores an ignored late delivery", async (t) => {
  const s = await setup(t);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((r) => (entered = r)),
    held = new Promise<void>((r) => (release = r));
  const old = s.driver.run.bind(s.driver);
  s.driver.run = async (args) => {
    entered();
    await held;
    return old({ ...args, signal: new AbortController().signal });
  };
  const q = (await s.app.reconstruction.prepare(s.p.id, input(s))).request,
    job = s.app.reconstruction.execute(s.p.id, { request: reference(q) });
  void job.catch(() => {});
  await started;
  await s.app.close();
  await assert.rejects(job, /stopped/);
  release();
  await new Promise((r) => setTimeout(r, 30));
  const reopened = await s.reopen();
  assert.equal(
    reopened.reconstruction.state(s.p.id, reference(s.u)).control!.payload.state
      .status,
    "pending",
  );
  assert.equal(
    reopened.reconstruction.state(s.p.id, reference(s.u)).history[0]!.result,
    null,
  );
});

test("new preparation/output JSON schemas reuse the unchanged semantic candidate grammar", async (t) => {
  const { Ajv2020 } = await import("ajv/dist/2020.js"),
    { reconstructionPreparationSchema, reconstructionOutputSchema } =
      await import("../src/modules/website/reconstruction-schemas.ts"),
    ajv = new Ajv2020({ strict: false }),
    prepare = ajv.compile(reconstructionPreparationSchema),
    result = ajv.compile(reconstructionOutputSchema),
    s = await setup(t),
    payload = input(s);
  assert.equal(prepare(payload), true, JSON.stringify(prepare.errors));
  const q = (await s.app.reconstruction.prepare(s.p.id, payload)).request,
    out = await response(s, q);
  assert.equal(result(out), true, JSON.stringify(result.errors));
  assert.equal(prepare({ ...payload, count: null }), false);
  assert.equal(
    prepare({ ...payload, context: { palette: "Forbidden override" } }),
    false,
  );
  const bad = structuredClone(out);
  (bad.slots[0]!.candidate as any).page.root.style = {
    padding: "repeat(3,1fr)",
  };
  assert.equal(result(bad), false);
});

test("direct kernel reconstruction acceptance cannot bypass the atomic review boundary", async (t) => {
  const s = await setup(t),
    q = (await s.app.reconstruction.prepare(s.p.id, input(s))).request,
    { result } = await apply(s, q),
    before = snapshot(s);
  assert.throws(
    () =>
      s.app.workspace.kernel.accept(
        s.p.id,
        "reconstruction:" + s.u.id,
        result.payload.state.proposals[0]!.ref,
        null,
        "operator",
        "Bypass attempt",
      ),
    /atomic bound review/,
  );
  assert.equal(snapshot(s), before);
  const { review, accepted } = accept(s, q, result);
  const after = snapshot(s);
  assert.throws(
    () =>
      s.app.workspace.kernel.accept(
        s.p.id,
        "reconstruction:" + s.about.id,
        accepted,
        null,
        "operator",
        "Misbound review",
        null,
        undefined,
        {
          mirror: { slot: "page:" + accepted.id, expected: accepted },
          records: [review],
        },
      ),
    /atomic bound review/,
  );
  assert.equal(snapshot(s), after);
});

test("ledger-known lost reconstruction control cannot fall back or reuse a canonical version", async (t) => {
  const s = await setup(t),
    q = (await s.app.reconstruction.prepare(s.p.id, input(s))).request;
  const { result } = await apply(s, q);
  const control = s.app.reconstruction.state(s.p.id, reference(s.u)).control!;
  assert.equal(control.version, 2);
  const retry = input(s);
  await s.app.close();
  const db = new DatabaseSync(join(s.root, "kernel.sqlite"));
  db.prepare("DELETE FROM kernel_packets WHERE id=? AND version=?").run(
    control.id,
    control.version,
  );
  db.close();
  const reopened = await s.reopen();
  assert.throws(
    () => reopened.reconstruction.state(s.p.id, reference(s.u)),
    /control history unavailable/,
  );
  await assert.rejects(
    reopened.reconstruction.prepare(s.p.id, {
      ...retry,
      expectedControl: reference(control),
    }),
    /control history unavailable/,
  );
  const before = canonical(reopened.workspace.kernel.ledger(s.p.id));
  assert.throws(
    () => reopened.workspace.kernel.put(control),
    /Lost reconstruction canonical version/,
  );
  assert.equal(canonical(reopened.workspace.kernel.ledger(s.p.id)), before);
  assert.ok(reopened.workspace.kernel.get(reference(result)));
});
