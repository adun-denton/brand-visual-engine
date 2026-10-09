# Candidate readiness evidence

This matrix describes evidence and limits, not a task queue or a release decision. The coordinator
reviews an exact candidate; the operator supplies designer, license and release decisions. Phase A
is synthetic preparation. [Operator guide](operator-guide.md) · [blank trial](designer-trial-template.md).

## Evidence matrix

| Area | Reproducible current evidence | Boundary / remaining evidence |
|---|---|---|
| Windows/Linux setup | Node24.19.0 locked install/build/typecheck in [CI](../.github/workflows/verify.yml); `readiness-browser-check.json` CLI startup/read-only check and actual platform/version | Local/manual console behavior is distinct from test IPC closure; no installer/hosting claim |
| Brief/reference/decisions | `scripts/readiness-browser-check.ts`: fresh UI creation, permitted authored reference, comparison reason identifying rejected alternative, separate selection/acceptance | Deterministic directions and AI technical reasons; actual designer judgments blank |
| Native import/replacement | Same rehearsal exports requests/imports authored originals and replaces hero with preserved other sections/history | 0 host calls in rehearsal; separately recorded prior real native round trip has unknown model/settings/billing; does not establish direct API |
| Regional source/raw/composite | Rehearsal + [regional check](../scripts/region-browser-check.ts): pinned mask, original bundle bytes, raw/composite distinction and outside RGB/alpha preservation | Hard edges/seams need human review; no automatic alignment or general provider mask guarantee |
| Composition/export | Rehearsal + [composition checks](../tests/compositions.test.ts) + four-width/source focused repair observations in composition workflow | Pinned accepted values/assets and safe paths; no publication, hidden data or automatic newer-asset substitution |
| Closed-root backup/restore | Rehearsal copies full closed root, hashes every file, starts copy, verifies visible decisions and original/export bytes | Matching code/new destination; online backup/power loss/Windows directory fsync not proven |
| Restart/interruption | [provider tests](../tests/providers.test.ts): process interruption retains uncertain attempt/reservation without transport; provider browser IPC receipts prove closure before copy | Abrupt host/power failure is not equivalent to graceful close; unknown attempt blocks further submissions |
| Stale/late/cancelled/unknown | Provider tests for stale brief, cancelled late result, changed acceptance, unknown outcome and reconciliation; retained provider browser receipts | No automatic retries, call resets, acceptance changes or inferred remote cancel/no charge |
| Access and files | [workspace tests](../tests/workspace.test.ts), provider/composition HTTP tests: Host/Origin/token, owner/type/scope, safe text/links, full decode, checksum/corruption rejection | Single trusted local operator; no production/multi-user auth or OS decoder sandbox |
| Provider errors/spend | Provider tests and [provider browser check](../scripts/provider-browser-check.ts): refusal, rate limit, malformed response, timeout and failed persistence; 4 injected calls /0 real | Fixtures do not prove account availability, live model quality, usage/billing or a strict dollar ceiling |
| Desktop/narrow critical actions | Rehearsal at1440/390 plus retained four browser workflows: visible saved controls, original image decoding, keyboard skip/navigation/action focus, hierarchy/order/overflow | Technical Chromium/recorded reviewer checks; no universal browser/design equivalence |
| Developer handoff | Accepted S4 renderer/instructions/assets and separately checked reconstruction remain valid at base `418cc8d`; rehearsal verifies deliberate new export | Designer usefulness and actual website development remain Phase B evidence |
| Repository license | No repository license selected/added by Phase A; dependency notices discussed in [workspace](workspace.md#dependencies-and-evidence) | Owner license choice and redistribution disposition pending; not a released candidate |

Accepted S4 base evidence: [exact-head push CI](https://github.com/adun-denton/brand-visual-engine/actions/runs/37926986501)
at `418cc8d56c7455463d5e17b6e753a2e63aa258fa`: 138 tests, four browser workflows on Ubuntu24.04/Windows2025,
Node24.19.0/Chromium145.0.7632.6. Composition fixtures0, provider4, regional1 injected calls; all0 real.
Independent acceptance and prior host evidence are held by the coordinator, not shipped private records.
New candidate CI and filled readiness/rehearsal receipts must be returned at their exact result; source
tests or this matrix alone are not execution evidence.

## Required candidate receipt (fill privately)

Record base/result/tree/PR, changed files, actual install/start platform versions and errors, commands
run/reused/unrun with reasons, guide actions, fixture/seed descriptions, visible decisions/screenshots,
actual provider/host call counts, original/export/closed-backup hashes, review distinctions and limits.
Keep human rubric and owner decisions blank. Record exact-head Windows/Linux CI logs and artifact
receipts when executable checks change. Check links and read back published source.

## Before Phase B / release disposition

The operator still selects the actual designer, real website brief and permitted references, supplies
the real trial observations/rubric, chooses a repository license and decides release disposition after
independent review. Deferred task-003 live API verification keeps its existing separately approved run
and remaining bound; it is not moved into this task or reset by preparation. Credential source/account
availability and actual native/API evidence must be resolved before release. Optional ComfyUI is not
a blocker. Merge, release tag, deployment, account actions and third-party messages require their own
authorization and are not effects of export or rehearsal.

## Matching-code rollback

Leave the dependent draft unmerged, or scope-revert only its software changes to `418cc8d`. Preserve
complete runtime roots, originals, versions, ledger and provider reservations. Keep a gracefully closed
full-root backup with its exact code pin. Restore/test only a new copy; never delete history or open
additive records with incompatible older code. A documentation revert does not roll back runtime state.
