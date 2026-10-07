# Experimental shared foundation and legacy mapping

This describes executable contracts in this checkout, not a roadmap or canonical task status.
Website is the only implemented module. Everything runs offline with fictional briefs and authored
fixtures. There is no browser UI, visual renderer, live provider, semantic AI evaluation or deployment.
The existing spike is adapted in place rather than discarded.

## Ownership and boundary

| Owner | Code and responsibility |
|---|---|
| Shared kernel | `src/kernel/contracts.ts`: packets, context, artifacts, bundles/templates, capability/executor descriptors, ledger, metadata, semantic-verifier interface |
| Shared primitives | `src/kernel/primitives.ts` and `raster.ts`: immutable media identity, region, decision and job-state primitives, checksum/comparison/compositing functions |
| Kernel boundary | `gate.ts`: deterministic validation; `packets.ts`: canonical JSON/checksum/version lineage; `context.ts`: shared resolution |
| Generic persistence | `store.ts`: append packet versions and ledger events, explicit selections/acceptance, transaction rollback; `metadata.ts`: portable pointers and reconnection |
| Website module | `src/modules/website/design.ts`: Website design payload, relative exploration dimensions, deterministic candidate rounds; `src/modules/registry.ts`: only Website manifest |
| Executors | `src/kernel/capabilities.ts`: provider-neutral matching/stub; `src/executors/legacy-contracts.ts`: historical provider-specific job evidence, not a new domain dependency |
| Compatibility adapter | `src/modules/website/legacy-*`: original Website project/handoff/storage and explicit import; root `contracts.ts`, `raster.ts`, `store.ts` preserve old imports |

The Website implementation imports no provider SDK or specific provider contract. It requests
`design.explore`. Generic acceptance and decisions belong to the kernel. The old Store still has
section-specific behavior for compatibility; it is not the generic kernel. Legacy `sectionId` and
provider fields remain serialized historical evidence. Moving generic primitives out of Website
does not pretend that the old Website database was already a generic project ledger.

## Packets and context

`NodePacket<T>` carries schema/type/identity/version, project scope, context/dependency/asset pointers,
constraints, Placeholders, approval state, permissions, actor/source/previous-version provenance,
payload and a SHA-256 of canonical JSON. Canonicalization rejects undefined, non-finite values,
sparse arrays and non-JSON objects. `revise` creates the next version; Store never rewrites old packets.
These are experimental minimal v1 contracts, not frozen production or multi-module schemas.

Branded and Freeroam use the same `ModuleProject`, resolver and Website implementation. Branded may
mount a VisualOS; only accepted upstream packets with individually approved values can hydrate
inherited values. Freeroam rejects mounted VisualOS. Every resolved field keeps inherited/source,
local override, derived value, Placeholder, review flag and effective value separately. Precedence is
local override, then derived, then approved inherited value. Explicit unresolved review remains
visible even when an effective local value exists. The gate recomputes resolution against the exact
mounted source and rejects fabricated inheritance. Sparse context is valid; Website exploration
requires an explicit intent and retains missing palette/type/motion inputs as Placeholders.

A Placeholder includes expected input, reason, dependencies, what may proceed/what is blocked,
prohibited assumptions, and resolution routes. It is not an invented approved value. Local acceptance
records a ledger decision and selected pointer; it does not promote a proposal or change VisualOS.
Approval fields are trusted fixture/operator input, not cryptographic attestations. Permissions are
checked against supplied local grants; no production identity or remote authorization is implemented.

## Website exploration and execution

`DesignArtifact<WebsiteDesignState>` represents Website design itself: site/page/landing-page/section/
component/media scope, intent, thesis, section order, parameters, exploratory dimensions and unresolved
inputs. The synthetic generator exercises landing-page state. It is a data proposal, not rendered
HTML, a generated image, a complete site editor, or designer-approved visual work.

The broad fixture has nine distinct coherent parameter combinations across Structural, Spatial,
Styling and Dynamics. Relative values are exploration controls, not quality/commercial scores.
Every candidate shares known intent/content/palette locks. A bundle records base state, inherited/
locked/exploring/Placeholder state, variation amplitude, candidate refs, selection, capabilities and
execution refs. Human selection creates a new bundle version. A three-candidate refinement uses the
selected artifact's dimension vector as its center, narrows amplitude from 0.6 to 0.2 and keeps its
base pointer. The bounded synthetic generator supports 1–9 candidates; generic bundles allow 1–16.

`BundleTemplate` serializes scope, required context, preservation paths, dimensions, count, strategy
and capability IDs. The gate rejects undeclared fields such as provider prompts. Modules request
capability ID/input/output contracts; registry resolution separately selects an available cloud,
local, Chinvat, deterministic or human executor. Only deterministic design and manual image routes
are marked available in fixtures. Cloud/local/Chinvat records are unconfigured and unavailable.
No executor is submitted, no Chinvat connection is made, and unknown settings remain null.
`ExecutionRecord` separates requested capability from observed executor ID/settings/outcome evidence.
The semantic verifier stub reports `not-run`; it cannot supply semantic acceptance.

## Deterministic gate

