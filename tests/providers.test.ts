import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, cpSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import { Workspace } from '../src/service/workspace.ts';
import { Providers, artifact } from '../src/service/providers.ts';
import type { ProviderConfig } from '../src/service/providers.ts';
import {
  IMAGE_MODELS,
  ASSISTANT_MODELS,
  executeOpenAI,
  ProviderFailure,
} from '../src/service/openai.ts';
import type { Transport } from '../src/service/openai.ts';
import type {
  ProviderJob,
  ApiImage,
  AssistantProposal,
  BudgetState,
} from '../src/modules/website/provider-contracts.ts';
import { parsePolicy } from '../src/modules/website/provider-contracts.ts';
import type {
  DesignArtifact,
  NodePacket,
  VersionRef,
} from '../src/kernel/contracts.ts';
import { reference, packet, canonical } from '../src/kernel/packets.ts';
import { startApp } from '../src/service/server.ts';
const key = 'synthetic-private-key';
export const fixtureProposal = {
  title: 'Calm fieldwork',
  rationale: 'Use a quiet composition for the synthetic home care brief.',
  constraints: ['Keep the heading legible'],
  uncertainty: 'This is a fixture, not designer approval.',
  unresolved: ['Confirm imagery with a designer'],
};
const image = (color = '#de8159', width = 120) =>
  sharp({ create: { width, height: 80, channels: 3, background: color } })
    .png()
    .toBuffer();
const imageResponse = (bytes: Buffer, extra: object = {}) =>
  new Response(
    JSON.stringify({
      data: [{ b64_json: bytes.toString('base64') }],
      ...extra,
    }),
    { status: 200, headers: { 'x-request-id': 'req_fixture' } },
  );
const assistantResponse = (proposal: unknown = fixtureProposal) =>
  new Response(
    JSON.stringify({
      id: 'resp_fixture',
      model: ASSISTANT_MODELS[0],
      status: 'completed',
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: JSON.stringify(proposal) }],
        },
      ],
      usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
    }),
    { headers: { 'x-request-id': 'req_assistant' } },
  );
const reasoning = (summary: string | null = null) => ({
  id: 'rs_synthetic',
  type: 'reasoning',
  summary: summary === null ? [] : [{ type: 'summary_text', text: summary }],
  encrypted_content: 'synthetic-opaque-metadata',
});
const finalMessage = (content: object[]) => ({
  id: 'msg_synthetic',
  type: 'message',
  role: 'assistant',
  status: 'completed',
  content,
});
const proposalMessage = () =>
  finalMessage([
    {
      type: 'output_text',
      text: JSON.stringify(fixtureProposal),
      annotations: [],
    },
  ]);
const refusalMessage = () => finalMessage([{ type: 'refusal', refusal: 'No' }]);
const envelopeResponse = (output: unknown[]) =>
  new Response(
    JSON.stringify({
      id: 'resp_envelope',
      model: ASSISTANT_MODELS[0],
      status: 'completed',
      output,
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        total_tokens: 30,
        output_tokens_details: { reasoning_tokens: 12 },
      },
    }),
    { headers: { 'x-request-id': 'req_envelope' } },
  );
export function config(
  transport: Transport,
  extra: Partial<ProviderConfig> = {},
): ProviderConfig {
  return {
    apiKey: key,
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
    transport,
    ...extra,
  };
}
function setup(
  t: test.TestContext,
  transport: Transport,
  extra: Partial<ProviderConfig> = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'bve-provider-'));
  let w = new Workspace(root);
  let api = new Providers(w, config(transport, extra));
  const p = w.create({
    title: 'Synthetic API studio',
    mode: 'freeroam',
    visualOS: null,
    palette: null,
  }).project!;
  const explored = w.explore(p.id, {
    expectedProject: reference(p),
    count: 3,
    base: null,
  });
  const first = (
    explored.bundles!.at(-1) as NodePacket<{ candidates: VersionRef[] }>
  ).payload.candidates[0]!;
  t.after(async () => {
    await api.close();
    w.close();
    rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    get w() {
      return w;
    },
    get api() {
      return api;
    },
    pid: p.id,
    first,
    reopen(alreadyClosed = false) {
      if (!alreadyClosed) w.close();
      w = new Workspace(root);
      api = new Providers(w, config(transport, extra));
    },
    queue(
      operation = 'generate',
      source: VersionRef | null = first,
      references: VersionRef[] = [],
    ) {
      api.prepare(p.id, {
        expectedProject: reference(w.project(p.id)),
        operation,
        artifact: source,
        scope: 'hero',
        instructions: 'Synthetic image or direction request',
        size: '1024x1024',
        quality: 'low',
        references,
      });
      return job(w, p.id);
    },
  };
}
function job(
  w: Workspace,
  pid: string,
): NodePacket<DesignArtifact<ProviderJob>> {
  return w
    .state(pid)
    .artifacts!.filter((a) => a.payload.kind === 'website-provider-job')
    .at(-1) as NodePacket<DesignArtifact<ProviderJob>>;
}
const accept = (w: Workspace, pid: string, a: VersionRef, historical = false) =>
  w.accept(pid, {
    artifact: a,
    bundle: null,
    expected: w.kernel.selected(pid, 'hero'),
    reason: 'Explicit synthetic acceptance',
    slot: 'hero',
    allowHistorical: historical,
  });
