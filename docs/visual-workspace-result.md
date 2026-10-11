# V02 implementation return

Bounded implementation of TODO-BVE-20261011-017. Review/acceptance and canonical status remain
with the originating Work reviewer. No additional agents. Planning pin:
`18cf3e843bcc7a44395ae4078719bf7b236ac409`. Software base:
`d3bdd456de57874fc69c6fe175937a5b5c0dd7bc`, tree `608a137b3dcdc9a639047a7fe6b058140342b7d3`.
Branch `codex/bve-vnext-v02-visual-workspace`; dependent draft PR targets
`codex/bve-vnext-v01-image-foundation`. Base branch matched the pin at start.
The PR body supplies the exact result head/tree and CI; this file cannot contain its own commit hash.

## Changes

| Files | Purpose |
|---|---|
| `src/service/visual-workspace.ts`, `src/service/server.ts` | Narrow owned projections/commands, session protection, plain-text and scope checks; separate `/visual` entry and exact raster reads |
| `src/service/exploration.ts` | Atomic frozen-spec/pending-batch preparation via existing `putMany`; optional post-decode expected-project check |
| `src/web/visual.ts`, `visual.html`, `visual.css`, `visual-geometry.ts` | Two review layouts over one backend, comparison/selection/notes, region geometry, optional controls, explicit preparation and history |
| `src/modules/website/visual-controls.ts` | Approved descriptor inventory expressed as typed future requests, five dynamic controls unavailable |
| `src/web/index.html`, `scripts/build.ts`, `package.json` | Separate browser bundle and link; existing workspace preserved; no dependency addition |
| `scripts/visual-fixture.ts`, `visual-review.ts` | Six hand-authored synthetic raster compositions and safe fresh-root review launch; explicit disabled provider configuration |
| `tests/visual-workspace.test.ts`, `scripts/visual-browser-check.ts`, `.github/workflows/verify.yml` | Adverse HTTP/service/recovery tests and actual geometry/persistence walkthrough; new CI browser step/artifact |
| `scripts/ai-assets-browser-check.ts` | Continuation repair: bounded navigation/action waits, original failure diagnostics and fresh browser context before closed-root copy/reopen |
| `docs/visual-workspace.md`, `visual-workspace-result.md` | Sanitized rationale, request keys/units/scopes, results, limitations and rollback |

No SQL/schema change, parallel database or user-data migration. No private planning files, client
images, accounts, credentials or trial runtime included. No PR10 integration or production release.

## Local evidence and acceptance matrix

Linux x86_64, Node 24.19.0, npm 11.9.0; isolated checkout and disposable synthetic roots.
Locked install `npm ci --ignore-scripts` passed. The default Playwright download failed with invalid
ZIP archives; an available local Chromium 143.0.7499.0 supplied actual browser evidence instead.
CI uses the workflow's pinned Playwright Chromium and is separately checked at the returned head.

| Requirement / actual command | Result / evidence |
|---|---|
| `npm run typecheck` | Passed strict TypeScript |
| `npm test` | 191 passed, 0 failed, 0 skipped; ten new adverse/recovery tests |
| `npm run build` | Both legacy and visual bundles built |
| `npm run smoke`, `npm run smoke:design-os` | Pass: outside-channel difference 0, accepted state survives reopen; both modes, nine candidates per mode |
| `node scripts/serialize-design-fixtures.ts`; `git diff --exit-code -- fixtures/design-os.json` | Byte-identical legacy fixture |
| `npm run test:browser:visual` with local Chromium override | Actual seven-image sequence; no page errors, actual model/image-provider calls 0 |
| Both layouts / chat-free flow | Create Homepage, import three rasters, whole source + rectangle source, separate notes, non-drag ellipse, explicit count/Direction and frozen inspection |
| Geometry | Letterbox input rejected; rectangle numeric original bounds checked; zoom/resize keep old anchors, zoomed pointer bounds checked; EXIF JPEG displays encoded red/green pixels |
| Persistence / ownership | Switch layout/page; About Us independent; raster revision leaves old anchor pinned; keyboard whole selection; close server/browser and reopen canonical records unchanged |
| Controls / adverse inputs | Counts 0/7/fraction reject, 1/6 pass; all four Direction/Brand pairs pass with approved-only frozen Brand; requested scales/count/category types and unsupported dynamics enforce |
| Boundaries | Wrong token/origin, stale/foreign pointers, malformed/markup input, corrupt closure and fake-success route reject without writes; async import checks project revision |
| Recovery / conflict | Final-packet failure rolls back spec and batch; exact-lock conflicts are useful 409s; manual retry keeps lineage; partial/uncertain/cancelled outcomes never auto-adopt or accept |
| Multiple saved sets | Exact choice required; updating one set preserves the other; no canonical active pointer invented |
| `npm run test:browser:pages`, `npm run test:browser:regions` | Existing relevant browser workflows pass locally; all eight are retained in platform CI |
| `npm run test:browser:ai-assets` | Pass locally after harness repair; same accepted export bytes survive fresh-context closed-root recovery, zero provider calls |
| `git diff --check` | Pass before publication |

Source evidence is the named service tests, the browser script's assertions and its screenshots /
`walkthrough.json`. Screens: `01-a-desktop`, `02-a-focus`, `03-b-comparison`, `04-b-narrow`,
`05-a-narrow`, `06-prepared`, `07-b-desktop`. Desktop 1440×900; narrow 390×844. CI artifacts
are exact-head evidence; screenshots are not substitutes for geometry/persistence assertions.

Continuation: the first published V02 head passed Linux CI but two Windows attempts timed out
inside the inherited asset browser harness before reaching V02. That harness now closes its
browser context before app/store closure, copies only the closed root and reopens in a fresh
context. Navigation waits are bounded and failures retain the original error and stage even
when diagnostic browser reads fail. Production services and persistence contracts are unchanged
by this repair. The PR body records the updated exact head/tree and actual platform results;
the earlier timed-out jobs remain historical evidence, not a Windows pass.

## Review, remaining constraints and rollback

See [workspace rationale](visual-workspace.md) for keys/units/scopes, walkthrough and concrete A/B
tradeoffs. Final layout/count default remain unselected; actual image generation is not implemented.
No model/account/image-provider/GPU calls, provider installation, PR10 merge/integration, paid
fallback, user-runtime migration, merge or deployment. Browser installation is test tooling only.
Additional notes are retained; only a primary note is editable here. Existing ambiguous selection
sets require an explicit choice. Unprepared form inputs and view choices are disposable.

Revert this implementation on a new branch or use accepted V01 in a separate checkout. Close owned
processes before any full-root copy/restore; use matching code with complete closed roots and never
downgrade evolved data in place. No selective record/media deletion.

If platform verification is unavailable, the local session must clone into a fresh directory,
checkout the exact returned SHA, verify `git rev-parse HEAD HEAD^{tree}`, and run:

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build
npm run smoke
npm run smoke:design-os
node scripts/serialize-design-fixtures.ts
git diff --exit-code -- fixtures/design-os.json
npx playwright install chromium
npm run test:browser:visual
npm run test:browser:pages
npm run test:browser:regions
git diff --check
npm run review:visual
```

The review launcher prints an ephemeral loopback URL and uses a newly created synthetic root with
providers disabled. Expected walkthrough/screens and checks are the matrix above. Report exact
head/tree, OS/Node/browser, commands/exit codes, screenshots, geometry observations, defects and
log locations to the originating Work reviewer. The local session tests only; it cannot repair,
accept, merge, deploy or launch actual inference by implication.
