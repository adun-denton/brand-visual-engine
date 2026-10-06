# Brand Visual Engine

A website-first visual design workspace connecting brand intent, visual references, editable page
composition, image iteration, and design decisions.

This repository currently contains the development bootstrap and handoff templates. A runnable
application has not been implemented. Features below describe the intended product, not shipping behavior.

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

There is no application build or test command yet. The first implementation packet establishes the
stack, executable setup, and meaningful verification commands. Do not report the bootstrap as tested
software or infer passing tests from the absence of source code.

For documentation changes, check local links, read the changed files, and run `git diff --check`.
Runtime data, credentials, model weights, and generated/client assets are excluded by `.gitignore`.
Only deliberately selected, public-safe fixtures belong in source control.
