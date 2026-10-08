// Test-only service. Transport injection is not exposed through the production HTTP/config API.
import sharp from 'sharp';
import { startApp } from '../src/service/server.ts';
import { IMAGE_MODELS, ASSISTANT_MODELS } from '../src/service/openai.ts';
import { parsePolicy } from '../src/modules/website/provider-contracts.ts';
const root = process.argv[2],
  port = Number(process.argv[3]),
  enabled = process.argv[4] === 'fixture';
if (!root || !Number.isSafeInteger(port))
  throw new Error('Disposable fixture root and port required');
const scene = (color: string) =>
  sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#f3ede0"/><circle cx="700" cy="360" r="180" fill="${color}"/><path d="M110 810 L440 280 L780 810Z" fill="#173f45"/><rect x="60" y="900" width="904" height="70" fill="#ffffff"/><text x="90" y="946" font-size="30" fill="#173f45">AUTHORED OFFLINE FIXTURE — NO AI CALL</text></svg>`,
    ),
  )
    .png()
    .toBuffer();
const original = await scene('#de8159'),
  edited = await scene('#719876');
let calls = 0;
const app = await startApp(root, port, undefined, {
  apiKey: enabled ? 'offline-fixture-key' : null,
  imageModel: IMAGE_MODELS[0],
  assistantModel: ASSISTANT_MODELS[0],
  policy: enabled
    ? parsePolicy({
        runId: 'browser-fixture',
        approval: 'Offline transport fixture only; no live authorization',
        maxCalls: 5,
        capUSD: 5,
        reserveUSD: 1,
        alternativeCallBoundApproved: true,
        models: [...IMAGE_MODELS, ...ASSISTANT_MODELS],
      })
    : null,
  timeoutMs: 5000,
  transport: async (url, init) => {
    calls++;
    let body: Record<string, unknown> = {};
    if (typeof init.body === 'string') body = JSON.parse(init.body);
    if (String(init.body).includes('fixture rate limit'))
      return new Response(JSON.stringify({ error: { code: 'rate_limit' } }), {
        status: 429,
        headers: { 'x-request-id': 'req_fixture_rate' },
      });
    if (url.endsWith('/responses'))
      return new Response(
        JSON.stringify({
          id: 'resp_fixture_' + calls,
          status: 'completed',
          model: ASSISTANT_MODELS[0],
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    title: 'Quiet, useful care',
                    rationale:
                      'An authored offline proposal: leave space for the heading and use the selected composition reference as a discussion aid.',
                    constraints: ['Preserve readable hierarchy'],
                    uncertainty:
                      'Fixture only. A designer must assess the visual direction.',
                    unresolved: ['Confirm the preferred image treatment'],
                  }),
                },
              ],
            },
          ],
          usage: null,
        }),
        { headers: { 'x-request-id': 'req_fixture_' + calls } },
      );
    return new Response(
      JSON.stringify({
        data: [
          {
            b64_json: (url.endsWith('/edits') ? edited : original).toString(
              'base64',
            ),
          },
        ],
        usage: null,
      }),
      { headers: { 'x-request-id': 'req_fixture_' + calls } },
    );
  },
});
console.log('Offline fixture workspace: ' + app.origin);
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.on(signal, () => {
    void app.close().then(() => {
      console.log('Offline transport calls: ' + calls + '; real API calls: 0');
      process.exit(0);
    });
  });
