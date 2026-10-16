# BVE-VOS-02 review submission result

## Identity

- Packet: BVE-VOS-02 revision 1; approved documentation snapshot `bf47c94969f6efec88373a3ef0b31ad206a81c37`.
- Accepted executable base `46ae9bf89efe58c2c4d8b1f368a703256a60e4fa`; tree `a2ac8ffcc5e4acc72722d2d3e951494fa9ad6587`.
- Branch `codex/bve-visual-os-review-submission`; dependent draft PR target `codex/bve-visual-os-bootstrap-intake`. Both remote tips matched the approved identities at launch; the snapshot adds only the two packet documents. No concurrent changes were reset. Exact result commit/tree, PR and completed CI run identities are in the PR return rather than a self-referential result commit.
- Owning TODO-BVE-20261010-015; related TODO-BVE-20261006-003. Private task status and independent acceptance remain with the originating coordinator.
- Implementer: Codex with the GitHub connector; no additional workers.

## Result and changed interfaces

Save draft persists production review feedback separately from legacy selections. Submit review includes current form edits, committing a final draft revision and an immutable submission in one kernel transaction, without Butler, Conductor, account or model participation. Submitted feedback retains exact source versions, normalized-original geometry, ordered stable selection/note identities, exact human text (including whitespace), full observed outcomes/receipt inventory and explicit parent submission when copied. Confirmation reports operational verification pending / not implemented, never acceptance.

The kernel reconstructs owned project/page/iteration/job/receipt/candidate/media/membership closure, verifies original descriptors and bytes for new writes, and checks freshness inside the transaction. Browser fields cannot assert an author, timestamp, integrity or verification result. The submission binds final draft integrity, content identity, original expected revision, stable action key, canonical request identity and server timestamp/provenance. A submitted draft cannot be revised through any write path; editing creates a new parent-linked draft. One submitted action retried after a lost response returns the same record; changed feedback under the same key conflicts. Canonical draft/submission relationships remain discoverable after restart and do not depend on an in-memory agent or tab variable.

The UI reuses image focus, whole/rectangle/ellipse controls, comparison and encoded-top-left normalized-original geometry. Saved mask geometry is supported through the existing parser/service and remains inspectable; this adds no mask editor. Review source comments and overall text are immediately included by Save/Submit without a separate Save source note action. Dirty project/page/iteration navigation, including Add page/project, offers save/explicit discard/stay; unresolved or pending actions cannot be discarded while their outcome is unknown. Losing revisions and request failures retain typed feedback. Stale/historical feedback is labeled and remains readable; the user explicitly starts a new review of current outcomes rather than rebinding it.

Exact submitted originals are served by the immutable review reference. An unavailable-media workspace also exposes a read-only review catalog and stored feedback, with explicit unavailable originals and no substitution or mutation. The page and iteration identities remain visible during that recovery. Original images are never resized, re-encoded, accepted or deleted by review operations.

New implementation files:
- `src/modules/website/review-contracts.ts`: additive versioned draft/submission contracts and existing geometry validation.
- `src/kernel/review-gate.ts`: independent closure, freshness, immutable-content and dependency checks.
- `src/service/reviews.ts`: the single owning review service, bounded discovery, revision/idempotency recovery and exact originals.
- `src/web/production-review.ts`: scoped browser review form, dirty navigation, immutable history and lost-response reconciliation.
- `tests/reviews.test.ts` and `scripts/review-browser-check.ts`: behavioral/failure and authored browser evidence.

Adaptations: kernel gate/store and website validator register the new records; server/visual projection expose narrow review routes and a recovery catalog; existing visual UI/CSS integrate the form; memory index exposes honest bounded summaries; package/workflow add the focused and browser gates. INSTALL and the operator guide document actual behavior and API examples. No database/schema migration, second database, role-hash change or new installation policy. The immutable coordinator source bundle and all existing gates remain intact.

