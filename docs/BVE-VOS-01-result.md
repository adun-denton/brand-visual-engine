# BVE-VOS-01 implementation return

Implementation evidence for independent coordinator review; no acceptance or private task-status change.

## Identity

- Packet: BVE-VOS-01 revision 1; TODO-BVE-20261006-003, coordinating TODO-BVE-20261010-015.
- Pinned execution snapshot: `fd2fa29ce6e552452b50d50b0610aaeb3a7fa6c4`.
- Accepted software/PR base: `1a4864994fcbcbfce7a4b5a4e9d281b8c18c2e85`, `codex/bve-guided-native-exchange`; unchanged at launch and prepublication inspection.
- Branch: `codex/bve-visual-os-bootstrap-intake`; no subsequent changes existed at launch.
- Documentation checkpoint: `c360b716b3dfc2cb43c71d450cae3d6f49b82c88`, tree `4606a7d73fadd1725c37875fa90bc5dfe1359233`. All 13 manifest sources, accepted-base destination hashes and promoted destinations verified before publication. All 13 exact remote contents read back before coding. The source bundle remains unchanged.
- The exact result commit/tree and draft PR are recorded in the PR and the implementing chat's final return; this report is part of that result tree.
- Implementer: one GPT cloud coding session using the GitHub plugin and isolated Node 24.19.0 environment. No delegated agents.

## Result

An explicit new private root initializes/reopens one stable project and Homepage. A durable identity seed resumes interrupted initialization; config writes are atomic. Versioned config, runtime marker and canonical project/page identities are checked together. Foreign, source-controlled, unsupported, redirected or inconsistent roots are refused. Existing local instructions and settings survive reopen. Inspection reports environment and unverified/deferred capabilities without generation or credentials.

The additive production boundary freezes a validated raster specification and 1–6 distinct jobs. Each job binds project/page/iteration/spec integrity, exact source refs/hashes, bounded prompt, worker/output requests and owned staging. No synthetic batch or manual claim is fabricated. A completion marker commits to exact delivery JSON and is written last. Intake reads bounded regular files, verifies bindings, fully decodes one original buffer, checks hashes/descriptors/hard limits and stores those same bytes. Worker/image-model/prompt/tool evidence and declared provenance remain separate; unknowns stay null. Provenance remains a declaration, not proof of native generation.

Current ready deliveries atomically register media, raster concept, membership, immutable receipt and terminal job state through kernel gates. Missing completion records incomplete evidence without consuming a pending job. Changed delivery for a completed job records a conflict with verified descriptors and reference-only original evidence; the original result remains bound to the job. Identical replay retains receipt and candidate identities. Distinct jobs returning identical content retain separate job/candidate identities. Failed/uncertain outcomes retain bounded evidence. Cancelled, superseded and stale deliveries are historical with no active proposal. Scope is checked again inside the write boundary. Asset bytes written before a failed DB transaction remain recoverable and unreferenced; no automatic cleanup is added.

The existing comparison UI displays the three owned proposals in both layouts. A read-only projection groups production iterations and labels authored/reported deliveries as verified **bytes**. No visual redesign or human acceptance behavior was added. Preserved manual-native V1/V2 and synthetic registration remain separate.

### Files and interfaces

- New bootstrap/storage: `src/service/project-bootstrap.ts`, `runtime-owner.ts`, `schemas/project-config.schema.json`.
- New production contracts/gate/controller: `src/modules/website/production-contracts.ts`, `src/kernel/production-gate.ts`, `src/service/production-intake.ts`.
- Existing kernel/module registration and transaction gate extended; the existing specification packet builder is reused without synthetic-batch creation.
- `Workspace` takes an OS-released SQLite writer lease before opening application stores. The lock has no job data and sits beside the runtime, preserving legacy runtime byte inventories. Existing race probes explicitly share one application's lease across their two connections; no assertions or gates were removed. Separate applications/processes cannot acquire competing leases. Closed owners cannot write.
- `scripts/bve.ts`: `init`, `inspect`, `start`, `prepare`, `jobs`, `intake`, `receipts`, `cancel`, always with explicit `--root`. Read-only operations inspect closed stores without an application writer. Mutations use the running service or own a temporary loopback service. Stale discovery never authorizes a competing writer; read-only inspection remains available.
- `GET /api/v1/production/state`; authenticated `POST /api/v1/production/prepare`, `/intake`, `/cancel`. Existing host/origin/token protection retained. No token in config, discovery or evidence.
- Minimal projection in `src/service/visual-workspace.ts` and `src/web/visual.ts`.
- Authored fixture, focused unit/CLI/browser checks and additive Linux/Windows CI browser step; updated INSTALL, README and operator guide with implemented/deferred truth.

