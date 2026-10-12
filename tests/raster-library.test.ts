import type { NodePacket, DesignArtifact } from "../src/kernel/contracts.ts";
import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";
import { startApp } from "../src/service/server.ts";
import { reference, canonical, packet, revise } from "../src/kernel/packets.ts";
import { checksum } from "../src/kernel/raster.ts";
import { librarySource } from "../src/kernel/library-gate.ts";
import { revalidatePacket, writePort } from "../src/kernel/gate.ts";
import { decode } from "../src/service/assets.ts";
import { tar } from "../src/service/handoff.ts";
import {
  parseRasterManifest,
  libraryItemId,
  type LibraryItem,
} from "../src/modules/website/library-contracts.ts";
import {
  indexDigest,
  parseIndex,
} from "../src/modules/website/memory-contracts.ts";
import {
  visualFixture,
  offlineVisualProviders,
} from "../scripts/visual-fixture.ts";
async function setup(t: test.TestContext) {
  const root = mkdtempSync(join(tmpdir(), "bve-library-"));
  let app = await startApp(root, 0, undefined, offlineVisualProviders);
  const project = app.visual.create({
      title: "Raster Library fixture",
    }).project,
    pid = project.id,
    e = app.visual.exploration;
  const unit = e.createWorkUnit(pid, {
      version: 1,
      pageType: "homepage",
      label: "Homepage",
      source: "Synthetic fixture",
    }),
    about = e.createWorkUnit(pid, {
      version: 1,
      pageType: "about",
      label: "About",
      source: "Synthetic fixture",
    });
  t.after(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    app,
    pid,
    project,
    unit,
    about,
    reopen: async () => {
      await app.close();
      app = await startApp(root, 0, undefined, offlineVisualProviders);
      return app;
    },
  };
}
type S = Awaited<ReturnType<typeof setup>>;
const saveInput = (
  s: S,
  c: { id: string; version: number; integrity: string },
) => ({
  expectedProject: s.project,
  unit: reference(s.unit),
  candidate: reference(c),
  integrity: c.integrity,
  extent: "whole",
});
const reuseInput = (
  s: S,
  item: { id: string; version: number; integrity: string },
) => ({
  expectedProject: s.project,
  unit: reference(s.about),
  item: reference(item),
  integrity: item.integrity,
});
const history = (s: S) =>
  canonical({
    packets: s.app.workspace.kernel.latestPackets(),
    ledger: s.app.workspace.kernel.ledger(s.pid),
    accepted: s.app.workspace.kernel.acceptedSelections(s.pid),
  });
