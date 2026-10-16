# BVE-VOS-01: bootstrap and verified local intake

Revision: 1. Date: 2026-10-15.
Authorization: the operator approved saving the Visual OS plan and giving a GPT cloud coding session a handoff to arrange GitHub project files first, then proceed to code. This packet activates that bounded sequence. Earlier proposal-only wording is superseded only for this packet.

## Identity and review ownership

- Repository: adun-denton/brand-visual-engine.
- Accepted software base: 1a4864994fcbcbfce7a4b5a4e9d281b8c18c2e85 (PR21).
- Handoff/implementation branch: codex/bve-visual-os-bootstrap-intake.
- Dependent PR base: codex/bve-guided-native-exchange. Verify its tip at launch; never silently rebase onto newer unreviewed work.
- Owning task: TODO-BVE-20261006-003. Coordination: TODO-BVE-20261010-015.
- Architectural authority and independent review: the originating coordinator chat, where the user will return the result.
- Implementer: the user-selected GPT cloud coding session. No additional agents or model trials are authorized.
- Execution snapshot: this file and BVE-VOS-01-files.json at the exact documentation commit supplied in the launch prompt.
- Private MSB owns task status. This complete sanitized packet does not require access to private MSB.

The handoff commit contains documentation/source templates only. Do not mistake it for implementation, independent acceptance, a merge or an installable release.

## Product and architectural constraints

Build the smallest path toward: request three designs in main Chat; view them in BVE; select/annotate; submit; continue in Chat; see the next iteration with recoverable history.

The Conductor owns creative conversation and job intent. Native Generators execute bounded requests. Butler independently verifies originals and manages BVE operations through deterministic services. BVE owns visual history. No Foreman, embedded conversation replacement, generic orchestration platform or new database.

Preserve Fresh/Follow separate from Brand, explicit 1-6 attempts, manual retry, immutable originals, source-bound regions and separate human acceptance. Human submission must eventually persist independently of agent availability. This packet stops before submission/capture implementation.

The inspected code already has SQLite kernel transactions, content-addressed assets, full raster decoding, raster specifications/selections, visual comparison and exact-byte exports. Reuse them. Existing raster-batch records explicitly declare synthetic-registration; keep those semantics and frozen V1/V2 manual exchanges intact. Do not process real production through registerSynthetic or fabricate manual claims.

## Phase A: arrange the coordinator-authored project files first

1. Inspect branch, working tree and applicable AGENTS.md. Read this pinned packet and the files manifest. Preserve unrelated work.
2. Verify every source template SHA-256 and its destination against BVE-VOS-01-files.json. Its baseFileSha256 identifies the existing destination at the accepted base, where applicable. If a destination unexpectedly changed, inspect and return a material conflict rather than overwriting it.
3. Copy each coordinator-authored source file to its manifest destination. These supply the root README and AGENTS.md, INSTALL.md, role instructions, private-project AGENTS template, initialization prompt, operating/update/reporting contracts and cross-account development guidance.
4. Keep the source bundle immutable as execution evidence. It is not a second operating instruction set; root/destination files become active after promotion.
5. Check public navigation, file hashes and diff. No private planning dependency may be introduced. Planned features must remain labeled pending.
6. Commit only the arranged public documents, push this branch without force, and read back the exact remote files and commit. Record this documentation checkpoint in the final result.
7. Proceed directly to Phase B. Do not stop for another authorization or imply that the checkpoint independently accepts the architecture.

This documentation checkpoint does not merge anything, file an issue or publish a release.

## Phase B: implement minimal bootstrap and local intake

### Expected result

In an explicitly designated new private root, initialize/reopen one BVE project, record compatible application/instruction identity, prepare one three-job production iteration, receive three authored raster deliveries through the production-intake boundary, and show their proposals in the existing visual workspace. Restart and identical replay preserve the same identities and bytes.

### Bootstrap and storage ownership

