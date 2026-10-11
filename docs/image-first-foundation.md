# Image-first persistence foundation

This is an offline contract and record controller. It has no production UI, HTTP surface,
provider, scheduler, execution permission or generated-design capability. All attempt registration
in this implementation is explicitly synthetic. A count of candidates does not authorize calls.
Direction, brand and count are required inputs; no default count or workspace layout is encoded.

## Records and ownership

All records use existing `kernel.sqlite` packets and revision events. Storage schema remains 1;
there is no migration, auxiliary canonical table, rewritten legacy packet or acceptance change.

| Kind | Role | Ownership / closure |
|---|---|---|
| `page-work-unit` | work record | Independent page identity, type, label and explicit source; no route or brand prerequisite |
| `raster-concept` | design artifact | Entire Level1 realized state is exact raster pixels. Only its owned `page-media` dependency and bytes are rendering inputs |
| `raster-membership` | work record | Page membership and cross-candidate derivation; these do not become rendering dependencies |
| `raster-selections` | work record | Versioned whole, rectangle, ellipse or binary mask anchors; notes live on an exact source entry |
| `raster-specification` | work record | Immutable project/work-unit, source/notes snapshot, intent, rights, constraints, requested metrics, influence and count |
| `raster-batch` | work record | Ordered 1–6 attempt slots, frozen specification integrity, optional manual retry lineage |
| `raster-receipt` | work record | Immutable submission hash, original batch revision/slot, outcome, exact result/evidence and unknown usage |
| `raster-metrics` | work record | Level2 metadata pins candidate version/integrity; requested, inferred and observed remain separate |

The Website validator and kernel role/dependency/ownership gates register these together. Stored
reads revalidate their own predecessor and exact closure, rather than reinterpreting historical
records against a newer version. Existing Website/page/region validators and v1 intake remain intact.

Raster revisions bind new exact media versions; old anchors, notes and specs retain the original
image/version. Cross-identity derivation and page membership stay outside the raster. PNG/JPEG/WebP
use existing 8 MiB / 8192px / 16 MP storage bounds. Whole selections preserve those bounds; all region
forms retain the 4 MP limit. Geometry uses normalized original encoded pixels, with explicitly fixed
`encoded-top-left` orientation. It is **not** EXIF-rotated or display-relative geometry. A future UI
must apply a deliberate transform when it rotates an image; resizing alone never rewrites anchors.
The kernel media adapter checks checksum, format/length and encoded header geometry. Service
registration and standalone reconstruction also require full decoding. This synchronous gate relies
on the injected trusted media adapter, just as asset existence relies on its existing byte adapter.

`reconstructRaster(candidate, media, bytes)` validates and returns the exact original image closure
without a project, ledger, source design or brand. It does not reconstruct HTML. Imported and
semantic-screenshot origins are explicit; `generated` origin is unavailable pending a future
execution/provenance contract. Synthetic attempts always produce `synthetic` origin.

## Intent and frozen influence

- Inspiration is optional reference intent. Include records incorporation intent, without claiming
  incorporation occurred. Exact requires a comparison target and a supported predicate.
- V01 supports whole-image retained-byte predicates and explicit binary-mask outside-pixel predicates.
  These are recorded requirements, not an executed compositor or a claim that returned pixels meet
  them. Pixel-to-layout guarantees are unavailable. Differing explicit locks on the same target and
  incompatible required values (including nested paths) raise `ExplorationConflict` before freezing.
- Direction is `fresh` or `follow`, independently of brand enabled/disabled. Fresh requires explicit
  exclusion of optional source style. Required facts, rights, inclusion and exact locks remain.
  Brand-off never erases source pixels. Prompt/context isolation is a later executor responsibility.
- Brand-on pins an accepted shared VisualOS version, integrity and its approved effective values.
  Unapproved values are excluded; disabled brand contains no hidden source or inherited values.
  Later brand revisions do not change a frozen specification or the candidate's render closure.
