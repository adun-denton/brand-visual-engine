# Brand Visual Engine

Website is the first implemented module of an experimental shared AI Design OS foundation. Its
contracts connect brand intent, visual references, Website design exploration, image iteration and
local design decisions.

This repository contains a local browser workspace, shared kernel, Website exploration, persistence,
manual native-image export/import, legacy asset compatibility and synthetic fixtures. Live providers
and production website composition are not implemented. Broader intended behavior remains below.

The application is standalone and is developed/tested with synthetic website briefs, sample assets,
and mock providers. No existing website or client pilot is required to start development. Real
provider checks validate integrations; a later website/designer pilot evaluates usefulness and quality.

## Intended experience

Develop a brief, compare visual directions, compose editable website sections, generate or import
section imagery, refine selected image regions, and hand over an approved design with asset history.

Image-provider paths:

- native ChatGPT/Codex generation through an explicit export/import handoff;
- OpenAI image generation and editing through an in-app, server-side API integration;
- optional local ComfyUI generation through compatible, versioned workflows.

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

With Node 24.19.0 (tested on Linux x64):

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
- [Provider capabilities and evidence boundaries](docs/provider-boundaries.md)
- [Technical checks and designer review rubric](docs/verification.md)

For documentation changes, check local links, read the changed files, and run `git diff --check`.
Runtime data, credentials, model weights, and generated/client assets are excluded by `.gitignore`.
Only deliberately selected, public-safe fixtures belong in source control.
