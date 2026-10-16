# Install and resume BVE

Instruction set: visual-os-ops-v2. Status: candidate foundation, not a public release.

## Entry and authority

Start from the public repository README and this file. Private planning documents are never an installation dependency. Use an approved stable GitHub release for ordinary installation. Resolve its exact commit, release metadata, supported environment and instruction version before obtaining software. A development branch or passing PR is not a release.

For Codex onboarding, complete [Codex project setup](docs/codex-project-setup.md) as part of installation: the private BVE folder is the local Codex project root, with root AGENTS.md, local references, role launch prompts and a verified Conductor chat association. BVE init creates the compatible application files; the setup session creates the local documentation and registers the folder in Codex. Neither operation alone proves that agents are running. The [initialization prompt](docs/project-initialization-prompt.md) includes this full handover.

At preparation of BVE-VOS-01 no release/tag existed. If no approved release is available, report that fact without substituting a development branch. A user explicitly participating in development may use the exact candidate in an authorized packet.

## Install BVE workflow

1. Inspect the operating system, architecture, filesystem access, installed BVE versions, supported Node and available browser. Inspect before provisioning.
2. Identify a supported release and verify downloaded bytes against its published integrity information. Record the commit as well as the version.
3. Reuse a compatible existing installation. Otherwise prepare a version-specific user-local installation. Do not replace an unrelated checkout or require elevation by default.
4. Provision only the dependencies within the user's installation authorization. Disclose additional permissions, migrations or unsupported sources. Never install models or activate an image API as a prerequisite.
5. Resolve an explicit private project root. Reopen an unambiguous selected project; ask only if the destination is essential and cannot be resolved. Keep software, runtime and staging distinct.
6. Use the application's documented initialization operation. Repeating it must retain project identity and saved work. Refuse unsupported/nonempty unrelated roots. Existing unregistered runtimes require explicit adoption.
7. Bind the compatible versioned role instructions and preserve separate local additions. Do not fetch latest instructions independently.
8. Inspect tool availability without invoking image generation. Record unavailable/unverified capabilities honestly.
9. Start the project on loopback. Verify application version, instruction version, project identity and health before returning the actual URL.
10. Explain start/stop, project creation, review, continuation, export, backup, updates and resume using the implemented feature inventory.

## Current candidate prerequisites

The inspected base declares Node >=24.19.0 <25, with CI on 24.19.0. Use the lockfile:
- npm ci --ignore-scripts
- npm run typecheck
- npm run build

Ordinary launch is npm run dev, or node scripts/dev.ts after a successful build. Set BVE_RUNTIME_ROOT to the explicit private runtime directory outside the checkout and BVE_PORT to an available loopback port. Print the actual URL and keep the owning foreground process identifiable. Stop with Ctrl+C and wait for graceful close. Do not terminate another process to obtain a port.

The verified candidate commands below add project initialization, identity inspection and production intake to this legacy launch path.

## Data ownership

A private project contains bve.project.json, a runtime directory with all BVE-managed stores/assets, staging/<job-id>, references, exports, backups and optional local instructions. Absolute local mappings stay private. The canonical project ID must be checked against the runtime; a folder name is not identity.

Mounted/synchronized Drive storage and Drive connector operations are distinct. Local operation requires neither. Prefer local live SQLite storage; transfer exports or verified closed backups instead of assuming synchronization coordinates a running database.

## Health and limits

Installation health covers supported runtime, correct application/project identity, readable assets and an accessible UI. It does not prove native generation, editing, capture, cloud transfer, parallel workers or designer usefulness. Use authored disposable fixtures for setup verification.

Do not alter an existing project merely to probe health. No image call, paid API, credential setup or local-model trial is part of this procedure.

See docs/project-initialization-prompt.md, docs/operate.md, docs/updates.md and docs/reporting.md.

## Verified BVE-VOS-01 development candidate operations

These commands are implemented for the candidate; independent review and release remain pending. Run them from the exact authorized checkout after the build above. Replace `<private-root>` with an explicit new directory outside the software checkout. The application records that checkout's exact Git commit and compatible instruction set. There is no account sign-in or generation preflight.

```sh
npm run bve -- init --root <private-root> "My project"
npm run bve -- inspect --root <private-root>
npm run bve -- start --root <private-root> 0
```

`start` prints the actual loopback URL, project/runtime identities, running installation path/commit, selected installation and instruction version. Reopen and project-bound operations require the selected checkout and commit to match the executing checkout; a different checkout or changed Git HEAD is refused without rebinding. CLI mutations also verify the already-running service identity before obtaining a token. No update/migration is implemented. Git commit identity is not an attestation that a development working tree is clean. `0` requests an unoccupied ephemeral port; another explicit port may be supplied. Stop with Ctrl+C and wait for close before copying the entire private root as a closed backup. An occupied port is an error and its process is left running. Ordinary `npm run dev` retains its existing unregistered-runtime behavior.

