# Image-first visual workspace review

V02 implements an offline interaction slice for TODO-BVE-20261011-017, starting at
accepted V01 `d3bdd456de57874fc69c6fe175937a5b5c0dd7bc` / tree
`608a137b3dcdc9a639047a7fe6b058140342b7d3`. Planning pin:
`18cf3e843bcc7a44395ae4078719bf7b236ac409`.
Independent acceptance belongs to the originating reviewer. Neither layout nor a default
attempt count is selected by this implementation. Actual image inference remains future work.

## Review and operation

`npm ci --ignore-scripts`, then `npm run review:visual` launches a fresh synthetic root
on an ephemeral loopback port and prints its `/visual` URL. Provider credentials/policy are
explicitly null and both models disabled; no provider environment or existing user root is read.
Choose the synthetic project to inspect six hand-authored raster compositions and partial,
cancelled and uncertain examples. The fixture harness is outside production routes/UI.
Ctrl+C gracefully closes the owned server/store; its printed disposable root is retained.
Do not use ports 4173/4174 or a live trial/user runtime for review.

The ordinary app exposes `/visual` separately and retains `/` for semantic and legacy work.
Create a Website project and a Homepage/About Us/custom page. Import exact PNG/JPEG/WebP with
use permission, compare images, select whole sources or rectangle/ellipse regions, and save notes.
Whole selection toggles independently of regions. Non-drag percent inputs support keyboard region
entry. Exact is available only for whole-source retained bytes, as a request to retain a named
asset; it never promises identical composition pixels. Rectangle/ellipse Exact is unavailable.
Mask brushes, compositing and actual preservation execution are deferred.

A **Contact sheet + Focus** groups result cards by batch and keeps imports separate, with a focus
canvas for annotation. B **Focus + Filmstrip** leads with the focused image and horizontal references;
Compare opens selected concepts side by side. Layout and focused/comparison views are disposable
browser state. Canonical selections, notes, versions and batches are identical across both layouts.
Existing multiple selection sets require an explicit saved-set choice; no active pointer is invented.

Preparation requires intent, an explicit 1–6 count and Fresh/Follow Direction. Brand starts off;
an existing approved VisualOS may be chosen independently. Fresh excludes source style but does not
remove Include/Exact content requirements. The action freezes inputs and prepares pending slots in
one kernel transaction; it never executes or reports generation complete. Refresh/refine/branch
make new records and retain earlier batches. Manual retry links the consumed original batch slot
and reuses its frozen count/specification, without execution or automatic retry. Cancellation
preserves valid results and existing uncertainty. No output is automatically selected or accepted.

History shows original frozen specifications and outcomes after page/project reopen. Raster
replacement creates a new version; older membership/anchors/media remain exact. Candidate and batch
ordering comes from creation events, not random UUID order. Library, Export As and Build as HTML
remain distinct unavailable actions. Existing semantic export behavior is unchanged.

## Requested controls and ownership

No current font, spacing, colors or perceptual/dynamic measurements are invented. Controls request
future changes; raster bytes remain Level1 actual state. Level2 requests live in the frozen
specification, separate from inferred/observed candidate metadata. Approved Brand values are copied
into the frozen input with exact source/integrity; proposals are excluded and project observations
never become Brand rules.

Keys are `<scope>--<descriptor>`, with scope `page` or an exact selection-entry ID. The snapshot pins
that entry's raster version and original anchor. Level1 uses constraint path `request.<key>`;
Level2 uses `metricRequests` with `status: requested`, declared scale and user-request provenance.
These fields express intent, not extracted properties. Unprepared form values are disposable;
saved specifications are canonical. There is no local-storage memory/database.

