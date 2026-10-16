# Set up the BVE project in Codex

This is the intended local onboarding experience: initialize a private BVE project, add that same folder as a local Codex project, establish its instructions and role prompts, open the controlled BVE browser, and begin the first Conductor conversation. Creating files alone does not register a Codex project or start an agent.

## Software and documentation versions

For the reviewed BVE-VOS-03 user pilot, the executable is pinned to `50d5bf513a7160499d151eb8ea2cf9c2c8e77d5a` (tree `9850e39e0a76eef4b8477ca9da536265677b5787`). This guide is a later documentation supplement. Fetch/read it separately; do not advance the executable checkout or alter bve.project.json to obtain newer documentation. Record both the executable commit and the exact documentation commit used in local setup notes. For another release, use its explicitly approved compatible instructions instead.

The pilot uses configuration 2 and the nine-file `visual-os-ops-v2` instruction inventory. No migration, release or automatic updater is implied. Application initialization installs the pinned instructions; the setup session creates the small local documentation layer below. This supplement does not change application code or pinned instruction bytes.

## One private folder is the Codex project root

Keep the software checkout outside the private project. Add the private root itself to Codex, not its runtime directory, the software repository, or a parent containing other projects. Each private project has its own stable BVE identity and local Codex association.

```text
<software-checkout>/                 exact approved executable, unchanged

<private-project>/                  add THIS folder to Codex
  AGENTS.md                         BVE template + local routing block below
  README.md                         project entry, launch/resume and role links
  bve.project.json                   application-owned identity and pins
  instructions/                     application-installed compatible inventory
    AGENTS.md                       shared role routing
    project-AGENTS.template.md
    conductor.md
    butler.md
    generator.md
    bootstrap.md
    foreman.md                       defined, inactive
    reviewer.md
    manifest.json
    local.md                        user-owned additions and local doc routing
  .ai/                              setup-session-created, private references
    PROJECT.md                      non-secret identity/path and Codex mapping
    SETUP.md                        exact commands, evidence, stop/resume
    CAPABILITIES.md                  observed vs unavailable/unknown tools
    TESTING.md                      observations and reproduction evidence
    roles/
      conductor-start.md            resolved local Conductor launch prompt
      butler-start.md               resolved bounded Butler launch prompt
      generator-start.md            job-bound Generator launch template
  references/                       private input assets
  staging/                          application-owned job transport
  runtime/                          application-owned records and originals
  exports/                          selected private evidence bundles
  backups/                          complete closed-root backups
```

`AGENTS.md` is the instruction entry point. `.ai` names here are BVE conventions, not special Codex configuration. Do not fabricate a `.codex/project.json`, edit Codex's internal state database, create a global configuration, or initialize/publish a Git repository to simulate registration. Private runtime and assets stay outside source control. There is no requirement to create a `.codex/config.toml` or duplicate AGENTS files in every data folder.

## Setup sequence

1. Inspect existing software, roots and services. Follow [INSTALL.md](../INSTALL.md) and [the setup guide](project-structure-and-setup.md) using the exact authorized executable, locked dependencies and supported Node. Preserve unrelated checkouts and existing projects. Install the supported controlled browser without an image-generation call.
2. Resolve an explicit private destination. Run supported `init` then `inspect`; verify stable project/runtime identity, software path/commit and all instruction hashes. Never edit pins or manually replace an incompatible root. An existing unrelated/nonempty destination needs an explicit destination decision.
3. Create missing local README/.ai reference files with actual resolved values. Preserve and reconcile existing files rather than overwriting them. Link to installed role instructions instead of copying their bodies. Keep notes concise; they are locators and observed evidence, not a second authoritative job/review database or task queue.
4. Add the routing block below once to the **private root** AGENTS.md, preserving its installed template and user content. This user-owned file may have additions; the pinned `instructions/project-AGENTS.template.md` must remain byte-identical. Add links to the local references in `instructions/local.md`. If the legacy `instructions.local.md` also exists with conflicting content, preserve both and resolve explicitly before writing; do not silently choose one. Run `inspect` again to prove all pinned instructions still pass.
5. Register the folder as a local Codex project through an available supported app tool or the app's project/folder UI. Inspect existing projects first and reuse an exact path match. Available list/move-chat tools do not necessarily create projects. If no supported registration control is available to the agent, give the user the exact folder and the single action to add/open it as a project; label **Codex registration pending**. Finish independent filesystem/setup work while waiting. Never claim registration from a folder or manifest alone.
6. Read back the app's project association and path. Move the current local setup chat into that project if supported and authorized, or create the explicitly requested Conductor chat in the registered project. Verify its actual working directory and access to the selected software checkout. Merely moving a sidebar item may not change filesystem access or working directory; if needed start the Conductor from the selected project instead. Do not use a live-data worktree. Keep the BVE user project distinct from the BVE software-development project.
7. Run the bounded offline checks in disposable roots and start the pilot's **visible** `review-browser` owner on loopback, as described in the setup guide. Verify project identity, adapter and actual returned URL. Keep the owning terminal identifiable and provide exact stop/resume commands. Test fixtures must not populate the user's pilot to disguise missing live capability.
8. Read back root AGENTS, local routing, reference paths and the Conductor prompt from the registered project. Establish role sessions under the operator's assignment; report each as active, idle/completed, prepared-only or unavailable. An instruction file is not an agent. The initial Conductor owns the conversation, Butler performs bounded deterministic work, Generator runs serially only for an authorized job, and Foreman remains inactive. No scheduler or implicit retries.
9. Provide a readiness receipt, then begin the Conductor conversation with the user's existing brief or ask what page/visual to create and what it should communicate. Do not finish at installation instructions. Obtain any missing operation/source/attempt allowance before generation. No paid fallback, new account or credential provisioning is implicit.

