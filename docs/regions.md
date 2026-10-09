# Regional image iteration

Website's **Regional edit** view shares the existing Branded/Freeroam workspace and kernel.
Choose an imported/generated section image, draw an ellipse or rectangle on the separate overlay,
and save its source-pixel bounds. Arrow keys move the annotation; numeric bounds provide an
alternative to dragging. Changing a selection creates an immutable mask revision. Changing the
source requires a new binding; the application never rescales a saved mask.

Prepare instructions, choose up to four selected references for the section (or landing page),
choose a preset/path, and save the request before executing it. Importing/collecting a result,
compositing, comparing/selecting and accepting are separate actions. The original source, underlying
native/API result, regional raw candidate and local composite retain distinct identities and history.
The raw and composite are separately downloadable. A comparison does not accept an image.
Each operation restores its latest saved compared versions, selection (including unresolved)
and reason. New candidates remain available without changing that saved subset or decision.
Comparison selection and the accepted section image have separate indicators; use the explicit
acceptance action to change the accepted image. Historical comparisons remain in the ledger.

## Recipes and execution

`website-region-v1` records the chosen preset, path, supported controls and unavailable controls.
Initial intent presets are Explore, Preserve form/change finish, and Edit selected area. They resolve
instructions; they do not establish a provider quality or preservation guarantee.

| Path | Supported request | Explicitly unavailable |
|---|---|---|
| Manual native | Instructions, chosen original images, bound binary mask and PNG guidance | Observed model/settings/seed/usage/ID; controlled size/quality; guaranteed mask adherence; remote cancellation |
| Existing API edit adapter | Original source + chosen reference files; `n=1`, opaque PNG; 1024×1024 / 1536×1024 / 1024×1536; low/medium/high | Mask input, seed, CFG, exact preservation, remote cancellation |

Extend canvas and Final detail are unavailable. Unsupported controls reject before job/operation
writes. Native metadata remains null; API requested settings remain separate from reported settings.
API preparation adds no call. Its original explicit submission, atomic reservation/claim, no automatic
retry, cancellation and outcome-uncertainty boundaries remain unchanged. Fixture credentials and
transports exist only in tests, never in production HTTP controls. Offline checks prove no account,
live model quality, billing or designer acceptance.

The native export is one JSON bundle containing base64 **original file bytes**, their checksums and
reference roles; the pinned source/selection geometry; instructions/preservation intent; a binary
0/1 mask; and a checksum-bearing PNG mask guide. Extract these files for a separately authorized
host handoff. The mask is guidance only. Return the file to that original job, then collect it into
the regional operation. This application does not call a native host.

## Raster policy and limits

- Original image import safeguards remain: decoded single-frame PNG/JPEG/WebP, at most 8 MiB,
  8192 per axis and 16 MP. **Regional editing** has a tighter 4,000,000-pixel bound; larger images
  remain stored/readable but require an explicitly prepared smaller source before selecting.
- Canonical region decoding is `auto-orient-srgb-uchar-rgba-v1`: apply EXIF orientation, convert to
  sRGB, unsigned 8-bit RGBA, preserve alpha. Coordinates originate at the oriented top-left pixel.
  This is a decoded-pixel policy, not compressed-file byte identity or preservation of other color spaces.
- One binary byte per source pixel, checksum-addressed in the existing private asset folder. Empty,
  nonbinary, wrong-length, out-of-bounds and mismatched source/version/dimension masks reject.
  Ellipses include pixels whose centers lie inside the ellipse; rectangles include the whole bounds.
  No JSON pixel arrays are used for production images. Native export uses bounded base64 binary files.
- Strict composition requires equal oriented dimensions and uses S0's binary **hard-edge, no-blend**
  semantics. Source pixels are copied outside the mask; raw pixels are copied inside. The encoded PNG
  is decoded again to verify **zero changed RGB channels and zero changed alpha values outside**.
  The old RGB fixture validator retains its 1,000,000-pixel cap; its exhaustive property checks now
  exercise the same buffer implementation as the production path.
- Each RGBA raster is at most 16 MB and the mask at most 4 MB. Strict composition holds several
  such buffers (about 68 MB at the limit, plus encoded inputs/results and sharp/native overhead).
  This is a per-image bound, not a total process RSS/concurrency guarantee. Display crops are separately
  bounded to 512 pixels on their longest axis. Export is capped at 16 MiB of original inputs plus mask
  before base64 and the derived PNG guidance. Standard 1254-square images are covered in integration.
- Geometry-changing raw results remain candidates; strict composition blocks pending a new aligned
  source/result and explicit selection. There is no automatic alignment, resize, rotation, blend or crop.
  Hard edges can expose seams; inspect both section and matched source-pixel crop before acceptance.

## Persistence and acceptance

Four additive Website artifact kinds use v1 packets and existing `kernel.sqlite` storage:
`website-region-selection`, `website-region-operation`, `website-region-image`, and
`website-region-comparison`. There is no schema migration or replacement kernel/provider store.
Each operation pins its project, exact source, mask version, chosen reference images/roles, execution
job/attempt and resolved recipe. Requested inputs never change when outputs are appended. Original
assets and historic mask versions remain available after reopening or closed-root copying.

Known ownership/type/scope, source descriptors, binary mask/annotation geometry, recipe and execution
bindings are checked at construction and consumption. Job/operation creation and candidate/operation
publication use atomic packet groups. An orphan file after a failed database write remains unaccepted;
a later explicit retry can reuse its checksum-verified bytes. No history or live state is deleted.

Regional acceptance checks the recorded result, returned execution, current source/mask/project,
current active section mask (including source replacements), current accepted pointer against the operation's original pointer, and strict pixel evidence when
requested. The kernel's optional synchronous acceptance guard repeats module checks inside the same
`BEGIN IMMEDIATE` transaction as its compare-and-swap ledger/pointer write, after asynchronous decoding.
Selection saves compare the expected active section selection inside the write transaction; the latest immutable selection revision in the section ledger identifies that active selection. A conflict retains candidates and asks for fresh review. Ordinary image acceptance cannot bypass a
regional operation's policy; use Regional edit for its results. Cancelled/abandoned/late operations
remain bound to their original inputs. Historical crops are fetched from the pinned selection, never
from a newer mask. No Website decision promotes VisualOS or silently mounts context.

## Offline verification and recovery

Run the retained checks in [verification.md](verification.md), then `npm run build` and
`npm run test:browser:regions` with the documented Playwright setup. `BVE_EVIDENCE_DIR` selects a
private/disposable evidence folder. The regional browser fixture includes drawing/keyboard/numeric
controls, reference-backed native import, actual bundle/download byte checks, source/raw/composite
comparison, outside RGB/alpha checks, explicit acceptance, exactly one injected API submission,
historical crop recovery after mask revision, and equality after a gracefully closed root is copied
and reopened with a fresh browser session. It uses private test-only IPC for acknowledged counts.
Visible comparison fields are checked immediately after saving, across tab navigation/reload,
in a fresh browser context and after closed-root recovery. Two operations retain independent
selected/unresolved decisions, non-default subsets and reasons when a later candidate is appended.
CI retains all four browser workflows and the Phase A guide rehearsal on Windows and Linux and uploads receipts/screenshots.

Rollback code with a scoped revert or leave the dependent draft unmerged. Preserve `kernel.sqlite`,
`workspace.sqlite` if present, provider budget history, all asset folders and immutable versions.
Stop/close all processes before copying synthetic roots. Online backup, power-loss behavior,
Windows directory fsync, live providers and consequential designer review remain unverified.
