# V08 R1–R2 admission repair

Task `TODO-BVE-20261013-023` retains draft PR18, branch
`codex/bve-vnext-v08-auxiliary-session`, and target
`codex/bve-vnext-v07-offline-reconstruction`. The repair parent is
`022512e57faf969ac3da2f1be42203163cdc2e29`, tree
`a2ce4d546b86a2315cad1cdc392bd166d21f4db2`. Exact published repair head/tree and
platform CI links are returned in PR18. Independent acceptance remains pending.

## Reproductions and rollback evidence

The same public-safe [probe program](../scripts/auxiliary-admission-probes.ts) runs
against a separate exact-parent control checkout and the repaired controller, using
fresh disposable authored roots. Its SHA-256 is identical in both runs.

| Original procedure | Before repair | After repair |
|---|---|---|
| One-turn scope; first turn completes; intact second rejects; delete all first-turn packet versions while retaining ledger; retry same scope/token | Lost-history retry succeeds; driver calls **2**; **3** new packet rows and **3** revision events | Retry rejects; driver calls remain **1**; **0** new packet, ledger or selection rows |
| Prepare at project v1; normally revise canonical project to v2; leave control pending; invoke exact old bridge | Driver calls **1** before tool rejection; failed bridge adds **2** packet rows/events | Driver calls **0**; **0** bridge, semantic/result, review/acceptance or ledger writes |

[Before](evidence/auxiliary-r1r2/before.json) and
[after](evidence/auxiliary-r1r2/after.json) include complete logical-table row counts
and SHA-256 inventories. Rejected after-repair writes are byte-equivalent across
packets, ledger and selections. The existing V07 acceptance probe still rejects its
original reversed-destination bypass with full rollback and cold-reopen equivalence.
Local after evidence records the checkout parent plus the tested working-tree service
blob; the separate CI probe records the exact published repair head/service blob.

## Loss-safe turn admission

Surviving latest rows no longer determine consumed allowance. Admission uses the
existing complete, bounded canonical revision inventory, groups identities/versions,
retrieves their exact evidence and validates auxiliary turn states and immutable
captured bindings. Every related canonical version must remain available and intact,
and the surviving current version must match the ledger-known head. Missing latest
terminal evidence cannot be replaced with an older running outcome. Missing historical
versions also block continuation rather than silently replaying incomplete history.
Each complete turn identity counts once, and permitted history stays in revision
order. Exhausted, unfinished, failed, cancelled, historical and expired scopes retain
their existing rejection behavior.

A wholly lost identity has unknown kind/scope. The controller conservatively rejects
conversation admission in that project rather than inferring contents from an ID,
proposal, note, capsule or unrelated surviving record. This includes an unclassified
missing/corrupt non-turn version. When this same turn identity has an intact immutable
scope binding, loss is isolated to that known scope; another scope can proceed without
including the damaged history. A different project remains independent. Cold reopen
does not reset unknown canonical history even with a new explicit UI session.

The history snapshot and current draft/scope are rechecked inside the existing
KernelStore transaction before creating a turn. After awaited image preparation they
are checked again before driver dispatch. A loss/race discovered after a valid intent
was admitted can retain truthful failed-attempt bookkeeping, but creates no proposal
or driver call. Initial unavailable-state rejection writes nothing. There is no new
database, counter record, schema migration, ledger rewrite or history deletion.

## Fresh reconstruction authority before dispatch

The bridge combines exact request integrity/version and pending-control binding with
the unchanged V07 `reconstructionHeadsCurrent` expectations for project, work unit,
raster source, semantic base and enabled approved Brand. It checks these before
preparation, inside bridge-admission transaction guards, and immediately before the
driver call. Exact image assembly now completes before admission through a pure async
helper, leaving an explicit recheck after both image and schema preparation. Image
roles/order/bytes, schema, scoped catalogue and fresh non-resumed operation identity
remain unchanged.

