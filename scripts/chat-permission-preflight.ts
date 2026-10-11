// Actual pinned app-server + owned Responses fixture + production BVE bridge/grants.
// Every runtime is disposable. No account credentials, policy budget or upstream call.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { OwnedRpc, AccountChatDriver, restrictedConfig, toml } from '../src/service/chat-process.ts';
import { bveMcpConfig } from '../src/service/chat-mcp-config.ts';
import { CHAT_PROTOCOL, chatTools } from '../src/service/chat-contracts.ts';
import type { ChatDriver } from '../src/service/chat-contracts.ts';
import { startApp } from '../src/service/server.ts';

const installedBinary = () => {
  const require = createRequire(import.meta.url);
  const triple = process.platform === 'win32' ? 'x86_64-pc-windows-msvc' : 'x86_64-unknown-linux-musl';
  if (process.arch !== 'x64' || !['win32', 'linux'].includes(process.platform)) throw Error('Supply BVE_CODEX_BINARY for this platform');
  return join(dirname(require.resolve(`@openai/codex-${process.platform === 'win32' ? 'win32' : 'linux'}-x64/package.json`)), 'vendor', triple, 'bin', process.platform === 'win32' ? 'codex.exe' : 'codex');
};
const binary = process.env['BVE_CODEX_BINARY'] ?? installedBinary();
const version = execFileSync(binary, ['--version'], {encoding: 'utf8', timeout: 10000}).trim();
assert.equal(version, 'codex-cli ' + CHAT_PROTOCOL);
const evidence = resolve(process.env['BVE_EVIDENCE_DIR'] ?? '/tmp/bve-chat-permission');
mkdirSync(evidence, {recursive: true});
const receipts: unknown[] = [];
const scenarios = ['unconfigured', 'allowed', 'foreign-grant', 'stale-grant', 'unknown-tool', 'forbidden-tool'] as const;
for (const scenario of scenarios) {
  const root = mkdtempSync(join(tmpdir(), 'bve-mcp-permission-'));
  // Select the existing account object solely to obtain its real service grant
  // closure. Never read a policy, token, credential or run its account transport.
  const previousPolicy = process.env['BVE_CHAT_POLICY_FILE'];
  process.env['BVE_CHAT_POLICY_FILE'] = join(root, 'unused-policy-selection-marker');
  let app;
  try { app = await startApp(root, 0); }
  finally {
    if (previousPolicy === undefined) delete process.env['BVE_CHAT_POLICY_FILE'];
    else process.env['BVE_CHAT_POLICY_FILE'] = previousPolicy;
  }
  const account = app.chat.driver as AccountChatDriver;
  assert.ok(account instanceof AccountChatDriver);
  let releaseTurn!: () => void;
  app.chat.driver = {
    kind: 'test-fixture', close: async () => { releaseTurn?.(); },
    run: async c => {
      await new Promise<void>(r => { releaseTurn = r; c.signal.addEventListener('abort', () => r(), {once: true}); });
      return {status: c.signal.aborted ? 'interrupted' : 'completed', model: null, usage: null};
    },
  } satisfies ChatDriver;
  const turn = app.chat.send({projectId: null, clientId: 'permission-control', text: 'Mechanical scoped permission control', focus: {view: 'studio', page: null, resources: [], target: null}});
  const grant = account.grant(turn.projectId, 'permission-control');
  if (scenario === 'stale-grant') app.chat.cancel(turn.projectId, {turn: 'permission-control'});
  const outputs: string[] = [], catalogues: unknown[] = [];
  let round = 0, receiverError: Error | undefined;
  const receiver = createServer(async (req, res) => {
    try {
      assert.equal(req.url, '/v1/responses');
      assert.equal(req.headers.authorization, 'Bearer synthetic-offline-token');
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c);
      const input = JSON.parse(Buffer.concat(chunks).toString()) as {input: Record<string, unknown>[]; tools?: unknown[]};
      const tools = input.tools ?? input.input.find(x => x['type'] === 'additional_tools')?.['tools'];
      if (tools) catalogues.push(tools);
      const calls = input.input.filter(x => x['type'] === 'function_call_output');
      if (calls.length) outputs.push(JSON.stringify(calls.at(-1)!['output']));
      const callCount = scenario === 'allowed' ? 3 : 1;
      const tool = scenario === 'unknown-tool' ? 'not_a_bve_tool' : scenario === 'forbidden-tool' ? 'exec_command' : round === 0 ? 'read_context' : 'update_draft';
      const responseId = 'offline-response-' + scenario + '-' + round;
      const item = round < callCount ? {
        type: 'function_call', id: 'fc_' + round, call_id: 'call_' + round,
        namespace: scenario === 'forbidden-tool' ? 'functions' : 'mcp__bve', name: tool,
        arguments: JSON.stringify({actionId: 'permission-' + Math.min(round, 1), input: tool === 'update_draft' ? {brief: {intent: 'Synthetic permission write', unresolved: ['Prices/address/hours unknown']}, assumptions: []} : {}}),
      } : {type: 'message', id: 'msg_final', role: 'assistant', status: 'completed', content: [{type: 'output_text', text: 'Synthetic permission control complete; no live inference.', annotations: []}]};
      round++;
      assert.ok(round <= callCount + 1, 'Unexpected receiver retry/round');
      res.writeHead(200, {'content-type': 'text/event-stream'});
      const emit = (type: string, extra: object) => res.write('event: ' + type + '\ndata: ' + JSON.stringify({type, ...extra}) + '\n\n');
      emit('response.created', {response: {id: responseId, output: []}});
      emit('response.output_item.added', {output_index: 0, item: {...item, ...(item.type === 'function_call' ? {arguments: ''} : {})}});
      if (item.type === 'function_call') emit('response.function_call_arguments.delta', {output_index: 0, item_id: item.id, delta: item.arguments});
      emit('response.output_item.done', {output_index: 0, item});
      emit('response.completed', {response: {id: responseId, status: 'completed', output: [item], usage: {input_tokens: 10, output_tokens: 5, total_tokens: 15}}});
      res.end();
    } catch (e) { receiverError = e as Error; res.writeHead(500); res.end('Synthetic receiver assertion failed'); }
  });
  receiver.listen(0, '127.0.0.1'); await once(receiver, 'listening');
  const providerOrigin = 'http://127.0.0.1:' + (receiver.address() as {port: number}).port;
  const mcp = bveMcpConfig(app.origin, scenario === 'foreign-grant' ? 'foreign-synthetic-grant' : grant.token);
  if (scenario === 'unconfigured') {
    const legacy = mcp.bve as Partial<typeof mcp.bve>;
    delete legacy.enabled_tools; delete legacy.default_tools_approval_mode; delete legacy.tools;
  }
  const config = {
    ...restrictedConfig, features: {...restrictedConfig.features, api_key_model_discovery: false},
    model_catalog_json: resolve(import.meta.dirname, '../src/service/chat-model-catalog.json'),
    model_provider: 'offline_permission', model_providers: {offline_permission: {name: 'Owned synthetic receiver', base_url: providerOrigin + '/v1', env_key: 'BVE_PROBE_TOKEN', wire_api: 'responses', requires_openai_auth: false, supports_websockets: false, request_max_retries: 0, stream_max_retries: 0}},
    mcp_servers: mcp,
  };
  const args = ['app-server', '--listen', 'stdio://'];
  for (const [k, v] of Object.entries(config)) args.push('-c', k + '=' + toml(v));
  const rpc = new OwnedRpc(binary, args, root, {PATH: process.env['PATH'], SystemRoot: process.env['SystemRoot'], CODEX_HOME: root, BVE_PROBE_TOKEN: 'synthetic-offline-token', TMPDIR: root, TMP: root, TEMP: root});
  let finish!: (value: Record<string, unknown>) => void;
  const completed = new Promise<Record<string, unknown>>(r => { finish = r; });
  rpc.onEvent = (method, params) => { if (method === 'turn/completed') finish(params); };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await rpc.request('initialize', {clientInfo: {name: 'bve_offline_permission', version: '0.0.0'}, capabilities: {experimentalApi: true}});rpc.notify('initialized');
    const started = await rpc.request('thread/start', {model: 'gpt-6-luna', environments: [], cwd: root, sandbox: 'read-only', approvalPolicy: 'never', config});
    await rpc.request('turn/start', {threadId: (started['thread'] as {id: string}).id, environments: [], input: [{type: 'text', text: 'Synthetic permission fixture only.'}], approvalPolicy: 'never'});
    await Promise.race([completed, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('Actual permission control timed out')), 30000); })]);
    if (receiverError) throw receiverError;
    assert.equal(outputs.length, scenario === 'allowed' ? 3 : 1);
    const actions = Number(app.chat.store.db.prepare('SELECT count(*) AS n FROM actions').get()!['n']);
    if (scenario === 'allowed') {
      assert.equal(actions, 2);
      assert.equal(app.chat.store.action('permission-control', 'permission-1')!['status'], 'completed');
      assert.equal(app.workspace.project(turn.projectId).payload.localContext['intent']?.override, 'Synthetic permission write');
      const body = (output: string) => JSON.parse(output).at(-1).text;
      assert.equal(body(outputs[1]!), body(outputs[2]!), 'Duplicate action must return its exact receipt');
    } else {
      assert.equal(actions, 0);
      if (scenario === 'unconfigured') assert.match(outputs[0]!, /requires approval.*approval policy is never/i);
      if (scenario === 'foreign-grant') assert.match(outputs[0]!, /Reload the local app/);
      if (scenario === 'stale-grant') assert.match(outputs[0]!, /Turn is no longer active/);
      if (scenario === 'unknown-tool' || scenario === 'forbidden-tool') assert.match(outputs[0]!, /unsupported call/);
    }
    assert.ok(catalogues.length);
    const namespaces = catalogues[0] as {name: string; tools: {name: string}[]}[];
    assert.deepEqual(namespaces.find(n => n.name === 'mcp__bve')!.tools.map(t => t.name).sort(), [...chatTools].sort());
    assert.deepEqual(namespaces.map(n => n.name).sort(), ['functions', 'mcp__bve']);
    assert.ok(namespaces.find(n => n.name === 'functions')!.tools.every(t => ['list_mcp_resources', 'list_mcp_resource_templates', 'read_mcp_resource'].includes(t.name)));
    assert.equal(app.pages.state(turn.projectId).pages.length, 0);
    assert.equal(app.chat.store.jobs(turn.projectId).length, 0);
    receipts.push({scenario, outputs, actions, rounds: round, passed: true});
    console.log(JSON.stringify({scenario, actions, rounds: round, passed: true}));
  } finally {
    clearTimeout(timer); rpc.close(); grant.release(); releaseTurn(); await app.close();
    receiver.closeAllConnections(); await new Promise<void>(r => receiver.close(() => r()));
  }
}
writeFileSync(join(evidence, 'permission-execution.json'), JSON.stringify({version, source: 'actual pinned app-server permission layer and production bridge/grants; synthetic Responses', receipts, accountCalls: 0, imageCalls: 0, passed: true}, null, 2) + '\n');
console.log('Pinned MCP permission execution passed: ' + receipts.length + ' controls; zero account inference.');
