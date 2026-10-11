import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  cpSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { Workspace } from "../src/service/workspace.ts";
import { Exploration } from "../src/service/exploration.ts";
import { Pages } from "../src/service/pages.ts";
import { reference, packet, canonical, revise } from "../src/kernel/packets.ts";
import { InputError } from "../src/service/validation.ts";
import { checksum } from "../src/kernel/raster.ts";
import {
  ExplorationConflict,
  type Selections,
  type Specification,
  type Batch,
  type RasterConcept,
  type Metrics,
} from "../src/modules/website/exploration-contracts.ts";
import type {
  DesignArtifact,
  NodePacket,
  VersionRef,
} from "../src/kernel/contracts.ts";
function setup(t: test.TestContext) {
  const root = mkdtempSync(join(tmpdir(), "bve-v01-"));
  const w = new Workspace(root);
  const stores = [w];
  const track = (store: Workspace): Workspace => {
    stores.push(store);
    return store;
  };
  const p = w.create({
    title: "Synthetic raster trial",
    mode: "freeroam",
    visualOS: null,
    palette: null,
  }).project!;
  const e = new Exploration(w);
  t.after(() => {
    for (const store of stores.reverse()) {
      try {
        store.close();
      } catch {} // Explicitly closed snapshots need no second close.
    }
    rmSync(root, { recursive: true, force: true });
  });
  return { root, w, p, e, track };
}
const image = async (
  color = "#256789",
  format: "png" | "jpeg" | "webp" = "png",
) =>
  sharp({ create: { width: 8, height: 6, channels: 3, background: color } })
    .toFormat(format)
    .toBuffer();
function unit(s: ReturnType<typeof setup>, pageType = "homepage") {
  return s.e.createWorkUnit(s.p.id, {
    version: 1,
    pageType,
    label: "Synthetic " + pageType,
    source: "Explicit fixture",
  });
}
function spec(
  s: Pick<ReturnType<typeof setup>, "w" | "p">,
  u: VersionRef,
  selection: NodePacket<DesignArtifact<Selections>> | null = null,
  count = 3,
): Specification {
  return {
    version: 1,
    compiler: "raster-input-v1",
    project: reference(s.w.project(s.p.id)),
    workUnit: u,
    medium: "website-raster",
    operation: "create",
    selections: selection ? reference(selection) : null,
    selectionSnapshot: selection?.payload.state ?? null,
    rawIntent: "Synthetic fixture exploration",
    count,
    resources: [],
    direction: "fresh",
    brand: { enabled: false },
    sourceScopes: (selection?.payload.state.entries ?? []).map((e) => ({
      entryId: e.id,
      style: "excluded",
      content: "included",
    })),
    facts: [{ path: "title", value: "Fact remains" }],
    constraints: [],
    metricRequests: [],
    provenance: "Authored test input",
    executionAuthorization: null,
  };
}
function selections(
  s: ReturnType<typeof setup>,
  u: VersionRef,
  c: NodePacket<DesignArtifact<RasterConcept>>,
  anchor: Selections["entries"][number]["anchor"] = { kind: "whole" },
): Selections {
  return {
    version: 1,
    workUnit: u,
    entries: [
      {
        id: "entry-1",
        candidate: reference(c),
        integrity: c.integrity,
        image: c.payload.state.image,
        orientation: "encoded-top-left",
        coordinates: "normalized-original",
        anchor,
        intent: "inspiration",
        preservation: null,
        notes: [
          {
            id: "note-1",
            text: "Use the original selected region",
            source: "Authored fixture",
          },
        ],
      },
    ],
  };
}
const envelope = (
  b: NodePacket<DesignArtifact<Batch>>,
  slot: number,
  receiptId: string,
) => ({
  batch: reference(b),
  specHash: b.payload.state.specHash,
  slot,
  receiptId,
  outcome: "succeeded",
  message: "Synthetic fixture result",
  derivation: [],
});
const latestBatch = (
  s: ReturnType<typeof setup>,
  b: NodePacket<DesignArtifact<Batch>>,
) =>
  s.e.read<Batch>(
    s.p.id,
    {
      id: b.id,
      version: s.w.kernel.currentVersion(b.id)!,
      freshness: "pinned",
    },
    "raster-batch",
  );

