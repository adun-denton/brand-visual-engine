# Local capability providers

This checkout adds explicit server-side image generation/editing and a separate text/vision assistant.
The implementation has offline transport and browser evidence. Live account/model availability,
actual usage/billing and image quality remain unverified; no credential is needed for ordinary checks.
Native export/import remains a distinct manual path with its original manifests and null hidden metadata.

## Configuration and current evidence

Official sources rechecked **2026-10-08**:

| Contract | Source and implementation choice |
|---|---|
| Image endpoints | [Image guide](https://developers.openai.com/api/docs/guides/image-generation), [generation reference](https://developers.openai.com/api/reference/resources/images/methods/generate), [edit reference](https://developers.openai.com/api/reference/resources/images/methods/edit): direct `/v1/images/generations` JSON and `/v1/images/edits` multipart, one base64 result; no remote conversation store |
| Image model | [Sunburst](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst); the endpoint references list `gpt-image-2.5-sunburst-2026-09-08` and `gpt-image-2.5-flare-2026-09-08`. Default Sunburst; both explicit dated IDs supported by this bounded recipe |
| Assistant | [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [Responses reference](https://developers.openai.com/api/reference/typescript/resources/responses/methods/create), [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs): requested `gpt-6-luna`, documented alias rather than an invented dated snapshot; strict JSON Schema plus application validation, no tools, `store: false`, 2,000 output tokens maximum |
| Pricing | [Pricing](https://developers.openai.com/api/docs/pricing): standard image text input $5 / image input $8 / image output $30 per million tokens. Luna standard short-context input $0.05 / output $0.25 per million tokens. These rates and output-only estimates are **not a total-request dollar upper bound**; inputs, account and pricing must be checked again before live approval |
| SDK | [Official Node SDK release](https://github.com/openai/openai-node/releases/tag/v7.30.0) checked. No SDK or new dependency introduced: Node 24 native fetch/FormData, one transport call with redirects rejected and no automatic retry |

Recipe `website-api-v1-2026-10-08` deliberately supports three explicit sizes (1024 square, 1536×1024,
1024×1536), low/medium/high quality, one opaque PNG. Broader documented size/quality/background options
are excluded from this recipe. No mask, CFG, seed, fidelity slider, exact compositing or remote cancellation
claim is exposed. Original decoded dimensions and checksum are retained; provider-reported settings/model
and request/result IDs are separate from requested settings/app attempt IDs. Absent fields and billing
stay null. Available usage is numeric evidence, not a billing receipt.

Configure `OPENAI_API_KEY` only in the server environment or a private environment file outside Git.
Set `BVE_IMAGE_MODEL`, `BVE_ASSISTANT_MODEL` independently. `.env.example` contains no secret.
Node can start the server with `node --env-file=/private/operator.env scripts/dev.ts` after building;
it does not automatically load a checkout `.env`. The browser receives configured/authorized flags,
model choices and bounded run status; it receives no credentials or filesystem path.

`BVE_PROVIDER_POLICY_FILE` names a private JSON file. An empty path disables chargeable submission even
if a key exists. A documentation listing or configured credential does not establish account access.
Production does not expose the fixture transport through environment variables or HTTP.

## Explicit run approval and spending

The operator must approve allowed models, synthetic input, maximum calls and controls, reservation
amount/cap, credential source and stop rules **before** configuring a live policy. This documentation is
not approval. Do not paste keys into chat, fixtures, logs or public PRs.

The policy has `runId`, `approval` (a private approval evidence reference), `maxCalls`, `capUSD`,
`reserveUSD`, `models`, and `alternativeCallBoundApproved: true`. Positive limits are required; at most
100 calls and $1,000 reservation cap are supported by the parser. Choose substantially smaller review
limits. One run ID identifies one immutable policy; changing its limits/models cannot reset the store.
The run is shared across projects in the same private root. A server-side policy file is trusted operator
configuration, not a cryptographic approval/billing system.

`capUSD` is explicitly a **reservation cap**. This recipe cannot prove a strict total-charge ceiling from
current token pricing, so it refuses a policy unless the operator explicitly approves an alternative
bounded-call run. Reserve a conservative operator-approved amount before transport. If only a strict
dollar upper bound is authorized, leave submission disabled and return that gap; do not assert that an
output-price estimate guarantees the whole bill. The UI describes this distinction before submission.

An atomic SQLite packet group records the reservation and submission claim. A call is consumed once
claimed, even if pre-send validation fails; the verified pre-send failure may release money reserved,
but never restores the call count. Returned, refused, rate-limited, failed and uncertain requests retain
reservations because this application does not receive authoritative no-charge/billing evidence.
Restart never clears call usage or reservations. A locally cancelled or uncertain reserved attempt blocks
new submission until explicit reconciliation. Human reconciliation either retains that reservation with
an evidence/review reason, or releases it only after explicit verified no-charge evidence. Original job,
observations and outputs stay immutable. A reconciled attempt is never resubmitted; prepare a distinct
new attempt within the remaining approved bound. No remote retrieval is implemented for these synchronous
operations; inspect provider records independently.

A concrete future review plan is one assistant request, one generation, one edit using the returned
image plus a chosen synthetic reference; one result, 1024×1024, low quality, 2,000 assistant output-token
limit, no retries. Compare with an authored native-path fixture, explicitly accept, download/check hashes,
then restart/read back all bindings. Stop on uncertain outcome, account/model mismatch, exhausted bound,
unexpected settings or unapproved input. This is a proposed three-call plan, **not an approved budget**.
Live verification must be separately authorized and performed through the app. Ordinary CI, browser
checks, startup and offline tests never perform it.

## Records and consumption boundaries

Provider-neutral Website payloads describe operations, immutable inputs, candidate lineage, proposals and
comparisons. The service selects the separately configured executor through shared capability resolution;
Website validation contains no OpenAI-specific model allowlist or network API. Six additive artifact kinds
are introduced: `website-provider-job`, `website-api-image`, `website-assistant-proposal`,
`website-assistant-review`, `website-image-comparison`, `website-provider-budget`. No database/schema
migration or existing native kind reinterpretation occurs.

The request and app ID persist while queued, before an explicit second submission action. Competing
claims use the same kernel versions and only one packet group commits. Lifecycle is queued, submitting,
running, returned, failed, cancelled locally or outcome uncertain. On process restart submitting/running
becomes uncertain; no transport is invoked. Local abort cannot prove remote cancellation/no charge.
Definite HTTP rejection, rate limit, refusal, timeout/transport ambiguity, bounded schema/image rejection
and storage failure are separately recorded with safe actionable text. Raw provider errors, private paths
and credentials are not logged or returned. If the outcome write itself cannot commit, further submissions
are disabled in that process; the persisted running attempt/reservation survives for restart recovery.

Inputs are the pinned selected brief/context/design and explicitly selected reference snapshots, with
original checksum, role, scope and version. Generation takes text only; use editing to send original image
bytes and chosen reference images. Assistant gets the brief and chosen references, not MSB or other projects.
No arbitrary browser URLs, paths or remote tools are accepted. The existing loopback/Host/Origin/session-token
boundary covers every new endpoint under `/api/v1/provider/`.

Construction validates current ownership/source types; consumption rechecks project/type, immutable request,
original assets/settings, reference roles/versions, source proposal and output bindings. API candidates use
the shared bounded decoder/content-addressed asset store, with truthful API origin rather than manual-import
provenance. Native jobs can explicitly take an API image as a new input; earlier native manifests stay intact.
Shared kernel transactional acceptance still checks dependency/context integrity and expected current pointer.
API acceptance also requires a recorded eligible output, correct section and explicit historical review when
inputs are late. No provider result automatically selects or accepts work.

The assistant cannot return a trusted reviewed flag or select source pointers. Those pointers are fixed by
the application. A separate human edit/review artifact references the raw unreviewed proposal and records
rationale, uncertainty, actor and reason. Stale/cancelled proposals cannot be reviewed as current. This
records a Website proposal; it never mounts, approves or promotes a VisualOS.

Completed assistant responses may contain documented reasoning metadata followed by one final assistant
message. The adapter validates these item types and reads only that message's single proposal text or
refusal. Empty/nonempty reasoning summaries and opaque encrypted metadata are tolerated and discarded;
they never become proposal text, persisted reasoning or instructions. Tool/unknown output items, multiple
messages, non-final messages and mixed/malformed content fail the contract. Proposal schema checks,
safe usage/request/result IDs, one transport call and distinct human review remain unchanged. See the
[official reasoning response example](https://developers.openai.com/api/docs/guides/reasoning).

Image comparison requires two distinct owned image candidates for one section; saved selection/reason and
original paths survive reopening. Image acceptance is a separate explicit action with a reason. Switching
providers preserves briefs, references, accepted work and append-only history.

## Offline verification and recovery

Run retained locked-install/types/100-test/build/smoke/fixture checks documented in [verification](verification.md),
then both browser scripts. The provider script launches a **test-only injected transport** in a separate
process, with authored labeled images; it records four simulated calls and **zero real provider calls**.
It is not a provider account/quality/usage/cost test. Test-only execution provenance is
`api-transport-fixture`; production requests record `openai-api`. Screenshots identify fixture mode.

The fixture uses a private parent/child IPC channel to acknowledge startup and graceful shutdown. It
closes the providers and both stores before acknowledging the actual in-memory transport count; the
parent awaits child and stdio completion before copying the root or writing its final receipt. Three
acknowledged counts must be exactly `[0, 4, 0]`, with zero real calls. Forced termination is bounded failure
cleanup and cannot yield passing evidence. This avoids the documented Windows behavior of
[child-process signals](https://nodejs.org/api/child_process.html#subprocesskillsignal). There are no
fixture transport/control routes in the production service. Windows and Linux CI run both browser scripts
and retain their final JSON receipts and screenshots as workflow artifacts.

`docs/evidence/provider-browser-check.json` and `providers-*.png` contain public-safe technical inspection.
Desktop 1440×1000 and mobile 390×844 include focused captures of assistant/comparison/outcome regions.
Browser evidence covers unconfigured controls, stale-request errors, edited review, native/API alternatives,
explicit selection/acceptance, original download SHA-256, rate limit, focus, overflow and new-process restart.
Retained browser verification covers invalid native import/corrected upload, JPEG/WebP original bytes,
Branded/Freeroam isolation and earlier history. Technical inspection is not independent or designer acceptance.

Stop the service and close **both** SQLite stores before copying the full private root, including assets,
WAL/SHM, quarantine, private exports and matching code. Use a new disposable root for recovery checks;
never the only operator copy. Reservations/jobs are in `kernel.sqlite`, images in the existing
`native-assets/`; no third database or cloud project store exists. Preserve original `workspace.sqlite`
and legacy assets. An unmerged PR or a scoped revert rolls back code while keeping the new root untouched
for matching-code restoration. Older code cannot consume the new artifact kinds; restore a verified
closed whole-root backup with its matching version. Do not force-push or delete accepted state.
Windows directory crash/power-loss durability, production security, hosted auth and live providers remain
unverified. Main/release/deployment and canonical acceptance are outside this implementation return.
