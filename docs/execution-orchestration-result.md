# V03 bounded implementation return

Task `TODO-BVE-20261012-018`; planning pin `512b738803645fd6a32cce5e8b7c7f665b855cd0`.
Implementer: Sol. Independent acceptance and canonical task disposition remain with the originating
Work reviewer. This result does not complete the task.

Base `e6e2eac5552d6d00742663548e02f1a6cf7a24e9`, tree
`588c3e4aa0db1123a41d1994060a82f996a3a2ce`. Branch
`codex/bve-vnext-v03-execution-orchestration`; dependent draft target
`codex/bve-vnext-v02-visual-workspace`. Exact published head/tree and CI are supplied in the draft PR
and returned screenshot report. Base branch was checked without drift; existing worktrees preserved.

## Changed files

| Files | Rationale |
|---|---|
| `src/modules/website/execution-contracts.ts`, `src/kernel/execution-gate.ts` | Typed additive request/grant/run/receipt contracts, deterministic compilation, closure/ownership/immutability/accounting gates |
| `src/kernel/gate.ts`, `src/modules/website/design.ts` | Register those work-record kinds without relaxing V01 validators |
| `src/service/execution.ts` | Injected offline transport, reservations, serial lifecycle, independent call budgets, recovery/cancel/retry and atomic validated intake |
| `src/service/server.ts`, `src/service/visual-workspace.ts` | Explicit test injection, projection and narrow protected commands; production disconnected |
| `src/web/visual.ts`, `src/web/visual-drafts.ts`, `src/web/visual.css` | Minimal execution states/grant/actions and labelled synthetic output grouping; both layouts and prior session draft controls preserved |
| `scripts/execution-fixture.ts`, `scripts/execution-browser-check.ts` | Authored fixture transport and browser assertions/screens through normal controllers |
| `tests/execution.test.ts` | 26 meaningful lifecycle, adverse, compatibility and recovery tests |
| `package.json`, `.github/workflows/verify.yml` | New browser gate and evidence artifacts on Windows/Linux; lock/dependencies unchanged |
| `docs/execution-orchestration.md`, this document | Sanitized architecture, contract mapping, evidence, limitations and rollback |

## Acceptance evidence

Local Linux Node 24.19.0/npm 11.9.0; available Chromium 143.0.7499.0. Synthetic fresh test roots outside
checkout, ephemeral ports, explicitly offline existing provider configuration. No user runtime touched.

| Check | Actual command / procedure | Observed result |
|---|---|---|
| Locked setup | `npm ci --ignore-scripts` | Pass; unchanged lock/dependencies |
| Strict typing | `npm run typecheck` | Pass |
| Full regressions | `npm test` | 220 pass, zero failures/skips; accepted baseline 194 plus 26 V03 tests |
| Build | `npm run build` | Pass |
| Existing smokes | `npm run smoke`; `npm run smoke:design-os` | Pass; existing integrity/recovery/rendering semantics preserved |
| Stable fixture | `node scripts/serialize-design-fixtures.ts`; `git diff --exit-code -- fixtures/design-os.json` | Byte-identical |
| V02 visual/R1–R3 | `npm run test:browser:visual` with evidence directory and available executable | Geometry/persistence and all repair assertions pass; no page errors, actual calls zero |
| V03 browser | `npm run test:browser:execution` with same test-only environment | 17 desktop/narrow screenshots, both layouts, unavailable/explicit grant/partial/retry/cancel/uncertainty; no page errors, nine offline submits/two status/one cancellation call, zero actual calls |
| Diff | `git diff --check` | Pass |
| Platform gates | Existing workflow plus new execution browser gate | Exact-head Windows/Linux result returned in PR/report; all ten browser workflows required |

Lifecycle tests cover counts 1/6 and invalid limits; duplicate/concurrent Execute; project/request/grant/
adapter/capability rejection; expiry/revocation; missing/corrupt closure; exact source and rights/notes;
excluded resources and fresh inspiration; immutable compilation after replacement/close/restore; crash
before reservation/after reservation/possible send; no resend; ambiguous/timeout/unknown status;
independent call exhaustion; scoped cancellation, denial and races; new-grant manual retry lineage;
valid/invalid/failed neighbors; duplicate/conflicting receipts; foreign envelope/dimensions; asset and
transaction storage failure recovery; stale/late historical output; direct gate forgery rejection;
V01 synthetic non-execution and unchanged existing packets. Prior full tests retain legacy bytes,
hashes, accepted pointers and exports/recovery coverage.

The browser evidence is authored synthetic interaction, not model/provider image generation. CI is
required before return; historical passes are not substituted for the new head. Other existing browser
workflows are supplied by exact-head CI rather than all being redundantly repeated locally.