function unpack(bytes: Buffer) {
  const files = new Map<string, Buffer>();
  let pos = 0;
  while (pos + 512 <= bytes.length) {
    const h = bytes.subarray(pos, pos + 512);
    if (h.every((x) => x === 0)) break;
    const name = h.toString("ascii", 0, 100).split("\0")[0]!,
      len = parseInt(h.toString("ascii", 124, 136).replace(/\0/g, ""), 8);
    const copy = Buffer.from(h),
      sum = parseInt(
        h.toString("ascii", 148, 156).replace(/\0/g, "").trim(),
        8,
      );
    copy.fill(32, 148, 156);
    assert.equal(
      copy.reduce((a, b) => a + b, 0),
      sum,
    );
    assert.equal(h.toString("ascii", 156, 157), "0");
    assert.equal(parseInt(h.toString("ascii", 136, 148), 8), 0);
    assert.ok(!files.has(name));
    files.set(name, bytes.subarray(pos + 512, pos + 512 + len));
    pos += 512 + Math.ceil(len / 512) * 512;
  }
  assert.ok(bytes.subarray(pos).every((x) => x === 0));
  return files;
}
for (const format of ["png", "jpeg", "webp"] as const)
  test(`Library ${format}: exact original, strict deterministic closed package, pinned replacement, idempotent reuse and closed reopen`, async (t) => {
    const s = await setup(t),
      bytes = await visualFixture(0, format),
      c = await s.app.visual.exploration.importCandidate(
        s.pid,
        reference(s.unit),
        bytes,
        "Synthetic fixture rights",
        "imported",
      );
    const cap = s.app.memory.createCapsule(s.pid, {
        scope: null,
        previous: null,
      }),
      capBytes = s.app.memory.download(s.pid, reference(cap)).output;
    const saved = await s.app.library.save(s.pid, saveInput(s, c)),
      item = saved.item;
    assert.equal(saved.duplicate, false);
    const once = history(s);
    assert.equal(
      (await s.app.library.save(s.pid, saveInput(s, c))).duplicate,
      true,
    );
    assert.equal(history(s), once);
    const original = await s.app.library.export(
        s.pid,
        "original",
        reference(item),
        item.integrity,
      ),
      a = await s.app.library.export(
        s.pid,
        "package",
        reference(item),
        item.integrity,
      ),
      b = await s.app.library.export(
        s.pid,
        "package",
        reference(item),
        item.integrity,
      );
    assert.deepEqual(original.bytes, bytes);
    assert.equal(original.mime, "image/" + format);
    assert.ok(
      original.filename.endsWith(format === "jpeg" ? ".jpg" : "." + format),
    );
    assert.equal(checksum(original.bytes), item.payload.state.image.checksum);
    assert.deepEqual(await decode(original.bytes), item.payload.state.image);
    assert.deepEqual(a.bytes, b.bytes);
    assert.equal(history(s), once);
    const files = unpack(a.bytes),
      manifest = parseRasterManifest(
        JSON.parse(files.get("manifest.json")!.toString()),
      );
    assert.equal(files.size, 2);
    assert.deepEqual(files.get(manifest.raster.path), bytes);
    assert.equal(manifest.provenance.rights, "Synthetic fixture rights");
    assert.equal(manifest.provenance.origin, "imported");
    assert.equal(manifest.provenance.generationClaim, "not-established");
    assert.equal(manifest.provenance.executor, null);
    assert.equal(manifest.provenance.requestedControls, "not-included");
    assert.doesNotMatch(
      files.get("manifest.json")!.toString(),
      /grant|apiKey|token|localContext|resolvedContext|native-assets|\/tmp\/|index.html/,
    );
    const replaced = await s.app.visual.exploration.importCandidate(
      s.pid,
      reference(s.unit),
      await visualFixture(1, format),
      "Replacement fixture rights",
      "imported",
      reference(c),
    );
    assert.equal(replaced.version, 2);
    assert.deepEqual(
      (
        await s.app.library.export(
          s.pid,
          "original",
          reference(item),
          item.integrity,
        )
      ).bytes,
      bytes,
    );
    const reused = await s.app.library.reuse(s.pid, reuseInput(s, item));
    assert.equal(reused.duplicate, false);
    assert.deepEqual(reused.candidate.dependencies, [item.payload.state.media]);
    assert.equal(reused.candidate.contextRefs.length, 0);
    assert.equal(reused.candidate.payload.state.origin, "imported");
    assert.equal(
      reused.candidate.payload.state.image.checksum,
      c.payload.state.image.checksum,
    );
    assert.equal(
      s.app.visual.state(s.pid, reference(s.about)).candidates.length,
      1,
    );
    assert.equal(
      s.app.visual
        .state(s.pid, reference(s.about))
        .records.filter(
          (p) =>
            (p.payload as DesignArtifact<unknown>).kind === "raster-selections",
        ).length,
      0,
    );
    assert.deepEqual(s.app.workspace.kernel.acceptedSelections(s.pid), []);
    const after = history(s);
    assert.equal(
      (await s.app.library.reuse(s.pid, reuseInput(s, item))).duplicate,
      true,
    );
    assert.equal(history(s), after);
    assert.equal(
      s.app.memory.capsule(s.pid, reference(cap)).currency.status,
      "changed",
    );
    assert.equal(s.app.memory.download(s.pid, reference(cap)).output, capBytes);
    revalidatePacket(
      cap,
      writePort("work-record"),
      s.app.workspace.kernel.environment(),
    );
    const fresh = s.app.memory.createCapsule(s.pid, {
        scope: reference(s.about),
        previous: null,
      }),
      index = fresh.payload.state.snapshot;
    assert.ok(
      index.entries.some((e) => e.kind === "project-raster-library-reuse"),
    );
    assert.ok(
      index.entries.some((e) => e.kind === "project-raster-library-item"),
    );
    assert.ok(
      index.entries.some((e) => e.ref.id === c.id && e.ref.version === 1),
    );
    assert.equal(
      s.app.memory.capsule(s.pid, reference(fresh)).currency.status,
      "current",
    );
    const frozen = s.app.memory.download(s.pid, reference(fresh)).output,
      app = await s.reopen();
    assert.equal((await app.library.state(s.pid)).coverage.total, 1);
    assert.deepEqual(
      (
        await app.library.export(
          s.pid,
          "original",
          reference(item),
          item.integrity,
        )
      ).bytes,
      bytes,
    );
    assert.deepEqual(
      (
        await app.library.export(
          s.pid,
          "package",
          reference(item),
          item.integrity,
        )
      ).bytes,
      a.bytes,
    );
    assert.equal(app.memory.download(s.pid, reference(fresh)).output, frozen);
    assert.equal(
      app.memory.capsule(s.pid, reference(fresh)).currency.status,
      "current",
    );
    assert.equal(app.visual.executions.availability().connected, false);
  });
