import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { startApp } from "../src/service/server.ts";
import {
  reference,
  canonical,
  packet,
  revise,
  digest,
} from "../src/kernel/packets.ts";
import {
  parseIndex,
  parseCapsule,
  MEMORY_LIMITS,
} from "../src/modules/website/memory-contracts.ts";
import {
  visualFixture,
  offlineVisualProviders,
} from "../scripts/visual-fixture.ts";
import { OfflineRasterTransport } from "../scripts/execution-fixture.ts";
async function setup(t: test.TestContext) {
  const root = mkdtempSync(join(tmpdir(), "bve-memory-")),
    transport = new OfflineRasterTransport();
  let app = await startApp(root, 0, undefined, offlineVisualProviders, {
    executionFixture: { testOnly: true, transport },
  });
  const v = app.visual,
    p = v.create({ title: "Memory synthetic project" }),
    u = v.exploration.createWorkUnit(p.project.id, {
      version: 1,
      pageType: "homepage",
      label: "Homepage",
      source: "Authored fixture",
    }),
    about = v.exploration.createWorkUnit(p.project.id, {
      version: 1,
      pageType: "about",
      label: "About",
      source: "Authored fixture",
    });
  t.after(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });
  const reopen = async () => {
    await app.close();
    app = await startApp(root, 0, undefined, offlineVisualProviders);
    return app;
  };
  return { root, app, v, p, u, about, transport, reopen };
}
const note = (
  scope: ReturnType<typeof reference> | null,
  text = "Unresolved: request fresh variations; no acceptance",
  evidence: unknown[] = [],
) => ({ version: 1, scope, text, source: "human-authored", evidence });
const create = (s: Awaited<ReturnType<typeof setup>>, scope = reference(s.u)) =>
  s.app.memory.createCapsule(s.p.project.id, { scope, previous: null });
const prep = async (s: Awaited<ReturnType<typeof setup>>, count = 1) =>
  s.v.command(s.p.project.id, "prepare", {
    expectedProject: s.p.project,
    unit: reference(s.u),
    selections: null,
    intent: "Synthetic pending outcome",
    count,
    direction: "fresh",
    brand: null,
    operation: "create",
    requests: [],
    level1: [],
  }) as any;
