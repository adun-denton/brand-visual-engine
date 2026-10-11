# Scoped MCP permission repair

The actual account trial at `7a500088e504e8e9ded425f09bf89ce809a786b8` completed a text
exchange, but the app-server denied both attempted BVE tools before execution:
`MCP tool call requires approval, but approval policy is never`. No design candidates
were created. This R5 candidate repairs tool permission configuration and distinguishes
sign-in storage, current connection health, protocol completion and candidate success.

## Narrow configuration

`src/service/chat-mcp-config.ts` supplies the same BVE server configuration to the account
driver, catalogue probe and execution probe. `enabled_tools` contains only the six names
from `chatTools`; those tools have `approval_mode: approve`. The server default is `prompt`.
Global `approvalPolicy: never`, the read-only sandbox and rejection of incoming client
approval/execution requests remain. Unknown tools are excluded. No shell/browser/apps/agents,
generic filesystem/account tools, human acceptance or additional MCP server are enabled.

The existing bridge still binds one exact frozen project/turn grant. Schema validation,
stale-turn/current-version checks and action idempotency remain the final service boundary.
Per-tool permission lets those already scoped actions reach it; it does not bypass it.
Official [MCP guidance](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) and the
[configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
describe the allow-list and per-tool overrides. Effectiveness is tested against the pinned
binary rather than inferred from the documentation or an emitted catalogue.

## Actual binary, synthetic provider

`scripts/chat-permission-preflight.ts` runs the actual `codex-cli 0.162.1` app-server with an
owned loopback Responses receiver, isolated process home and synthetic token. It uses the
production bridge and the production service's exact grant closure in disposable runtimes.
A held fixture turn supplies the active service context; no account transport, real policy,
credential or durable live budget is read or consumed. The account object is selected only
to obtain its grant closure and is replaced before any send. The provider responses are
authored fixtures, not actual model inference or returned live design candidates.

Six controls cover the permission boundary:

| Control | Required evidence |
| --- | --- |
| Original configuration without overrides | Actual approval rejection, zero action receipts |
| Permitted read and write | Real bridge executions, two completed action receipts and the exact brief change |
| Duplicate write | Original result reused; no third action or mutation |
| Foreign grant | HTTP/grant rejection; zero actions |
| Stale grant | Active-turn rejection; zero actions |
| Unknown tool and forbidden shell tool | App-server rejects unsupported calls; zero actions |

The positive/duplicate checks share one control, and unknown/forbidden use separate controls.
Every scenario also checks the six-tool catalogue and resource-only discovery helpers.
No candidate, image job or human acceptance is manufactured. The original separate catalogue
probe remains and uses the shared configuration. CI installs the exact binary without scripts
or dependency/lockfile changes and runs the execution check on Windows and Linux.

```sh
npm ci --ignore-scripts
npm run build
npm run typecheck
npm test
# For the automatically located x64 Windows/Linux test binary:
npm install --ignore-scripts --no-save --package-lock=false @openai/codex@0.162.1
npm run test:chat:permissions
```

Alternatively set `BVE_CODEX_BINARY` to the exact installed executable. On Windows use the
native `codex.exe`, not a command shim. `BVE_EVIDENCE_DIR` selects receipts. The separate
`npm run test:chat:protocol` catalogue probe requires the binary variable. Run the retained
checks in `.github/workflows/verify.yml`, including all nine browser workflows.

## Account and completion copy

The initial workspace now polls a guarded local status endpoint even before a project exists.
Missing sign-in, locally stored credentials and locally expired access tokens have distinct
labels. Stored sign-in is explicitly **connection unverified**; no network health check or
inference occurs during polling. Driver configuration alone no longer displays account health.
Injected fixture transport remains visibly a fixture. Status contains no tokens, identity or
policy data. OAuth completion says sign-in saved. A completed text-only turn explicitly says
no design candidates were created; turns with candidates report their reviewable count.

HTTP tests cover protected synthetic credential storage and initial status, plus completed
text without candidates. Browser controls cover all three sign-in labels before a project
exists, fixture labeling and desktop/narrow rendering. Existing form-free and adverse browser
assertions, cancellation and shutdown/closed-copy controls remain.

## Review boundary and rollback

This return performs zero account/model/image/paid/GPU calls. The original actual trial and
consumed reservation are untouched. One of three authorized attempts remains consumed;
the other two are not used or treated as authorization for a retry. Original policy evidence,
protected runtime and valid backup remain with the coordinator. No policy digest reset,
credential copy, live retry, model substitution, merge or deployment occurs here.

After independent repair acceptance, separately authorize a bounded live continuation and
inspect actual candidate creation/refinement and model-thread resume/interrupt. Synthetic
execution proves this pinned permission/bridge path; it does not prove actual model behavior,
entitlement, an upstream model revision, live design quality or full Task015 acceptance.

Exact source head/tree, observed checks and CI receipts belong in PR10 and the private return.
Task015 stays in progress. A code-only R5 revert restores the permission failure. Accepted
runtime rollback uses accepted main plus its matching complete protected runtime backup;
do not downgrade the evolved live runtime in place or restore its superseded backup.
