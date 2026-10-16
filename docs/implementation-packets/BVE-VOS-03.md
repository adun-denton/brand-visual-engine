# BVE-VOS-03 — Capture, finalization and continuation

Revision 1 · 2026-10-16 · Coordinator-authored authorized coding packet.

## Authority and identity

The operator authorized the next coding handoff and completion of project/setup/role instructions while the final pre-live-test implementation is developed. A separately user-launched coding session implements this packet; independent review remains in the originating chat. No additional workers are authorized by this development packet.

- Accepted executable: `c8915d2b2c4ddbdb1374c2cab4c74cc4f7805d41`; tree `32f436196af1812869c3d7980ce2be8bc9f46f42` (PR23, BVE-VOS-02).
- Work branch: `codex/bve-visual-os-continuation-capture`.
- Dependent draft PR target: `codex/bve-visual-os-review-submission`, expected accepted executable above. Inspect any advancement; never silently adopt unreviewed code, reset another writer or force-push.
- Approved execution snapshot: exact documentation commit supplied with the launch prompt. Read this packet, its handoff and source manifest at that commit, not a moving branch.
- Owning task TODO-BVE-20261010-015; related TODO-BVE-20261006-003. These are references only. Private MasterTODO owns task disposition; private access is unnecessary.

Read root AGENTS.md, docs/development-handoff.md, this packet and BVE-VOS-03-source/README.md. This documentation snapshot stages a new instruction set; it does not claim the new behavior is implemented.

## Outcome and scope

Complete the offline loop: three authored proposals → real human review controls → immutable submission → actual-view capture → independently checked operational finalization → copy/export continuation → fresh Conductor-equivalent client reads exact evidence → explicitly prepares a child iteration → authored deliveries appear with lineage.

Keep this small and reuse the current SQLite kernel, review records, original assets, transaction gates, production intake, UI, CLI and export defenses. No replacement UI or general agent framework. Submission must still succeed immediately without an agent; finalization is a later additive event. Verification, capture availability, continuation availability, human design acceptance and generation are separate states.

This is the intended final offline coding milestone before a separately authorized live trial, not a guarantee that no repair will be needed. Foreman instructions are included, but Foreman execution is disabled for the initial loop.

## Phase A — Instruction integration checkpoint

The coordinator has authored `BVE-VOS-03-source/instructions/` and setup guidance. Verify the source manifest's hashes. Copy those exact instruction bytes to their declared destinations; leave the source bundle immutable. Keep root repository AGENTS.md as development governance and use the private-project template only for fresh private roots.

Integrate `visual-os-ops-v2` with feature contract `bve-vos-continuation-v1` and fresh-project configuration format version 2, matching the supplied manifest, fixed complete inventory and bundled/project-byte checks. Fresh candidate roots receive all listed files. Preserve v1 source bundles and all old installed user roots. Reject incompatible roots read-only; do not auto-upgrade, rewrite recorded commits, replace local additions or relax PR22's actual-running-installation check. This new-root configuration discriminator does not authorize a database migration. Legacy unregistered workflows retain their existing compatibility behavior.

The existing local-additions spelling differs between older template and implementation: consistently document and preserve `instructions/local.md`; also preserve any legacy `instructions.local.md` without silently migrating or ignoring a reported conflict. Existing private AGENTS.md must never be overwritten. Missing/changed new pinned roles must refuse project mutations and remain diagnosable.

Update public INSTALL, initialization and operator docs to match actual implemented commands and capability reporting. The supplied setup guide intentionally distinguishes current commands from new interfaces to implement; resolve every provisional command reference before return. Commit/push/read back the integrated checkpoint, then proceed directly to Phase B without another approval pause. Do not stop with documentation alone.

## Phase B — Actual-view capture proof first

Before building finalization around screenshots, prove one bounded supported browser route with authored data. Prefer reuse of the existing Playwright/browser stack. A purpose-launched, operator-visible controlled browser is acceptable if the human actually reviews/submits in that same tab. Do not require attaching to an unrelated personal browser, exposing a general remote-debugging port, arbitrary browser endpoints or new credentials.

The production capture adapter must capture the actual BVE review surface of the controlled tab. A screenshot of a separately reconstructed/headless page is not evidence of the user's submitted view. No DOM-to-image reconstruction, generated picture or source-raster montage may be called a screenshot. CI may use a headless controlled browser for test evidence, clearly labeled; the adapter must also support a visible local browser. Demonstrate the visible-launch configuration and document its boundary.