test("two independent page work units, multi-selection notes, resize, reopen and media-only raster closure", async (t) => {
  const s = setup(t),
    home = unit(s),
    about = unit(s, "about");
  const a = await s.e.importCandidate(
      s.p.id,
      reference(home),
      await image(),
      "Synthetic rights",
      "synthetic",
    ),
    b = await s.e.importCandidate(
      s.p.id,
      reference(about),
      await image("#ee8899"),
      "Synthetic rights",
      "synthetic",
    );
  assert.deepEqual(a.dependencies, [a.payload.state.media]);
  assert.equal(a.contextRefs.length, 0);
  assert.deepEqual(
    (await s.e.raster(s.p.id, reference(a))).bytes,
    await image(),
  );
  const input = selections(s, reference(home), a, {
    kind: "rectangle",
    x: 0.25,
    y: 0.25,
    width: 0.5,
    height: 0.5,
  });
  input.entries.push({
    ...selections(s, reference(home), b, {
      kind: "ellipse",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    }).entries[0]!,
    id: "entry-2",
  });
  const sel = s.e.selections(s.p.id, input),
    other = s.e.selections(s.p.id, selections(s, reference(about), b));
  const snapshot = canonical(sel);
  const rectangle = input.entries[0]!.anchor as { x: number; width: number };
  assert.equal(rectangle.x * 80, 20);
  assert.equal(rectangle.x * 800, 200);
  assert.equal(rectangle.width * a.payload.state.image.width, 4);
  assert.equal(
    s.e
      .state(s.p.id, reference(home))
      .filter(
        (p) =>
          (p.payload as DesignArtifact<unknown>).kind === "raster-membership",
      ).length,
    1,
  );
  assert.equal(
    s.e
      .state(s.p.id, reference(about))
      .filter(
        (p) =>
          (p.payload as DesignArtifact<unknown>).kind === "raster-membership",
      ).length,
    1,
  );
  s.w.close();
  const reopened = s.track(new Workspace(s.root));
  const e = new Exploration(reopened);
  assert.equal(
    canonical(e.read(s.p.id, reference(sel), "raster-selections")),
    snapshot,
  );
  assert.equal(
    e.read<Selections>(s.p.id, reference(other), "raster-selections").payload
      .state.entries[0]!.candidate.id,
    b.id,
  );
  const foreign = reopened.create({
    title: "Foreign",
    mode: "freeroam",
    visualOS: null,
    palette: null,
  }).project!;
  assert.throws(() => e.selections(foreign.id, input), /Foreign/);
});

test("corrupt/foreign media, descriptor, role, dependency and mask combinations fail closed at kernel", async (t) => {
  const s = setup(t),
    u = unit(s),
    c = await s.e.importCandidate(
      s.p.id,
      reference(u),
      await image(),
      "Synthetic rights",
    );
  const rewrite = (changes: Record<string, unknown>) => {
    const { integrity: _, ...body } = c;
    return packet({
      ...body,
      id: "forged-" + Math.random().toString(36).slice(2),
      ...changes,
    });
  };
  assert.throws(() => s.w.kernel.put(rewrite({ type: "work-record" })), /role/);
  assert.throws(
    () =>
      s.w.kernel.put(
        rewrite({ dependencies: [reference(u), c.payload.state.media] }),
      ),
    /dependencies/,
  );
  assert.throws(
    () => s.w.kernel.put(rewrite({ contextRefs: [reference(s.p)] })),
    /envelope/,
  );
  const fake = {
    ...c.payload.state,
    image: { ...c.payload.state.image, width: 7 },
  };
  assert.throws(
    () => s.w.kernel.put(rewrite({ payload: { ...c.payload, state: fake } })),
    /descriptor/,
  );
  const media = s.w.kernel.get<
    DesignArtifact<{ image: RasterConcept["image"]; permission: string }>
  >(c.payload.state.media);
  const badImage = { ...c.payload.state.image, width: 7 };
  const forgedMedia = packet({
    type: "media-asset",
    id: "forged-media",
    projectId: s.p.id,
    assets: media.assets,
    payload: {
      ...media.payload,
      state: { ...media.payload.state, image: badImage },
    },
  });
  s.w.kernel.put(forgedMedia);
  assert.throws(
    () =>
      s.w.kernel.put(
        rewrite({
          payload: {
            ...c.payload,
            state: { ...fake, media: reference(forgedMedia) },
          },
          dependencies: [reference(forgedMedia)],
        }),
      ),
    /bytes\/dimensions/,
  );
  const foreign = s.w.create({
      title: "Foreign",
      mode: "freeroam",
      visualOS: null,
      palette: null,
    }).project!,
    fu = s.e.createWorkUnit(foreign.id, {
      version: 1,
      pageType: "about",
      label: "Foreign unit",
      source: "fixture",
    }),
    fc = await s.e.importCandidate(
      foreign.id,
      reference(fu),
      await image(),
      "rights",
    );
  assert.throws(
    () =>
      s.w.kernel.put(
        rewrite({
          payload: {
            ...c.payload,
            state: { ...c.payload.state, media: fc.payload.state.media },
          },
          dependencies: [fc.payload.state.media],
        }),
      ),
    /owner/,
  );
  const mask = {
    kind: "mask" as const,
    width: 8,
    height: 6,
    pixels: Array(48).fill(1),
    hash: "0".repeat(64),
  };
  assert.throws(
    () => s.e.selections(s.p.id, selections(s, reference(u), c, mask)),
    /Mask binding/,
  );
  mask.hash = checksum(Uint8Array.from(mask.pixels));
  const sel = s.e.selections(s.p.id, selections(s, reference(u), c, mask));
  assert.equal(sel.payload.state.entries[0]!.anchor.kind, "mask");
  writeFileSync(
    join(s.w.assets.root, c.payload.state.image.id),
    Buffer.from("corrupt"),
  );
  await assert.rejects(s.e.raster(s.p.id, reference(c)), /corrupt|unavailable/);
});

test("supported raster formats retain encoded geometry and exact bytes", async (t) => {
  const s = setup(t),
    u = unit(s);
  for (const format of ["png", "jpeg", "webp"] as const) {
    const bytes = await image("#112233", format),
      c = await s.e.importCandidate(
        s.p.id,
        reference(u),
        bytes,
        "fixture rights",
      );
    assert.deepEqual((await s.e.raster(s.p.id, reference(c))).bytes, bytes);
  }
});