test("capsule bookkeeping never stales source; exact notes preserve revisions, conflict, scope, schemas and semantic kinds", async (t) => {
  const s = await setup(t),
    m = s.app.memory,
    pid = s.p.project.id;
  const n = m.saveNote(pid, { expected: null, note: note(reference(s.u)) }),
    cap = create(s),
    before = m.download(pid, reference(cap)).output;
  assert.equal(m.capsule(pid, reference(cap)).currency.status, "current");
  create(s);
  m.capsule(pid, reference(cap));
  m.download(pid, reference(cap));
  assert.equal(m.capsule(pid, reference(cap)).currency.status, "current");
  const n2 = m.saveNote(pid, {
    expected: reference(n),
    note: note(reference(s.u), "Revised intent"),
  });
  assert.equal(n2.version, 2);
  assert.equal(
    s.app.workspace.kernel.get<any>(reference(n)).payload.state.text,
    n.payload.state.text,
  );
  assert.throws(
    () =>
      m.saveNote(pid, {
        expected: reference(n),
        note: note(reference(s.u), "Stale draft"),
      }),
    /changed/,
  );
  assert.equal(m.capsule(pid, reference(cap)).currency.status, "changed");
  assert.equal(m.download(pid, reference(cap)).output, before);
  assert.equal(
    parseIndex(JSON.parse(before)).digest,
    cap.payload.state.snapshot.digest,
  );
  assert.throws(
    () =>
      m.saveNote(pid, {
        expected: reference(n2),
        note: note(reference(s.about)),
      }),
    /scope immutable/,
  );
  assert.throws(
    () =>
      m.saveNote(pid, {
        expected: null,
        note: { ...note(null), execute: true },
      }),
    /Unknown/,
  );
  assert.throws(
    () =>
      s.app.workspace.kernel.put(
        revise(
          n2,
          {
            ...n2.payload,
            kind: "page-work-unit",
            state: {
              version: 1,
              pageType: "homepage",
              label: "Bypass",
              source: "Synthetic",
            },
          } as any,
          "fixture",
          "Invalid kind",
        ),
      ),
    /semantic kind immutable/,
  );
  assert.throws(
    () =>
      s.app.workspace.kernel.put(
        revise(cap, cap.payload, "fixture", "Mutate capsule"),
      ),
    /immutable/,
  );
  const forged = structuredClone(cap.payload.state);
  forged.snapshot.events[0]!.kind = "acceptance";
  const { digest: _, ...body } = forged.snapshot;
  forged.snapshot.digest = digest(body);
  assert.throws(
    () =>
      s.app.workspace.kernel.put(
        packet({
          type: cap.type,
          id: "forged-memory-capsule",
          projectId: cap.projectId,
          dependencies: cap.dependencies,
          payload: { ...cap.payload, state: forged },
        }),
      ),
    /event is not canonical/,
  );
});
test("cross-page sources retain exact closure without false membership; replacements keep capsule and note links unchanged; fresh reader survives closed reopen", async (t) => {
  const s = await setup(t),
    pid = s.p.project.id,
    e = s.v.exploration,
    m = s.app.memory;
  const c = await e.importCandidate(
    pid,
    reference(s.u),
    await visualFixture(0),
    "Synthetic rights",
  );
  const selection = e.selections(pid, {
    version: 1,
    workUnit: reference(s.about),
    entries: [
      {
        id: "source-old",
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
            id: "note-a",
            text: "Keep the broad feel, not a brand rule",
            source: "human-authored",
          },
        ],
      },
    ],
  });
  const n = m.saveNote(pid, {
    expected: null,
    note: note(
      reference(s.about),
      "Selected Homepage source for About exploration",
      [{ ref: reference(c), integrity: c.integrity }],
    ),
  });
  const cap = m.createCapsule(pid, {
      scope: reference(s.about),
      previous: null,
    }),
    original = m.download(pid, reference(cap)).output;
  const index = cap.payload.state.snapshot;
  assert.ok(index.entries.some((x) => x.ref.id === c.id));
  assert.ok(index.entries.some((x) => x.ref.id === selection.id));
  assert.ok(
    !index.entries.some(
      (x) =>
        x.kind === "raster-membership" &&
        (x.summary as any).workUnit.id === s.about.id,
    ),
  );
  const c2 = await e.importCandidate(
    pid,
    reference(s.u),
    await visualFixture(1),
    "Synthetic revised source",
    "imported",
    reference(c),
  );
  assert.equal(c2.version, 2);
  assert.equal(m.download(pid, reference(cap)).output, original);
  assert.equal(
    m.evidence(pid, reference(c), c.integrity).summary !== null,
    true,
  );
  assert.equal(m.capsule(pid, reference(cap)).currency.status, "changed");
  const reopened = await s.reopen();
  const saved = reopened.memory.state(pid, reference(s.about));
  assert.ok(saved.notes.some((x: any) => x.ref.id === n.id));
  // A separate deterministic consumer has no previous controller or browser memory.
  const capsule = reopened.memory.capsule(pid, reference(cap));
  const sources = capsule.snapshot.entries
    .filter((x) => x.kind === "raster-selections")
    .flatMap((x) => (x.summary as any).entries);
  assert.equal(sources[0]!.candidate.version, 1);
  const exact = reopened.memory.evidence(
    pid,
    sources[0]!.candidate,
    sources[0]!.integrity,
  );
  assert.equal((exact.summary as any).origin, "imported");
  assert.equal(exact.ref.version, 1);
  assert.equal(capsule.snapshot.acceptance.length, 0);
  assert.equal(reopened.visual.executions.availability().connected, false);
});
test("owner-checked routes reject foreign, forged, unsupported and latest pointers; downloads expose only previewed scope and do not mutate authority", async (t) => {
  const s = await setup(t),
    pid = s.p.project.id,
    m = s.app.memory,
    other = s.v.create({ title: "Foreign private sentinel" }),
    foreign = s.v.exploration.createWorkUnit(other.project.id, {
      version: 1,
      pageType: "homepage",
      label: "Foreign secret",
      source: "Fixture",
    }),
    before = canonical(s.app.workspace.kernel.ledger(pid));
  assert.throws(() => m.index(pid, reference(foreign)), /Foreign/);
  assert.throws(() => m.evidence(pid, reference(foreign)), /Foreign/);
  assert.throws(
    () => m.evidence(pid, { ...reference(s.u), freshness: "current" }),
    /pinned/,
  );
  assert.equal(
    m.evidence(pid, { id: s.u.id, version: 99, freshness: "pinned" }).status,
    "missing",
  );
  assert.throws(
    () =>
      m.saveNote(pid, {
        expected: null,
        note: note(null, "Bad link", [
          { ref: reference(s.u), integrity: "a".repeat(64) },
        ]),
      }),
    /unavailable/,
  );
  assert.equal(canonical(s.app.workspace.kernel.ledger(pid)), before);
  const cap = create(s),
    output = m.download(pid, reference(cap)).output,
    events = canonical(s.app.workspace.kernel.ledger(pid));
  assert.doesNotMatch(
    output,
    /Foreign secret|Foreign private sentinel|X-BVE|native-assets|runtime|\/tmp\//,
  );
  assert.equal(m.download(pid, reference(cap)).output, output);
  assert.equal(canonical(s.app.workspace.kernel.ledger(pid)), events);
  const session = await (
      await fetch(s.app.origin + "/api/v1/visual/session")
    ).json(),
    post = (token: string) =>
      fetch(s.app.origin + "/api/v1/visual/memory/note", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-BVE-Token": token,
          Origin: s.app.origin,
        },
        body: JSON.stringify({
          projectId: pid,
          input: { expected: null, note: note(null) },
        }),
      });
  assert.equal((await post("wrong")).status, 403);
  assert.equal((await post(session.token)).status, 200);
  const q = new URLSearchParams({ project: pid, id: cap.id, version: "1" }),
    download = await fetch(
      s.app.origin + "/api/v1/visual/memory/download?" + q,
    );
  assert.match(
    download.headers.get("content-disposition")!,
    /^attachment; filename="project-continuation-capsule-[a-z0-9-]+\.json"$/,
  );
  assert.equal(await download.text(), output);
  const old = await fetch(
    s.app.origin +
      "/api/v1/visual/memory/evidence?" +
      new URLSearchParams({ project: pid, id: s.u.id, version: "99" }),
  );
  assert.equal((await old.json()).status, "missing");
});
test("missing and corrupt canonical records and media are explicit; no latest fallback or foreign-project decode", async (t) => {
  const s = await setup(t),
    pid = s.p.project.id,
    m = s.app.memory,
    c = await s.v.exploration.importCandidate(
      pid,
      reference(s.u),
      await visualFixture(0),
      "Fixture rights",
    ),
    cap = create(s);
  writeFileSync(
    join(s.app.workspace.assets.root, c.payload.state.image.id),
    "corrupt",
  );
  assert.equal(m.evidence(pid, reference(c)).media, "unavailable");
  assert.equal(m.capsule(pid, reference(cap)).currency.status, "changed");
  const db = new DatabaseSync(join(s.root, "kernel.sqlite")),
    old = db
      .prepare("SELECT body FROM kernel_packets WHERE id=? AND version=1")
      .get(c.id)!["body"] as string;
  const damaged = JSON.parse(old);
  damaged.payload.state.origin = "generated";
  db.prepare("UPDATE kernel_packets SET body=? WHERE id=? AND version=1").run(
    JSON.stringify(damaged),
    c.id,
  );
  assert.equal(m.evidence(pid, reference(c), c.integrity).status, "corrupt");
  assert.ok(
    m
      .capsule(pid, reference(cap))
      .currency.details.some(
        (e) => e.ref.id === c.id && e.status === "corrupt",
      ),
  );
  db.prepare("DELETE FROM kernel_packets WHERE id=? AND version=1").run(c.id);
  assert.equal(m.evidence(pid, reference(c)).status, "missing");
  assert.ok(
    m
      .index(pid, reference(s.u))
      .entries.some((e) => e.ref.id === c.id && e.status === "missing"),
  );
  db.close();
});
test("large history is stable, paged with honest omitted counts; snapshot overflow rejects instead of dropping selected evidence", async (t) => {
  const s = await setup(t),
    m = s.app.memory,
    pid = s.p.project.id;
  let n = m.saveNote(pid, {
    expected: null,
    note: note(reference(s.u), "Revision one"),
  });
  for (let i = 2; i <= 65; i++)
    n = m.saveNote(pid, {
      expected: reference(n),
      note: note(reference(s.u), "Revision " + i),
    });
  const index = m.index(pid, reference(s.u)),
    all: unknown[] = [];
  let cursor: number | null = 0;
  while (cursor !== null) {
    const p = m.page(pid, reference(s.u), cursor, 17);
    all.push(...p.entries);
    assert.equal(p.coverage.omitted, index.entries.length - p.entries.length);
    cursor = p.next;
  }
  assert.equal(canonical(all), canonical(index.entries));
  assert.equal(index.entries.filter((e) => e.ref.id === n.id).length, 65);
  assert.throws(() => m.page(pid, null, 0, 51), /count/);
  const refs = s.app.workspace.kernel.projectRefs.bind(s.app.workspace.kernel);
  s.app.workspace.kernel.projectRefs = (pid, max) => {
    const rows = refs(pid, max);
    if (rows.length > 0)
      throw new Error("Project memory inventory limit exceeded");
    return rows;
  };
  assert.throws(() => create(s), /inventory limit/);
  s.app.workspace.kernel.projectRefs = refs;
  const indexFn = m.index.bind(m),
    before = canonical(s.app.workspace.kernel.ledger(pid));
  m.index = () => ({
    ...index,
    entries: Array.from({ length: 2049 }, (_, i) => ({
      ...index.entries[0]!,
      ref: { id: "overflow-" + i, version: 1, freshness: "pinned" as const },
    })),
  });
  assert.throws(() => create(s), /2048/);
  assert.equal(canonical(s.app.workspace.kernel.ledger(pid)), before);
  m.index = indexFn;
});
test("pending, partial invalid and cancelled/uncertain late historical execution is indexed without grants, hidden calls or adoption", async (t) => {
  const s = await setup(t),
    pid = s.p.project.id,
    m = s.app.memory,
    prepared = await prep(s, 3),
    request = await s.v.executions.compile(
      pid,
      reference(prepared.specification),
      64,
      64,
    ),
    grant = s.v.executions.grant(pid, {
      request: reference(request),
      adapter: s.transport.capabilities.adapter,
      slots: [1, 2, 3],
      maxSubmissions: 3,
      maxStatusCalls: 0,
      maxCancelCalls: 0,
      timeoutMs: 1000,
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      reason: "Explicit test bound",
    }),
    run = s.v.executions.prepare(pid, reference(grant));
  const cap = create(s);
  assert.ok(
    cap.payload.state.snapshot.entries.some(
      (e) =>
        e.kind === "raster-execution" &&
        (e.summary as any).slots.every((s: any) => s.status === "pending"),
    ),
  );
  s.transport.mode = "mixed";
  await s.v.executions.execute(pid, reference(run));
  const index = m.index(pid, reference(s.u)),
    receipts = index.entries.filter(
      (e) => e.kind === "raster-execution-receipt",
    );
  assert.equal(receipts.length, 3);
  assert.ok(receipts.some((e) => (e.summary as any).outcome === "invalid"));
  assert.ok(
    receipts
      .filter((e) => (e.summary as any).outcome === "succeeded")
      .every((e) => (e.summary as any).observed.generation === false),
  );
  assert.equal(index.acceptance.length, 0);
  assert.equal(s.transport.polls.length, 0);
  assert.equal(m.capsule(pid, reference(cap)).currency.status, "changed");
  const grantEntry = index.entries.find(
    (e) => e.kind === "raster-execution-grant",
  )!;
  assert.ok(!(grantEntry.summary as any).maxSubmissions);
  assert.ok(!(grantEntry.summary as any).adapter);
});
test("V04 preserves closed legacy SQLite/RGB bytes, accepted pointers and standalone exports; acceptance currency is canonical", async (t) => {
  const s = await setup(t),
    pid = s.p.project.id,
    m = s.app.memory;
  const { Store } = await import("../src/store.ts"),
    { website, sourceRaster } = await import("../src/fixtures.ts"),
    { Pages } = await import("../src/service/pages.ts");
  const legacyRoot = s.root,
    legacy = new Store(legacyRoot),
    lp = website();
  legacy.createProject(lp);
  const asset = legacy.addAsset(lp.id, "hero", sourceRaster());
  legacy.accept(
    lp.id,
    "hero",
    asset.id,
    null,
    "fixture",
    "Original legacy choice",
  );
  const legacySnapshot = canonical(legacy.snapshot(lp.id));
  legacy.close();
  const legacyDB = readFileSync(join(legacyRoot, "workspace.sqlite")),
    rgb = readFileSync(join(legacyRoot, asset.path));
  const page = packet({
    type: "design-artifact",
    id: "memory-legacy-page",
    projectId: pid,
    payload: {
      moduleId: "website",
      kind: "website-page",
      scope: "page",
      lockedValues: {},
      state: {
        page: {
          version: 1,
          title: "Legacy memory compatibility",
          language: "en",
          root: {
            id: "root",
            kind: "container",
            children: [{ id: "copy", kind: "text", text: "Legacy exact page" }],
          },
          media: {},
          responsive: [],
          unresolved: [],
        },
        context: {},
        rationale: "Synthetic legacy evidence",
        locks: [],
      },
    },
  });
  s.app.workspace.kernel.put(page);
  const pages = new Pages(s.app.workspace),
    cap = m.createCapsule(pid, { scope: null, previous: null });
  s.app.workspace.kernel.accept(
    pid,
    "page:" + page.id,
    reference(page),
    null,
    "fixture",
    "Explicit legacy acceptance",
  );
  const before = await pages.export(pid, reference(page)),
    events = canonical(s.app.workspace.kernel.ledger(pid)),
    accepted = s.app.workspace.kernel.selected(pid, "page:" + page.id);
  m.saveNote(pid, {
    expected: null,
    note: note(null, "Handoff navigation does not alter acceptance"),
  });
  m.createCapsule(pid, { scope: null, previous: reference(cap) });
  assert.equal(m.capsule(pid, reference(cap)).currency.status, "changed");
  assert.ok(
    m
      .index(pid)
      .acceptance.some(
        (a) => a.slot === "page:" + page.id && a.ref.id === page.id,
      ),
  );
  assert.equal(
    canonical(s.app.workspace.kernel.get(reference(page))),
    canonical(page),
  );
  assert.deepEqual(
    (await pages.export(pid, reference(page))).bytes,
    before.bytes,
  );
  assert.deepEqual(
    s.app.workspace.kernel.selected(pid, "page:" + page.id),
    accepted,
  );
  assert.deepEqual(
    readFileSync(join(legacyRoot, "workspace.sqlite")),
    legacyDB,
  );
  assert.deepEqual(readFileSync(join(legacyRoot, asset.path)), rgb);
  const oldCapsule = m.download(pid, reference(cap)).output;
  assert.equal(parseIndex(JSON.parse(oldCapsule)).acceptance.length, 0);
  const reopened = await s.reopen();
  assert.equal(
    reopened.memory.download(pid, reference(cap)).output,
    oldCapsule,
  );
  assert.deepEqual(
    (await new Pages(reopened.workspace).export(pid, reference(page))).bytes,
    before.bytes,
  );
  const oldLegacy = new Store(legacyRoot);
  assert.equal(canonical(oldLegacy.snapshot(lp.id)), legacySnapshot);
  oldLegacy.close();
  assert.deepEqual(
    readFileSync(join(legacyRoot, "workspace.sqlite")),
    legacyDB,
  );
});
test("approved brand boundary and per-spec influence stay separate; unrelated accepted/proposal brands are not retrievable", async (t) => {
  const s = await setup(t),
    pid = s.p.project.id,
    m = s.app.memory;
  const brand = packet({
      type: "visual-os",
      id: "memory-approved-brand",
      approval: "accepted",
      payload: {
        values: {
          accent: { value: "#225566", approved: true },
          privateProposal: { value: "not a rule", approved: false },
        },
        placeholders: {},
      },
    }),
    unrelated = packet({
      type: "visual-os",
      id: "unrelated-brand",
      approval: "accepted",
      payload: {
        values: { other: { value: "foreign sentinel", approved: true } },
        placeholders: {},
      },
    });
  s.app.workspace.kernel.put(brand);
  s.app.workspace.kernel.put(unrelated);
  assert.throws(() => m.evidence(pid, reference(brand)), /outside approved/);
  const prepared = (await s.v.command(pid, "prepare", {
    expectedProject: s.p.project,
    unit: reference(s.u),
    selections: null,
    intent: "Brand only, fresh direction",
    count: 1,
    direction: "fresh",
    brand: reference(brand),
    operation: "create",
    requests: [],
    level1: [],
  })) as any;
  const index = m.index(pid, reference(s.u));
  assert.equal(
    (index.entries.find((e) => e.ref.id === brand.id)!.summary as any)
      .approvedValues.accent,
    "#225566",
  );
  assert.doesNotMatch(
    canonical(index),
    /privateProposal|not a rule|foreign sentinel/,
  );
  assert.throws(
    () => m.evidence(pid, reference(unrelated)),
    /outside approved/,
  );
  const brandNote = m.saveNote(pid, {
    expected: null,
    note: note(
      reference(s.u),
      "Approved scoped Brand evidence, not a new rule",
      [{ ref: reference(brand), integrity: brand.integrity }],
    ),
  });
  assert.equal(brandNote.payload.state.evidence[0]!.ref.id, brand.id);
  const cap = create(s),
    spec = cap.payload.state.snapshot.entries.find(
      (e) => e.ref.id === prepared.specification.id,
    )!;
  assert.equal((spec.summary as any).direction, "fresh");
  assert.equal((spec.summary as any).brand.enabled, true);
  assert.equal(m.evidence(pid, reference(brand)).status, "available");
});
test("actually delivered late historical evidence survives fresh index/reopen; process-only active/cache is excluded and grants never resurrect", async (t) => {
  const s = await setup(t),
    pid = s.p.project.id,
    prepared = await prep(s, 6),
    request = await s.v.executions.compile(
      pid,
      reference(prepared.specification),
      64,
      48,
    ),
    grant = s.v.executions.grant(pid, {
      request: reference(request),
      adapter: s.transport.capabilities.adapter,
      slots: [1, 2, 3, 4, 5, 6],
      maxSubmissions: 6,
      maxStatusCalls: 0,
      maxCancelCalls: 0,
      timeoutMs: 5,
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      reason: "Offline timeout fixture",
    }),
    run = s.v.executions.prepare(pid, reference(grant));
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r)),
    send = s.transport.submit.bind(s.transport);
  s.transport.submit = async (input) => {
    const ack = await send(input);
    await held;
    return ack;
  };
  await s.v.executions.execute(pid, reference(run));
  const pending = create(s);
  assert.doesNotMatch(
    s.app.memory.download(pid, reference(pending)).output,
    /pendingDeliveries|deliveryErrors|received-intake/,
  );
  release();
  await s.v.executions.waitForDeliveries();
  const index = s.app.memory.index(pid, reference(s.u)),
    receipt = index.entries.find((e) => e.kind === "raster-execution-receipt")!;
  assert.equal((receipt.summary as any).outcome, "historical");
  assert.equal((receipt.summary as any).candidate, null);
  assert.equal(s.v.state(pid, reference(s.u)).candidates.length, 0);
  assert.equal(s.transport.submissions.length, 1);
  assert.equal(s.transport.polls.length, 0);
  const cap = create(s),
    bytes = s.app.memory.download(pid, reference(cap)).output;
  const reopened = await s.reopen();
  assert.equal(reopened.memory.download(pid, reference(cap)).output, bytes);
  assert.equal(
    reopened.memory.evidence(pid, receipt.ref, receipt.integrity).status,
    "available",
  );
  assert.equal(reopened.visual.executions.availability().connected, false);
  reopened.memory.capsule(pid, reference(cap));
  reopened.memory.index(pid, reference(s.u));
  assert.equal(s.transport.submissions.length, 1);
  assert.equal(reopened.visual.state(pid, reference(s.u)).candidates.length, 0);
});
test("snapshot and evidence size limits and paged note/capsule history reject or report explicit partial coverage", async (t) => {
  const s = await setup(t),
    m = s.app.memory,
    pid = s.p.project.id;
  for (let i = 0; i < 52; i++)
    m.saveNote(pid, {
      expected: null,
      note: note(reference(s.u), "Saved note " + i),
    });
  const first = m.state(pid, reference(s.u)),
    second = m.state(pid, reference(s.u), 50);
  assert.equal(first.notes.length, 50);
  assert.equal(first.coverage.omittedNotes, 2);
  assert.equal(first.coverage.next, 50);
  assert.equal(second.notes.length, 2);
  assert.equal(second.coverage.next, null);
  const cap = create(s),
    forged = structuredClone(cap.payload.state);
  forged.snapshot.entries[0]!.summary = "x".repeat(MEMORY_LIMITS.downloadBytes);
  const { digest: _, ...body } = forged.snapshot;
  forged.snapshot.digest = digest(body);
  assert.throws(() => parseCapsule(forged), /size limit/);
  // A valid but oversized exact human source cannot be silently clipped into a response.
  const source = packet({
    type: "design-artifact",
    id: "huge-primary-page",
    projectId: pid,
    payload: {
      moduleId: "website",
      kind: "website-page",
      scope: "page",
      lockedValues: {},
      state: {
        page: {
          version: 1,
          title: "Bounded source",
          language: "en",
          root: {
            id: "root",
            kind: "container",
            children: [{ id: "text", kind: "text", text: "Fixture" }],
          },
          media: {},
          responsive: [],
          unresolved: [],
        },
        context: {},
        rationale: "Fixture",
        locks: [],
      },
    },
    placeholders: [
      {
        key: "huge",
        expected: "x".repeat(MEMORY_LIMITS.evidenceBytes + 1),
        reason: "Synthetic stress",
        dependsOn: [],
        mayProceed: [],
        blocks: [],
        prohibitedAssumptions: ["No assumption"],
        resolutionRoutes: ["Explicit input"],
      },
    ],
  });
  s.app.workspace.kernel.put(source);
  assert.throws(() => m.evidence(pid, reference(source)), /response bound/);
});
