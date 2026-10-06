# Work packet template

This is a schema for one bounded assignment, not a project queue. Filled packets with private context
are passed privately and are not committed to this public repository.

## Identity and authority

- Packet ID:
- Canonical MSB task ID and link:
- MSB commit and relevant specification sections:
- Software base commit and target branch:
- Assigned implementing model/tool; approved delegation, if any:
- Coordinator and acceptance owner:

## Change contract

- Objective and expected user-visible behavior:
- Included scope:
- Excluded scope:
- Allowed files/modules and interface constraints:
- Dependencies and their verified evidence:
- Source references/fixtures and disclosure limits:
- Open decisions that must return to the coordinator:

## Execution and verification

- Setup prerequisites and commands (or a bounded instruction to establish them):
- Acceptance criteria from the pinned canonical task, with provenance:
- Checks to run and expected observable outcomes:
- Required visual review and reviewer:
- Allowed provider calls, external writes, and cost/run budget:
- Failure/retry/cancellation expectations:
- Rollback or recovery path:
- Required result artifacts and private/public destinations:

The canonical task remains authoritative. Any scoped copy here is a pinned execution snapshot and
must not become an independently maintained task record. The coordinator verifies that the current
task still matches the packet before accepting implementation.
