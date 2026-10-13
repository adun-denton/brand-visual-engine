import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startApp } from '../src/service/server.ts';
import { offlineVisualProviders } from '../scripts/visual-fixture.ts';
import { nativeOriginal, nativeReturn, fixtureTar } from '../scripts/native-exchange-fixture.ts';
import { canonical, reference, packet, revise } from '../src/kernel/packets.ts';
import { RasterLibrary } from '../src/service/raster-library.ts';
import type { Specification } from '../src/modules/website/exploration-contracts.ts';
import { NativeExchangeAdapter } from '../src/service/native-exchange-adapter.ts';
import { nativeRunId, nativeFresh } from '../src/kernel/native-exchange-gate.ts';
async function setup(t:test.TestContext,count=1){
  const root=mkdtempSync(join(tmpdir(),'bve-native-test-'));let app=await startApp(root,0,undefined,offlineVisualProviders);
  t.after(async()=>{await app.close();rmSync(root,{recursive:true,force:true});});
  const v=app.visual,p=v.create({title:'Synthetic native exchange'}),pid=p.project.id,u=v.exploration.createWorkUnit(pid,{version:1,pageType:'homepage',label:'Homepage',source:'Synthetic native-envelope fixture'});
  const prepared=await v.exploration.prepareOperation(pid,{version:1,compiler:'raster-input-v1',project:p.project,workUnit:reference(u),medium:'website-raster',operation:'create',selections:null,selectionSnapshot:null,rawIntent:'Fixture request without history',count,resources:[],direction:'fresh',brand:{enabled:false},sourceScopes:[],facts:[],constraints:[],metricRequests:[],provenance:'Synthetic fixture only',executionAuthorization:null});
  const e=v.native,q=await e.compile(pid,reference(prepared.specification),64,48),terms={request:reference(q),slots:Array.from({length:count},(_,i)=>i+1),maxSubmissions:count,maxStatusCalls:0,maxCancelCalls:0,timeoutMs:30000,expiresAt:new Date(Date.now()+3600000).toISOString(),evidence:'synthetic-fixture',reason:'Authored fixture manual authority'},g=e.grant(pid,terms),run=e.prepare(pid,reference(g));
  return {root,app,v,p,pid,u,e,q,terms,g,run,prepared,reopen:async()=>{await app.close();app=await startApp(root,0,undefined,offlineVisualProviders);return app;}};
}
async function release(s:Awaited<ReturnType<typeof setup>>,slot=1){const out=await s.e.exportRequest(s.pid,reference(s.run),slot),files=fixtureTar(out.bytes),manifest=files.get('manifest.json')!;files.delete('manifest.json');const p=await new NativeExchangeAdapter().readRequest(manifest,files);return {out,p};}
const raw=(root:string)=>{const db=new DatabaseSync(join(root,'kernel.sqlite'));try{return JSON.stringify(['kernel_packets','kernel_events','kernel_selections'].map(n=>db.prepare('SELECT * FROM '+n+' ORDER BY 1,2').all()));}finally{db.close();}};
test('complete outbox -> portable adapter -> owned result -> cold reopen -> memory and original Library/package export',async t=>{
  const s=await setup(t),{out,p}=await release(s),before=raw(s.root);
  assert.equal(p.evidence,'synthetic-fixture');assert.deepEqual(p.request.brand,{enabled:false});assert.equal(p.request.sources.length,0);
  const again=await s.e.exportRequest(s.pid,reference(s.run),1);assert.deepEqual(again.bytes,out.bytes);assert.equal(raw(s.root),before);
  s.e.claim(s.pid,reference(s.run),1,p.packetDigest);
  const result=await nativeReturn(p),receipt=await s.e.importResult(s.pid,reference(s.run),result.manifest,result.files,false);
  assert.equal(receipt.payload.state.outcome,'returned');assert.equal(receipt.payload.state.result.attestation.hostInvocationId,null);
  const candidate=s.v.state(s.pid,reference(s.u)).candidates[0]!;assert.equal(candidate.payload.state.origin,'imported');assert.equal(candidate.approval,'proposal');assert.deepEqual(s.app.workspace.kernel.acceptedSelections(s.pid),[]);
  const library=new RasterLibrary(s.app.workspace),item=(await library.save(s.pid,{expectedProject:s.p.project,unit:reference(s.u),candidate:reference(candidate),integrity:candidate.integrity,extent:'whole'})).item;
  const original=await library.export(s.pid,'original',reference(item),item.integrity);assert.deepEqual(original.bytes,[...result.files.values()][0]);
  const exported=await library.export(s.pid,'package',reference(item),item.integrity),pack=fixtureTar(exported.bytes),evidence=JSON.parse(pack.get('exchange-evidence.json')!.toString());assert.equal(evidence.version,1);assert.deepEqual(evidence.records.receipt,receipt);assert.equal(evidence.generationClaim,'not-established');
  const capsule=s.app.memory.createCapsule(s.pid,{scope:null,previous:null});
  assert.ok(s.app.memory.download(s.pid,reference(capsule)).output.includes('native-exchange'));
  const app=await s.reopen();assert.equal(app.visual.native.state(s.pid,reference(s.u)).runs[0]!.slots[0]!.status,'returned');assert.deepEqual((await app.library.export(s.pid,'package',reference(item),item.integrity)).bytes,exported.bytes);
});
test('concurrent release/claim consumes one slot; duplicate receipt idempotent, conflicting identity rejects',async t=>{
  const s=await setup(t);const released=await Promise.all([release(s),release(s)]);assert.deepEqual(released[0]!.out.bytes,released[1]!.out.bytes);const {p}=released[0]!;
  s.e.claim(s.pid,reference(s.run),1,p.packetDigest);assert.throws(()=>s.e.claim(s.pid,reference(s.run),1,p.packetDigest),/denied|consumed/);
  const r=await nativeReturn(p),a=await s.e.importResult(s.pid,reference(s.run),r.manifest,r.files,false),snapshot=raw(s.root);
  const b=await s.e.importResult(s.pid,reference(s.run),r.manifest,r.files,false);assert.deepEqual(b,a);assert.equal(raw(s.root),snapshot);
  await assert.rejects(s.e.importResult(s.pid,reference(s.run),Buffer.from(canonical({...r.result,message:'conflict'})),r.files,false),/Conflicting/);assert.equal(raw(s.root),snapshot);
});
test('wrong project/request/spec/grant/slot/submission/job/hash and forged provenance reject atomically',async t=>{
  const s=await setup(t),{p}=await release(s);s.e.claim(s.pid,reference(s.run),1,p.packetDigest);const r=await nativeReturn(p),snapshot=raw(s.root);
  const changes=[...['projectId','specHash','requestHash','submissionId','exchangeJobId'].map(k=>({binding:{...r.result.binding,[k]:k.endsWith('Hash')?'a'.repeat(64):'wrong'}})),...['workUnit','spec','request','grant','execution'].map(k=>({binding:{...r.result.binding,[k]:{id:'wrong',version:1,freshness:'pinned'}}})),{binding:{...r.result.binding,slot:2}},{packetDigest:'a'.repeat(64)},{origin:'generated'},{attestation:{...r.result.attestation,verification:'machine-verified'}},{attestation:{...r.result.attestation,kind:'operator-attested-native'}},{attestation:{...r.result.attestation,hostInvocationId:'forged'}}];
  for(const change of changes){await assert.rejects(s.e.importResult(s.pid,reference(s.run),Buffer.from(canonical({...r.result,...change})),r.files,false));assert.equal(raw(s.root),snapshot);}
});
test('strict dimensions, full decode, size, path safety, missing/extra files and malformed second slot preserve prior output',async t=>{
  const s=await setup(t,2),{p}=await release(s);s.e.claim(s.pid,reference(s.run),1,p.packetDigest);const first=await nativeReturn(p);await s.e.importResult(s.pid,reference(s.run),first.manifest,first.files,false);
  const second=await release(s,2);s.e.claim(s.pid,reference(s.run),2,second.p.packetDigest);const snapshot=raw(s.root);
  for(const [w,h] of [[65,48],[64,49]]){const r=await nativeReturn(second.p,await nativeOriginal(w,h));await assert.rejects(s.e.importResult(s.pid,reference(s.run),r.manifest,r.files,false),/dimensions/);assert.equal(raw(s.root),snapshot);}
  const r=await nativeReturn(second.p,await nativeOriginal(64,48,1));
  for(const files of [new Map<string,Buffer>(),new Map([['../escape',Buffer.from('bad')]]),new Map([...r.files,['assets/'+ 'b'.repeat(64)+'.png',Buffer.from('extra')]]),new Map([[r.result.output!.path,Buffer.from('corrupt')]]),new Map([[r.result.output!.path,Buffer.alloc(8*1024*1024+1)]])]){await assert.rejects(s.e.importResult(s.pid,reference(s.run),r.manifest,files,false));assert.equal(raw(s.root),snapshot);}
  const receipt=await s.e.importResult(s.pid,reference(s.run),r.manifest,r.files,false);assert.equal(receipt.payload.state.outcome,'returned');assert.equal(s.v.state(s.pid,reference(s.u)).candidates.length,2);
});
test('before release and after claim/release crash/reopen never dispatch or restore invocation allowance',async t=>{
  for(const claimed of [false,true]){const s=await setup(t),{p,out}=await release(s);if(claimed)s.e.claim(s.pid,reference(s.run),1,p.packetDigest);const app=await s.reopen(),e=app.visual.native;
    const copy=await e.exportRequest(s.pid,reference(s.run),1);assert.deepEqual(copy.bytes,out.bytes);
    if(claimed)assert.throws(()=>e.claim(s.pid,reference(s.run),1,p.packetDigest),/consumed|denied/);else e.claim(s.pid,reference(s.run),1,p.packetDigest);
    const r=await nativeReturn(p);await e.importResult(s.pid,reference(s.run),r.manifest,r.files,false);assert.equal(app.visual.native.state(s.pid,reference(s.u)).runs.length,1);
  }
});
test('cancel, timeout, revoke, expired/stale context require explicit historical return without membership',async t=>{
  const realNow=Date.now;
  for(const action of ['cancel-before','cancel-after','uncertain','revoke','stale','expiry']){
    const s=await setup(t),{p}=await release(s);if(action!=='cancel-before')s.e.claim(s.pid,reference(s.run),1,p.packetDigest);
    if(action.startsWith('cancel'))s.e.control(s.pid,reference(s.run),1,'cancel');
    if(action==='uncertain')s.e.control(s.pid,reference(s.run),1,'uncertain');
    if(action==='revoke')s.e.revoke(s.pid,reference(s.g));
    if(action==='stale'){const old=s.app.workspace.project(s.pid);s.app.workspace.kernel.put(revise(old,old.payload,'local-operator','Synthetic stale project'));}
    if(action==='expiry'){const now=Date.now;Date.now=()=>Date.parse(s.g.payload.state.expiresAt)+1;t.after(()=>{Date.now=now;});}
    const r=await nativeReturn(p);await assert.rejects(s.e.importResult(s.pid,reference(s.run),r.manifest,r.files,false),/historical/);
    const receipt=await s.e.importResult(s.pid,reference(s.run),r.manifest,r.files,true);assert.equal(receipt.payload.state.outcome,'historical');assert.equal(receipt.payload.state.candidate,null);assert.equal(s.v.state(s.pid,reference(s.u)).candidates.length,0);
    assert.throws(()=>s.e.claim(s.pid,reference(s.run),1,p.packetDigest));await assert.rejects(s.e.exportRequest(s.pid,reference(s.run),1));Date.now=realNow;
  }
});
test('lost canonical latest or all run rows with retained ledger cannot restore release/claim/allowance',async t=>{
  for(const all of [false,true]){const s=await setup(t),{p}=await release(s);s.e.claim(s.pid,reference(s.run),1,p.packetDigest);const db=new DatabaseSync(join(s.root,'kernel.sqlite'));db.prepare(all?'DELETE FROM kernel_packets WHERE id=?':'DELETE FROM kernel_packets WHERE id=? AND version=(SELECT MAX(version) FROM kernel_packets WHERE id=?)').run(...(all?[s.run.id]:[s.run.id,s.run.id]));db.close();const snapshot=raw(s.root);
    assert.throws(()=>s.e.prepare(s.pid,reference(s.g)),/unavailable/);assert.throws(()=>s.e.claim(s.pid,reference(s.run),1,p.packetDigest));await assert.rejects(s.e.exportRequest(s.pid,reference(s.run),1));assert.equal(raw(s.root),snapshot);
  }
});
test('storage failures at original and each kernel transaction insertion never publish partial success, orphans recover',async t=>{
  for(const boundary of ['file','media','candidate','membership','receipt','run']){
    const s=await setup(t),{p}=await release(s);s.e.claim(s.pid,reference(s.run),1,p.packetDigest);const r=await nativeReturn(p),snapshot=raw(s.root);
    const assets=s.app.workspace.assets,save=assets.save.bind(assets);let db:DatabaseSync|null=null;
    if(boundary==='file')assets.save=()=>{throw Error('Injected file failure');};
    else {db=new DatabaseSync(join(s.root,'kernel.sqlite'));const kind={media:'page-media',candidate:'raster-concept',membership:'raster-membership',receipt:'native-exchange-receipt',run:'native-exchange'}[boundary]!;db.exec(`CREATE TRIGGER injected_native_failure BEFORE INSERT ON kernel_packets WHEN json_extract(NEW.body,'$.payload.kind')='${kind}' BEGIN SELECT RAISE(ABORT,'Injected database failure'); END;`);}
    await assert.rejects(s.e.importResult(s.pid,reference(s.run),r.manifest,r.files,false),/Injected/);assert.equal(raw(s.root),snapshot);assert.equal(s.v.state(s.pid,reference(s.u)).candidates.length,0);
    assets.save=save;if(db){db.exec('DROP TRIGGER injected_native_failure');db.close();}
    const receipt=await s.e.importResult(s.pid,reference(s.run),r.manifest,r.files,false);assert.equal(receipt.payload.state.outcome,'returned');assert.equal(s.v.state(s.pid,reference(s.u)).candidates.length,1);
  }
});
test('direct kernel forgery cannot write native work records and V1 parser remains exact',async t=>{
  const s=await setup(t);const {integrity:_,...body}=s.g;const fake=packet({...body,id:'fake-native-grant',provenance:{actor:'local-operator',source:'Forged',previous:null}});
  assert.throws(()=>s.app.workspace.kernel.put(fake),/owned adapter/);assert.equal(nativeRunId(reference(s.g)),s.run.id);
});
test('count six is explicit serial manual continuation; malformed output never auto-retries or advances slots',async t=>{
  const s=await setup(t,6);
  for(let slot=1;slot<=6;slot++){
    const {p}=await release(s,slot);if(slot<6)await assert.rejects(release(s,slot+1),/serial/);
    s.e.claim(s.pid,reference(s.run),slot,p.packetDigest);const r=await nativeReturn(p,await nativeOriginal(64,48,slot%3),'return-'+slot);
    await s.e.importResult(s.pid,reference(s.run),r.manifest,r.files,false);
    const state=s.e.state(s.pid,reference(s.u));assert.equal(state.runs[0]!.slots.filter(a=>a.release).length,slot);
  }
  assert.equal(s.v.state(s.pid,reference(s.u)).candidates.length,6);assert.equal(s.app.workspace.kernel.acceptedSelections(s.pid).length,0);
});
test('Follow/refinement ferry reads exact previous original bytes, rights, notes and roles; Brand/history excluded',async t=>{
  const s=await setup(t),{p}=await release(s);s.e.claim(s.pid,reference(s.run),1,p.packetDigest);const result=await nativeReturn(p);const receipt=await s.e.importResult(s.pid,reference(s.run),result.manifest,result.files,false),candidate=s.v.state(s.pid,reference(s.u)).candidates[0]!;
  const entry={id:'exact-prior-source',candidate:reference(candidate),integrity:candidate.integrity,image:candidate.payload.state.image,orientation:'encoded-top-left',coordinates:'normalized-original',anchor:{kind:'whole'},intent:'include',preservation:null,notes:[{id:'fixture-note',text:'Synthetic refinement note',source:'local-operator'}]};
  const selection=s.v.exploration.selections(s.pid,{version:1,workUnit:reference(s.u),entries:[entry]});
  const spec=s.v.exploration.freeze(s.pid,{...s.prepared.specification.payload.state,selections:reference(selection),selectionSnapshot:selection.payload.state,operation:'refine',direction:'follow',sourceScopes:[{entryId:entry.id,style:'included',content:'included'}]});
  const q=await s.e.compile(s.pid,reference(spec),64,48),g=s.e.grant(s.pid,{...s.terms,request:reference(q)}),run=s.e.prepare(s.pid,reference(g));
  const out=await s.e.exportRequest(s.pid,reference(run),1),files=fixtureTar(out.bytes),manifest=files.get('manifest.json')!;files.delete('manifest.json');const pkg=await s.e.adapter.readRequest(manifest,files);
  assert.deepEqual([...files.values()][0],[...result.files.values()][0]);assert.deepEqual(pkg.request.sources[0]!.entry!.notes,entry.notes);assert.equal(pkg.request.sources[0]!.rights,receipt.payload.state.result.rights);assert.equal(pkg.request.operation,'refine');assert.deepEqual(pkg.request.brand,{enabled:false});assert.ok(!manifest.toString().includes('kernel_events'));
  const broken=new Map(files);broken.delete(pkg.sources[0]!.path);await assert.rejects(s.e.adapter.readRequest(manifest,broken),/Missing/);
  const wrong=new Map([[pkg.sources[0]!.path,await nativeOriginal(64,48,1)]]);await assert.rejects(s.e.adapter.readRequest(manifest,wrong),/hash/);
  s.e.claim(s.pid,reference(run),1,pkg.packetDigest);const r=await nativeReturn(pkg,await nativeOriginal(64,48,1));assert.equal((await s.e.importResult(s.pid,reference(run),r.manifest,r.files,false)).payload.state.outcome,'returned');
  const inspiration=s.v.exploration.selections(s.pid,{...selection.payload.state,entries:[{...entry,intent:'inspiration'}]},reference(selection));const freshSpec=s.v.exploration.freeze(s.pid,{...spec.payload.state,selections:reference(inspiration),selectionSnapshot:inspiration.payload.state,operation:'refresh',direction:'fresh',sourceScopes:[{entryId:entry.id,style:'excluded',content:'excluded'}]});const fresh=await s.e.compile(s.pid,reference(freshSpec),64,48);assert.equal(fresh.payload.state.sources.length,0);assert.ok(!canonical(fresh.payload.state).includes('Synthetic refinement note'));
});
test('new source/selection/page/project heads revoke pre-dispatch authority; delayed return stays historical',async t=>{
  for(const kind of ['page','source','selection']){
    const s=await setup(t),candidate=await s.v.exploration.importCandidate(s.pid,reference(s.u),await nativeOriginal(64,48,1),'Synthetic source fixture');
    const entry={id:'source-entry',candidate:reference(candidate),integrity:candidate.integrity,image:candidate.payload.state.image,orientation:'encoded-top-left',coordinates:'normalized-original',anchor:{kind:'whole'},intent:'include',preservation:null,notes:[]};
    const selection=s.v.exploration.selections(s.pid,{version:1,workUnit:reference(s.u),entries:[entry]});const spec=s.v.exploration.freeze(s.pid,{...s.prepared.specification.payload.state,selections:reference(selection),selectionSnapshot:selection.payload.state,direction:'follow',sourceScopes:[{entryId:entry.id,style:'included',content:'included'}]});const q=await s.e.compile(s.pid,reference(spec),64,48),g=s.e.grant(s.pid,{...s.terms,request:reference(q)}),run=s.e.prepare(s.pid,reference(g)),out=await s.e.exportRequest(s.pid,reference(run),1);const pkg=JSON.parse(out.manifest.toString());
    const old=kind==='page'?s.u:kind==='source'?candidate:selection;s.app.workspace.kernel.put(revise(old,old.payload,'local-operator','Synthetic stale '+kind));const snapshot=raw(s.root);
    assert.throws(()=>s.e.claim(s.pid,reference(run),1,pkg.packetDigest),/stale/);assert.equal(raw(s.root),snapshot);
    const r=await nativeReturn(pkg);await assert.rejects(s.e.importResult(s.pid,reference(run),r.manifest,r.files,false),/historical/);const receipt=await s.e.importResult(s.pid,reference(run),r.manifest,r.files,true);assert.equal(receipt.payload.state.candidate,null);
  }
});
test('manual retry requires consumed parent and a new explicit grant; old uncertain original remains independently historical',async t=>{
  const s=await setup(t),{p}=await release(s);s.e.claim(s.pid,reference(s.run),1,p.packetDigest);s.e.control(s.pid,reference(s.run),1,'uncertain');const parent=s.e.state(s.pid,reference(s.u)).runs[0]!.run;
  assert.throws(()=>s.e.prepare(s.pid,reference(s.g),{execution:reference(parent),slot:1}),/bound/);
  const g=s.e.grant(s.pid,s.terms),retry=s.e.prepare(s.pid,reference(g),{execution:reference(parent),slot:1});assert.equal(retry.payload.state.slots[0]!.release,null);
  const out=await s.e.exportRequest(s.pid,reference(retry),1),p2=JSON.parse(out.manifest.toString());assert.notEqual(p2.binding.exchangeJobId,p.binding.exchangeJobId);s.e.claim(s.pid,reference(retry),1,p2.packetDigest);
  const r=await nativeReturn(p2);await s.e.importResult(s.pid,reference(retry),r.manifest,r.files,false);const old=await nativeReturn(p);assert.equal((await s.e.importResult(s.pid,reference(parent),old.manifest,old.files,true)).payload.state.outcome,'historical');assert.equal(s.v.state(s.pid,reference(s.u)).candidates.length,1);
});
test('released package before-send storage failure leaves slot pending; lost HTTP response after commit preserves same reservation',async t=>{
  const s=await setup(t),db=new DatabaseSync(join(s.root,'kernel.sqlite'));db.exec("CREATE TRIGGER reserve_fail BEFORE INSERT ON kernel_packets WHEN json_extract(NEW.body,'$.payload.kind')='native-exchange' BEGIN SELECT RAISE(ABORT,'Injected reservation failure'); END;");const snapshot=raw(s.root);await assert.rejects(release(s),/Injected/);assert.equal(raw(s.root),snapshot);db.exec('DROP TRIGGER reserve_fail');db.close();const {out,p}=await release(s);const app=await s.reopen();assert.deepEqual((await app.visual.native.exportRequest(s.pid,reference(s.run),1)).bytes,out.bytes);assert.equal(app.visual.native.state(s.pid,reference(s.u)).runs[0]!.slots[0]!.release!.packetDigest,p.packetDigest);
});
test('HTTP import uses original upload bytes through same adapter, origin/token admission and no driver connection',async t=>{
  const s=await setup(t),session=await (await fetch(s.app.origin+'/api/v1/visual/session')).json(),headers={'Content-Type':'application/json','Origin':s.app.origin,'X-BVE-Token':session.token};
  const call=(action:string,input:unknown,h=headers)=>fetch(s.app.origin+'/api/v1/visual/native/'+action,{method:'POST',headers:h,body:JSON.stringify({projectId:s.pid,input})});
  const bad=await call('export',{run:reference(s.run),slot:1},{...headers,Origin:'https://foreign.invalid'});assert.equal(bad.status,403);
  const response=await call('export',{run:reference(s.run),slot:1});assert.equal(response.status,200);const out=fixtureTar(Buffer.from(await response.arrayBuffer())),manifest=out.get('manifest.json')!;out.delete('manifest.json');const pkg=await s.e.adapter.readRequest(manifest,out);assert.equal((await call('claim',{run:reference(s.run),slot:1,packetDigest:pkg.packetDigest})).status,200);
  const r=await nativeReturn(pkg),body={run:reference(s.run),manifest:r.manifest.toString(),files:[...r.files].map(([path,bytes])=>({path,base64:bytes.toString('base64')})),historical:false};const imported=await call('import',body);assert.equal(imported.status,200);assert.deepEqual(s.app.workspace.assets.read(r.result.output!.image.id),[...r.files.values()][0]);assert.equal(s.v.executions.availability().connected,false);
});
