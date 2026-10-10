# Inference workspace candidate

Opening a project starts with a page preview beside an instruction and AI exchange panel. New
alternatives, focused revisions and critiques use the same request/result contract. Internal section
counts, media slots and responsive rules belong to the proposed design, not a fixed creative sequence.

## Scoped session exchange

1. Save the brief under **Brief & references**, then return to **Design workspace**.
2. Choose new alternatives, revise, or critique. A revision selects the exact active snapshot. Select a
   local element for focus and, optionally, preserve its exact text. The service also supports exact
   subtree and style locks. Brief context remains a frozen conceptual input, distinct from exact locks.
3. Choose references deliberately. Existing placed media accompany a selected base. Download request
   JSON, or the package with its selected original files. Unselected references, unrelated pages,
   complete project history, private provider records and credentials are excluded.
4. Give the request to an AI session. Return the declared structured JSON with its exact request ID and
   hash. Placeable media use included handles; a separately attached new file can use an `upload-`
   handle. Reference-only resources cannot be placed. Critiques may return findings without candidates.
5. Import the result with its AI source and observed model, leaving unknown model metadata blank.
   Application identities and hashes are assigned locally. Proposed actions are recorded as data.
   No result executes follow-up work, mounts a brand, or accepts a design automatically.
6. Inspect the full preview at desktop or 390px width, compare an earlier snapshot, and review findings.
   Acceptance is a separate exact-version decision with a reason and a compare-and-swap pointer.

The compact paired frame can scroll horizontally to inspect its requested viewport. **Open full
preview** provides a separate full-width view. On narrow screens, the two panels stack. Structured
manual edits and media placement create immutable operator revisions; prior accepted exports stay
pinned. A cancelled or stale request can retain its response as historical proposals without replacing
newer work. Duplicate exact results register once. Malformed intake commits no packet group.

The active page identity is remembered separately for each project in this browser/origin. Reload
and same-origin restart preserve that choice; it is not a design or acceptance record. If browser
storage is absent, automatic fallback excludes cancelled/stale historical proposals. Such proposals
are labeled historical and can be inspected through deliberate selection. A selected identity follows
its latest local revision; accepted exports remain pinned independently.

## Independent pages, media and Websites

- A `website-page` design artifact owns a complete semantic tree, declared local styles, responsive
  rules, frozen relevant context, rationale and preservation locks. Flow, flex and grid are supported.
  It can have zero or many internal sections and slots. It has no design-artifact dependency or live
  project-context pointer. Its only dependency records are exact independent media bindings.
- A `page-media` resource owns permitted original image bytes, hash, format, dimensions, role and
  permission statement. PNG, JPEG and WebP retain their original bytes. Media source/migration evidence
  belongs to separate work records. Copying an exact original from retained image tools is explicit.
- Requests, results, import receipts and migration evidence are `work-record` packets. They carry
  operational links outside the page's design content. Unknown model/settings/usage remain null.
- A `website-assembly` owns routes/navigation and exact page selections. Every selected page version
  needs an explicit acceptance event. The Website itself also needs separate acceptance. Accepting a
  newer page never edits an existing Website. Unresolved internal routes are rejected by the service.

The browser uses the same authenticated local HTTP boundary, kernel contracts and SQLite transaction
store as the retained tools. No separate page database, automatic brand propagation or background
model agent is introduced. Stored immutable versions are revalidated at consumption.

## Portable handoff and migration

An accepted page exports `manifest.json`, `index.html`, `RECONSTRUCT.md` and its exact media closure.
A Website exports each complete selected page under its directory route with relative links and assets.
These files can be reconstructed or inspected without the original project, other page artifacts or
original ledger. Source hashes and acceptance evidence are included; they do not assert local approval
in a new workspace. Portable page import validates the snapshot and original media, gives resources
new local identities, and creates an unaccepted proposal plus a separate source-evidence record.
Extract the package, paste its manifest, and select its asset files in the import panel.

Legacy composition conversion is additive. Copy, order, exact image bytes and basic styling transfer
into a new page proposal. The conversion explicitly reports loss of legacy recipe geometry, generated
header/footer and responsive behavior; it does not claim visual equivalence or inherit approval. The
original composition, review history and accepted export remain available without rewriting.

## Execution and limits

The current reasoning path is a manual, provider-neutral scoped session exchange. The published JSON
schema is an adapter boundary for a future measured local executor; no local runtime, hardware/model
selection, cancellation transport or local performance benchmark is implemented or certified here.
Session imports carry operator-attested authorship, not observed provider telemetry.

Paid OpenAI submission is blocked even if an old key or private policy is configured. Retained adapters
and injected offline transports remain for compatibility tests; those tests prove no live account,
usage, image generation or model quality. Native images are explicit external generation/import work.
Arbitrary page media can reuse exact returned originals, including originals edited by the retained
regional tools. Direct arbitrary-slot regional editing is not wired into the new page panel.

The grammar intentionally excludes executable markup, remote resources, arbitrary CSS, custom font
binaries, video and animations. Typography uses declared locally available families. Responsive style
rules are declarative; constraints bound resource consumption rather than prescribe a section recipe.
Automatic accessibility/contrast judgment, drag-and-drop editing, semantic merge/rebase, Website
hosting, actual booking and designer acceptance are outside this candidate. Findings are acknowledged
explicitly, not treated as machine proof of design quality.

## Run and verify

Use the root setup instructions. `npm run test:browser:pages` checks the paired UI, scoped download,
malformed intake, exact media, preservation, acceptance, history, Website pinning, narrow overflow and
closed-copy recovery. Set `BVE_CHROMIUM_EXECUTABLE` for an available Chromium binary and
`BVE_EVIDENCE_DIR` outside Git for receipts/screenshots. Existing six browser workflows remain required.
The replay utility `scripts/session-trial.ts` prepares a synthetic request and imports separately
session-authored round-one/round-two JSON. It performs no AI call or independent designer acceptance.