- Validate a versioned bve.project.json with stable project ID, runtime identity/location, staging root, selected installation/commit, compatible instruction version, initial page/work-unit reference, and explicit capture/continuation capability states.
- Project metadata identifies locations and compatibility; it does not duplicate authoritative history or job state.
- Software, authoritative runtime, references, disposable staging, exports and closed backups stay distinct. No private runtime under source control.
- Repeated init on a recognized compatible root reopens the same project and initial page. Preserve settings and local instruction additions.
- Refuse a nonempty unrelated root, unsupported format or inconsistent identity without replacement/reset.
- Resume partially completed initialization using a durable identity, without duplicate project creation. Config writes must be atomic.
- Do not implement adoption/migration of preexisting unregistered user roots. Return a clear unsupported/adoption-required result.
- Include inspection-only environment/tool capability status. Do not spawn or invoke generation for a health check.
- Preserve existing launch behavior and add documented project-bound launch/inspection/intake operations. Print the actual loopback URL and identity. No occupied-port process termination.
- Only one owning application writer may mutate a runtime. Agent operations use that service when running; initialization must not race a running owner. Test this boundary without creating a second job database.
- Do not initialize account sign-in or require credentials for this path. Narrowly avoid unused account dependencies if necessary, without rewriting the existing account subsystem.

### Production records and intake

Use an additive production iteration/job/receipt contract, not a general provider framework. Reuse the existing frozen Specification, media asset, RasterConcept and Membership representations where valid.

Minimum frozen job identity:
- project, page/work-unit, iteration and stable job ID;
- attempt ordinal and explicit count within 1-6;
- exact specification reference/integrity and bounded prompt;
- exact source references and hashes;
- designated project-owned staging location;
- requested worker configuration, output preferences/hard limits and bounded attempt intent.

Minimum delivery:
- contract version and job/spec/source bindings;
- outcome (ready, failed or uncertain) with bounded error evidence;
- actual output filenames, original-byte hashes, sizes, formats and dimensions;
- actual prompt/tool evidence where available; separate worker versus image-model fields; unknowns stay null/unknown;
- declared provenance (authored fixture versus reported native output); a claim is not independent proof;
- completion marker written last.

The fixture must exercise the production boundary while explicitly remaining authored. Native invocation is outside scope.

Minimum receipt:
- independently observed descriptors/hashes and binding checks;
- registered exact candidate/media/membership refs;
- duplicate, conflict, incomplete, failed or historical disposition as applicable;
- no creative judgment or acceptance.

Read only bounded files inside designated staging; reject traversal, redirected paths, oversized/corrupt files and incomplete markers. Validate one bounded byte buffer and store those same bytes. Use existing decode limits; do not automatically resize/re-encode.

Keep receipt, candidate, membership and job outcome atomically consistent through the kernel gate. Filesystem/SQLite cannot be assumed one transaction: handle assets written before a failed DB commit as unreferenced recoverable bytes, never as success. Do not add automatic cleanup.

Identical replay returns the same receipt and candidate identities. Same job with changed bytes is a conflict. Distinct jobs may reference identical content bytes without collapsing their job identities. Recheck current scope/version inside the write boundary to reject races.

Interrupted production is not permission for another invocation. Late/cancelled/superseded results cannot silently become the active proposal. Preserve explicit incomplete/error evidence without corrupting current state.

### Local interface and browser

Document operations equivalent to init, inspect, prepare bounded iteration, read jobs, intake completed delivery and read receipt. Choose simple implementation-appropriate command names and add their verified usage to INSTALL.md.

Keep root/token discovery local and bounded. No credentials/tokens in project exports or public evidence. Do not weaken the existing host/origin protection.

Expose the three registered proposals through the existing visual service and comparison UI. A narrow compatibility projection is allowed; a visual redesign is not. Integrity checks and schema gates must cover direct writes as well as HTTP input.

### Proposed file map

New candidates:
- src/service/project-bootstrap.ts
- src/service/production-intake.ts
- src/modules/website/production-contracts.ts
- src/kernel/production-gate.ts
- schemas/project-config.schema.json
- scripts/bve.ts
- tests/project-bootstrap.test.ts
- tests/production-intake.test.ts
- a focused authored browser fixture/check as needed.

