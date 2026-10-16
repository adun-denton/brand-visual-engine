# BVE-VOS-02: review drafts and durable submission

Revision 1 · 2026-10-16 · Authorized bounded coding packet.

## Authority and exact starting point

The operator approved continuing with the next coding handoff after independent acceptance of PR22. The originating coordinator authors this packet; a user-launched GPT cloud session implements it, and independent review returns to the originating chat. No additional agents are authorized.

- Accepted executable base: `46ae9bf89efe58c2c4d8b1f368a703256a60e4fa`.
- Accepted tree: `a2ac8ffcc5e4acc72722d2d3e951494fa9ad6587`.
- Branch: `codex/bve-visual-os-review-submission`.
- Dependent draft PR base: `codex/bve-visual-os-bootstrap-intake`, expected tip equal to the accepted executable base. Inspect any advancement; never silently adopt unreviewed code or reset concurrent work.
- Execution snapshot: this packet at the exact documentation commit supplied by the coordinator's launch prompt. The packet commit is documentation-only.
- Owning task: TODO-BVE-20261010-015; related TODO-BVE-20261006-003. Private MasterTODO alone owns task status. Coding needs no private repository access.

Read root AGENTS.md, this pinned packet and docs/development-handoff.md. The earlier BVE-VOS-01 file-promotion phase is already complete; do not repeat it. Preserve the immutable BVE-VOS-01 source bundle and versioned role instructions. This packet supplies the new scoped development instructions without changing the installed instruction-set version.

## Outcome

Starting with three authored production proposals in one initialized private project, a user can compare them, select whole images or regions, add comments, save a review draft, close/restart BVE, recover it, submit the exact feedback, and reopen that immutable submission. No Butler session, model, external account or image call is required to save or submit.

Submission is a durable human feedback action. It is not a generation request, creative approval, operational verification, or acceptance of a design. The application validates and saves synchronously; it must not wait for an agent. Do not invent a completed Butler verification.

Keep the implementation small: extend the existing visual workspace, SQLite kernel and source-bound selection geometry. No replacement UI, second database or generic workflow framework.

## Inspected foundation and reuse

At the accepted base:
- src/service/visual-workspace.ts supports comparison-related state, owned raster selections and annotations through the existing exploration service.
- src/modules/website/exploration-contracts.ts defines whole/rectangle/ellipse/mask anchors, normalized-original coordinates, exact candidate refs/integrities, original image descriptors and notes. Preserve those semantics.
- src/web/visual-drafts.ts explicitly stores session-only PageDraft values in an in-memory Map. Do not describe this as durable storage. Some applied selections/notes are already canonical; unsaved form edits are not.
- Production iteration/job/receipt records provide owned proposals without reusing synthetic registration. Existing manual-native and synthetic contracts must remain readable and unchanged.
- Kernel transactions, source validation, original-byte exports, writer exclusion and strict project installation/instruction checks already exist. Use them for new writes.

Legacy selection sets and generic memory notes are not automatically review submissions. Do not relabel or silently migrate them. No global conversion of every legacy session draft is required.

## User workflow

1. Open an explicitly selected production iteration on its owned page. Show its proposal set and outcome summary, retaining truthful authored/reported provenance.
2. Compare candidates using existing controls. Select whole images and/or existing supported region shapes; add per-selection comments and one bounded overall review comment. Reuse source-bound intent and preservation controls where present; do not add new preservation promises.
3. **Save draft** persists the review's current feedback through the owning service. Explicit saving is sufficient for this packet; automatic saving is not required. Display unsaved/saving/saved/error states truthfully. A browser reload alone must not be represented as a save.
4. Switching page/project/iteration must not retarget pending edits or delayed responses. Warn before discarding dirty review edits, and offer saving or explicit discard. Preserve typed feedback on request failure or revision conflict. Unrelated next-variation and execution drafts retain their existing behavior.
5. Reopening the project exposes the saved review draft with correct candidates, regions and text. Restore relevant review context from explicit identity, not the last global browser selection. Cosmetic scroll/zoom restoration is optional and is not capture evidence.
6. **Submit review** includes all current review form edits, including changes since Save draft. Save any needed final draft revision and the immutable submission in one authoritative transaction. Do not require the user to save annotations separately first, and never silently submit an older saved revision.
7. Display the saved submission identity/revision and readable submitted feedback, with operational verification explicitly pending/not implemented. The user can reopen it after a cold restart without any agent running.
8. Submitted content is read-only. A deliberate **Edit as new draft** may copy it into a new draft with an explicit parent submission reference; submitting that draft creates a new submission without rewriting the previous one. This is the only requested post-submission editing path.