## Private root AGENTS addition

Append once under this heading; retain prior instructions. This is local routing, not a replacement for the compatible installed roles:

```markdown
## Local Codex project routing

This private BVE folder is the local Codex project root. Read bve.project.json
through the compatible BVE inspector, then instructions/AGENTS.md and the
instruction file for your assigned role. Read instructions/local.md when present.
Use .ai/PROJECT.md for non-secret local mappings, .ai/SETUP.md for verified
launch/resume, and .ai/CAPABILITIES.md for observed tool availability.
Role launch prompts are in .ai/roles/. Read .ai/TESTING.md only for pilot
observations/reproductions. Revalidate dynamic state through BVE; these notes
and chat history never replace canonical jobs, reviews or receipts.
The user-facing creative chat is Conductor. Do not assume another role is
running from the presence of its prompt. Preserve all pinned instruction bytes.
```

## Required local file contents

| File | Minimum useful content |
|---|---|
| README.md | Project purpose; links to AGENTS and local references; selected software path; how to start/stop/resume; where the human reviews. No credentials. |
| .ai/PROJECT.md | BVE project/runtime IDs, private root, software path/commit, instruction version, documentation source commit, and observed Codex project ID/path and Conductor chat identity if exposed. Registration status must be explicit. |
| .ai/SETUP.md | Actual Node/browser versions, dependency/build/inspection results, evidence paths, exact PowerShell commands with resolved paths, owner/terminal identification, backup/resume procedure. URLs/ports are last observed and must be refreshed after restart. |
| .ai/CAPABILITIES.md | Filesystem/software access, controlled browser availability, worker mechanism, image-tool and original-byte delivery access, configured model preferences and actual availability. Separate supported, observed, unknown and unavailable; never infer image model from worker model. |
| .ai/TESTING.md | Dated human-test observations, exact candidate and bounded reproductions/evidence. Start with no human test performed. Link canonical refs; no copied transcripts, fabricated success or parallel task ledger. |
| .ai/roles/conductor-start.md | Exact local project/software mappings; read root AGENTS, installed shared/conductor instructions and local references; read pending canonical state; address the user; no automatic dispatch. |
| .ai/roles/butler-start.md | Same mappings; installed shared/butler instructions; bounded assigned operation, owning service access, exact refs and return destination. Initial assignment is read-only identity/pending inspection. No database edits or generation. |
| .ai/roles/generator-start.md | Same mappings; installed shared/generator instructions; placeholders clearly requiring an actual canonical job/spec/source/staging identity and attempt allowance before launch. One bounded job, original bytes, documented delivery schema, no implicit retry. |

Resolve available static paths when writing the role prompts. Leave future job IDs explicitly unassigned rather than inventing them. Use the actual host's supported session mechanisms and authorized model choices. If worker creation or image delivery is unavailable, provide the prepared prompt and report the limitation; do not claim a complete live loop.

## Completion and resume

Setup is complete only when the folder/instructions exist, app registration and Conductor context are verified, inspection passes, the visible browser is usable, and role/capability states are honestly reported. If registration requires a human UI step, report partial completion and resume after that step; do not discard the prepared project. On later sessions read the same root instructions and inspect canonical pending state before work. Do not recreate identities, respawn jobs from chat memory or upgrade the executable to match a newer guide.

Official reference: Codex recognizes [AGENTS.md instructions](https://learn.chatgpt.com/docs/agent-configuration/agents-md). The additional .ai structure above is this project's explicit onboarding convention; it is not a claim that Codex automatically interprets those files.