test("spec immutability, count bounds, independent direction/brand and preservation conflicts", async (t) => {
  const s = setup(t),
    u = unit(s),
    c = await s.e.importCandidate(
      s.p.id,
      reference(u),
      await image(),
      "rights",
    ),
    sel = s.e.selections(s.p.id, selections(s, reference(u), c));
  for (const count of [0, 7, 1.5, NaN])
    assert.throws(() =>
      s.e.freeze(s.p.id, { ...spec(s, reference(u), sel), count }),
    );
  for (const count of [1, 6])
    assert.equal(
      s.e.freeze(s.p.id, spec(s, reference(u), sel, count)).payload.state.count,
      count,
    );
  const q = s.e.freeze(s.p.id, spec(s, reference(u), sel));
  assert.throws(
    () =>
      s.w.kernel.put(
        revise(
          q,
          { ...q.payload, state: { ...q.payload.state, rawIntent: "changed" } },
          "fixture",
          "edit",
        ),
      ),
    /immutable/,
  );
  const changed = structuredClone(sel.payload.state);
  changed.entries[0]!.notes[0]!.text = "New note";
  const newSel = s.e.selections(s.p.id, changed, reference(sel));
  assert.notEqual(newSel.integrity, sel.integrity);
  assert.equal(
    s.e.read<Specification>(s.p.id, reference(q), "raster-specification")
      .payload.state.selectionSnapshot!.entries[0]!.notes[0]!.text,
    "Use the original selected region",
  );
  const brand = packet({
    type: "visual-os",
    id: "brand-fixture",
    approval: "accepted",
    payload: {
      values: {
        color: { value: "#112233", approved: true },
        pending: { value: "not approved", approved: false },
      },
      placeholders: {},
    },
  });
  s.w.kernel.put(brand);
  for (const direction of ["fresh", "follow"] as const)
    for (const enabled of [false, true]) {
      const input = spec(s, reference(u), newSel);
      input.direction = direction;
      input.brand = enabled
        ? {
            enabled: true,
            source: reference(brand),
            integrity: brand.integrity,
            values: { color: "#112233" },
          }
        : { enabled: false };
      const frozen = s.e.freeze(s.p.id, input);
      assert.equal(frozen.payload.state.direction, direction);
      assert.equal(frozen.payload.state.brand.enabled, enabled);
      assert.deepEqual(frozen.payload.state.facts, input.facts);
    }
  assert.throws(
    () =>
      s.e.freeze(s.p.id, {
        ...spec(s, reference(u)),
        brand: {
          enabled: true,
          source: reference(brand),
          integrity: brand.integrity,
          values: { color: "invented" },
        },
      }),
    /frozen values/,
  );
  assert.throws(
    () =>
      s.e.freeze(s.p.id, {
        ...spec(s, reference(u)),
        constraints: [{ path: "title", value: "contradiction" }],
      }),
    ExplorationConflict,
  );
  const lock = selections(s, reference(u), c);
  lock.entries[0]!.intent = "exact";
  assert.throws(() => s.e.selections(s.p.id, lock), /predicate/);
  lock.entries[0]!.preservation = {
    predicate: "retained-bytes",
    target: "output",
  };
  const exact = s.e.selections(s.p.id, lock);
  assert.throws(
    () =>
      s.e.freeze(s.p.id, {
        ...spec(s, reference(u), exact),
        sourceScopes: [
          { entryId: "entry-1", style: "excluded", content: "excluded" },
        ],
      }),
    ExplorationConflict,
  );
  const c2 = await s.e.importCandidate(
    s.p.id,
    reference(u),
    await image("#998877"),
    "rights",
  );
  lock.entries.push({
    ...lock.entries[0]!,
    id: "conflicting",
    candidate: reference(c2),
    integrity: c2.integrity,
    image: c2.payload.state.image,
  });
  assert.throws(() => s.e.selections(s.p.id, lock), ExplorationConflict);
});

test("valid/invalid/valid per-attempt atomic retention, envelope rejection, receipt idempotency and no acceptance", async (t) => {
  const s = setup(t),
    u = unit(s),
    q = s.e.freeze(s.p.id, spec(s, reference(u))),
    b = s.e.prepareBatch(s.p.id, reference(q));
  const before = s.w.kernel.ledger(s.p.id).events.length;
  await assert.rejects(
    s.e.registerSynthetic(
      s.p.id,
      { ...envelope(b, 1, "untrusted"), specHash: "0".repeat(64) },
      await image(),
    ),
    /spec hash/,
  );
  assert.equal(s.w.kernel.ledger(s.p.id).events.length, before);
  const input = envelope(b, 1, "receipt-1"),
    bytes = await image();
  const receipt = await s.e.registerSynthetic(s.p.id, input, bytes);
  const events = s.w.kernel.ledger(s.p.id).events.length;
  assert.deepEqual(await s.e.registerSynthetic(s.p.id, input, bytes), receipt);
  assert.equal(s.w.kernel.ledger(s.p.id).events.length, events);
  await assert.rejects(
    s.e.registerSynthetic(s.p.id, input, await image("#778899")),
    /identity conflict/,
  );
  await assert.rejects(
    s.e.registerSynthetic(s.p.id, envelope(b, 2, "stale"), bytes),
    /Stale/,
  );
  const invalid = await s.e.registerSynthetic(
    s.p.id,
    envelope(latestBatch(s, b), 2, "receipt-2"),
    Buffer.from("not an image"),
  );
  assert.equal(invalid.payload.state.outcome, "invalid");
  assert.equal(invalid.payload.state.result, null);
  await s.e.registerSynthetic(
    s.p.id,
    envelope(latestBatch(s, b), 3, "receipt-3"),
    await image("#aabbcc"),
  );
  const end = latestBatch(s, b);
  assert.deepEqual(
    end.payload.state.attempts.map((a) => a.status),
    ["succeeded", "invalid", "succeeded"],
  );
  assert.equal(
    s.w.kernel
      .latestPackets()
      .filter(
        (p) => (p.payload as DesignArtifact<unknown>).kind === "raster-concept",
      ).length,
    2,
  );
  assert.equal(
    s.w.kernel.ledger(s.p.id).events.filter((e) => e.kind === "acceptance")
      .length,
    0,
  );
  assert.equal(s.w.kernel.selected(s.p.id, "design"), null);
  assert.throws(
    () =>
      s.w.kernel.put(
        revise(
          end,
          {
            ...end.payload,
            state: {
              ...end.payload.state,
              attempts: end.payload.state.attempts.map((a) => ({
                ...a,
                status: "pending" as const,
                result: null,
                receipt: null,
              })),
            },
          },
          "fixture",
          "reset",
        ),
      ),
    /reset|replay/,
  );
  const foreign = s.w.create({
    title: "Foreign",
    mode: "freeroam",
    visualOS: null,
    palette: null,
  }).project!;
  await assert.rejects(
    s.e.registerSynthetic(foreign.id, input, bytes),
    /identity conflict/,
  );
});

