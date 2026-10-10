# Brand Visual Engine

Website is the first implemented module of an experimental shared AI Design OS foundation. Its
contracts connect brand intent, visual references, Website design exploration, image iteration and
local design decisions.

This repository contains a local browser workspace, shared kernel, Website exploration, persistence,
manual native-image export/import, bound regional selections and strict composites, server-side
OpenAI image/assistant adapters, legacy asset compatibility
and synthetic fixtures. Provider wiring is tested offline; live account/usage/quality verification remains
pending. A bounded editable landing-page composer and developer export are implemented;
production hosting/publishing and real booking are not. Designer usefulness and release disposition remain pending.

The application is standalone and is developed/tested with synthetic website briefs, sample assets,
and mock providers. No existing website or client pilot is required to start development. Real
provider checks validate integrations; a later website/designer pilot evaluates usefulness and quality.

The inference workspace adds independent full-snapshot pages with arbitrary internal sections,
responsive flow/flex/grid styling, separate exact media resources, scoped AI request/result exchange,
and independently accepted Website route assemblies. The default entry is now a persistent project
conversation and exact design canvas, with form-free draft intake and guarded candidate review.
Advanced controls and manual exchange remain optional. The account adapter awaits eligibility and
bounded live verification; disconnected messages retain drafts without generated alternatives.
See [chat setup and recovery](docs/chat-workspace.md) and [offline evidence](docs/chat-workspace-result.md).

**Paid API execution is disabled in this build**, including when an old private policy or key is present.
Injected offline transports remain test-only. Use the session handoff for reasoning and permitted native
image files. Local reasoning is not configured or benchmarked; no hardware or model choice is implied.
See the [inference workspace guide](docs/inference-workspace.md) and
[implementation evidence](docs/inference-workspace-result.md) for scope and limitations.

Start with the [operator guide](docs/operator-guide.md) for installation, visible controls, accepted
handoff and full-root recovery. The [candidate readiness matrix](docs/candidate-readiness.md) separates
synthetic technical evidence from the blank [designer trial](docs/designer-trial-template.md).

## Intended experience

Develop a brief, compare visual directions, compose editable website sections, generate or import
section imagery, refine selected image regions, and hand over an approved design with asset history.

Image-provider paths:

- native ChatGPT/Codex generation through an explicit export/import handoff;
- retained OpenAI image/assistant adapters, disabled for paid execution in this candidate;
- optional local ComfyUI is planned and unimplemented.

The native path does not assume this application can call a host's internal tools or inherit its
subscription. Provider capabilities and available metadata are represented honestly.

## Planning and implementation authority

Project planning, stage definitions, decisions, and task status are maintained in
[My Second Brain](https://github.com/adun-denton/My-Second-Brain), a private planning repository.
Authorized collaborators start with the
[project record](https://github.com/adun-denton/My-Second-Brain/blob/main/Projects/Brand%20Visual%20Engine.md).

This public repository owns code, tests, implementation documentation, and technical evidence.
It does not maintain a competing roadmap or task ledger. Public contributors without planning
access receive a bounded, sanitized assignment from the project coordinator.

## Working with a model

Read [AGENTS.md](AGENTS.md). The coordinator supplies a work packet pinned to planning and software
commits. The implementing model returns code and evidence; the coordinator independently verifies
the result and updates the canonical task state.

- [Work packet template](docs/work-packet-template.md)
- [Result report template](docs/result-report-template.md)

Filled packets and reports containing private context stay outside public Git. PRs contain only
public-safe technical changes and verification evidence.

## Setup and validation

With Node 24.19.0 (locked install/build checked on Windows and Linux):

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run smoke
npm run smoke:design-os
```

These retained checks run offline SQLite/filesystem fixtures in temporary folders. To open the local
workspace, run `npm run dev` and visit `http://127.0.0.1:4173`. Runtime data stays outside source control.
See [workspace setup, boundaries, native handoff and recovery](docs/workspace.md) for configuration,
browser checks and limitations. No provider call or production deployment is started.

- [Shared foundation, context modes and legacy mapping](docs/design-os-contracts.md)
- [Legacy standalone interfaces and persistence](docs/standalone-contracts.md)
- [In-app providers, configuration, spending and recovery](docs/openai-providers.md)
- [Regional editing, masks, recipes and strict preservation](docs/regions.md)
- [Provider capabilities and evidence boundaries](docs/provider-boundaries.md)
- [Technical checks and designer review rubric](docs/verification.md)

For documentation changes, check local links, read the changed files, and run `git diff --check`.
Runtime data, credentials, model weights, and generated/client assets are excluded by `.gitignore`.
Only deliberately selected, public-safe fixtures belong in source control.

S4 adds an editable structured landing-page composition with immutable drafts, per-section technical
review, separate whole-page acceptance and a bounded developer handoff archive. Start from the selected
synthetic Website direction in **Compose page**; no image generation or production deployment is needed.
See [workspace.md](docs/workspace.md#structured-composition-s4) and
[verification.md](docs/verification.md#structured-composition-checks) for limitations and reconstruction
requirements. Separate reconstruction/independent review and later designer acceptance are not implied
by a successful local export.

AI-authored direction handoffs and exact reusable asset placement are documented in
[AI directions and assets](docs/ai-directions-assets.md). Product Explore has no deterministic fallback;
legacy synthetic rounds and explicit mechanical test fixtures remain distinguishable from actual AI evidence.