Existing likely adaptations:
- src/kernel/gate.ts and src/modules/registry.ts for validated record registration;
- src/service/server.ts and src/service/visual-workspace.ts;
- package.json and applicable verification workflow;
- minimal view/projection wiring in src/web/visual.ts only if required.

Reuse src/service/assets.ts, src/kernel/store.ts, src/service/exploration.ts and source geometry. Additional necessary files must be justified in the result, not used to widen product scope.

## Acceptance matrix

A01. Repeat initialization: same project/page identity; no overwritten settings/assets/local instructions.
A02. Nonempty foreign or incompatible root: clear refusal, no canonical mutation.
A03. Interrupted initialization: deterministic resume without duplicate project.
A04. Three distinct jobs: correct iteration/project/page/spec association and three visible proposals.
A05. Staged, stored and original-export bytes match exactly.
A06. Identical delivery replay: same receipt/candidate, no extra canonical result.
A07. Wrong project/page/job/spec/source binding: reject before current proposal registration.
A08. Same job with changed bytes: conflict, no replacement; distinct jobs with identical bytes remain separately identified.
A09. Partial files, invalid completion, traversal/redirected paths, oversized or undecodable bytes: safe rejection.
A10. Cold reopen: same project, jobs, receipts and assets.
A11. No generation, retry, acceptance or automatic deletion.
A12. Retained manual-native and synthetic records remain readable with unchanged semantics.
A13. Kernel-level failure injection and async stale scope: no partial authoritative registration.
A14. One writer boundary: startup/init/intake cannot produce competing active owners or stale-process writes.
A15. Public docs and bootstrap tell the truth about implemented versus deferred behavior; native capability checks consume zero quota.
A16. Browser fixture at desktop and narrow width shows correctly owned three proposals without ordinary-user exchange bookkeeping.

## Validation and execution permission

Authorized in the isolated coding/CI environment:
- source/document edits within this packet;
- locked npm ci --ignore-scripts, supported Node provisioning if missing, and the pinned Playwright browser required for scoped tests;
- local fixture services on unoccupied ephemeral loopback ports;
- temporary synthetic runtime roots;
- commit/push to the named branch and one dependent draft PR.

No user-machine installation or existing private project mutation follows from these coding-environment permissions. No credentials, global model installations, new provider dependencies or native/API/GPU calls.

Run npm run typecheck, npm run build, full unit suite for shared gate changes, focused bootstrap/intake integration and browser tests, and retained native/synthetic compatibility checks affected by the changes. Keep existing CI gates; do not delete/skip a failing gate to pass. Preserve exact original-byte fixtures and test no mutation on invalid input.

Windows-specific path/writer behavior needs actual Windows CI evidence. Disclose any checks not run; Linux evidence is not Windows evidence. Run broad checks once at the appropriate integration boundary; repeat only after changes/failures justify it.

## Exclusions

No full public installer/updater, migration/adoption of existing roots, issue publication, release/tag/merge/deployment, provider integration, live generation/editing, pixel editor, submission/capture/clipboard implementation, Foreman, permanent notification mechanism, speculative abstraction, or extra agents.

The product target remains two iterations with reliable review and recovery, but this packet is only its bootstrap/intake foundation.

## Completion and return to this review chat

Create/update one dependent draft PR titled around the resulting bootstrap and local intake behavior. Explain scope and implementation limitations. Preserve the documentation checkpoint separately from code changes.

Before publication review exact files/diff; commit and push without force; remotely read back HEAD and changed files. Return:
- packet revision and pinned execution snapshot;
- accepted software base, documentation checkpoint, result commit/tree, branch and PR;
- files/interfaces changed and any deviations;
- tests/commands with actual results, failed attempts and checks not run;
- browser evidence with fixture provenance and viewport;
- confirmation of zero live native/provider calls and zero acceptance;
- original-byte/replay/recovery evidence;
- known limits and rollback;
- remote read-back evidence.

Use docs/result-report-template.md. Provide a compact review-return prompt for the user to paste into the originating chat. Do not message another chat unless separately instructed. Do not mark MSB tasks complete or approve your own result.

Rollback is to matching code plus a complete closed test/pre-adoption root. Never downgrade an evolved real database in place. Leave this PR draft and unmerged for independent review.
