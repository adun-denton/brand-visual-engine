import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, cpSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Workspace } from '../src/service/workspace.ts';
import { AIDirections } from '../src/service/ai-directions.ts';
import { Compositions } from '../src/service/compositions.ts';
import { reference, packet, canonical } from '../src/kernel/packets.ts';
import { aiFixture } from '../scripts/ai-direction-fixture.ts';
import { syntheticCompositionImage } from '../scripts/composition-fixture.ts';
import type {
  DesignArtifact,
  IterationBundle,
  NodePacket,
} from '../src/kernel/contracts.ts';
import type { WebsiteDesignState } from '../src/modules/website/design.ts';
import { parseSpec } from '../src/modules/website/ai-contracts.ts';
import type { ProjectAsset } from '../src/modules/website/ai-contracts.ts';
import type { AISpec } from '../src/modules/website/ai-contracts.ts';
import { sectionIds } from '../src/modules/website/composition.ts';
import { Providers } from '../src/service/providers.ts';
import { exploreWebsite } from '../src/modules/website/design.ts';
import { ASSISTANT_MODELS, IMAGE_MODELS } from '../src/service/openai.ts';
import type { ProviderJob } from '../src/modules/website/provider-contracts.ts';
function setup(t: test.TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'bve-ai-'));
  const w = new Workspace(root, { aiResponseFixture: true });
  t.after(() => {
    try {
      w.close();
    } catch {}
    rmSync(root, { recursive: true, force: true });
  });
  const p = w.create({
    title: 'AI asset fixture',
    mode: 'freeroam',
    visualOS: null,
    palette: null,
  }).project!;
  const ai = new AIDirections(w);
  return { root, w, p, ai };
}
for (const kind of ['legacy', 'AI'] as const) {
  test(`BVE-009-R2: ${kind} refinement projects only deliberately included references into native and offline API inputs`, async t => {
    const s=setup(t), bytes=await syntheticCompositionImage();
    await s.w.addReference(s.p.id,reference(s.p),bytes,'Chosen hero marker','imagery','hero');
    await s.w.addReference(s.p.id,reference(s.w.project(s.p.id)),bytes,'Private unchecked marker','imagery','proof');
    s.p=s.w.project(s.p.id);
    const refs=s.w.references(s.p).map(x=>x.artifact);
    let base: NodePacket<DesignArtifact<WebsiteDesignState>>;
    if(kind==='legacy') {
      const round=exploreWebsite(s.p,'legacy-private-fixture',null,1);
      s.w.kernel.putMany([...round.candidates,round.bundle]); base=round.candidates[0]!;
    } else {
      s.ai.request(s.p.id,{expectedProject:reference(s.p),base:null,count:1,instructions:'Mechanical source with selected references',references:refs});
      const q=s.w.state(s.p.id).artifacts!.filter(a=>a.payload.kind==='website-ai-request').at(-1)!;
      const out=aiFixture(s.p,1); out.candidates[0]!.imageNeeds[0]!.references=[refs[0]!]; out.candidates[0]!.imageNeeds[2]!.references=[refs[1]!];
      s.ai.apply(s.p.id,{request:reference(q),response:out,source:'Mechanical fixture',model:null,aiAuthorship:true});
      base=designs(s)[0]!;
    }
    const original=canonical(base), before=s.w.kernel.ledger(s.p.id);
    let captured='';
    const providers=new Providers(s.w,{apiKey:'offline-fixture',imageModel:IMAGE_MODELS[0],assistantModel:ASSISTANT_MODELS[0],timeoutMs:5000,
      policy:{runId:'scoped-base-fixture',approval:'Offline only',maxCalls:2,capUSD:2,reserveUSD:1,alternativeCallBoundApproved:true,directionGenerationApproved:true,models:[ASSISTANT_MODELS[0]]},
      transport:async(_url,init)=>{captured=String(init?.body);return new Response(JSON.stringify({id:'resp_scoped_fixture',status:'completed',model:ASSISTANT_MODELS[0],output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(aiFixture(s.p,1))}]}]}),{status:200});}});
    for(const included of [[],[refs[0]!]]) {
      s.ai.request(s.p.id,{expectedProject:reference(s.p),base:reference(base),count:1,instructions:'Mechanical scoped refinement',references:included});
      const q=s.w.state(s.p.id).artifacts!.filter(a=>a.payload.kind==='website-ai-request').at(-1)!;
      const projected=s.ai.export(s.p.id,reference(q)), native=JSON.stringify(projected);
      assert(!native.includes('Private unchecked marker')); assert(!native.includes(refs[1]!.id));
      assert.equal(native.includes('Chosen hero marker'),included.length>0);
      if(!included.length)assert(!native.includes(refs[0]!.id));
      assert.equal(projected.base!.thesis,base.payload.state.thesis);
      assert.deepEqual(projected.base!.metrics,base.payload.state.metrics);
      if(kind==='AI')assert.deepEqual((projected.base!.parameters['ai'] as unknown as AISpec).page,parseSpec(base.payload.state.parameters['ai']).page);
      providers.prepare(s.p.id,{expectedProject:reference(s.p),artifact:null,operation:'directions',scope:'landing-page',directionRequest:reference(q),instructions:'Offline scope test',references:included,size:'1024x1024',quality:'low'});
      const job=s.w.state(s.p.id).artifacts!.filter(a=>a.payload.kind==='website-provider-job').at(-1)!;
      providers.submit(s.p.id,{job:reference(job)}); await providers.wait();
      assert(captured); assert(!captured.includes('Private unchecked marker')); assert(!captured.includes(refs[1]!.id));
      assert.equal(captured.includes('Chosen hero marker'),included.length>0);
      if(!included.length)assert(!captured.includes(refs[0]!.id));
    }
    assert.equal(canonical(s.w.read(s.p.id,reference(base))),original);
    assert.deepEqual(s.w.kernel.ledger(s.p.id).events.slice(0,before.events.length),before.events);
  });
}
function request(s: ReturnType<typeof setup>, count = 2) {
  s.ai.request(s.p.id, {
    expectedProject: reference(s.p),
    base: null,
    count,
    instructions: 'Test AI directions contract',
    references: [],
  });
  return s.w
    .state(s.p.id)
    .artifacts!.find((a) => a.payload.kind === 'website-ai-request')!;
}
function apply(s: ReturnType<typeof setup>) {
  const q = request(s);
  s.ai.apply(s.p.id, {
    request: reference(q),
    response: aiFixture(s.p),
    source: 'Authored test fixture; no AI call',
    model: null,
    aiAuthorship: true,
  });
  return s.w.state(s.p.id).bundles!.at(-1)! as NodePacket<IterationBundle>;
}
const designs = (s: ReturnType<typeof setup>) =>
  s.w
    .state(s.p.id)
    .artifacts!.filter(
      (a) => a.payload.kind === 'website-design',
    ) as NodePacket<DesignArtifact<WebsiteDesignState>>[];
