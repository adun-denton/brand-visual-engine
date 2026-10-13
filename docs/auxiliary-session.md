# Optional auxiliary sessions

The visual workspace has an initially closed auxiliary panel in both review layouts.
Opening, navigating, choosing context and inspecting inputs create no conversation
turn, frozen reconstruction, execution grant or driver connection. `/legacy` retains
its semantic chat contract. New visual transport is unavailable in ordinary app
startup. Tests inject an explicitly authored driver; its output is always
`authored-test-fixture`, `generation:false`.

## Focus and explicit context

The strict discriminated contracts live in
[`auxiliary-contracts.ts`](../src/modules/website/auxiliary-contracts.ts).

| Focus | Canonical authority |
|---|---|
| `visual-page` | Exact owned work unit; optional whole raster ref/integrity; optional selection ref/integrity and entry ID, preserving original geometry |
| `semantic-page` | Exact owned work unit/page, integrity and semantic signature; optional exact media placement and bounds |
| `reconstruction` | Exact owned work unit, frozen request ref/integrity and optional bound result ref/integrity |

Raster focus never becomes legacy `ChatFocus.page`. The context compiler validates
owners, kinds, integrity, work-unit membership, region binding and original media
bytes. It never crops a region. Semantic input contains the tree and preservation
locks without the old render context. Operation focus contains explicit request
facts and result findings without inheriting disabled Brand.

Brand defaults off. Only an explicitly selected approved frozen snapshot supplies
separate Brand values. Unrelated notes, legacy chat, prior scope history, old semantic
context and unselected media stay excluded. Reference images are labelled and remain
references. The complete canonical memory inventory authorizes exact supported human
notes or dated capsule pointers; unavailable, historical and corrupt states are
reported without hidden latest substitution. Capsules expose at most 32 dated
ref/kind/status pointers, never embedded summaries or restored Brand. No cross-project
read/search tool is supplied.

## Runtime tools and proposals

[`auxiliary-tool-schema.ts`](../src/service/auxiliary-tool-schema.ts) publishes strict
catalogue schemas. Runtime dispatch independently validates names, action IDs,
arguments, exact evidence authorization and every proposed edit.

| Context | Tools |
|---|---|
| Auxiliary conversation | `read_scope`, `read_evidence`, `propose_edit`, `recommend_prepare` |
| Frozen reconstruction bridge | `read_scope`, `read_evidence`, `submit_reconstruction` |

There is no legacy mutation, selection, acceptance, placement, grant, image-run or
project-wide context tool in either catalogue. Alternate HTTP tool routes and stale
legacy grant identities cannot route a visual scope to the legacy dispatcher.
Unsupported fields reject the whole turn rather than filtering an edit. Tool actions
replay only identical input; conflicting reuse rejects. Returned context/tool data
are cloned so a driver cannot mutate controller authority through a shared object.

Allowed proposal targets are the named next-variation draft (`intent` plus explicitly
requested available Level 1/2 fields) or reconstruction preparation draft
(`instruction`, `count`, `viewports`). Counts stay 1–6; viewports are explicit bounded
arrays. Source/base identity, project/page, Direction, Brand policy, locks, acceptance
and execution are outside this edit contract. Each proposal shows before/after values
and requires Apply or Dismiss. Recommendations cannot prepare or execute an operation.

## Draft revision and persistence

Editable values remain UI session state. The server holds only an ephemeral mirror
for compare-and-swap validation. The token binds session, project, work unit, draft
kind/key, opaque ID, revision and canonical digest. Observing new values requires the
previous token and advances the revision; an old client snapshot cannot reset it.
Navigation and inclusion-policy changes invalidate the active target. Each preparation
instance has its own identity; removed checkboxes are not restored by redraw.

Apply rechecks the active session/target, newest scope, current token, expiry, exact
before values and the latest ledger-known completed-turn evidence. Missing latest
evidence fails closed. Applied actions advance the token once and return only the
named edited values. Duplicate identical action IDs return evidence without restoring
draft values; conflicting reuse rejects. Dismiss writes evidence without editing.
Closing chat cancels its conversational jobs and drops its mirror; reopening creates
a fresh session while the existing UI variation/preparation draft remains intact.
Page unload sends a best-effort close; bounded scope expiry and shutdown remain the
fallback if unload delivery is unavailable.

The existing KernelStore stores five primary kinds: immutable scope, versioned turn,
immutable proposal, immutable action and versioned bridge. All participate in complete
memory inventory and missing-version discovery. Direct persistence requires the
controller's short-lived exact packet/integrity permit in addition to public contract
validation. No new database or destructive schema migration is introduced. Scope
records store revision/digest and explicit context; they do not store restorable draft
snapshots. Proposed before/after values remain inspectable historical evidence.

## Bounds and lifecycle

Controller maxima are six turns per scope, eight tool actions per turn, four proposals,
16 edits per proposal, eight image references and eight supporting evidence references.
Context is capped at 256 KiB. Timeout is 50–60,000 ms; scope lifetime is 50–300,000 ms.
The UI freezes a fresh scope for each deliberate send, with one turn, eight tools,
four proposals, a 30-second timeout and a five-minute expiry. It never resumes legacy
project history or automatically retries. The service can continue only the exact
still-active stable scope within its declared bounds.

Cancel, expiry, supersession and session close deny further tool rounds. Valid output
already staged before those boundaries may become historical evidence; it never
applies or switches focus. Invalid output commits no proposals. Shutdown persists
interruption, aborts drivers before HTTP drain and discards ephemeral sessions. Cold
reopen shows history without restoring drafts or replaying transport.

## Separate reconstruction bridge

The user separately executes a deliberately frozen V07 request. The injected driver
receives exact source bytes first, then labelled references/placeable images in the
frozen order, explicit text/context, a fresh non-resumed operation identity, empty
history and the unchanged semantic schema. A pure PNG/JPEG/WebP image encoder is
shared with legacy assembly; the account driver is not used for typed visual focus.
There is no browser/environment account or raster-provider fallback.

One bridge attempt is allowed per frozen request, with eight tools and a declared
timeout. Manual retry requires a new V07 request/context. The runtime validates the
unchanged V07 output and stages it before intake. Semantic proposals, V07 result and
control, and final bridge evidence commit in the same KernelStore transaction.
Wrong binding, malformed later proposals or companion-write failure roll back the
whole semantic delivery. Cancellation uses the existing V07 controller; delayed valid
delivery is historical under that authority. V07 review, paired acceptance, comparison
and independent semantic export remain unchanged, including the R1 destination guard.

## Compatibility and rollback

Old V07 roots open with no auxiliary records; legacy histories, accepted semantic
exports and dated capsules remain readable. The compatibility check uses separately
closed original/control/compatibility/additive synthetic copies and compares every
original logical database row and file. SQLite physical layout is not claimed stable
after additive writes. New evidence is added on a separate work unit, followed by cold
reopen and zero transport replay.

Rollback uses this isolated branch plus matching complete closed synthetic-root
copies. Do not downgrade evolved real roots or delete canonical history. Actual model
reconstruction, raster generation, account transport and designer usefulness remain
unverified. Layout/default-count and cross-project Library choices remain unresolved.
