import {nativeReturn,fixtureTar} from './native-exchange-fixture.ts';
import { AuxiliaryFixture } from "./auxiliary-fixture.ts";
/** Closed exact-V08 root rehearsal and additive native exchange recovery. Synthetic records only. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  cpSync,
  rmSync,
  symlinkSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve, relative } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { startApp } from "../src/service/server.ts";
import { reference, canonical } from "../src/kernel/packets.ts";
import { pageSignature } from "../src/modules/website/page.ts";
import { visualFixture, offlineVisualProviders } from "./visual-fixture.ts";
import { OfflineRasterTransport } from "./execution-fixture.ts";
import { ChatFixture } from "./chat-fixture.ts";
import { seedRepairPage } from "./inference-repair-fixture.ts";
import { ReconstructionFixture } from "./reconstruction-fixture.ts";
const base = "87c9484e83a12b570d632fbbe1c2e070a36a3319",
  tree = "8842b781c4bb9c24843f707d9ca01affd127009c",
  repo = resolve(import.meta.dirname, ".."),
  evidence = resolve(
    process.env["BVE_EVIDENCE_DIR"] ?? "/tmp/bve-native-compatibility",
  );
mkdirSync(evidence, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), "bve-native-compatibility-"));
const hash = (v: string | Buffer) =>
  createHash("sha256").update(v).digest("hex");
function inventory(root: string) {
  const files: Record<string, { sha256: string; bytes: number }> = {},
    tables: Record<string, string[]> = {};
  function walk(dir: string) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        walk(p);
        continue;
      }
      if (/\.sqlite-(wal|shm)$/.test(e.name)) continue;
      const name = relative(root, p).replaceAll("\\", "/"),
        bytes = readFileSync(p);
      files[name] = { sha256: hash(bytes), bytes: bytes.length };
      if (e.name.endsWith(".sqlite")) {
        const db = new DatabaseSync(p, { readOnly: true });
        try {
          for (const row of db
            .prepare(
              "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
            )
            .all()) {
            const table = String(row["name"]);
            assert.match(table, /^[a-z_]+$/);
            tables[name + ":" + table] = db
              .prepare("SELECT * FROM " + table)
              .all()
              .map((r) => JSON.stringify(r))
              .sort();
          }
        } finally {
          db.close();
        }
      }
    }
  }
  walk(root);
  return { files, tables };
}
function preserved(
  before: ReturnType<typeof inventory>,
  after: ReturnType<typeof inventory>,
  additive = false,
) {
  for (const [name, rows] of Object.entries(before.tables)) {
    const current = after.tables[name] ?? [];
    if (additive) {
      const set = new Set(current);
      for (const row of rows)
        assert.ok(set.has(row), name + " original serialized row changed");
    } else assert.deepEqual(current, rows, name + " records changed");
  }
  for (const [name, file] of Object.entries(before.files))
    if (!/\.sqlite$/.test(name))
      assert.deepEqual(after.files[name], file, name + " bytes changed");
}
try {
  assert.equal(
    execFileSync("git", ["rev-parse", base + "^{tree}"], {
      cwd: repo,
      encoding: "utf8",
    }).trim(),
    tree,
  );
  const code = join(scratch, "v08-code");
  mkdirSync(code);
  execFileSync("tar", ["-x", "-C", code], {
    input: execFileSync("git", ["archive", base], {
      cwd: repo,
      maxBuffer: 64 * 1024 * 1024,
    }),
  });
  symlinkSync(
    join(repo, "node_modules"),
    join(code, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const { startApp: upstream } = await import(
      pathToFileURL(join(code, "src/service/server.ts")).href
    ),
    original = join(scratch, "v08-original"),
    transport = new OfflineRasterTransport(),
    chat = new ChatFixture(),
    old: any = await upstream(original, 0, undefined, offlineVisualProviders, {
      chatDriver: chat,
      aiResponseFixture: true,
      executionFixture: { testOnly: true, transport },
      auxiliaryFixture: {testOnly:true,driver:new AuxiliaryFixture()},
      reconstructionFixture: {
        testOnly: true,
        driver: new ReconstructionFixture(),
      },
    });
  let meta: any;
  try {
    const project = old.visual.create({
        title: "Synthetic V08 migration root",
      }).project,
      pid = project.id,
      unit = old.visual.exploration.createWorkUnit(pid, {
        version: 1,
        pageType: "homepage",
        label: "Homepage",
        source: "Migration fixture",
      }),
      candidate = await old.visual.exploration.importCandidate(
        pid,
        reference(unit),
        await visualFixture(0),
        "Authored original raster rights",
      ),
      item = (
        await old.library.save(pid, {
          expectedProject: project,
          unit: reference(unit),
          candidate: reference(candidate),
          integrity: candidate.integrity,
          extent: "whole",
        })
      ).item;
    const prepared = await old.visual.command(pid, "prepare", {
        expectedProject: project,
        unit: reference(unit),
        selections: null,
        intent: "Offline receipt rehearsal",
        count: 1,
        direction: "fresh",
        brand: null,
        operation: "create",
        requests: [],
        level1: [],
      }),
      q = await old.visual.executions.compile(
        pid,
        reference(prepared.specification),
        64,
        48,
      ),
      grant = old.visual.executions.grant(pid, {
        request: reference(q),
        adapter: transport.capabilities.adapter,
        slots: [1],
        maxSubmissions: 1,
        maxStatusCalls: 12,
        maxCancelCalls: 6,
        timeoutMs: 1000,
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        reason: "Synthetic bound grant",
      });
    await old.visual.executions.execute(
      pid,
      reference(old.visual.executions.prepare(pid, reference(grant))),
    );
    const page = await seedRepairPage(old.pages, pid);
    old.pages.accept(pid, {
      artifact: reference(page),
      expected: null,
      reviewedHash: pageSignature(page.payload.state),
      reason: "Synthetic legacy semantic acceptance",
      acknowledgeFindings: true,
    });
    await old.pages.addMedia(pid, {
      expectedProject: project,
      file: (await visualFixture(1)).toString("base64"),
      origin: null,
      label: "Explicit placeable migration media",
      role: "placeable",
      permission: "Authored synthetic media",
    });
    const media = old.pages
      .state(pid)
      .media.find(
        (m: any) =>
          m.payload.state.label === "Explicit placeable migration media",
      );
    const turn = old.chat.send({
      projectId: null,
      clientId: "migration-completed-turn",
      text: "Synthetic historical bicycle design",
      focus: { view: "studio", page: null, resources: [], target: null },
    });
    await Promise.all([...old.chat.pending]);
    assert.equal(
      old.chat.state(turn.projectId).session.turns[0].status,
      "completed",
    );
    old.memory.saveNote(pid, {
      expected: null,
      note: {
        version: 1,
        scope: reference(unit),
        text: "Original human handoff",
        source: "human-authored",
        evidence: [],
      },
    });
    const rq = (
      await old.reconstruction.prepare(pid, {
        expectedProject: project,
        workUnit: reference(unit),
        source: reference(candidate),
        integrity: candidate.integrity,
        expectedControl: null,
        instruction: "Original V08 authored reconstruction",
        count: 1,
        viewports: [{ width: 1440, height: 1000 }],
        brand: null,
        base: null,
        baseSignature: null,
        resources: [],
        evidence: [],
      })
    ).request;
    const rr = (
        await old.reconstruction.execute(pid, { request: reference(rq) })
      ).result,
      reviewed = rr.payload.state.proposals[0];
    const originalAccepted = old.reconstruction.accept(pid, {
      request: reference(rq),
      result: reference(rr),
      proposal: reviewed.ref,
      reviewedHash: reviewed.signature,
      expectedControl: reference(
        old.reconstruction.state(pid, reference(unit)).control,
      ),
      expectedAcceptance: null,
      reason: "Original V08 review",
      acknowledgeFindings: true,
    }).accepted;
    const session=old.auxiliary.open().session,target={session,projectId:pid,workUnit:reference(unit),kind:'variation',key:'original-v08-draft'};
    const draft=old.auxiliary.observe(pid,{target,expected:null,values:{intent:'Original V08 draft'}});
    const auxScope=old.auxiliary.freeze(pid,{project,focus:{kind:'visual-page',unit:reference(unit),raster:{ref:reference(candidate),integrity:candidate.integrity},region:null},brand:null,references:[],evidence:[],target,draft:draft.token,editable:['intent'],ttlMs:60000,limits:{turns:1,tools:8,proposals:4,timeoutMs:10000,automaticRetry:false}});
    await old.auxiliary.send(pid,{scope:reference(auxScope),text:'Authored historical V08 auxiliary turn'}).completion;
    const capsule = old.memory.createCapsule(pid, {
      scope: reference(unit),
      previous: null,
    });
    mkdirSync(join(original, "rehearsal-exports"));
    writeFileSync(
      join(original, "rehearsal-exports", "semantic.tar"),
      (await old.pages.export(pid, reference(page))).bytes,
    );
    writeFileSync(
      join(original, "rehearsal-exports", "raster.tar"),
      (
        await old.library.export(
          pid,
          "package",
          reference(item),
          item.integrity,
        )
      ).bytes,
    );
    writeFileSync(
      join(original, "rehearsal-exports", "reconstruction.tar"),
      (await old.pages.export(pid, originalAccepted)).bytes,
    );
    writeFileSync(
      join(original, "rehearsal-exports", "capsule.json"),
      old.memory.download(pid, reference(capsule)).output,
    );
    meta = {
      pid,
      project,
      unit: reference(unit),
      candidate: reference(candidate),
      integrity: candidate.integrity,
      item: { ref: reference(item), integrity: item.integrity },
      page: reference(page),
      media: reference(media),
      capsule: reference(capsule),
      chatPid: turn.projectId,
      originalAccepted,
      originalRequest: reference(rq),
      originalResult: reference(rr),
    };
  } finally {
    await old.close();
  }
  const before = inventory(original),
    control = join(scratch, "closed-control"),
    compat = join(scratch, "compatibility-copy"),
    writes = join(scratch, "additive-write-copy");
  for (const dest of [control, compat, writes]) {
    cpSync(original, dest, { recursive: true });
    assert.deepEqual(inventory(dest), before);
  }
  let app = await startApp(compat, 0, undefined, offlineVisualProviders);
  try {
    assert.equal(
      app.reconstruction.state(meta.pid, meta.unit).history.length,
      1,
    );
    assert.deepEqual(
      app.reconstruction.state(meta.pid, meta.unit).accepted,
      meta.originalAccepted,
    );
    assert.equal(app.auxiliary.state(meta.pid, meta.unit).turns.length, 1);
    assert.equal(app.auxiliary.state(meta.pid, meta.unit).scopes.length, 1);
    assert.deepEqual(
      (await app.pages.export(meta.pid, meta.originalAccepted)).bytes,
      readFileSync(join(original, "rehearsal-exports", "reconstruction.tar")),
    );
    assert.equal(app.reconstruction.availability().connected, false);
    assert.deepEqual(
      (await app.pages.export(meta.pid, meta.page)).bytes,
      readFileSync(join(original, "rehearsal-exports", "semantic.tar")),
    );
    assert.deepEqual(
      (
        await app.library.export(
          meta.pid,
          "package",
          meta.item.ref,
          meta.item.integrity,
        )
      ).bytes,
      readFileSync(join(original, "rehearsal-exports", "raster.tar")),
    );
    assert.equal(
      app.memory.download(meta.pid, meta.capsule).output,
      readFileSync(join(original, "rehearsal-exports", "capsule.json"), "utf8"),
    );
    assert.equal(app.chat.state(meta.chatPid).session.turns.length, 1);
  } finally {
    await app.close();
  }
  const after = inventory(compat);
  preserved(before, after);
  app=await startApp(writes,0,undefined,offlineVisualProviders);
  let newUnit:any,run:any,receipt:any,item:any,capsule:any,requestBytes:Buffer,exportBytes:Buffer;
  try {
    newUnit=app.visual.exploration.createWorkUnit(meta.pid,{version:1,pageType:'about',label:'Additive manual exchange',source:'Authored fixture rehearsal'});
    const prepared=await app.visual.command(meta.pid,'prepare',{expectedProject:meta.project,unit:reference(newUnit),selections:null,intent:'Manual native-envelope fixture',count:1,direction:'fresh',brand:null,operation:'create',requests:[],level1:[]});
    const q=await app.visual.native.compile(meta.pid,reference((prepared as any).specification),64,48),g=app.visual.native.grant(meta.pid,{request:reference(q),slots:[1],maxSubmissions:1,maxStatusCalls:0,maxCancelCalls:0,timeoutMs:30000,expiresAt:new Date(Date.now()+3600000).toISOString(),evidence:'synthetic-fixture',reason:'Manual authored fixture authority'});
    run=app.visual.native.prepare(meta.pid,reference(g));
    const out=await app.visual.native.exportRequest(meta.pid,reference(run),1);requestBytes=out.bytes;
    const originals=fixtureTar(out.bytes),manifest=originals.get('manifest.json')!;originals.delete('manifest.json');
    const packageRequest=await app.visual.native.adapter.readRequest(manifest,originals);
    app.visual.native.claim(meta.pid,reference(run),1,packageRequest.packetDigest);
    const result=await nativeReturn(packageRequest);receipt=await app.visual.native.importResult(meta.pid,reference(run),result.manifest,result.files,false,result.result.binding.slot);
    assert.equal(receipt.payload.state.outcome,'returned');
    const candidate=app.visual.state(meta.pid,reference(newUnit)).candidates[0]!;
    item=(await app.library.save(meta.pid,{expectedProject:meta.project,unit:reference(newUnit),candidate:reference(candidate),integrity:candidate.integrity,extent:'whole'})).item;
    exportBytes=(await app.library.export(meta.pid,'package',reference(item),item.integrity)).bytes;
    capsule=app.memory.createCapsule(meta.pid,{scope:null,previous:null});
    mkdirSync(join(evidence,'authored-request'),{recursive:true});mkdirSync(join(evidence,'authored-return'),{recursive:true});
    writeFileSync(join(evidence,'authored-request','manifest.json'),out.manifest);
    writeFileSync(join(evidence,'authored-return','manifest.json'),result.manifest);
    writeFileSync(join(evidence,'authored-return','original.png'),[...result.files.values()][0]!);
    writeFileSync(join(evidence,'request.tar'),out.bytes);writeFileSync(join(evidence,'native-raster-export.tar'),exportBytes);
  } finally {await app.close();}
  const afterWrite=inventory(writes);preserved(before,afterWrite,true);
  app=await startApp(writes,0,undefined,offlineVisualProviders);
  try {
    assert.equal(app.visual.native.state(meta.pid,reference(newUnit)).runs[0]!.slots[0]!.status,'returned');
    assert.equal(app.visual.executions.availability().connected,false);
    assert.deepEqual((await app.library.export(meta.pid,'package',reference(item),item.integrity)).bytes,exportBytes!);
    assert.equal(app.memory.capsule(meta.pid,reference(capsule)).currency.status,'current');
    assert.equal(app.memory.download(meta.pid,meta.capsule).output,readFileSync(join(original,'rehearsal-exports','capsule.json'),'utf8'));
    assert.deepEqual(app.workspace.kernel.acceptedSelections(meta.pid),before.tables['kernel.sqlite:kernel_selections']!.map(row=>JSON.parse(row)).filter(row=>row.project_id===meta.pid).map(row=>({slot:row.slot,ref:JSON.parse(row.body)})));
    assert.equal(app.auxiliary.state(meta.pid,meta.unit).turns.length,1);
  } finally {await app.close();}
  preserved(before,inventory(writes),true);assert.deepEqual(inventory(control),before);
  writeFileSync(join(evidence,'v08-before-after-inventory.json'),JSON.stringify({base,tree,meta,before,after,afterWrite,originalSerializedRowsPreserved:true,mediaAndExportsPreserved:true,closedControlUnchanged:true,coldReopen:true},null,2)+'\n');
  const summary={base,tree,originalTables:Object.keys(before.tables),originalFiles:Object.keys(before.files).length,originalRowsBytesExportsAcceptanceChatReceiptsCapsulesPreserved:true,additiveNativeEvidenceAndColdReopen:true,originalAuxiliaryTurns:1,nativeInvocations:0,accountCalls:0,modelCalls:0,imageProviderCalls:0,gpuCalls:0,protectedRootAccesses:0};
  writeFileSync(join(evidence,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
} finally {rmSync(scratch,{recursive:true,force:true});}
