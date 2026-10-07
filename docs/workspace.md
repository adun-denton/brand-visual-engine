# Local Website workspace

A thin, single-operator OS shell runs Website in Branded or Freeroam mode. The browser uses the
same module and shared kernel in both modes. It does not call providers, mount metadata suggestions,
approve reviewed direction proposals, or produce a production website.

## Run and storage

Use Node **24.19.0** (the declared range remains `>=24.19.0 <25`):

```sh
npm ci --ignore-scripts
npm run build
npm run dev
```

Open `http://127.0.0.1:4173`. `npm run dev` builds once and runs the local service; restart it after
code changes. There is no hot reload. Set `BVE_PORT` to a different valid port if needed.
`BVE_RUNTIME_ROOT` defaults to `.bve-workspace` under the operator's home and must be outside the
source checkout. Use a separate private root for fixtures/review. Do not put client media in Git.
Stop with Ctrl+C before copying data. This is a local development app, not a hosted service.

Branded explicitly creates and approves three manually selected palette values and system typography,
or loads an already accepted shared VisualOS. Motion can remain a Placeholder. Freeroam starts without
one and offers a separate explicit mount action for saved context. A reviewed native direction is a
Website proposal with source references and uncertainty; it is never a VisualOS approval.

## Ownership and additive records

| Boundary | Responsibility |
|---|---|
| Kernel | Immutable packet identity/lineage, context resolution, gates, atomic packet groups, bundle selection, transactional acceptance and ledger |
| Website | Existing structured design state plus additive `website-reference`, `website-image`, `website-native-job`, `website-direction`, `website-comparison` artifact payloads |
| Service | Bounded JSON/file parsing, ownership/type/original-input checks, current-project comparison, real image decoding, private file adapter, loopback request enforcement |
| Browser | Brief/reference edits, coherent proposals, legible four-section previews, comparison, explicit decisions, manual import/export and historical inspection |

No v1 packet fields, storage version or legacy tables were changed. New native jobs/results live in
normal Website artifact packets in `kernel.sqlite`; they are not provider-specific kernel types.
`KernelStore.putMany` gates every packet within one transaction. `latestPackets` performs the existing
checksum-checked reads for discovery. Context/reference edits create ModuleProject revisions.
Comparisons append separate artifacts, so comparing candidates does not invalidate their inputs.
Deterministic exploration depends on the **current** project revision: a later brief/reference/mount
change prevents acceptance of that round. Earlier accepted snapshots remain inspectable. Native
requests deliberately pin their original inputs; late candidates require an explicit historical review
acknowledgement and current accepted-pointer comparison before acceptance. Selection remains distinct.

Native bytes are content-addressed under `native-assets/`; descriptors, parents, request IDs and
outcomes live in gated artifact packets. Orphan files after a failed transaction are never adopted or
removed automatically. Invalid bounded uploads are quarantined under opaque names in `quarantine/`.
The adapter checks both original byte SHA-256 and decoded descriptors on reads. Display previews are
normalized PNGs; **Download reference image / original result returns original bytes** with their
manifest checksum, not normalized previews.
The preview endpoint `/api/v1/image` returns PNG. `/api/v1/asset` uses the same ownership,
checksum and full-decoder checks, then downloads the stored bytes with their decoded MIME type
and a checksum-based `.jpg`, `.webp` or `.png` attachment filename.

Existing `workspace.sqlite` is opened only by a read-only legacy asset validator if present. It checks
schema, asset identity, fixed derived RGB paths, byte checksums and raster dimensions. It never exposes
raw legacy methods over HTTP or runs legacy job recovery. Existing legacy snapshots remain readable.
The databases are not unified: old jobs/decisions remain historical; the kernel owns new acceptance.
Both stores and both asset folders must be preserved together. There is no implicit legacy import,
remote provider execution, external job reconciliation, schema migration or automatic Git sync.

## Browser workflow

1. Open Website with a name and hydration mode. Edit intent, audience, offer, response, required
   content, exclusions, commitments and unresolved choices; save with a reason.
2. Attach permitted PNG/JPEG/WebP references and choose roles/scopes. Save later role/selection changes
   as new revisions. Missing inputs remain visible; unconfigured executors do not prevent editing.
3. Explore 3/6/9 coherent deterministic proposals. A chosen prior design can center a smaller round.
   Compare two at the same scale, save why, select a direction, then separately accept it with a reason.
   Relative dimensions are exploration controls, not scores. Colors remain provisional if no palette
   exists; preview illustrations/text are authored synthetic fixtures, not live AI design or a composer.
4. Create a section-scoped native request against an explicit design/image. Export its JSON request;
   attach the selected original reference/input files separately to your authorized native host. The
   export includes the pinned project/context, artifact state, request instructions and preservation
   requirements. It can be understood without planning-repository access.
5. Import a returned image into that same original job. Original project/artifact/asset versions,
   reference roles/checksums and selection metadata remain bound. Unknown model/settings/seed/usage/
   provider IDs remain null. Results are candidates; no pointer is changed by import.
