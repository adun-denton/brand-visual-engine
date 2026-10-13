import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  cpSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { startApp } from "../src/service/server.ts";
import {
  reference,
  canonical,
  packet,
  digest,
  revise,
} from "../src/kernel/packets.ts";
import { AuxiliaryFixture } from "../scripts/auxiliary-fixture.ts";
import {
  visualFixture,
  offlineVisualProviders,
} from "../scripts/visual-fixture.ts";
import { seedRepairPage } from "../scripts/inference-repair-fixture.ts";
import { pageSignature } from "../src/modules/website/page.ts";
import { indexDigest } from "../src/modules/website/memory-contracts.ts";
async function setup(t: test.TestContext, fixture = true) {
  const root = mkdtempSync(join(tmpdir(), "bve-aux-test-")),
    driver = new AuxiliaryFixture();
  let app = await startApp(
    root,
    0,
    undefined,
    offlineVisualProviders,
    fixture ? { auxiliaryFixture: { testOnly: true, driver } } : undefined,
  );
  t.after(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });
  const p = app.visual.create({ title: "Synthetic auxiliary" }).project,
    u = app.visual.exploration.createWorkUnit(p.id, {
      version: 1,
      pageType: "homepage",
      label: "Home",
      source: "Authored",
    }),
    otherUnit = app.visual.exploration.createWorkUnit(p.id, {
      version: 1,
      pageType: "about",
      label: "About",
      source: "Authored",
    }),
    c = await app.visual.exploration.importCandidate(
      p.id,
      reference(u),
      await visualFixture(0),
      "Synthetic rights",
    ),
    session = app.auxiliary.open().session;
  const target = {
    session,
    projectId: p.id,
    workUnit: reference(u),
    kind: "variation" as const,
    key: "page",
  };
  const d = app.auxiliary.observe(p.id, {
    target,
    expected: null,
    values: { intent: "Original user intent" },
  });
  return {
    root,
    driver,
    app,
    p,
    u,
    otherUnit,
    c,
    session,
    target,
    d,
    reopen: async () => {
      await app.close();
      app = await startApp(root, 0, undefined, offlineVisualProviders);
      return app;
    },
  };
}
type S = Awaited<ReturnType<typeof setup>>;
const freeze = (s: S, extra: Record<string, unknown> = {}) =>
  s.app.auxiliary.freeze(s.p.id, {
    project: reference(s.p),
    focus: {
      kind: "visual-page",
      unit: reference(s.u),
      raster: { ref: reference(s.c), integrity: s.c.integrity },
      region: null,
    },
    brand: null,
    references: [],
    evidence: [],
    target: s.target,
    draft: s.d.token,
    editable: ["intent"],
    ttlMs: 60000,
    limits: {
      turns: 3,
      tools: 8,
      proposals: 4,
      timeoutMs: 10000,
      automaticRetry: false,
    },
    ...extra,
  });
const design = (s: S) =>
  canonical({
    packets: s.app.workspace.kernel
      .latestPackets()
      .filter((p) => !(p.payload as any).kind?.startsWith("auxiliary-")),
    selections: s.app.workspace.kernel.acceptedSelections(s.p.id),
    events: s.app.workspace.kernel
      .ledger(s.p.id)
      .events.filter((e) => !e.subject.id.startsWith("auxiliary-")),
  });
async function send(s: S, scope = freeze(s)) {
  const turn = s.app.auxiliary.send(s.p.id, {
    scope: reference(scope),
    text: "Suggest a clearer draft",
  });
  await turn.completion;
  const state = s.app.auxiliary.state(s.p.id, reference(s.u));
  return { scope, turn, state, proposal: state.proposals.at(-1)! };
}
const action = (s: S, p: any, extra: Record<string, unknown> = {}) =>
  s.app.auxiliary.action(s.p.id, {
    proposal: reference(p),
    session: s.session,
    actionId: "user-action",
    decision: "apply",
    expected: s.d.token,
    ...extra,
  });