test("cancellation, uncertain late receipts, restart without replay, manual retry lineage and closed restore", async (t) => {
  const s = setup(t),
    u = unit(s),
    q = s.e.freeze(s.p.id, spec(s, reference(u))),
    b = s.e.prepareBatch(s.p.id, reference(q));
  const running = s.e.markRunning(s.p.id, reference(b), 1),
    cancelled = s.e.cancel(s.p.id, reference(running));
  assert.deepEqual(
    cancelled.payload.state.attempts.map((a) => a.status),
    ["uncertain", "cancelled", "cancelled"],
  );
  const late = await s.e.registerSynthetic(
    s.p.id,
    envelope(cancelled, 1, "late"),
    await image(),
  );
  assert.equal(late.payload.state.outcome, "uncertain");
  assert.equal(late.payload.state.result, null);
  assert.equal(
    latestBatch(s, b).payload.state.attempts[0]!.status,
    "uncertain",
  );
  const retry = s.e.prepareBatch(s.p.id, reference(q), {
    batch: reference(latestBatch(s, b)),
    slot: 1,
  });
  assert.equal(retry.payload.state.retryOf!.batch.id, b.id);
  assert.equal(retry.payload.state.executionAuthorization, null);
  assert.throws(
    () =>
      s.e.prepareBatch(s.p.id, reference(q), {
        batch: reference(retry),
        slot: 1,
      }),
    /consumed/,
  );
  const logical = canonical(s.w.kernel.latestPackets()),
    events = canonical(s.w.kernel.ledger(s.p.id));
  s.w.close();
  const backup = s.root + "-backup";
  t.after(() => rmSync(backup, { recursive: true, force: true }));
  cpSync(s.root, backup, { recursive: true });
  for (const root of [s.root, backup]) {
    const w = new Workspace(root),
      e = new Exploration(w);
    assert.equal(canonical(w.kernel.latestPackets()), logical);
    assert.equal(canonical(w.kernel.ledger(s.p.id)), events);
    assert.equal(
      e
        .read<Batch>(s.p.id, reference(retry), "raster-batch")
        .payload.state.attempts.every((a) => a.status === "pending"),
      true,
    );
    w.close();
  }
});

test("Level2 requested/inferred/observed remain version-bound and unsupported observations fail", async (t) => {
  const s = setup(t),
    u = unit(s),
    c = await s.e.importCandidate(
      s.p.id,
      reference(u),
      await image(),
      "rights",
    );
  const base = {
    key: "density",
    value: 65,
    provenance: "Explicit synthetic intent",
    scale: { kind: "continuous" as const, min: 0, max: 100, unit: "relative" },
  };
  const input: Metrics = {
    version: 1,
    candidate: reference(c),
    integrity: c.integrity,
    values: [
      { ...base, status: "requested" },
      { ...base, status: "inferred", value: 20 },
      {
        key: "image-width",
        status: "observed",
        value: 8,
        provenance: "Decoded raster header",
        scale: { kind: "continuous", min: 1, max: 8192, unit: "px" },
      },
    ],
  };
  const m = s.e.metrics(s.p.id, input);
  assert.deepEqual(
    m.payload.state.values.map((v) => [v.status, v.value]),
    [
      ["requested", 65],
      ["inferred", 20],
      ["observed", 8],
    ],
  );
  assert.throws(
    () =>
      s.e.metrics(s.p.id, {
        ...input,
        values: [{ ...base, status: "observed" }],
      }),
    /Unsupported/,
  );
  assert.throws(
    () =>
      s.e.metrics(s.p.id, {
        ...input,
        values: [{ ...input.values[2]!, value: 9 }],
      }),
    /false observed/,
  );
  const newer = s.e.metrics(s.p.id, { ...input, values: [{ ...base, status: "requested", value: 70 }] }, reference(m));
  assert.equal(newer.version, 2);
  const reopened = s.track(new Workspace(s.root));
  const e = new Exploration(reopened);
  assert.equal(e.read(s.p.id, reference(m), "raster-metrics").integrity, m.integrity);
  assert.equal(e.read(s.p.id, reference(newer), "raster-metrics").integrity, newer.integrity);
  assert.deepEqual(
    (await s.e.raster(s.p.id, reference(c))).bytes,
    await image(),
  );
});

