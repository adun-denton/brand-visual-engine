# Combined foundation implementation evidence

The visual and semantic/session sources are combined on the isolated
`codex/bve-vnext-v06-combined-foundation` branch with V05 as its parent.
The dependent draft targets `codex/bve-vnext-v05-raster-library-export`.
No source branch or main is moved. Independent technical acceptance is pending.

Source pins and all six overlaps were recomputed and verified. The
[resolution manifest](evidence/combined-source-resolution.json) includes full
per-file blob/mode provenance and test inventory: V05 has 17 test files, R8 has 21,
11 overlap, and all 27 union files are unchanged. The combined unit inventory has
296 tests: Linux 295 pass and one existing Windows-only private-storage control
skipped. No additional skip or removed assertion is introduced.

[All fourteen retained browser commands and the combined check passed locally](evidence/combined/local-browser-results.json),
using Node 24.19.0 and Chromium 153. Typecheck, production build, both smokes,
fixture reproduction/byte equality and whitespace checks pass. The original
R8 and memory repair test files are unchanged; focused runs pass. The
[reviewed-parser comparison](evidence/combined/reviewed-parser-parity.json)
retains 3,067 cases, 777 accepted / 2,290 rejected, with no normalized-output or
acceptance divergence. The six pinned binary permission controls and catalogue
check pass through the existing isolated-home, synthetic loopback mechanism;
no actual account/model request is involved.

[Compatibility summary](evidence/combined/summary.json),
[V05 before/after inventory](evidence/combined/v05-inventory.json) and
[R8 before/after inventory](evidence/combined/r8-inventory.json) retain serialized
original packet/history/acceptance and chat action/session rows, media and export
hashes. V05 also includes an offline grant/execution receipt and capsule. R8
includes a completed synthetic turn, tool receipts and semantic candidates.
Both roots preserve original export bytes, open with truthful absent-lineage
state, accept additive writes and cold-reopen. Matching closed controls remain
unchanged. No destructive migration is required or claimed.

[Original memory controls](evidence/combined/original-controls.json) demonstrate
zero partial persistence on forged omission, loss discovery for sole-note latest
and historical versions after reopen, unchanged old download bytes, `changed`
after ordinary revision and `incomplete` after primary loss. Retained broader
memory tests cover source closure, acceptance/event/count omissions and owner
isolation. Retained own-slot tests cover inherited-name rejection, legitimate
own-name acceptance, malformed second-candidate atomicity, idempotent receipts,
explicit correction and historical intake continuity.

Local browser evidence initially had two disclosed failures. The old cached
Chromium crashed; a fresh disposable test binary resolved the environment. The
CLI readiness probe fetched `/`; changing its entry URL to `/legacy` and keeping
its existing assertion resolves the intentional route change. All final retained
browser gates pass. No unrelated harness assertions are weakened.

Synthetic cross-surface screenshots:

- [Visual desktop entry](evidence/combined/screenshots/visual-entry-1440.png)
- [Visual narrow entry](evidence/combined/screenshots/visual-entry-390.png)
- [Legacy desktop](evidence/combined/screenshots/legacy-1440.png)
- [Legacy narrow](evidence/combined/screenshots/legacy-390.png)
- [Visual desktop Library](evidence/combined/screenshots/visual-library-1440.png)
- [Visual narrow Library](evidence/combined/screenshots/visual-library-390.png)

CI checks out the exact candidate head on both Linux and Windows. Workflow
artifacts contain all retained browser, combined migration/navigation/memory,
parser and pinned offline binary evidence. Exact head/tree and observed CI run
links are provided in the implementation return; this document does not claim
platform acceptance before those checks finish.

Actual account calls: 0; actual model calls: 0; image-provider calls: 0; GPU calls: 0;
protected runtime-root accesses: 0. Synthetic authored raster fixture rendering
and loopback protocol traffic are offline tests. No reconstruction adapter,
visual chat, actual generation, merge or deployment is introduced. Designer
usefulness and actual image/reconstruction evidence remain outside this slice.
Rollback discards this isolated candidate or restores matching code with a
complete closed disposable-root copy; never downgrade an evolved real root.
