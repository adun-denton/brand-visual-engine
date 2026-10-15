# Install and resume BVE

Instruction set: visual-os-ops-v1. Status: candidate foundation, not a public release.

## Entry and authority

Start from the public repository README and this file. Private planning documents are never an installation dependency. Use an approved stable GitHub release for ordinary installation. Resolve its exact commit, release metadata, supported environment and instruction version before obtaining software. A development branch or passing PR is not a release.

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

`start` prints the actual loopback URL, project/runtime identities, selected installation commit and instruction version. `0` requests an unoccupied ephemeral port; another explicit port may be supplied. Stop with Ctrl+C and wait for close before copying the entire private root as a closed backup. An occupied port is an error and its process is left running. Ordinary `npm run dev` retains its existing unregistered-runtime behavior.

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

Intake independently bounds and fully decodes a single original-byte buffer, verifies the descriptors and hashes, then stores those same bytes. Ready current results become separate proposals in the existing comparison UI, including when distinct jobs return identical content. Identical replay retains receipt/candidate identity. Changed delivery for a completed job records a conflict without replacement. Missing completion records an incomplete receipt without consuming a pending job. Malformed, redirected, oversized or corrupt input is rejected; it does not register a proposal. Failed/uncertain deliveries preserve evidence without retry. Cancelled, superseded or stale deliveries are historical only. New explicit preparation supersedes earlier active production iterations on that page; it never removes their proposals/history.

The runtime has one owning application writer. Agent commands use the running service discovered only in the designated project root; when no service is running, mutating commands own a short-lived loopback service. `inspect`, `jobs` and `receipts` use read-only SQLite inspection when closed. New service operations retain the existing host/origin/session-token protections. Tokens are never stored in project config or discovery. Read operations can fall back to read-only local inspection if discovery is unavailable; they never start a competing writer. If a crash leaves stale `.bve-service.json`, run `start` to reacquire the OS-released writer lock and replace discovery; do not delete database/lock files or terminate an unrelated process. Init refuses while a running service owns the runtime.

The additive endpoints are `GET /api/v1/production/state` and authenticated `POST /api/v1/production/prepare`, `/intake`, `/cancel`. The latter two accept `{ "jobId": "..." }` and `{ "iteration": <exact-ref> }`. No generation, automatic retries, acceptance, submission, capture or cleanup endpoint is added.

Receipt/candidate/membership/job outcome commit in one kernel transaction. Asset writes occur first; a failed database commit can leave unreferenced, recoverable content-addressed bytes. Such bytes are not a successful result and are never automatically deleted. Repeating valid intake can reuse them. Rollback requires matching software plus a complete closed test/pre-adoption root; never downgrade an evolved database in place.