test("legacy accepted page packets, bytes, hashes, pointers and standalone exports survive new records and closed-root restore", async (t) => {
  const s = setup(t),
    pages = new Pages(s.w);
  const oldBytes = await image("#112255");
  const { decode } = await import("../src/service/assets.ts");
  const oldImage = await decode(oldBytes);
  s.w.assets.save(oldBytes, oldImage);
  const oldMedia = packet({
    type: "media-asset",
    id: "old-media",
    projectId: s.p.id,
    assets: [{ id: oldImage.id, checksum: oldImage.checksum }],
    payload: {
      moduleId: "website",
      kind: "page-media",
      scope: "media",
      lockedValues: {},
      state: {
        image: oldImage,
        label: "Pre-V01 media",
        role: "placeable",
        permission: "Synthetic legacy rights",
      },
    },
  });
  s.w.kernel.put(oldMedia);
  const page = packet({
    type: "design-artifact",
    id: "legacy-page",
    dependencies: [reference(oldMedia)],
    assets: [{ id: oldImage.id, checksum: oldImage.checksum }],
    projectId: s.p.id,
    payload: {
      moduleId: "website",
      kind: "website-page",
      scope: "page",
      lockedValues: {},
      state: {
        page: {
          version: 1,
          title: "Legacy synthetic page",
          language: "en",
          root: {
            id: "root",
            kind: "container",
            children: [
              { id: "text", kind: "text", text: "Existing bytes" },
              {
                id: "image",
                kind: "media",
                slot: "main",
                alt: "Legacy image",
                decorative: false,
              },
            ],
          },
          media: { main: { asset: reference(oldMedia), image: oldImage } },
          responsive: [],
          unresolved: [],
        },
        context: {},
        rationale: "Synthetic legacy fixture",
        locks: [],
      },
    },
  });
  s.w.kernel.put(page);
  s.w.kernel.accept(
    s.p.id,
    "page:legacy",
    reference(page),
    null,
    "fixture",
    "Synthetic reviewed page",
  );
  const prior = canonical(page),
    pointer = s.w.kernel.selected(s.p.id, "page:legacy"),
    exportBefore = await pages.export(s.p.id, reference(page));
  const u = unit(s),
    c = await s.e.importCandidate(
      s.p.id,
      reference(u),
      await image(),
      "rights",
    ),
    sel = s.e.selections(s.p.id, selections(s, reference(u), c)),
    q = s.e.freeze(s.p.id, spec(s, reference(u), sel)),
    b = s.e.prepareBatch(s.p.id, reference(q));
  await s.e.registerSynthetic(
    s.p.id,
    envelope(b, 1, "legacy-compat"),
    await image("#aabbcc"),
  );
  assert.deepEqual(s.w.assets.read(oldImage.id), oldBytes);
  assert.equal(
    canonical(s.w.kernel.get(reference(oldMedia))),
    canonical(oldMedia),
  );
  assert.equal(canonical(s.w.kernel.get(reference(page))), prior);
  assert.deepEqual(s.w.kernel.selected(s.p.id, "page:legacy"), pointer);
  assert.deepEqual(await pages.export(s.p.id, reference(page)), exportBefore);
  const mediaBytes = readFileSync(
    join(s.w.assets.root, c.payload.state.image.id),
  );
  s.w.close();
  const restore = s.root + "-restore";
  t.after(() => rmSync(restore, { recursive: true, force: true }));
  cpSync(s.root, restore, { recursive: true });
  const w = s.track(new Workspace(restore));
  assert.deepEqual(w.assets.read(oldImage.id), oldBytes);
  assert.equal(
    canonical(w.kernel.get(reference(oldMedia))),
    canonical(oldMedia),
  );
  assert.equal(canonical(w.kernel.get(reference(page))), prior);
  assert.deepEqual(w.kernel.selected(s.p.id, "page:legacy"), pointer);
  assert.deepEqual(
    readFileSync(join(w.assets.root, c.payload.state.image.id)),
    mediaBytes,
  );
  assert.deepEqual(
    await new Pages(w).export(s.p.id, reference(page)),
    exportBefore,
  );
});

test("old anchors and notes retain their exact raster revision after replacement and standalone reconstruction", async (t) => {
  const s = setup(t),
    u = unit(s),
    bytes = await image(),
    c = await s.e.importCandidate(s.p.id, reference(u), bytes, "rights");
  const sel = s.e.selections(s.p.id, selections(s, reference(u), c)),
    q = s.e.freeze(s.p.id, spec(s, reference(u), sel));
  const newer = await s.e.importCandidate(
    s.p.id,
    reference(u),
    await image("#ff0000"),
    "new rights",
    "imported",
    reference(c),
  );
  assert.equal(newer.id, c.id);
  assert.equal(newer.version, 2);
  assert.notEqual(newer.integrity, c.integrity);
  assert.deepEqual(newer.dependencies, [newer.payload.state.media]);
  assert.equal(
    s.e.read<Selections>(s.p.id, reference(sel), "raster-selections").payload
      .state.entries[0]!.candidate.version,
    1,
  );
  assert.equal(
    s.e.read<Specification>(s.p.id, reference(q), "raster-specification")
      .payload.state.selectionSnapshot!.entries[0]!.image.checksum,
    c.payload.state.image.checksum,
  );
  assert.deepEqual((await s.e.raster(s.p.id, reference(c))).bytes, bytes);
  assert.notDeepEqual(
    (await s.e.raster(s.p.id, reference(newer))).bytes,
    bytes,
  );
  const media = s.w.kernel.get<
    DesignArtifact<import("../src/modules/website/page.ts").MediaState>
  >(c.payload.state.media);
  s.w.close();
  const { reconstructRaster } = await import("../src/service/exploration.ts");
  assert.deepEqual(await reconstructRaster(c, media, bytes), bytes);
  await assert.rejects(reconstructRaster(newer, media, bytes), /closure/);
});

