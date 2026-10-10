import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, cpSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Workspace } from "../src/service/workspace.ts";
import { Pages } from "../src/service/pages.ts";
import { reference, packet, digest } from "../src/kernel/packets.ts";
import {
  parsePage,
  pageSignature,
  renderPage,
} from "../src/modules/website/page.ts";
import type { Page, PageState } from "../src/modules/website/page.ts";
import { Compositions } from "../src/service/compositions.ts";
import {sectionIds} from "../src/modules/website/composition.ts";
import { seedComposition, latestComposition, placeImages, syntheticCompositionImage } from "../scripts/composition-fixture.ts";
function setup(t: test.TestContext, fixture = true) {
  const root = mkdtempSync(join(tmpdir(), "bve-pages-"));
  const w = new Workspace(root, { aiResponseFixture: fixture });
  const p = w.create({
    title: "Synthetic inference trial",
    mode: "freeroam",
    visualOS: null,
    palette: null,
  }).project!;
  const pages = new Pages(w);
  t.after(() => {
    try {
      w.close();
    } catch {}
    rmSync(root, { recursive: true, force: true });
  });
  return { root, w, p, pages };
}
const page = (sections = 0): Page => ({
  version: 1,
  title: "Synthetic page",
  language: "en",
  root: {
    id: "root",
    kind: "container",
    style: {
      background: "#f4eddf",
      color: "#203f40",
      padding: 32,
      fontFamily: "Georgia, serif",
    },
    children: [
      {
        id: "title",
        kind: "heading",
        level: 1,
        text: "Care shaped around your day",
      },
      ...Array.from({ length: sections }, (_, i) => ({
        id: "section-" + i,
        kind: "section" as const,
        children: [
          {
            id: "text-" + i,
            kind: "text" as const,
            text: "Independent content " + i,
          },
        ],
      })),
    ],
  },
  media: {},
  responsive: [{ maxWidth: 600, nodeId: "root", style: { padding: 16 } }],
  unresolved: [],
});
function request(
  s: ReturnType<typeof setup>,
  operation = "create",
  base: unknown = null,
  resources: unknown[] = [],
  locks: unknown[] = [],
) {
  s.pages.prepare(s.p.id, {
    expectedProject: reference(s.w.project(s.p.id)),
    base,
    operation,
    instruction: "Synthetic contract test",
    resources,
    locks,
  });
  return s.pages.state(s.p.id).requests.at(-1)!;
}
function response(q: { id: string; integrity: string }, pages = [page()]) {
  return {
    schema: "bve.inference-result",
    version: 1,
    requestId: q.id,
    requestHash: q.integrity,
    candidates: pages.map((p) => ({
      label: p.title,
      rationale: "Synthetic fixture rationale",
      page: p,
      mediaRequirements: [],
      proposedActions: ["Critique proposed only"],
    })),
    findings: [],
  };
}
async function apply(
  s: ReturnType<typeof setup>,
  q: ReturnType<typeof request>,
  out = response(q),
) {
  await s.pages.apply(s.p.id, {
    request: reference(q),
    response: out,
    source: "Authored mechanical fixture; no live AI",
    model: null,
    aiAuthorship: true,
  });
  return s.pages.state(s.p.id).pages.at(-1)!;
}
function accept(s: ReturnType<typeof setup>, p: ReturnType<Pages["page"]>) {
  s.pages.accept(s.p.id, {
    artifact: reference(p),
    expected: s.pages.state(s.p.id).accepted[p.id] ?? null,
    reason: "Synthetic operator test decision",
    reviewedHash: pageSignature(p.payload.state),
    acknowledgeFindings: true,
  });
}
function repacket<T>(
  p: import("../src/kernel/contracts.ts").NodePacket<T>,
  changes: object,
) {
  const { integrity: _, ...body } = p;
  return packet({ ...body, ...changes });
}
test("arbitrary local section counts, nested grids, responsive rules and escaped text render without artifact dependencies", (t) => {
  for (const n of [0, 1, 3, 6, 12]) {
    const p = page(n);
    p.root.style = {
      display: "grid",
      gridTemplateColumns: "minmax(0,1fr) minmax(0,2fr)",
      padding: 20,
    };
    p.root.children![0]!.text = "<script>do not run</script>";
    const parsed = parsePage(p);
    const html = renderPage(parsed, () => {
      throw Error("No media needed");
    });
    assert.ok(html.includes("&lt;script&gt;"));
    assert.ok(html.includes("@media"));
    assert.equal((html.match(/<section/g) ?? []).length, n);
  }
  assert.throws(() => parsePage({ ...page(), script: "unsafe" }));
  assert.throws(() =>
    parsePage({
      ...page(),
      root: { ...page().root, style: { background: "url(https://host/)" } },
    }),
  );
  assert.throws(() =>
    parsePage({
      ...page(),
      root: {
        ...page().root,
        children: [{ id: "root", kind: "text", text: "duplicate" }],
      },
    }),
  );
});
test("scoped create exchange is exact, atomic, idempotent and never implicitly accepts", async (t) => {
  const s = setup(t),
    q = request(s),
    before = s.w.kernel.latestPackets().length;
  const bad = response(q);
  bad.requestHash = "0".repeat(64);
  await assert.rejects(apply(s, q, bad), /exact exported/);
  assert.equal(s.w.kernel.latestPackets().length, before);
  const p = await apply(s, q, response(q, [page(0), page(6), page(12)]));
  const state = s.pages.state(s.p.id);
  assert.equal(state.pages.length, 3);
  assert.ok(
    state.pages.every(
      (p) => p.dependencies.length === 0 && p.contextRefs.length === 0,
    ),
  );
  assert.ok(Object.values(state.accepted).every((p) => p === null));
  assert.equal(state.results[0]!.payload.state.executor.kind, "test-fixture");
  assert.equal(state.requests[0]!.payload.state.status, "applied");
  await apply(s, q, response(q, [page(0), page(6), page(12)]));
  assert.equal(s.pages.state(s.p.id).results.length, 1);
  assert.equal(s.pages.state(s.p.id).pages.length, 3);
  accept(s, p);
  assert.equal(s.pages.state(s.p.id).accepted[p.id]!.version, 1);
});
test("exact preservation locks reject changed text; manual revisions and AI changes preserve accepted snapshots", async (t) => {
  const s = setup(t),
    p = await apply(s, request(s));
  accept(s, p);
  const old = await s.pages.export(s.p.id, reference(p));
  const q = request(
    s,
    "revise",
    reference(p),
    [],
    [{ nodeId: "title", field: "text", value: "Care shaped around your day" }],
  );
  const bad = response(q);
  bad.candidates[0]!.page.root.children![0]!.text = "Changed locked copy";
  await assert.rejects(apply(s, q, bad), /Preservation/);
  assert.equal(s.pages.state(s.p.id).pages[0]!.version, 1);
  const next = page(6);
  next.root.style!.padding = 48;
  const revised = await apply(s, q, response(q, [next]));
  assert.equal(revised.id, p.id);
  assert.equal(revised.version, 2);
  assert.equal(s.pages.state(s.p.id).accepted[p.id]!.version, 1);
  assert.deepEqual(
    (await s.pages.export(s.p.id, reference(p))).bytes,
    old.bytes,
  );
  assert.throws(
    () =>
      s.pages.accept(s.p.id, {
        artifact: reference(p),
        expected: reference(p),
        reason: "Stale",
        reviewedHash: pageSignature(p.payload.state),
        acknowledgeFindings: true,
      }),
    /changed/,
  );
  assert.equal(s.pages.history(s.p.id, reference(revised)).length, 2);
});
for (const mode of ["cancelled", "base-changed", "project-changed"])
  test(
    mode + " return remains historical and cannot overwrite selected page",
    async (t) => {
      const s = setup(t),
        p = await apply(s, request(s));
      accept(s, p);
      const q = request(s, "revise", reference(p));
      if (mode === "cancelled")
        s.pages.cancel(s.p.id, {
          request: reference(q),
          reason: "Operator cancellation",
        });
      if (mode === "base-changed")
        s.pages.save(s.p.id, {
          artifact: reference(p),
          page: page(6),
          reason: "Manual change",
        });
      if (mode === "project-changed") {
        const old = s.w.project(s.p.id);
        s.w.reviseProject(s.p.id, {
          expectedProject: reference(old),
          brief: { audience: "New audience" },
          reason: "Brief changed",
        });
      }
      await apply(s, q, response(q, [page(12)]));
      const state = s.pages.state(s.p.id);
      assert.equal(state.results.at(-1)!.payload.state.outcome, "historical");
      assert.notEqual(state.pages.at(-1)!.id, p.id);
      assert.equal(state.accepted[p.id]!.version, 1);
      assert.notEqual(
        state.requests.find((x) => x.id === q.id)!.payload.state.status,
        "applied",
      );
    },
  );