## Limits and inactive local phase

Production has no executor; test grants cannot authorize a real transport. No paid fallback, provider
installation, local inventory, ComfyUI binding, live account/model/image-provider/GPU call, HTML
reconstruction, PR10 integration, merge or deployment. V01 generated origin remains unavailable.
Current design characteristics remain unknown. Final layout and default count remain unselected.

Expiry/revocation also block status/cancel dispatch; saved cancellation intent may therefore lack remote
confirmation. Unknown work never proves cancellation/no charge. Late/uncertain results remain reference
evidence. Calls are conservatively consumed even if a later pre-send process dies. No billing/usage,
GPU kill, abrupt power-loss or actual provider semantics claim. Database failure can leave unassociated
content-addressed bytes. Session drafts still end on reload; source annotations still require explicit
save before freeze. Cancel/Revoke remain reachable in the initiating UI during dispatch. Duplicate execution and conflicting
page writes stay guarded. Stored-progress observations are bounded GETs, never provider status polls.

The injectable local binding points and proposed inactive local matrix are documented in
[execution-orchestration.md](execution-orchestration.md). They require subsequent concrete capability
review and separate actual-call authorization; they were not run.

Rollback: separate checkout at accepted base plus complete closed matching test runtime; no in-place
root downgrade, selective history/media deletion or implicit migration. For bounded code reversal,
revert this change on a new branch while preserving the dependent PR lineage. Return any local probe,
exact identity, OS/Node/browser, commands/exits and defect evidence to the originating Work reviewer;
that session cannot grant acceptance or start another packet.

## Bounded R1–R2 repair return

Repair authority `a07b1c533b1776a40ef64a63569c957fe2798308`; reviewed parent
`a2520639e3ab1f9207229fdd440df7fdf40d6f59`, tree
`6d746e096d97fc3803abfd7ce9290095b7eb1348`. Original planning pin, branch and dependent draft
PR13 target remain unchanged. Exact repair head/tree and platform evidence are returned in PR13 and
the refreshed screenshot report; canonical task acceptance is still pending independent review.

Ten files changed by this repair: execution service and narrow persistence confirmation gate; server
receiver closure and visual command routing; visual UI; existing/new execution browser scripts;
execution tests; these two technical docs. No V01 contract, frozen request, grant terms, dependency,
lockfile, schema, accepted pointer, legacy export or competing canonical store is changed.

| Original reproduction | Reviewed parent | Repaired behavior |
|---|---|---|
| Held six-slot UI Cancel | Root inert; bounded click blocked; no intent; six submits after release | Root interactive; intent durable before release; one submit, undispatched slots cancelled; late bytes historical |
| Held UI keyboard Revoke | Same awaited inert wrapper prevents ordinary interruption | Keyboard focus survives progress refresh; revocation saved before release; remaining dispatch blocked, no remote-kill claim |
| 5 ms timeout / later valid acknowledgement | One submit, uncertain, null job/receipt despite delivered bytes | Foreground remains bounded; owned job and one historical receipt/reference retained; zero candidates/status queries/continuation |

Seven added service tests cover delivered late evidence/closed reopen; reconciliation races, duplicate
and conflicting identities; invalid late media/failure/rejection; asset/transaction storage failures with
explicit no-call cache retry; late status/cancellation confirmation after receipt; unreceived shutdown
uncertainty; and draining already-processing intake before storage closes. The prior timeout regression
now checks retained historical evidence as well as a separate failed status call, preserving its original
no-resend/allowance assertions. Full suite is 220 tests with zero failures/skips.

Six added screenshots/assertion scenarios cover held pointer Cancel, held keyboard Revoke, duplicate
Execute, page/draft isolation and recovery, cancellation follow-up after denial, delivered-late historical
state and visible storage failure/explicit evidence retry. These run inside the existing execution browser
CI gate, alongside the original eleven screenshots and all V02 R1–R3 regressions. Required commands
remain the matrix above. Exact-head Windows/Linux results and any initial CI failure history are returned
in PR13; no historical pass substitutes for the repair head.

Known limits: pending-delivery/failure cache is process-only. Committed evidence survives close/reopen;
undelivered or failed-to-store bytes are not claimed durable after receiver shutdown. Late intake cannot
adopt candidates or reopen consumed authority. Confirmation can progress without mutating receipt or
outcome. No automatic submit/status/cancel continuation occurs. Actual executor semantics, local
inventory/generation, final layout/default count, image quality and designer usefulness remain deferred.

Rollback this bounded repair on a new branch, or use the reviewed parent in a separate checkout and a
complete closed runtime matching that code. Preserve evolved history/media; no in-place downgrade or
selective deletion. No separate local session is required for these cloud-reproducible repairs.
