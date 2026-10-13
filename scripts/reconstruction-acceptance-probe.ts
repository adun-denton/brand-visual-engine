/** Exact reversed-destination persistence probe. Disposable authored data only. */
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
import { DatabaseSync } from "node:sqlite";
import { startApp } from "../src/service/server.ts";
import { reference } from "../src/kernel/packets.ts";
import { seedRepairPage } from "./inference-repair-fixture.ts";
import { offlineVisualProviders } from "./visual-fixture.ts";

const expected = process.argv.includes("--expect=accepted")
  ? "accepted"
  : "rejected";
const evidence = resolve(
  process.env["BVE_EVIDENCE_DIR"] ?? join(tmpdir(), "bve-acceptance-probe"),
);
mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(join(tmpdir(), "bve-acceptance-probe-root-"));
const sha256 = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
function rows() {
  const db = new DatabaseSync(join(root, "kernel.sqlite"), { readOnly: true });
  try {
    return {
      packets: JSON.stringify(
        db
          .prepare(
            "SELECT id,version,body FROM kernel_packets ORDER BY id,version",
          )
          .all(),
      ),
      selections: JSON.stringify(
        db
          .prepare(
            "SELECT project_id,slot,body FROM kernel_selections ORDER BY project_id,slot",
          )
          .all(),
      ),
      events: JSON.stringify(
        db
          .prepare(
            "SELECT project_id,sequence,body FROM kernel_events ORDER BY project_id,sequence",
          )
          .all(),
      ),
    };
  } finally {
    db.close();
  }
}
const hashes = (state: ReturnType<typeof rows>) =>
  Object.fromEntries(
    Object.entries(state).map(([key, value]) => [key, sha256(value)]),
  );
let app = await startApp(root, 0, undefined, offlineVisualProviders);
try {
  const project = app.visual.create({
    title: "Synthetic reversed acceptance probe",
  }).project;
  const unit = app.visual.exploration.createWorkUnit(project.id, {
    version: 1,
    pageType: "homepage",
    label: "Homepage",
    source: "Authored boundary probe",
  });
  const page = await seedRepairPage(app.pages, project.id);
  const before = rows();
  assert.throws(
    () =>
      app.workspace.kernel.accept(
        project.id,
        "reconstruction:" + unit.id,
        reference(page),
        null,
        "local-operator",
        "Synthetic primary probe",
      ),
    /atomic bound review/,
  );
  assert.deepEqual(rows(), before);
  let outcome = "accepted",
    rejection: string | null = null;
  try {
    app.workspace.kernel.accept(
      project.id,
      "page:" + page.id,
      reference(page),
      null,
      "local-operator",
      "Synthetic bypass probe",
      null,
      undefined,
      {
        mirror: { slot: "reconstruction:" + unit.id, expected: null },
        records: [],
      },
    );
  } catch (error) {
    outcome = "rejected";
    rejection = error instanceof Error ? error.message : String(error);
  }
  assert.equal(outcome, expected);
  const after = rows();
  const primary = app.workspace.kernel.selected(project.id, "page:" + page.id);
  const mirrored = app.workspace.kernel.selected(
    project.id,
    "reconstruction:" + unit.id,
  );
  const reviews = app.workspace.kernel
    .latestPackets()
    .filter(
      (p) => (p.payload as { kind?: string }).kind === "reconstruction-review",
    ).length;
  assert.equal(reviews, 0);
  if (expected === "rejected") {
    assert.deepEqual(after, before);
    assert.equal(primary, null);
    assert.equal(mirrored, null);
  } else {
    assert.deepEqual(primary, reference(page));
    assert.deepEqual(mirrored, reference(page));
    assert.equal(after.packets, before.packets);
    assert.notEqual(after.selections, before.selections);
    assert.notEqual(after.events, before.events);
  }
  await app.close();
  app = await startApp(root, 0, undefined, offlineVisualProviders);
  const reopened = rows();
  assert.deepEqual(reopened, after);
  const persisted = app.workspace.kernel.selected(
    project.id,
    "reconstruction:" + unit.id,
  );
  assert.deepEqual(persisted, mirrored);
  const result = {
    kernelStoreBlob: execFileSync(
      "git",
      ["hash-object", "src/kernel/store.ts"],
      { cwd: resolve(import.meta.dirname, ".."), encoding: "utf8" },
    ).trim(),
    softwareHead:
      process.env["BVE_CANDIDATE_COMMIT"] ??
      execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: resolve(import.meta.dirname, ".."),
        encoding: "utf8",
      }).trim(),
    probeSha256: sha256(readFileSync(import.meta.filename)),
    primaryRejected: true,
    reversedOutcome: outcome,
    rejection,
    reviewRecords: reviews,
    primaryAccepted: primary,
    mirroredAccepted: mirrored,
    persistedAfterReopen: persisted,
    tableHashesBefore: hashes(before),
    tableHashesAfter: hashes(after),
    tableHashesReopened: hashes(reopened),
    rejectedWritesByteEquivalent: expected === "rejected",
    coldReopenByteEquivalent: true,
    authoredSynthetic: true,
    accountCalls: 0,
    modelCalls: 0,
    imageProviderCalls: 0,
    gpuCalls: 0,
    protectedRootAccesses: 0,
  };
  writeFileSync(
    join(evidence, "result.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result));
} finally {
  await app.close();
  rmSync(root, { recursive: true, force: true });
}