const asset = (s: ReturnType<typeof setup>) =>
  s.w
    .state(s.p.id)
    .artifacts!.filter((a) => a.payload.kind === 'website-asset')
    .at(-1)! as NodePacket<DesignArtifact<ProjectAsset>>;
test('production exploration records pending request with no fixed candidate fallback; AI intake binds renderable decisions and rejects stale/unsafe/locked output', (t) => {
  const s = setup(t),
    q = request(s);
  assert.equal(designs(s).length, 0);
  assert.equal(s.w.state(s.p.id).bundles!.length, 0);
  const out = aiFixture(s.p);
  const bad = structuredClone(out);
  bad.candidates[0]!.page.sections[0]!.blocks[1]!.text = 'Lost intent';
  assert.throws(
    () =>
      s.ai.apply(s.p.id, {
        request: reference(q),
        response: bad,
        source: 'fixture',
        model: null,
        aiAuthorship: true,
      }),
    /locked intent/,
  );
  const unsafe = structuredClone(out);
  unsafe.candidates[0]!.page.sections[0]!.blocks[2]!.href =
    'javascript:alert(1)';
  assert.throws(
    () =>
      s.ai.apply(s.p.id, {
        request: reference(q),
        response: unsafe,
        source: 'fixture',
        model: null,
        aiAuthorship: true,
      }),
    /HTTPS/,
  );
  assert.throws(
    () =>
      s.ai.apply(s.p.id, {
        request: reference(q),
        response: out,
        source: 'fixture',
        model: null,
        aiAuthorship: false,
      }),
    /Attest/,
  );
  s.ai.apply(s.p.id, {
    request: reference(q),
    response: out,
    source: 'fixture',
    model: null,
    aiAuthorship: true,
  });
  assert.equal(designs(s).length, 2);
  assert.equal(
    parseSpec(designs(s)[0]!.payload.state.parameters['ai']).page.style
      .headingSize,
    64,
  );
  assert.equal(s.w.kernel.selected(s.p.id, 'design'), null);
  assert.throws(
    () =>
      s.ai.apply(s.p.id, {
        request: reference(q),
        response: out,
        source: 'fixture',
        model: null,
        aiAuthorship: true,
      }),
    /changed|applied/,
  );
  const exported = JSON.stringify(s.ai.export(s.p.id, reference(q)));
  assert(!exported.includes('provider-budget'));
  assert(exported.includes('outputSchema'));
});
test('asset role/version isolation, same bytes under two directions, stale placement and pinned accepted export survive closed copy', async (t) => {
  const s = setup(t);
  let b = apply(s);
  const d = designs(s)[0]!,
    d2 = designs(s)[1]!;
  s.w.select(s.p.id, {
    bundle: reference(b),
    candidate: reference(d),
    reason: 'Fixture select',
  });
  b = s.w.state(s.p.id).bundles!.at(-1)! as NodePacket<IterationBundle>;
  s.w.accept(s.p.id, {
    artifact: reference(d),
    bundle: reference(b),
    expected: null,
    reason: 'Explicit fixture acceptance',
    slot: 'design',
    allowHistorical: false,
  });
  await s.ai.addAsset(
    s.p.id,
    {
      expectedProject: reference(s.p),
      origin: null,
      label: 'Supplied fixture',
      role: 'reference',
      permission: 'Authored synthetic bytes',
    },
    await syntheticCompositionImage(),
  );
  let a = asset(s);
  const input = {
    expectedProject: reference(s.p),
    direction: reference(d),
    bundle: reference(b),
    asset: reference(a),
    section: 'hero',
    alt: 'Authored abstract scene',
    unresolved: '',
    reason: 'Deliberate same-byte test placement',
  };
  await assert.rejects(s.ai.place(s.p.id, input), /placeable/);
  s.ai.reviseAsset(s.p.id, {
    expectedProject: reference(s.p),
    expected: reference(a),
    label: a.payload.state.label,
    role: 'placeable',
    permission: 'Explicitly allow synthetic final placement',
  });
  a = asset(s);
  await s.ai.place(s.p.id, { ...input, asset: reference(a) });
  const placed = designs(s).find((x) => x.id === d.id)!;
  assert.equal(placed.version, 2);
  assert.deepEqual(s.w.kernel.selected(s.p.id, 'design'), reference(d));
  b = s.w.state(s.p.id).bundles!.at(-1)! as NodePacket<IterationBundle>;
  await s.ai.place(s.p.id, {
    ...input,
    direction: reference(d2),
    bundle: reference(b),
    asset: reference(a),
  });
  await assert.rejects(
    s.ai.place(s.p.id, { ...input, asset: reference(a) }),
    /changed|historical/,
  );
  const sameBytes = designs(s).map(
    (x) =>
      parseSpec(x.payload.state.parameters['ai']).page.sections[0]!.blocks.find(
        (b) => b.kind === 'image',
      )!.image!.checksum,
  );
  assert.equal(sameBytes[0], sameBytes[1]);
  assert.equal(
    parseSpec(
      (s.w.read(s.p.id, reference(d)).payload.state as WebsiteDesignState)
        .parameters['ai'],
    ).page.sections[0]!.blocks.at(-1)!.asset,
    null,
  );
  s.ai.reviseAsset(s.p.id, {
    expectedProject: reference(s.p),
    expected: reference(a),
    label: 'Reference again',
    role: 'reference',
    permission: 'Does not change old placement permission',
  });
  assert.equal(
    (await s.ai.preview(s.p.id, reference(placed))).includes(
      a.payload.state.image.checksum,
    ),
    false,
  );
  const c = new Compositions(s.w);
  c.start(s.p.id, {
    expectedProject: reference(s.p),
    direction: reference(placed),
    reason: 'Use exact AI page and image',
  });
  let page = s.w
    .state(s.p.id)
    .artifacts!.find((x) => x.payload.kind === 'website-composition')!;
  await c.review(s.p.id, {
    expectedProject: reference(s.p),
    expected: reference(page),
    sections: sectionIds,
    reason: 'Synthetic technical review; unresolved acknowledged',
  });
  page = s.w
    .state(s.p.id)
    .artifacts!.find((x) => x.payload.kind === 'website-composition')!;
  await c.accept(s.p.id, {
    expectedProject: reference(s.p),
    artifact: reference(page),
    expected: null,
    reason: 'Explicit fixture page acceptance',
  });
  const pkg = await c.export(s.p.id, reference(page));
  const before = canonical(s.w.state(s.p.id));
  s.w.close();
  const copy = s.root + '-copy';
  cpSync(s.root, copy, { recursive: true });
  const reopened = new Workspace(copy);
  try {
    assert.equal(canonical(reopened.state(s.p.id)), before);
    assert.deepEqual(
      await new Compositions(reopened).export(s.p.id, reference(page)),
      pkg,
    );
    assert.match(
      await new AIDirections(reopened).preview(s.p.id, reference(placed)),
      /Supplied|calmer|calm/,
    );
  } finally {
    reopened.close();
    rmSync(copy, { recursive: true, force: true });
  }
});
test('foreign/missing/corrupt assets and forged AI decisions fail without promotion', async (t) => {
  const s = setup(t),
    b = apply(s),
    d = designs(s)[0]!;
  await s.ai.addAsset(
    s.p.id,
    {
      expectedProject: reference(s.p),
      origin: null,
      label: 'fixture',
      role: 'placeable',
      permission: 'synthetic',
    },
    await syntheticCompositionImage(),
  );
  const a = asset(s),
    other = s.w.create({
      title: 'Other project',
      mode: 'freeroam',
      visualOS: null,
      palette: null,
    }).project!;
  await assert.rejects(
    s.ai.addAsset(other.id, {
      expectedProject: reference(other),
      origin: reference(a),
      label: 'foreign',
      role: 'placeable',
      permission: 'none',
    }),
    /owner|project|owned/,
  );
  const forged = structuredClone(d);
  const spec = parseSpec(forged.payload.state.parameters['ai']);
  spec.page.title = 'Forged author decisions';
  forged.payload.state.parameters['ai'] = spec as never;
  const { integrity: _, ...body } = forged;
  const bad = packet({ ...body, id: 'forged-ai' });
  s.w.kernel.put(bad);
  assert.throws(() => s.w.read(s.p.id, reference(bad)), /diverge/);
  writeFileSync(
    join(s.w.assets.root, a.payload.state.image.id),
    Buffer.from('corrupt'),
  );
  await assert.rejects(
    s.ai.place(s.p.id, {
      expectedProject: reference(s.p),
      direction: reference(d),
      bundle: reference(b),
      asset: reference(a),
      section: 'hero',
      alt: 'fixture',
      unresolved: '',
      reason: 'test',
    }),
    /unavailable|corrupt|asset/i,
  );
  assert.equal(s.w.kernel.selected(s.p.id, 'design'), null);
});
test('API directions require separate approval before reserve/send; returned structured output requires explicit apply', async (t) => {
  const s = setup(t),
    q = request(s);
  let calls = 0;
  const config = {
    apiKey: 'offline-only',
    imageModel: IMAGE_MODELS[0],
    assistantModel: ASSISTANT_MODELS[0],
    timeoutMs: 5000,
    policy: {
      runId: 'test-directions',
      approval: 'Offline fixture only',
      maxCalls: 2,
      capUSD: 2,
      reserveUSD: 1,
      alternativeCallBoundApproved: true as const,
      models: [ASSISTANT_MODELS[0]],
    },
    transport: async () => {
      calls++;
      return new Response(
        JSON.stringify({
          id: 'resp_fixture',
          status: 'completed',
          model: ASSISTANT_MODELS[0],
          output: [
            {
              type: 'message',
              role: 'assistant',
              status: 'completed',
              content: [
                { type: 'output_text', text: JSON.stringify(aiFixture(s.p)) },
              ],
            },
          ],
        }),
        { status: 200 },
      );
    },
  };
  let providers = new Providers(s.w, config);
  providers.prepare(s.p.id, {
    expectedProject: reference(s.p),
    artifact: null,
    operation: 'directions',
    scope: 'landing-page',
    directionRequest: reference(q),
    instructions: 'AI fixture',
    references: [],
    size: '1024x1024',
    quality: 'low',
  });
  const job = () =>
    s.w
      .state(s.p.id)
      .artifacts!.find(
        (x) => x.payload.kind === 'website-provider-job',
      )! as NodePacket<DesignArtifact<ProviderJob>>;
  assert.throws(
    () => providers.submit(s.p.id, { job: reference(job()) }),
    /Separate direction/,
  );
  assert.equal(calls, 0);
  assert.equal(providers.status().budget!.callsUsed, 0);
  providers = new Providers(s.w, {
    ...config,
    policy: { ...config.policy, directionGenerationApproved: true },
  });
  providers.submit(s.p.id, { job: reference(job()) });
  await providers.wait();
  assert.equal(calls, 1);
  assert.equal(job().payload.state.status, 'returned');
  assert.equal(designs(s).length, 0);
  s.ai.apply(s.p.id, {
    request: reference(q),
    evidence: job().payload.state.outputs[0],
  });
  assert.equal(designs(s).length, 2);
  assert.equal(s.w.kernel.selected(s.p.id, 'design'), null);
});
for (const mode of ['late', 'cancelled', 'restart-uncertain'] as const)
  test(`AI API ${mode} preserves exact output/history without draft or acceptance promotion`, async (t) => {
    const s = setup(t),
      q = request(s);
    let release!: (r: Response) => void, started!: () => void;
    const began = new Promise<void>((r) => (started = r));
    let calls = 0;
    const config = {
      apiKey: 'offline-only',
      imageModel: IMAGE_MODELS[0],
      assistantModel: ASSISTANT_MODELS[0],
      timeoutMs: 5000,
      policy: {
        runId: 'fixture-' + mode,
        approval: 'Offline fixture only',
        maxCalls: 1,
        capUSD: 1,
        reserveUSD: 1,
        alternativeCallBoundApproved: true as const,
        directionGenerationApproved: true as const,
        models: [ASSISTANT_MODELS[0]],
      },
      transport: async () => {
        calls++;
        started();
        return new Promise<Response>((r) => (release = r));
      },
    };
    const providers = new Providers(s.w, config);
    providers.prepare(s.p.id, {
      expectedProject: reference(s.p),
      artifact: null,
      operation: 'directions',
      scope: 'landing-page',
      directionRequest: reference(q),
      instructions: 'AI fixture',
      references: [],
      size: '1024x1024',
      quality: 'low',
    });
    const job = () =>
      s.w.kernel
        .latestPackets()
        .find(
          (x) =>
            x.projectId === s.p.id &&
            x.type === 'design-artifact' &&
            (x.payload as DesignArtifact<unknown>).kind ===
              'website-provider-job',
        )! as NodePacket<DesignArtifact<ProviderJob>>;
    providers.submit(s.p.id, { job: reference(job()) });
    await began;
    if (mode === 'late') {
      s.w.reviseProject(s.p.id, {
        expectedProject: reference(s.p),
        reason: 'New brief while pending',
        brief: { offer: 'Changed offer' },
      });
    } else if (mode === 'cancelled')
      providers.cancel(s.p.id, {
        job: reference(job()),
        reason: 'Local cancellation',
      });
    else {
      new Providers(s.w, config);
      assert.equal(job().payload.state.status, 'outcome-uncertain');
      assert.equal(providers.status().budget!.callsUsed, 1);
    }
    release(
      new Response(
        JSON.stringify({
          id: 'resp_fixture_' + mode,
          status: 'completed',
          model: ASSISTANT_MODELS[0],
          output: [
            {
              type: 'message',
              role: 'assistant',
              status: 'completed',
              content: [
                { type: 'output_text', text: JSON.stringify(aiFixture(s.p)) },
              ],
            },
          ],
        }),
        { status: 200 },
      ),
    );
    await providers.wait();
    assert.equal(calls, 1);
    assert.equal(designs(s).length, 0);
    assert.equal(s.w.kernel.selected(s.p.id, 'design'), null);
    assert.throws(
      () =>
        s.ai.apply(s.p.id, {
          request: reference(q),
          evidence: job().payload.state.outputs[0],
        }),
      /changed|usable|current/,
    );
    assert.equal(providers.status().budget!.callsUsed, 1);
  });
