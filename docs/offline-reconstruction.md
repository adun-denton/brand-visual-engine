# Offline reconstruction

Build as HTML now opens an optional preparation sheet in both visual layouts.
It binds the whole raster, its exact page/project association, source image
and rights. Region selection never changes that input. Count and preview
viewports must be chosen explicitly; Brand starts off. Closing the sheet
creates no operation. Missing or corrupt bytes prevent freezing a request.

Preparation saves pending slots. Production execution is unavailable. The only
execution/intake adapter in this slice is a constructor-injected, test-only
`authored-test-fixture` driver. Its outputs declare `generation: false` and
are reviewed as synthetic workflow evidence. There is no browser switch,
environment fallback, OCR, image generation, transport or automatic retry.
A fixture receives the exact frozen source bytes, but does not reconstruct them.

## Schemas and lifecycle

[Strict work-record contracts and parsers](../src/modules/website/reconstruction-contracts.ts)
define the four additive kinds. Each uses the existing KernelStore, canonical
integrity hash and revision ledger; none is a raster ExecutionRequest, Grant or
Receipt. [Preparation](evidence/reconstruction/preparation.schema.json) and
[submission](evidence/reconstruction/submission.schema.json) exchange schemas
use JSON Schema 2020-12. The submission shares the existing semantic candidate
schema and definitions. Runtime relation checks add ownership, byte facts,
head state, locks, exact slot/count and transactional constraints.

| Kind | Frozen state | Lifecycle |
|---|---|---|
| `reconstruction-request` | Project/page, exact source and media/rights, instruction, count/slots, viewports, approved Brand or off, optional base tree/signature/locks, explicitly included resources/evidence, compiled context, grammar, prior control/epoch, expected heads, limits | Immutable v1; a new freeze gets a new identity |
| `reconstruction-control` | Page, exact current request/hash, status, exact result or null, reason | Versioned page control; pending becomes returned or cancelled; a new request advances epoch |
| `reconstruction-result` | Request/hash, response hash and receipt ID, current/historical outcome, ordered proposal references/signatures, findings and exact fixture response | One immutable result per request; identical receipt replay is idempotent; conflicting reuse fails |
| `reconstruction-review` | Page/request/result/proposal, exact reviewed signature and explicit reason | Immutable evidence written atomically with both semantic acceptance selections |

A source/base/Brand/project head change, cancellation or newer operation makes a
valid late result historical. It cannot update current control, acceptance or
the displayed result. Historical results have a deliberate exact-result selector.
Reuse requires a new explicit operation. Ledger-known lost controls block rather
than fall back or reuse a canonical version. Shutdown aborts an owned fixture
before HTTP drain; an abort-ignoring late delivery is never stored after close.

## Explicit context mapping

| Input | Frozen request | Semantic output render context |
|---|---|---|
| Whole raster | Exact candidate, integrity, membership, media descriptor, decoded image and rights | Reference input only; never an automatic placed background |
| Brand off | `{ enabled: false }` | No project defaults, old base context or unrelated history |
| Approved Brand on | Exact accepted Brand reference/integrity and approved values | Canonical text in `commitments`, within the unchanged Page context vocabulary |
| Deliberate semantic base | Exact page reference/signature, tree and preservation locks | Tree/locks are explicit; previous context and rationale are excluded |
| Additional media | Exact owned handles, labels, rights, role and state | Only explicitly placeable handles actually used enter the media closure |
| Human handoff notes | Explicit exact note reference/integrity and text | Labeled disclosures in `unresolved`; no automatic memory inclusion |
| Instructions and viewport/count | Explicit bounded values and pending slot identities | Operation inputs; no Tune knobs or hidden stylistic defaults |

Brand off does not remove source-visible styling. Chat, capsules, old notes and
other project history are absent unless a supported human note is deliberately
included. Only accepted Brand values enter the context. Resource-only references
cannot be placed. Existing base media must be deliberately supplied as placeable.
A fresh freeze is the boundary for future session transport; this slice does not
create or reuse model threads.

## Transaction and artifact authority

The [shared candidate parser](../src/modules/website/semantic-candidates.ts) is
extracted from legacy Pages intake. Existing own-slot checks, semantic relation
checks, preservation, renderer and export remain authoritative. Legacy public
request/result shapes and context preparation are retained; no unrestricted
HTTP context override is added.

Preparation writes request and control in one guarded transaction. Intake checks
all candidates and bindings before persistence, then writes semantic proposals,
result and returned control in one `putMany` transaction. The final persistence
gate repeats source byte facts and validates the actual stored proposals against
the frozen response. A malformed second candidate, final-gate race or direct
forgery rolls back every proposal, event and receipt. Historical intake writes
proposals/result only. Accepted receipt immutability persists across restarts;
fixture call de-duplication is process-local because production transport and
call-budget durability are outside this slice.

Explicit acceptance checks request/result/source/base/current-control expectations,
proposal signature and compare-and-swap acceptance. The same transaction writes
`reconstruction:<page-id>`, the existing `page:<proposal-id>` export-authority
selection and exact review evidence. Review failure rolls back both selections
and their events. Raster and Website acceptance are unaffected. Direct kernel
acceptance into the reconstruction namespace requires its bound review/mirror.
Legacy semantic acceptance keeps its existing behavior.

Each semantic output has its own tree, frozen render context and exact media-only
closure. Its dependencies contain no raster design, reconstruction work record or
mutable Brand. Lineage stays in work records. Standalone export uses the unchanged
accepted semantic exporter; it still works when raster/Brand records are missing.
HTML is derived from the tree, with no editable-HTML second authority. Preview
uses the existing renderer in a script-free iframe with explicit viewport dimensions.

## Persistence, memory and rollback

No schema migration or destructive rewrite is introduced. The four new kinds
participate in deterministic complete project-memory summaries and exact retrieval,
including ledger-known missing versions. Coherent omission is rejected by the
existing capsule completeness gate. Old capsule download bytes remain immutable;
new snapshots report primary loss as incomplete. Existing snapshot status semantics
are retained.

The [compatibility rehearsal](../scripts/reconstruction-compatibility-check.ts)
seeds an exact accepted-V06 synthetic root, closes it, and makes separate complete
copies for compatibility opening, additive writes/cold reopen, and untouched matching
rollback control. Original serialized rows, history, media, semantic/raster exports,
chat turns/tool receipts and capsule bytes are compared. Physical database hashes
are recorded but logical rows and non-database bytes are the preservation invariant.

Rollback discards this isolated branch or restores matching code plus a complete
closed synthetic-root copy. Never downgrade an evolved real root or selectively
delete canonical history. Independent technical and consequential visual acceptance
belongs to the reviewer/operator.
