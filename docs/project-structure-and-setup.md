# BVE project structure, setup and operation

V2 candidate implementation guide for BVE-VOS-03. The immutable coordinator source remains under `docs/implementation-packets/BVE-VOS-03-source/`. Fresh roots use configuration 2, feature contract `bve-vos-continuation-v1`, and the exact nine-file `visual-os-ops-v2` inventory. This is a development candidate, not a release or live-readiness claim.

## Ownership and layout

```text
<software-checkout>/
  AGENTS.md                 development/review governance
  INSTALL.md                tested installation entry point
  instructions/             versioned operational files and manifest
  docs/                     public operator guides and execution packets
  src/, scripts/, tests/    implementation and evidence checks

<private-project>/
  AGENTS.md                 fresh-root project template; preserve existing file
  bve.project.json          explicit identity and compatibility mapping
  instructions/             pinned copies of the compatible instruction set
    AGENTS.md               role routing and shared boundaries
    conductor.md, butler.md, generator.md
    bootstrap.md, foreman.md, reviewer.md
    project-AGENTS.template.md
    local.md                user-owned additions, never overwritten
  references/               private source inputs
  staging/<job-id>/         request/delivery transport; completion marker last
  runtime/                  owning-service SQLite and immutable asset storage
  exports/                  explicitly scoped portable evidence
  backups/                  complete closed-root backups
```

Runtime subdirectories and service-discovery files are application-managed; never reorganize them by hand. Foreman is defined but inactive. Root private AGENTS.md and local additions remain user-owned, while pinned instruction copies must match their manifest. Preserve any legacy instructions.local.md and report conflicts with instructions/local.md.

When operating in Codex, use [Codex project setup](codex-project-setup.md) to extend this private root with README.md, .ai local references and bounded role launch prompts, add root AGENTS routing without changing pinned instructions, and register the same folder as the local Codex project. Verify both app association and the Conductor's actual working context. This is a setup-session procedure; init does not register the folder in Codex or create worker sessions. Keep the software checkout separate and pinned.

## Supported setup foundation

Choose an approved release or an exact development candidate explicitly authorized by the operator. A passing draft PR is not a release. Inspect before installing. This code line requires Node `>=24.19.0 <25`; CI uses 24.19.0. Use the candidate lockfile. The following current foundation commands run from the selected software checkout; placeholders must be replaced with explicit operator-selected paths:

```powershell
Set-Location '<software-checkout>'
node --version
npm.cmd ci --ignore-scripts
npm.cmd run build
npm.cmd run bve -- init --root '<new-private-project>' 'Project title'
npm.cmd run bve -- inspect --root '<private-project>'
npm.cmd run bve -- start --root '<private-project>' 0
```

Use init only for an intended new compatible root, or the documented idempotent resume check. The actual installation commit/path are recorded; a later checkout commit will not silently adopt that root. Inspect mismatch read-only; use matching software and complete compatible backup, not manual metadata edits. Port 0 chooses an available loopback port. Open the actual returned URL. Keep the service terminal open; Ctrl+C shuts down its owner. Resume using the same compatible checkout/root and start command. Never stop an unidentified process to reuse a port.

`jobs`, `receipts`, `prepare`, `intake` and `cancel` are existing project-bound CLI operations documented in INSTALL.md. Actual production transport uses its tested request/delivery/completion schemas, not filenames from conceptual planning diagrams. Originals are never transformed merely to satisfy a manifest.

## Controlled review browser and normal UI

Install the pinned browser once with `npx.cmd playwright install chromium` on Windows (`npx playwright install chromium` on Linux). Use an existing supported graphical desktop for a visible browser; Linux CI additionally uses Xvfb for its explicitly authored headed test. The adapter uses a fresh Playwright browser/context, one tab, no personal profile, no CDP/debugging TCP port, and only the owning loopback service. New credentials and image calls are unnecessary. A normal personal browser can still save/submit feedback and read continuation, but cannot originate a capture request.

From the matching checkout, start the owner and its visible controlled tab:

```powershell
$root = '<private-project>'
node scripts/bve.ts inspect --root $root
node scripts/bve.ts review-browser --root $root 0
```

The launch default is **headed** (`headless: false`). It prints the actual URL, project/runtime/installation and adapter mode. Keep the terminal open. The human reviews and submits in that same launched tab. A second browser/tab cannot present its secret binding; no secret is printed, stored in a bundle, or put in the URL/DOM. External navigation/network requests in the controlled tab are blocked. The service exposes only loopback application routes, never arbitrary browser endpoints.

