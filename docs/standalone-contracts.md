# Legacy standalone contract spike

The retained compatibility spike below is supplemented by the shared kernel and Website module
in [design-os-contracts.md](design-os-contracts.md). It is not the current generic ownership model.

This document describes the experimental v1 interfaces in this checkout. It is implementation
reference, not project planning or task status. There is no browser application or live provider
adapter here. Fixtures are fictional; their colors and wording have no designer approval.

## Initial stack and deployment assumptions

The executable spike uses Node 24.19.0, erasable TypeScript, `node:sqlite`, and a filesystem asset
store. Node runs the TypeScript directly; type stripping does not check types, so `npm run typecheck`
is a separate required command. The lockfile pins TypeScript 7.0.2 and Node types 24.10.0.
There are no runtime npm dependencies. The compiler uses a platform-specific optional binary;
`npm ci --ignore-scripts` selected the Linux x64 binary successfully in the implementation environment.
Other operating systems/architectures have not been exercised.

This proves a bounded local storage approach without selecting UI or canvas libraries prematurely.
The browser workspace can add React and a lightweight build tool with a same-origin TypeScript
service. Exact UI libraries, runtime JSON validation, image decoders and their licenses must be
checked in the workspace packet. Do not expose the current Store directly to untrusted input.

Deployment assumption: one trusted operator, one local service process, private local runtime
folder, browser connecting only to loopback when a service exists. The spike opens no listening port.
A later service needs explicit origin checks and request validation, even on loopback. Multi-user
hosting, public network access, tenant isolation, remote workers and production auth are separate
architecture decisions. Linux directory fsync is used here; Windows support is unverified.