const reconInput = (s: S) => ({
  expectedProject: s.p,
  workUnit: reference(s.u),
  source: reference(s.c),
  integrity: s.c.integrity,
  expectedControl: null,
  instruction: "Reconstruct exact whole raster",
  count: 2,
  viewports: [{ width: 1440, height: 1000 }],
  brand: null,
  base: null,
  baseSignature: null,
  resources: [],
  evidence: [],
});
test("auxiliary proposes only; explicit Apply affects ephemeral named draft, idempotent action and cold reopen never restore it", async (t) => {
  const s = await setup(t),
    before = design(s);
  const { proposal } = await send(s);
  assert.equal(design(s), before);
  assert.equal(proposal.payload.state.edits[0].before, "Original user intent");
  assert.equal(s.driver.calls, 1);
  const applied = action(s, proposal);
  assert.equal(applied.action.payload.state.decision, "applied");
  assert.match(String(applied.values!.intent), /hierarchy/);
  assert.equal(design(s), before);
  assert.equal(action(s, proposal).replayed, true);
  assert.throws(
    () => action(s, proposal, { decision: "dismiss" }),
    /Conflicting/,
  );
  const reopened = await s.reopen();
  assert.equal(
    reopened.auxiliary.state(s.p.id, reference(s.u)).draftRestoration,
    false,
  );
  assert.throws(
    () =>
      reopened.auxiliary.observe(s.p.id, {
        target: s.target,
        expected: applied.action.payload.state.result,
        values: { intent: "forged old snapshot" },
      }),
    /session unavailable/,
  );
  assert.equal(
    reopened.auxiliary.state(s.p.id, reference(s.u)).actions.length,
    1,
  );
});
test("draft N cannot overwrite N+1; old snapshot cannot reset token; navigation cannot redirect a proposal", async (t) => {
  const s = await setup(t),
    { proposal } = await send(s),
    before = design(s);
  const newDraft = s.app.auxiliary.observe(s.p.id, {
    target: s.target,
    expected: s.d.token,
    values: { intent: "Newer user edit" },
  });
  assert.throws(
    () =>
      s.app.auxiliary.observe(s.p.id, {
        target: s.target,
        expected: s.d.token,
        values: { intent: "Old snapshot" },
      }),
    /revision changed/,
  );
  assert.equal(action(s, proposal).action.payload.state.decision, "conflict");
  s.app.auxiliary.navigate(s.session, {
    ...s.target,
    workUnit: reference(s.otherUnit),
  });
  assert.equal(
    action(s, proposal, { actionId: "navigation", expected: newDraft.token })
      .action.payload.state.decision,
    "conflict",
  );
  assert.equal(design(s), before);
});
test("typed raster/semantic/operation focus rejects owner/hash/unit/region mismatches; Brand off excludes old context and history", async (t) => {
  const s = await setup(t),
    before = design(s);
  for (const focus of [
    {
      kind: "visual-page",
      unit: reference(s.otherUnit),
      raster: { ref: reference(s.c), integrity: s.c.integrity },
      region: null,
    },
    {
      kind: "visual-page",
      unit: reference(s.u),
      raster: { ref: reference(s.c), integrity: "f".repeat(64) },
      region: null,
    },
    {
      kind: "visual-page",
      unit: reference(s.u),
      raster: null,
      region: {
        selections: reference(s.u),
        integrity: s.u.integrity,
        entryId: "region",
      },
    },
    {
      kind: "semantic-page",
      unit: reference(s.u),
      page: reference(s.c),
      integrity: s.c.integrity,
      signature: "f".repeat(64),
      placement: null,
    },
  ])
    assert.throws(() => freeze(s, { focus }));
  assert.equal(design(s), before);
  const legacy = await seedRepairPage(s.app.pages, s.p.id);
  const original = s.app.pages.proposal(s.p.id, {
    ...legacy.payload.state,
    context: { palette: ["OLD_CONTEXT_SENTINEL"] },
  });
  s.app.workspace.kernel.put(original);
  const scope = freeze(s, {
    focus: {
      kind: "semantic-page",
      unit: reference(s.u),
      page: reference(original),
      integrity: original.integrity,
      signature: pageSignature(original.payload.state),
      placement: null,
    },
  });
  assert.ok(
    !canonical(scope.payload.state.context).includes("OLD_CONTEXT_SENTINEL"),
  );
  assert.deepEqual((scope.payload.state.context as any).brand, {
    enabled: false,
  });
});
test("separate runtime allowlists reject legacy tools, aliases, unexpected arguments and unsupported draft fields without proposals/design writes", async (t) => {
  for (const [name, args] of [
    ["update_draft", { brief: { intent: "forged" } }],
    ["functions.update_draft", {}],
    ["focus_candidate", {}],
    ["accept", {}],
    ["image-run", {}],
    ["read_context", {}],
    ["read_scope", { project: "foreign" }],
    [
      "propose_edit",
      { edits: [{ field: "brand", after: true }], rationale: "Unauthorized" },
    ],
  ]) {
    const s = await setup(t),
      before = design(s);
    s.driver.handler = async (input) => {
      await input.tool(name as string, "forged", args);
      return {
        reply: "invalid",
        provenance: { kind: "authored-test-fixture", generation: false },
      };
    };
    const job = s.app.auxiliary.send(s.p.id, {
      scope: reference(freeze(s)),
      text: "Probe",
    });
    await assert.rejects(job.completion);
    assert.equal(
      s.app.auxiliary.state(s.p.id, reference(s.u)).proposals.length,
      0,
    );
    assert.equal(design(s), before);
  }
});
test("explicit requested Level1/2 and reconstruction draft fields support bounded proposals; unsupported edits reject without filtering", async (t) => {
  const s = await setup(t);
  s.d = s.app.auxiliary.observe(s.p.id, {
    target: s.target,
    expected: s.d.token,
    values: {
      intent: "Original",
      "level1:spacing": 4,
      "level2:visual-density": 5,
    },
  });
  s.driver.handler = async (input) => {
    await input.tool("propose_edit", "edits", {
      edits: [
        { field: "level1:spacing", after: 8 },
        { field: "level2:visual-density", after: 6 },
      ],
      rationale: "Explicit requested tuning",
    });
    return {
      reply: "Proposal only",
      provenance: { kind: "authored-test-fixture", generation: false },
    };
  };
  const { proposal } = await send(
    s,
    freeze(s, {
      editable: ["intent", "level1:spacing", "level2:visual-density"],
    }),
  );
  const applied = action(s, proposal);
  assert.equal(applied.values!["level1:spacing"], 8);
  s.d.token = applied.action.payload.state.result!;
  assert.throws(() => freeze(s, { editable: ["direction"] }), /Unsupported/);
});
test("exact authorized evidence reads and explicit Brand snapshot are bounded; foreign/missing evidence stays unavailable", async (t) => {
  const s = await setup(t),
    note = s.app.memory.saveNote(s.p.id, {
      expected: null,
      note: {
        version: 1,
        scope: reference(s.u),
        text: "Explicit supported note",
        source: "human-authored",
        evidence: [],
      },
    });
  const scope = freeze(s, {
    evidence: [{ ref: reference(note), integrity: note.integrity }],
  });
  s.driver.handler = async (input) => {
    const e = (await input.tool("read_evidence", "read-note", {
      ref: reference(note),
      integrity: note.integrity,
    })) as any;
    assert.equal(e.summary.text, "Explicit supported note");
    await assert.rejects(
      input.tool("read_evidence", "foreign", {
        ref: reference(s.c),
        integrity: s.c.integrity,
      }),
      /not authorized/,
    );
    return {
      reply: "caught invalid",
      provenance: { kind: "authored-test-fixture", generation: false },
    };
  };
  const job = s.app.auxiliary.send(s.p.id, {
    scope: reference(scope),
    text: "Read explicit note",
  });
  await assert.rejects(job.completion, /not authorized/);
  assert.equal(
    s.app.auxiliary.state(s.p.id, reference(s.u)).proposals.length,
    0,
  );
});
test("offline bridge uses fresh exact image input, canonical semantic schema and atomic V07 result/evidence; acceptance pair remains protected", async (t) => {
  const s = await setup(t);
  await s.app.pages.addMedia(s.p.id, {
    expectedProject: s.p,
    file: (await visualFixture(1)).toString("base64"),
    origin: null,
    label: "Explicit auxiliary media",
    role: "placeable",
    permission: "Authored synthetic rights",
  });
  const media = s.app.pages
    .state(s.p.id)
    .media.find((m) => m.payload.state.label === "Explicit auxiliary media")!;
  await s.app.pages.addMedia(s.p.id, {
    expectedProject: s.p,
    file: (await visualFixture(2)).toString("base64"),
    origin: null,
    label: "Second auxiliary media",
    role: "placeable",
    permission: "Authored synthetic rights",
  });
  const secondMedia = s.app.pages
    .state(s.p.id)
    .media.find((m) => m.payload.state.label === "Second auxiliary media")!;
  const q = (
    await s.app.reconstruction.prepare(s.p.id, {
      ...reconInput(s),
      resources: [
        {
          media: reference(media),
          label: "First reference",
          role: "reference",
        },
        {
          media: reference(secondMedia),
          label: "Second placement",
          role: "placeable",
        },
      ],
    })
  ).request;
  const before = design(s),
    job = await s.app.auxiliary.bridge(s.p.id, {
      request: reference(q),
      integrity: q.integrity,
      timeoutMs: 10000,
    });
  await job.completion;
  const state = s.app.reconstruction.state(s.p.id, reference(s.u)),
    result = state.history[0]!.result! as any;
  assert.equal(result.payload.state.outcome, "current");
  assert.equal(s.driver.inputs[0].thread.id, q.id);
  assert.equal(s.driver.inputs[0].thread.resume, false);
  assert.deepEqual(s.driver.inputs[0].history, []);
  assert.deepEqual(
    s.driver.inputs[0].images.map((i: any) => i.role),
    ["source", "reference", "placeable"],
  );
  assert.deepEqual(
    s.driver.inputs[0].images.slice(1).map((i: any) => i.label),
    ["First reference", "Second placement"],
  );
  for (const [index, i] of s.driver.inputs[0].images.slice(1).entries())
    assert.deepEqual(
      Buffer.from(i.input.url.split(",")[1], "base64"),
      s.app.workspace.assets.read(
        (index === 0 ? media : secondMedia).payload.state.image.id,
      ),
    );
  assert.deepEqual(s.driver.inputs[0].tools, [
    "read_scope",
    "read_evidence",
    "submit_reconstruction",
  ]);
  assert.deepEqual(
    Buffer.from(s.driver.inputs[0].images[0].input.url.split(",")[1], "base64"),
    s.app.workspace.assets.read(q.payload.state.source.image.id),
  );
  const bridge = s.app.auxiliary.state(s.p.id, reference(s.u)).bridges[0]!;
  assert.equal(bridge.payload.state.result.id, result.id);
  assert.equal(bridge.payload.state.status, "completed");
  assert.equal(result.payload.state.response.provenance.generation, false);
  await assert.rejects(
    s.app.auxiliary.bridge(s.p.id, {
      request: reference(q),
      integrity: q.integrity,
      timeoutMs: 10000,
    }),
    /already has/,
  );
  const proposal = result.payload.state.proposals[0]!.ref;
  assert.throws(
    () =>
      s.app.workspace.kernel.accept(
        s.p.id,
        "page:" + proposal.id,
        proposal,
        null,
        "operator",
        "Reversed bridge probe",
        null,
        undefined,
        {
          mirror: { slot: "reconstruction:" + s.u.id, expected: null },
          records: [],
        },
      ),
    /reconstruction primary/,
  );
  assert.notEqual(design(s), before);
});
test("wrong bridge submission binding rejects every semantic proposal/result and companion evidence", async (t) => {
  const s = await setup(t),
    q = (await s.app.reconstruction.prepare(s.p.id, reconInput(s))).request;
  const { ReconstructionFixture } = await import(
    "../scripts/reconstruction-fixture.ts"
  );
  s.driver.handler = async (input) => {
    const response = await new ReconstructionFixture().run({
      request: q,
      source: Buffer.alloc(0),
      resources: [],
      signal: input.signal,
    });
    response.requestHash = "f".repeat(64);
    await input.tool("submit_reconstruction", "bad", { response });
    return {
      reply: "Bad binding",
      provenance: { kind: "authored-test-fixture", generation: false },
    };
  };
  const before = design(s),
    job = await s.app.auxiliary.bridge(s.p.id, {
      request: reference(q),
      integrity: q.integrity,
      timeoutMs: 10000,
    });
  await assert.rejects(job.completion, /mismatch/);
  assert.equal(design(s), before);
  assert.equal(
    s.app.reconstruction.state(s.p.id, reference(s.u)).history[0]!.result,
    null,
  );
  assert.equal(
    s.app.auxiliary.state(s.p.id, reference(s.u)).bridges[0]!.payload.state
      .status,
    "failed",
  );
});
test("direct persistence forged scope/proposal/action kinds cannot acquire controller write authority", async (t) => {
  const s = await setup(t),
    { scope, proposal } = await send(s),
    applied = action(s, proposal).action,
    before = gateRows(s);
  for (const source of [scope, proposal, applied]) {
    const { integrity: _, ...body } = source;
    const forged = packet({ ...body, id: "forged-" + source.payload.kind });
    assert.throws(
      () => s.app.workspace.kernel.put(forged),
      /scoped controller authority/,
    );
    assert.equal(gateRows(s), before);
  }
});