Additional files beyond the proposed map are necessary for the OS-held writer boundary, reproducible authored fixtures, read-only projection, public evidence and the existing regression probes' explicit same-owner connections. No provider dependency, general orchestration framework, job database, private project record or task queue was added. The SQLite lock file contains no project/job tables.

## Verification evidence

Local environment: Linux, Node 24.19.0, locked dependencies installed with `npm ci --ignore-scripts`; Playwright 1.58.2 and its pinned Chromium 145.0.7632.6 headless shell.

| Check | Command/procedure | Observed local result | Evidence |
|---|---|---|---|
| Documentation checkpoint | Verify 13 source/base/destination hashes; publish and fetch exact remote files | All 13 matched | Manifest and checkpoint above |
| Types/build | `npm run typecheck`; `npm run build` | Passed | Verification summary |
| Full unit suite | `npm test` | 417 total: 416 passed, 0 failed, 1 existing Windows-only ACL probe skipped on Linux | Verification summary |
| Focused bootstrap/intake/CLI | `node --test tests/project-bootstrap.test.ts tests/production-intake.test.ts` | 16 passed, including actual CLI/service reuse | A01–A15 probes |
| Legacy records | `test:native:compatibility`, `test:native:resolution-compatibility`, `test:native:repair-compatibility`, `test:combined:compatibility` | Passed; old tables, bytes, packages, receipts and cold reopen retained | Authored compatibility harnesses |
| Production browser | `npm run test:browser:production` | Three proposals, both layouts, comparison, 1440×1050 and 390×844, no overflow, cold reopen, no browser mutations/errors | [Browser summary](evidence/BVE-VOS-01/summary.json) |
| Retained browsers | `test:browser:guided-native`, `test:browser:native-resolution`, `test:browser:native`, `test:browser:visual` | Passed using pinned headless shell | Verification summary |
| Invalid input | Wrong bindings, partial/invalid completion, traversal, symlink/hardlink redirection, oversized/corrupt/changed bytes | Rejected without active registration; incomplete/conflict diagnostics preserve job state | Focused tests |
| Recovery/atomicity | Injected DB failure after asset write; async cancellation; scope race just before transaction; abrupt owner process death | No partial authoritative result; bytes reusable; late results historical; same identities reopen | Focused tests |
| Writer/port | Competing process/workspace/init/CLI; occupied port; stale closed owner | Competing owners refused; no process termination; owner released after close/crash | Bootstrap tests |
| Source policy | Count 1/6, rejected 0/7; Follow exact source refs/hashes, Brand off | Passed independently of synthetic/manual flow | Intake tests |
| Diff and source snapshot | `git diff --check`; immutable source bundle hash verification | Passed | Commit tree |

Browser evidence is an authored interaction fixture, not generated design or designer evaluation:

- [Contact sheet, desktop](evidence/BVE-VOS-01/sheet-desktop.png), [comparison](evidence/BVE-VOS-01/sheet-comparison.png), [narrow](evidence/BVE-VOS-01/sheet-narrow.png).
- [Filmstrip, desktop](evidence/BVE-VOS-01/film-desktop.png), [comparison](evidence/BVE-VOS-01/film-comparison.png), [narrow](evidence/BVE-VOS-01/film-narrow.png).

All six screenshots were captured from the actual browser; desktop/narrow output was visually inspected. Exact original fixture hashes and candidate identities are in the browser summary. Staged/stored/original-export byte equality, duplicate identity and restart/recovery assertions also run in focused tests.

### Failed attempts and corrections

