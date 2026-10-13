# Semantic page contract alignment

R7 repairs PR10 from `83a1e476166b8205eeb883cf910b2bde75dcd316` (tree
`e0d426b8b1e4d28a64ae7214222598ff97d9e068`). It strengthens exported shape constraints,
adds explicit semantic guidance and reports candidate/node/path/rule on rejection.
The page parser's accepted language and normalized output remain unchanged. No storage
schema migration, runtime rewrite, branch integration or UI redesign is introduced.

`page-contracts.ts` shares the existing bounds, kind/field ownership, language and href
grammars with the parser, schema and guidance. The R6 property-specific style authority,
restrictions and style-only example remain in `style-contracts.ts` without changes.
The inference response schema describes model-facing media **handles**; persisted pages
still require exact pinned asset/image bindings through the existing semantic gates.

R8 updates only new-intake media requirement membership from inherited-inclusive `in`
to `Object.hasOwn(page.media, slot)`. Its base is `dfcdae62cf7594efc6f8fc38dab16ffce391021c`.
The page parser grammar is unchanged. Existing persisted results, hashes, acceptance pointers
and successful/error receipts retain their historical meaning and duplicate replay behavior.
There is no retroactive validation, migration or name blacklist.

## Audited contract matrix

| Family | Exported JSON Schema | Parser/service semantic gate and retained behavior |
| --- | --- | --- |
| Page shape | Required version/title/language/root/media/responsive/unresolved; version1; no unknown fields | Same fields and grammar; plain JSON objects only |
| Node kinds | Required local id/kind; kind-specific required fields and prohibition on foreign-kind fields; optional bounded style | Container/section: children; heading/text/link: text; heading: level1–6; link: href; list: items; media: slot/alt/decorative |
| Local identity | ASCII letters/digits/underscore/hyphen; input length≤160, outer whitespace permitted | Trim first; unique in this page only. Local IDs are unrelated to kernel/artifact/version identity |
| Link values | Same href grammar, input length≤500, trimming preserved | `#id`, slash paths, restricted https/mailto/tel; no javascript/http/protocol-relative links |
| Local targets | Href shape only | Case-sensitive `#target` must exist in this same page; forward/backward/nested/repeated links are valid. Another candidate's IDs cannot satisfy it |
| Root and resources | Root container/section; each children/items/responsive/unresolved list≤100 | Total≤400 nodes, root depth0 and maximum depth12 are aggregate semantic limits |
| Text and language | Title≤200, text≤8000, item≤2000, alt/unresolved≤1000; nonblank except alt; language grammar≤30 | Limits count original UTF-16 units before trim; schema counts code points. Astral strings can still require semantic rejection |
| Media slots | Local slot grammar; media keys use local identity syntax; values null or nonblank handle≤100 | Mapping must supply all used slots and no extras; repeated slot use is valid. Exact included placeable/upload handles only; project ownership and pinned image integrity remain authoritative |
| Alt | Explicit boolean decorative; when true, alt must be whitespace-only/empty | Trimmed empty alt is required for decorative media. Empty informational alt remains accepted as a finding |
| Responsive | Required maxWidth/nodeId/style; integer240–4096, local identity grammar, shared style constraints,≤100 | Target must exist in this page. Repeated targets/viewports remain valid; no required breakpoint |
| Preservation | Not independently provable from response shape | Exact frozen text/style/subtree locks, same ownership/currentness gates; no inferred preservation or coercion |
| Candidate envelope | Label≤200/rationale≤4000;≤6 candidates; findings≤100×4000; actions≤32×4000; media needs≤100 with slot≤160/instruction≤4000; no unknown fields | Exact request/hash binding; create/revise needs candidates, critique may have none. All candidate validation precedes writes. Proposed actions stay unexecuted |
| Media requirements | Nonblank bounded slot/instruction pairs | R8 new intake requires an own parsed page.media property. Absent inherited names reject; explicitly declared own constructor/toString/hasOwnProperty slots remain eligible, including null or resolved bindings and repeated needs. Historical records/receipts are not revalidated or rewritten |