const submit = async (
  s: ReturnType<typeof setup>,
  j: NodePacket<DesignArtifact<ProviderJob>>,
) => {
  s.api.submit(s.pid, { job: reference(j) });
  await s.api.wait(j.id);
  return job(s.w, s.pid);
};
function invariant(w: Workspace, pid: string) {
  return canonical({
    accepted: w.kernel.selected(pid, 'hero'),
    acceptance: w.kernel
      .ledger(pid)
      .events.filter((e) => e.kind === 'acceptance'),
  });
}

test('assistant adapter accepts documented reasoning metadata plus one final proposal without persisting reasoning', async (t) => {
  const s = setup(t, async () => assistantResponse());
  const request = s.queue('assistant', null).payload.state.request;
  for (const metadata of [
    reasoning(),
    reasoning('This is metadata, not a proposal.'),
  ]) {
    let calls = 0;
    const result = await executeOpenAI(
      request,
      key,
      {},
      [],
      new AbortController().signal,
      async () => {
        calls++;
        return envelopeResponse([
          metadata,
          {
            ...proposalMessage(),
            phase: metadata.summary.length ? 'final_answer' : null,
          },
        ]);
      },
    );
    assert.deepEqual(result.proposal, fixtureProposal);
    assert.equal(result.bytes, null);
    assert.equal(calls, 1);
    assert.equal(result.evidence.transportRequestId, 'req_envelope');
    assert.equal(result.evidence.resultId, 'resp_envelope');
    assert.equal(result.evidence.reportedModel, ASSISTANT_MODELS[0]);
    assert.deepEqual(result.evidence.usage, {
      input_tokens: 10,
      output_tokens: 20,
      total_tokens: 30,
      output_tokens_details: { reasoning_tokens: 12 },
    });
    assert.ok(!canonical(result).includes('synthetic-opaque-metadata'));
  }
});
test('assistant adapter preserves refusal classification and evidence beside reasoning', async (t) => {
  const s = setup(t, async () => assistantResponse());
  const request = s.queue('assistant', null).payload.state.request;
  let calls = 0;
  await assert.rejects(
    executeOpenAI(
      request,
      key,
      {},
      [],
      new AbortController().signal,
      async () => {
        calls++;
        return envelopeResponse([reasoning(), refusalMessage()]);
      },
    ),
    (e: unknown) => {
      assert.ok(e instanceof ProviderFailure);
      assert.equal(e.kind, 'refusal');
      assert.equal(e.uncertain, false);
      assert.equal(e.evidence.resultId, 'resp_envelope');
      assert.equal(e.evidence.transportRequestId, 'req_envelope');
      assert.deepEqual(e.evidence.usage, {
        input_tokens: 10,
        output_tokens: 20,
        total_tokens: 30,
        output_tokens_details: { reasoning_tokens: 12 },
      });
      return true;
    },
  );
  assert.equal(calls, 1);
});
test('assistant adapter rejects tools, ambiguous messages and malformed content despite legal reasoning', async (t) => {
  const s = setup(t, async () => assistantResponse());
  const request = s.queue('assistant', null).payload.state.request;
  const negatives = [
    [reasoning(), { type: 'function_call', name: 'accept' }, proposalMessage()],
    [reasoning(), { type: 'web_search_call' }, refusalMessage()],
    [reasoning(), { type: 'unknown' }, proposalMessage()],
    [reasoning(), proposalMessage(), proposalMessage()],
    [reasoning(), proposalMessage(), refusalMessage()],
    [proposalMessage(), reasoning()],
    [reasoning()],
    [reasoning(), { ...proposalMessage(), role: 'user' }],
    [reasoning(), { ...proposalMessage(), status: 'in_progress' }],
    [reasoning(), { ...proposalMessage(), phase: 'commentary' }],
    [reasoning(), finalMessage([{ type: 'output_text', text: '{broken' }])],
    [
      reasoning(),
      finalMessage([
        {
          type: 'output_text',
          text: JSON.stringify({ ...fixtureProposal, reviewed: true }),
        },
      ]),
    ],
    [
      reasoning(),
      finalMessage([
        { type: 'output_text', text: '{}' },
        { type: 'refusal', refusal: 'No' },
      ]),
    ],
    [reasoning(), finalMessage([{ type: 'refusal', refusal: 5 }])],
    [
      reasoning(),
      finalMessage([{ type: 'output_text', text: 'x'.repeat(32001) }]),
    ],
    [
      { ...reasoning(), summary: [{ type: 'function_call', name: 'accept' }] },
      proposalMessage(),
    ],
    [null, proposalMessage()],
  ];
  let calls = 0;
  for (const output of negatives) {
    await assert.rejects(
      executeOpenAI(
        request,
        key,
        {},
        [],
        new AbortController().signal,
        async () => {
          calls++;
          return envelopeResponse(output);
        },
      ),
      (e: unknown) =>
        e instanceof ProviderFailure &&
        e.kind === 'invalid-output' &&
        e.evidence.resultId === 'resp_envelope',
    );
  }
  assert.equal(calls, negatives.length);
});
test('reasoning-plus-proposal persists exact source and evidence through reopen with separate human review', async (t) => {
  let calls = 0;
  const s = setup(t, async () => {
    calls++;
    return envelopeResponse([reasoning(), proposalMessage()]);
  });
  await s.w.addReference(
    s.pid,
    reference(s.w.project(s.pid)),
    await image(),
    'Synthetic vision reference',
    'composition',
    'hero',
  );
  const source = s.w.state(s.pid).references![0]!.artifact;
  const before = invariant(s.w, s.pid);
  const done = await submit(s, s.queue('assistant', null, [source]));
  assert.equal(done.payload.state.status, 'returned');
  assert.equal(done.payload.state.outputs.length, 1);
  const out = done.payload.state.outputs[0]!;
  const proposal = s.w.read(s.pid, out).payload.state as AssistantProposal;
  assert.equal(proposal.reviewed, false);
  assert.deepEqual(proposal.sourceReferences, [source]);
  assert.equal(
    done.payload.state.observations.at(-1)!.resultId,
    'resp_envelope',
  );
  const persisted = canonical(s.w.state(s.pid));
  assert.ok(!persisted.includes('synthetic-opaque-metadata'));
  s.reopen();
  assert.equal(canonical(s.w.state(s.pid)), persisted);
  assert.equal(calls, 1);
  s.api.review(s.pid, {
    expectedProject: reference(s.w.project(s.pid)),
    proposal: out,
    edited: {
      ...fixtureProposal,
      rationale: 'Explicit edited human rationale',
    },
    reason: 'Human reviewed fixture',
  });
  assert.equal(
    (s.w.read(s.pid, out).payload.state as AssistantProposal).reviewed,
    false,
  );
  assert.equal(
    s.w
      .state(s.pid)
      .artifacts!.filter((a) => a.payload.kind === 'website-assistant-review')
      .length,
    1,
  );
  assert.equal(s.w.state(s.pid).visualOS.length, 0);
  assert.equal(invariant(s.w, s.pid), before);
});
test('reasoning-plus-refusal and unsupported envelope persist distinct failures without proposal or acceptance changes', async (t) => {
  for (const [output, kind] of [
    [[reasoning(), refusalMessage()], 'refusal'],
    [
      [
        reasoning(),
        { type: 'function_call', name: 'accept' },
        proposalMessage(),
      ],
      'invalid-output',
    ],
  ] as const) {
    let calls = 0;
    const s = setup(t, async () => {
      calls++;
      return envelopeResponse([...output]);
    });
    const before = invariant(s.w, s.pid);
    const done = await submit(s, s.queue('assistant', null));
    assert.equal(done.payload.state.status, 'failed');
    assert.deepEqual(done.payload.state.outputs, []);
    const observation = done.payload.state.observations.at(-1)!;
    assert.equal(observation.kind, kind);
    assert.equal(observation.resultId, 'resp_envelope');
    assert.equal(observation.transportRequestId, 'req_envelope');
    assert.deepEqual(observation.usage, {
      input_tokens: 10,
      output_tokens: 20,
      total_tokens: 30,
      output_tokens_details: { reasoning_tokens: 12 },
    });
    const persisted = canonical(done);
    s.reopen();
    assert.equal(canonical(job(s.w, s.pid)), persisted);
    assert.equal(s.api.status().budget!.reservedUSD, 1);
    assert.equal(invariant(s.w, s.pid), before);
    assert.equal(s.w.state(s.pid).visualOS.length, 0);
    assert.throws(() =>
      s.api.submit(s.pid, { job: reference(job(s.w, s.pid)) }),
    );
    assert.equal(calls, 1);
  }
});

