# V07 R1 acceptance boundary repair

Task `TODO-BVE-20261013-022` continues the existing draft PR17 and
`codex/bve-vnext-v07-offline-reconstruction`, targeting
`codex/bve-vnext-v06-combined-foundation`. Repair parent:
`d2a99c4dfcb223709050d888eb1297fb22704318`, tree
`c76ab2729dc2a1c22c4f8697f599ebb9307b8a38`.
Independent review and canonical task disposition remain with the Work reviewer.
Exact published repair head/tree and final CI links are in the PR/review return.

## Correction and original-probe reproduction

`KernelStore.accept` previously protected only the primary reconstruction slot.
A legacy page primary with a reconstruction mirror and empty companion records
could persist two acceptance selections/events without request/result/review
authority. Passing original V07 tests did not cover this arrangement.

The repair adds one guard: companions are permitted only for a reconstruction
primary. The existing reconstruction-primary checks continue to require a
matching `page:<same-proposal-id>` mirror and a new single-use bound review.
Their current operation/source/base/result/signature checks, both CAS expectations,
review gate and transaction remain unchanged. Service/UI, storage schema,
semantic grammar, context rules and export authority are unchanged. Historical
acceptance records are not migrated or rewritten.

| Exact disposable-root probe | Before, pinned parent | After, repaired store |
|---|---|---|
| Direct reconstruction primary without review | Rejected | Rejected |
| Page primary / reconstruction mirror / `records: []` | Accepted | Rejected before writes |
| Reconstruction review records | 0 | 0 |
| Primary and mirrored selection | Both semantic page references | Both null |
| Raw packets, selections and events after rejected call | Bypass changed selections/events | Byte-equivalent to before call |
| Cold reopen | Unreviewed acceptance persisted | No unreviewed acceptance; all raw rows unchanged |

[Before probe](evidence/reconstruction-r1/before-probe.json) and
[after probe](evidence/reconstruction-r1/after-probe.json) record actual references,
rejection, canonical table hashes and identical probe-source SHA-256. Both local
captures precede publication, so their `softwareHead` is the repair parent;
`kernelStoreBlob` binds each capture to the actual unchanged/repaired source.
The final-head full unit suite runs the same rejection/cold-reopen assertion.

Reproduction script: [reconstruction-acceptance-probe.ts](../scripts/reconstruction-acceptance-probe.ts).
On the pinned parent, copy the unchanged probe script and run
`node scripts/reconstruction-acceptance-probe.ts --expect=accepted`.
On the repair, run `node scripts/reconstruction-acceptance-probe.ts`.
Set `BVE_EVIDENCE_DIR` to collect JSON. Each invocation creates and removes only
its own disposable synthetic root. No credentials, transport or generation are used.

## Regression evidence

Five new tests append to the existing reconstruction suite. No existing assertion
is removed or relaxed. A raw read-only SQLite snapshot includes every stored
packet version, serialized selection and ledger event across projects; snapshots
must remain exactly equal on rejection and after cold reopen.

- Exact reversed call plus unrelated primary namespaces reject without writes.
- Unsupported mirror slots, empty/existing reviews and wrong proposal/project/unit
  reject. No reconstruction destination is an unchecked secondary write.
- Stale primary CAS, stale mirror CAS and invalid review all roll back. An injected
  review-storage failure observes both tentative selections before throwing;
  neither selection nor either acceptance event nor review survives the rollback.
- Valid current paired acceptance creates both selections and exactly one new
  bound review, with two acceptance events and one revision event. It survives
  reopen and exports byte-exact with the source record unavailable in a separate
  closed copy.
- Ordinary legacy page and Website acceptance without companions succeed,
  preserve their export behavior and survive reopen.

Existing tests still prove superseded/historical-result rejection, stored-review
reuse rejection, current source/context/signature binding, atomic intake, memory
omission/loss and independent source/Brand-free export.

[Local verification](evidence/reconstruction-r1/local-results.json) and
[repair source manifest](evidence/reconstruction-r1/source-manifest.json) record
checks and exact changed blobs. The manifest verifies all 27 upstream test files,
unchanged original reconstruction-test prefix, unchanged semantic grammar,
lockfile and CI workflow. Typecheck/build, full unit suite, both compatibility
rehearsals, original memory controls and reviewed-parser parity pass locally.
The reconstruction browser check also passes; the persistence repair changes no UI.
CI retains all 16 browser commands and pinned synthetic-loopback protocol/permission
gates on exact-head Linux/Windows. Final platform results and artifact digests are
reported in PR17 after completion; this document does not infer them from local tests.

## Limits and rollback

This closes the identified internal direct-writer destination bypass. It is not
exhaustive proof of every invariant or a claim of a browser/network exploit.
Authored fixtures test workflow and storage, not reconstruction fidelity.
No account/model/image-provider/GPU trial, protected-root access, production
transport, V08, local generation, merge or deployment. Independent acceptance
remains pending; local generation stays at cycle end.

Rollback is this isolated repair commit or matching code plus a complete closed
synthetic-root copy. Never downgrade an evolved real root or selectively delete
canonical acceptance/history. The published branch is advanced ordinarily with
an expected-head check; PR17's dependent target is preserved.
