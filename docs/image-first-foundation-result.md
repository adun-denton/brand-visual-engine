# Image-first foundation implementation evidence

Bounded offline implementation return for `TODO-BVE-20261011-016` / V01. Independent acceptance,
canonical status and subsequent authorization belong to the originating reviewer. This is not a
completion, release, image-generation or designer-usefulness claim.

Authority pin: `1b2b7b9c1acd7a836b615b23db9baa852dcd7fa5`.
Software base: `8d61b09d21089f64f496c24da4fc671797c81407`, tree
`555464dc428cf3551fbf6ced32a73492f07c6f4d`.
Branch: `codex/bve-vnext-v01-image-foundation`.
Implementing session: Codex, requested Sol role; no other agents.
The PR head supplies the exact result commit/tree; this file cannot embed the hash of its own commit.
At implementation start and before publication, remote main matched the accepted base and the new
remote branch did not exist. A separate checkout preserved all unrelated source/runtime state.

## Changed files and rationale

| File | Change |
|---|---|
| `src/modules/website/exploration-contracts.ts` | Strict typed raster/work grammars, frozen inputs, influence, metrics, exact predicates and conflict detection |
| `src/kernel/exploration-gate.ts` | Exact typed closure, role/owner/currentness/integrity checks, immutable specs/receipts, slot transitions and lineage |
| `src/kernel/gate.ts` | Register new semantic roles and run exploration gate |
| `src/kernel/store.ts` | Add optional typed media-descriptor adapter to existing kernel services; no SQL/table/schema changes |
| `src/modules/website/design.ts` | Register Website exploration validators |
| `src/service/image-descriptor.ts` | Synchronous encoded PNG/JPEG/WebP geometry check for the trusted asset boundary |
| `src/service/workspace.ts` | Supply media adapter and revalidate raster records on existing read boundary |
| `src/service/exploration.ts` | Offline controller and full-decoded standalone raster closure reconstruction |
| `tests/exploration.test.ts` | 14 meaningful adverse/recovery/compatibility tests using synthetic assets only |
| `docs/image-first-foundation.md` | Contract rationale, constraints, service behavior, verification and rollback |
| `docs/image-first-foundation-result.md` | Sanitized implementation evidence |

Storage schema remains 1. New typed kinds use existing immutable packets and revision events.
Candidate pixels are Level1 actual state; Level2 metadata is exact-version work data, while Level3
brand remains an adapter to approved VisualOS. Membership/derivation never becomes a design dependency.
No existing artifact, asset hash, accepted pointer, Website behavior or historical event is rewritten.
No private planning document, account/client data, runtime archive or credential is included.

## Local commands and results

Environment: Linux x86_64, Node 24.19.0, npm 11.9.0. Fresh isolated checkout; temporary synthetic roots.
All commands below exited 0. npm emitted its inherited unknown `http-proxy` configuration warning.

| Command | Observation |
|---|---|
| `npm ci` | Locked install succeeded; package manifest and lockfile unchanged |
| `node --test tests/exploration.test.ts` | 14 passed, 0 failed, 0 skipped |
| `npm run typecheck` | Strict TypeScript check passed |
| `npm test` | 179 passed, 0 failed, 0 skipped; existing page/region/ownership regressions retained |
| `npm run build` | Browser build complete |
| `npm run smoke` | Fixture-only; outside changed channels 0, accepted state survived reopen, original parent matched |
| `npm run smoke:design-os` | Both legacy modes, nine candidates per mode and exact accepted metadata reconstruction passed |
| `node scripts/serialize-design-fixtures.ts` and `git diff --exit-code -- fixtures/design-os.json` | Existing serialized fixture bytes unchanged |
| `git diff --check` | No whitespace errors |

Source evidence is the named tests below and unchanged legacy tests. CI status must be assessed at
exact PR head; this document records local Linux results, not an unobserved Windows result.
Initial CI71 Windows ran all behavior assertions but failed three after-hooks with EPERM because
new reopened synthetic stores outlived temporary-directory deletion. The test helper now tracks and
closes every reopened store before deleting any root. This test-only repair changes no contracts or
production code. Final-head CI results supersede that failed run and must be checked separately.

Local browser workflows were not run: no production UI or HTTP surface was changed. The existing CI
workflow retains its ordinary Windows/Linux regression/browser behavior without modifications.

## Acceptance probe matrix

All rows have local passing evidence. Independent reviewer disposition remains pending.