test("independent media exact bindings, reference isolation, corruption and forged dependencies fail closed", async (t) => {
  const s = setup(t),
    bytes = await syntheticCompositionImage();
  await s.pages.addMedia(s.p.id, {
    expectedProject: reference(s.p),
    origin: null,
    file: bytes.toString("base64"),
    label: "Synthetic shared media",
    role: "placeable",
    permission: "Generated mechanical fixture",
  });
  await s.pages.addMedia(s.p.id, {
    expectedProject: reference(s.p),
    origin: null,
    file: bytes.toString("base64"),
    label: "Private reference label must stay outside unselected request",
    role: "reference",
    permission: "Reference only",
  });
  const [m, referenceOnly] = s.pages.state(s.p.id).media;
  const q = request(s, "create", null, [reference(m!)]);
  assert.equal(q.payload.state.resources.length, 1);
  assert.ok(
    !JSON.stringify(s.pages.exportRequest(s.p.id, reference(q))).includes(
      referenceOnly!.payload.state.label,
    ),
  );
  const p = page();
  p.root.children!.push({
    id: "photo",
    kind: "media",
    slot: "primary",
    alt: "Synthetic image",
    decorative: false,
  });
  (p.media as unknown as Record<string, string>)["primary"] = "media-1";
  const out = await apply(s, q, response(q, [p]));
  assert.deepEqual(out.dependencies, [reference(m!)]);
  const otherQ = request(s, "create", null, [reference(referenceOnly!)]);
  await assert.rejects(
    apply(s, otherQ, response(otherQ, [p])),
    /Reference-only/,
  );
  const forged = repacket(out, {
    id: "forged-page",
    dependencies: [reference(out)],
    provenance: { actor: "test", source: "forgery", previous: null },
  });
  assert.throws(() => s.w.kernel.put(forged), /dependencies/);
  accept(s, out);
  const handoff = await s.pages.export(s.p.id, reference(out));
  assert.equal(
    handoff.manifest.media[0]!.state.image.checksum,
    m!.payload.state.image.checksum,
  );
  const stripped = repacket(out, {
    id: "missing-inventory",
    assets: [],
    provenance: { actor: "test", source: "forgery", previous: null },
  });
  assert.throws(() => s.w.kernel.put(stripped), /inventory/);
  const foreign = s.w.create({
    title: "Foreign",
    mode: "freeroam",
    visualOS: null,
    palette: null,
  }).project!;
  assert.throws(() => s.pages.page(foreign.id, reference(out)), /ownership/);
  const sourcePath = join(s.root, "native-assets", m!.payload.state.image.id);
  writeFileSync(sourcePath, Buffer.from("corrupt"));
  await assert.rejects(
    s.pages.preview(s.p.id, reference(out)),
    /unavailable or corrupt/,
  );
  await assert.rejects(
    s.pages.export(s.p.id, reference(out)),
    /unavailable or corrupt/,
  );
  assert.equal(s.w.kernel.selected(s.p.id, "page:" + out.id)!.version, 1);
});
test("Website assembly selects exact accepted pages; later acceptance never adopts itself", async (t) => {
  const s = setup(t),
    p = await apply(s, request(s));
  const input = {
    base: null,
    title: "Synthetic site",
    pages: [{ route: "/", label: "Home", artifact: reference(p) }],
    reason: "Explicit selection",
  };
  assert.throws(() => s.pages.assemble(s.p.id, input), /accepted/);
  accept(s, p);
  s.pages.assemble(s.p.id, input);
  const a = s.pages.state(s.p.id).websites[0]!;
  assert.equal(a.type, "website-assembly");
  s.pages.acceptWebsite(s.p.id, {
    assembly: reference(a),
    expected: null,
    reason: "Reviewed routes",
    reviewedHash: digest(a.payload.state),
  });
  const before = await s.pages.exportWebsite(s.p.id, reference(a));
  s.pages.save(s.p.id, {
    artifact: reference(p),
    page: page(6),
    reason: "New content",
  });
  const next = s.pages.state(s.p.id).pages[0]!;
  accept(s, next);
  assert.equal(
    s.pages.website(s.p.id, reference(a)).payload.state.pages[0]!.artifact
      .version,
    1,
  );
  assert.deepEqual(
    (await s.pages.exportWebsite(s.p.id, reference(a))).bytes,
    before.bytes,
  );
  assert.throws(
    () =>
      s.pages.assemble(s.p.id, {
        ...input,
        pages: [
          { route: "/", label: "Home", artifact: reference(next) },
          { route: "/", label: "Duplicate", artifact: reference(p) },
        ],
      }),
    /Unique/,
  );
});
test("full closed-root recovery preserves session records, accepted pointers and byte-identical exports", async (t) => {
  const s = setup(t),
    p = await apply(s, request(s));
  accept(s, p);
  const q = request(s, "critique", reference(p));
  const before = await s.pages.export(s.p.id, reference(p));
  const receipt = JSON.stringify(s.pages.state(s.p.id));
  s.w.close();
  const copied = mkdtempSync(join(tmpdir(), "bve-pages-copy-"));
  t.after(() => rmSync(copied, { recursive: true, force: true }));
  cpSync(s.root, copied, { recursive: true });
  const w = new Workspace(copied);
  try {
    const pages = new Pages(w);
    assert.equal(JSON.stringify(pages.state(s.p.id)), receipt);
    assert.deepEqual(
      (await pages.export(s.p.id, reference(p))).bytes,
      before.bytes,
    );
    assert.equal(
      pages.request(s.p.id, reference(q)).payload.state.status,
      "awaiting",
    );
  } finally {
    w.close();
  }
});
test("portable import reconstructs without the original project or ledger and never inherits acceptance", async (t) => {
  const s = setup(t),
    p = await apply(s, request(s));
  accept(s, p);
  const exported = await s.pages.export(s.p.id, reference(p));
  const foreign = setup(t);
  await foreign.pages.importPortable(foreign.p.id, {
    expectedProject: reference(foreign.p),
    manifest: exported.manifest,
    files: {},
    reason: "Synthetic portable restore",
  });
  const restored = foreign.pages.state(foreign.p.id).pages[0]!;
  assert.notEqual(restored.id, p.id);
  assert.deepEqual(restored.payload.state.page, p.payload.state.page);
  assert.equal(foreign.pages.state(foreign.p.id).accepted[restored.id], null);
  assert.equal(
    foreign.w.kernel
      .ledger(foreign.p.id)
      .events.filter((x) => x.kind === "acceptance").length,
    0,
  );
  const bad = structuredClone(exported.manifest);
  bad.state.page.title = "Tampered";
  await assert.rejects(
    foreign.pages.importPortable(foreign.p.id, {
      expectedProject: reference(foreign.p),
      manifest: bad,
      files: {},
      reason: "Tamper",
    }),
    /integrity/,
  );
  assert.equal(foreign.pages.state(foreign.p.id).pages.length, 1);
});
test('legacy conversion is an unaccepted additive proposal with an explicit loss record; old export remains byte-identical',async t=>{
 const root=mkdtempSync(join(tmpdir(),'bve-migration-'));const w=new Workspace(root,{directionFixture:true});t.after(()=>{w.close();rmSync(root,{recursive:true,force:true});});const seed=await seedComposition(w),pid=seed.project.id,c=new Compositions(w),pages=new Pages(w);
 c.start(pid,{expectedProject:reference(seed.project),direction:seed.direction,reason:'Synthetic fixture'});let legacy=latestComposition(w,pid);
 await c.save(pid,{expectedProject:reference(seed.project),expected:reference(legacy),direction:seed.direction,content:placeImages(w,pid,legacy.payload.state,seed.assets),reason:'Synthetic exact media'});
 await c.review(pid,{expectedProject:reference(seed.project),expected:reference(latestComposition(w,pid)),sections:sectionIds,reason:'Synthetic review acknowledging unresolved findings'});legacy=latestComposition(w,pid);
 await c.accept(pid,{expectedProject:reference(seed.project),artifact:reference(legacy),expected:null,reason:'Synthetic technical acceptance'});const before=await c.export(pid,reference(legacy));await pages.convert(pid,{composition:reference(legacy),reason:'Synthetic additive migration'});
 const converted=pages.state(pid).pages[0]!;assert.equal(converted.provenance.actor,'local-operator');assert.ok(converted.payload.state.page.unresolved.some(x=>x.includes('Conversion')));assert.equal(pages.state(pid).accepted[converted.id],null);assert.deepEqual(c.read(pid,reference(legacy)),legacy);assert.deepEqual((await c.export(pid,reference(legacy))).bytes,before.bytes);
 assert.ok(converted.dependencies.every(x=>w.kernel.get(x).type==='media-asset'));const own=pages.state(pid).media[0]!;const handoffState=converted.payload.state.page;assert.ok(Object.values(handoffState.media).some(x=>x?.image.id===own.payload.state.image.id));
 accept({w,p:seed.project,pages} as ReturnType<typeof setup>,converted);const portable=await pages.export(pid,reference(converted));const fresh=setup(t);const files=Object.fromEntries(portable.manifest.media.map(x=>[x.path,w.assets.read(x.state.image.id).toString('base64')]));await fresh.pages.importPortable(fresh.p.id,{expectedProject:reference(fresh.p),manifest:portable.manifest,files,reason:'Synthetic media restoration'});const restored=fresh.pages.state(fresh.p.id).pages[0]!;assert.equal(fresh.pages.state(fresh.p.id).accepted[restored.id],null);assert.deepEqual(Object.values(restored.payload.state.page.media).filter(x=>x).map(x=>x!.image.checksum),Object.values(converted.payload.state.page.media).filter(x=>x).map(x=>x!.image.checksum));
});