test('API generation serializes one bounded call and stores exact original bytes with honest metadata', async (t) => {
  const bytes = await image();
  let calls = 0;
  const s = setup(t, async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.openai.com/v1/images/generations');
    assert.equal(init.redirect, 'error');
    assert.equal(
      (init.headers as Record<string, string>)['Authorization'],
      'Bearer ' + key,
    );
    const body = JSON.parse(String(init.body));
    assert.equal(body.model, IMAGE_MODELS[0]);
    assert.equal(body.n, 1);
    assert.equal(body.quality, 'low');
    assert.equal(body.output_format, 'png');
    assert.ok(!('seed' in body));
    assert.ok(!('input_fidelity' in body));
    assert.match(body.prompt, /Synthetic API studio/);
    return imageResponse(bytes, {
      usage: { input_tokens: 5, output_tokens: 10, total_tokens: 15 },
    });
  });
  const queued = s.queue();
  const before = invariant(s.w, s.pid);
  const done = await submit(s, queued);
  assert.equal(calls, 1);
  assert.equal(done.payload.state.status, 'returned');
  const out = done.payload.state.outputs[0]!;
  assert.deepEqual((await s.w.originalImage(s.pid, out)).bytes, bytes);
  const i = s.w.read(s.pid, out).payload.state as ApiImage;
  assert.equal(i.providerPath, 'api');
  assert.equal(i.reportedModel, null);
  assert.equal(i.resultId, null);
  assert.equal(i.transportRequestId, 'req_fixture');
  assert.equal(i.actualCostUSD, null);
  assert.equal(invariant(s.w, s.pid), before);
  accept(s.w, s.pid, out);
  const selected = s.w.kernel.selected(s.pid, 'hero');
  s.reopen();
  assert.deepEqual(s.w.kernel.selected(s.pid, 'hero'), selected);
  assert.deepEqual((await s.w.originalImage(s.pid, out)).bytes, bytes);
});
test('API edit sends owned original plus reference bytes and creates immutable parent lineage', async (t) => {
  const original = await image(),
    returned = await image('#173f45');
  let calls = 0;
  const s = setup(t, async (url, init) => {
    calls++;
    if (calls === 1) return imageResponse(original);
    assert.equal(url, 'https://api.openai.com/v1/images/edits');
    assert.ok(init.body instanceof FormData);
    const form = init.body;
    assert.equal(form.get('model'), IMAGE_MODELS[0]);
    assert.equal(form.get('n'), '1');
    const files = form.getAll('image[]') as File[];
    assert.equal(files.length, 2);
    assert.deepEqual(Buffer.from(await files[0]!.arrayBuffer()), original);
    assert.deepEqual(
      Buffer.from(await files[1]!.arrayBuffer()),
      referenceBytes,
    );
    return imageResponse(returned, { model: IMAGE_MODELS[0] });
  });
  const referenceBytes = await image('#f3ede0');
  await s.w.addReference(
    s.pid,
    reference(s.w.project(s.pid)),
    referenceBytes,
    'Synthetic palette',
    'palette',
    'hero',
  );
  const refImage = s.w.state(s.pid).references![0]!.artifact;
  const gen = await submit(s, s.queue());
  const parent = gen.payload.state.outputs[0]!;
  const edit = await submit(s, s.queue('edit', parent, [refImage]));
  const out = edit.payload.state.outputs[0]!;
  const state = s.w.read(s.pid, out).payload.state as ApiImage;
  assert.deepEqual(
    state.parentAsset,
    (s.w.read(s.pid, parent).payload.state as ApiImage).image,
  );
  assert.deepEqual(state.originalArtifact, parent);
  assert.deepEqual((await s.w.originalImage(s.pid, parent)).bytes, original);
  assert.deepEqual((await s.w.originalImage(s.pid, out)).bytes, returned);
  assert.equal(state.reportedModel, IMAGE_MODELS[0]);
  assert.equal(calls, 2);
});
test('missing credentials and missing approved budget refuse before reservation or transport', async (t) => {
  for (const extra of [{ apiKey: null }, { policy: null }]) {
    let calls = 0;
    const s = setup(
      t,
      async () => {
        calls++;
        throw new Error('must not call');
      },
      extra,
    );
    const j = s.queue();
    const before = canonical(s.w.state(s.pid));
    assert.throws(
      () => s.api.submit(s.pid, { job: reference(j) }),
      /unconfigured|budget/,
    );
    assert.equal(canonical(s.w.state(s.pid)), before);
    assert.equal(calls, 0);
  }
});
test('unsupported controls, generation image references and foreign input reject without writes', async (t) => {
  const s = setup(t, async () => {
    throw new Error('must not call');
  });
  const other = s.w.create({
    title: 'Other',
    mode: 'freeroam',
    visualOS: null,
    palette: null,
  }).project!;
  const o = s.w.explore(other.id, {
    expectedProject: reference(other),
    count: 3,
    base: null,
  });
  const foreign = (
    o.bundles!.at(-1) as NodePacket<{ candidates: VersionRef[] }>
  ).payload.candidates[0]!;
  const input = {
    expectedProject: reference(s.w.project(s.pid)),
    operation: 'generate',
    artifact: s.first,
    scope: 'hero',
    instructions: 'Synthetic',
    size: '1024x1024',
    quality: 'low',
    references: [],
  };
  const before = canonical(s.w.state(s.pid));
  for (const altered of [
    { ...input, seed: 1 },
    { ...input, size: 'auto' },
    { ...input, quality: 'max' },
    { ...input, artifact: foreign },
  ])
    assert.throws(() => s.api.prepare(s.pid, altered));
  assert.equal(canonical(s.w.state(s.pid)), before);
  await s.w.addReference(
    s.pid,
    reference(s.w.project(s.pid)),
    await image(),
    'ref',
    'palette',
    'hero',
  );
  assert.throws(
    () =>
      s.queue('generate', s.first, [s.w.state(s.pid).references![0]!.artifact]),
    /text only/,
  );
});
test('duplicate and concurrent submits claim one attempt and one reservation', async (t) => {
  let finish!: (r: Response) => void,
    calls = 0;
  const s = setup(t, async () => {
    calls++;
    return new Promise((r) => (finish = r));
  });
  const j = s.queue();
  s.api.submit(s.pid, { job: reference(j) });
  assert.throws(
    () => s.api.submit(s.pid, { job: reference(j) }),
    /already submitted|changed/,
  );
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 1);
  assert.throws(
    () => s.api.submit(s.pid, { job: reference(job(s.w, s.pid)) }),
    /already submitted|changed/,
  );
  finish(imageResponse(await image()));
  await s.api.wait();
  assert.equal(s.api.status().budget!.callsUsed, 1);
  assert.equal(s.api.status().budget!.reservedUSD, 1);
});
test('stale brief rejects submission without claiming a call or altering acceptance', async (t) => {
  const s = setup(t, async () => {
    throw new Error('must not call');
  });
  const j = s.queue();
  s.w.reviseProject(s.pid, {
    expectedProject: reference(s.w.project(s.pid)),
    brief: { intent: 'New synthetic intent' },
    reason: 'Change brief',
  });
  const before = invariant(s.w, s.pid);
  assert.throws(
    () => s.api.submit(s.pid, { job: reference(j) }),
    /Project changed/,
  );
  assert.equal(s.api.status().budget!.callsUsed, 0);
  assert.equal(invariant(s.w, s.pid), before);
});
test('rate limit, refusal, provider rejection and server ambiguity have distinct outcomes without retries', async (t) => {
  for (const [status, code, kind, state] of [
    [429, 'rate_limit', 'rate-limit', 'failed'],
    [400, 'moderation_blocked', 'refusal', 'failed'],
    [401, 'invalid_api_key', 'provider-rejected', 'failed'],
    [500, 'server_error', 'provider-uncertain', 'outcome-uncertain'],
  ] as const) {
    let calls = 0;
    const s = setup(t, async () => {
      calls++;
      return new Response(
        JSON.stringify({ error: { code, message: key + '/private/path' } }),
        { status, headers: { 'x-request-id': 'req_rejection' } },
      );
    });
    const before = invariant(s.w, s.pid);
    const done = await submit(s, s.queue());
    assert.equal(done.payload.state.status, state);
    assert.equal(done.payload.state.observations.at(-1)!.kind, kind);
    assert.equal(
      done.payload.state.observations.at(-1)!.transportRequestId,
      'req_rejection',
    );
    assert.equal(calls, 1);
    assert.equal(invariant(s.w, s.pid), before);
    assert.ok(!canonical(s.w.state(s.pid)).includes(key));
    assert.equal(s.api.status().budget!.reservedUSD, 1);
  }
});
test('ambiguous transport and timeout preserve uncertain spend across reopen and never resend', async (t) => {
  for (const timeout of [false, true]) {
    let calls = 0;
    const s = setup(
      t,
      async (_url, init) => {
        calls++;
        if (timeout)
          return new Promise((_r, reject) =>
            init.signal!.addEventListener('abort', () =>
              reject(new Error('aborted')),
            ),
          );
        throw new Error('network lost ' + key);
      },
      { timeoutMs: 20 },
    );
    const done = await submit(s, s.queue());
    assert.equal(done.payload.state.status, 'outcome-uncertain');
    assert.equal(calls, 1);
    s.reopen();
    assert.equal(job(s.w, s.pid).payload.state.status, 'outcome-uncertain');
    assert.equal(s.api.status().budget!.reservedUSD, 1);
    assert.throws(() =>
      s.api.submit(s.pid, { job: reference(job(s.w, s.pid)) }),
    );
    assert.equal(calls, 1);
  }
});
test('malformed, oversized, corrupt and wrong-format provider outputs never create usable candidates', async (t) => {
  const jpeg = await sharp({
    create: { width: 20, height: 20, channels: 3, background: '#fff' },
  })
    .jpeg()
    .toBuffer();
  const responses = [
    () => new Response('{broken'),
    () => imageResponse(Buffer.from('not an image')),
    () => imageResponse(Buffer.alloc(8 * 1024 * 1024 + 1)),
    () => imageResponse(jpeg),
    () =>
      new Response(
        JSON.stringify({ data: [{ b64_json: 'AA==' }, { b64_json: 'AA==' }] }),
      ),
  ];
  for (const response of responses) {
    const s = setup(t, async () => response());
    const before = invariant(s.w, s.pid);
    const done = await submit(s, s.queue());
    assert.equal(done.payload.state.outputs.length, 0);
    assert.ok(
      ['failed', 'outcome-uncertain'].includes(done.payload.state.status),
    );
    assert.equal(invariant(s.w, s.pid), before);
    assert.equal(s.api.status().budget!.reservedUSD, 1);
  }
});
test('assistant wire contract has no tools, chosen image inputs, strict schema and separate human edited review', async (t) => {
  const bytes = await image();
  const s = setup(t, async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const body = JSON.parse(String(init.body));
    assert.deepEqual(body.tools, []);
    assert.equal(body.store, false);
    assert.equal(body.model, ASSISTANT_MODELS[0]);
    assert.equal(body.max_output_tokens, 2000);
    assert.equal(body.text.format.strict, true);
    assert.equal(
      body.input[0].content[1].image_url,
      'data:image/png;base64,' + bytes.toString('base64'),
    );
    assert.ok(!String(init.body).includes('My-Second-Brain'));
    return assistantResponse();
  });
  await s.w.addReference(
    s.pid,
    reference(s.w.project(s.pid)),
    bytes,
    'Synthetic composition',
    'composition',
    'hero',
  );
  const source = s.w.state(s.pid).references![0]!.artifact;
  const done = await submit(s, s.queue('assistant', null, [source]));
  const raw = done.payload.state.outputs[0]!;
  const a = s.w.read(s.pid, raw).payload.state as AssistantProposal;
  assert.equal(a.reviewed, false);
  assert.deepEqual(a.sourceReferences, [source]);
  const before = invariant(s.w, s.pid);
  s.api.review(s.pid, {
    expectedProject: reference(s.w.project(s.pid)),
    proposal: raw,
    edited: { ...fixtureProposal, rationale: 'My edited rationale' },
    reason: 'Operator reviewed the uncertainty',
  });
  const review = s.w
    .state(s.pid)
    .artifacts!.filter((a) => a.payload.kind === 'website-assistant-review')
    .at(-1)!;
  assert.equal(
    (review.payload.state as { proposal: { rationale: string } }).proposal
      .rationale,
    'My edited rationale',
  );
  assert.equal(invariant(s.w, s.pid), before);
  assert.equal(s.w.state(s.pid).visualOS.length, 0);
  s.reopen();
  assert.equal(
    (s.w.read(s.pid, raw).payload.state as AssistantProposal).reviewed,
    false,
  );
});
test('assistant refusal, invalid schema, trusted-reviewed injection and tool results reject', async (t) => {
  const responses = [
    () => assistantResponse({ ...fixtureProposal, reviewed: true }),
    () => assistantResponse({ ...fixtureProposal, title: 5 }),
    () =>
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            { type: 'message', content: [{ type: 'refusal', refusal: 'No' }] },
          ],
        }),
      ),
    () =>
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [{ type: 'function_call', name: 'accept' }],
        }),
      ),
  ];
  for (const response of responses) {
    const s = setup(t, async () => response());
    const before = invariant(s.w, s.pid);
    const done = await submit(s, s.queue('assistant', null));
    assert.equal(done.payload.state.status, 'failed');
    assert.deepEqual(done.payload.state.outputs, []);
    assert.equal(invariant(s.w, s.pid), before);
  }
});
test('assistant reference/brief revisions prevent stale human review', async (t) => {
  const s = setup(t, async () => assistantResponse());
  const done = await submit(s, s.queue('assistant', null));
  const raw = done.payload.state.outputs[0]!;
  s.w.reviseProject(s.pid, {
    expectedProject: reference(s.w.project(s.pid)),
    brief: { intent: 'New current brief' },
    reason: 'Change inputs',
  });
  const before = canonical(s.w.state(s.pid));
  assert.throws(
    () =>
      s.api.review(s.pid, {
        expectedProject: reference(s.w.project(s.pid)),
        proposal: raw,
        edited: fixtureProposal,
        reason: 'Review old proposal',
      }),
    /stale/,
  );
  assert.equal(canonical(s.w.state(s.pid)), before);
});
test('late response after local cancel is retained and cannot overwrite accepted work', async (t) => {
  let finish!: (r: Response) => void;
  const s = setup(t, async () => new Promise((r) => (finish = r)));
  const j = s.queue();
  s.api.submit(s.pid, { job: reference(j) });
  await new Promise((r) => setImmediate(r));
  s.api.cancel(s.pid, {
    job: reference(job(s.w, s.pid)),
    reason: 'Cancel locally',
  });
  const before = invariant(s.w, s.pid);
  finish(imageResponse(await image()));
  await s.api.wait();
  const done = job(s.w, s.pid);
  assert.equal(done.payload.state.status, 'cancelled-locally');
  assert.equal(
    (s.w.read(s.pid, done.payload.state.outputs[0]!).payload.state as ApiImage)
      .outcome,
    'late-cancelled',
  );
  assert.throws(
    () => accept(s.w, s.pid, done.payload.state.outputs[0]!),
    /eligible/,
  );
  assert.equal(invariant(s.w, s.pid), before);
  assert.equal(s.api.status().budget!.reservedUSD, 1);
});
test('late current-input result requires explicit historical review; pinned inputs remain readable', async (t) => {
  let finish!: (r: Response) => void;
  const s = setup(t, async () => new Promise((r) => (finish = r)));
  const j = s.queue();
  s.api.submit(s.pid, { job: reference(j) });
  await new Promise((r) => setImmediate(r));
  s.w.reviseProject(s.pid, {
    expectedProject: reference(s.w.project(s.pid)),
    brief: { intent: 'Later brief' },
    reason: 'Advance input',
  });
  finish(imageResponse(await image()));
  await s.api.wait();
  const out = job(s.w, s.pid).payload.state.outputs[0]!;
  const before = invariant(s.w, s.pid);
  assert.throws(() => accept(s.w, s.pid, out), /Historical/);
  assert.equal(invariant(s.w, s.pid), before);
  accept(s.w, s.pid, out, true);
  s.reopen();
  assert.deepEqual(s.w.kernel.selected(s.pid, 'hero'), out);
});
test('run call/reservation limits are shared across projects and survive restart; reconciliation retains history', async (t) => {
  const s = setup(t, async () => imageResponse(await image()), {
    policy: parsePolicy({
      ...config(async () => new Response()).policy!,
      maxCalls: 1,
    }),
  });
  const done = await submit(s, s.queue());
  s.reopen();
  const other = s.w.create({
    title: 'Other run consumer',
    mode: 'freeroam',
    visualOS: null,
    palette: null,
  }).project!;
  s.api.prepare(other.id, {
    expectedProject: reference(other),
    operation: 'assistant',
    artifact: null,
    scope: 'hero',
    instructions: 'Synthetic',
    size: '1024x1024',
    quality: 'low',
    references: [],
  });
  assert.throws(
    () => s.api.submit(other.id, { job: reference(job(s.w, other.id)) }),
    /limit|cap/,
  );
  assert.equal(s.api.status().budget!.callsUsed, 1);
  assert.throws(
    () =>
      s.api.reconcile(s.pid, {
        job: reference(done),
        reason: 'Guess',
        verifiedNoCharge: false,
      }),
    /evidence/,
  );
  s.api.reconcile(s.pid, {
    job: reference(done),
    reason: 'Synthetic no-charge fixture receipt',
    verifiedNoCharge: true,
  });
  assert.equal(s.api.status().budget!.reservedUSD, 0);
  assert.equal(s.api.status().budget!.callsUsed, 1);
  assert.equal(job(s.w, s.pid).payload.state.outputs.length, 1);
});
test('same-section native/API comparison selection and independent acceptance survive copied closed-root recovery', async (t) => {
  const s = setup(t, async () => imageResponse(await image()));
  const native = s.w
    .native(s.pid, {
      expectedProject: reference(s.w.project(s.pid)),
      artifact: s.first,
      scope: 'hero',
      instructions: 'Synthetic native request',
      preservation: [],
    })
    .artifacts!.filter((a) => a.payload.kind === 'website-native-job')
    .at(-1)!;
  const n = native.payload.state as {
    manifest: { project: VersionRef; artifact: VersionRef };
  };
  await s.w.importNative(
    s.pid,
    {
      job: reference(native),
      manifestProject: n.manifest.project,
      originalArtifact: n.manifest.artifact,
    },
    await image('#173f45'),
  );
  const nativeJob = s.w
    .state(s.pid)
    .artifacts!.find((a) => a.id === native.id)!;
  const nativeOut = (nativeJob.payload.state as { outputs: VersionRef[] })
    .outputs[0]!;
  accept(s.w, s.pid, nativeOut);
  const done = await submit(s, s.queue());
  const out = done.payload.state.outputs[0]!;
  const before = invariant(s.w, s.pid);
  s.api.compare(s.pid, {
    compared: [nativeOut, out],
    selected: out,
    reason: 'Compare distinct native/API provenance',
  });
  assert.equal(invariant(s.w, s.pid), before);
  accept(s.w, s.pid, out);
  const copy = s.root + '-copy';
  s.w.close();
  cpSync(s.root, copy, { recursive: true });
  const restored = new Workspace(copy);
  assert.deepEqual(restored.kernel.selected(s.pid, 'hero'), out);
  assert.deepEqual(
    (await restored.originalImage(s.pid, nativeOut)).bytes,
    await image('#173f45'),
  );
  assert.equal(
    restored
      .state(s.pid)
      .artifacts!.filter((a) => a.payload.kind === 'website-image-comparison')
      .length,
    1,
  );
  restored.close();
  rmSync(copy, { recursive: true, force: true });
  s.reopen(true);
});
test('wrong-project, wrong-source and wrong-section consumption boundaries reject without acceptance writes', async (t) => {
  const s = setup(t, async () => imageResponse(await image()));
  const done = await submit(s, s.queue()),
    out = done.payload.state.outputs[0]!;
  const other = s.w.create({
    title: 'Foreign',
    mode: 'freeroam',
    visualOS: null,
    palette: null,
  }).project!;
  assert.throws(() => s.w.read(other.id, out), /different project/);
  const before = invariant(s.w, s.pid);
  const state = s.w.read(s.pid, out).payload.state as ApiImage;
  const bad = artifact(
    s.pid,
    'website-api-image',
    'proof',
    state,
    [state.job, state.originalArtifact],
    [state.image],
  );
  s.w.kernel.put(bad);
  assert.throws(() => accept(s.w, s.pid, reference(bad)), /scope|binding/);
  assert.equal(invariant(s.w, s.pid), before);
});
test('provider HTTP endpoints retain origin/token checks and original-byte fidelity with no credential exposure', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'bve-provider-http-')),
    bytes = await image();
  const app = await startApp(
    root,
    0,
    join(import.meta.dirname, '../dist'),
    config(async () => imageResponse(bytes)),
  );
  t.after(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });
  const session = (await (
    await fetch(app.origin + '/api/v1/session')
  ).json()) as { token: string };
  const p = app.workspace.create({
    title: 'HTTP fixture',
    mode: 'freeroam',
    visualOS: null,
    palette: null,
  }).project!;
  app.providers.prepare(p.id, {
    expectedProject: reference(p),
    operation: 'assistant',
    artifact: null,
    scope: 'hero',
    instructions: 'Synthetic',
    size: '1024x1024',
    quality: 'low',
    references: [],
  });
  const body = JSON.stringify({
    projectId: p.id,
    input: { job: reference(job(app.workspace, p.id)) },
  });
  for (const headers of [
    {
      'Content-Type': 'application/json',
      Origin: 'https://foreign.invalid',
      'X-BVE-Token': session.token,
    },
    {
      'Content-Type': 'application/json',
      Origin: app.origin,
      'X-BVE-Token': 'wrong',
    },
  ])
    assert.equal(
      (
        await fetch(app.origin + '/api/v1/provider/submit', {
          method: 'POST',
          headers,
          body,
        })
      ).status,
      403,
    );
  const a = app.workspace.explore(p.id, {
    expectedProject: reference(p),
    count: 3,
    base: null,
  });
  const first = (a.bundles!.at(-1) as NodePacket<{ candidates: VersionRef[] }>)
    .payload.candidates[0]!;
  app.providers.prepare(p.id, {
    expectedProject: reference(p),
    operation: 'generate',
    artifact: first,
    scope: 'hero',
    instructions: 'Synthetic',
    size: '1024x1024',
    quality: 'low',
    references: [],
  });
  app.providers.submit(p.id, { job: reference(job(app.workspace, p.id)) });
  await app.providers.wait();
  const out = job(app.workspace, p.id).payload.state.outputs[0]!;
  const response = await fetch(
    app.origin +
      '/api/v1/asset?project=' +
      p.id +
      '&id=' +
      out.id +
      '&version=' +
      out.version,
  );
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  assert.equal(response.headers.get('content-type'), 'image/png');
  const read = await (
    await fetch(app.origin + '/api/v1/workspace?project=' + p.id)
  ).text();
  assert.ok(!read.includes(key));
  assert.ok(!read.includes(root));
});