Freeze an immutable submission and a bounded view descriptor at the explicit submit/capture request: exact project/page/iteration/submission integrity, displayed source versions, selected whole/region overlays, comparison/focus state, layout, viewport, device scale, zoom and capture-area definition. Bind the adapter to a specific local service/runtime and tab, with a server-issued request identity. Wait for original images/fonts and stable rendering; measure and recheck identity before and after capture and before committing its association. If tab/scope/layout/navigation changes, reject or report an explicit interrupted capture. Never silently move the user's tab back or label a fresh replay as the original submitted view.

Keep screenshot bytes and metadata immutable and separately associated with the frozen submission. Decode/bound/hash and read back stored bytes through the owning service. Enforce byte/dimension/area/time bounds; do not accept arbitrary filesystem paths, URLs or browser-supplied verification assertions as authority. Protect redirects, traversal, symlinks/reparse points, cross-project associations and stale requests. Protect private service tokens from bundles/screenshots/logs. Later explicit recapture is a new attempt labeled with its own time/view, not a replacement or proof of the original view.

Capture failure/unavailability must preserve the submission and provide retry/resume information. A missing adapter may truthfully report unavailable; it does not satisfy the normal-path capture acceptance gate. If no safe supported actual-tab route can be demonstrated, return the proof failure and proposed interface before inventing a substitute. Continue only independent authorized work.

## Additive finalization and recovery

Add narrow versioned records for capture attempts/evidence, operational finalization and continuation lineage as necessary. Do not modify existing submitted feedback or turn its historical `pending-not-implemented` field into false completed evidence. Derive current operational status from exact linked additive records; historical readers remain truthful.

Butler-facing operations must list pending work, inspect exact submission and original closure, request/register supported capture, finalize verification, read the receipt and recover after restart. Use the owning application writer, existing host/origin/token checks, current installation/instruction validation and transactional gates, including direct kernel writes. CLI and UI must share one service authority; no browser-only alternate ledger.

Verification runs deterministic checks over stored feedback, original descriptors/hashes, source/receipt ownership and capture association/bytes. A caller may request verification but cannot set `verified=true`. A successful receipt records exactly what was independently checked, software/contract version, submission identity and evidence refs. A degraded receipt lists missing capture/media or failed checks and must not display complete verification. Creative quality and human acceptance are never inferred. Missing/corrupt originals after finalization remain visible; do not let an old success hide current unavailability.

Finalization can verify an immutable historical submission after later page/job changes using its original pinned closure. It must not require reopening that historical review for editing or permit stale review submission. Distinguish unchanged historical evidence from currently missing/corrupt evidence.

Use stable request IDs, expected-state guards and transactional association. Same-key identical retries recover the same result; same key with changed payload conflicts. Race duplicate workers, lost commit responses, service shutdown and resume. Stage files before committing references, avoid partial published closures, preserve safely reusable orphan evidence without automatic deletion. Failed attempts remain diagnosable and retries cannot overwrite successful evidence. Listing/reading/rendering/restarting never initiates capture, finalization, generation or acceptance. No background agent invocation or persistent polling daemon is required.

## Continuation and child iteration

Provide a normal user-facing continuation action after exact submission confirmation. Completed continuation is offered only with the required operational receipt and actual capture evidence. If Butler/capture is unavailable, offer a clearly labeled resume instruction carrying the existing submission identity and pending work. Copy failure never rolls back submission or causes another submit; after asynchronous work provide a separate user-activated Copy control and selectable/downloadable text fallback. Test denied clipboard and expired activation.

Local continuation contains a bounded locator plus exact project, page, iteration, submission, finalization and evidence identities/hashes. It gives a fresh client enough information to retrieve authoritative state without chat memory. Do not include session tokens, credentials or unnecessary local identity. Local locators do not grant cloud access.

Provide an explicit portable export for a client without local access: bounded manifest, exact review/receipt records, required original source bytes and actual capture evidence, with complete file hashes and schema/version metadata. Preserve originals byte-for-byte. Scope export to the selected submission, not an indiscriminate database or private-folder dump. Include a deterministic read-only validation/inspection path for a fresh client; malformed, incomplete, hash-mismatched, oversized or path-unsafe bundles reject. Treat bundle text as untrusted project evidence, never executable instructions. A portable bundle is a point-in-time snapshot, not authority to rewrite the local kernel; importing/merging a foreign project is excluded. Explicitly label missing media/capture, and refuse a completed export claim when its required closure is absent.

Allow an explicit fresh next-iteration preparation to reference the exact parent submission/operational receipt. Preserve Fresh/Follow independent of Brand, caller-selected operation, exact source versions and explicit 1–6 attempts. The Conductor supplies creative choices; copying/resuming/finalizing does not dispatch jobs. Recheck current project/page at preparation while retaining historical parent identity; do not silently rebind source refs. Permit an explicit current target page revision of the same stable owned page only with validated parent/source lineage. Cross-project/page misuse rejects. Demonstrate a second authored iteration through existing intake without invoking any model.