Routes under `/api/v1/visual/review/`: GET `catalog`, `state`, `original`; POST `save`, `submit`, `copy`. All writes retain Host/Origin/session-token protection, OS writer ownership, and PR22 installation/instruction checks. Request/response examples and limits are in [INSTALL.md](../INSTALL.md#local-review-service-interface).

## Verification evidence

Local runtime: existing supported Node 24.19.0 and locked dependencies reused. CI performs the locked dependency install on both platforms. Local browser uses the pinned official Chrome-for-Testing headless-shell 145.0.7632.6; the ZIP passed integrity verification and its known official checksum/size matched. No credential or generation preflight ran.

| Check | Actual local result |
|---|---|
| `npm run typecheck`; `npm run build` | Passed |
| `node --test tests/reviews.test.ts tests/project-bootstrap.test.ts tests/production-intake.test.ts` | 28 passed, zero failed/skipped |
| `npm test` | 429 total; 428 passed; zero failed; one existing Windows-only ACL probe skipped |
| Combined compatibility (v05/r8) | Passed |
| Native, native-repair and native-resolution compatibility | Passed; retained originals/exports/rows/receipts/cold recovery intact |
| `test:browser:review-submission` | Passed: real Save/Submit handlers, keyboard use, pending edits, reload/restart, failures/conflicts and source-unavailable recovery |
| Production, Execution, Library and project-memory browser regressions | Passed, including retained cancellation/keyboard-revoke controls |
| `git diff --check` | Passed before publication |

The unchanged full CI workflow plus the new review gates runs on actual Windows 2025 and Ubuntu 24.04 at the published head; the PR return records that run's exact results and artifact links. Local Linux output is not presented as Windows evidence.

### Acceptance evidence map

| Checks | Exercised boundary |
|---|---|
| R01–R04 | Three authored proposals, whole/region and overall text, Save/reload, changes after Save included by Submit, atomic final revision, no agent/account or acceptance |
| R05–R06 | Concurrent identical HTTP submissions, duplicate browser clicks, lost response after commit plus failed initial readback then reload, same-key changed payload (including whitespace), two-client save conflict with losing text retained |
| R07 | Wrong owner/reference/descriptor, invalid/out-of-bounds geometry, oversized comments and forged complete scope rejected with canonical snapshot equality; direct kernel forgery and completed-verification/rewrite attempts rejected; ellipse/mask positive controls |
| R08 | Late ready delivery and new incomplete diagnostic receipt invalidate a saved scope; cancellation, supersession and later source revision preserve historical reads and refuse stale writes |
| R09 | SQLite triggers fail each draft/submission packet/event insertion: no partial closure or ledger; injected before-write scope race refuses; failure after commit recovers the original submission |
| R10 | Original submission survives new draft/new submission/source revision; exact original export hashes remain; authored corruption yields explicit unavailable media with read-only feedback recovery |
| R11 | Comment-only rejection accepted, empty feedback/zero-proposal iteration refused, partial outcomes frozen and labeled |
| R12–R13 | Dirty page/project/iteration and Add page guards; delayed committed save cannot retarget; actual keyboard handlers; both layouts at 1440×1050 and 390×844; cold restart and unavailable-media recovery |
| R14–R15 | Existing bootstrap/intake writer, installation/instruction regressions and compatibility gates retained; no invocation, acceptance, deletion, capture claim or invented verification |

[Authored browser summary](evidence/BVE-VOS-02/summary.json), [verification/checksums](evidence/BVE-VOS-02/verification.json) and seven screenshots are committed. Desktop saved review, narrow cold reopen and unavailable-original recovery were visually inspected. Local evidence explicitly describes the implementation working tree on the documentation snapshot; separate CI artifacts pin committed-head browser execution. Fixture rasters are authored SVG compositions rendered by sharp, not generated designs or quality/acceptance evidence.

Initial failures/refinements: a test-injection draft referenced a nonexistent Workspace registry property; it was replaced with actual SQLite abort triggers on each canonical packet/event write. Typecheck caught non-erasable TypeScript parameter properties; explicit fields resolved it. A forged-scope test expected a later closure diagnostic although the earlier freshness guard already rejected it; the assertion now accepts either rejection while still proving identical canonical history. Final inspection added receipt-inventory freshness, exact text preservation and read-only unavailable-media recovery; their focused/browser probes passed. No existing timeout, security gate or regression assertion was weakened.

## Limitations, recovery and publication

- Explicit saving only. Unsent edits are browser-local and are not described as durable. Tab storage helps preserve unresolved actions where available; the canonical final-draft/submission relationship is the recovery authority. Review reads and reloads never submit or invoke production.
- Review is limited to registered production iterations with at least one proposal. Frozen scope supports 1–6 jobs and at most 64 observed receipts; an oversized inventory is refused without truncation. Feedback uses existing selection/note/shape bounds, a 4000-character overall comment and a 10 MiB UTF-8 payload bound.
- A stale draft or copied historical scope cannot be silently retargeted or submitted. Starting a review of changed outcomes is explicit and creates another draft; earlier records remain. The recovery catalog requires structurally intact canonical configuration/records, even when original files are unavailable.
- Legacy next-variation/selection drafts are retained separately. Memory/portable continuation includes bounded review summaries only, not complete feedback, masks or original media; it is not a review backup or restore transport. Use a complete closed root for backup.
- Strict matching installation/instruction policy remains unchanged. This adds no migration, updater, live generation, agent finalization, submission transport to Chat, capture/clipboard product feature or automatic saving. Operational verification is always pending / not implemented.
- Zero live native/provider/account/model/GPU calls, zero design acceptance, no merge/release/deployment, no extra workers and no private planning/project/task-record changes.

Before publication the exact diff/files are reviewed; publication uses a non-force expected-head update. The final return verifies every changed remote blob (including evidence images), commit/tree, draft target and completed CI checks. Those exact identifiers are recorded in the PR body/return, avoiding a self-referential evidence commit.

Rollback: stop the owning fixture service and preserve the complete closed test root. Use the accepted earlier executable `46ae9bf89efe58c2c4d8b1f368a703256a60e4fa` only with a complete matching earlier root; use fresh disposable roots for candidate checks. Never downgrade an evolved database in place or change recorded installation identity to bypass compatibility. No user root was operated on.

## Coordinator disposition

Implementation candidate only. Independently review R01–R15 at the exact returned commit/tree, especially unsaved final feedback, lost-response/idempotent recovery, two-client conflicts, late receipt freshness, original availability and immutable snapshots. Keep the dependent PR draft/unmerged until that disposition. Private task completion and acceptance remain with the originating review chat.