test('process interruption recovers one uncertain attempt and reservation without any automatic transport', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'bve-provider-interruption-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const child = spawnSync(
    process.execPath,
    [
      join(import.meta.dirname, '../scripts/provider-interruption-fixture.ts'),
      root,
    ],
    { encoding: 'utf8', timeout: 15000 },
  );
  assert.equal(child.status, 0, child.stderr);
  const ids = JSON.parse(child.stdout.trim()) as {
    projectId: string;
    attemptId: string;
  };
  const w = new Workspace(root);
  let calls = 0;
  const api = new Providers(
    w,
    config(async () => {
      calls++;
      throw new Error('must not call');
    }),
  );
  assert.equal(job(w, ids.projectId).payload.state.status, 'outcome-uncertain');
  assert.equal(job(w, ids.projectId).id, ids.attemptId);
  assert.equal(api.status().budget!.reservedUSD, 1);
  assert.equal(calls, 0);
  assert.equal(w.kernel.selected(ids.projectId, 'hero'), null);
  await api.close();
  w.close();
});
test('storage failure after returned bytes retains provider evidence and spend without candidate acceptance', async (t) => {
  const s = setup(t, async () =>
    imageResponse(await image(), {
      usage: { total_tokens: 15 },
      model: IMAGE_MODELS[0],
    }),
  );
  const j = s.queue();
  s.w.assets.save = () => {
    throw new Error('disk failure /private/location');
  };
  const before = invariant(s.w, s.pid);
  const done = await submit(s, j);
  assert.equal(done.payload.state.status, 'failed');
  assert.equal(done.payload.state.observations.at(-1)!.kind, 'storage-failure');
  assert.equal(
    done.payload.state.observations.at(-1)!.transportRequestId,
    'req_fixture',
  );
  assert.deepEqual(done.payload.state.observations.at(-1)!.usage, {
    total_tokens: 15,
  });
  assert.equal(done.payload.state.outputs.length, 0);
  assert.equal(invariant(s.w, s.pid), before);
  assert.equal(s.api.status().budget!.reservedUSD, 1);
});
test('before-send input failure releases reservation but preserves consumed call and original attempt', async (t) => {
  let calls = 0;
  const s = setup(t, async () => {
    calls++;
    return imageResponse(await image());
  });
  await s.w.addReference(
    s.pid,
    reference(s.w.project(s.pid)),
    await image(),
    'ref',
    'palette',
    'hero',
  );
  const source = s.w.state(s.pid).references![0]!.artifact;
  const j = s.queue('assistant', null, [source]);
  s.w.originalImage = async () => {
    throw new Error('asset unavailable');
  };
  const done = await submit(s, j);
  assert.equal(done.payload.state.status, 'failed');
  assert.equal(done.payload.state.observations.at(-1)!.kind, 'input-rejected');
  assert.equal(calls, 0);
  assert.equal(s.api.status().budget!.callsUsed, 1);
  assert.equal(s.api.status().budget!.reservedUSD, 0);
});
test('reference role tampering and immutable request revisions fail consumption', async (t) => {
  const s = setup(t, async () => assistantResponse());
  await s.w.addReference(
    s.pid,
    reference(s.w.project(s.pid)),
    await image(),
    'ref',
    'palette',
    'hero',
  );
  const source = s.w.state(s.pid).references![0]!.artifact;
  const j = s.queue('assistant', null, [source]);
  const changed = structuredClone(j);
  changed.payload.state.request.references[0]!.role = 'avoid';
  const { integrity: _, ...body } = changed;
  const altered = packet({
    ...body,
    id: 'tampered-attempt',
    payload: {
      ...changed.payload,
      state: {
        ...changed.payload.state,
        request: {
          ...changed.payload.state.request,
          attemptId: 'tampered-attempt',
        },
      },
    },
  });
  s.w.kernel.put(altered);
  const before = invariant(s.w, s.pid);
  assert.throws(
    () => s.api.submit(s.pid, { job: reference(altered) }),
    /role\/version/,
  );
  assert.equal(invariant(s.w, s.pid), before);
});