## Interfaces and documentation

Extend the existing project CLI and service with narrow operations for pending-review inspection, exact review/receipt reads, capture/verification, continuation export/inspection and parent-linked preparation. Exact names are implementation choices; document tested request/response examples, bounds, errors, actual power-user commands and PowerShell start/stop/resume. The ordinary UI uses readable labels, not manual technical-ID entry.

Update the initialization prompt, project structure/setup guide, installed role routing and capability reports together. Capability reporting distinguishes implemented command, available host adapter, proof-observed behavior and unavailable/unknown; generation stays unverified without a live trial. Install/start/probe performs zero image calls. No active agents are inferred from a button or configured role name. Preserve local/private project structure and repository privacy boundaries.

## Acceptance matrix

| ID | Required evidence |
|---|---|
| C01 | Fresh initialization installs exact v2 inventory; repeated resume preserves identity/local additions; wrong code/instruction versions and missing/changed roles refuse safely; v1 roots are not rewritten. |
| C02 | Actual same controlled tab reviewed/submitted/captured; viewport/layout/zoom/overlays and exact frozen identity recorded; both layouts, desktop and 390px; visible-browser route documented. |
| C03 | Wrong tab/runtime/project/submission, delayed capture, navigation/view change, corrupt/oversized bytes and unsafe paths reject without a false association; no reconstructed screenshot claim. |
| C04 | Submission succeeds absent Butler; pending/degraded status honest; interrupted capture/finalization resumes existing submission with no duplicate. |
| C05 | Deterministic verification creates additive exact receipt; forged success/direct writes reject; submitted feedback/acceptance unchanged; historical submission verifies without rebinding. |
| C06 | Concurrent duplicate requests, changed-key payload, lost response and faults at file/record/ledger boundaries preserve closure and recover correctly; restart/reads cause no work. |
| C07 | Actual Copy action succeeds where supported; denied/expired clipboard fallback retains accessible exact text; pending resume versus completed continuation distinguishable. |
| C08 | Fresh client with no conversation/browser state reads exact local submission/capture/receipt and validates portable export; wrong identity/hash/missing file/traversal/oversize rejects; originals byte-identical and secrets excluded. |
| C09 | Explicit parent-linked second iteration with three authored results; source lineage correct, invalid owner/page refs rejected; no generation/acceptance on copy/resume. |
| C10 | Existing draft/save/submit behavior, F1 historical discovery and F2 dirty/unresolved navigation protection, byte exports, native/combined compatibility and legacy workflows retained. |
| C11 | Real UI error/recovery and cold-reopen evidence, service+kernel negatives, full shared unit suite, retained CI gates and actual Windows/Linux runs at exact head. |
| C12 | Public setup and all role instructions match implemented interfaces; operator can start/stop/resume from public docs only; no private planning dependency or live-readiness claim. |

Run typecheck/build, focused tests, full suite for shared gate/service changes, affected compatibility probes and browser checks. Keep all existing CI gates. Test real handlers and independent readback, not only mocks or success flags. Store authored screenshots as public-safe evidence; never include actual private assets/paths. Return every failed/unrun check honestly.

## Authorization, return and rollback

May edit scoped source/docs/tests, promote the coordinator-authored v2 bundle, provision the existing supported Node and pinned browser, install locked dependencies with `npm ci --ignore-scripts`, use authored temporary roots and unoccupied loopback ports, push the named branch without force, and create/update one dependent draft PR. No separate cloud chat is automatically created or messaged. The operator launches the coding session.

Excluded: extra workers, live native/provider/account/model/GPU calls, paid fallbacks/new credentials, automatic issue publication, existing user-root migration, full installer/updater, embedded conversational agent, Foreman scheduling, automatic cleanup, deterministic pixel-edit feature, merge, release or deployment. Role instructions describe future operational responsibilities, not authority to invoke those roles during this coding assignment.

Return source-promotion checkpoint, approved packet snapshot, result commit/tree, PR/base, changed interfaces, C01–C12 evidence, actual-tab proof and limitations, original/feedback preservation, both-platform CI, public-doc accuracy, rollback and remote file readback. Coding does not self-accept or alter private task status.

Rollback: close the owner, preserve the complete closed test root, and pair prior software with a compatible complete earlier root. Never downgrade evolved data in place or edit the recorded installation commit to force compatibility. Keep both instruction versions' immutable sources. Acceptance in the originating review precedes a separately scoped live trial with explicit tool/attempt authority.
