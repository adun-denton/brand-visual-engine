# Provider boundaries

Documentation review: 2026-10-06. These are adapter requirements and evidence boundaries, not a
claim that live provider adapters ship. The [local workspace](workspace.md) adds manual native
export/import with decoded files and immutable original-job bindings. It does not call a host tool.
Only deterministic fixtures execute; the table below retains the original S0 evidence boundary.

| Path | Intended operation | S0 evidence | Limits to preserve |
|---|---|---|---|
| Native ChatGPT/Codex | Export job-scoped prompt, references and selection; operator uses host generation; explicitly import returned files | Job state/source/unknown-metadata contract only | App cannot assume access to host internal tools or subscription; available settings and usage can be unknown; actual handoff is untested |
| OpenAI API | Server-side generation/editing and runtime assistant; resolve current model capabilities | Official guide reviewed; no account check or API call | Settings/model/account/billing verified at integration; mask guidance is not exact pixel preservation; no credentials in browser code; no implied seeds/CFG |
| Optional ComfyUI | Validate workflow and models, submit prompt, observe progress and collect outputs | Official local-server routes reviewed; no installation or GPU run | Capability depends on installed model/nodes/workflow; measure latency/memory and cancellation; VRAM alone does not prove capacity; CFG is not input fidelity |
| Fixture | Controlled success/failure/unknown/cancelled outcomes and synthetic RGB result | Executed by tests and smoke | No provider quality, live compatibility, usage, cost, remote IDs or remote cancellation evidence |

[OpenAI's image guide](https://developers.openai.com/api/docs/guides/image-generation) documents
image generation/editing/reference workflows and model-aware settings. Image masks guide generation
and may not be followed with complete precision. Use explicit compositing/difference checks when
promising strict preservation. Exact model names and supported parameters must be re-checked in the
integration packet; this reference does not freeze a model selection or authorize spending.

[ComfyUI server routes](https://docs.comfy.org/development/comfyui-server/comms_routes) describe
prompt submission, history, queue and WebSocket progress facilities.
[Server overview](https://docs.comfy.org/development/comfyui-server/comms_overview) distinguishes
server endpoints and execution. Verify actual installed versions, node schemas and local model
licenses when connecting; there is no compatibility or throughput claim here.

Adapter contract: discover supported tasks/inputs and actual controls; validate required inputs and
resolved recipe version; create an app job; submit or export; record available external identifiers;
collect result/error; reconcile uncertain outcomes; offer best-effort cancellation with explicit
local/remote distinction. Store project history independently of provider choice. Image model
configuration and text/vision assistant configuration are separate. Human review promotes a proposal;
provider selection cannot silently approve brand rules or reset a brief.

Manual native file export/import is implemented as described in workspace.md. No credential handling,
in-app design assistant, OpenAI API integration or ComfyUI worker is implemented here. The full image formats, usage accounting, idempotency and retry
behavior must be checked with real providers in their bounded integration assignments.