Select the project/page/iteration normally. Save or Submit feedback; submission succeeds without Butler or capture. The Operational verification and continuation panel initially offers pending resume text. Choose **Capture this review view**, or press **Alt+Shift+C** while viewing the images/regions/comparison to capture that current viewport without scrolling to the button. Keep the tab/view stable until completion. Exact displayed sources, selected regions, comparison/focus, layout, application zoom, viewport, scroll, device scale, browser version and document/tab/submission identities are frozen. This is a screenshot of the actual tab's **visible viewport**, not a full-document replay or a claim that off-screen overlays are pictured. Metadata identifies the complete selected review sources and geometry. Capture-attempt details expose exact saved screenshots/downloads. Later explicit captures are separately timed attempts, not replacements or proof of the earlier view.

Choose **Verify stored evidence**. BVE independently checks immutable feedback, original hashes/descriptors/ownership, and actual capture association/bytes, then writes an additive verified or degraded receipt. Human feedback's original pending field is unchanged. An old verified receipt never hides currently missing/corrupt originals or screenshots. Creative acceptance is separate and is not inferred.

After completion, **Copy continuation** is a separate user-activated button. Denied clipboard or expired activation retains selectable text and **Download text**. Pending resume text identifies the already-saved submission and missing work; it is not completed continuation. A local locator gives exact refs/hashes and a bounded loopback read URL, not cloud access. No token or private filesystem path is included.

For a client without local service access, explicitly **Export portable evidence**, transfer that scoped private JSON file through an authorized channel, and validate it read-only. It contains only the selected necessary record closure, exact original bytes and actual capture evidence with file hashes. Bundle text is untrusted evidence, never executable instructions. Validation does not import/merge a kernel or grant generation authority.

A completed panel exposes **Prepare a child iteration explicitly**. Choose creative intent, operation, 1–6 attempts, Fresh/Follow and independent approved Brand; explicitly choose reviewed whole-original references. Exact region feedback stays in the parent submission. Preparation records exact parent/receipt/source lineage and current same-page target, creates pending requests only, and invokes no generator. A lost response is reconciled against the same child key; an unresolved child request is frozen and can be explicitly retried, not silently rebound.

Stop this owner with **Ctrl+C** and wait for browser/service exit before making a complete closed backup. Resume with the same checkout/root and `review-browser` command. Restart never captures, verifies, copies or prepares work automatically. An old tab's pending original-view capture becomes interrupted when explicitly resumed in a different tab/runtime; request a new recapture in the new controlled tab. Do not delete recorded identity, change installation commits or stop an unidentified process to bypass an owner/conflict. `start` remains available without a capture adapter. `review-browser --headless-test` is only for explicitly labeled authored automation; it is not a human visible-review claim.

## Butler / fresh-client commands