test("concurrent duplicates collect one receipt, result and event set; transaction failure retains no partial attempt", async (t) => {
  const s = setup(t),
    u = unit(s),
    q = s.e.freeze(s.p.id, spec(s, reference(u), null, 1)),
    b = s.e.prepareBatch(s.p.id, reference(q)),
    bytes = await image(),
    input = envelope(b, 1, "concurrent");
  const [a, c] = await Promise.all([
    s.e.registerSynthetic(s.p.id, input, bytes),
    s.e.registerSynthetic(s.p.id, input, bytes),
  ]);
  assert.equal(a.id, c.id);
  assert.equal(
    s.w.kernel
      .latestPackets()
      .filter(
        (p) => (p.payload as DesignArtifact<unknown>).kind === "raster-receipt",
      ).length,
    1,
  );
  assert.equal(
    s.w.kernel
      .latestPackets()
      .filter(
        (p) => (p.payload as DesignArtifact<unknown>).kind === "raster-concept",
      ).length,
    1,
  );
  const retry = s.e.prepareBatch(s.p.id, reference(q), {
    batch: reference(latestBatch(s, b)),
    slot: 1,
  });
  const before = canonical(s.w.kernel.latestPackets()),
    events = canonical(s.w.kernel.ledger(s.p.id));
  const original = s.w.kernel.putMany.bind(s.w.kernel);
  s.w.kernel.putMany = (packets) =>
    original(
      packets.map((p, i) =>
        i === packets.length - 1 ? { ...p, integrity: "0".repeat(64) } : p,
      ),
    );
  await assert.rejects(
    s.e.registerSynthetic(
      s.p.id,
      envelope(retry, 1, "transaction"),
      await image("#998899"),
    ),
    /integrity/,
  );
  assert.equal(canonical(s.w.kernel.latestPackets()), before);
  assert.equal(canonical(s.w.kernel.ledger(s.p.id)), events);
  s.w.kernel.putMany = original;
  const save = s.w.assets.save.bind(s.w.assets);
  for (const fault of [new Error("Injected storage failure"), new InputError("Injected storage failure")]) {
    s.w.assets.save = () => { throw fault; };
    await assert.rejects(
      s.e.registerSynthetic(s.p.id, envelope(retry, 1, "storage"), await image("#667788")),
      (error) => error === fault,
    );
    assert.equal(canonical(s.w.kernel.latestPackets()), before);
    assert.equal(canonical(s.w.kernel.ledger(s.p.id)), events);
  }
  s.w.assets.save = save;
  const receipt = await s.e.registerSynthetic(
    s.p.id,
    envelope(retry, 1, "transaction"),
    await image("#998899"),
  );
  assert.equal(receipt.payload.state.outcome, "succeeded");
});

test("running restart requires explicit uncertainty recovery; no replay and late evidence remains reference-only", async (t) => {
  const s = setup(t),
    u = unit(s),
    q = s.e.freeze(s.p.id, spec(s, reference(u), null, 1)),
    b = s.e.prepareBatch(s.p.id, reference(q)),
    running = s.e.markRunning(s.p.id, reference(b), 1);
  s.w.close();
  const w = s.track(new Workspace(s.root));
  const e = new Exploration(w),
    before = canonical(w.kernel.latestPackets());
  assert.equal(
    e.read<Batch>(s.p.id, reference(running), "raster-batch").payload.state
      .attempts[0]!.status,
    "running",
  );
  assert.equal(canonical(w.kernel.latestPackets()), before);
  const recovered = e.recoverSyntheticRunning(s.p.id, reference(running));
  assert.equal(recovered.payload.state.attempts[0]!.status, "uncertain");
  const count = w.kernel.ledger(s.p.id).events.length;
  assert.equal(
    e.recoverSyntheticRunning(s.p.id, reference(recovered)).id,
    recovered.id,
  );
  assert.equal(w.kernel.ledger(s.p.id).events.length, count);
  const receipt = await e.registerSynthetic(
    s.p.id,
    envelope(recovered, 1, "unknown-result"),
    await image(),
  );
  assert.equal(receipt.payload.state.outcome, "uncertain");
  assert.equal(receipt.payload.state.result, null);
  assert.ok(receipt.payload.state.evidence);
  const media = w.kernel.get<DesignArtifact<{ role: string }>>(
    receipt.payload.state.evidence!.media,
  );
  assert.equal(media.payload.state.role, "reference");
  assert.equal(
    w.kernel
      .latestPackets()
      .filter(
        (p) => (p.payload as DesignArtifact<unknown>).kind === "raster-concept",
      ).length,
    0,
  );
});

