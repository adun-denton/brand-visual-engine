# V04 implementation evidence

Task: TODO-BVE-20261012-019. Planning pin: `9e5dd46caabafcbe5cbcdb1fb7a0a68f35d118ce`.
Accepted software parent: `6f5ed84476fa53d460054b6f4b576af26541cad5`, tree
`5b3e97dd3cc6a8d21ef9c62396724795dbe507ae`. Branch: `codex/bve-vnext-v04-project-memory`;
draft target: `codex/bve-vnext-v03-execution-orchestration`. Exact result identity and platform CI
are returned through the PR/coordinator report; this document does not maintain canonical task status.

The slice adds deterministic owner-scoped evidence discovery, explicit versioned handoff notes,
immutable exact-version capsules, safe JSON download and optional chat-free continuation in both
visual layouts. Source packets, selections, events, actual acceptance and V03 accounting remain the
authority. Capsule bookkeeping is excluded from source currentness. No SQLite schema, dependency
lock, provider transport, user-runtime migration or accepted output changes are required.

| Acceptance area | Actual local command / evidence | Observation |
| --- | --- | --- |
| Locked setup | `npm ci --ignore-scripts` | Pass; Node 24.19.0 / npm 11.9.0 |
| Types | `npm run typecheck` | Pass |
| Regression and fresh reader | `npm test` | 230 tests, 0 failures/skips; 220 inherited + 10 memory scenarios |
| Build | `npm run build` | Pass |
| Both smokes | `npm run smoke`; `npm run smoke:design-os` | Pass, offline |
| Legacy fixture | `node scripts/serialize-design-fixtures.ts`; `git diff --exit-code -- fixtures/design-os.json`; `git diff --check` | Pass; unchanged fixture/lock/schema |
| V02 interaction and repairs | `npm run test:browser:visual` | Geometry/persistence and R1–R3 pass; no page errors |
| V03 lifecycle and repairs | `npm run test:browser:execution` | Original walkthrough and held Cancel/keyboard Revoke, duplicate guard, late historical evidence and explicit storage recovery pass |
| V04 continuation | `npm run test:browser:memory` | Seven screenshots; conflict draft retention, create/refresh/currentness, exact source, JSON round-trip, isolation, narrow geometry and closed-runtime fresh browser pass |
| Active interruption | V04 held six-slot response plus held memory POST | Ordinary Cancel/Revoke remain usable; one submit per execution, zero status/cancellation calls, historical-only output |
| Compatibility | Memory tests + inherited compatibility scenarios | Closed legacy SQLite/RGB bytes, accepted pointers, exact page exports and old note/capsule versions preserved |
| Bounds and loss | Real 65-revision/52-note histories, storage corruption, oversized evidence/snapshot rejection | Stable ordering/explicit pagination and omissions; no latest fallback or silent clipping |

Local browser override: `BVE_CHROMIUM_EXECUTABLE` points to preinstalled Chromium 143.0.7499.0.
`BVE_EVIDENCE_DIR` selects a disposable output directory. The initial affected-suite launches used an
incorrect override name and reported missing Playwright browser; reruns with the documented override
pass. CI runs the existing locked installation and normal browser setup with one added memory gate.
No repository provider or browser installation is required by the local handoff. The initial Linux
CI at the intermediate head passed all inherited gates, but failed V04 screenshot capture when the
inspection action replaced the DOM during Playwright's stable-element scroll. The evidence helper
now waits for that memory action to finish before capture and scrolls the current node synchronously;
ordinary Cancel/Revoke probes retain their original 250 ms bound. Final exact-head platform outcomes
are reported separately. A later Windows run failed opening the inherited V02 repair fixture
(connection failure before V03/V04); that platform history is retained. Final corruption probes also
cover damaged scoped-note visibility, corrupt approved-context links, foreign corrupt/missing-version
rejection and storage-read errors without invented corruption outcomes. Final currency compares source heads observed at snapshot creation, so a
historical version already included in a fresh capsule is not labelled a newly changed source.
Another Linux memory-gate run caught a probe reading grant revision two before the asynchronous
Revoke response committed it. The probe now waits for that exact revision to exist, retaining the
250 ms ordinary-click bound, real persisted-revocation assertion and one-submit-per-run assertions.
No execution or product contract was weakened to repair these evidence helpers.

The deterministic fresh consumer follows saved selections from an About capsule to exact imported
Homepage v1 after replacement by v2, with no previous browser/controller session, false About membership,
acceptance or executor. Closed reopen retains a delivered late historical receipt and reference media
without a candidate, hidden poll or resend. Brand facts remain separately approved, scoped evidence;
per-spec Direction/Brand use remains explicit. Active invocations/error-cache bytes remain process-only.

Limits, routes and storage/authority mapping are in [project-memory.md](project-memory.md).
This proves deterministic continuation and interaction, not actual new-model-session usefulness or
image-generation capability. Large evidence/masks can exceed the stated response/snapshot bounds and
are rejected; portable media archives/import, chat/session adapters, model summaries, HTML reconstruction,
final layout/default count and real executor recipes remain deferred.

Rollback: use an isolated prior checkout with a complete closed matching runtime copy; never downgrade
an evolved root in place or delete selected records/media/history. Independent review and canonical
completion remain pending with the coordinator. No live account/model/GPU/image call, provider install,
paid fallback, PR10 integration, merge or deployment occurred.

## R1–R2 repair evidence

Repair authority: `eaa87191c5a1742a7019dac1ea9781fbae4ff78b`; reviewed repair base:
`9416e3d06d6c1f704606b4540c6fb57c75e14f51`. Original planning provenance and draft target remain unchanged.
The original isolated loss probe changed from ledger-retained/indexed=false/missing0/current to
indexed=true/missing1/incomplete. The original mutually consistent omission changed from accepted to
atomic rejection (`Capsule scoped completeness/coverage mismatch`). Diagnostics lived outside Git.

The projection is now shared by service reads and the transactional memory gate. Revision discovery
includes missing exact versions without relying on surviving packet rows or inbound references.
Primary loss is explicit with unknown scope/type and no invented text/hash. Missing standalone/historical
notes and another independent primary record survive fresh reads and closed reopen; foreign loss stays
isolated. Coverage validation rejects omitted notes, selected source closure, events/acceptance,
falsified unsupported/omitted counts and unrelated scope additions, including coherent digests/dependencies.
Historical capsules/refresh and ordinary non-self-staling creation/export remain intact.

Repair verification: 235 tests (230 retained + five focused repair groups), strict typecheck/build,
both smokes, fixture/diff checks, original V02/V03/V04 browser cases and three added missing-primary
screenshots. Exact-head Windows/Linux evidence is returned with the PR/coordinator report; independent
acceptance is pending. No local session, live generation, provider installation, migration, PR10
integration, merge or deployment is performed by these repairs. Rollback remains the isolated accepted
V03 checkout with a complete closed matching runtime, never in-place downgrade or selective deletion.
