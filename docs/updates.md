# Version compatibility and supported updates

Status: release/update contract; updater implementation is deferred beyond BVE-VOS-01.

Ordinary installs use approved stable releases, each with application version, exact commit, supported environment, bundled instruction version/hash, readable/writable project and record-format compatibility, migration requirements and archive checksums. SQLite's physical schema version alone does not establish packet compatibility.

Check for updates on explicit request or at an enabled documented startup interval. A failed or offline check must not block local review. Checking is read-only. Applying changes follows the user's update policy; disclose migration, installation and additional permission requirements.

Prepare a new version-specific installation before changing the active one. Verify bytes and dependencies. Quiesce affected owned services; create and verify a complete closed backup when needed. Apply only explicitly supported, authorized migrations. Verify actual app/project identity and health before recording successful activation.

Keep a durable update journal outside replaceable software. Before activation, resume/discard the incomplete candidate while preserving the old install. After activation, recovery depends on whether data formats changed. Never point old readers at evolved records merely because the database opens.

If rollback requires restoring a backup, restore it with matching code into a separate recovery root. Preserve the evolved runtime and disclose work since the backup. Do not overwrite it.

Update application and bundled instructions compatibly together. Preserve user-owned local additions; report conflicts. No independently downloaded latest prompt pack, generic migration framework or silent database rewrite is required.

Local runtime does not depend on Drive. Export/closed-backup synchronization is different from sharing active SQLite files.

Release workflow and clean-machine/update tests must be independently accepted before a public release. Unmerged branches and passing CI are not release approval.