Node 24.19's SQLite module is a release candidate according to the
[version-specific official documentation](https://nodejs.org/download/release/v24.19.0/docs/api/sqlite.html).
Keep SQLite behind Store and test migrations before updating the runtime or binding. This synchronous
spike is for small fixtures; it does not establish large image throughput or UI responsiveness.

## Identities and acceptance

| Interface | Stored contract | Mutation rule |
|---|---|---|
| Project | Stable ID, schema version, revision, brief revision, references, direction proposals, style, ordered editable sections | Acceptance increments project revision; arbitrary editing is not implemented |
| Brief | Audience, offer, intended response, content, exclusions, commitments, unresolved questions, synthetic provenance | Initial snapshot only; later revision APIs must preserve previous snapshots |
| Reference | Identity, fixture path, selected role, permitted use, section scope, source | Selected references are scoped per job; no private reference ingestion |
| Direction | Candidate identity, reference IDs, rationale, unresolved choices, proposal/provisional/approved status | Fixture directions stay proposals; AI critique cannot approve them |
| Section | Stable ID/kind, editable text contract, accepted version ID or null, explicit overrides | Acceptance updates only this section; other sections retain their selections |
| AssetVersion | UUID, project/section, parent ID, SHA-256, dimensions, provider, content-addressed path | Insert only; accepting creates a decision, never rewrites source bytes |
| Region | UUID, source version ID, dimensions, top-left pixel coordinates, binary mask | Another source version requires a new region, even at equal dimensions |
| Job | UUID, project/section, original brief/project revision, optional source/region, provider, recipe version, instruction, reference IDs, settings, provider ID/usage/state/output IDs/error | Output attaches to original inputs and remains a candidate |
| Decision | Previous/chosen versions, reviewer, rationale, timestamp | Append only; expected-current selection prevents stale acceptance |
| Handoff | Project/brief revision, global styles, sections/text/overrides, accepted asset identities/checksums, unresolved exceptions | Read only; not a deployment or a complete developer export archive |

`schemaVersion: 1` is an experimental serialization boundary. SQLite `user_version=1` is separate
storage schema metadata. Consumers must coordinate incompatible changes before implementation.
Project/reference/direction JSON is trusted fixture input here; TypeScript alone is not a validator.
PNG/JPEG/WebP imports, malware/file limits and full schema validation belong at the service boundary.

The raster codec is deliberately tiny: UTF-8 JSON `{width,height,pixels}` with row-major 8-bit RGB,
three channels per pixel, at most 1,000,000 pixels. It is an offline test format, not an image-provider
format or a shipping image decoder. The 8x6 source includes a 2x2 corner mark outside a 12-pixel
selection. The raw candidate changes the entire image; strict compositing copies source channels
outside the binary selection. No edge blending or antialiasing is claimed. Geometry-changing output
is rejected. Masks and annotations are separate from source artwork.

## Jobs and uncertain outcomes

- Queued can become running, awaiting external result, failed or cancelled.
- Running/awaiting external result can become failed, cancelled or outcome unknown.
- Result collection succeeds only for running, awaiting external result or outcome unknown fixture
  jobs. Collection of native, OpenAI or ComfyUI results is explicitly unavailable in this spike.
- Succeeded, failed and cancelled are terminal. Duplicate completion is rejected, not merged.
- Restart turns running into outcome unknown. Awaiting external results remain awaiting; queued
  fixture jobs remain queued. No job is submitted or automatically retried on restart.
- Outcome unknown can collect a known result, fail or cancel; it cannot transition back to running.
  A live adapter will need durable reconciliation evidence before authorizing another charged call.
- A cancelled job's late output is rejected. Future native import UX must show this outcome rather
  than silently attach it elsewhere. Local cancellation makes no claim about remote cancellation/cost.
- Completing a late job preserves the original source/revision. It never changes an accepted asset.
  An explicit later decision may accept that candidate against the then-current selection.

Provider IDs, resolved settings and usage remain null when unavailable. Fixture outcomes have no
provider usage or billing evidence; app UUIDs are not provider IDs. No hidden native settings, seeds,
CFG, schedulers or subscription access are fabricated.

## Persistence, failure boundaries and recovery

SQLite stores identity rows with JSON snapshots in projects, assets, regions, jobs and decisions.
Foreign keys enforce owner/source identity where present; scope checks enforce section relationships.
WAL and FULL synchronous mode are enabled. Acceptance and result collection use `BEGIN IMMEDIATE`
transactions. The expected current accepted ID is checked inside the acceptance transaction.

Asset bytes are SHA-addressed. A temporary file is written and fsynced, renamed within the same
filesystem, and on Linux the asset directory fsynced before the metadata row is inserted. Temporary files
are reopened with a writable `r+` handle for fsync. Directory fsync is skipped on Windows; equivalent
directory durability and Windows behavior have not been verified. Existing bytes are
checksum-checked before reuse. A transaction failure can leave an orphan file; it creates no asset
row, accepted pointer or output record. The spike never deletes or adopts such orphans automatically.
Tests inject a DB failure after file creation and verify that retry safely reuses those bytes.
This is a failure-safe ordering, not a claim of one transaction spanning SQLite and the filesystem.
Sudden power loss and disk/controller behavior have not been benchmarked.

Reads and handoff creation verify asset checksums/dimensions. Missing or corrupt files fail visibly;
they are not replaced by fixture regeneration. Unknown DB schema versions are refused without
changing their version. No upgrade migration is implemented because there is only schema 1.
Before any migration, use a closed-store backup and verify restoration at the previous supported
version; introduce ordered migrations and fixtures with the first schema change.

For a backup: stop the service/close all Store connections and copy the entire private root, including
SQLite, any remaining WAL/SHM files, and assets. Restore to a new private folder with the same code
version, reopen, and verify all accepted checksums and decisions before editing. Automated online
backup, retention and a restore command are future workspace work; no backup/restore check is claimed
by this spike. Filesystem asset cleanup requires a separately reviewed, non-destructive inventory.

## Gates and bounded conclusion

Observed feasibility: small structured fixtures, immutable candidates, acceptance/version links,
region/source binding, strict binary preservation and interrupted-job recovery work in a local
SQLite/filesystem process. The exact commands and thresholds are in [verification.md](verification.md).
This does not establish usability, design quality, image integration or the complete website workflow.

The root product license remains an owner decision at redistribution/release; no LICENSE was selected.
`private: true` prevents accidental npm publication. Development dependencies report Apache-2.0 for
TypeScript/platform compiler and MIT for Node/undici types; runtime Node/SQLite notices require
review if redistributed. Synthetic fixtures were authored for tests and contain no third-party imagery.
The owner must choose terms for code and fixtures before a distributable release.

Live provider/model credentials, supported settings and a numeric monetary/run cap must be approved
before any chargeable check. Offline fixture budget is zero. Optional ComfyUI adds model/node/weight
license and measured hardware gates. None of these decisions blocks this offline feasibility spike.
