# Combined offline foundation

The default `/` entry serves the image-first `/visual` workspace. Its **Legacy
semantic workspace** link deliberately opens `/legacy`; the legacy shell has a
**Return to visual exploration** link. Semantic API and static asset URLs remain
stable. Legacy browser harnesses now open `/legacy`, including the CLI readiness
HTTP check; assertions are retained. The two work surfaces keep their existing
contracts and acceptance boundaries. Raster IDs are never semantic page focus.

This foundation composes exact visual/Library source `d11fa566a9c798aa6b2706ad542a30a5a1905abb`
with the semantic/session delta from common source
`8d61b09d21089f64f496c24da4fc671797c81407` to
`c6edf5218a1d98870b87a8029270e233c012468d`. It uses an ordinary single-parent
commit on the visual source. The source branches and main are unchanged.
[The machine-readable resolution manifest](evidence/combined-source-resolution.json)
records every source-changed file, original blobs/modes, the six overlaps and
retained test-file inventories.

## Initialization and shutdown

One Workspace owns the kernel and legacy asset stores. Visual exploration,
execution, memory and Library share it with Pages and the private ChatStore.
Production executors retain their explicit permission/configuration boundaries.
Startup and navigation do not send a turn or connect raster execution.

Shutdown is idempotent: stop admission, drain accepted HTTP handlers and provider
work, drain raster execution, stop chat and its persistence, then close Workspace
stores. Existing HTTP-drain, execution interruption and private-storage tests
remain unchanged. Both complete upstream suites remain in the combined source.

## Disposable compatibility rehearsal

`npm run test:combined:compatibility` extracts both exact upstream versions,
seeds separate disposable roots through their ordinary APIs, closes them and
makes two complete copies per root. One is an untouched matching-code rollback
control. The combined candidate opens the other and verifies original serialized
SQLite records and non-database file hashes, accepted semantic exports, exact
raster exports, memory downloads, completed chat history and receipts as applicable.
It then adds a new page and note and cold-reopens them while checking original
packet bytes again. The evidence includes before/after table inventories and file
SHA-256 values; SQLite container hashes are recorded but logical record equality
is the invariant. Transient WAL/SHM files are excluded. No in-place real-root
migration or downgrade is performed.

A V05 root opens with empty chat history; an R8 root opens with no raster work
units or Library items and disconnected raster execution. Missing lineage records
are not invented. The memory inventory retains truthful unsupported/unavailable
reporting for records outside its existing scope.

## Focused checks

- `npm run test:combined:memory`: original forged-omission control rejects with
  no partial persistence; missing latest/historical sole-note versions remain
  discoverable after cold reopen; historical capsule download bytes remain
  unchanged, ordinary revision reports `changed`, and loss reports `incomplete`.
- `node --test tests/own-slot.test.ts tests/project-memory-repairs.test.ts`:
  inherited-name negatives, declared-own-slot positives, atomic HTTP/tool rejection,
  historical intake, completeness/closure and staleness regressions.
- `npm run test:browser:combined`: root opens visual with chat closed; preparation,
  Library and memory need no account setup; deliberate legacy/return navigation,
  original acceptance/export/state and restart survive. Navigation sends no chat,
  grant or execution action. Desktop/narrow screenshots and requests are recorded.

CI retains fourteen browser commands, both smokes, fixture byte equality, parser
comparison and the pinned synthetic loopback permission/catalogue controls.
It additionally runs the three focused combined checks. Pull request checkout uses
its exact head SHA, rather than the synthetic merge ref. Artifacts contain only
synthetic technical evidence and hash inventories.

Build as HTML, visual auxiliary chat and raster-to-semantic adapters are absent.
No actual account/model/image/GPU trial or designer usefulness claim follows from
these offline checks. Final review-layout/default-count choices remain unresolved.
Rollback discards the candidate or restores matching code with a complete closed
disposable-root copy. Never downgrade an evolved real root in place.
