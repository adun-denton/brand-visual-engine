# Raster execution orchestration

V03 adds bounded, provider-neutral execution plumbing to the visual workspace. Production has no
connected executor. Preparing/selecting/tuning never authorizes a call. The offline fixture is injected
programmatically by tests; ordinary HTTP, browser inputs, environment settings and production launchers
cannot select it. Fixture output proves interaction and persistence only, not image generation.

## Records and compatibility

Four version-1 semantic work records live in the existing kernel packet/event tables:

| Kind | Binding and purpose |
|---|---|
| `raster-execution-request` | Immutable compilation of exact V01 specification reference/integrity, dimensions, attempts, included source/media/rights/notes, facts, constraints, Direction, separate Brand and requested metrics |
| `raster-execution-grant` | Explicit project-owned request/spec hashes, adapter identity/version, selected slots, submission/status/cancellation allowances, timeout and expiry; only monotonic revocation may revise it |
| `raster-execution` | One deterministic identity per grant; immutable request/grant/retry lineage; append-only call accounting, exact submission/job identities, independent per-slot outcomes and cancellation intent/confirmation |
| `raster-execution-receipt` | Immutable receipt identity/payload hash, exact run revision/slot/submission/job lineage, independently validated result, observed transport metadata and visibly offline provenance |

The bundle-bound kernel `execution-record` remains unchanged. Image exploration does not fabricate an
iteration bundle. V01 specs retain null execution authorization and its batches retain
`synthetic-registration`, remain valid, immutable in meaning and non-executable. V03 request/grant
records bind them without changing them. Raster candidates use the existing synthetic-origin contract;
`generated` remains rejected. Media, memberships, ledger revisions, SQLite transactions and exact
closure use existing stores. No schema/dependency/lock migration, parallel database, in-place rewrite,
accepted-pointer change or legacy export change is introduced.

Requests contain only frozen inputs, never mutable latest values, project history or chat. A fresh
inspiration whose style/content are both excluded contributes no transport source or attached notes;
excluded resources are omitted. Included source bytes/rights are revalidated before compilation and
submission. The original specification dependency retains the complete audit closure. Dimensions are
explicit inputs, not product defaults. Requested and observed settings remain distinct; fixture receipts
never populate inferred/observed visual characteristics or brand rules.

## Transport and authority

`ExecutionTransport` describes versioned identity/capabilities, `submit`, bounded `status` and owned-job
`cancel`. Inputs are frozen request JSON and closed raster buffers; no client URL/model/executable is
accepted. `OfflineExecutionInjection` is test-only, with `offline-test` identity; this slice rejects a real
transport. The fixture implementation resides in `scripts/`, outside production imports/bundles.

Unsupported operation/dimensions, missing closures, wrong request/project/adapter or unsupported
style/content/region influence fail before a reservation. Exact preservation execution is unavailable
and rejected, preserving V01 predicates without pretending fixture behavior implements them. The
capability descriptor claims only test acceptance of inputs, not image editing or model usefulness.

Grants explicitly enumerate 1–6 distinct attempt slots; maximum submits equals those slots. Status
allowance is independently 0–24, cancellation allowance 0–6 and timeout 1–30000 ms per call. These are
implementation hard bounds, not selected defaults. Production cannot grant execution while disconnected.
Expiry, revocation, hash/adapter binding and capability support are checked before every transport call.
Read-only provider reconciliation and cancellation still consume their separate allowance; expired or
revoked grants block those calls too. Local cancellation intent is saved first even if no remaining
cancellation allowance or valid grant permits provider confirmation. This distinction stays visible.

## State and recovery

Each run starts with pending slots. A synchronous transaction records a submit reservation and exact
submission identity before a transport call. A second durable transition marks running before send.
Only that active invocation can submit the reserved slot; restart never treats reservation as permission
to send. Slots execute serially. The loop can consume the explicitly granted pending slots when earlier
ones return immediately; a running or unresolved uncertain slot stops it. No automatic polls, retries,
continuation after a crash, or fallback occur. Execute again cannot submit a consumed slot.

A transport exception/timeout after possible send becomes uncertain. If a storage failure prevents the
transition, the last durable reserved/running state projects as uncertain once no local invocation owns
it. `recover-execution` makes that conservative state durable. Recovery queries only the recorded
submission identity and, when known, exact job identity. A status response cannot replace a known job ID.
Unknown/failed status retains uncertainty. Calls are charged against allowances before invocation;
exceptions/timeouts never replenish them or prove no charge. Accounting is call/attempt accounting, not
billing or real usage evidence.

Cancellation can target one owned slot or one run; pending targets become locally cancelled, sent
targets retain uncertainty until confirmation. Intent and provider confirmation are separate monotonic
fields. It never dispatches cancellation for unrelated runs/jobs. Revocation blocks undispatched slots.
Already sent work can return, including after cancellation. There is no claim of killing GPU execution.

Manual retry requires a new explicit grant and a new run whose `retryOf` binds the consumed parent
revision/slot. It reuses the same immutable request and retries only that slot. The UI clears call
allowances when preparing a retry; choosing retry performs no dispatch. Uncertain original work may
still return, so its historical evidence is retained separately.

## Intake and projection

Each result validates the exact envelope before media validation. Identical receipt replay returns the
original receipt without new writes; conflicting identity/payload rejects. Raster bytes must fully decode
within existing byte/pixel limits and match requested dimensions. Malformed media becomes an invalid
receipt for that slot while valid neighbors remain. Explicit failure retains a failed receipt.

Valid current output commits media, synthetic candidate, work-unit membership, receipt and run
transition in one existing kernel transaction. Asset bytes use existing content-addressed durable writes;
a database rollback can leave an unassociated asset file, never a partially visible candidate/receipt.
Storage errors propagate independently of malformed output and leave the slot recoverable without a
fabricated invalid-result receipt. Retry intake uses the same receipt identity.

Cancelled/uncertain or stale input output remains historical reference media and does not join page
membership. Appending any candidate never selects, accepts or overwrites current choices. Result
intake has no hidden acceptance. Both layouts show synthetic execution grouping, per-slot states and
accounting; explicit grant/Execute/reconcile/cancel/revoke/manual retry use the same protected visual
controller paths tested by browsers. Without an executor, Execute is disabled with a truthful explanation.
No asynchronous transport can create designer approval or actual generation evidence.

## Deferred local binding

Future local binding points are the capability descriptor, translation of the immutable request and
included source buffers, ownership-preserving submit ID/job ID mapping, status/result reconciliation,
cancellation confirmation, observed settings and exact-preservation support. No ComfyUI workflow/model,
real capability truth, resource/performance limit or provider behavior is invented here.

Proposed inactive local matrix (do not run under this packet): inventory installed runtime/workflows;
review operation/dimension/source/lock support; verify credentials/transport provenance and explicit
limits; then separately authorize count-1 and count-6 jobs, source version/rights closure, interruption
before/after send, unknown-job discovery, cancellation races/late bytes, result integrity and usage,
restore and latency/resource measurements. Real generation and designer judgment are separate gates.

Rollback uses a separate checkout at accepted V02 and a complete closed runtime that matches that code.
Do not downgrade evolved roots in place or selectively delete records/media/history.
