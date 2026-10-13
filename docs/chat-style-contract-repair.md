# Style contract repair

An actual account turn reached BVE's scoped tools but its submitted alternatives were rejected
by style intake. The exported inference schema had allowed string/number for every style
property while the parser enforced property-specific types, enums, grammar and bounds.
This R6 candidate aligns that style projection; it does not claim live generation success.

## Shared constraints and guidance

src/modules/website/style-contracts.ts is the authority for all27 permitted properties.
The parser, numeric CSS pixel mapping, exported JSON Schema, property guidance and valid
style-only example derive from it. Node and responsive styles both reference the same schema.
Repeated scalar-string constraints use one schema definition to keep the tool response compact.

The existing enums, numeric-only bounds, scalar units/auto, hex colors, local font-family
characters/length, explicit grid columns, grid placement, whole-border and aspect-ratio
grammars remain. Quoted fontWeight/lineHeight numbers, compound padding/margin, repeat()
columns and side-border shorthand remain rejected. No normalizer, coercion, new CSS property,
fixed page sections or image slots were added. Existing structural, semantic, resource,
preservation, currentness and acceptance gates remain.

Scalar strings retain the old parseFloat limit at4096, including leading zeros and binary64
rounding at the boundary. The generated bounded pattern makes that limit visible to standard
JSON Schema validators. Numeric letterSpacing retains its special -10 minimum; negative
unit strings remain unsupported. Other dimension numbers retain the0 minimum.
Existing permissive explicit-column tokens are preserved; this repair does not redefine CSS.

prepare_design returns the detailed schema plus generated styleGuidance properties/example.
The example contains only style values, not a page template. It is guidance for AI-authored
output, not a replacement for an actual rejected candidate.

## Rejection behavior

Style errors identify the candidate's one-based index, page node or responsive-array location,
node identity, property and expected format/example. For example, a numeric-type rejection
identifies fontWeight and asks for a bounded JSON number. Values, page text, brief/context,
other projects and raw candidate payloads are not echoed.

Validation still stops at the first rejection. The failed action keeps an idempotent error
receipt. A finished receipt's completed status is not successful candidate submission;
duplicates return that same error. All candidates validate before any candidate/result write,
and no selection or acceptance follows from a malformed result.

## Offline verification

Run npm ci --ignore-scripts, npm run build, npm run typecheck and npm test.
tests/style-contracts.test.ts uses independently pinned Ajv8.20.0 (development only)
to validate exported draft2020-12 schemas against the parser: valid/invalid families for
all27 properties, scalar/rounding boundaries, the reported failure classes on node and
responsive styles, generated guidance, and service/HTTP rejection without partial writes.
Rejected chat receipts, duplicate reuse, unchanged kernel packets/events and no acceptance
are checked. Ajv is not part of production parsing or the browser bundle.

Retain npm run test:chat:permissions with the actual pinned0.162.1 app-server and owned
synthetic Responses receiver, the separate catalogue probe, both smokes, fixture equality,
and all nine browser workflows in .github/workflows/verify.yml. See
[permission repair](chat-permission-repair.md) and [shutdown repair](chat-shutdown-repair.md).

Mechanical provider/page fixtures establish software behavior only. No actual returned payload
was normalized or resubmitted. This coding repair makes zero account/model/image/paid/GPU calls,
changes no live policy/reservation and performs no merge/deployment. Task015 remains in progress.
Independent R6 acceptance precedes separately authorized actual generation; refinement,
selection/comparison/acceptance/export, model-thread resume/interrupt and designer usefulness
still need actual evidence.

Exact head/tree, checks and CI are in PR10 and the private coordinator return.
A code-only R6 revert restores the schema/parser mismatch. Runtime rollback requires matching
code and a complete protected backup; do not downgrade evolved storage or use create-mode
database probes during observation.
