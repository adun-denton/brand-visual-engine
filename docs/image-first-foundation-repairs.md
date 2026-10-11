# V01 R1–R2 implementation return

This bounded repair updates draft PR11 for TODO-BVE-20261011-016. Independent
acceptance and canonical completion remain with the originating Work reviewer.

Original planning pin: `1b2b7b9c1acd7a836b615b23db9baa852dcd7fa5`.
Repair authority pin: `3c333166077024c09aa670df9829d23be4a75550`.
Accepted software base: `8d61b09d21089f64f496c24da4fc671797c81407`.
Reviewed repair parent: `dcf23fc954ab2597e15f83c7ff3173d3ddaf4ef1`,
tree `6183e5d54c290e254c909b1ce09ff5ce4dcc53c3`.
Branch: `codex/bve-vnext-v01-image-foundation`.
PR: https://github.com/adun-denton/brand-visual-engine/pull/11.
The returned PR body records the exact new commit/tree and platform CI.
Remote PR head/base matched these pins before repairs; the isolated checkout was clean.

## Changes and persistence rationale

| File | Repair |
|---|---|
| `src/service/exploration.ts` | Only missing/undecodable submission bytes become invalid output. Packet construction and asset persistence are outside that catch; storage/integrity errors propagate before any packet/event transaction. |
| `src/kernel/exploration-gate.ts` | Compare previous and incoming semantic kinds before early return. Every revision involving a V01 kind preserves that kind, including transitions into or out of legacy kinds. Existing same-kind rules still enforce immutable specifications, memberships and receipts. Legacy-only kind behavior is unchanged. |
| `tests/exploration.test.ts` | Add corruption/explicit-repair/idempotency and cross-kind boundary controls. Exercise storage Error and InputError by exact identity; add same-kind metric revision/restart checks. |
| `docs/image-first-foundation-repairs.md` | Sanitized evidence and handoff. |

No database/schema/contract migration, parallel store, historical rewrite, asset
replacement policy or automatic retry was introduced. Damaged bytes remain damaged
until explicit disposable-fixture restoration. Runtime repair is outside this packet.

## Verification matrix

Local Linux x86_64, Node 24.19.0, npm 11.9.0. All post-repair commands below passed.
Private original probes were temporarily run, then removed from the public checkout;
their source is not committed. Both reproduced at the reviewed parent (0 pass / 2 fail).

| Requirement / actual command | Observation |
|---|---|
| Original probes: `node --test tests/reviewer-probes.test.ts` | After repair 2 pass / 0 fail. Corruption rejects checksum error; spec-to-selection revision rejects. |
| R1 public corruption control | Packets, events and pending slot unchanged; damaged file untouched. Explicit restoration of synthetic bytes allows unchanged envelope once; duplicate adds no events. |
| R1 injected storage controls | Both Error and InputError propagate as the same error object; no packet/event mutation. |
| R2 public lineage controls | Spec-to-selection, spec-to-valid same-envelope legacy page-migration, and legacy-to-selection reject with no packet/event writes. Valid legacy fixture bytes compare equal after reopen. |
| Same-kind / historical controls | Raster, selection, metric and batch revisions remain valid; pinned historical records revalidate on reopen. Immutable specification controls remain. |
| Recovery / compatibility controls | Invalid middle image retains successful neighbors; cancellation/uncertain evidence, concurrent idempotency, last-packet transaction rollback, full legacy export/pointer/hash and closed-root byte compatibility pass. |
| `npm ci --ignore-scripts` | Locked install; manifest/lockfile unchanged. |
| `npm run typecheck` | Pass; temporary private probe removed before TypeScript check. |
| `npm test` | 181 pass / 0 fail / 0 skipped, including 16 exploration tests. |
| `npm run build` | Browser build complete. |
| `npm run smoke` | Fixture-only; outside channels 0; accepted state survives reopen; original parent matches. |
| `npm run smoke:design-os` | Both modes and nine candidates/mode pass. |
| `node scripts/serialize-design-fixtures.ts` then `git diff --exit-code -- fixtures/design-os.json` | Existing fixture bytes unchanged. |
| `git diff --check` | Pass. |

The inherited npm http-proxy warning is unrelated to these changes. Public regression
assertions are synthetic; they do not establish real provider execution or visual quality.
Windows/Linux results must be read at the exact returned head, not inherited from prior CI.

## Limits, rollback and exact-head verification

Product decisions remain unchanged: no assumed default attempt count or workspace layout;
provider execution, exact-preservation execution, UI and HTML reconstruction remain later work.
PR10/R7 is untouched. No production UI, model/account/image call, GPU, provider install,
paid fallback, user-runtime migration, merge, deployment or additional agent was used.

To roll back code, revert the repair commit on a new branch or use the reviewed parent
in a separate checkout. Close owned processes before backing up/restoring a complete root;
use matching code and a complete closed pre-V01 root for a pre-V01 runtime rollback.
Never downgrade an evolved store in place or delete selected rows/media. Keep evolved roots separate.

If platform CI is blocked, clone into a new isolated directory, check out the exact
returned SHA, verify `git rev-parse HEAD HEAD^{tree}`, then run the install, typecheck,
test, build, both smoke and fixture commands above. Use synthetic roots only. Expected:
181 passed, no skipped tests, unchanged fixture bytes and the recovery observations above.
Report exact source identity, platform and exit codes to the originating Work reviewer.
Verification grants no acceptance, repair, merge, deployment or subsequent-packet authority.