async function until(check: () => boolean) {
  const expires = Date.now() + 4000;
  while (!check()) {
    if (Date.now() > expires)
      throw Error("Bounded fixture outcome not observed");
    await new Promise((r) => setTimeout(r, 15));
  }
}
function gateRows(s: S) {
  const db = new DatabaseSync(join(s.root, "kernel.sqlite"), {
    readOnly: true,
  });
  try {
    return JSON.stringify({
      packets: db
        .prepare("SELECT body FROM kernel_packets ORDER BY id,version")
        .all(),
      events: db
        .prepare("SELECT body FROM kernel_events ORDER BY project_id,sequence")
        .all(),
      selections: db
        .prepare("SELECT body FROM kernel_selections ORDER BY project_id,slot")
        .all(),
    });
  } finally {
    db.close();
  }
}
const note = (s: S, text: string) =>
  s.app.memory.saveNote(s.p.id, {
    expected: null,
    note: {
      version: 1,
      scope: reference(s.u),
      text,
      source: "human-authored",
      evidence: [],
    },
  });
test("two-project/page focus and scoped rectangle pin exact source/geometry; corrupt bytes reject before driver or scope write", async (t) => {
  const s = await setup(t),
    foreign = s.app.visual.create({ title: "Foreign" }).project,
    fu = s.app.visual.exploration.createWorkUnit(foreign.id, {
      version: 1,
      pageType: "homepage",
      label: "Foreign Home",
      source: "Authored",
    }),
    fc = await s.app.visual.exploration.importCandidate(
      foreign.id,
      reference(fu),
      await visualFixture(0),
      "Other synthetic rights",
    );
  const before = gateRows(s);
  assert.throws(
    () =>
      freeze(s, {
        focus: {
          kind: "visual-page",
          unit: reference(s.u),
          raster: { ref: reference(fc), integrity: fc.integrity },
          region: null,
        },
      }),
    /owner|page/,
  );
  assert.equal(gateRows(s), before);
  const selections = s.app.visual.exploration.selections(s.p.id, {
    version: 1,
    workUnit: reference(s.u),
    entries: [
      {
        id: "bounded-region",
        candidate: reference(s.c),
        integrity: s.c.integrity,
        image: s.c.payload.state.image,
        orientation: "encoded-top-left",
        coordinates: "normalized-original",
        anchor: { kind: "rectangle", x: 0.2, y: 0.3, width: 0.4, height: 0.25 },
        intent: "inspiration",
        preservation: null,
        notes: [],
      },
    ],
  });
  const focus = {
    kind: "visual-page",
    unit: reference(s.u),
    raster: { ref: reference(s.c), integrity: s.c.integrity },
    region: {
      selections: reference(selections),
      integrity: selections.integrity,
      entryId: "bounded-region",
    },
  };
  const scope = freeze(s, { focus });
  const region = (scope.payload.state.context as any).focus.region;
  assert.equal(region.cropped, false);
  assert.equal(region.referenceOnly, true);
  assert.deepEqual(region.anchor, {
    kind: "rectangle",
    x: 0.2,
    y: 0.3,
    width: 0.4,
    height: 0.25,
  });
  const path = join(s.app.workspace.assets.root, s.c.payload.state.image.id),
    bytes = readFileSync(path);
  writeFileSync(path, Buffer.alloc(bytes.length));
  const damaged = gateRows(s);
  assert.throws(() => freeze(s, { focus }), /unavailable|corrupt/);
  assert.equal(gateRows(s), damaged);
  assert.equal(s.driver.calls, 0);
  writeFileSync(path, bytes);
});
test("Brand off, excluded real legacy fixture history and unrelated notes never enter context; explicit approved values/media order freeze exactly", async (t) => {
  const s = await setup(t);
  const { ChatFixture } = await import("../scripts/chat-fixture.ts");
  s.app.chat.driver = new ChatFixture();
  s.app.chat.send({
    projectId: s.p.id,
    clientId: "excluded-legacy",
    text: "LEGACY_HISTORY_SENTINEL",
    focus: { view: "studio", page: null, resources: [], target: null },
  });
  await Promise.all([...s.app.chat.pending]);
  s.p = reference(s.app.workspace.project(s.p.id));
  note(s, "UNRELATED_NOTE_SENTINEL");
  const brand = packet({
    type: "visual-os",
    id: "aux-approved-brand",
    approval: "accepted",
    payload: {
      values: {
        palette: { value: ["Explicit approved color"], approved: true },
        unapproved: { value: "UNAPPROVED_BRAND_SENTINEL", approved: false },
      },
      placeholders: {},
    },
  });
  s.app.workspace.kernel.put(brand);
  const m = await s.app.pages.addMedia(s.p.id, {
    expectedProject: reference(s.app.workspace.project(s.p.id)),
    file: (await visualFixture(1)).toString("base64"),
    origin: null,
    label: "Explicit reference",
    role: "reference",
    permission: "Synthetic rights",
  });
  const media = s.app.pages.state(s.p.id).media.at(-1)!;
  const off = freeze(s);
  const body = canonical(off.payload.state.context);
  for (const sentinel of [
    "LEGACY_HISTORY_SENTINEL",
    "UNRELATED_NOTE_SENTINEL",
    "UNAPPROVED_BRAND_SENTINEL",
  ])
    assert.ok(!body.includes(sentinel));
  const on = freeze(s, {
    brand: { ref: reference(brand), integrity: brand.integrity },
    references: [
      {
        ref: reference(media),
        integrity: media.integrity,
        label: "Reference only",
      },
    ],
  });
  await send(s, on);
  const input = s.driver.inputs.at(-1);
  assert.deepEqual(input.context.brand.values, {
    palette: ["Explicit approved color"],
  });
  assert.equal(input.images.length, 2);
  assert.equal(input.images[1].role, "explicit-reference");
  assert.deepEqual(
    Buffer.from(input.images[1].input.url.split(",")[1], "base64"),
    s.app.workspace.assets.read(media.payload.state.image.id),
  );
  assert.deepEqual(input.history, []);
  assert.equal(input.thread.resume, false);
  assert.ok(!canonical(input).includes("LEGACY_HISTORY_SENTINEL"));
  assert.ok(m);
});
test("exact evidence reports historical and missing primary state; dated capsules authorize no hidden content dump", async (t) => {
  const s = await setup(t),
    n = note(s, "First exact note"),
    next = s.app.memory.saveNote(s.p.id, {
      expected: reference(n),
      note: { ...n.payload.state, text: "New note revision" },
    });
  const scope = freeze(s, {
    evidence: [{ ref: reference(n), integrity: n.integrity }],
  });
  const entry = (scope.payload.state.context as any).evidence[0];
  assert.equal(entry.currency, "historical-or-unavailable");
  assert.equal(entry.summary.text, "First exact note");
  const cap = s.app.memory.createCapsule(s.p.id, {
    scope: reference(s.u),
    previous: null,
  });
  const capsuleScope = freeze(s, {
    evidence: [{ ref: reference(cap), integrity: cap.integrity }],
  });
  const summary = (capsuleScope.payload.state.context as any).evidence[0]
    .summary;
  assert.equal(summary.datedEvidence, true);
  assert.ok(!canonical(summary).includes("First exact note"));
  const db = new DatabaseSync(join(s.root, "kernel.sqlite"));
  db.prepare("DELETE FROM kernel_packets WHERE id=? AND version=?").run(
    n.id,
    n.version,
  );
  db.close();
  const missing = freeze(s, {
    evidence: [{ ref: reference(n), integrity: n.integrity }],
  });
  assert.equal(
    (missing.payload.state.context as any).evidence[0].status,
    "missing",
  );
  assert.equal(
    (missing.payload.state.context as any).evidence[0].summary,
    null,
  );
  assert.equal(next.version, 2);
});
test("cancel/timeout retain valid staged proposals historically, deny later tool rounds, and expired scopes cannot authorize a retry", async (t) => {
  for (const timeout of [false, true]) {
    const s = await setup(t);
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((r) => (entered = r)),
      held = new Promise<void>((r) => (release = r));
    let tools: any;
    s.driver.handler = async (input) => {
      tools = input.tool;
      await input.tool("propose_edit", "staged", {
        edits: [{ field: "intent", after: "Late authored proposal" }],
        rationale: "Already scoped before cancellation",
      });
      entered();
      await held;
      return {
        reply: "Late valid fixture",
        provenance: { kind: "authored-test-fixture", generation: false },
      };
    };
    const before = design(s),
      scope = freeze(s, {
        focus: {
          kind: "visual-page",
          unit: reference(s.u),
          raster: null,
          region: null,
        },
        limits: {
          turns: 1,
          tools: 8,
          proposals: 4,
          timeoutMs: timeout ? 300 : 10000,
          automaticRetry: false,
        },
      }),
      job = s.app.auxiliary.send(s.p.id, {
        scope: reference(scope),
        text: "Held turn",
      });
    await started;
    if (!timeout)
      s.app.auxiliary.cancel(s.p.id, {
        record: reference(job.turn),
        reason: "Explicit cancellation",
      });
    await job.completion;
    await assert.rejects(
      tools("read_scope", "late-read", {}),
      /cancelled|expired/,
    );
    release();
    await until(
      () =>
        !s.app.auxiliary
          .state(s.p.id, reference(s.u))
          .turns.some((p) => p.payload.state.status === "running"),
    );
    await until(() =>
      s.app.auxiliary
        .state(s.p.id, reference(s.u))
        .turns.some((p) => p.payload.state.status === "historical"),
    );
    assert.ok(
      s.app.auxiliary
        .state(s.p.id, reference(s.u))
        .proposals.some((p) => p.payload.state.historical),
    );
    await assert.rejects(
      async () =>
        s.app.auxiliary.send(s.p.id, {
          scope: reference(scope),
          text: "Automatic retry",
        }),
      /Fresh scope/,
    );
    assert.equal(design(s), before);
    const expired = freeze(s, { ttlMs: 50 });
    await new Promise((r) => setTimeout(r, 65));
    assert.throws(
      () =>
        s.app.auxiliary.send(s.p.id, {
          scope: reference(expired),
          text: "Expired",
        }),
      /expired/,
    );
  }
});
test("superseded draft scope cannot authorize further tool rounds; a new focus/inclusion scope gets no previous history", async (t) => {
  const s = await setup(t);
  let entered!: () => void, release!: () => void, tool: any;
  const started = new Promise<void>((r) => (entered = r)),
    held = new Promise<void>((r) => (release = r));
  s.driver.handler = async (input) => {
    tool = input.tool;
    entered();
    await held;
    return {
      reply: "Closed old scope",
      provenance: { kind: "authored-test-fixture", generation: false },
    };
  };
  const old = freeze(s),
    job = s.app.auxiliary.send(s.p.id, {
      scope: reference(old),
      text: "Old scoped turn",
    });
  await started;
  s.d = s.app.auxiliary.observe(s.p.id, {
    target: s.target,
    expected: s.d.token,
    values: { intent: "Newer revision" },
  });
  await assert.rejects(
    tool("propose_edit", "forbidden-late", {
      edits: [{ field: "intent", after: "stale" }],
      rationale: "stale",
    }),
    /revision|navigation/,
  );
  release();
  const historical = (await job.completion) as any;
  assert.equal(historical.payload.state.status, "historical");
  s.driver.handler = null;
  const fresh = freeze(s, {
    focus: {
      kind: "visual-page",
      unit: reference(s.u),
      raster: null,
      region: null,
    },
  });
  await send(s, fresh);
  assert.deepEqual(s.driver.inputs.at(-1).history, []);
  assert.notEqual(
    s.driver.inputs[0].thread.id,
    s.driver.inputs.at(-1).thread.id,
  );
});
test("bridge cancellation makes staged valid delivery historical; a new frozen operation uses a fresh context and no retry of old identity", async (t) => {
  const s = await setup(t),
    q = (await s.app.reconstruction.prepare(s.p.id, reconInput(s))).request;
  const { ReconstructionFixture } = await import(
    "../scripts/reconstruction-fixture.ts"
  );
  let entered!: () => void, release!: () => void, tool: any;
  const started = new Promise<void>((r) => (entered = r)),
    held = new Promise<void>((r) => (release = r));
  s.driver.handler = async (input) => {
    tool = input.tool;
    const response = await new ReconstructionFixture().run({
      request: input.request!,
      source: Buffer.alloc(0),
      resources: [],
      signal: input.signal,
    });
    await input.tool("submit_reconstruction", "staged-semantic", { response });
    entered();
    await held;
    return {
      reply: "Late valid semantic fixture",
      provenance: { kind: "authored-test-fixture", generation: false },
    };
  };
  const job = await s.app.auxiliary.bridge(s.p.id, {
    request: reference(q),
    integrity: q.integrity,
    timeoutMs: 10000,
  });
  await started;
  s.app.auxiliary.cancel(s.p.id, {
    record: reference(job.bridge),
    reason: "Explicit bridge cancellation",
  });
  await job.completion;
  await assert.rejects(tool("read_scope", "late", {}), /cancelled/);
  release();
  await until(
    () =>
      !!s.app.reconstruction.state(s.p.id, reference(s.u)).history[0]!.result,
  );
  const oldResult = s.app.reconstruction.state(s.p.id, reference(s.u))
    .history[0]!.result! as any;
  assert.equal(oldResult.payload.state.outcome, "historical");
  assert.equal(
    s.app.reconstruction.state(s.p.id, reference(s.u)).accepted,
    null,
  );
  s.driver.handler = null;
  const control = s.app.reconstruction.state(s.p.id, reference(s.u)).control!,
    fresh = (
      await s.app.reconstruction.prepare(s.p.id, {
        ...reconInput(s),
        expectedControl: reference(control),
      })
    ).request;
  await (
    await s.app.auxiliary.bridge(s.p.id, {
      request: reference(fresh),
      integrity: fresh.integrity,
      timeoutMs: 10000,
    })
  ).completion;
  assert.notEqual(s.driver.inputs[0].thread.id, s.driver.inputs[1].thread.id);
  assert.deepEqual(s.driver.inputs[1].history, []);
});
test("bridge final companion failure and malformed second candidate roll back all semantic outputs and reconstruction receipts", async (t) => {
  for (const finalFailure of [true, false]) {
    const s = await setup(t),
      q = (await s.app.reconstruction.prepare(s.p.id, reconInput(s))).request,
      before = design(s);
    if (finalFailure) {
      const kernel = s.app.workspace.kernel as any,
        insert = kernel.insert;
      kernel.insert = function (p: any, port: any) {
        if (
          p.payload.kind === "auxiliary-bridge" &&
          p.version > 1 &&
          p.payload.state.result
        )
          throw Error("Injected final bridge evidence failure");
        return insert.call(this, p, port);
      };
    } else {
      const { ReconstructionFixture } = await import(
        "../scripts/reconstruction-fixture.ts"
      );
      s.driver.handler = async (input) => {
        const response = await new ReconstructionFixture().run({
          request: q,
          source: Buffer.alloc(0),
          resources: [],
          signal: input.signal,
        });
        (response.slots[1]!.candidate as any).page.root.style = {
          padding: "repeat(3,1fr)",
        };
        await input.tool("submit_reconstruction", "bad-second", { response });
        return {
          reply: "Malformed",
          provenance: { kind: "authored-test-fixture", generation: false },
        };
      };
    }
    const job = await s.app.auxiliary.bridge(s.p.id, {
      request: reference(q),
      integrity: q.integrity,
      timeoutMs: 10000,
    });
    await assert.rejects(job.completion);
    assert.equal(design(s), before);
    assert.equal(
      s.app.reconstruction.state(s.p.id, reference(s.u)).history[0]!.result,
      null,
    );
  }
});
test("new auxiliary memory evidence is complete; coherent omission rejects and missing primary versions stay discoverable after reopen", async (t) => {
  const s = await setup(t),
    old = s.app.memory.createCapsule(s.p.id, {
      scope: reference(s.u),
      previous: null,
    }),
    oldBytes = s.app.memory.download(s.p.id, reference(old)).output;
  const { scope, proposal } = await send(s),
    applied = action(s, proposal);
  const index = s.app.memory.index(s.p.id, reference(s.u));
  for (const p of [scope, proposal, applied.action])
    assert.ok(index.entries.some((e) => e.ref.id === p.id));
  const cap = s.app.memory.createCapsule(s.p.id, {
      scope: reference(s.u),
      previous: null,
    }),
    forged = structuredClone(cap.payload.state);
  forged.snapshot.entries = forged.snapshot.entries.filter(
    (e) => e.ref.id !== proposal.id,
  );
  forged.snapshot.events = forged.snapshot.events.filter(
    (e) => e.subject.id !== proposal.id,
  );
  forged.snapshot.coverage.entries = forged.snapshot.entries.length;
  forged.snapshot.coverage.events = forged.snapshot.events.length;
  forged.snapshot.digest = indexDigest(forged.snapshot);
  const { integrity: _, ...b } = cap,
    before = gateRows(s);
  assert.throws(
    () =>
      s.app.workspace.kernel.put(
        packet({
          ...b,
          id: "forged-aux-omission",
          dependencies: cap.dependencies.filter((r) => r.id !== proposal.id),
          payload: { ...b.payload, state: forged },
        }),
      ),
    /completeness/,
  );
  assert.equal(gateRows(s), before);
  assert.equal(s.app.memory.download(s.p.id, reference(old)).output, oldBytes);
  await s.app.close();
  const db = new DatabaseSync(join(s.root, "kernel.sqlite"));
  db.prepare("DELETE FROM kernel_packets WHERE id=?").run(proposal.id);
  db.close();
  const reopened = await s.reopen();
  assert.ok(
    reopened.memory
      .index(s.p.id, reference(s.u))
      .entries.some((e) => e.ref.id === proposal.id && e.status === "missing"),
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
test("HTTP token, unsupported/alternate routes and production authority cannot bypass isolated tools or Apply", async (t) => {
  const s = await setup(t),
    session = (await (
      await fetch(s.app.origin + "/api/v1/session")
    ).json()) as any;
  const before = gateRows(s);
  for (const [path, input, token] of [
    [
      "/api/v1/visual/auxiliary/update_draft",
      { brief: { intent: "fake" } },
      session.token,
    ],
    [
      "/api/v1/visual/auxiliary/tool",
      { name: "update_draft", scope: s.u },
      session.token,
    ],
    ["/api/v1/visual/auxiliary/freeze", { context: { brand: true } }, "bad"],
    [
      "/api/v1/chat/tool",
      { name: "update_draft", actionId: "forged", input: { scope: s.u } },
      session.token,
    ],
  ]) {
    const response = await fetch(s.app.origin + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: s.app.origin,
        "X-BVE-Token": token,
        "X-BVE-Chat-Grant": s.session,
      },
      body: JSON.stringify({ projectId: s.p.id, input }),
    });
    assert.equal(response.status, 403);
  }
  assert.equal(gateRows(s), before);
  const {proposal} = await send(s), afterProposal = gateRows(s);
  for (const extra of [{session: "forged-session"}, {proposal: {...reference(proposal), id: "absent-proposal"}}, {edits: [{field: "brand", after: true}]}]) {
    const response = await fetch(s.app.origin + "/api/v1/visual/auxiliary/action", {method: "POST", headers: {"Content-Type": "application/json", Origin: s.app.origin, "X-BVE-Token": session.token}, body: JSON.stringify({projectId:s.p.id, input: {proposal:reference(proposal),session:s.session,actionId:"forged-apply",decision:"apply",expected:s.d.token,...extra}})});
    assert.ok(response.status >= 400 && response.status < 500);
    assert.equal(gateRows(s), afterProposal);
  }
  const production = await setup(t, false);
  assert.equal(production.app.auxiliary.availability().connected, false);
  assert.throws(
    () =>
      production.app.auxiliary.send(production.p.id, {
        scope: reference(production.u),
        text: "No production fallback",
      }),
    /unavailable/,
  );
  assert.throws(
    () =>
      production.app.reconstruction.offlineSessionIntake(
        true,
        "authored-test-fixture",
      ),
    /No injected/,
  );
});
test("session close/shutdown interrupt an abort-ignoring fixture, drain HTTP and cold reopen without draft or transport replay", async (t) => {
  const s = await setup(t);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((r) => (entered = r)),
    held = new Promise<void>((r) => (release = r));
  s.driver.handler = async (input) => {
    entered();
    await held;
    return {
      reply: "Ignored late delivery",
      provenance: { kind: "authored-test-fixture", generation: false },
    };
  };
  const scope = freeze(s),
    token = (
      (await (await fetch(s.app.origin + "/api/v1/session")).json()) as any
    ).token,
    request = fetch(s.app.origin + "/api/v1/visual/auxiliary/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: s.app.origin,
        "X-BVE-Token": token,
      },
      body: JSON.stringify({
        projectId: s.p.id,
        input: { scope: reference(scope), text: "Held shutdown" },
      }),
    });
  await started;
  await s.app.close();
  assert.equal((await request).status, 200);
  release();
  await new Promise((r) => setTimeout(r, 20));
  const reopened = await s.reopen();
  assert.equal(
    reopened.auxiliary.state(s.p.id, reference(s.u)).turns[0]!.payload.state
      .status,
    "interrupted",
  );
  assert.equal(
    reopened.auxiliary.state(s.p.id, reference(s.u)).proposals.length,
    0,
  );
  assert.equal(s.driver.calls, 1);
  assert.throws(
    () =>
      reopened.auxiliary.observe(s.p.id, {
        target: s.target,
        expected: s.d.token,
        values: { intent: "replayed draft" },
      }),
    /session unavailable/,
  );
});

