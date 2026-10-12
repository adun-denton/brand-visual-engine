import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { startApp } from "../src/service/server.ts";
import { reference, canonical, packet, revise } from "../src/kernel/packets.ts";
import { revalidatePacket, writePort } from "../src/kernel/gate.ts";
import {
  indexDigest,
  parseIndex,
  type Capsule,
  type MemoryIndex,
} from "../src/modules/website/memory-contracts.ts";
import type { NodePacket, DesignArtifact } from "../src/kernel/contracts.ts";
import {
  visualFixture,
  offlineVisualProviders,
} from "../scripts/visual-fixture.ts";
async function setup(t: test.TestContext) {
  const root = mkdtempSync(join(tmpdir(), "bve-memory-repairs-"));
  let app = await startApp(root, 0, undefined, offlineVisualProviders);
  const pid = app.visual.create({ title: "Memory repair fixture" }).project.id,
    u = app.visual.exploration.createWorkUnit(pid, {
      version: 1,
      pageType: "homepage",
      label: "Homepage",
      source: "Synthetic repair fixture",
    }),
    other = app.visual.exploration.createWorkUnit(pid, {
      version: 1,
      pageType: "about",
      label: "About",
      source: "Synthetic repair fixture",
    });
  t.after(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    app,
    pid,
    u,
    other,
    reopen: async () => {
      await app.close();
      app = await startApp(root, 0, undefined, offlineVisualProviders);
      return app;
    },
    fault: () => new DatabaseSync(join(root, "kernel.sqlite")),
  };
}
const save = (
  s: Awaited<ReturnType<typeof setup>>,
  text = "Sole saved handoff note",
  previous: ReturnType<typeof reference> | null = null,
) =>
  s.app.memory.saveNote(s.pid, {
    expected: previous,
    note: {
      version: 1,
      scope: reference(s.u),
      text,
      source: "human-authored",
      evidence: [],
    },
  });
