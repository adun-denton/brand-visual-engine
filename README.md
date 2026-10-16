# Brand Visual Engine

BVE is a local browser visual workspace. Chat handles creative discussion and bounded native production; BVE preserves original artifacts, selections, annotations, history and explicit decisions.

## Install or resume

Start with [INSTALL.md](INSTALL.md) and the [local initialization prompt](docs/project-initialization-prompt.md). Use an approved release for ordinary installation. Private planning access is not required.

This development branch starts from the reviewed PR21 candidate and carries BVE-VOS-01. It is not a public release. At packet preparation, no releases or tags existed. Do not install an unmerged branch as an implicit fallback.

## Current capability boundary

The base supports image-first visual comparison, whole-image and region selection, notes, persistent canonical records, whole-original exports and explicit manual native exchange. Native production is performed by a capable external agent environment; the browser cannot assume it can invoke that environment.

The BVE Visual OS candidate provides fresh-root v2 bootstrap, validated local intake, durable immutable feedback, actual controlled-tab capture, additive deterministic verification, explicit Copy/portable continuation and parent-linked preparation. Independent acceptance of BVE-VOS-03 remains pending; no live readiness, migration or public updater is claimed. Start with [INSTALL.md](INSTALL.md) and the [tested v2 setup/operation guide](docs/project-structure-and-setup.md).

Paid image API execution remains disabled. No sign-in, paid API or local-model installation is required for the visual review reference configuration. An installation check must not consume image-generation quota.

## Operating instructions

- [Operator guide](docs/operate.md)
- [Conductor](instructions/conductor.md), [Generator](instructions/generator.md), [Butler](instructions/butler.md)
- [Update and recovery contract](docs/updates.md)
- [Feedback contract](docs/reporting.md)
- [Legacy operator guide](docs/operator-guide.md): historical/legacy interfaces, not the new install entry point

Keep private runtime data outside source control. Set an explicit project/runtime mapping. A local filesystem path is not access for a remote chat. Drive is optional; do not assume synchronization safely shares a live SQLite database.

## Development and independent review

Read [AGENTS.md](AGENTS.md), the approved [BVE-VOS-01 packet](docs/implementation-packets/BVE-VOS-01.md), and [cross-account handoff](docs/development-handoff.md). The coding session arranges the coordinator's source bundle before implementation, then returns exact commit/PR and test evidence to the originating review chat.

This repository owns implementation, public installation/operation instructions and evidence. Private MSB owns strategy and canonical task status. Public packets are bounded execution snapshots, not an alternative roadmap.

## Candidate validation

The inspected base requires Node >=24.19.0 <25; CI uses 24.19.0.

    npm ci --ignore-scripts
    npm run typecheck
    npm run build
    npm test

See INSTALL.md for launch/stop instructions and the packet for scoped tests. Authored fixtures are not live native-generation evidence. Passing CI is not designer acceptance, merge authorization or release approval.