| Level / family | Descriptor keys | Request type / unit |
|---|---|---|
| 1 | `contrast` | Semantic continuous 1.0–10.0 |
| 1 | `accent-color`, `background-color` | Six-digit hex color, explicitly requested |
| 1 | `font` | Requested font name; no installed/font inference claim |
| 1 | `spacing`, `corner-rounding` | Integer px; spacing 1–8192, rounding 0–8192 |
| 2 Spatial | `visual-density`, `whitespace`, `image-dominance`, `grid-rigidity`, `asymmetry` | Independent semantic continuous 1.0–10.0 |
| 2 Structural | `layout-complexity` | Semantic continuous 1.0–10.0 |
| 2 Structural | `section-count` | Integer count 1–100 |
| 2 Structural | `column-structure` | Category: single / multiple / mixed |
| 2 Structural | `content-width`, `section-height` | Integer px 1–8192 |
| 2 Styling | `color-intensity`, `typography-expression`, `shadow-depth`, `accent-usage` | Semantic continuous 1.0–10.0 |
| 2 Styling | `surface-style` | Category: flat / textured / layered |
| 2 Styling | `visual-effects` | Category expressing effect strength: none / subtle / pronounced |
| 2 Dynamics | `motion-amount`, `motion-speed`, `scroll-choreography`, `interaction-feedback`, `micro-interactions` | Retained inventory, unavailable for this static raster slice |

This retains six Level1 and 21 Level2 concepts, rather than 21 permanent sliders. Tune and Brand
are optional disclosures. Semantic 1.0–10.0 units are authored intent, not empirical scores;
no conversion from legacy 0–100 occurs. Category vocabulary is a bounded request interface, not
an approved brand, page template or new metric family. Contextual navigation/easing/transitions/loading
and dynamics previews remain outside this static slice.

## Boundaries and persistence

`VisualWorkspace` owns only narrow projection/commands. Production routes are create/page/import/
selections/prepare/cancel/retry and owned exact-image/state reads. There is no generic packet write,
synthetic-success intake, provider submit, arbitrary URL fetch, HTML/SVG intake or acceptance route
under `/api/v1/visual`. All mutations retain existing host/origin/session-token, JSON/body-size and
strict input validation. Imports fully decode and recheck project/page/source freshness after await.
Selection revisions use exact saved-set compare-and-swap; foreign-page/project sources reject.
Plain text rejects markup/control characters and all projections are escaped in the DOM. Domain
conflicts report useful 409 errors; storage/integrity failures retain their existing protections.

V01 specification/batch creation was factored into pure packet builders for atomic `putMany`.
Import optionally rechecks the expected project after decoding. Public V01 contracts, R1/R2,
SQL schema, asset checksums and accepted pointers are unchanged. No migration or parallel store.

Image display intentionally disables EXIF rotation and uses encoded-top-left geometry. A
ResizeObserver fits the original aspect ratio; zoom adjusts displayed size. Pointer coordinates
are normalized against the actual displayed image rectangle, excluding letterboxes. Overlays use
that same image plane. No coordinates are rewritten on resize/zoom/layout changes. All owned
browser/test roots are synthetic and close before disposal.

## Verification and limitations

`npm run test:browser:visual` builds on an already built app, starts a fresh ephemeral server,
performs an actual seven-image walkthrough, checks normalized geometry, EXIF pixels, zoom,
keyboard/non-drag regions, independent notes, counts 1/6, page isolation, raster replacement,
closed-process restart and truthful partial/uncertain/cancelled outcomes. Set `BVE_EVIDENCE_DIR` to
an external evidence directory; optional `BVE_CHROMIUM_EXECUTABLE` selects a installed Chromium.
CI runs this and all eight existing browser workflows on Windows/Linux and uploads screenshots
plus `walkthrough.json` in its browser artifacts. Fixtures prove interaction only.

Known limits: no image inference, masks/compositing, pixel-edit engine, measured style/dynamics,
Brand compiler, chat, Library/raster export or HTML reconstruction. An entry edits its primary note;
additional existing notes remain visible and preserved. Unsubmitted form drafts/view preferences
are not canonical memory. This is a review workspace, not designer usefulness or release evidence.
PR10/R7, account/model/GPU execution, user migration, merge and deployment are excluded.

Recommendation for review: A gives a stronger initial overview of alternatives and batch outcomes;
B gives more room and shorter navigation for repeated region work. B is the stronger candidate for
sustained editing, with A useful for opening comparison. This is a recommendation only; final layout
and default count remain with the operator.

Rollback: close owned processes and use accepted V01 in a separate checkout. Restore complete closed
roots with matching code where needed; never downgrade an evolved store in place or selectively
remove media/rows. Preserve evolved roots separately.
