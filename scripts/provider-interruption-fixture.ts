// Offline crash fixture: no fetch/network capability is used by this script.
import { Workspace } from '../src/service/workspace.ts';
import { Providers } from '../src/service/providers.ts';
import { IMAGE_MODELS, ASSISTANT_MODELS } from '../src/service/openai.ts';
import { parsePolicy } from '../src/modules/website/provider-contracts.ts';
import { reference } from '../src/kernel/packets.ts';
const root = process.argv[2];
if (!root) throw new Error('Disposable fixture root required');
const w = new Workspace(root, { directionFixture: true });
const p = w.create({
  title: 'Interrupted synthetic run',
  mode: 'freeroam',
  visualOS: null,
  palette: null,
}).project!;
const api = new Providers(w, {
  apiKey: 'offline-fixture-key',
  imageModel: IMAGE_MODELS[0],
  assistantModel: ASSISTANT_MODELS[0],
  policy: parsePolicy({
    runId: 'synthetic-run',
    approval: 'Offline transport fixture only; no live budget',
    maxCalls: 3,
    capUSD: 3,
    reserveUSD: 1,
    alternativeCallBoundApproved: true,
    models: [...IMAGE_MODELS, ...ASSISTANT_MODELS],
  }),
  timeoutMs: 5000,
  transport: async () => new Promise(() => {}),
});
api.prepare(p.id, {
  expectedProject: reference(p),
  operation: 'assistant',
  artifact: null,
  scope: 'hero',
  instructions: 'Offline interruption fixture',
  size: '1024x1024',
  quality: 'low',
  references: [],
});
const job = w
  .state(p.id)
  .artifacts!.find((a) => a.payload.kind === 'website-provider-job')!;
api.submit(p.id, { job: reference(job) });
setImmediate(() => {
  console.log(JSON.stringify({ projectId: p.id, attemptId: job.id }));
  process.exit(0);
});