test("reconstruction preparation proposals Apply only bounded instruction/count/explicit viewport draft fields", async (t) => {
  const s = await setup(t),
    target = {
      ...s.target,
      kind: "reconstruction" as const,
      key: "explicit-preparation",
    };
  const draft = s.app.auxiliary.observe(s.p.id, {
    target,
    expected: null,
    values: {
      instruction: "Original preparation",
      count: null,
      viewports: null,
    },
  });
  const scope = freeze(s, {
    target,
    draft: draft.token,
    editable: ["instruction", "count", "viewports"],
  });
  s.driver.handler = async (input) => {
    await input.tool("propose_edit", "bounded-preparation", {
      edits: [
        {
          field: "instruction",
          after: "Implement this whole raster; disclose unknowns",
        },
        { field: "count", after: 6 },
        {
          field: "viewports",
          after: [
            { width: 1280, height: 800 },
            { width: 390, height: 844 },
          ],
        },
      ],
      rationale: "Authored preparation proposal",
    });
    return {
      reply: "Draft changes only",
      provenance: { kind: "authored-test-fixture", generation: false },
    };
  };
  const before = design(s),
    { proposal } = await send(s, scope),
    applied = action(s, proposal, { expected: draft.token });
  assert.equal(applied.action.payload.state.decision, "applied");
  assert.equal(applied.values!.count, 6);
  assert.deepEqual(applied.values!.viewports, [
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ]);
  assert.equal(design(s), before);
  assert.equal(
    s.app.reconstruction.state(s.p.id, reference(s.u)).history.length,
    0,
  );
});
test("incompatible Brand/evidence scope freeze supersedes old proposals and continuation; only explicit editable values reach driver", async (t) => {
  const s = await setup(t),
    brand = packet({
      type: "visual-os",
      id: "policy-brand",
      approval: "accepted",
      payload: {
        values: {
          palette: { value: ["Provisional approved palette"], approved: true },
        },
        placeholders: {},
      },
    });
  s.app.workspace.kernel.put(brand);
  s.d = s.app.auxiliary.observe(s.p.id, {
    target: s.target,
    expected: s.d.token,
    values: {
      intent: "Original intent",
      "level1:font": "UNREQUESTED_CONTROL_SENTINEL",
    },
  });
  const on = freeze(s, {
      brand: { ref: reference(brand), integrity: brand.integrity },
    }),
    { proposal } = await send(s, on);
  const off = freeze(s, { brand: null });
  assert.equal(action(s, proposal).action.payload.state.decision, "conflict");
  assert.throws(
    () =>
      s.app.auxiliary.send(s.p.id, {
        scope: reference(on),
        text: "Old Brand continuation",
      }),
    /superseded/,
  );
  s.driver.handler = async (input) => {
    assert.ok(!Object.hasOwn(input.draft!.values, "level1:font"));
    assert.ok(
      !canonical(input.context).includes("Provisional approved palette"),
    );
    assert.deepEqual(input.history, []);
    await input.tool("propose_edit", "new-off", {
      edits: [{ field: "intent", after: "Fresh off-policy intent" }],
      rationale: "Fresh explicit policy",
    });
    return {
      reply: "Fresh scope",
      provenance: { kind: "authored-test-fixture", generation: false },
    };
  };
  await send(s, off);
});
test("tool action replay is exact/idempotent; conflicting identities and unavailable production driver kinds reject", async (t) => {
  const s = await setup(t),
    before = design(s);
  s.driver.handler = async (input) => {
    const a = await input.tool("read_scope", "same", {}),
      b = await input.tool("read_scope", "same", {});
    assert.deepEqual(a, b);
    (a as any).brand = {
      enabled: true,
      values: { palette: "forged mutable fixture object" },
    };
    const c = await input.tool("read_scope", "same", {});
    assert.deepEqual((c as any).brand, { enabled: false });
    await input.tool("recommend_prepare", "same", {
      text: "conflicting reuse",
    });
    return {
      reply: "invalid",
      provenance: { kind: "authored-test-fixture", generation: false },
    };
  };
  const job = s.app.auxiliary.send(s.p.id, {
    scope: reference(freeze(s)),
    text: "Replay probe",
  });
  await assert.rejects(job.completion, /Conflicting/);
  assert.equal(design(s), before);
  assert.equal(
    s.app.auxiliary.state(s.p.id, reference(s.u)).proposals.length,
    0,
  );
});
test("an explicit session close preserves cancellation/history but cannot resume/apply or restore registered draft", async (t) => {
  const s = await setup(t);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((r) => (entered = r)),
    held = new Promise<void>((r) => (release = r));
  s.driver.handler = async (input) => {
    await input.tool("propose_edit", "before-close", {
      edits: [{ field: "intent", after: "Historical closed-session proposal" }],
      rationale: "Already scoped before close",
    });
    entered();
    await held;
    return {
      reply: "Late closed-session history",
      provenance: { kind: "authored-test-fixture", generation: false },
    };
  };
  const job = s.app.auxiliary.send(s.p.id, {
    scope: reference(freeze(s)),
    text: "Close session",
  });
  await started;
  await s.app.auxiliary.closeSession(s.session);
  await job.completion;
  release();
  await until(
    () => s.app.auxiliary.state(s.p.id, reference(s.u)).proposals.length === 1,
  );
  const proposal = s.app.auxiliary.state(s.p.id, reference(s.u)).proposals[0]!;
  assert.equal(proposal.payload.state.historical, true);
  assert.equal(action(s, proposal).action.payload.state.decision, "conflict");
  assert.throws(
    () =>
      s.app.auxiliary.observe(s.p.id, {
        target: s.target,
        expected: s.d.token,
        values: { intent: "replay" },
      }),
    /session unavailable/,
  );
});

test("missing latest completed-turn evidence blocks Apply even while the session mirror survives", async (t) => {
  const s = await setup(t),
    { proposal, turn } = await send(s);
  const db = new DatabaseSync(join(s.root, "kernel.sqlite"));
  db.prepare("DELETE FROM kernel_packets WHERE id=? AND version=2").run(
    turn.turn.id,
  );
  db.close();
  const before = design(s),
    response = action(s, proposal);
  assert.equal(response.action.payload.state.decision, "conflict");
  assert.match(response.action.payload.state.detail, /evidence unavailable/);
  assert.equal(response.values, null);
  assert.equal(design(s), before);
  assert.ok(
    s.app.auxiliary
      .state(s.p.id, reference(s.u))
      .turns.some((t) => t.latestVersionAvailable === false),
  );
});