| Packet row | Actual probe / observations | Evidence |
|---|---|---|
| 1 | Homepage/About have separate memberships/selections/notes; foreign project selection rejects | `two independent page work units...` |
| 2 | Standalone raster reconstruction needs candidate/media/bytes only; PNG/JPEG/WebP exact bytes retained; foreign/corrupt media, fake dimensions/role/dependencies reject | `corrupt/foreign media...`, `supported raster formats...`, `old anchors...` |
| 3 | Whole/rectangle/ellipse/mask selections persist through reopen; resize scales normalized coordinates without mutation; v2 raster never redirects v1 anchors/notes | `two independent...`, `old anchors...`; mask integrity and 4 MP probe |
| 4 | 0/7/fraction/NaN counts reject; 1/6 pass; frozen spec revision rejects; revised notes leave old snapshot/hash unchanged; all four direction/brand combinations validate | `spec immutability...` |
| 5 | Synthetic slots retain succeeded/invalid/succeeded and exactly two independent candidates, no acceptance; wrong envelope adds no events; malformed image writes no candidate | `valid/invalid/valid...`; retained `tests/pages.test.ts` malformed-second-candidate controls |
| 6 | Identical sequential and concurrent receipts collect once with no extra events; changed receipt, stale batch, foreign owner and direct forged receipt identity reject | `valid/invalid/valid...`, `concurrent duplicates...`, `direct forged receipt...` |
| 7 | Pending cancellation and running uncertainty survive restart; opening does not replay; explicit recovery is idempotent; late image is reference-only uncertain evidence; new manual batch links original consumed slot | `cancellation...`, `running restart...`; all usage/authorization null |
| 8 | Requested 65/100 and inferred 20/100 stay distinct; observed width is exactly 8px; unsupported/false observations reject; later approved brand change cannot alter frozen values/pixels | `Level2...`, `whole images retain...` |
| 9 | Pre-V01 semantic page/media packet hashes, pointers and full export bytes compare equal before/after/restart/restore; closed legacy SQLite and RGB bytes compare equal; legacy snapshot/handoff also compare equal in a disposable writer copy | `legacy accepted page...`, `closed v1 legacy SQLite...` |
| 10 | Full 179-test suite, strict check, build, both smokes and fixture-byte compatibility pass locally; platform CI is separate evidence | Command table / existing `verify.yml` |

The transaction recovery control corrupts the **last** packet of an otherwise valid result group,
after preceding candidate/media/receipt insertion, and proves rollback of all packet/event writes.
A separate storage fault propagates without mislabeling the slot invalid. Safe orphan bytes can be
reused on an explicit retry. No new acceptance/select operation is called by the controller.
All owned stores close before backup/copy; complete roots restore with matching code.

## Limitations and unresolved decisions

- Synthetic fixtures prove record semantics, not actual image generation, provider capability,
  preservation execution, visual quality, Windows behavior or product usefulness.
- Exact outside-mask/retained-byte predicates are frozen requirements; execution/comparison,
  cross-candidate compositing, mask brushes, UI and HTML reconstruction are later packets.
- Encoded orientation is explicit; a future UI must map any EXIF/rotation deliberately.
- Only encoded image width/height can be observed Level2 metrics here. Other values retain requested
  or inferred status and declared scales/provenance; no invented visual/dynamic measurement.
- Only approved VisualOS effective values are adapted. A brand compiler/import UI is not implemented.
- No default count/layout is selected. Actual attempt-to-call mapping, execution bounds and capability
  eligibility remain unresolved. Every batch is prepared without execution authorization.
- The synchronous kernel adapter verifies byte checksum/header geometry; registration/reconstruction
  fully decodes. Raw trusted kernel injection is not an external image intake endpoint.
- Asset writes can leave verified orphan bytes after a failed packet transaction, consistent with
  existing asset persistence; no output, receipt, pointer or event is partially committed.
- PR10/R7 is separate and untouched. Later shared-file integration needs its own reviewed combined tree.

Actual model/account/provider/image API/GPU/paid calls: **0**. No provider installation, user-runtime
migration, merge, deployment, account protocol, preflight or dev command occurred.

## Rollback and platform handoff

Close owned processes. Restore prior code in a separate checkout or revert this implementation commit.
Restore a complete **closed pre-V01 root** with matching old code if runtime rollback is required.
Do not downgrade an evolved store in place or remove selected rows/files. Keep evolved data separate.

If exact-head Windows CI has not passed, the local verifier must use a **new isolated directory** and
fresh synthetic roots at the exact returned commit/tree, verify those identities with
`git rev-parse HEAD HEAD^{tree}`, and run the command table plus the 14 exploration probes. No existing
runtime, provider, account, GPU or port is needed. Expected observations are the matrix above, including
unchanged legacy bytes/exports, two successful neighbors and no new acceptance/replay. Return exit
codes, platform and exact source identity to the originating Work reviewer; do not repair, self-accept,
merge, deploy or launch a subsequent packet during verification.