test('uncertain run blocks another submission until explicit reconciliation, retaining reservation and first history', async (t) => {
  let calls = 0;
  const s = setup(t, async () => {
    calls++;
    if (calls === 1) throw new Error('network interruption');
    return imageResponse(await image());
  });
  const first = await submit(s, s.queue());
  const second = s.queue();
  assert.throws(
    () => s.api.submit(s.pid, { job: reference(second) }),
    /Reconcile/,
  );
  assert.equal(calls, 1);
  s.api.reconcile(s.pid, {
    job: reference(first),
    reason:
      'Operator checked provider records; outcome still unknown. Keep reservation and explicitly proceed within the call bound.',
    verifiedNoCharge: false,
    acknowledgeUncertain: true,
  });
  assert.equal(s.api.status().budget!.reservedUSD, 1);
  s.api.submit(s.pid, { job: reference(second) });
  await s.api.wait();
  assert.equal(calls, 2);
  assert.equal(s.api.status().budget!.callsUsed, 2);
  assert.equal(s.api.status().budget!.reservedUSD, 2);
  assert.equal(
    (
      s.w.read(s.pid, {
        id: first.id,
        version: s.w.kernel.currentVersion(first.id)!,
        freshness: 'pinned',
      }).payload.state as ProviderJob
    ).status,
    'outcome-uncertain',
  );
});

