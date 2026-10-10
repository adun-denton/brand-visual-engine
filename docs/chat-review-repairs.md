# Chat boundary review repairs

The review of PR10 at `1c429f40107f8099608faa9c29d6f78635c293d0` reproduced three
boundary failures. This repair candidate addresses callback routing, cancellation during startup,
and asynchronous attachment ownership. The new exact commit/tree and OS CI receipts are pinned
in the PR and coordinator return. Acceptance remains with independent review.

## Changes and adverse verification

| Review finding | Resulting behavior | Regression |
| --- | --- | --- |
| BVE-015-R1 | The exact GET `/auth/callback` accepts foreign-site document navigation at the expected local Host and delegates to the existing one-time OAuth validator. Ordinary application/API guards remain enforced. | A real browser navigates from a disposable foreign site with `Sec-Fetch-Site: cross-site`; valid synthetic state reaches validation and returns 200, wrong state returns 400. Wrong Host, foreign GET/API/POST/tool requests and non-navigation callback requests return 403. |
| BVE-015-R2 | Every asynchronous startup stage observes Stop. Image inputs are prepared separately, followed by a signal check before reserving/sending `turn/start`. Startup cancellation settles promptly, releases grants and closes owned processes. Late events cannot change persisted receipts. | Deferred auth, initialization, thread startup and image preparation; already-aborted entry; abort with a sent start request; known running-turn interrupt; completed control. No start or budget reservation occurs for cancellation before initiation. A sent reservation is retained, with no refund claim. |
| BVE-015-R3 | Project, image job and request context are frozen before file reading. A project change before upload cancels with a notice. A change after initiation keeps bytes only in the original project and suppresses inclusion/refresh in the new conversation. | Reference and returned-job uploads each pause during file reading and upload-response delivery. Every switch waits for the new active project. The destination project receives zero media and zero reference handles. Returned-job identity remains original. |

The asynchronous chat handler audit also binds Send, Stop, candidate selection/comparison, permission,
placement, acceptance and polling to a project revision. Switching away and back does not make an old
completion current. Account connection is global; its sign-in URL handling is unchanged.

## Evidence and reproduction

Node 24.19.0, locked installation with scripts disabled, build, typecheck, **185** unit/service tests
(zero failed/skipped), both smokes, serialized fixture consistency and whitespace validation passed.
All **nine** browser workflows passed locally with Chromium 143.0.7499.0. The chat workflow retains its
12 normal scenarios and also invokes the callback and four upload boundary controls. Windows/Linux
CI executes the same checked-in suite; exact-head outcomes are in the return receipt.

```sh
npm ci --ignore-scripts
npm run build
npm run typecheck
npm test
npm run smoke
npm run smoke:design-os
node scripts/serialize-design-fixtures.ts
git diff --exit-code -- fixtures/design-os.json
git diff --check
npm run test:browser:chat
```

Use the full nine browser commands in `.github/workflows/verify.yml` for the retained regression run.
Playwright's Chromium must be installed; an existing compatible binary may be selected with
`BVE_CHROMIUM_EXECUTABLE`. Browser evidence uses `BVE_EVIDENCE_DIR`. `adverse-receipt.json` records
observed callback headers/statuses and upload destination/job identities. The original OAuth signed
fixtures continue to validate state, PKCE, nonce, client, signature, expiry and plan permission.
The new browser callback test replaces only token validation with a synthetic validator; it does not
perform a real authorization exchange. The account-driver tests inject only the process/version
boundary and synthetic auth/media, exercising the production driver's ordering without a real binary
or model. The production constructor retains the pinned binary and owned process defaults; no
browser/API injection capability was added.

## Limits and rollback

Actual account/model/image/paid/GPU calls during repairs: **zero**. These checks do not prove account
eligibility, entitlement, real streaming/resume/interrupt, observed model/usage provenance or designer
acceptance. Windows account use remains gated pending its private credential ACL boundary. No image
engine, account trial, merge, deployment or release is authorized by these repairs.

The installed-binary catalogue probe was not rerun for this repair: restricted configuration, model
catalogue, scoped MCP tools, grant authorization and protocol pin are unchanged. Its prior receipt is
implementer evidence, separate from these new synthetic ordering and real-browser boundary tests.

Review the exact returned head in an isolated checkout and disposable runtime roots. Preserve existing
user runtimes and accepted artifacts. Roll back runtime use to accepted main
`8d61b09d21089f64f496c24da4fc671797c81407` with a matching complete private runtime backup. Reverting
only this repair restores the reviewed PR head and its three known defects; it is not an accepted
release rollback.