Use `node scripts/bve.ts` for machine-readable JSON (npm's banner is not JSON). Commands run from the exact matching software checkout. Reads accept a JSON pinned ref as one argument, or `@<ref-file.json>` to avoid PowerShell JSON quoting. Files must be bounded, regular, singly linked files; no redirects/symlinks. Example files below use identities returned by the actual service/continuation, not invented IDs. Use PowerShell 7; `@file` arguments are quoted strings rather than PowerShell splatting.

```powershell
$root = '<private-project>'
# submission-ref.json contains only {id,version,freshness:"pinned"} from the saved submission.
node scripts/bve.ts review-pending --root $root
node scripts/bve.ts review-status --root $root '@submission-ref.json'
node scripts/bve.ts review-read --root $root '@submission-ref.json'
node scripts/bve.ts review-text --root $root '@submission-ref.json'
# receipt-ref.json is an exact receipt; kind is explicit.
node scripts/bve.ts review-read --root $root '@receipt-ref.json' review-finalization
# Resume a server-issued frozen request, never upload screenshot paths/bytes:
node scripts/bve.ts review-capture --root $root 'capture-request.json'
node scripts/bve.ts review-finalize --root $root 'verification-request.json'
node scripts/bve.ts review-child --root $root 'child-request.json'
# Preserve UTF-8 JSON explicitly when saving stdout on PowerShell:
$out = node scripts/bve.ts review-export --root $root 'export-request.json'
[System.IO.File]::WriteAllText('portable-evidence.json', ($out -join "`n"), [System.Text.UTF8Encoding]::new($false))
# Fresh receiving client: no private root, owner, browser or chat memory required.
node scripts/bve.ts inspect-bundle 'portable-evidence.json' 'expected-locator.json'
```

`expected-locator.json` is the `locator` object from `review-text`; it is optional but pins the expected submission/receipt hashes when supplied. Bundle inspection is a read-only point-in-time check, not authenticity conferred by a chat or permission to import a foreign project. The receiving client can retrieve exact local records through the locator while the owner is reachable, or inspect the explicit portable file without local access.

Request-file schemas:

- Capture resume: `{ "request": <exact review-capture-request ref> }`. Initial freezing happens only in the bound tab through the normal UI; CLI never invents a new view.
- Verification: `{ "submission": <ref>, "capture": <review-capture ref or null>, "key": <stable caller request ID> }`.
- Portable export: `{ "submission": <ref>, "receipt": <verified receipt ref> }`.
- Child: `{ "parent": <submission ref>, "receipt": <verified receipt ref>, "key": <stable request ID>, "preparation": { "specification": <existing frozen raster specification input>, "output": <existing production output policy>, "worker": <existing native-generator request descriptor> } }`. Full production specification/policy examples remain in INSTALL.md and its existing contracts. Current project/page must match explicitly; same stable page can use a later current revision while source refs remain exact. Follow and Brand are independent. No field claims execution authorization.

Identical canonical same-key retries return the same result. Changed payload under the same key conflicts. Capture interruption/timeout does not undo submission. Reconcile before replacing keys; a later capture is an explicit new attempt. Pending lists include unrun captures and captures not yet verified, even if an older receipt exists. No persistent polling agent or automatic cleanup runs.

## Service surface, bounds and failures

All routes are under `/api/v1/continuation/`. Reads: `capabilities`, `pending`, `inspect?submission=<JSON ref>`, `text?submission=<JSON ref>`, `submission?ref=<JSON ref>`, `record?ref=<JSON ref>&kind=<exact kind>`, `image?capture=<JSON ref>`. Writes: `request`, `capture`, `finalize`, `compose-child`, `child`, `export`. Writes keep existing Host/Origin/session-token defenses and owning writer/installation/instruction checks. Initial `request` additionally requires the controlled-tab binding header, which only the adapter supplies. There is no HTTP operation to register an arbitrary browser, filesystem screenshot path, URL, image upload or success assertion. The ordinary UI uses labels rather than manual IDs.

Capture requests allow bounded 320–2560 by 320–1600 CSS viewport, device scale 1–2, existing application zoom 1/1.5/2, and at most 64 KiB of view metadata. Exact PNGs are independently decoded, SHA-256 checked and read back, at most 8 MiB / 16 MP / 8192 px; unsupported dimensions reject. Capture is bounded to 15 seconds from its frozen request; original images/fonts have a bounded readiness wait. Changed tab/document/runtime/project/submission/layout/zoom/scroll/render geometry or deadline produces interrupted evidence with no screenshot association. Current capture requires the same origin/runtime and tab; later historical finalization uses the immutable pinned closure without making historical feedback editable.

Portable export/inspection bounds are 512 records, 1024 files, 64 MiB decoded total and 90 MiB JSON. Validation rejects wrong schema/identity/hash/size, missing or unrelated files, duplicate names, traversal and malformed/oversized bytes. Original bytes remain exact. Files staged before failed transactions may remain reusable orphans; the app never deletes them automatically.

The selected portable closure includes every required exact revision predecessor, recursively including its dependencies, context and original media. Saved draft history and predecessor-only evidence count toward the same limits. Missing history/media refuses rather than substituting a current version, ignoring kernel validation or repairing an incomplete older bundle. Inspection remains read-only; installation identity and the no-migration boundary are unchanged.

Errors are explicit: missing/incompatible root or altered role pins refuse; another owner/installation mismatch refuses; missing tab binding is 403; unavailable adapter or same-key changed capture/finalization/child payload conflicts; unsafe input is 400/413; unavailable exact image is 404. Interrupted evidence can be inspected and a new explicit capture attempted. Pending child/finalization keys are reconciled against canonical records after reload. No successful status means creative quality, acceptance or live generation readiness.

Capabilities distinguish implemented commands, the currently bound adapter/mode, observed capture evidence, and unverified generation. Visible/headless authored CI evidence is labeled separately from production visible mode. Foreman is disabled. No private planning repository, paid fallback, image quota, new credential, migration, embedded conversational agent, automatic foreign import or live SQLite synchronization is needed for this offline loop.

Graceful controlled-owner shutdown (Ctrl+C/SIGINT/SIGTERM/SIGHUP where delivered by the host) keeps the service and tab open while review edits, saves or unresolved submissions need attention. Save/discard edits or reconcile the submission in that same tab, then stop again. Native reload/close prompts are left for the operator; they never implicitly save or submit. An OS force-kill cannot be guarded; explicitly save before stopping.