test('two independent service instances cannot claim the same queued attempt twice', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'bve-provider-claim-'));
  const w1 = new Workspace(root),
    w2 = new Workspace(root);
  let calls = 0;
  const config1 = config(async () => {
    calls++;
    return imageResponse(await image());
  });
  const a1 = new Providers(w1, config1),
    a2 = new Providers(w2, config1);
  t.after(async () => {
    await a1.close();
    await a2.close();
    w1.close();
    w2.close();
    rmSync(root, { recursive: true, force: true });
  });
  const p = w1.create({
    title: 'Concurrent fixture',
    mode: 'branded',
    visualOS: null,
    palette: ['#173f45', '#f3ede0', '#de8159'],
  }).project!;
  a1.prepare(p.id, {
    expectedProject: reference(p),
    operation: 'assistant',
    artifact: null,
    scope: 'hero',
    instructions: 'Synthetic',
    size: '1024x1024',
    quality: 'low',
    references: [],
  });
  const j = job(w1, p.id);
  a1.submit(p.id, { job: reference(j) });
  assert.throws(
    () => a2.submit(p.id, { job: reference(j) }),
    /already submitted|changed/,
  );
  await a1.wait();
  assert.equal(calls, 1);
  assert.equal(a2.status().budget!.callsUsed, 1);
  assert.equal(w2.kernel.selected(p.id, 'hero'), null);
});