Writes check packet/port type and schema; runtime nested shape and required inputs; initial/revision
lineage; mounted context origins; implemented module and project ownership; reference existence,
project scope and optional current-version freshness; asset availability/hash; permission grants;
packet integrity; candidate membership/count/scope and shared locks; and explicit preservation paths.
Pinned dependencies allow historical input reconstruction. Current dependencies fail when upstream
versions advance. `reviewChanges` reports changed declared paths for human review; it is a separate
invalidation finding, not automated semantic gating. Consumers must use explicit port preservation
and review policies; arbitrary downstream graph invalidation is not implemented.

All writes enter the gate. Reads verify identity and packet checksum. Acceptance revalidates the
stored artifact and any associated bundle inside the acceptance transaction, before event/pointer
writes. This rechecks their declared dependency/context/base/candidate freshness, schema, ownership,
assets, constraints and integrity. Revalidation uses the stored version's own predecessor for lineage,
so deliberately pinned inputs and older immutable artifact revisions remain usable. It neither inserts
a new packet nor recursively invalidates all historical nodes. Associated bundles must still be the
latest selected bundle and identify the accepted candidate. This is a trusted local-process
spike, not a hostile-input service: it has no HTTP parser, limits/auth layer, sandboxed plugin loader,
transactional external job executor, general graph scheduler or comprehensive JSON Schema ecosystem.

## Persistence, import and rollback

The original `workspace.sqlite` schema 1 and content-addressed RGB assets remain readable. The generic
store uses additive `kernel.sqlite` schema 1 in the same root, WAL and FULL synchronous SQLite mode.
Packet/event rows are append-only through the API. The selected pointer changes only in an explicit
acceptance transaction with expected-current comparison. Bundle selection versions and acceptance
ledger writes are atomic; injected database failures leave packet/ledger/selected state unchanged.
External asset bytes remain in the legacy filesystem store; generic asset checks are supplied by an
adapter. The generic kernel does not implement a second decoder or claim full storage unification.

`importLegacyWebsite` is an explicit audited snapshot into a new Freeroam project and a proposed
`legacy-snapshot` design artifact. It verifies every asset and retains original project/brief,
references/directions/sections, all asset parents/checksums, regions, jobs and decisions verbatim in
historical adapter payload. It creates a legacy-import ledger event in one transaction. It does not
rewrite old data, install a VisualOS or turn old selected IDs into newly accepted kernel pointers.
Repeated import is rejected. Corrupt assets fail import/acceptance; no silent regeneration occurs.
This is an additive snapshot mapping, not ongoing synchronization or an upgrade of every legacy
record into a fully generic operation. Full unification is deferred.

Portable `ArtifactMetadata` includes only schema, artifact/project/VisualOS/bundle refs, ledger-project
pointer and artifact integrity. Reconnection reports available/missing pointers and suggests the
prior VisualOS with `requiresExplicitMount: true`; it never changes a project mode or hydrates context.
Unavailable references are valid portable pointers, not locally executable dependencies. One shared
metadata validator is used by construction, ContractGate import and reconnect. The builder validates
its known artifact/project arguments and accepts an optional lookup for known bundle/VisualOS objects;
local-store callers supply that lookup. Known pointers must match identity/schema/type/checksum,
artifact owner/module, project identity, ledger-project ID and bundle owner/project/artifact relation.
A non-null metadata envelope owner must match its project pointer. A bundle can identify the artifact
as a candidate or base state; selecting a candidate does not approve the metadata itself. Ledger and
project IDs must agree even when all objects are missing. Partial/absent portable objects remain
unresolved and are checked again when available. VisualOS remains an explicit mount suggestion.

Close all stores before backup; copy the full root including database/WAL/SHM and assets. Revert the
unmerged adaptation to `075dc6fec513b8eb61f287d8dac342871742137e` for the legacy implementation. Keep
`kernel.sqlite` intact as a separate checkpoint or discard only a disposable fixture copy. Old data
is unchanged, and old code ignores the sidecar. Do not open a future storage schema with an older
kernel; restore from a verified closed-store backup instead. No online backup, power-loss durability
experiment, concurrent-writer test or automatic destructive migration is claimed.

## Platform correction and evidence boundary

Asset file fsync now opens the temporary file with `r+`, allowing a writable handle. Directory fsync
still propagates errors on Linux; on Windows it is explicitly skipped because this implementation
has no equivalent directory durability path. That is a stated durability limitation, not swallowed
Linux errors or proof of Windows support. Child scripts use `fileURLToPath`, and a test copies the
checkout into a path containing spaces, then runs the complete legacy suite and restart checks.

The repair implementation is exercised on Linux x64, Node 24.19.0. These repairs were not run
on Windows; directory crash durability there remains unverified. The earlier Windows failure
on Node 24.16.0 cannot establish the declared baseline's outcome. Pure pixel preservation evidence
is retained and extended with 48 single-pixel masks and 6,912 channel assertions. Technical commands,
new invariant coverage and independent-review requirements are in [verification.md](verification.md).
A CI workflow reproduces only offline Linux checks; passing implementer commands or CI cannot replace
independent review against the canonical assignment or human design acceptance.
