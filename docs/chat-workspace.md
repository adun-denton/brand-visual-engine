# Chat workspace

Conversation is the default entry point. Send a description to create a draft workspace without a
brief form. When a supported account connection is available, scoped tools prepare and validate page
alternatives. Unknown business facts remain unresolved; creative assumptions belong in the brief
summary. A disconnected message is retained without inventing alternatives.

Select a candidate, ask for a refinement, Compare, review any listed findings, and Accept the exact
candidate. Export uses the accepted pointer even when later proposals exist. Page acceptance and
Website acceptance remain separate. Advanced controls and manual exchange are optional compatibility
tools. They use the existing Workspace/Pages state. A running turn cannot overwrite a saved control
change; optional unsaved controls survive a conversation refresh in the same view.

The conversation persists across views and service restart. Send is deliberate; navigation makes no
model call. Stop interrupts only the owned turn. Browser polling delivers sanitized reply deltas;
the backend consumes app-server notifications over owned stdio. Success requires protocol completion.
After an interrupted process, uncertain turns and action receipts remain; mutations are not replayed.

## Images

Choose an image in the canvas and drag a rectangle or circle/ellipse on the original. Bounds and mask
bind the exact original dimensions and page/media versions. Keyboard selection covers the whole image.
Attach references deliberately. The optional preset selector overrides the assistant's preset for the
same frozen request; otherwise the assistant chooses a meaningful supported preset.

This build has no executable production image engine. Prepared jobs say **image engine unavailable**.
The injected image transport is test-only. A returned native image can be attached to its job without
typing JSON or provenance. Originals must decode, match dimensions, and preserve pixels outside the
mask. Unknown model/settings/usage stay unknown. The original starts as a reference candidate; explicit
usage permission makes it placeable. Choosing it creates a preview revision, retaining accepted pages.
Existing asset tools permit further review, comparison, and reuse. No ComfyUI/GPU run is implied.

## Account setup gate

The account adapter uses BVE's own OAuth registration, issued client ID, state, nonce, PKCE, signed-token
validation, subject binding, and renewal. It never reads another application's credentials. Account
files are private backend data, outside browser bundles, design artifacts and Git. No API-key fallback,
credit purchase/reset, account switching, or unattended provider retry is implemented.

Live eligibility and repository licensing have **not** been independently determined. The account path
is disabled by default. Before login or a real turn, the coordinator must record supported local-use
eligibility, license review, account selection, selected model, fresh bounded turn count and no-paid
policy. Windows account use is additionally gated on a private ACL review; offline UI/tests run there.
The source currently supports only the restricted `gpt-6-luna` profile tested with Codex `0.162.1`.
Another model requires its own effective capability probe; there is no model substitution.

For an independently authorized POSIX trial, set `BVE_CODEX_BINARY` to the exact `codex-cli 0.162.1`
binary and `BVE_CHAT_POLICY_FILE` to an absolute, protected file outside Git (mode 0600). Its fields are
`version: 1`, `eligibleLocalUseReview`, `licenseReview`, `model`, `maxTurns`, `noPaid: true`,
`allowLogin: true`, and `toolBoundaryReview`. Review fields reference real coordinator decisions;
their presence is not a legal determination. The durable budget counts attempts and survives restart.
Changing a policy to reset a budget is not authorized recovery. Use Continue with ChatGPT for interactive
consent. A catalogue entry or successful login does not establish completed-turn entitlement.

Run trial code against a fresh runtime outside the checkout and an unused loopback port. Preserve
existing user runtimes. Locked setup uses `npm ci --ignore-scripts`, `npm run build` and the existing
Node 24.19.x runtime. `BVE_RUNTIME_ROOT` and `BVE_PORT` select the independent trial root and port.

## Service boundary and recovery

`Chat` wraps Workspace/Pages rather than introducing another design store. Private SQLite records hold
project/thread mapping, exact focus, transcript, turn IDs, staged candidate focus, image jobs and action
receipts. Scoped MCP exposes six tools: read_context, update_draft, prepare_design, submit_candidates,
focus_candidate, prepare_image. The assistant cannot accept artifacts or forge permissions.

The owned process has an isolated runtime working directory and credential environment. Experimental
`environments: []` is pinned to 0.162.1. The restricted catalogue disables execution and delegation;
server approval requests reject. MCP resource discovery can return no resources, and the BVE MCP
server exposes no filesystem resource. See [protocol evidence](chat-workspace-result.md).

Disconnect/quota/auth failures retain work without retries or fake successful turns. Resolve an
uncertain turn by inspecting receipts and history, then choose a fresh deliberate action. Rollback
stops only owned processes and disables the additive adapter. Close and back up the **whole** evolved
runtime, keeping conversations/candidates separate; restore baseline code with its matching full
runtime backup. Never downgrade the current runtime in place or delete user history.

Official interfaces reviewed for this implementation:

- [App-server](https://learn.chatgpt.com/docs/app-server)
- [Local-use sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Plan provider configuration](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)
- [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)

These references establish interface guidance, not this account's eligibility or a verified live turn.
