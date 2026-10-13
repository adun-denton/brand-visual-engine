/** Closed exact-V06 root rehearsal and additive V07 recovery. Synthetic records only. */
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
const base = "210509a1b2cdd36c2e290f6c7ce3752a1eff79fb",
  tree = "f6ce87408cd5f042ea55d759486b222c7f6236a0",
  repo = resolve(import.meta.dirname, ".."),
  evidence = resolve(
    process.env["BVE_EVIDENCE_DIR"] ?? "/tmp/bve-reconstruction-compatibility",
  );
mkdirSync(evidence, { recursive: true });
const scratch = mkdtempSync(
  join(tmpdir(), "bve-reconstruction-compatibility-"),
);
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
  const code = join(scratch, "v06-code");
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
    original = join(scratch, "v06-original"),
    transport = new OfflineRasterTransport(),
    chat = new ChatFixture(),
    old: any = await upstream(original, 0, undefined, offlineVisualProviders, {
      chatDriver: chat,
      aiResponseFixture: true,
      executionFixture: { testOnly: true, transport },
    });
  let meta: any;
  try {
    const project = old.visual.create({
        title: "Synthetic V06 migration root",
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
    assert.deepEqual(app.reconstruction.state(meta.pid, meta.unit).history, []);
    assert.equal(app.reconstruction.state(meta.pid, meta.unit).control, null);
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
  const fixture = new ReconstructionFixture();
  app = await startApp(writes, 0, undefined, offlineVisualProviders, {
    reconstructionFixture: { testOnly: true, driver: fixture },
  });
  let q: any, result: any, accepted: any, newCapsule: any, exported: Buffer;
  try {
    q = (
      await app.reconstruction.prepare(meta.pid, {
        expectedProject: meta.project,
        workUnit: meta.unit,
        source: meta.candidate,
        integrity: meta.integrity,
        expectedControl: null,
        instruction: "Additive authored semantic reconstruction",
        count: 2,
        viewports: [
          { width: 1440, height: 1000 },
          { width: 390, height: 844 },
        ],
        brand: null,
        base: null,
        baseSignature: null,
        resources: [
          {
            media: meta.media,
            label: "Explicit placeable source",
            role: "placeable",
          },
        ],
        evidence: [],
      })
    ).request;
    result = (
      (await app.reconstruction.execute(meta.pid, {
        request: reference(q),
      })) as any
    ).result;
    const proposal = result.payload.state.proposals[0];
    accepted = app.reconstruction.accept(meta.pid, {
      request: reference(q),
      result: reference(result),
      proposal: proposal.ref,
      reviewedHash: proposal.signature,
      expectedControl: reference(
        app.reconstruction.state(meta.pid, meta.unit).control!,
      ),
      expectedAcceptance: null,
      reason: "Explicit synthetic review",
      acknowledgeFindings: true,
    }).accepted;
    exported = (await app.pages.export(meta.pid, accepted)).bytes;
    newCapsule = app.memory.createCapsule(meta.pid, {
      scope: meta.unit,
      previous: meta.capsule,
    });
    assert.ok(
      app.memory
        .index(meta.pid, meta.unit)
        .entries.some((e) => e.ref.id === q.id),
    );
    assert.equal(
      app.memory.download(meta.pid, meta.capsule).output,
      readFileSync(join(original, "rehearsal-exports", "capsule.json"), "utf8"),
    );
  } finally {
    await app.close();
  }
  const afterWrite = inventory(writes);
  preserved(before, afterWrite, true);
  app = await startApp(writes, 0, undefined, offlineVisualProviders);
  try {
    assert.deepEqual(
      (await app.pages.export(meta.pid, accepted)).bytes,
      exported!,
    );
    assert.equal(
      app.reconstruction.state(meta.pid, meta.unit).control!.payload.state
        .request.id,
      q.id,
    );
    assert.equal(
      app.reconstruction.state(meta.pid, meta.unit).control!.payload.state
        .result!.id,
      result.id,
    );
    assert.equal(
      app.reconstruction.state(meta.pid, meta.unit).accepted!.id,
      accepted.id,
    );
    assert.equal(
      app.memory.capsule(meta.pid, reference(newCapsule)).currency.status,
      "current",
    );
    assert.equal(app.chat.state(meta.chatPid).session.turns.length, 1);
    assert.equal(app.reconstruction.availability().connected, false);
    assert.deepEqual(
      (await app.pages.export(meta.pid, meta.page)).bytes,
      readFileSync(join(original, "rehearsal-exports", "semantic.tar")),
    );
  } finally {
    await app.close();
  }
  preserved(before, inventory(writes), true);
  assert.deepEqual(inventory(control), before);
  writeFileSync(
    join(evidence, "v06-before-after-inventory.json"),
    JSON.stringify(
      {
        base,
        tree,
        meta,
        before,
        after,
        afterWrite,
        originalSerializedRowsPreserved: true,
        mediaAndExportsPreserved: true,
        closedControlUnchanged: true,
        coldReopen: true,
        oldRootEmptyReconstruction: true,
      },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(join(evidence, "new-accepted-semantic.tar"), exported!);
  const summary = {
    base,
    tree,
    originalTables: Object.keys(before.tables),
    originalFiles: Object.keys(before.files).length,
    requests: 1,
    proposals: 2,
    fixtureCalls: fixture.calls,
    oldRootEmptyReconstruction: true,
    originalRowsBytesExportsAndChatPreserved: true,
    additiveWritesAndColdReopen: true,
    accountCalls: 0,
    modelCalls: 0,
    imageProviderCalls: 0,
    gpuCalls: 0,
    protectedRootAccesses: 0,
  };
  writeFileSync(
    join(evidence, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  console.log(JSON.stringify(summary));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
