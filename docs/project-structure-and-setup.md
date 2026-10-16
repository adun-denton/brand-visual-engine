# BVE project structure, setup and operation

Coordinator-authored v2 candidate guide. The coding session must integrate the matching instruction contract and document/test the new interfaces before claiming implementation complete. At the BVE-VOS-03 documentation snapshot, v1 remains the active code.

## Ownership and layout

```text
<software-checkout>/
  AGENTS.md                 development/review governance
  INSTALL.md                tested installation entry point
  instructions/             versioned operational files and manifest
  docs/                     public operator guides and execution packets
  src/, scripts/, tests/    implementation and evidence checks

<private-project>/
  AGENTS.md                 fresh-root project template; preserve existing file
  bve.project.json          explicit identity and compatibility mapping
  instructions/             pinned copies of the compatible instruction set
    AGENTS.md               role routing and shared boundaries
    conductor.md, butler.md, generator.md
    bootstrap.md, foreman.md, reviewer.md
    project-AGENTS.template.md
    local.md                user-owned additions, never overwritten
  references/               private source inputs
  staging/<job-id>/         request/delivery transport; completion marker last
  runtime/                  owning-service SQLite and immutable asset storage
  exports/                  explicitly scoped portable evidence
  backups/                  complete closed-root backups
```

Runtime subdirectories and service-discovery files are application-managed; never reorganize them by hand. Foreman is defined but inactive. Root private AGENTS.md and local additions remain user-owned, while pinned instruction copies must match their manifest. Preserve any legacy instructions.local.md and report conflicts with instructions/local.md.

## Supported setup foundation

Choose an approved release or an exact development candidate explicitly authorized by the operator. A passing draft PR is not a release. Inspect before installing. This code line requires Node `>=24.19.0 <25`; CI uses 24.19.0. Use the candidate lockfile. The following current foundation commands run from the selected software checkout; placeholders must be replaced with explicit operator-selected paths:

```powershell
Set-Location '<software-checkout>'
node --version
npm.cmd ci --ignore-scripts
npm.cmd run build
npm.cmd run bve -- init --root '<new-private-project>' 'Project title'
npm.cmd run bve -- inspect --root '<private-project>'
npm.cmd run bve -- start --root '<private-project>' 0
```

Use init only for an intended new compatible root, or the documented idempotent resume check. The actual installation commit/path are recorded; a later checkout commit will not silently adopt that root. Inspect mismatch read-only; use matching software and complete compatible backup, not manual metadata edits. Port 0 chooses an available loopback port. Open the actual returned URL. Keep the service terminal open; Ctrl+C shuts down its owner. Resume using the same compatible checkout/root and start command. Never stop an unidentified process to reuse a port.

`jobs`, `receipts`, `prepare`, `intake` and `cancel` are existing project-bound CLI operations documented in INSTALL.md. Actual production transport uses its tested request/delivery/completion schemas, not filenames from conceptual planning diagrams. Originals are never transformed merely to satisfy a manifest.

## New interfaces to complete under BVE-VOS-03

Before returning code, replace this provisional section with tested command examples for: pending review inspection and exact reads; controlled visible-browser launch/capability; request/capture status; deterministic verification/finalization; local continuation; portable export and read-only bundle validation; explicit parent-linked preparation. Include PowerShell argument handling, errors, bounds, start/stop/resume and the exact supported browser route. Do not invent executable commands in advance or leave placeholder command claims in the final operator guide.

The operational sequence is: submit exact feedback, capture the same controlled review tab, independently verify through Butler-facing deterministic operations, read back receipt, then copy completed continuation. Without Butler/capture, submission remains durable and the UI provides a pending resume instruction. Capture is actual rendered browser evidence; no generated/reconstructed replacement. Native clipboard/unload behavior depends on browser policy; provide explicit fallback controls. Original sources and structured comments remain available alongside screenshots.

A fresh local Conductor retrieves exact referenced records; a remote Conductor needs the explicitly exported bundle or a supported existing transport. Local path text is not access. Portable exports contain only the selected necessary closure and are validated as untrusted snapshots; no automatic foreign database import. A child iteration is explicitly prepared with parent lineage and current target/source validation; resume/copy never generates.

No image/model call, credentials or paid fallback is a setup preflight. Report supported code, available host capability and observed evidence separately. Live trial instructions must specify their own actual tools, attempt limits and user authority after independent coding acceptance. Active SQLite stays local; synchronize exports or complete closed backups only.
