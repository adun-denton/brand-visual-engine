# Manual account-native exchange

This adapter exports a frozen raster request and imports original image bytes. BVE does not invoke
ChatGPT, an image model, MCP, or another provider. Preparing a request does not grant an invocation.
An explicit manual grant names 1–6 slots; Export request reserves **one** slot before returning its
executable package. Each subsequent slot requires another explicit export. There is no next-slot loop.

Both review layouts contain Export request / Import result under the manual exchange panel, available
with auxiliary chat closed. Choose a frozen specification, exact dimensions, slots, grant lifetime and
provenance class; prepare the grant; then export a slot. Preparing, exporting, reporting a claim,
importing, selecting, saving to Library and accepting remain separate actions.

## Adapter boundary

`NativeExchangeAdapter.readRequest(manifestBytes, fileMap)` reads `bve-native-request` V1. The outbox is
an authored deterministic ustar containing `manifest.json` and ordered content-addressed originals.
The JSON contains the exact accepted ExecutionRequest V1, source roles/versions/hashes/rights/notes,
Direction, optional Brand, tool-neutral prompt/instructions and a canonical SHA-256 packet digest.
It binds project/work unit/spec/request/grant/execution/slot/submission/exchange-job identities.
Neither a digest echo nor a BVE exchange-job ID authenticates a host or proves generation.

`NativeExchangeAdapter.readResult(manifestBytes, fileMap)` reads `bve-native-result` V1 and fully decodes
the original PNG/JPEG/WebP. The production importer accepts a manifest plus original upload bytes;
it does **not** accept/extract archives, filesystem paths, links, model-transcribed base64 or URLs.
The local HTTP upload encodes browser-read file bytes to preserve them unchanged. It does not use a
model to transcribe or reconstruct the image. Bounds: 256 KiB manifest, 8 MiB each image, 16 million
pixels, 8192 pixels per edge, 39 MiB aggregate originals and the retained 40 MiB generated archive bound.
Duplicate entries, missing/extra files, unsafe paths, corrupt images, descriptor/hash mismatch and
source substitution reject. Output width and height must exactly match the frozen request. No resize,
conversion or host-selected-size relaxation is implemented. Live exact-size compatibility is unresolved.

Result manifest shape (see the typed contracts and synthetic example for exact populated values):

```ts
{
  version: 1, kind: "bve-native-result", binding: request.binding,
  packetDigest: request.packetDigest, receiptId: "host-return-identity",
  origin: "imported", outcome: "returned", // or failed with output:null
  output: { path: "assets/<original-sha256>.png", image: originalDescriptor },
  rights: "Operator-stated rights", message: "Operator-stated return",
  attestation: {
    kind: "operator-attested-native", verification: "operator-attestation-only",
    hostInvocationId: null, model: null, seed: null, usage: null, cost: null,
    providerId: null, statement: "Explicit operator attestation"
  }
}
```

Unknown fields remain null. Actually reported host invocation IDs are separate from the BVE job ID.
`synthetic-fixture` grants/results stay visibly synthetic and cannot supply real host/model/seed/usage/
cost/provider evidence or change to operator-native provenance. All pilot raster candidates have
**imported** origin. The accepted generated-origin rejection remains unchanged. Machine-verified native
generation is not an available provenance class.

## Durable authority, history and recovery

Three new work kinds (`native-exchange-grant`, `native-exchange`, `native-exchange-receipt`) use V2 state
and the versioned `account-native-exchange / 1 / manual-exchange` adapter. They share existing kernel
packets/events/transactions; no allowance database or schema migration is added. Accepted V1 parsers,
records, hashes, synthetic labels, replay behavior and legacy native paths remain unchanged. The new
controller alone can persist these work kinds; stored records still revalidate through the kernel gate.

Grant, release and claim are distinct. A released slot is `awaiting-operator`; the explicit claim/report
returns immediately with an owned acknowledgment and changes it to `claimed`. The report is operator
attestation, not verified invocation evidence. The host instructions require a successful claim before
using its native tool. Re-download reconstructs the exact same package and consumes no new slot;
repeated claims reject. **BVE cannot physically prevent an operator invoking downloaded inputs twice.**
Receipt accounting does not claim that it can. A claim that timed out at the HTTP boundary may already
have committed; it is never automatically retried. Refresh/reopen read saved progress only.

No remote status/cancel transport exists, so this adapter grants zero such calls. The retained bounds
are at most 30 seconds for a future transport call; no call waits for a human/model. Local withdrawal
before a reported claim is `withdrawn`. Cancellation after a possible reported invocation records
intent with `uncertain` outcome; it makes no termination/billing claim. Revoke blocks future claims.
Operator-marked uncertainty and all consumed slots never restore an allowance. A failed/withdrawn/
uncertain attempt requires a new explicit grant for manual retry, with exact parent revision/slot.
A stale frozen request requires new current preparation rather than guessed authority.

Canonical revision inventory is checked before admission and inside writes. Missing/corrupt latest or
historical rows cannot be treated as zero consumption. Unknown loss conservatively blocks this
project's manual exchange; recovery is separate work. Sources, selections, work unit, project and
included Brand heads are checked before release/claim, again transactionally after awaited preparation.

Cancelled, uncertain, expired, revoked or stale returns require the explicit historical intake option.
They retain exact original media and a historical receipt without current candidate membership or
acceptance. Missing return evidence never authorizes another invocation. Current import writes media,
imported raster candidate, membership, owned receipt and run transition in **one** kernel transaction;
it never calls `importCandidate` followed by a separate lineage write. Full decode/dimension failure
rejects the whole slot intake with no invalid-success receipt. Earlier valid slots remain intact.
Identical receipt replay is read-only; conflicting payloads reject.