`inspect` always reads local canonical records without starting a service. Its `installation` section distinguishes selected and running identities; its `instructions` section lists each pinned file as `ok`, `missing`, `changed` or `unsafe`. These diagnostics remain available on a compatibility mismatch. Init, start and production writes require all nine `visual-os-ops-v2` instruction files to match the bundled inventory and SHA-256 hashes. Missing/altered pins are refused, never silently restored; project AGENTS.md and separate local additions remain user-owned. Use matching code and a complete closed backup to recover; do not edit compatibility metadata to bypass refusal.

Initialization creates one project and Homepage. Repeated initialization reopens those same identities and preserves context, originals, project AGENTS.md and local additions (including instructions.local.md). A durable `.bve-init.json` lets interrupted initialization resume. Unknown roots require adoption, which is outside this candidate. Unsupported/inconsistent identity or compatibility is refused without reset. Locations are fixed child directories for this version; moving the complete closed root is supported, independently remapping children is not. Keep authoritative SQLite files on a local filesystem with working locks, outside source control.

For a bounded production iteration, the Conductor prepares a local JSON request containing `specification`, `output` and `worker`. The exact v1 specification is the existing frozen raster contract: project and page pointers, operation, explicit count **1–6**, intent, source snapshots and hashes, independent Fresh/Follow and Brand choices, requested controls and provenance. Obtain current identities from `inspect`; the specification is validated at the kernel gate. There is no synthetic-registration batch in this path.

```sh
npm run bve -- prepare --root <private-root> /absolute/path/to/request.json
npm run bve -- jobs --root <private-root>
npm run bve -- intake --root <private-root> <job-id>
npm run bve -- receipts --root <private-root>
npm run bve -- cancel --root <private-root> '{"id":"<iteration-id>","version":1,"freshness":"pinned"}'
```

PowerShell users should pass JSON using their shell's literal-argument rules, or call the authenticated local service with a JSON body. `scripts/production-fixture.ts` supplies a complete authored request and delivery writer for tests; `tests/production-intake.test.ts` and `scripts/production-browser-check.ts` exercise the actual production boundary. Fixture creation is **not** a native invocation.

A typical output policy is:

```json
{
  "preferredWidth": 960,
  "preferredHeight": 640,
  "formats": ["png", "jpeg", "webp"],
  "maxBytes": 8388608,
  "maxPixels": 16000000,
  "maxDimension": 8192
}
```

Worker fields are `{ "kind": "native-generator", "configuration": null, "imageModel": null }` unless actual requested configuration is known. Preferred dimensions are advisory; hard limits are enforced without resizing or re-encoding.

Each returned job freezes its exact project/page/iteration/spec identity, attempt ordinal/count, prompt and source bindings, requested worker, output limits and project-owned `staging/<job-id>` directory. A capable authorized external worker may deliver there. BVE does not invoke that worker. Write the original output first, then `delivery.json`, then **last** `complete.json` containing `{ "version": 1, "jobId": "...", "deliveryHash": "<SHA-256 of exact delivery.json bytes>" }`. The strictly validated delivery contract is defined in `src/modules/website/production-contracts.ts`. It declares ready/failed/uncertain, exact bindings, bounded error evidence, actual filename/descriptor, separate worker/image-model/tool/prompt evidence, and authored-fixture versus reported-native-output provenance. Unknown evidence stays null; reported provenance is a declaration, not independent proof.

Intake independently bounds and fully decodes a single original-byte buffer, verifies the descriptors and hashes, then stores those same bytes. Ready current results become separate proposals in the existing comparison UI, including when distinct jobs return identical content. Identical replay retains receipt/candidate identity. Changed delivery for a completed job records a conflict and verified reference evidence without replacement. Missing completion records an incomplete receipt without consuming a pending job. Malformed, redirected, oversized or corrupt input is rejected; it does not register a proposal. Failed/uncertain deliveries preserve evidence without retry. Cancelled, superseded or stale deliveries are historical only. New explicit preparation supersedes earlier active production iterations on that page; it never removes their proposals/history.

The runtime has one owning application writer. Agent commands use the running service discovered only in the designated project root; when no service is running, mutating commands own a short-lived loopback service. `inspect`, `jobs` and `receipts` use read-only SQLite inspection when closed. New service operations retain the existing host/origin/session-token protections. Tokens are never stored in project config or discovery. Read operations can fall back to read-only local inspection if discovery is unavailable; they never start a competing writer. If a crash leaves stale `.bve-service.json`, run `start` to reacquire the OS-released writer lock and replace discovery; do not delete database/lock files or terminate an unrelated process. Init refuses while a running service owns the runtime.

