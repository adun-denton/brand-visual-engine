# Coordinator-authored v2 operations source

This immutable source bundle accompanies BVE-VOS-03 revision 1. It is staged documentation, not the active instruction set at the accepted executable base. The existing `instructions/` directory remains v1 until the coding session integrates v2 with matching checks.

Verify `files.json` before promotion. Its paths are relative to this directory and destinations are repository-relative. Promote exact bytes to the listed destinations. `instructions/manifest.json` pins the complete v2 role inventory. The coding session must align bootstrap's explicit inventory/version checks; changing markdown alone is insufficient. Test fresh roots and safe refusal of incompatible old roots; no migration.

`docs/project-structure-and-setup.md` is the coordinator-authored operational structure guide. Promote it, then update its explicitly provisional new-interface section to match tested commands as implementation completes. Role files describe responsibilities and gate each new operation on actual supported capability; do not edit the immutable source to disguise a runtime mismatch. Report material role/authority changes to the coordinator.

Root repository AGENTS.md governs development. `instructions/AGENTS.md` routes operational roles. `instructions/project-AGENTS.template.md` seeds only a new private project's root AGENTS.md. Local additions remain user-owned. Foreman and independent Reviewer are documented roles, not automatically spawned agents. No cloud session, model call, merge or release is authorized by reading these documents.