The review can contain comments without any selected candidate, so the user can explain that none works. Require substantive feedback: at least one selection or a nonblank overall comment. Do not silently select the first candidate. An iteration with zero reviewable proposals is not a review target in this packet. Partial iterations with at least one proposal may be reviewed; freeze their full observed job/outcome summary and label their partial state.

## Minimal authoritative contract

Choose clear additive versioned record kinds for a mutable review draft and an immutable review submission. No separate operational-verification service is implemented here. A submission records verification as pending/deferred; later finalization must be additive and must not mutate submitted human content.

Both records must bind:
- stable project identity and exact page/work-unit reference;
- one production iteration identity, its exact observed version/integrity and a bounded snapshot of its job/receipt outcomes;
- an explicit list of reviewable proposal candidate/media references, integrity and original-byte descriptors/hashes;
- the ordered selected whole/region entries, their stable IDs, original-coordinate geometry, source versions and bounded notes/intents;
- the overall review comment, record contract version and explicit parent submission when applicable.

A submission additionally binds the exact final draft reference/integrity, a server-validated content identity, the user action's stable idempotency key, and a server-generated timestamp/provenance. No identity, integrity, author identity or verification result supplied by the browser is trusted without validation. A local human action label is sufficient; no user/account identity system is needed.

Reuse canonical selection payloads/dependencies where possible. If adapters create selection revisions, commit them with the corresponding draft/submission and validate ownership/integrity in the same transaction. Do not make legacy selections and a new review store competing authorities for the same saved feedback. Document which record owns review content.

Bound payload size, number of entries, note lengths and shape/mask data using the existing contract limits. Permit only candidates belonging to the frozen reviewable proposal set; validate page/project/iteration/receipt/candidate/media closure and exact original descriptors at the kernel boundary, not just HTTP. Preserve image orientation rules and normalized-original coordinates across displayed scaling/layout changes. Never resize/re-encode originals to implement annotation or submission.

## Concurrency, freshness and failure rules

- Save draft uses an expected revision (or explicit expected absence). Two tabs cannot overwrite each other's changes silently. A conflict returns a useful recoverable result while preserving local typed feedback.
- Submit uses the same revision guard and a stable action key. One action retried after timeout or lost response returns the same submission identity. Same key with changed payload is a conflict, not an overwrite. Distinct explicit resubmissions require the new-draft path.
- Reconcile a lost response before clearing/replacing its action key or issuing another submission. After reload, the saved draft/submission relationship must let the client discover whether the action already committed. Do not rely solely on a short-lived browser variable for recovery.
- Validate current project/page/iteration and proposal-set/outcome fingerprint inside the write transaction. A late delivery, cancellation, supersession or scope revision while a review is open must produce a visible conflict requiring explicit reload/review; never silently change the reviewed set or submit feedback against a different scope.
- Previously saved drafts remain available if their target becomes historical, with an explicit stale/historical label. Keep them readable; do not rebind them automatically. Submission from stale scope is refused in this minimal packet. Already submitted snapshots remain readable and immutable despite later project/iteration/source revisions.
- A failed save/submit or injected database error leaves no partial authoritative draft/submission/selection closure. A failure after commit but before response is resolved by idempotent read-back. Never show Submitted before durable success or recovered confirmation.
- Repeated reads, browser render, restart, agent absence and inspection never generate, submit, retry a job, accept a design, or delete originals.
- Use the existing owning application writer and host/origin/session-token defenses. Direct kernel writes must not forge submitted closure or completed verification. Preserve PR22's actual installation and pinned-instruction validation on new project-bound mutations.

## Presentation and service boundary

Provide narrow service operations for load/list review records, save draft, submit and create draft from a submission. Use one authority for browser and future Butler clients. Exact routes/names are implementation choices and must be documented with bounded request/response examples.

Ordinary users need candidate images, comments, Save draft, Submit review and submission history. Keep technical record IDs available in details/diagnostics, not as manual input fields. Provide keyboard-accessible selection/comment/save/submit controls and useful focus/error/status feedback. Test both existing layouts and narrow width; no visual redesign is required.

Reopen must fetch exact stored submission content and original images, not reconstruct it from the current selection set, current proposal list or a chat summary. Missing/corrupt originals must produce explicit unavailable evidence; never substitute a newer image.

Minimal memory/index wiring is allowed if necessary so new records are discoverable and are not misrepresented by existing views. Do not widen this into portable continuation bundles, screenshots or clipboard transport. Preserve existing export/compatibility behavior; disclose any new record type that existing portable exporters intentionally do not include.