const freeze = (
  s: Awaited<ReturnType<typeof setup>>,
  scope: ReturnType<typeof reference> | null = reference(s.u),
) => s.app.memory.createCapsule(s.pid, { scope, previous: null });
function mutateCapsule(
  c: NodePacket<DesignArtifact<Capsule>>,
  change: (index: MemoryIndex) => void,
  id: string,
) {
  const s = structuredClone(c.payload.state);
  change(s.snapshot);
  s.snapshot.coverage.entries = s.snapshot.entries.length;
  s.snapshot.coverage.events = s.snapshot.events.length;
  s.snapshot.digest = indexDigest(s.snapshot);
  const refs = new Set(
    s.snapshot.entries
      .filter((e) => e.status === "available")
      .map((e) => e.ref.id + ":" + e.ref.version),
  );
  return packet({
    type: "work-record",
    id,
    projectId: c.projectId,
    dependencies: c.dependencies.filter(
      (r) =>
        r.id === s.snapshot.project.id ||
        r.id === s.scope?.id ||
        refs.has(r.id + ":" + r.version),
    ),
    payload: { ...c.payload, state: s },
  });
}
test("R1 original missing sole note is ledger-discovered with explicit missing/unknown scope in fresh page/project snapshots, download and reopen", async (t) => {
  const s = await setup(t),
    n = save(s),
    old = freeze(s),
    bytes = s.app.memory.download(s.pid, reference(old)).output,
    events = canonical(s.app.workspace.kernel.ledger(s.pid));
  const db = s.fault();
  db.prepare("DELETE FROM kernel_packets WHERE id=? AND version=?").run(
    n.id,
    n.version,
  );
  db.close();
  assert.equal(canonical(s.app.workspace.kernel.ledger(s.pid)), events);
  for (const scope of [reference(s.u), reference(s.other), null]) {
    const i = s.app.memory.index(s.pid, scope),
      e = i.entries.find((e) => e.ref.id === n.id)!;
    assert.equal(e.status, "missing");
    assert.equal(e.kind, "unknown");
    assert.equal(e.type, "unknown");
    assert.equal(e.summary, null);
    assert.equal(e.integrity, null);
    assert.equal(i.coverage.omitted, 0);
    assert.equal(
      i.events.some((e) => e.subject.id === n.id),
      true,
    );
  }
  const lost = freeze(s);
  assert.equal(
    s.app.memory.capsule(s.pid, reference(lost)).currency.status,
    "incomplete",
  );
  assert.equal(
    s.app.memory.capsule(s.pid, reference(lost)).currency.availability.missing,
    1,
  );
  assert.ok(
    parseIndex(
      JSON.parse(s.app.memory.download(s.pid, reference(lost)).output),
    ).entries.some((e) => e.ref.id === n.id && e.status === "missing"),
  );
  assert.equal(s.app.memory.download(s.pid, reference(old)).output, bytes);
  const fresh = await s.reopen();
  assert.ok(
    fresh.memory
      .index(s.pid, reference(s.u))
      .entries.some((e) => e.ref.id === n.id && e.status === "missing"),
  );
  assert.equal(
    fresh.memory.capsule(s.pid, reference(lost)).currency.status,
    "incomplete",
  );
  assert.equal(fresh.memory.download(s.pid, reference(old)).output, bytes);
});
test("R1 missing historical revision and standalone work unit remain exact unavailable evidence; foreign loss never enters scope, paging/bounds include loss", async (t) => {
  const s = await setup(t),
    n = save(s),
    next = save(s, "Revision two remains available", reference(n)),
    foreign = s.app.visual.create({ title: "Foreign sentinel" }),
    fn = s.app.memory.saveNote(foreign.project.id, {
      expected: null,
      note: {
        version: 1,
        scope: null,
        text: "Foreign secret",
        source: "human-authored",
        evidence: [],
      },
    });
  const db = s.fault();
  for (const p of [n, s.other, fn])
    db.prepare("DELETE FROM kernel_packets WHERE id=? AND version=?").run(
      p.id,
      p.version,
    );
  db.close();
  const i = s.app.memory.index(s.pid, reference(s.u));
  assert.deepEqual(
    i.entries
      .filter((e) => e.status === "missing")
      .map((e) => e.ref.id)
      .sort(),
    [n.id, s.other.id].sort(),
  );
  assert.ok(
    i.entries.some(
      (e) =>
        e.ref.id === next.id && e.ref.version === 2 && e.status === "available",
    ),
  );
  assert.ok(!canonical(i).includes("Foreign secret"));
  assert.ok(!i.entries.some((e) => e.ref.id === fn.id));
  assert.equal(
    i.entries.find((e) => e.ref.id === n.id && e.ref.version === 1)!.summary,
    null,
  );
  let offset: number | null = 0;
  const entries = [];
  while (offset !== null) {
    const page = s.app.memory.page(s.pid, reference(s.u), offset, 2);
    entries.push(...page.entries);
    assert.equal(page.coverage.omitted, i.entries.length - page.entries.length);
    offset = page.next;
  }
  assert.equal(canonical(entries), canonical(i.entries));
  assert.throws(
    () => s.app.workspace.kernel.projectRefs(s.pid, i.entries.length - 1, true),
    /inventory limit/,
  );
  const cap = freeze(s, null);
  assert.equal(
    s.app.memory.capsule(s.pid, reference(cap)).currency.availability.missing,
    2,
  );
  const fresh = await s.reopen();
  assert.ok(
    fresh.memory
      .index(s.pid)
      .entries.some((e) => e.ref.id === s.other.id && e.status === "missing"),
  );
});
test("R2 original consistent omission rejects at KernelStore.put atomically, while valid snapshots and bookkeeping remain current", async (t) => {
  const s = await setup(t),
    n = save(s),
    cap = freeze(s),
    before = canonical(s.app.workspace.kernel.ledger(s.pid));
  const forged = mutateCapsule(
    cap,
    (i) => {
      i.entries = i.entries.filter((e) => e.ref.id !== n.id);
      i.events = i.events.filter((e) => e.subject.id !== n.id);
    },
    "forged-consistent-note-omission",
  );
  assert.throws(() => s.app.workspace.kernel.put(forged), /completeness/);
  assert.equal(s.app.workspace.kernel.lookup(reference(forged)), null);
  assert.equal(canonical(s.app.workspace.kernel.ledger(s.pid)), before);
  const index = s.app.memory.index(s.pid, reference(s.u)),
    valid = mutateCapsule(cap, () => {}, "valid-independent-writer");
  s.app.workspace.kernel.put(valid);
  assert.equal(
    canonical(s.app.memory.index(s.pid, reference(s.u))),
    canonical(index),
  );
  assert.equal(
    s.app.memory.capsule(s.pid, reference(cap)).currency.status,
    "current",
  );
  assert.equal(
    s.app.memory.capsule(s.pid, reference(valid)).currency.status,
    "current",
  );
  assert.equal(
    parseIndex(
      JSON.parse(s.app.memory.download(s.pid, reference(valid)).output),
    ).digest,
    index.digest,
  );
});
test("R2 selected cross-page closure, event/acceptance, coverage lies and unrelated additions reject even with coherent counts/digests/dependencies", async (t) => {
  const s = await setup(t),
    e = s.app.visual.exploration,
    c = await e.importCandidate(
      s.pid,
      reference(s.other),
      await visualFixture(0),
      "Synthetic rights",
    );
  e.selections(s.pid, {
    version: 1,
    workUnit: reference(s.u),
    entries: [
      {
        id: "cross-page-source",
        candidate: reference(c),
        integrity: c.integrity,
        image: c.payload.state.image,
        orientation: "encoded-top-left",
        coordinates: "normalized-original",
        anchor: { kind: "whole" },
        intent: "inspiration",
        preservation: null,
        notes: [],
      },
    ],
  });
  save(s);
  const page = packet({
    type: "design-artifact",
    id: "repair-accepted-page",
    projectId: s.pid,
    payload: {
      moduleId: "website",
      kind: "website-page",
      scope: "page",
      lockedValues: {},
      state: {
        page: {
          version: 1,
          title: "Synthetic accepted page",
          language: "en",
          root: { id: "root", kind: "container", children: [] },
          media: {},
          responsive: [],
          unresolved: [],
        },
        context: {},
        rationale: "Fixture",
        locks: [],
      },
    },
  });
  s.app.workspace.kernel.put(page);
  s.app.workspace.kernel.accept(
    s.pid,
    "page:" + page.id,
    reference(page),
    null,
    "fixture",
    "Explicit acceptance",
  );
  const project = freeze(s, null),
    scoped = freeze(s),
    unrelated = e.createWorkUnit(s.pid, {
      version: 1,
      pageType: "custom",
      label: "Unrelated page",
      source: "Synthetic fixture",
    });
  const cases: [
    string,
    NodePacket<DesignArtifact<Capsule>>,
    (i: MemoryIndex) => void,
  ][] = [
    [
      "selected-source",
      scoped,
      (i) => {
        i.entries = i.entries.filter((x) => x.ref.id !== c.id);
        i.events = i.events
          .filter((x) => x.subject.id !== c.id)
          .map((x) => ({
            ...x,
            related: x.related.filter((r) => r.id !== c.id),
          }));
      },
    ],
    [
      "event",
      scoped,
      (i) => {
        i.events = i.events.slice(1);
      },
    ],
    [
      "acceptance",
      project,
      (i) => {
        i.acceptance = [];
      },
    ],
    [
      "unsupported",
      scoped,
      (i) => {
        i.coverage.unsupported = 99;
      },
    ],
    [
      "omitted",
      scoped,
      (i) => {
        i.coverage.omitted = 2;
      },
    ],
    [
      "unrelated",
      scoped,
      (i) => {
        const global = s.app.memory.index(s.pid),
          added = global.entries.filter((x) => x.ref.id === unrelated.id);
        i.entries.push(...added);
        i.entries.sort((a, b) =>
          a.ref.id < b.ref.id
            ? -1
            : a.ref.id > b.ref.id
              ? 1
              : a.ref.version - b.ref.version,
        );
        i.events = global.events.filter((x) =>
          i.entries.some(
            (e) =>
              e.ref.id === x.subject.id && e.ref.version === x.subject.version,
          ),
        );
      },
    ],
  ];
  for (const [name, source, change] of cases) {
    const fresh = s.app.memory.createCapsule(s.pid, {
      scope: source.payload.state.scope,
      previous: null,
    });
    const forged = mutateCapsule(fresh, change, "forged-" + name);
    if (name === "unrelated") forged.dependencies.push(reference(unrelated)); // rebuild envelope integrity after deliberately adding its otherwise valid foreign-scope closure
    const { integrity: _, ...body } = forged,
      attempt = packet(body),
      before = canonical(s.app.workspace.kernel.ledger(s.pid));
    assert.throws(
      () => s.app.workspace.kernel.put(attempt),
      /completeness|Coverage mismatch/,
    );
    assert.equal(s.app.workspace.kernel.lookup(reference(attempt)), null);
    assert.equal(canonical(s.app.workspace.kernel.ledger(s.pid)), before);
  }
  const good = freeze(s);
  assert.ok(good.payload.state.snapshot.entries.some((x) => x.ref.id === c.id));
  assert.ok(
    !good.payload.state.snapshot.entries.some(
      (x) =>
        x.kind === "raster-membership" &&
        (x.summary as any).workUnit.id === s.u.id,
    ),
  );
  const historical = s.app.memory.download(s.pid, reference(project)).output;
  s.app.workspace.kernel.accept(
    s.pid,
    "page:" + page.id,
    reference(page),
    reference(page),
    "fixture",
    "Later explicit acceptance event",
  );
  revalidatePacket(
    project,
    writePort("work-record"),
    s.app.workspace.kernel.environment(),
  );
  assert.equal(
    s.app.memory.download(s.pid, reference(project)).output,
    historical,
  );
});
test("R2 historical validation retains old snapshots after newer notes; new incomplete snapshots validate canonically and refresh is explicit", async (t) => {
  const s = await setup(t),
    n = save(s),
    cap = freeze(s),
    bytes = s.app.memory.download(s.pid, reference(cap)).output;
  save(s, "Later note text", reference(n));
  save(s, "Another explicit note");
  assert.equal(
    s.app.memory.capsule(s.pid, reference(cap)).currency.status,
    "changed",
  );
  revalidatePacket(
    cap,
    writePort("work-record"),
    s.app.workspace.kernel.environment(),
  );
  assert.equal(s.app.memory.download(s.pid, reference(cap)).output, bytes);
  const refreshed = s.app.memory.createCapsule(s.pid, {
    scope: reference(s.u),
    previous: reference(cap),
  });
  assert.equal(
    s.app.memory.capsule(s.pid, reference(refreshed)).currency.status,
    "current",
  );
  assert.equal(
    canonical(refreshed.payload.state.previous),
    canonical(reference(cap)),
  );
  const db = s.fault();
  db.prepare("DELETE FROM kernel_packets WHERE id=? AND version=1").run(n.id);
  db.close();
  const incomplete = freeze(s),
    valid = mutateCapsule(
      incomplete,
      () => {},
      "independent-valid-missing-snapshot",
    );
  s.app.workspace.kernel.put(valid);
  assert.equal(
    s.app.memory.capsule(s.pid, reference(valid)).currency.status,
    "incomplete",
  );
  assert.equal(s.app.memory.download(s.pid, reference(cap)).output, bytes);
});