test('chosen AI references are scoped/exact and unchosen reference metadata stays out of request and direction state', async (t) => {
  const s = setup(t),
    bytes = await syntheticCompositionImage();
  await s.w.addReference(
    s.p.id,
    reference(s.p),
    bytes,
    'Chosen hero original',
    'imagery',
    'hero',
  );
  await s.w.addReference(
    s.p.id,
    reference(s.w.project(s.p.id)),
    bytes,
    'Private unchosen marker',
    'imagery',
    'proof',
  );
  s.p = s.w.project(s.p.id);
  const selected = s.w.references(s.p),
    r = selected[0]!.artifact;
  s.ai.request(s.p.id, {
    expectedProject: reference(s.p),
    base: null,
    count: 1,
    instructions: 'Scoped exact reference test',
    references: [r],
  });
  const q = s.w
    .state(s.p.id)
    .artifacts!.find((a) => a.payload.kind === 'website-ai-request')!;
  const out = aiFixture(s.p, 1);
  out.candidates[0]!.imageNeeds[0]!.references = [r];
  const bad = structuredClone(out);
  bad.candidates[0]!.imageNeeds[1]!.references = [r];
  assert.throws(
    () =>
      s.ai.apply(s.p.id, {
        request: reference(q),
        response: bad,
        source: 'fixture',
        model: null,
        aiAuthorship: true,
      }),
    /scope/,
  );
  const exported = JSON.stringify(s.ai.export(s.p.id, reference(q)));
  assert(!exported.includes('Private unchosen marker'));
  assert(exported.includes('Chosen hero original'));
  s.ai.apply(s.p.id, {
    request: reference(q),
    response: out,
    source: 'fixture',
    model: null,
    aiAuthorship: true,
  });
  assert(
    !JSON.stringify(designs(s)[0]!.payload.state).includes(
      'Private unchosen marker',
    ),
  );
});
test('Branded AI output retains mounted origins/locks and never promotes local proposed decisions into VisualOS', (t) => {
  const s = setup(t),
    brand = s.w.create({
      title: 'Branded AI fixture',
      mode: 'branded',
      visualOS: null,
      palette: ['#173f45', '#f3ede0', '#de8159'],
    }).project!;
  s.p = brand;
  const q = request(s, 1),
    before = canonical(s.w.state().visualOS);
  s.ai.apply(s.p.id, {
    request: reference(q),
    response: aiFixture(s.p, 1),
    source: 'Authored mechanical fixture',
    model: null,
    aiAuthorship: true,
  });
  const b = s.w.state(s.p.id).bundles!.at(-1)! as NodePacket<IterationBundle>;
  assert.deepEqual(b.payload.inherited['palette'], [
    '#173f45',
    '#f3ede0',
    '#de8159',
  ]);
  assert.equal(canonical(s.w.state().visualOS), before);
  assert.equal(
    s.w.project(s.p.id).payload.resolvedContext.fields['palette']!.effective!
      .origin,
    'inherited',
  );
});