The additive endpoints are `GET /api/v1/production/state` and authenticated `POST /api/v1/production/prepare`, `/intake`, `/cancel`. The latter two accept `{ "jobId": "..." }` and `{ "iteration": <exact-ref> }`. These production endpoints do not invoke generation, retry automatically, accept designs or clean up. Durable review and additive continuation use their separate interfaces below.

Receipt/candidate/membership/job outcome commit in one kernel transaction. Asset writes occur first; a failed database commit can leave unreferenced, recoverable content-addressed bytes. Such bytes are not a successful result and are never automatically deleted. Repeating valid intake can reuse them. Rollback requires matching software plus a complete closed test/pre-adoption root; never downgrade an evolved database in place.

## Durable production review (BVE-VOS-02 foundation)

Use a fresh disposable/private root initialized by the exact candidate checkout, then the existing project-bound `bve start --root <private-root> 0`. The installation and pinned instruction checks remain mandatory; do not edit an older root's selected commit to bypass them. This candidate adds no migration.

In **Production review**, explicitly choose an owned iteration with at least one reviewable proposal. Select whole images or use the existing rectangle/ellipse controls; add source comments and an overall comment. Existing source intents/preservation constraints remain requests, not new preservation guarantees. **Save draft** explicitly persists the feedback. A reload without saving does not save unsent edits. Review content is separate from legacy selections and next-variation drafts; choose the blank review iteration option to return to those retained controls.

**Submit review** includes current comments and selections, including edits made after Save draft. It commits the final draft revision and immutable submission together through the owning local service. No Butler, Conductor, model or signed-in account is required. Confirmation shows the final draft revision and **operational verification pending / not implemented**; this is not generation or design acceptance. Submitted content is read-only; **Edit as new draft** creates an explicit parent-linked draft and a later submission retains the original.

Dirty page/project/iteration changes and same-app document links (including BVE home and Legacy semantic workspace) offer Save and continue, explicit discard, or Stay. Browser reload/close warns about unsaved edits and pending/unresolved actions where the browser supports before-unload dialogs. Cancelling preserves the form; accepting a native leave warning does not save or submit. Pending/unresolved actions cannot be discarded through app navigation; reconcile them first. Failed saves/conflicts retain typed feedback. On an unconfirmed submission, use **Reconcile / refresh status** before **Retry same submission**. The same action key with identical canonical input returns the same submission; changed feedback under that key conflicts. Reload/restart discovers the canonical draft/submission relationship. Tab storage preserves unresolved request evidence when available, but is not canonical authority. Reopen URLs identify the project, page and iteration explicitly; otherwise choose them again. Saved history and exact identities are under details, with no manual record bookkeeping in the normal flow.

A late delivery (including diagnostic incomplete/conflict receipts), cancellation, supersession or relevant revision invalidates the frozen review scope. The iteration picker discovers historical targets by stable owned page identity, labels older page revisions as historical/read-only, and retains each exact original page reference. Old project/page/iteration URLs recover those targets even when the current page revision differs, including non-default pages. Historical drafts and submissions retain readable comments, source regions and exact originals; they cannot be edited or submitted. The page picker continues to show the latest page revision. Explicitly start a new review of current outcomes rather than rebinding the old draft. Zero-proposal iterations cannot be reviewed; partial iterations freeze and label all observed outcomes. Comment-only feedback is allowed; an empty review is refused. Review snapshots allow 1–6 jobs, up to 64 observed receipts, the existing selection/note/geometry bounds, a 4000-character overall comment, and 10 MiB of feedback. An inventory exceeding these bounds is refused, not silently truncated.

If unavailable media blocks the legacy workspace, a read-only recovery catalog still exposes stored review feedback and exact-source availability. Restore the exact original or a complete closed backup before new writes.

Original bytes and source versions remain exact. Submitted originals are fetched through the stored review reference, never from the latest candidate. Missing/corrupt originals are explicitly unavailable. The older Memory/Continue feature shows summaries only. The separate BVE-VOS-03 portable evidence export includes the selected exact review/original/capture closure; it is not a root backup or foreign import. A complete closed root remains the backup/recovery unit.

### Local review service interface

All mutations retain the existing local Host/Origin/session-token checks and the owning writer. A future Butler client must use this same service, without changing review content authority. GET operations do not write or invoke anything.