test("direct forged receipt scope and stale freeze fail at persistence, with unsupported exact promises unavailable", async (t) => {
  const s = setup(t),
    u = unit(s),
    c = await s.e.importCandidate(
      s.p.id,
      reference(u),
      await image(),
      "rights",
    ),
    sel = s.e.selections(s.p.id, selections(s, reference(u), c));
  const q = s.e.freeze(s.p.id, spec(s, reference(u), sel, 1)),
    b = s.e.prepareBatch(s.p.id, reference(q));
  const changed = structuredClone(sel.payload.state);
  changed.entries[0]!.notes[0]!.text = "New scope";
  s.e.selections(s.p.id, changed, reference(sel));
  const { integrity: _, ...body } = q;
  assert.throws(
    () => s.w.kernel.put(packet({ ...body, id: "stale-spec" })),
    /Stale specification/,
  );
  const before = s.w.kernel.ledger(s.p.id).events.length;
  await assert.rejects(
    s.e.registerSynthetic(
      s.p.id,
      { ...envelope(b, 1, "invalid-envelope"), outcome: "failed" },
      await image(),
    ),
    /Non-success envelope/,
  );
  assert.equal(s.w.kernel.ledger(s.p.id).events.length, before);
  const receipt = await s.e.registerSynthetic(
    s.p.id,
    envelope(b, 1, "valid-receipt"),
    await image(),
  );
  const { integrity: _r, ...rbody } = receipt;
  assert.throws(
    () => s.w.kernel.put(packet({ ...rbody, id: "forged-receipt" })),
    /identity binding/,
  );
  const exact = selections(s, reference(u), c);
  exact.entries[0]!.intent = "exact";
  exact.entries[0]!.preservation = {
    predicate: "pixel-to-layout" as "retained-bytes",
    target: "output",
  };
  assert.throws(() => s.e.selections(s.p.id, exact), /Unsupported/);
  assert.throws(
    () =>
      s.e.freeze(s.p.id, {
        ...spec(s, reference(u)),
        facts: [{ path: "style", value: { color: "blue" } }],
        constraints: [{ path: "style.color", value: "red" }],
      }),
    ExplorationConflict,
  );
});

test("closed v1 legacy SQLite and RGB media remain byte-identical after additive V01 and matching-code restore", async (t) => {
  const { Store } = await import("../src/store.ts"),
    { website, sourceRaster } = await import("../src/fixtures.ts");
  const root = mkdtempSync(join(tmpdir(), "bve-v01-legacy-")),
    restore = root + "-restore";
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(restore, { recursive: true, force: true });
  });
  const legacy = new Store(root),
    project = website();
  legacy.createProject(project);
  const asset = legacy.addAsset(project.id, "hero", sourceRaster());
  legacy.accept(
    project.id,
    "hero",
    asset.id,
    null,
    "fixture",
    "Legacy synthetic acceptance",
  );
  const handoff = canonical(legacy.handoff(project.id)),
    snapshot = canonical(legacy.snapshot(project.id));
  legacy.close();
  const dbBefore = readFileSync(join(root, "workspace.sqlite")),
    bytesBefore = readFileSync(join(root, asset.path));
  const w = new Workspace(root),
    p = w.create({
      title: "Additive trial",
      mode: "freeroam",
      visualOS: null,
      palette: null,
    }).project!,
    e = new Exploration(w),
    u = e.createWorkUnit(p.id, {
      version: 1,
      pageType: "homepage",
      label: "Synthetic home",
      source: "fixture",
    });
  await e.importCandidate(
    p.id,
    reference(u),
    await image(),
    "Synthetic rights",
  );
  const q = e.freeze(p.id, {
      ...spec({ w, p }, reference(u)),
      count: 1,
    }),
    b = e.prepareBatch(p.id, reference(q));
  await e.registerSynthetic(
    p.id,
    envelope(b, 1, "legacy-store"),
    await image("#33cc99"),
  );
  w.close();
  assert.deepEqual(readFileSync(join(root, "workspace.sqlite")), dbBefore);
  assert.deepEqual(readFileSync(join(root, asset.path)), bytesBefore);
  cpSync(root, restore, { recursive: true });
  const restored = new Workspace(restore);
  assert.ok(restored.legacy.exists(asset.id, asset.checksum));
  assert.equal(
    new Exploration(restored).read(p.id, reference(q), "raster-specification")
      .integrity,
    q.integrity,
  );
  restored.close();
  assert.deepEqual(readFileSync(join(restore, "workspace.sqlite")), dbBefore);
  assert.deepEqual(readFileSync(join(restore, asset.path)), bytesBefore);
  // The old writer's constructor rewrites PRAGMA metadata. Run its semantic checks only in a third disposable copy.
  const legacyCheck = root + "-legacy-check";
  t.after(() => rmSync(legacyCheck, { recursive: true, force: true }));
  cpSync(restore, legacyCheck, { recursive: true });
  const check = new Store(legacyCheck);
  assert.equal(canonical(check.handoff(project.id)), handoff);
  assert.equal(canonical(check.snapshot(project.id)), snapshot);
  check.close();
});