## Implementation map and documentation

Likely new files: a review contract/parser module, review service, kernel review gate, focused tests and authored browser fixture. Likely adaptations: module registration, kernel gate, visual service/server routes, visual UI/draft handling, package scripts and verification workflow. Reuse the existing production fixture for three proposals.

Keep changes scoped. Update INSTALL.md and the operator-facing guide with actual review commands/controls, save/recovery behavior, pending verification and limitations. Do not change fixed role hashes or introduce a new installation/compatibility policy merely to support this packet. Work from fresh disposable roots initialized by the candidate commit; an old selected root must still refuse mismatched software. Do not edit its recorded commit to bypass validation. Cold-reopen tests use the same candidate code/root pair.

## Acceptance matrix

| ID | Required independent evidence |
|---|---|
| R01 | Three authored production candidates shown with correct project/page/iteration association in both layouts |
| R02 | Whole and region selection, per-selection text and overall comment saved and recovered after browser/service restart; tested normalized coordinates at changed display size |
| R03 | A saved draft plus additional unsaved form edits submits the exact visible feedback, with final draft/submission atomically bound |
| R04 | Submit succeeds with no Butler/Conductor/model/account session; verification stays pending and acceptance ledger is unchanged |
| R05 | Double click, concurrent duplicate, lost response after commit and reload/retry recover one submission identity; changed payload under same key is rejected |
| R06 | Conflicting saves/submits from two clients preserve the winning revision and losing client's typed text; no last-writer-wins overwrite |
| R07 | Cross-project/page/iteration candidates, forged descriptors/references, invalid geometry and oversized content reject without canonical writes, including direct kernel paths |
| R08 | Late intake, cancellation/supersession or scope change before/during submit produces a recoverable conflict; historical draft remains readable |
| R09 | Injected failure at each canonical write leaves no partial submission closure; failure after commit recovers truthfully |
| R10 | Submitted feedback and exact source association remain unchanged after later edits/new draft/new submission/source revisions; missing/corrupt source fails explicitly |
| R11 | Comment-only rejection is allowed; empty feedback and zero-proposal iteration are refused; partial iteration outcome snapshot is truthful |
| R12 | Page/project/iteration switches and delayed responses do not leak drafts or clear another view's edits; dirty-navigation behavior is tested |
| R13 | Desktop and 390px browser evidence covers actual Save/Submit handlers, keyboard use, error recovery, both layouts and cold reopen; no ordinary-user record bookkeeping |
| R14 | Original-byte hashes/exports, retained synthetic/manual-native semantics, writer exclusion and strict installation/instruction checks remain intact |
| R15 | Existing CI gates remain; no model invocation, acceptance, automatic deletion, capture claim or fabricated verification occurs |

Run typecheck, build, focused review/bootstrap/intake tests, the full unit suite when shared gates/services change, affected native/combined compatibility probes and new browser checks. Retain existing browser and security gates. Actual Windows and Linux CI evidence is required. Report skipped/unrun checks and failed attempts honestly. Regression tests should exercise behavior/failure boundaries rather than merely mirror new implementation.

## Authorized execution and exclusions

The separate coding session may edit scoped source/docs/tests, install locked dependencies with npm ci --ignore-scripts in its isolated environment, provision the already-required supported Node and pinned Playwright browser, use authored fixture roots and unoccupied loopback ports, push the named branch without force, and create/update one dependent draft PR. Proceed from this packet directly to scoped implementation without another approval pause.

No extra workers, live native/provider/account/model/GPU calls, new credentials, actual user-root migration or mutation, full installer/updater, capture/screenshot product feature, clipboard/Chat continuation, automated Butler invocation/finalization, pixel editing, issue publication, merge, release or deployment. Test screenshots are allowed as browser evidence; they are not the product capture feature.

## Return for independent review

Return the approved packet commit/revision, accepted software base, exact result commit/tree, branch and draft PR, changed files/interfaces, test results and failures, both-platform CI, authored browser evidence, lost-response/concurrency/recovery and byte-preservation results, limitations, and rollback. Commit exact files, push, and remotely read back before claiming publication. Use docs/result-report-template.md; leave the PR draft/unmerged and private task status untouched. No other chat is messaged automatically.

Rollback means stop the owning service and preserve the complete closed test root; use matching earlier code and a complete compatible closed root. Never downgrade evolved data in place. The user returns the result to the originating reviewer for independent acceptance.
