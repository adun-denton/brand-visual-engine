# BVE-VOS-02 revision 1 — PR23 F1/F2 repair

## Identity and disposition

- Repair starts from reviewed head `dda6fc9ff32adaa6bd76005cd35637467d7c3981`, tree `dcc1090697af589623c88ae59e8f2562be279438`.
- Approved packet remains revision 1 at `bf47c94969f6efec88373a3ef0b31ad206a81c37`. Accepted dependent base remains `46ae9bf89efe58c2c4d8b1f368a703256a60e4fa` on `codex/bve-visual-os-bootstrap-intake`.
- Existing [PR23](https://github.com/adun-denton/brand-visual-engine/pull/23), branch `codex/bve-visual-os-review-submission`, stays draft/unmerged. Remote head/base matched the expected identities before repair; no subsequent work was reset. The exact published repair commit/tree and completed CI identities are returned in the PR body, avoiding a self-referential commit.
- Codex implementation candidate only; no extra workers. Independent acceptance and private task status remain with the originating coordinator. The original result is not an acceptance claim.

## Changes

**F1 — historical discovery.** The owned-page catalog includes production iterations across revisions of the same stable page identity and returns each iteration's exact original work-unit reference. State reads and all freshness/write gates remain exact. The review picker merges these historical targets with current iterations; older page versions are explicitly labeled historical/read-only. Drafts, submissions, comments, source regions and exact original bytes remain readable. Save, Submit, edit-as-new and source editing are unavailable on stale targets; no record is rebound. Submitted-action reconciliation retains its existing identity even if scope later changes.

Old project/page/iteration links select the current revision of that owned stable page, then the historical review target. This also works for a non-default page. Ordinary discovery needs no old URL or manual record reference. A historical saved draft exposes originals through its stored draft reference; unavailable originals remain explicit. Other pages/projects cannot acquire those reviews through discovery.

**F2 — document navigation.** Same-app document links, including BVE home and Legacy semantic workspace, pass through Save-and-continue / explicit Discard / Stay. Native before-unload protection covers dirty feedback and pending/unresolved actions. Native warnings never save or submit. App navigation cannot discard an unresolved action; reconciliation retains the same action key. A successful explicit Save precedes leaving; failed/conflicting saves keep the form. Discard removes only the unsaved browser copy and reopens the durable baseline.

Source/test files: `src/service/reviews.ts`, `src/web/production-review.ts`, `src/web/visual.ts`, `tests/reviews.test.ts`, `scripts/review-browser-check.ts`. Operator updates: `INSTALL.md`, `docs/operator-guide.md`; the original result links this repair report. New evidence is under `docs/evidence/BVE-VOS-02-repair/`. Lockfile, packet/source bundle, role instructions, installation identity policy, kernel submission authority and CI workflow are unchanged.

## Executed evidence

Fresh disposable authored roots; Node 24.19.0 on Linux, locked installed dependencies. Browser: Playwright 1.58.2 with official Chrome-for-Testing headless shell 145.0.7632.6. Its downloaded ZIP MD5 matched `e24ac3e7452aab1e4db871f1c153180e`. No live provider/model/account/GPU/agent call or user-root operation occurred.

| Check | Local result |
|---|---|
| Typecheck and build | Passed |
| Review + bootstrap + intake focused unit suite | 29 passed, zero failed/skipped |
| Shared full unit suite | 430 total; 429 passed; zero failed; one existing Windows-only ACL skip |
| Expanded review browser | Passed retained review gates plus all F1/F2 cases below |
| Production browser | Passed three authored proposals, both layouts, comparison and cold reopen; zero browser mutations |
| Combined compatibility | Passed |
| Native / native-repair / native-resolution compatibility | All passed |
| Diff whitespace | Passed before publication |

F1 regression evidence covers a submitted v1 review and a separate saved v1 draft after valid v2 page revision; normal picker discovery without a historical URL; old submission and draft URLs; app cold restart with a fresh browser context; non-default page links; read-only controls; exact originals, region/note preservation and page/project isolation. The service test independently confirms returned original refs, exact stored objects, unchanged canonical state, stale-write refusal and cold reopen. Exact v2 state queries do not silently read v1 data.

F2 uses the real header anchor handlers. Stay retains newer text, Save-and-leave reaches `/legacy` after durable persistence, and explicit Discard reaches `/visual` then recovers the saved baseline. Native reload and close warnings are actually observed and cancelled with text retained and no implicit save. An unresolved committed submission blocks both header discard/save, warns on reload, retains its action, and recovers its single canonical submission after explicit native reload acceptance.

[Browser summary](evidence/BVE-VOS-02-repair/summary.json) and [verification/checksums](evidence/BVE-VOS-02-repair/verification.json) accompany three visually inspected screenshots:

- [Historical saved draft after page revision, narrow](evidence/BVE-VOS-02-repair/historical-draft-page-revision-narrow.png)
- [Historical submitted feedback after page revision, desktop](evidence/BVE-VOS-02-repair/historical-submission-page-revision-desktop.png)
- [Header navigation guard with unsaved feedback, narrow](evidence/BVE-VOS-02-repair/document-navigation-stay-narrow.png)

Local evidence identifies the repair working tree; both-platform CI executes the exact published head and retains its complete browser artifacts. The unchanged Ubuntu 24.04 / Windows 2025 workflow includes the expanded review script and all retained checks. Completed run/job/count/artifact identities are read back and included in the PR return; local Linux execution is not Windows evidence.

Test refinements: the initial new service fixture used a draft ID without the required prefix; correcting that authored ID made the test exercise the intended behavior. The first native-reload probe waited for a completed navigation after cancelling before-unload, which correctly never navigates and timed out. The probe now initiates reload through the browser document, observes the actual before-unload dialog, explicitly dismisses/accepts it, and verifies retained text or durable recovery. No application assertion, existing security gate or workflow timeout was relaxed.

## Limits and rollback

Browser-owned unload dialogs depend on browser policy and user activation; browser/OS termination can bypass them. They offer a native leave warning, not the app's Save choices. Explicit Save/Submit remains necessary for durability; there is no autosave. Canonical configuration/records must remain structurally intact for historical discovery, even if media is unavailable. Operational verification remains pending / not implemented. This adds no migration, capture/clipboard, live readiness or acceptance capability.

Publication uses an expected-head non-force update on the existing draft PR, followed by remote content/tree readback. No merge, release, deployment, extra worker, private project/task change or acceptance write is authorized or performed.

Rollback: stop the owner and preserve the complete closed candidate test root. Use reviewed `dda6fc9ff32adaa6bd76005cd35637467d7c3981` with its matching earlier root to recover pre-repair behavior, or accepted `46ae9bf89efe58c2c4d8b1f368a703256a60e4fa` with its matching earlier root. Never downgrade an evolved root in place or rewrite recorded installation identity. Documentation publication can be reverted independently; preserve the original and repair evidence when reviewing application rollback.
