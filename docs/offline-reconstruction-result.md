# Offline reconstruction implementation evidence

Task `TODO-BVE-20261013-022` adds the bounded offline reconstruction workflow on
`codex/bve-vnext-v07-offline-reconstruction`, directly from accepted V06
`210509a1b2cdd36c2e290f6c7ce3752a1eff79fb` / tree
`f6ce87408cd5f042ea55d759486b222c7f6236a0`. The dependent draft targets
`codex/bve-vnext-v06-combined-foundation`. Independent acceptance is pending.
Exact published head/tree and CI links are supplied in the review return.

Both visual layouts expose an optional whole-raster preparation sheet, frozen
explicit inputs, pending slots, paired desktop/narrow comparison, exact historical
inspection, separate explicit acceptance, revision and independent semantic export.
Production execution reports unavailable. [Implementation contracts, lifecycle,
context mapping and transaction design](offline-reconstruction.md) describe the
new authority boundary. All existing upstream test files and semantic grammar are
preserved; [source manifest](evidence/reconstruction/source-manifest.json) records
unchanged test and grammar blob identities plus every changed path.

| Gate | Observed local result | Evidence |
|---|---|---|
| Locked install, typecheck, build, smokes, fixture equality, whitespace | Pass on Node 24.19.0 | [Local results](evidence/reconstruction/local-results.json) |
| Complete unit suite | 314 total, 313 pass, 1 existing Windows-only skip on Linux | Local results and exact-head CI |
| New reconstruction tests | 18 pass; bindings/context, count1/6, malformed-second rollback, receipts, cancellation/history, final races, review CAS, direct forgeries, loss/omission, export and shutdown | [Test file](../tests/reconstruction.test.ts) |
| Retained browser gates | All 14 upstream commands plus V06 combined pass | [Retained results](evidence/reconstruction/retained-browser-results.json) |
| New browser gate | Both layouts/widths, focus, whole identity, media preview, explicit acceptance/revision/export, stale recovery, held cancel/new operation/late-result isolation, production unavailability | [Browser results](evidence/reconstruction/browser-results.json) |
| Parser parity | 3,067 cases; 777 accepted, 2,290 rejected; zero acceptance or normalized divergences | [Parity](evidence/reconstruction/parser-parity.json) |
| Original memory controls | Pass; omission rollback, historical/latest loss, old download stability, cold reopen | [Controls](evidence/reconstruction/original-memory-controls.json) |
| Pinned binary permission/protocol gates | All six controls and catalogue pass; Codex 0.162.1 with synthetic loopback responses | [Permission](evidence/reconstruction/permission-execution.json), [catalogue](evidence/reconstruction/effective-tools.json) |
| V05/R8 retained compatibility | Pass, original lineage rows/bytes/exports preserved | [Summary](evidence/reconstruction/combined-compatibility-summary.json) |
| Exact V06 compatibility/additive migration | Pass, separate closed copies, unchanged old rows/media/exports/chat/capsules, new writes and cold reopen | [Summary](evidence/reconstruction/migration-summary.json), [inventory](evidence/reconstruction/v06-before-after-inventory.json) |
| Standalone export | Extracted HTML/media open via file URLs; no runtime requests; source/Brand-unavailable copy exports byte-exact | New browser/unit gates |

New evidence is synthetic and authored. Screenshots show interaction, identity and
layout behavior; they do not establish reconstruction fidelity. The deliberately
included placeable raster in the fixture differs from the source and exercises
media authority only. No OCR or automatic extraction is performed.

- [Desktop comparison](evidence/reconstruction/screenshots/compare-film-1440.png)
- [Narrow implementation](evidence/reconstruction/screenshots/compare-implementation-390.png)
- [Narrow original](evidence/reconstruction/screenshots/compare-original-390.png)
- [Standalone semantic export](evidence/reconstruction/screenshots/standalone-semantic-export.png)
- [Cancelled late result isolation](evidence/reconstruction/screenshots/cancelled-late-not-adopted.png)
- [Production unavailable](evidence/reconstruction/screenshots/production-unavailable.png)

Final direct-persistence review also added a single-use review guard: an already
stored review cannot authorize a new kernel acceptance after supersession. Its
rollback probe passes. This repair is an ordinary follow-up commit.

Development failures were repaired and rerun: an ESM initialization cycle was
removed by extracting unchanged validation primitives; fixture responsive/context
shapes were corrected to the unchanged semantic contract; a standalone export check
used the wrong archive entry path; a new loss test initially called a nonexistent
ledger method. No production validator or upstream assertion was relaxed. An early
non-TAP unit log lacked a summary; explicit TAP capture established the complete
results. Local Chromium 153 is a disposable test binary; CI installs the pinned
Playwright browser. Dependencies/lockfile are unchanged.

CI retains exact-head checkout and all original Linux/Windows gates and adds the
new compatibility and browser checks. Uploaded artifacts bind browser, parser,
migration, memory and pinned-loopback evidence to that head. Final platform outcomes
must be read from the exact-head run reported in the review return.

Actual account/model/image-provider/GPU calls and protected runtime-root accesses:
all zero. No production reconstruction transport, V08 visual chat, paid fallback,
merge or deployment. Visual usefulness and actual model reconstruction remain
unverified by design. Local generation remains at cycle end. Existing layout/default
count and cross-project Library choices remain unresolved as before. Canonical task
completion and independent acceptance are left to the originating Work reviewer.

## R1 acceptance boundary repair

Independent review reproduced a durable mirrored-destination bypass at the
original candidate: a legacy page primary could write a reconstruction mirror
with no review. The original passing gates did not cover that arrangement.
[R1 repair evidence](offline-reconstruction-r1-result.md) records the exact
before/after probe, narrow persistence guard, paired/legacy positive controls
and complete rollback regressions. Original evidence above remains a historical
snapshot; independent V07 acceptance remains pending.
