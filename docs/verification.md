# Verification and designer review

Use Node 24.19.0 on Linux x64 for the exercised baseline. From a clean checkout:

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run smoke
npm run smoke:design-os
git diff --check
```

Typechecking uses the lockfile. Runtime tests use Node's test runner and fresh temporary SQLite/asset
folders; they make no network requests. The smoke command also cleans up its temporary root.
Dependency installation requires npm access or a populated local cache. These commands do not start
an application server, a browser or a provider. Record runtime/platform, exact commit and observed
counts in the result report; a passing fixture does not imply designer/provider acceptance.

## Technical checks

| Property | Fixture/procedure | Measurable acceptance |
|---|---|---|
| Standalone inputs | Fictional brief, hero/services/proof/contact, two authored SVGs, two RGB rasters, region/outcome fixtures | All four ordered sections and paths present; no client dependency; proposals remain proposals |
| Immutable provenance | Accept original, collect/accept child, read original again | Original bytes unchanged; child parent exactly original ID; two decision records |
| Outside-region preservation | Whole-image changed candidate plus strict binary mask composite | Zero changed RGB channels outside mask; selected channels change; corner mark unchanged |
| Region validity | Wrong-sized/empty/nonbinary mask, different-version region, geometry-changed candidate | Every invalid association/geometry rejected before acceptance |
| Section consistency | Accept a hero candidate while another section is accepted | Other sections and global style byte-equivalent; explicit style overrides flagged for review |
| Late work and stale acceptance | Start job on original; accept newer asset; collect late result | Late child retains original parent; newer selection unchanged; stale expected-current decision rejected |
| Explicit outcomes | Deterministic success/failure/unknown/cancelled cases | State equals fixture outcome; only success has output; none auto-accepts; usage remains unknown |
| Failure/retry | Inject DB insert failure after asset file write | Job/output/accepted state rolls back; orphan cannot become accepted; valid retry creates one output |
| Restart recovery | Separate process seeds committed data and exits without Store.close; second process inspects | Accepted pointer survives; running becomes outcome_unknown; no outputs/submissions added |
| Corruption/schema | Remove/corrupt asset; open future DB schema | Read/handoff fails; newer schema refused without overwriting user_version |
| Developer-facing manifest | Read accepted section/checksum plus text/styles/unresolved | Asset bytes hash matches manifest; text/order/styles retained; missing assets/overrides explicit |
| Honest native boundary | Queued native contract with null settings/ID/usage | Awaiting-external state allowed; mock completion/live collection rejected; no fake metadata |

The manifest check is a contract feasibility test. It is not a complete handoff ZIP, responsive page
preview, downstream reconstruction or deployment. Restart is process exit after committed writes;
hard power loss, disk exhaustion, large assets, concurrent writers, Windows, online backup, migrations,
provider timeout/rate limits and real cancellation are untested.

## Shared foundation checks

The retained foundation suite has 43 top-level tests: all 18 original invariants, one exhaustive pixel property
check (6,912 channel assertions), and 24 shared-foundation checks. The path-with-spaces regression
runs the 19 legacy tests again in a copied checkout, including separate-process restart. Node's
nested test context is removed and TAP explicitly enabled so the parent verifies the child count.
The repair suite adds 11 consumption-boundary regressions, for 54 top-level tests total. It advances
current dependencies/context after insertion, rejects acceptance with unchanged ledger/selection
through reopen, permits pinned historical versions, and checks selected bundle inputs. Metadata
negatives cover foreign project/ledger/bundle, unrelated same-project rounds, wrong referenced types,
lookup identity and previously stored bad metadata after reopen; correct and partially/wholly missing
pointers remain controls with explicit mounting. Both smoke commands run offline and clean up temporary
state; the Design OS smoke uses two processes.

| Property | Procedure | Expected observation |
|---|---|---|
| Shared modes and origins | Persist Branded/Freeroam through identical Website contracts; local override plus derived/inherited inputs | Honest effective precedence and source refs; no Freeroam mount or invented approval; unresolved remains visible |
| Context integrity | Forge inherited/effective values with a valid recomputed checksum | Gate rejects mismatch against mounted approved source |
| Candidate exploration | Nine coherent relative four-family vectors; select and refine three around selected base | Nine distinct vectors, shared locks, narrower amplitude, base/provenance refs, immutable bundle versions |
| Port contract | Wrong type/schema/required field/permission/lineage, forged checksum, malformed nested state | No persistence or history change |
| Dependencies and ownership | Missing/current-stale/cross-project refs, unknown module/owner/asset | Rejected; pinned historical dependencies remain usable |
| Preservation/review | Change preserved scope; edit declared review paths | Rejected preservation; explicit invalidation findings without quality score |
| Capability/executor boundary | Incompatible type; unavailable cloud/local/Chinvat; human route; semantic stub | Structured unavailable Placeholder/manual route; unknown observed settings null; semantic status not-run |
| Bundle/acceptance | Wrong membership/count/locks/dimensions; stale accept; injected selected-pointer failure | Rejected; audit and pointer atomically preserved; no VisualOS promotion |
| Restart/metadata | Separate seed/inspect processes for both modes; reconnect pointers locally and with absent refs | Bundle v2, selected pointer, provenance and unresolved fields survive; no implicit context mount |
| Legacy mapping | Explicit snapshot all old records/assets; duplicate/corrupt/injected audit failure | Old data and bytes unchanged; historical links retained; new data stays proposal; atomic rollback |
| Acceptance consumption | Advance explicitly current artifact/bundle project/context/base inputs after insertion, then reopen | Stale acceptance fails with unchanged audit/pointer; pinned historical artifact v2 and selected bundle v2 still succeed |
| Metadata consumption | Constructor/import/reconnect with incorrect known owner/types/bundle and historical invalid metadata | Consistent rejection; missing portable pointers remain unresolved; no automatic VisualOS mount |
| Serialized fixtures | Enter checked-in packets through runtime gates; regenerate fixtures | All pass and generated JSON matches checked-in content |

Inspect [design-os.json](../fixtures/design-os.json) as data, not a visual deliverable. Regenerate it
with `node scripts/serialize-design-fixtures.ts` and confirm `git diff --exit-code -- fixtures/design-os.json`.
The Linux CI workflow uses Node 24.19.0 and immutable action references. It has no secret or provider
steps. Record whether a workflow actually ran and its result, rather than assuming a committed
workflow establishes CI success. Windows/macOS, graphical previews, live providers, designer review,
full storage unification and production auth remain unverified/out of scope.

## Designer rubric

This rubric defines human evidence to collect in later workspace/pilot review. It has not been run.
Use the fictional brief first; a real website is needed only for the later usefulness pilot.
Record reviewer, exact image/composition versions, comparisons, decisions, exceptions and elapsed
review/generation time. Elapsed time is descriptive; do not invent a universal quality threshold.

For each dimension, record **0: blocks intended use**, **1: usable with stated correction**, or
**2: reviewer accepts for this brief**, with a concrete reason. This is a review aid, not an
objective style, popularity or commercial success score. The operator owns final disposition.

| Dimension | Required comparison/question | Acceptance evidence |
|---|---|---|
| Intent fit | Compare calm vs compact directions against audience, offer and intended action | Reviewer identifies fitting direction and reason; unresolved/conflicting intent retained |
| Hierarchy | Can the intended action and content order be identified? | Reviewer can name the primary action; any ambiguity recorded |
| Regional edit | Compare source, raw output, strict composite at matched scale and full section | Requested material/feature changes; corner mark/outside content retained; seams explicitly reviewed |
| Section consistency | Inspect hero/services/proof/contact as a page | Palette/type/spacing align or overrides are explicit, intentional and accepted |
| Revision independence | Reject a direction and replace one section | Previous accepted sections/versions remain recoverable; reviewer understands what changed |
| Responsive reading | Later workspace at 1440px desktop and 390px narrow | Content order, overflow, readability, contrast and keyboard-critical controls checked |
| Provenance and uncertainty | Follow a section asset to its source job/references | Reviewer can explain source/choice; unknown settings and unapproved proposals stay visible |
| Developer handoff | Separate implementing reviewer reconstructs a page from approved manifest/assets | Matched checksums, editable text/layout and unresolved exceptions; designer compares reconstruction |

Independent review is separate from the implementer's command outputs. Before canonical completion,
a reviewer must re-read the pinned task and latest task meaning, inspect the exact software diff,
repeat relevant commands from a fresh checkout, probe the stated invariants independently, and
record acceptance or repairs in MSB. Consequential visual choices require designer/operator review.
The implementing session must not mark its own canonical task complete.

## Local workspace checks

The retained 54 tests remain; 16 workspace/service groups cover current-input no-write acceptance,
reference ownership/type and revisions, reviewed proposal uncertainty, real PNG/JPEG/WebP decoding,
truncation/dimension/animation/byte limits, invalid original bindings, wrong project/scope/stale job,
duplicate/late/closed returns, corruption, metadata controls, host/origin/token/nested boundaries,
and copied closed-root restoration with unchanged legacy data. Three HTTP regressions use JPEG,
WebP and non-default PNG references and returned results to compare original downloads byte-for-byte
against manifest checksums, independently of normalized previews. Wrong-owner, wrong-type and corrupt
file controls reject without acceptance changes. All test stores and servers close before removal
of their synthetic roots; CI runs the unmodified suite on Linux and Windows Node 24.19.0.
Run `npm run build` and
`npm run test:browser` after installing Chromium; see [workspace.md](workspace.md) for exact setup.
The browser check exercises actual forms/downloads/uploads, 1440px/390px overflow, skip-link/focus,
comparison, reference revision/stale acceptance, native result/section acceptance, proposal import,
Branded context and fresh process/browser reconstruction. It also checks recorded invalid native
outcomes followed by corrected uploads without reopening, stale-job rejection without automatic
retry, closed late-return controls, and new Branded/Freeroam project comparisons followed by restoring
the prior owning comparison. JPEG reference and WebP result links exercise actual original downloads.
[Synthetic evidence](evidence/) is technical
implementer evidence only. Native-host generation and independent round trip remain separate checks.

## Optional API adapter checks (offline)

The suite now retains all 70 workspace/foundation tests and adds 24 provider regressions, for 94
top-level tests before the envelope/shutdown repairs. They exercise serialized JSON/multipart/Responses boundaries, original bytes/parent
lineage, missing configuration/budget, unsupported controls, duplicate/independent-instance claims,
source/owner checks, refusal/rate-limit/malformed/oversized/corrupt output, timeout/network uncertainty,
process interruption, late/cancelled results, cross-project persisted run limits, explicit reconciliation,
storage failure, assistant review and copied-root native/API comparison history. No test calls OpenAI.

Five assistant-envelope regression groups and one portable fixture-lifecycle group bring the total to
100 top-level tests, retaining all 94 preceding tests. Direct adapter and persisted-job checks cover
reasoning plus valid proposal/refusal, available IDs/numeric usage, no retries, restart equality and
distinct edited human review without VisualOS approval. Negative envelopes cover tools, unknown types,
multiple/non-final messages, malformed reasoning/content/schema and ambiguous mixed refusal/text.
The lifecycle test checks acknowledged store closure, completed stdio, closed-root copy/reopen and
failed-startup cleanup. The complete provider browser workflow also uses reasoning plus a final proposal,
requires exact acknowledged counts `[0, 4, 0]`, and writes its receipt only after graceful process closure.

The provider browser regression holds the second successful preparation response while the earlier
stale job remains queued. Before releasing it, assertions require a busy application, two durably queued
jobs without observations, only the old visible row, and no new submission. Preparation correlates the
successful response's newly created attempt with its rendered pointer and waits for the action to finish.
Submission clicks that exact attempt once; only read-only outcome refresh is polled. The completed flow
requires one intended assistant submission/result, an unchanged stale job, five distinct HTTP submissions
(one intentional stale rejection plus four injected calls), and the retained exact IPC counts. The gate
uses assertion-controlled response delivery, without timing sleeps or automatic provider retries.

```sh
npm run build
npm run test:browser
npm run test:browser:providers
node scripts/serialize-design-fixtures.ts
git diff --exit-code -- fixtures/design-os.json
git diff --check
```

Both browser scripts use temporary synthetic roots. The provider script uses a test-only injected
transport and records zero real provider calls. Sources, supported controls, secret/budget boundaries,
proposed opt-in live review and limitations are in [local capability providers](openai-providers.md).
The retained Windows/Linux Node 24.19.0 CI runs all unit/smoke/build/fixture checks and both browser
workflows, uploading public-safe receipts/screenshots for each platform. Record actual run results before
claiming success. Windows directory durability
and real provider/account verification remain unproven by these checks.

## Regional workflow checks

The 100 retained tests are joined by 20 regional groups (120 top-level tests). Coverage includes
1254-square production RGBA masks/composites, PNG/JPEG/WebP and orientation, non-square geometry,
source/version/dimension/mask rejection without writes, source/overlay separation, byte-exact native
bundle/reference/null metadata, immutable raw/strict lineage, outside RGB/alpha, closed-copy reopen,
geometry rejection, late/cancelled results, concurrent selection/composite/acceptance conflicts,
unsupported recipes, type/owner/scope bindings, strict-policy bypass rejection, replacement-source active selection/competing initial save conflicts, second-connection
freshness revalidation inside acceptance, injected atomic-write failure/retry, Branded context
preservation and one-call regional execution through the existing offline API adapter.
The comparison renderer regression restores the latest saved operation decision after outputs
append, keeps unresolved distinct from selection/acceptance, and ignores foreign project/scope,
source/selection mismatch and future-operation bindings without persistence changes.

`npm run test:browser:regions` adds the actual regional form workflow at 1440×1000 and 390×844.
Receipts require one intended injected API submission, private IPC counts `[1,0]`, zero real calls,
exact source bytes, native bundle files, outside-mask RGB/alpha, explicit comparison/acceptance,
correct historical crops after a selection revision and closed-root/fresh-session equality. The
retained provider receipt still requires exactly four offline calls and `[0,4,0]`; neither assertion
is weakened. Screenshots and receipts are uploaded by both CI platforms. These are AI technical
fixtures; the regional designer rubric above requires separate operator/designer judgment.
The regional receipt also records visible saved subset/selected/unresolved/reason restoration
immediately after save, across tab navigation/reload, in a fresh browser and after closed-root
recovery, with two independently compared operations and a candidate appended after comparison.
Assertions check actual checkbox/select/input values and selection/acceptance indicators as well
as stored state; comparison saves and candidate appends leave acceptance unchanged.