Cancellation, shutdown and the declared preparation/dispatch deadline are checked at
these boundaries. Pre-existing stale authority or a race during preparation allocates
no bridge attempt. If authority changes just after a valid admission, final dispatch
is denied and only the failed bookkeeping record remains. Canonical attempt identities
are also checked within the transaction, so concurrent admissions cannot allocate two
attempts, and missing attempt evidence cannot reset an admitted identity. No automatic
retry is introduced; an admitted request still requires a new request for another
attempt.

The output/intake path remains V07 authority: an operation valid at dispatch can later
become stale or cancelled, and already validated delayed output is retained historically
with no adoption. Semantic proposals/result/control and bridge evidence still commit
atomically. Explicit Apply, draft conflicts, paired reconstruction acceptance, manual
new-request retry and independent semantic export remain preserved.

## Verification

| Gate | Local result | Evidence |
|---|---|---|
| Locked install, typecheck/build, smokes, fixture equality, whitespace | Pass; Node 24.19.0 | [Results](evidence/auxiliary-r1r2/local-results.json) |
| Full units | **372 total; 371 pass; one retained Windows-only skip on Linux** | [Unit log](evidence/auxiliary-r1r2/unit-tests.txt) |
| New regressions | **29** repair cases; original 24 auxiliary tests retained | [Test file](../tests/auxiliary-admission.test.ts) |
| Source preservation | All **29** parent test files, lockfile, grammar, legacy contracts, web sources and original scripts byte-identical | [Manifest](evidence/auxiliary-r1r2/source-manifest.json) |
| Retained browsers | All **17** commands pass locally; also required on both exact-head CI platforms | [Results](evidence/auxiliary-r1r2/browser-results.json) |
| Compatibility | V05/R8, V06 and accepted-V07 closed-root rehearsals pass | [Gate results](evidence/auxiliary-r1r2/local-results.json), [V07 summary](evidence/auxiliary-r1r2/migration-summary.json) |
| Memory | Original omission/loss/download/cold-reopen controls pass | [Controls](evidence/auxiliary-r1r2/memory-controls.json) |
| Parser | 3,067 cases; 777 accepted, 2,290 rejected; zero divergences | [Parity](evidence/auxiliary-r1r2/parser-parity.json) |
| Original V07 acceptance probe | Rejection/complete rollback/cold reopen pass | [Probe](evidence/auxiliary-r1r2/acceptance-probe.json) |
| Pinned offline gates | Codex 0.162.1; six permission controls and catalogue pass; owned synthetic loopback only | [Permission](evidence/auxiliary-r1r2/permission-execution.json), [catalogue](evidence/auxiliary-r1r2/effective-tools.json) |

The workflow preserves all existing steps and 17 browser commands, adding a standalone
original-admission probe and artifact path. Full Linux/Windows logs, exact checkout
pins and artifact head/digest metadata are read back in the PR return. No UI changes
were made; existing screenshots remain historical synthetic interaction evidence.

Development failures were corrected without relaxing original assertions: a probe
fixture used a nonexistent typed project-title field; a new positive acceptance fixture
needed explicit findings acknowledgment; a first timeout test delayed before the
declared interval rather than across preparation. The corrected test advances its
controlled clock after invocation. One retained permission invocation referenced a
removed scratch binary and failed before execution; the same exact pinned package was
reinstalled in a disposable tools directory, then permission/protocol gates reran.

## Limits and rollback

Unknown or incomplete canonical history is not repaired automatically. Conservative
project-level conversation rejection may require separate explicit recovery; complete
evidence is never replaced with guessed scope/status. Bounds remain the existing 4,096
canonical-version inventory and declared per-scope/operation limits. Real model,
account, image-provider, GPU and designer trials remain unverified; production visual
transport stays unavailable.

No actual account/model/image/GPU calls, protected-root access, local inventory or
generation, merge, deployment or next-stage activation occurred. Rollback uses the
isolated repair code plus matching complete closed synthetic-root copies; never
downgrade evolved real roots or delete canonical history. The Work reviewer owns the
independent repair/acceptance disposition.