6. Duplicate images remain one candidate with a recorded duplicate outcome. Invalid imports record
   an invalid attempt on the still-current original job. A mismatched owning project or stale job
   version rejects without altering that other job. Cancel/abandon is local only; late files are
   retained for their closed original request and cannot be accepted. Other late results require
   explicit review. Every acceptance compares the then-current pointer.
   After a rejected mutation the browser reads back the owning workspace, updates changed state,
   and retains the original error. Reselect a corrected file in that same request; there is no
   automatic mutation retry or generation. Stale versions still reject. Workspace creation/opening
   restores only that project's saved comparison and resets its active exploration round.
7. Import reviewed direction JSON with `title`, `rationale`, `constraints`, `uncertainty`, `unresolved`,
   project `sourceReferences`, `reviewed: true` and `source`. Its uncertainty persists; it stays a proposal.
8. Inspect history, stop/restart the service, reopen the project and inspect earlier accepted versions.
   Metadata inspection reports available/missing pointers; it never silently mounts VisualOS context.

## Local boundary and limits

`/api/v1/` reads and mutation endpoints are versioned. Static files are explicitly allowlisted.
The service binds only `127.0.0.1`; Host must match its bound origin, a supplied Origin must match,
and cross-site fetch requests reject. Mutations require exact same Origin, JSON content type and a
random per-process session token. The browser never receives filesystem paths or credentials.
Nested fields, IDs, version pointers, roles/scopes, lists and text are bounded before kernel entry.
JSON bodies are limited to 12 MiB; image files to 8 MiB, 8192px per side, 16 MP and a single frame.
PNG/JPEG/WebP signatures and actual full decoding are required; metadata alone is insufficient.
SVG, animation, corrupt/truncated files and unknown fields reject. Asset downloads verify ownership,
type, checksum and decoded descriptor. Generated filenames never use caller paths.

Requests too large to safely parse reject at transport level without an associated job outcome;
bounded parsed invalid images record job outcomes. Missing/corrupt private storage rejects visibly,
without emitting its full path or regenerating accepted work. The local token/origin checks are not
multi-user authentication or production security. Decoding is bounded but not an OS sandbox; imports
from adversarial sources and redistribution of native dependencies need a separate security/license
review. No automatic chargeable retry occurs because no provider is submitted here.

## Dependencies and evidence

- Runtime `sharp 0.35.5` (Apache-2.0): full PNG/JPEG/WebP decoding, limits and PNG preview encoding.
  [Constructor/limits](https://sharp.pixelplumbing.com/api-constructor/) and
  [installation](https://sharp.pixelplumbing.com/install/) were checked. npm metadata supports Node 24.
  Its prebuilt native libvips dependencies include separate notices (including LGPL); the root product
  license/redistribution decision remains deferred.
- Build `esbuild 0.28.2` (MIT): one browser TypeScript bundle and copied HTML/CSS;
  [official instructions](https://esbuild.github.io/getting-started/) checked. No React/diagram framework
  is needed for this small view layer. Optional platform binaries work with ignored install scripts.
- Dev `@playwright/test 1.58.2` (Apache-2.0): repeatable local browser flow;
  [official installation](https://playwright.dev/docs/intro) checked. The latest queried 1.63.0 browser
  download was unavailable here; 1.58.2 is the pinned test harness, with runtime browser version reported.
  Browser downloads are separate from the locked npm install.
- Existing TypeScript 7.0.2 / Node types 24.10.0 remain unchanged. No provider SDK was added.

Run all retained commands, then:

```sh
npm run build
npx playwright install chromium
npm run test:browser
```

On Linux CI the browser install includes system dependencies. If the standard browser download is
unavailable, use `BVE_CHROMIUM_EXECUTABLE` with an installed Chromium and record its actual version.
`BVE_EVIDENCE_DIR` selects a screenshot/report folder. The check uses a private temporary root outside
Git and a separate service process; it restarts both service process and browser context. Evidence
is synthetic. Regenerating evidence changes IDs/screenshots; review it before committing. The script
retains the synthetic root for failure inspection and copied backup, never deletes operator data.

The published screenshots/report under [evidence](evidence/) show implementer technical inspection
at 1440×1000 and 390×844. This is not independent review or designer usefulness/approval. Actual native
host generation is pending an operator-authorized host round trip; a synthetic attachment does not
prove it. Windows/macOS UI and Windows directory crash durability remain unverified.

## Recovery and rollback

Stop all processes and close both stores. Copy the **entire** private root, including remaining WAL/SHM,
legacy `assets/`, `native-assets/`, quarantine and any private exports. Restore only to a new folder with
matching code, reopen and verify accepted checksums, original-job links, references and decisions.
`tests/workspace.test.ts` verifies this on a copied closed synthetic root, including a byte-identical
legacy SQLite store. It does not claim online backup, hard-power-loss or Windows directory durability.

Keep the merged baseline `f39eb1e9144382664903919312be982ec57e5c98`. Discard an unmerged PR or make a
scoped revert of the workspace commits, preserving both databases and asset history. The baseline
cannot interpret new Website artifact kinds: keep the complete task-002 root untouched and use its
verified matching-code backup for later restoration. Do not open that root in older code, force-push,
delete live state or test restore on the only copy.