| Operation | Route | Bounded request/result |
|---|---|---|
| Read-only recovery catalog | `GET /api/v1/visual/review/catalog` | Query `project` and JSON pinned `unit`; lists registered iteration identities/outcomes without requiring readable original bytes |
| List/load | `GET /api/v1/visual/review/state` | Query `project`, JSON pinned `unit`, and `iteration` ID; returns current frozen `scope`, `current`, partial outcome summary, saved drafts and submissions with original availability |
| Save | `POST /api/v1/visual/review/save` | `{projectId,input:review}`; returns the exact saved draft packet |
| Submit | `POST /api/v1/visual/review/submit` | `{projectId,input:{review,actionKey}}`; returns one immutable submission packet with `finalDraft`, integrity/content/request hashes, server timestamp and pending verification |
| Edit as new | `POST /api/v1/visual/review/copy` | `{projectId,input:{submission:<pinned ref>,draftId:<new stable review-draft UUID>}}`; returns the saved parent-linked draft; stale scope refuses rather than rebinding |
| Exact original | `GET /api/v1/visual/review/original` | Query `project`, JSON pinned `record`, and zero-based `index`; returns the verified original or explicit unavailable error |

A review input takes this form; use the exact `scope` returned by the service, not a hand-built proposal inventory:

```js
const review = {
  draftId: "review-draft-" + crypto.randomUUID(), // retain across retries
  expected: null, // or the exact last saved draft ref; never a guessed latest revision
  scope: loaded.scope,
  feedback: {
    selections: { version: 1, workUnit: loaded.scope.workUnit, entries: [] },
    comment: "None of these compositions works yet."
  },
  parentSubmission: null
};
// Save: input = review.
// Submit: input = { review, actionKey: "review-action-" + crypto.randomUUID() }.
// Retain the same complete input/actionKey until commit status is reconciled.
```

Selection entries reuse `exploration-contracts.ts`: stable ID, exact candidate/integrity/image descriptor, encoded-top-left orientation, normalized-original coordinates, whole/rectangle/ellipse/validated binary mask anchor, intent, existing preservation contract, and bounded notes. Kernel gates independently reconstruct the source/job/receipt closure and check freshness inside the transaction. Revision/scope/action-key conflicts return HTTP 409; syntax errors and missing tokens remain rejected. No browser-supplied author, timestamp or verification result is accepted.


## V2 instruction compatibility checkpoint

Fresh roots use configuration format 2 and `bve-vos-continuation-v1`. The fixed inventory contains eight operational files plus the manifest itself. Their exact bundled and installed bytes are checked before project mutations. V1 configurations refuse read-only; there is no migration. Both immutable instruction source bundles remain available under `docs/implementation-packets/`.

Keep user additions in `instructions/local.md`; legacy `instructions.local.md` is also preserved and diagnosed. If both differ, resolve that conflict explicitly before mutation. Existing private `AGENTS.md` remains user-owned. Capture/continuation configuration marks contract/host dependence, not an available adapter or observed proof. See [project structure/setup](docs/project-structure-and-setup.md); it documents the implemented commands, actual controlled-tab boundary, errors and recovery.


## Actual capture, verification and continuation (BVE-VOS-03 candidate)

Use a fresh v2 root with matching code. Run `node scripts/bve.ts review-browser --root <private-root> 0` for the purpose-launched visible controlled tab; install the pinned Chromium with `npx playwright install chromium` first. Review and submit in that same tab. A normal browser retains Save/Submit but cannot originate capture. **Capture this review view** or **Alt+Shift+C** records the actual visible viewport; it never replays or reconstructs another page. **Verify stored evidence** adds a deterministic receipt, **Copy continuation** is a separate explicit gesture with selectable/downloadable fallback, and **Export portable evidence** carries a bounded selected closure for a fresh client.

The historical submission field stays `pending-not-implemented`; current operational status is derived from additive capture/verification records and present availability. Old verified receipts cannot hide missing/corrupt originals or captures. Creative acceptance and generation remain separate. The completed panel can explicitly prepare a parent-linked child iteration, with 1–6 attempts, independent Fresh/Follow/Brand and chosen exact original references. Preparation never invokes a generator.

The complete tested [structure/setup/PowerShell and Butler interface guide](docs/project-structure-and-setup.md) covers start/stop/resume, pending/exact reads, request files, `@ref-file` handling, export/inspection, bounds, errors and visible/headless evidence. No existing-root migration or live readiness is claimed. Browser unload and clipboard behavior remains browser-owned; explicit saving and fallback text remain necessary.

Graceful controlled-owner shutdown (Ctrl+C/SIGINT/SIGTERM/SIGHUP where delivered by the host) keeps the service and tab open while review edits, saves or unresolved submissions need attention. Save/discard edits or reconcile the submission in that same tab, then stop again. Native reload/close prompts are left for the operator; they never implicitly save or submit. An OS force-kill cannot be guarded; explicitly save before stopping.