Initial typechecks caught a format-union inference and a tautological test condition; both corrected. Initial broad tests exposed four old probes opening a second writer; their original assertions were retained with explicit same-owner connections. An overbroad test edit temporarily shared a closed lease in two cold-reopen probes; restored fresh ownership, then all tests passed. Compatibility inspection initially encountered the lock database and then its added files; moving the lock beside the authoritative runtime restored exact legacy inventories.

Final recovery audit added read-only canonical identity checks before reopening, a missing-database refusal and a nonempty-unregistered-runtime refusal during partial initialization. Conflict receipts retain independently verified changed-output descriptors and reference media without replacing the job result. Atomic writes also cover installed instruction copies and the private AGENTS template. Recognized leftover marker-write temporary files resume from the durable seed without being mistaken for an unrelated runtime. All 16 focused tests passed after these changes.

Windows focused CI initially passed 15/16 checks but exposed an unretained workspace in the child-process death fixture: the child could release its SQLite handle through garbage collection. The fixture now retains its workspace in the live timer until the deliberate kill, with bounded startup and unconditional child cleanup. The owning-writer assertion remains unchanged. The dedicated cross-platform focused step now runs before the full suite to surface this evidence directly. See PR-head CI for the corrected Windows result.

Final-head Windows CI encountered two retained-gate timing failures: an unchanged account-storage helper failed at its ~15-second limit (the same-head retry passed all 417 unit tests), then the execution-repair browser click exhausted its original 250 ms action budget after viewport scrolling. The browser fixture now explicitly completes scroll/readiness setup first; the 250 ms click limit and all held-dispatch/cancellation assertions remain unchanged. This additional script adaptation preserves the gate rather than removing it. See final PR-head CI for the resulting matrix.

The default Playwright browser CDN returned a truncated archive. The exact pinned full Chromium was obtained from the official Chrome-for-Testing location with archive integrity verification, but its process singleton could not open a Unix socket in this environment. The matching official pinned headless shell worked; all reported local browser gates used that shell. No gate was deleted or skipped to obtain a pass.

Git transport could clone/read but had no push credentials. Publication used the user-selected GitHub plugin's blob/tree/commit/ref operations with expected-head checks and no force. The documentation checkpoint's remote content verification preceded all Phase B work.

### Limits and pending checks

- Windows-specific filesystem, writer, process and ACL behavior requires **actual Windows CI**. Local Linux results do not establish Windows support. The existing Linux/Windows matrix and all existing CI gates are retained, with the new production browser gate added. Check the exact PR-head Actions result; any pending/failing remote checks remain review limitations.
- This packet implements bootstrap and verified local intake only. No native invocation/editing, account setup, public installer/release/updater, root adoption/migration, durable review submission, capture, clipboard continuation or full two-iteration conversational loop.
- Fixed child locations are supported; moving the complete closed project is supported, remapping children individually is refused. SQLite locks require a functioning local filesystem; synchronization is not multiwriter coordination.
- Missing completion is durable incomplete evidence. Malformed/binding/unsafe-file rejection is returned as an explicit error without registering canonical result evidence. It does not consume the job or invoke a retry.
- Historical output is retained as reference media/receipt, without candidate membership. Existing proposals/history are not deleted when superseded.
- Unknown native capabilities remain unverified; preferred dimensions are advisory. Local inspection consumes zero native quota.
- The minimal projection uses existing review controls. This is neither designer acceptance nor proof of live external-tool transfer.

Actual live native/provider/account/model/GPU calls: **0**. Production acceptance, automatic retries and automatic deletion: **0**. Existing regression tests exercise their prior synthetic acceptance paths; no real project or live output was accepted.

### Rollback and remote read-back

Leave the dependent PR draft and unmerged. To stop evaluation, close the owning foreground service, preserve the complete closed test root and use the matching earlier application plus a complete closed pre-adoption/test-root copy. Never downgrade an evolved real database in place. No private existing roots were adopted or migrated. No destructive cleanup is needed to abandon this isolated candidate.

Phase A remote read-back verified the exact commit/tree and all 13 promoted contents. Phase B remote commit/tree, changed-file verification, target and PR draft state are returned in the implementing chat and PR. The immutable source snapshot remains pinned to the handoff.

## Coordinator disposition

Pending independent review in the originating coordinator chat. No merge, release, deployment, private MSB change or self-acceptance occurred.
