# Install and resume BVE

Instruction set: visual-os-ops-v1. Status: candidate foundation, not a public release.

## Entry and authority

Start from the public repository README and this file. Private planning documents are never an installation dependency. Use an approved stable GitHub release for ordinary installation. Resolve its exact commit, release metadata, supported environment and instruction version before obtaining software. A development branch or passing PR is not a release.

At preparation of BVE-VOS-01 no release/tag existed. If no approved release is available, report that fact without substituting a development branch. A user explicitly participating in development may use the exact candidate in an authorized packet.

## Install BVE workflow

1. Inspect the operating system, architecture, filesystem access, installed BVE versions, supported Node and available browser. Inspect before provisioning.
2. Identify a supported release and verify downloaded bytes against its published integrity information. Record the commit as well as the version.
3. Reuse a compatible existing installation. Otherwise prepare a version-specific user-local installation. Do not replace an unrelated checkout or require elevation by default.
4. Provision only the dependencies within the user's installation authorization. Disclose additional permissions, migrations or unsupported sources. Never install models or activate an image API as a prerequisite.
5. Resolve an explicit private project root. Reopen an unambiguous selected project; ask only if the destination is essential and cannot be resolved. Keep software, runtime and staging distinct.
6. Use the application's documented initialization operation. Repeating it must retain project identity and saved work. Refuse unsupported/nonempty unrelated roots. Existing unregistered runtimes require explicit adoption.
7. Bind the compatible versioned role instructions and preserve separate local additions. Do not fetch latest instructions independently.
8. Inspect tool availability without invoking image generation. Record unavailable/unverified capabilities honestly.
9. Start the project on loopback. Verify application version, instruction version, project identity and health before returning the actual URL.
10. Explain start/stop, project creation, review, continuation, export, backup, updates and resume using the implemented feature inventory.

## Current candidate prerequisites

The inspected base declares Node >=24.19.0 <25, with CI on 24.19.0. Use the lockfile:
- npm ci --ignore-scripts
- npm run typecheck
- npm run build

Ordinary launch is npm run dev, or node scripts/dev.ts after a successful build. Set BVE_RUNTIME_ROOT to the explicit private runtime directory outside the checkout and BVE_PORT to an available loopback port. Print the actual URL and keep the owning foreground process identifiable. Stop with Ctrl+C and wait for graceful close. Do not terminate another process to obtain a port.

The initial packet must add and document actual project initialization, identity inspection and intake commands here. This document does not assert that those commands already exist. Any command added by the implementer must correspond to tested code.

## Data ownership

A private project contains bve.project.json, a runtime directory with all BVE-managed stores/assets, staging/<job-id>, references, exports, backups and optional local instructions. Absolute local mappings stay private. The canonical project ID must be checked against the runtime; a folder name is not identity.

Mounted/synchronized Drive storage and Drive connector operations are distinct. Local operation requires neither. Prefer local live SQLite storage; transfer exports or verified closed backups instead of assuming synchronization coordinates a running database.

## Health and limits

Installation health covers supported runtime, correct application/project identity, readable assets and an accessible UI. It does not prove native generation, editing, capture, cloud transfer, parallel workers or designer usefulness. Use authored disposable fixtures for setup verification.

Do not alter an existing project merely to probe health. No image call, paid API, credential setup or local-model trial is part of this procedure.

See docs/project-initialization-prompt.md, docs/operate.md, docs/updates.md and docs/reporting.md.