- Level1 font/spacing requests can be constraints in an unexecuted specification; they are not
  realized raster properties. Level2 values retain declared scales/units/categories and provenance;
  no 0–100 to 1–10 conversion occurs. Observed metrics are limited to mechanically verified encoded
  image width/height in pixels. Other visual/dynamic observations are unavailable in V01.
- A new operation creates a new specification identity. There is no chat/project dump field or
  automatic history inclusion; intent and provenance are bounded explicit inputs. Unknown envelope
  fields, execution grants and inferred usage/measurement claims are rejected.

## Attempts, recovery and receipts

`Exploration` is a service controller over an existing `Workspace`. Tests demonstrate page creation,
registration, selections, freeze, prepare, cancellation, recovery and explicit retry. These methods
have no provider plumbing. `markRunning` marks only a synthetic harness slot, not an actual call.

Each synthetic envelope must identify the current exact batch revision, original spec integrity,
slot, receipt identity and declared outcome. Envelope/ownership/derivation failures reject before
candidate salvage. Full-decode failures become an honest invalid receipt for that slot; successful
neighbors remain intact. Candidate/media/membership, receipt and batch revision are written in one
kernel transaction. Existing asset behavior can leave verified unreferenced bytes after a transaction
failure; retry safely reuses these bytes. No artifact, outcome or acceptance survives a failed group.

Receipt packet identity deterministically binds the receipt ID. Identical duplicate submissions,
including concurrent decodes, return the same stored receipt without new events. Changed content
under that identity conflicts. A consumed slot cannot reset. Receipt identity is global to the store,
so reuse by another project conflicts rather than exposing its result.

Opening a store never schedules/replays or implicitly migrates records. Explicit
`recoverSyntheticRunning` marks running synthetic slots uncertain and is idempotent. Cancellation
marks pending slots cancelled and running slots uncertain; terminal results remain unchanged.
Late valid bytes can be retained as reference-only media evidence under an uncertain receipt,
without becoming a successful candidate. Invalid late bytes retain the submission hash only.
A manual retry prepares a **new** batch with a consumed original batch/slot reference. It uses the
new frozen spec's explicit count; it does not reset the parent or imply any execution permission.
All usage and execution authorization remain null. Nothing selects, accepts or exports a new result.

## Offline checks and recovery

Use Node >=24.19.0 <25 in a fresh checkout and synthetic temporary roots only:

```sh
npm ci
node --test tests/exploration.test.ts
npm run typecheck
npm test
npm run build
npm run smoke
npm run smoke:design-os
git diff --check
```

The exploration tests cover foreign/corrupt media, format/geometry/mask integrity, source revisions,
standalone closure, count/influence/lock conflicts, valid/invalid/valid retention, duplicate/stale
receipts, concurrent duplicate registration, transaction failure/retry, uncertain cancellation,
explicit restart recovery, manual lineage, metadata truth and later brand revisions. Existing page
regressions retain v1 all-candidate rejection. Closed-root probes compare old accepted page packets,
media, pointers and complete export bytes, plus an existing legacy SQLite/RGB runtime and matching-code
restore. The old legacy writer initializes SQLite metadata on opening; its semantic handoff check
runs in a separate disposable copy, outside the byte-identity comparison.

Rollback code by closing owned processes and returning to the prior accepted commit in a separate
checkout (or reverting the implementation commit). Runtime rollback requires a **complete closed-root
backup from before these new kinds**, with matching old code. Never run old code against an evolved
root in place, copy open SQLite files, or remove only the new packet kinds. Restore entire kernel,
legacy database and asset directories together. Preserve the evolved root for later reviewed recovery.

Cross-platform results are distinct evidence. The repository's existing Windows/Linux verification
workflow runs these tests on exact candidate heads. If that evidence is absent, run the above commands
in an isolated Windows checkout of the exact returned commit and tree and return the result to the
originating reviewer. No account/model/image/GPU call or user-runtime migration is required.