Content-addressed original files are durably saved before the database transaction. A failed write can
leave an unassociated original, never visible partial membership/receipt/success. Retry of the **same
received evidence** revalidates and recovers that orphan without invocation or a new grant. Cold reopen
sends nothing. No polling, retries, triggers, provider substitution or claim restoration is scheduled.

## Memory, Library and exports

Complete memory inventories, evidence reads and immutable capsules include new run/release/receipt
records. Grant projections remain informational; exporting a capsule confers no execution authority.
Library items retain imported origin and exact media. For native-origin evidence, raster package export
adds a versioned `exchange-evidence.json` with exact request/grant/execution/receipt packets, attestation
and original source files. The V1 raster manifest and original image bytes remain unchanged; existing
non-native packages remain byte-identical. New evidence is a sidecar, never a design-artifact dependency.
Missing ledger-known native export evidence fails closed rather than silently dropping provenance.

## Repeatable offline review

### Selected-slot import and portable return kit (R1–R2)

Import commands require `run` and `slot` from the chosen form. Old ambiguous HTTP commands without a
slot reject. Internal intake's final argument is the independently selected slot. The service checks
owned run/project and slot before original decoding, saving or receipt replay. A manifest for another
slot cannot redirect the action even when its identical receipt already exists. Full frozen binding,
digest, provenance and atomic media/candidate/membership/receipt/run admission remain.

Frozen V1 `manifest.json`, `nativeInstructions`, packet digests and `native-request.tar` are unchanged.
After **Export request**, choose that slot's **Export return kit**. This separate additive, deterministic
archive includes the same manifest and exact sources plus `kit.json`, `RETURN.md`,
`result-schema-v1.json`, bound `returned-template-v1.json` and `failed-template-v1.json`, and
`build-return.mjs`. It is available for old released jobs, including historical evidence. Exporting it
reads existing authority and never reserves, claims, dispatches or grants another attempt.

Give the receiving session the entire return kit and explicit operator instructions. The operator
mediates BVE's manual claim/report step and conveys approval before one invocation. There is no presumed
connection from the receiving session to BVE. Stop on denial/withdrawal/expiry/uncertainty; never retry
the claim or call an unconfigured service. The kit itself performs no generation or transport.

The kit documents Node24.19.x with standard locked `sharp`0.35.5 and `ajv`8.20.0 available to its builder.
Use an existing offline tooling environment; no provider install is involved. Copy the appropriate
template to `filled.json`, fill receipt ID, rights, attestation statement and message truthfully, then
run the included builder with an actual original file (omit it for failed outcomes):

```sh
node build-return.mjs filled.json return-directory /absolute/path/to/original.png
node build-return.mjs filled-failed.json failed-return-directory
```

The builder hashes actual original bytes, records buffer length and fully decoded PNG/JPEG/WebP format
and encoded dimensions, then copies the unchanged file under its checksum name. It validates the bound
schema, strict requested dimensions, image limits and source substitution before writing the return.
The schema and instructions also state relational descriptor/hash/path invariants independently checked
by production intake. No resizing, conversion, model-transcribed metadata/base64 or URL fetching.

Upload `result.json` and its named original through the matching run/slot form. Receipt IDs identify one
return under its exchange job: exact replay is read-only; changed payload conflicts; another receipt
gives no invocation authority. Origin stays imported. Synthetic and operator-attested classes cannot
be interchanged; machine verification is never asserted. Unknown actual host/model/seed/usage/cost/
provider facts stay null. Late evidence needs the explicit historical option and confers no current
membership or acceptance. Consumer/schema success proves offline portability, not live host support.

The repair consumer extracts only generated kit names into a fresh temporary directory, makes standard
installed dependencies available, and constructs returns using only kit templates/builder and authored
originals. It does not use `nativeReturn`, internal result types/parser or server source to construct the
result. Production intake independently validates generation-shaped and exact-source refinement-shaped
returns, then checks cold reopen, memory and original/package exports.

```sh
npm ci --ignore-scripts
npm run typecheck
npm run build
node --test tests/native-exchange.test.ts
npm run test:native:compatibility
npm run test:native:repair-compatibility
node --test tests/native-exchange-repair.test.ts
npm run test:browser:native
```

The compatibility command archives exact accepted V08 `87c9484e83a12b570d632fbbe1c2e070a36a3319`, seeds
credential-free V1 raster/semantic/reconstruction/auxiliary records and receipts, closes and copies the
whole root, compares logical rows and original bytes, adds native evidence through the adapter, then
cold-reopens with zero dispatch. `BVE_EVIDENCE_DIR` selects a disposable output location. It includes
small authored outbox/return fixtures and complete closed-copy inventories. No actual root is read.

The new unit controls exercise positive creation/refinement, count six/manual continuation, exact-byte
export, unknown provenance, claim/replay/conflict ownership, every binding negative, malformed second
slot, decode/size/path/dimension failures, crash before/after release, cancellation/uncertainty/revoke/
expiry/staleness, lost allowance evidence, file and every database insertion failure, historical intake,
HTTP origin/token checks, manual retry/new authority, cold reopen, memory and Library package export.
Retained parser, compatibility, original V07/V08 probes, 17 browser gates and offline account permission/
protocol checks stay in CI, alongside the new compatibility and browser checks on Windows and Linux.

Offline success proves workflow and authority, not native generation, fidelity, automated communication
or designer usefulness. Native host placement and original-byte delivery/retrieval are unselected and
untried. No account/model/image/GPU trial, image-provider install, real-root migration, live MCP,
merge or deployment is part of this slice. Rollback uses isolated code plus the complete matching closed
synthetic root; never downgrade an evolved real root. Independent review owns code acceptance and
Task003/015 disposition.
