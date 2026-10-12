# V05 implementation evidence

Task: TODO-BVE-20261012-020. Planning pin: `70fa1a72df9ab55b732c4dd8f771d344cca9a470`.
Accepted base: `26b55de01f5b6759d031a4d21728dbc530a98b93`, tree
`bc55bbed7178d616f2814d723b075d04ba6972e1`. Branch: `codex/bve-vnext-v05-raster-library-export`;
draft target: `codex/bve-vnext-v04-project-memory`. Sol implements; originating Work reviewer independently
disposes this return. Exact published head/tree and platform CI are returned through PR/evidence report.
This document does not maintain canonical task status or authorize later stages.

V05 adds persistent exact whole-raster save, same-project named-page reuse, original downloads and
strict raster/manifest packages in the existing visual workspace. Two immutable work-record kinds
reuse canonical packets, revision events and content-addressed native assets. A new candidate depends
only on media; external source/Library lineage lives in work records. There is no schema/lockfile
change, migration, alternate database, crop/transform, grant or acceptance side effect.

| Area | Actual local command / synthetic evidence | Observation |
| --- | --- | --- |
| Locked setup | `npm ci --ignore-scripts` | Pass; Node 24.19.0 / npm 11.9.0 |
| Types and regression | `npm run typecheck`; `npm test` | 247 tests: 235 inherited + 12 Library groups, zero failures/skips |
| Formats and offline closure | `tests/raster-library.test.ts` | PNG/JPEG/WebP exact bytes/hash/MIME/dimensions; deterministic two-file ustar and strict manifest; EXIF6 encoded/display geometry retained |
| Boundaries and recovery | Same service/kernel tests | Foreign substitutions, false provenance/permission/orientation, reference-only and non-candidate records, plausible-header undecodable pixels, stale async expectations and invalid closure reject |
| Atomicity/idempotency | Same tests, including deliberate failure on final reuse gate | No partial candidate/membership/reuse; stable save identity under additional source memberships; per-item/page reuse returns same candidate |
| Memory compatibility | Library tests + V04 original/repair tests | Exact cross-page closure, generic completeness omission rejection, ledger-known Library loss, immutable capsules and read-only non-self-staling behavior preserved |
| Existing authority | Service/browser snapshots | Active selection, formal accepted pointer, project/Brand state and execution accounting remain distinct |
| Browser journey | `npm run test:browser:library` | Seven screenshots; chat-free empty/save/reopen/reuse/export/error/manual retry, keyboard focus, both layouts and 390 px geometry |
| Held interruption | New browser's held first-of-six response plus held Library POST | Ordinary Cancel/keyboard Revoke usable, one offline submit each; no polls, auto-adoption or extra dispatch |
| Existing browser regressions | `npm run test:browser:visual`; `npm run test:browser:execution`; `npm run test:browser:memory` | V02/V03/V04 and original repair probes retained |

Build, both smokes, fixture serialization/diff and whitespace checks form the final local gate; exact-head
Windows/Linux CI retains all inherited checks and adds one Library browser gate/artifact directory.
The result report contains actual completed outcomes, SHA256/archive receipts, screenshots and rerun history.
Local browser uses preinstalled Chromium143 through `BVE_CHROMIUM_EXECUTABLE`, disposable
`BVE_EVIDENCE_DIR` and exact `BVE_CANDIDATE_COMMIT` after publication. No local provider is installed.

The new browser initially exposed lost keyboard inspector focus during a pending panel refresh; focus
restoration now retains the initiating button unless the user focuses another control. An early new
interruption capture hit a scrolling/DOM timing timeout; the helper positions the ordinary target before
the unchanged250ms click. One inherited V04250ms Cancel probe also failed during concurrent browser
launches and passed its isolated rerun with no helper change. This is disclosed, not claimed as an
unrelated platform-intermittency repair. Final exact-head evidence governs the return.

Contract details and bounds: [raster-library.md](raster-library.md). Fixtures prove interaction and
deterministic byte-preserving persistence/export, not image-generation capability or designer usefulness.
Missing exact source/media cannot be reconstructed from ledger identity. Package import, cross-project
sharing/rights policy, transformation/crop formats, HTML reconstruction and local executor binding remain
deferred; neither layout nor attempt default is selected. No live account/model/GPU calls, local inventory,
provider installation, paid fallback, PR10 integration, merge or deployment occurred.

Rollback: use an isolated V05 review branch or prior accepted V04 checkout with a complete closed matching
disposable runtime copy. Do not revert shared earlier branches, downgrade real roots in place or selectively
delete canonical history/media. Stop at this implementation return; independent acceptance and any repair
handoff remain with the originating reviewer. Local generation stays at cycle end.
