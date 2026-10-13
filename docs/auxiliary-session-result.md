# Auxiliary session implementation evidence

Task `TODO-BVE-20261013-023` adds optional scoped auxiliary interaction on
`codex/bve-vnext-v08-auxiliary-session`, directly from accepted V07
`9c1af294cb025a9dcc0212795cf602a356a1a771`, tree
`17531fbb31a98477935c9d7f12b4e3f6c822e705`. The dependent draft targets
`codex/bve-vnext-v07-offline-reconstruction`. Exact published head/tree and CI links
are provided in the review return and PR. Independent acceptance remains pending.

The initially closed panel shows explicit typed focus, inclusion policy and fixture
availability, with inspectable draft diffs and separate Apply/Dismiss. A fresh offline
operation bridge reuses V07 semantic intake atomically. Chat-closed workflows remain
usable. [Contracts, authority, lifecycle and rollback](auxiliary-session.md) describe
the implementation. [Source manifest](evidence/auxiliary/source-manifest.json) records
28 byte-identical upstream test files and retained contract/control blobs. Dependencies
and lockfile are unchanged.

| Gate | Local result | Evidence |
|---|---|---|
| Locked install, typecheck/build, smokes, fixture equality, whitespace | Pass on Node 24.19.0 | [Results](evidence/auxiliary/local-results.json) |
| Full units | 343 total; 342 pass; one retained Windows-only skip on Linux | [Unit log](evidence/auxiliary/unit-tests.txt) |
| New units | 24 pass: focus/context isolation, runtime/persistence/HTTP forgeries, draft races, action replay, loss/omission, cancellation/timeouts, shutdown/reopen, bridge atomicity and R1 guard | [Tests](../tests/auxiliary.test.ts) |
| Retained browsers | All 16 commands pass; reconstruction rerun after final preparation-lifetime changes | [Results](evidence/auxiliary/retained-browser-results.json) |
| New browser | Both layouts; 1440×1000 and 390×844; keyboard focus; closed/unavailable; diff/Apply/Dismiss/conflict; held reply/new selection; separate bridge; chat-closed acceptance/export; cold reopen | [Results](evidence/auxiliary/browser-results.json) |
| New driver seam | Authored injection; exact image roles/order/digests, fresh thread, excluded history, scoped catalogue/schema | [Protocol](evidence/auxiliary/session-protocol.json) |
| Parser | 3,067 cases; 777 accepted; 2,290 rejected; zero divergences | [Parity](evidence/auxiliary/parser-parity.json) |
| Existing memory | Omission rollback, historical/latest loss and immutable downloads pass | [Controls](evidence/auxiliary/original-memory-controls.json) |
| Pinned offline permissions/protocol | Codex 0.162.1; six permission controls and effective catalogue pass; synthetic loopback only | [Permissions](evidence/auxiliary/permission-execution.json), [catalogue](evidence/auxiliary/effective-tools.json) |
| Retained compatibility | V05/R8 and V06 copies preserve original rows/media/exports | [Combined](evidence/auxiliary/combined-compatibility-summary.json), [reconstruction](evidence/auxiliary/reconstruction-compatibility-summary.json) |
| Exact V07 closed-root migration | Six original tables, nine files, exports/chat/capsules unchanged; old root has empty auxiliary history; additive writes and cold reopen pass | [Summary](evidence/auxiliary/migration-summary.json), [full inventory](evidence/auxiliary/v07-before-after-inventory.json) |
| Original R1 probe | Mirrored destination rejects; packets/selections/events unchanged before, after and cold reopen | [Probe](evidence/auxiliary/r1-acceptance-probe.json) |

Screenshots are public-safe authored fixtures, reviewed for wrapping, visible diffs
and control availability. They demonstrate interaction, not model fidelity or designer
acceptance.

- [Desktop diff](evidence/auxiliary/screenshots/proposal-diff-desktop.png)
- [Narrow historical diff](evidence/auxiliary/screenshots/proposal-diff-390.png)
- [Contact sheet](evidence/auxiliary/screenshots/auxiliary-sheet-1440.png)
- [Filmstrip](evidence/auxiliary/screenshots/auxiliary-film-1440.png)
- [Revision conflict](evidence/auxiliary/screenshots/draft-conflict.png)
- [Narrow preparation](evidence/auxiliary/screenshots/reconstruction-draft-390.png)
- [Separate bridge](evidence/auxiliary/screenshots/operation-scoped-bridge-desktop.png)
- [Unavailable production after reopen](evidence/auxiliary/screenshots/production-unavailable-reopen.png)

Implementation is additive: kernel context/gate modules and edits establish context/gates and
the ephemeral permit callback; website contracts/memory summaries add primary kinds;
the service adds the bounded controller, tool schemas, pure image encoder and atomic
V07 intake companion seam; web integration adds panel/portal and preparation capture;
three authored scripts and one new test file provide offline evidence. The manifest
lists all changed paths. Legacy chat contracts, account driver, semantic grammar and
original probe remain byte-identical.

Development failures were corrected without weakening upstream assertions: new record
allowlists/dependencies, fixture call shapes, proposal ordering, preparation redraw,
cancelled late-output classification and supported dated-capsule retrieval. A new
image-order test initially reused one media ref in both roles; the unchanged V07
duplicate-resource validator correctly rejected it, and distinct authored media fixed
the fixture. One browser rerun omitted the local Chromium override and failed before
launch; the rerun with the documented override passed. A checkbox-removal browser
assertion initially tried to click inside a collapsed section; opening that section
fixed the check. Full final units and browser
checks supersede those development attempts. Local Chromium 153 is disposable;
exact-head CI installs the browser pinned by Playwright 1.58.2.

CI preserves every previous gate, checks out the PR candidate head explicitly on
Ubuntu 24.04 and Windows 2025, and adds auxiliary migration/browser and the original
R1 probe. Artifact evidence binds browser output to the candidate SHA. The final
platform conclusions and artifact digests must be read from the exact-head run
returned with the PR, not inferred from these local results.

Actual account/model/image-provider/GPU calls and protected runtime-root accesses are
zero. Production visual transport is unavailable. No local generation, merge,
deployment or canonical task completion was performed. Real transport provenance/
parser extensions and host-specific inventory/binding/generation remain inactive
future work requiring their own concrete scope. Independent review belongs to the
originating Work reviewer.
