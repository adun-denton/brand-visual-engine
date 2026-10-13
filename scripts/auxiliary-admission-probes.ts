/** Original V08 R1/R2 reviewer procedures on disposable authored roots only. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { startApp } from "../src/service/server.ts";
import { reference, revise } from "../src/kernel/packets.ts";
import { AuxiliaryFixture } from "./auxiliary-fixture.ts";
import { visualFixture, offlineVisualProviders } from "./visual-fixture.ts";

export async function admissionFixture() {
  const root = mkdtempSync(join(tmpdir(), "bve-aux-admission-")),
    driver = new AuxiliaryFixture();
  const app = await startApp(root, 0, undefined, offlineVisualProviders, {
    auxiliaryFixture: { testOnly: true, driver },
  });
  const p = app.visual.create({ title: "Authored admission probe" }).project;
  const u = app.visual.exploration.createWorkUnit(p.id, {
    version: 1,
    pageType: "homepage",
    label: "Home",
    source: "Authored fixture",
  });
  const c = await app.visual.exploration.importCandidate(
    p.id,
    reference(u),
    await visualFixture(0),
    "Synthetic rights",
  );
  const session = app.auxiliary.open().session;
  const target = {
    session,
    projectId: p.id,
    workUnit: reference(u),
    kind: "variation" as const,
    key: "probe",
  };
  const draft = app.auxiliary.observe(p.id, {
    target,
    expected: null,
    values: { intent: "Original explicit draft" },
  });
  return {
    root,
    driver,
    app,
    p,
    u,
    c,
    session,
    target,
    draft,
    close: async () => {
      await app.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
export type AdmissionFixture = Awaited<ReturnType<typeof admissionFixture>>;
export function probeScope(s: AdmissionFixture, turns = 1) {
  return s.app.auxiliary.freeze(s.p.id, {
    project: reference(s.app.workspace.project(s.p.id)),
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
    draft: s.draft.token,
    editable: ["intent"],
    ttlMs: 60000,
    limits: {
      turns,
      tools: 8,
      proposals: 4,
      timeoutMs: 10000,
      automaticRetry: false,
    },
  });
}
export function probeRequestInput(s: AdmissionFixture) {
  return {
    expectedProject: reference(s.app.workspace.project(s.p.id)),
    workUnit: reference(s.u),
    source: reference(s.c),
    integrity: s.c.integrity,
    expectedControl: null,
    instruction: "Exact authored whole raster",
    count: 1,
    viewports: [{ width: 1440, height: 1000 }],
    brand: null,
    base: null,
    baseSignature: null,
    resources: [],
    evidence: [],
  };
}
export function advanceProject(s: AdmissionFixture) {
  const p = s.app.workspace.project(s.p.id);
  return s.app.workspace.kernel.put(
    revise(
      p,
      p.payload,
      "synthetic-fixture",
      "Authored normal-gate project revision",
    ),
  );
}
export function admissionRows(s: AdmissionFixture) {
  const db = new DatabaseSync(join(s.root, "kernel.sqlite"), {
    readOnly: true,
  });
  try {
    return JSON.stringify({
      packets: db
        .prepare(
          "SELECT id,version,body FROM kernel_packets ORDER BY id,version",
        )
        .all(),
      ledger: db
        .prepare(
          "SELECT project_id,sequence,body FROM kernel_events ORDER BY project_id,sequence",
        )
        .all(),
      selections: db
        .prepare(
          "SELECT project_id,slot,body FROM kernel_selections ORDER BY project_id,slot",
        )
        .all(),
    });
  } finally {
    db.close();
  }
}
const sha256 = (s: string | Buffer) =>
  createHash("sha256").update(s).digest("hex");
function inventory(s: AdmissionFixture) {
  const rows = JSON.parse(admissionRows(s));
  return Object.fromEntries(
    Object.entries(rows).map(([key, value]) => [
      key,
      {
        rows: (value as unknown[]).length,
        sha256: sha256(JSON.stringify(value)),
      },
    ]),
  );
}
export async function originalAdmissionProbes(unsafe = false) {
  const r1 = await admissionFixture();
  let firstId = "";
  try {
    const scope = probeScope(r1),
      first = r1.app.auxiliary.send(r1.p.id, {
        scope: reference(scope),
        text: "First permitted turn",
      });
    firstId = first.turn.id;
    await first.completion;
    const intactBefore = inventory(r1);
    let intactRejected = false;
    try {
      await r1.app.auxiliary.send(r1.p.id, {
        scope: reference(scope),
        text: "Exhausted intact retry",
      }).completion;
    } catch {
      intactRejected = true;
    }
    assert.equal(intactRejected, true);
    assert.deepEqual(inventory(r1), intactBefore);
    const db = new DatabaseSync(join(r1.root, "kernel.sqlite"));
    db.prepare("DELETE FROM kernel_packets WHERE id=?").run(firstId);
    db.close();
    const before = inventory(r1);
    let lostRejected = false,
      rejection = "";
    try {
      await r1.app.auxiliary.send(r1.p.id, {
        scope: reference(scope),
        text: "Exhausted retry after loss",
      }).completion;
    } catch (e) {
      lostRejected = true;
      rejection = e instanceof Error ? e.message : String(e);
    }
    const after = inventory(r1),
      R1 = {
        declaredTurns: 1,
        intactRejected,
        lostRejected,
        driverCalls: r1.driver.calls,
        ledgerStillHasFirst: r1.app.workspace.kernel
          .ledger(r1.p.id)
          .events.some((e) => e.subject.id === firstId),
        rejection,
        before,
        after,
        rejectedWritesByteEquivalent:
          JSON.stringify(before) === JSON.stringify(after),
      };
    assert.equal(lostRejected, !unsafe);
    assert.equal(R1.driverCalls, unsafe ? 2 : 1);
    if (!unsafe) assert.equal(R1.rejectedWritesByteEquivalent, true);
    const r2 = await admissionFixture();
    try {
      const q = (
        await r2.app.reconstruction.prepare(r2.p.id, probeRequestInput(r2))
      ).request;
      advanceProject(r2);
      const before = inventory(r2);
      let rejected = false,
        rejection = "";
      try {
        const job = await r2.app.auxiliary.bridge(r2.p.id, {
          request: reference(q),
          integrity: q.integrity,
          timeoutMs: 10000,
        });
        await job.completion;
      } catch (e) {
        rejected = true;
        rejection = e instanceof Error ? e.message : String(e);
      }
      const after = inventory(r2),
        R2 = {
          requestProjectVersion: q.payload.state.heads.project,
          currentProjectVersion: r2.app.workspace.kernel.currentVersion(
            r2.p.id,
          ),
          rejected,
          rejection,
          driverCalls: r2.driver.calls,
          before,
          after,
          rejectedWritesByteEquivalent:
            JSON.stringify(before) === JSON.stringify(after),
        };
      assert.equal(rejected, true);
      assert.equal(R2.driverCalls, unsafe ? 1 : 0);
      if (!unsafe) assert.equal(R2.rejectedWritesByteEquivalent, true);
      return {
        R1,
        R2,
        synthetic: true,
        accountCalls: 0,
        modelCalls: 0,
        imageProviderCalls: 0,
        gpuCalls: 0,
        protectedRootAccesses: 0,
      };
    } finally {
      await r2.close();
    }
  } finally {
    await r1.close();
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const evidence = resolve(
    process.env["BVE_EVIDENCE_DIR"] ??
      join(tmpdir(), "bve-aux-admission-evidence"),
  );
  mkdirSync(evidence, { recursive: true });
  const result = {
    softwareHead: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    serviceBlob: execFileSync(
      "git",
      ["hash-object", "src/service/auxiliary.ts"],
      { encoding: "utf8" },
    ).trim(),
    probeSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
    expected: process.argv.includes("--expect=unsafe") ? "unsafe" : "rejected",
    ...(await originalAdmissionProbes(
      process.argv.includes("--expect=unsafe"),
    )),
  };
  writeFileSync(
    join(evidence, "original-admission-probes.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result));
}