The schema is a shape gate, not complete semantic validation. Relational checks, aggregate
limits, UTF-16 limits, request binding, resource ownership/integrity and preservation remain
mandatory even after schema success. No fixed sections, layout, image counts or branding
are introduced. Each request exports `pageGuidance` with these relationships and a compact
generic link/target example; the ambiguous “No IDs” sentence is removed.

## Actionable diagnostics

Synthetic malformed second candidate:

```text
Candidate 2: Unknown local anchor #missing; at page.root.children[0].href (node forward); expected #target matching an existing local node id in this SAME candidate page (case-sensitive)
```

Other examples:

```text
Candidate 2: Duplicate local element identity; first declared at page.root.children[0]; at page.root.children[1].children[0].id (node forward); expected unique local identity within this same page
Candidate 2: Unknown responsive node; at page.responsive[0].nodeId (node missing); expected existing local node id in this SAME candidate page
```

Diagnostics expose validated local identities, structural paths and expected rules, not
titles, instructions, private context, whole payloads or rejected URL content. An identity
that cannot be safely validated is omitted. Error status remains400 (or its prior status).
The one-based candidate prefix now applies to all candidate InputErrors, including envelope
and preservation failures; R6 StyleError location/property/rule messages remain intact.
No missing targets are created, links dropped, IDs rewritten or values coerced.

## Offline verification

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run test:page-contract
npm run build
npm run smoke
npm run smoke:design-os
node scripts/serialize-design-fixtures.ts
git diff --exit-code -- fixtures/design-os.json
git diff --check
```

`test:page-contract` verifies the reviewed base tree and extracts that parser into disposable
test data using Git/tar. It compares acceptance **and normalized output** across3,067
synthetic cases. Fresh-reader tests independently classify shape/semantic-only differences
for13 page families and test adjacent envelope boundaries at schema and service levels.
Adverse service/tool/HTTP checks reject malformed second candidates without candidate,
result, selection, acceptance, ledger or image-job writes. A completed action receipt
contains an error; duplicate action identity returns that exact error without re-execution.
R8 synthetic controls additionally cover absent inherited names on empty/unrelated-slot pages,
declared own names and valid supplied handles, whole-submission rejection through service/tool/HTTP,
a later explicit corrected submission, and historical result/receipt replay. The historical
fixture is produced by the exact R7 base in a disposable runtime, then read by the candidate;
old packet integrity, accepted export bytes, original media bytes and receipts remain unchanged.

Run all nine retained browser scripts from `verify.yml` plus
`npm run test:browser:page-contract`. The added desktop/390px probe demonstrates actionable
rejection, saved failed history across reload without retry, and a separate explicit valid
submission with no acceptance. Existing browser regressions retain R1–R6 cancellation,
permissions, project isolation, shutdown and style controls.

Retain the pinned `codex-cli0.162.1` permission and catalogue probes:

```sh
# BVE_CODEX_BINARY must name the exact existing native executable.
npm run test:chat:permissions
npm run test:chat:protocol
```

They use disposable homes and owned loopback synthetic receivers, never account credentials,
protected trial roots, live budgets or upstream inference. CI runs both probes, the original
nine browsers, the new contract browser and parser parity on Linux and Windows, with evidence
artifacts. A Windows-specific storage/token test is skipped on Linux; report that accurately.

## Limits and rollback

Synthetic success proves contract behavior and interaction only. Actual model generation,
designer usefulness, HTML reconstruction and raster/session integration remain unverified
and separately authorized. PR10 stays separate and draft, targeting main. Image-first,
auxiliary chat, separate Direction/Brand, optional Levels1–3,1–6 attempts/manual retry remain
settled; final layout/default count and local recipe binding remain unresolved.

Independent review owns acceptance and task disposition. There is no live call, provider
installation, merge or deployment in this repair. Rollback is the isolated R7 commit revert
or the exact reviewed base with matching disposable test data. Existing canonical records,
bytes/hashes, acceptance pointers and idempotent receipts are not rewritten. Do not downgrade
or selectively delete an evolved real runtime or replay failed historical submissions.
