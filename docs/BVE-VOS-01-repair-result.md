# BVE-VOS-01 F1/F2 repair result

## Identity

- Owning TODO-BVE-20261006-003; coordinating TODO-BVE-20261010-015. Independent acceptance and private task status remain with the originating coordinator.
- Authorized independent-review snapshot: `068a81242bd1c9340a328a9965a3b66b8fddce37`.
- Original packet: BVE-VOS-01 revision 1, execution snapshot `fd2fa29ce6e552452b50d50b0610aaeb3a7fa6c4`.
- Accepted software base: `1a4864994fcbcbfce7a4b5a4e9d281b8c18c2e85`.
- Preserved documentation checkpoint: `c360b716b3dfc2cb43c71d450cae3d6f49b82c88`.
- Repair parent: `12e977c85803e0b4b7d1e000018648c7cad10dc7`, tree `c4f3d387723bd1af1002618894f98e86044a8b4d`. The local checkout was clean before fast-forwarding to this exact remote head; no subsequent work was reset.
- Existing branch `codex/bve-visual-os-bootstrap-intake`; dependent [draft PR22](https://github.com/adun-denton/brand-visual-engine/pull/22), target `codex/bve-guided-native-exchange` unchanged. The PR return identifies the exact published repair commit/tree and CI run.
- Implemented with Codex and the GitHub connector; no additional agents.

## Result

F1: project operations resolve the executing checkout's real path and Git HEAD rather than trusting stored project metadata. Initialization, interrupted-seed resume, project-bound startup and production write guards require that identity to equal the selected installation. A changed commit or another checkout is refused without rebinding. The service captures its running identity at startup and exposes it in production state; CLI mutations compare that identity against both the selected installation and their own running installation before requesting a session token. Startup reports running and selected identities separately.

F2: all four pinned `visual-os-ops-v1` instruction paths and hashes are fixed by the application contract and checked against the bundled manifest/source files and project copies. Existing-config resume no longer bypasses verification. Missing, altered or unsafe role files refuse operation; partial bootstrap also refuses altered existing pins before history writes. No latest-version fetch, automatic restoration, migration or updater is added. Local additions and project AGENTS.md remain untouched.

`inspect` always uses read-only canonical inspection, including while an owner is running. It distinguishes selected/running installation identities and reports each pinned file as `ok`, `missing`, `changed` or `unsafe`, even when compatibility fails. Unsupported configuration/schema or inconsistent canonical identity still refuses inspection rather than bypassing integrity checks.

Changed files: `src/service/project-bootstrap.ts` (identity/compatibility), `src/service/server.ts` (startup identity and state), `scripts/bve.ts` (CLI boundary), `scripts/production-fixture.ts` (actual fixture checkout identity), `tests/project-bootstrap.test.ts` (three new regressions and matching-service assertions), `INSTALL.md` (operator behavior), this report and authored browser evidence. The coordinator source bundle, existing instruction bytes, intake contracts, host/token protection, prior CI gates and visual UI remain unchanged.

## Verification evidence

| Check | Command/procedure | Local observed result |
|---|---|---|
| Typecheck/build | `npm run typecheck`; `npm run build` | Passed |
| Focused bootstrap/intake | `node --test tests/project-bootstrap.test.ts tests/production-intake.test.ts` | 19 passed; no failures/skips |
| Full units | `npm test` | 420 total; 419 passed; one existing Windows-only skip; zero failures |
| F1 controls | Changed selected commit at same path; other Git checkout at same commit; matching identity; actual CLI owning-service reuse; mismatched service evidence | Refusal/matching behavior verified; mismatch causes no token request or mutation; config and canonical hashes unchanged |
| F2 controls | Changed/missing/unsafe Butler; simultaneous changed Butler and missing Generator; unchanged pins; local additions and project AGENTS.md | Diagnostic inspection and refusal verified; config/canonical hashes unchanged; local files preserved |
| Shared compatibility | `test:combined:compatibility`, `test:native:compatibility`, `test:native:repair-compatibility`, `test:native:resolution-compatibility` | Passed; retained rows, originals, exports, receipts and cold recovery preserved |
| Production browser | `npm run test:browser:production` | Three authored proposals; both layouts; desktop 1440×1050 and narrow 390×844; comparison and cold reopen; exact original hashes; zero browser writes/page errors/acceptances |
| Shared browser regressions | `npm run test:browser:execution`; `npm run test:browser:library` | Passed, including held cancellation/keyboard revoke and unchanged-control probes; zero page errors |
| Whitespace | `git diff --check` | Passed before publication |

[Browser summary](evidence/BVE-VOS-01-repair/summary.json) and [verification/checksums](evidence/BVE-VOS-01-repair/verification.json) accompany all six production screenshots. The sheet desktop and film narrow images were visually inspected. All originals were authored SVG compositions rasterized with sharp, never generated. Local browser evidence describes the repair working tree on the reviewed parent, not an exact committed-head run. Both-platform CI reruns the unchanged complete workflow at the published repair head and uploads separate evidence; consult that exact PR check run for Windows results and committed-head browser provenance.

Initial attempts: the first new byte-inventory assertions incorrectly treated SQLite's disposable shared-memory/empty WAL files, created by read-only WAL access, as canonical history changes. The assertions now hash all authoritative runtime files and nonempty WAL data, excluding shared-memory/empty WAL coordination files; all three new regressions then passed. Canonical database and project-config bytes were unchanged. Playwright's default browser download produced a truncated ZIP in this environment. The same pinned official Chrome-for-Testing headless-shell build was downloaded directly, its 116288461-byte ZIP passed integrity verification, and its MD5 matched the official object metadata before local browser execution. No existing test budget or production protection was relaxed.

## Limits, recovery and publication

This is strict compatibility refusal, not migration or an updater. Advancing a selected checkout's HEAD or switching checkout paths requires matching code plus a compatible complete closed root; there is no automatic rebinding. Git HEAD/path identity does not attest that a development working tree is clean. Archive/release installation without resolvable Git identity remains unsupported. Read-only SQLite access may create disposable WAL coordination files but does not write canonical history or configuration. Inspection still requires a structurally valid config and intact supported canonical runtime.

There were zero native/account/model/image-provider/GPU calls, zero production acceptance, and no merge, release, deployment, issue publication or private task/project-record modification. Existing non-project-bound launch behavior remains supported.

Rollback: stop the owning test service and wait for it to close. Preserve the entire closed test root. Use the matching pre-repair code/root pair (reviewed parent `12e977c85803e0b4b7d1e000018648c7cad10dc7`) for rollback, or a fresh disposable root with the selected code. Never downgrade an evolved real database in place or edit the selected commit/instruction metadata to bypass a refusal. No real user root was operated on.

Publication uses an expected-head non-force update of the existing branch; readback must compare every changed remote blob and the final head/tree before the result is returned. Exact publication and both-platform check results are recorded in the PR return so they do not require a self-referential evidence commit.

## Coordinator disposition

Repair candidate only. Independently reproduce F1/F2 at the exact returned commit/tree, inspect refusal preservation and service reuse, and retain PR22 as draft/unmerged until independent disposition. This report does not mark either task complete.