test("EXIF orientation: stored versus displayed dimensions and metadata survive original/package/reuse unchanged", async (t) => {
  const s = await setup(t),
    bytes = await sharp({
      create: { width: 37, height: 19, channels: 3, background: "#445566" },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer(),
    c = await s.app.visual.exploration.importCandidate(
      s.pid,
      reference(s.unit),
      bytes,
      "Orientation fixture",
    );
  const { item } = await s.app.library.save(s.pid, saveInput(s, c));
  assert.deepEqual(item.payload.state.orientation, {
    coordinates: "encoded-top-left",
    exif: 6,
    displayWidth: 19,
    displayHeight: 37,
  });
  const original = await s.app.library.export(
    s.pid,
    "original",
    reference(item),
    item.integrity,
  );
  assert.deepEqual(original.bytes, bytes);
  assert.equal((await sharp(original.bytes).metadata()).orientation, 6);
  assert.equal((await sharp(original.bytes).metadata()).width, 37);
  const pack = await s.app.library.export(
      s.pid,
      "package",
      reference(item),
      item.integrity,
    ),
    files = unpack(pack.bytes),
    m = parseRasterManifest(JSON.parse(files.get("manifest.json")!.toString()));
  assert.deepEqual(m.raster.orientation, item.payload.state.orientation);
  await s.app.library.reuse(s.pid, reuseInput(s, item));
  assert.deepEqual(
    (
      await s.app.visual.exploration.raster(
        s.pid,
        reference(s.app.visual.state(s.pid, reference(s.about)).candidates[0]!),
      )
    ).bytes,
    bytes,
  );
});
test("Foreign project/page/source, substituted hashes, unsupported extent and stale request revisions reject without canonical writes", async (t) => {
  const s = await setup(t),
    c = await s.app.visual.exploration.importCandidate(
      s.pid,
      reference(s.unit),
      await visualFixture(0),
      "Fixture",
    ),
    other = s.app.visual.create({ title: "Foreign owner" }).project,
    unit = s.app.visual.exploration.createWorkUnit(other.id, {
      version: 1,
      pageType: "homepage",
      label: "Foreign page",
      source: "Fixture",
    }),
    foreign = await s.app.visual.exploration.importCandidate(
      other.id,
      reference(unit),
      await visualFixture(1),
      "Foreign rights",
    );
  const before = history(s);
  for (const input of [
    {
      ...saveInput(s, c),
      candidate: reference(foreign),
      integrity: foreign.integrity,
    },
    { ...saveInput(s, c), unit: reference(unit) },
    { ...saveInput(s, c), integrity: "a".repeat(64) },
    { ...saveInput(s, c), extent: "rectangle" },
    { ...saveInput(s, c), expectedProject: { ...s.project, version: 99 } },
    {
      ...saveInput(s, c),
      candidate: { ...reference(c), freshness: "current" },
    },
  ])
    await assert.rejects(() => s.app.library.save(s.pid, input));
  assert.equal(history(s), before);
  const { item } = await s.app.library.save(s.pid, saveInput(s, c)),
    after = history(s);
  for (const input of [
    { ...reuseInput(s, item), unit: reference(unit) },
    { ...reuseInput(s, item), integrity: "b".repeat(64) },
    { ...reuseInput(s, item), item: { ...reference(item), version: 2 } },
  ])
    await assert.rejects(() => s.app.library.reuse(s.pid, input));
  assert.equal(history(s), after);
  await assert.rejects(() =>
    s.app.library.export(other.id, "original", reference(item), item.integrity),
  );
});
test("Generic writers cannot fabricate provenance, rights, orientation, source membership, roles or semantic revisions", async (t) => {
  const s = await setup(t),
    c = await s.app.visual.exploration.importCandidate(
      s.pid,
      reference(s.unit),
      await visualFixture(0),
      "Fixture",
    );
  const membership = s.app.workspace.kernel
    .latestPackets()
    .find(
      (p) =>
        (p.payload as DesignArtifact<unknown>).kind === "raster-membership",
    )!;
  const base = librarySource(
    s.app.workspace.kernel.environment(),
    s.pid,
    reference(c),
    c.integrity,
    reference(membership),
  );
  const make = (state: LibraryItem) =>
    packet({
      type: "work-record",
      id: libraryItemId(s.pid, state.candidate, state.candidateIntegrity),
      projectId: s.pid,
      dependencies: [
        state.workUnit,
        state.candidate,
        state.membership,
        state.media,
      ],
      assets: [{ id: state.image.id, checksum: state.image.checksum }],
      payload: {
        moduleId: "website",
        kind: "project-raster-library-item",
        scope: "project-raster-library",
        lockedValues: {},
        state,
      },
    });
  const before = history(s);
  for (const change of [
    { rights: "Fabricated permission" },
    { origin: "generated" as const },
    {
      orientation: {
        ...base.orientation,
        exif: 6,
        displayWidth: base.image.height,
        displayHeight: base.image.width,
      },
    },
    { candidateIntegrity: "a".repeat(64) },
    { workUnit: reference(s.about) },
    { membership: { ...base.membership, version: 99 } },
    { mediaIntegrity: "a".repeat(64) },
  ]) {
    assert.throws(
      () => s.app.workspace.kernel.put(make({ ...base, ...change })),
      /Library|Generated|reference/,
    );
    assert.equal(history(s), before);
  }
  const item = make(base),
    { integrity: _, ...body } = item;
  for (const changed of [
    { ...body, type: "design-artifact" as const },
    { ...body, assets: [] },
    { ...body, dependencies: [base.media] },
  ])
    assert.throws(() => s.app.workspace.kernel.put(packet(changed)), /Library/);
  s.app.workspace.kernel.put(item); // Independent valid generic writer; no service-only trust flag.
  assert.equal((await s.app.library.state(s.pid)).coverage.total, 1);
  const saved = history(s);
  const changed = revise(
    item,
    { ...item.payload, state: base },
    "fixture",
    "Forbidden revision",
  );
  assert.throws(() => s.app.workspace.kernel.put(changed), /immutable/);
  const morph = revise(
    item as NodePacket<DesignArtifact<unknown>>,
    {
      moduleId: "website",
      kind: "page-work-unit",
      scope: "page-exploration",
      lockedValues: {},
      state: {
        version: 1,
        pageType: "custom",
        label: "Bypass",
        source: "Fixture",
      },
    },
    "fixture",
    "Forbidden kind swap",
  );
  assert.throws(() => s.app.workspace.kernel.put(morph), /immutable/);
  assert.equal(history(s), saved);
});
test("Missing/corrupt original and structurally plausible but undecodable pixels fail before Library writes, including a generic writer", async (t) => {
  const s = await setup(t),
    bytes = await visualFixture(0),
    c = await s.app.visual.exploration.importCandidate(
      s.pid,
      reference(s.unit),
      bytes,
      "Fixture",
    ),
    before = history(s);
  unlinkSync(join(s.app.workspace.assets.root, c.payload.state.image.id));
  await assert.rejects(() => s.app.library.save(s.pid, saveInput(s, c)));
  assert.equal(history(s), before);
  writeFileSync(
    join(s.app.workspace.assets.root, c.payload.state.image.id),
    Buffer.from("corrupt"),
  );
  await assert.rejects(() => s.app.library.save(s.pid, saveInput(s, c)));
  assert.equal(history(s), before);
  writeFileSync(
    join(s.app.workspace.assets.root, c.payload.state.image.id),
    bytes,
  );
  const bad = bytes.subarray(0, 48),
    image = {
      ...c.payload.state.image,
      id: checksum(bad),
      checksum: checksum(bad),
      bytes: bad.length,
    };
  s.app.workspace.assets.save(bad, image);
  const media = packet({
    type: "media-asset",
    id: "undecodable-media",
    projectId: s.pid,
    assets: [{ id: image.id, checksum: image.checksum }],
    payload: {
      moduleId: "website",
      kind: "page-media",
      scope: "media",
      lockedValues: {},
      state: {
        image,
        label: "Broken synthetic pixels",
        role: "placeable",
        permission: "Fixture",
      },
    },
  });
  const candidate = packet({
    type: "design-artifact",
    id: "undecodable-candidate",
    projectId: s.pid,
    dependencies: [reference(media)],
    assets: media.assets,
    payload: {
      moduleId: "website",
      kind: "raster-concept",
      scope: "page-exploration",
      lockedValues: {},
      state: { ...c.payload.state, media: reference(media), image },
    },
  });
  const membership = packet({
    type: "work-record",
    id: "undecodable-membership",
    projectId: s.pid,
    dependencies: [reference(s.unit), reference(candidate)],
    payload: {
      moduleId: "website",
      kind: "raster-membership",
      scope: "page-exploration",
      lockedValues: {},
      state: {
        version: 1,
        workUnit: reference(s.unit),
        candidate: reference(candidate),
        integrity: candidate.integrity,
        derivation: [],
      },
    },
  });
  s.app.workspace.kernel.putMany([media, candidate, membership]);
  const state: LibraryItem = {
    version: 1,
    workUnit: reference(s.unit),
    candidate: reference(candidate),
    candidateIntegrity: candidate.integrity,
    membership: reference(membership),
    membershipIntegrity: membership.integrity,
    media: reference(media),
    mediaIntegrity: media.integrity,
    image,
    orientation: {
      coordinates: "encoded-top-left",
      exif: null,
      displayWidth: image.width,
      displayHeight: image.height,
    },
    origin: "imported",
    rights: "Fixture",
  };
  const entry = packet({
      type: "work-record",
      id: libraryItemId(s.pid, state.candidate, state.candidateIntegrity),
      projectId: s.pid,
      dependencies: [
        state.workUnit,
        state.candidate,
        state.membership,
        state.media,
      ],
      assets: media.assets,
      payload: {
        moduleId: "website",
        kind: "project-raster-library-item",
        scope: "project-raster-library",
        lockedValues: {},
        state,
      },
    }),
    broken = history(s);
  assert.throws(() => s.app.workspace.kernel.put(entry), /fully decode/);
  await assert.rejects(() =>
    s.app.library.save(s.pid, saveInput(s, candidate)),
  );
  assert.equal(history(s), broken);
  assert.equal((await s.app.library.state(s.pid)).coverage.total, 0);
});
test("Reuse transaction failure and async project drift preserve no partial candidate/membership/Library entries", async (t) => {
  const s = await setup(t),
    c = await s.app.visual.exploration.importCandidate(
      s.pid,
      reference(s.unit),
      await visualFixture(0),
      "Fixture",
    ),
    { item } = await s.app.library.save(s.pid, saveInput(s, c)),
    before = history(s);
  const original = s.app.workspace.assets.facts.bind(s.app.workspace.assets);
  let calls = 0;
  s.app.workspace.assets.facts = (i) => (++calls >= 4 ? null : original(i));
  await assert.rejects(() => s.app.library.reuse(s.pid, reuseInput(s, item)));
  s.app.workspace.assets.facts = original;
  assert.equal(history(s), before);
  let release!: () => void, started!: () => void;
  const held = new Promise<void>((r) => (release = r)),
    entered = new Promise<void>((r) => (started = r)),
    inspect = s.app.workspace.assets.inspect.bind(s.app.workspace.assets);
  s.app.workspace.assets.inspect = async (i) => {
    const result = await inspect(i);
    started();
    await held;
    return result;
  };
  const pending = s.app.library.save(s.pid, saveInput(s, c));
  await entered;
  const project = s.app.workspace.kernel.get(s.project),
    next = revise(
      project,
      project.payload,
      "fixture",
      "Concurrent project revision",
    );
  s.app.workspace.kernel.put(next);
  const after = history(s);
  release();
  await assert.rejects(() => pending, /changed|Stale|stale/);
  assert.equal(history(s), after);
  s.app.workspace.assets.inspect = inspect;
});
test("Library evidence participates in independently enforced memory completeness and missing-primary discovery; read-only exports do not stale capsules", async (t) => {
  const s = await setup(t),
    c = await s.app.visual.exploration.importCandidate(
      s.pid,
      reference(s.unit),
      await visualFixture(0),
      "Fixture",
      "synthetic",
    ),
    { item } = await s.app.library.save(s.pid, saveInput(s, c));
  await s.app.library.reuse(s.pid, reuseInput(s, item));
  const cap = s.app.memory.createCapsule(s.pid, {
      scope: reference(s.about),
      previous: null,
    }),
    bytes = s.app.memory.download(s.pid, reference(cap)).output,
    state = structuredClone(cap.payload.state);
  state.snapshot.entries = state.snapshot.entries.filter(
    (e) => e.ref.id !== item.id,
  );
  state.snapshot.events = state.snapshot.events
    .filter((e) => e.subject.id !== item.id)
    .map((e) => ({ ...e, related: e.related.filter((r) => r.id !== item.id) }));
  state.snapshot.coverage.entries = state.snapshot.entries.length;
  state.snapshot.coverage.events = state.snapshot.events.length;
  state.snapshot.digest = indexDigest(state.snapshot);
  const { integrity: _, ...body } = cap,
    forged = packet({
      ...body,
      id: "forged-library-omission",
      dependencies: cap.dependencies.filter((r) => r.id !== item.id),
      payload: { ...cap.payload, state },
    });
  assert.throws(() => s.app.workspace.kernel.put(forged), /completeness/);
  const before = history(s);
  await s.app.library.export(
    s.pid,
    "original",
    reference(item),
    item.integrity,
  );
  await s.app.library.export(s.pid, "package", reference(item), item.integrity);
  await s.app.library.state(s.pid);
  assert.equal(history(s), before);
  assert.equal(
    s.app.memory.capsule(s.pid, reference(cap)).currency.status,
    "current",
  );
  assert.equal(s.app.memory.download(s.pid, reference(cap)).output, bytes);
  const db = new DatabaseSync(join(s.root, "kernel.sqlite"));
  db.prepare("DELETE FROM kernel_packets WHERE id=? AND version=1").run(
    item.id,
  );
  db.close();
  const lost = s.app.memory.index(s.pid, reference(s.about));
  const unavailable = history(s);
  await assert.rejects(
    () => s.app.library.save(s.pid, saveInput(s, c)),
    /Ledger-known missing/,
  );
  assert.equal(history(s), unavailable);
  assert.equal((await s.app.library.state(s.pid)).coverage.unknownPrimary, 1);
  assert.ok(
    lost.entries.some(
      (e) =>
        e.ref.id === item.id && e.status === "missing" && e.kind === "unknown",
    ),
  );
  const next = s.app.memory.createCapsule(s.pid, {
    scope: reference(s.about),
    previous: null,
  });
  assert.equal(
    s.app.memory.capsule(s.pid, reference(next)).currency.status,
    "incomplete",
  );
  assert.equal(s.app.memory.download(s.pid, reference(cap)).output, bytes);
  assert.ok(
    parseIndex(
      JSON.parse(s.app.memory.download(s.pid, reference(next)).output),
    ).entries.some((e) => e.ref.id === item.id && e.status === "missing"),
  );
});
test("Original/package routes protect ownership, token and origin; malformed paths, manifests and oversized closure reject", async (t) => {
  const s = await setup(t),
    c = await s.app.visual.exploration.importCandidate(
      s.pid,
      reference(s.unit),
      await visualFixture(0),
      "Fixture",
    ),
    session = await (
      await fetch(s.app.origin + "/api/v1/visual/session")
    ).json(),
    url = s.app.origin + "/api/v1/visual/library/save";
  const send = (headers: Record<string, string>) =>
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: s.app.origin,
        "X-BVE-Token": session.token,
        ...headers,
      },
      body: JSON.stringify({ projectId: s.pid, input: saveInput(s, c) }),
    });
  const before = history(s);
  assert.equal((await send({ "X-BVE-Token": "wrong" })).status, 403);
  assert.equal((await send({ Origin: "https://foreign.invalid" })).status, 403);
  assert.equal(history(s), before);
  const saved = await send({});
  assert.equal(saved.status, 200);
  const { item } = await saved.json(),
    q = new URLSearchParams({
      project: s.pid,
      id: item.id,
      version: "1",
      integrity: item.integrity,
    });
  const d = await fetch(s.app.origin + "/api/v1/visual/library/original?" + q);
  const b = Buffer.from(await d.arrayBuffer());
  assert.equal(d.status, 200);
  assert.equal(d.headers.get("content-length"), String(b.length));
  assert.equal(d.headers.get("x-content-sha256"), checksum(b));
  assert.equal(d.headers.get("content-type"), "image/png");
  assert.match(
    d.headers.get("content-disposition")!,
    /^attachment; filename="raster-[a-f0-9]{64}\.png"$/,
  );
  const pack = await fetch(
    s.app.origin + "/api/v1/visual/library/package?" + q,
  );
  assert.equal(pack.status, 200);
  assert.equal(unpack(Buffer.from(await pack.arrayBuffer())).size, 2);
  const m = (
    await s.app.library.preview(s.pid, reference(item), item.integrity)
  ).manifest;
  for (const forged of [
    { ...m, extra: "credential" },
    { ...m, raster: { ...m.raster, path: "../outside.png" } },
    { ...m, raster: { ...m.raster, mime: "image/jpeg" } },
    { ...m, provenance: { ...m.provenance, executor: "fabricated-model" } },
  ])
    assert.throws(() => parseRasterManifest(forged));
  for (const files of [
    new Map([
      ["manifest.json", Buffer.from("{}")],
      ["../outside.png", b],
    ]),
    new Map([
      ["manifest.json", Buffer.from("{}")],
      ["index.html", Buffer.from("x")],
    ]),
    new Map([
      ["manifest.json", Buffer.alloc(65537)],
      ["assets/" + checksum(b) + ".png", b],
    ]),
    new Map([
      ["manifest.json", Buffer.from("{}")],
      ["assets/" + checksum(b) + ".png", Buffer.alloc(8 * 1024 * 1024 + 1)],
    ]),
  ])
    assert.throws(() => tar(files, "raster"));
});
test("Reference-only and arbitrary historical payloads are ineligible; eligible Library actions preserve existing selection and formal accepted pointer", async (t) => {
  const s = await setup(t),
    e = s.app.visual.exploration,
    c = await e.importCandidate(
      s.pid,
      reference(s.unit),
      await visualFixture(0),
      "Eligible fixture rights",
    );
  const m = packet({
    type: "media-asset",
    id: "reference-only-library-media",
    projectId: s.pid,
    assets: c.assets,
    payload: {
      moduleId: "website",
      kind: "page-media",
      scope: "media",
      lockedValues: {},
      state: {
        image: c.payload.state.image,
        label: "Historical reference evidence",
        role: "reference",
        permission: "Reference only",
      },
    },
  });
  const candidate = packet({
    type: "design-artifact",
    id: "reference-only-library-candidate",
    projectId: s.pid,
    dependencies: [reference(m)],
    assets: c.assets,
    payload: {
      ...c.payload,
      state: { ...c.payload.state, media: reference(m) },
    },
  });
  const membership = packet({
    type: "work-record",
    id: "reference-only-library-membership",
    projectId: s.pid,
    dependencies: [reference(s.unit), reference(candidate)],
    payload: {
      moduleId: "website",
      kind: "raster-membership",
      scope: "page-exploration",
      lockedValues: {},
      state: {
        version: 1,
        workUnit: reference(s.unit),
        candidate: reference(candidate),
        integrity: candidate.integrity,
        derivation: [],
      },
    },
  });
  s.app.workspace.kernel.putMany([m, candidate, membership]);
  const before = history(s);
  await assert.rejects(
    () => s.app.library.save(s.pid, saveInput(s, candidate)),
    /placeable/,
  );
  await assert.rejects(
    () => s.app.library.save(s.pid, saveInput(s, membership)),
    /Foreign|type/,
  );
  assert.equal(history(s), before);
  const sel = e.selections(s.pid, {
    version: 1,
    workUnit: reference(s.unit),
    entries: [
      {
        id: "existing-explicit-choice",
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
  s.app.workspace.kernel.accept(
    s.pid,
    "raster-choice",
    reference(c),
    null,
    "fixture",
    "Explicit fixture acceptance before Library actions",
  );
  const authority = () =>
      canonical({
        selection: s.app.workspace.kernel.get(reference(sel)),
        accepted: s.app.workspace.kernel.acceptedSelections(s.pid),
        project: s.app.workspace.project(s.pid),
      }),
    original = authority();
  const { item } = await s.app.library.save(s.pid, saveInput(s, c));
  await s.app.library.reuse(s.pid, reuseInput(s, item));
  await s.app.library.export(
    s.pid,
    "original",
    reference(item),
    item.integrity,
  );
  await s.app.library.export(s.pid, "package", reference(item), item.integrity);
  assert.equal(authority(), original);
});
test("Save identity survives new source memberships; Library paging is deterministic and bounds are explicit", async (t) => {
  const s = await setup(t),
    c = await s.app.visual.exploration.importCandidate(
      s.pid,
      reference(s.unit),
      await visualFixture(0),
      "Fixture",
    ),
    { item } = await s.app.library.save(s.pid, saveInput(s, c)),
    source = canonical(item.payload.state);
  const membership = packet({
    type: "work-record",
    id: "a-additional-valid-source-membership",
    projectId: s.pid,
    dependencies: [reference(s.unit), reference(c)],
    payload: {
      moduleId: "website",
      kind: "raster-membership",
      scope: "page-exploration",
      lockedValues: {},
      state: {
        version: 1,
        workUnit: reference(s.unit),
        candidate: reference(c),
        integrity: c.integrity,
        derivation: [],
      },
    },
  });
  s.app.workspace.kernel.put(membership);
  const before = history(s),
    again = await s.app.library.save(s.pid, saveInput(s, c));
  assert.equal(again.duplicate, true);
  assert.equal(again.item.id, item.id);
  assert.equal(canonical(again.item.payload.state), source);
  assert.equal(history(s), before);
  for (let i = 1; i <= 2; i++) {
    const next = await s.app.visual.exploration.importCandidate(
      s.pid,
      reference(s.unit),
      await visualFixture(i),
      "Fixture",
    );
    await s.app.library.save(s.pid, saveInput(s, next));
  }
  const all = await s.app.library.state(s.pid),
    first = await s.app.library.state(s.pid, 0, 1),
    second = await s.app.library.state(s.pid, 1, 1),
    last = await s.app.library.state(s.pid, 2, 1);
  assert.equal(first.coverage.total, 3);
  assert.equal(first.coverage.omitted, 2);
  assert.equal(first.next, 1);
  assert.equal(last.next, null);
  assert.deepEqual(
    [...first.entries, ...second.entries, ...last.entries],
    all.entries,
  );
  await assert.rejects(() => s.app.library.state(s.pid, 0, 51));
  await assert.rejects(() => s.app.library.state(s.pid, -1, 20));
});