test("whole images retain storage bounds, regions retain 4 MP bound, and brand revisions cannot alter frozen pixels or values", async (t) => {
  const s = setup(t),
    u = unit(s),
    bytes = await sharp({
      create: { width: 2001, height: 2000, channels: 3, background: "#223344" },
    })
      .png()
      .toBuffer(),
    c = await s.e.importCandidate(s.p.id, reference(u), bytes, "rights");
  const whole = s.e.selections(s.p.id, selections(s, reference(u), c));
  const events = s.w.kernel.ledger(s.p.id).events.length;
  assert.throws(
    () =>
      s.e.selections(
        s.p.id,
        selections(s, reference(u), c, {
          kind: "rectangle",
          x: 0,
          y: 0,
          width: 1,
          height: 1,
        }),
      ),
    /4 MP/,
  );
  assert.equal(s.w.kernel.ledger(s.p.id).events.length, events);
  const brand = packet({
    type: "visual-os",
    id: "revised-brand",
    approval: "accepted",
    payload: {
      values: { palette: { value: ["#112233"], approved: true } },
      placeholders: {},
    },
  });
  s.w.kernel.put(brand);
  const input = spec(s, reference(u), whole);
  input.brand = {
    enabled: true,
    source: reference(brand),
    integrity: brand.integrity,
    values: { palette: ["#112233"] },
  };
  input.constraints = [{ path: "requested-font", value: "Georgia" }];
  const q = s.e.freeze(s.p.id, input);
  s.w.kernel.put(
    revise(
      brand,
      {
        ...brand.payload,
        values: { palette: { value: ["#ffffff"], approved: true } },
      },
      "fixture",
      "Later approved brand revision",
    ),
  );
  const stored = s.e.read<Specification>(
    s.p.id,
    reference(q),
    "raster-specification",
  ).payload.state;
  assert.deepEqual(stored.brand, input.brand);
  assert.deepEqual(stored.constraints, input.constraints);
  assert.deepEqual((await s.e.raster(s.p.id, reference(c))).bytes, bytes);
  assert.equal(Object.hasOwn(c.payload.state, "requested-font"), false);
});


test("storage corruption leaves packets, events and slot unchanged until explicit fixture repair", async (t) => {
  const s = setup(t), u = unit(s), bytes = await image();
  const c = await s.e.importCandidate(s.p.id, reference(u), bytes, "rights");
  const q = s.e.freeze(s.p.id, spec(s, reference(u), null, 1));
  const b = s.e.prepareBatch(s.p.id, reference(q));
  const input = envelope(b, 1, "storage-integrity");
  const path = join(s.w.assets.root, c.payload.state.image.id);
  const damaged = Buffer.from("Synthetic storage corruption");
  writeFileSync(path, damaged);
  const packets = canonical(s.w.kernel.latestPackets());
  const events = canonical(s.w.kernel.ledger(s.p.id));
  await assert.rejects(s.e.registerSynthetic(s.p.id, input, bytes), /checksum/i);
  assert.equal(canonical(s.w.kernel.latestPackets()), packets);
  assert.equal(canonical(s.w.kernel.ledger(s.p.id)), events);
  assert.deepEqual(readFileSync(path), damaged);
  assert.equal(latestBatch(s, b).payload.state.attempts[0]!.status, "pending");
  // Explicit restoration is restricted to this disposable synthetic fixture.
  writeFileSync(path, bytes);
  const receipt = await s.e.registerSynthetic(s.p.id, input, bytes);
  assert.equal(receipt.payload.state.outcome, "succeeded");
  const committed = canonical(s.w.kernel.ledger(s.p.id));
  assert.equal((await s.e.registerSynthetic(s.p.id, input, bytes)).id, receipt.id);
  assert.equal(canonical(s.w.kernel.ledger(s.p.id)), committed);
});

test("V01 semantic identities cannot revise between kinds or cross legacy boundaries", (t) => {
  const s = setup(t), u = unit(s);
  const q = s.e.freeze(s.p.id, spec(s, reference(u), null, 1));
  const sel = s.e.selections(s.p.id, { version: 1, workUnit: reference(u), entries: [] });
  const legacy = packet<DesignArtifact<unknown>>({ id: "legacy-semantic-fixture", type: "work-record", projectId: s.p.id, payload: {
    moduleId: "website", kind: "page-migration", scope: "fixture", lockedValues: {},
    state: { source: reference(u), target: reference(u), sourceIntegrity: u.integrity, losses: [] },
  }});
  s.w.kernel.put(legacy);
  const before = canonical(s.w.kernel.latestPackets());
  const events = canonical(s.w.kernel.ledger(s.p.id));
  const change = (source: NodePacket<DesignArtifact<unknown>>, payload: DesignArtifact<unknown>, dependencies: VersionRef[]) => {
    const { integrity, ...body } = revise(source, payload, "fixture", "Forbidden semantic revision");
    assert.throws(() => s.w.kernel.put(packet({ ...body, dependencies })), /kind|immutable|lineage/i);
    assert.equal(canonical(s.w.kernel.latestPackets()), before);
    assert.equal(canonical(s.w.kernel.ledger(s.p.id)), events);
  };
  change(q, sel.payload, [reference(u)]);
  change(q, legacy.payload, []);
  change(legacy, sel.payload, [reference(u)]);
  // Same-kind mutable revisions remain supported and historical packets revalidate.
  const newer = s.e.selections(s.p.id, sel.payload.state, reference(sel));
  assert.equal(newer.version, 2);
  const reopened = s.track(new Workspace(s.root));
  const e = new Exploration(reopened);
  assert.equal(e.read(s.p.id, reference(q), "raster-specification").integrity, q.integrity);
  assert.equal(e.read(s.p.id, reference(sel), "raster-selections").integrity, sel.integrity);
  assert.equal(e.read(s.p.id, reference(newer), "raster-selections").integrity, newer.integrity);
  assert.equal(canonical(reopened.kernel.get(reference(legacy))), canonical(legacy));
});
