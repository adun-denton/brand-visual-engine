import {inspectRaster} from '../src/service/assets.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,readdirSync,symlinkSync,linkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {initializeProject} from '../src/service/project-bootstrap.ts';
import {Workspace} from '../src/service/workspace.ts';
import {ProductionIntake,bytesHash} from '../src/service/production-intake.ts';
import {VisualWorkspace} from '../src/service/visual-workspace.ts';
import {reference,packet,revise} from '../src/kernel/packets.ts';
import {fixtureInstallation,fixturePreparation,authoredOriginal,stageDelivery} from '../scripts/production-fixture.ts';
import {RasterLibrary} from '../src/service/raster-library.ts';
const setup=()=>{const root=mkdtempSync(join(tmpdir(),'bve-production-')),config=initializeProject(root,fixtureInstallation),w=new Workspace(join(root,'runtime')),p=new ProductionIntake(w,root);return{root,config,w,p,close(){w.close();rmSync(root,{recursive:true,force:true});}};};
const snapshot=(w:Workspace,pid:string)=>JSON.stringify({packets:w.kernel.latestPackets(),ledger:w.kernel.ledger(pid),selected:w.kernel.acceptedSelections(pid)});
test('A04/A05/A06/A08/A10 three production originals, exact exports, distinct jobs sharing content, replay and cold reopen',async()=>{
 const f=setup();try{
  const prepared=f.p.prepare(fixturePreparation(f.w,f.config));assert.equal(prepared.jobs.length,3);assert.equal(new Set(prepared.jobs.map(j=>j.id)).size,3);
  const bytes=[await authoredOriginal(0),await authoredOriginal(1),await authoredOriginal(0)];
  const receipts=[];
  for(let i=0;i<3;i++){const j=prepared.jobs[i]!;await stageDelivery(f.root,j,bytes[i]!);const r=await f.p.intake(j.id);assert.equal(r.payload.state.disposition,'ready');receipts.push(r);assert.deepEqual(f.w.assets.read(r.payload.state.observed!.id),bytes[i]);assert.deepEqual((await new VisualWorkspace(f.w).exploration.raster(f.config.projectId,r.payload.state.candidate!)).bytes,bytes[i]);
   const exp=await new RasterLibrary(f.w).export(f.config.projectId,'original',r.payload.state.candidate!,f.w.kernel.get(r.payload.state.candidate!).integrity,f.config.initialWorkUnit);assert.deepEqual(exp.bytes,bytes[i]);
  }
  assert.notEqual(receipts[0]!.payload.state.candidate!.id,receipts[2]!.payload.state.candidate!.id);assert.equal(receipts[0]!.payload.state.observed!.id,receipts[2]!.payload.state.observed!.id);
  assert.equal(new VisualWorkspace(f.w).state(f.config.projectId,f.config.initialWorkUnit).candidates.length,3);
  const before=snapshot(f.w,f.config.projectId);assert.deepEqual(await f.p.intake(prepared.jobs[0]!.id),receipts[0]);assert.equal(snapshot(f.w,f.config.projectId),before);
  assert.equal(f.w.kernel.ledger(f.config.projectId).events.some(e=>e.kind==='acceptance'),false);
  f.w.close();const w=new Workspace(join(f.root,'runtime'));try{const p=new ProductionIntake(w,f.root);assert.equal(snapshot(w,f.config.projectId),before);assert.deepEqual(await p.intake(prepared.jobs[0]!.id),receipts[0]);assert.equal(p.jobs().length,3);assert.equal(p.receipts().length,3);}finally{w.close();}
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
test('A07 wrong project/page/job/spec/source bindings reject before registration',async()=>{
 const f=setup();try{
  const j=f.p.prepare(fixturePreparation(f.w,f.config,1)).jobs[0]!,bytes=await authoredOriginal();
  for(const patch of [{projectId:'wrong'}, {workUnit:{...f.config.initialWorkUnit,id:'wrong'}},{jobId:'wrong'},{specHash:'0'.repeat(64)},{spec:{...j.payload.state.spec,id:'wrong'}},{sources:[{media:f.config.initialWorkUnit,hash:'0'.repeat(64),candidate:null}]}]){
   await stageDelivery(f.root,j,bytes, 'ready',patch);const before=snapshot(f.w,f.config.projectId);await assert.rejects(f.p.intake(j.id),/binding rejected/);assert.equal(snapshot(f.w,f.config.projectId),before);
  }
 }finally{f.close();}
});
test('A08 changed output is a durable conflict and cannot replace existing result',async()=>{
 const f=setup();try{const j=f.p.prepare(fixturePreparation(f.w,f.config,1)).jobs[0]!;await stageDelivery(f.root,j,await authoredOriginal());const first=await f.p.intake(j.id);await stageDelivery(f.root,j,await authoredOriginal(1));const conflict=await f.p.intake(j.id);assert.equal(conflict.payload.state.disposition,'conflict');assert.equal(conflict.payload.state.observed!.checksum,bytesHash(await authoredOriginal(1)));assert.equal(conflict.payload.state.candidate,null);assert.deepEqual(f.w.assets.read(conflict.payload.state.observed!.id),await authoredOriginal(1));assert.equal(f.p.jobs()[0]!.payload.state.receipt!.id,first.id);assert.equal(new VisualWorkspace(f.w).state(f.config.projectId,f.config.initialWorkUnit).candidates.length,1);const before=snapshot(f.w,f.config.projectId);assert.deepEqual(await f.p.intake(j.id),conflict);assert.equal(snapshot(f.w,f.config.projectId),before);}finally{f.close();}
});
test('A09 incomplete, malformed markers, traversal, links, corrupt/oversized/changed originals do not consume job',async()=>{
 const f=setup();try{
  const j=f.p.prepare(fixturePreparation(f.w,f.config,1)).jobs[0]!,dir=join(f.root,j.payload.state.staging),bytes=await authoredOriginal();
  const incomplete=await f.p.intake(j.id);assert.equal(incomplete.payload.state.disposition,'incomplete');assert.equal(f.p.jobs()[0]!.payload.state.status,'pending');
  await stageDelivery(f.root,j,bytes);writeFileSync(join(dir,'complete.json'),'{}');let before=snapshot(f.w,f.config.projectId);await assert.rejects(f.p.intake(j.id),/marker/);assert.equal(snapshot(f.w,f.config.projectId),before);
  for(const filename of ['../outside.png','/outside.png','..\\outside.png','C:\\outside.png']){
   await stageDelivery(f.root,j,bytes,'ready',{output:{filename,image:(await inspectRaster(bytes)).image}});before=snapshot(f.w,f.config.projectId);await assert.rejects(f.p.intake(j.id),/filename/);assert.equal(snapshot(f.w,f.config.projectId),before);
  }
  await stageDelivery(f.root,j,bytes);writeFileSync(join(dir,'original.png'),Buffer.alloc(9*1024*1024));before=snapshot(f.w,f.config.projectId);await assert.rejects(f.p.intake(j.id),/oversized/);assert.equal(snapshot(f.w,f.config.projectId),before);
  await stageDelivery(f.root,j,bytes);writeFileSync(join(dir,'original.png'),bytes.subarray(0,24));await assert.rejects(f.p.intake(j.id),/decoded/);
  await stageDelivery(f.root,j,bytes);writeFileSync(join(dir,'original.png'),await authoredOriginal(1));await assert.rejects(f.p.intake(j.id),/does not match/);
  await stageDelivery(f.root,j,bytes);const outside=join(f.root,'references/outside.png');writeFileSync(outside,bytes);rmSync(join(dir,'original.png'));
  if(process.platform!=='win32'){symlinkSync(outside,join(dir,'original.png'));await assert.rejects(f.p.intake(j.id),/Redirected/);rmSync(join(dir,'original.png'));}
  linkSync(outside,join(dir,'original.png'));await assert.rejects(f.p.intake(j.id),/Unsafe/);rmSync(join(dir,'original.png'));
  rmSync(dir,{recursive:true});if(process.platform!=='win32'){symlinkSync(join(f.root,'references'),dir,'dir');await assert.rejects(f.p.intake(j.id),/Redirected/);rmSync(dir);}
  assert.equal(f.p.jobs()[0]!.payload.state.status,'pending');assert.equal(new VisualWorkspace(f.w).state(f.config.projectId,f.config.initialWorkUnit).candidates.length,0);
 }finally{f.close();}
});
test('A11 cancelled/superseded/stale results are historical; failed and uncertain retain evidence; no retries',async()=>{
 const f=setup();try{
  const one=f.p.prepare(fixturePreparation(f.w,f.config,1)),j=one.jobs[0]!;f.p.cancel(reference(one.iteration));await stageDelivery(f.root,j,await authoredOriginal());const late=await f.p.intake(j.id);assert.equal(late.payload.state.disposition,'historical');assert.equal(late.payload.state.candidate,null);
  const two=f.p.prepare(fixturePreparation(f.w,f.config,1)),old=two.jobs[0]!;f.p.prepare(fixturePreparation(f.w,f.config,1));await stageDelivery(f.root,old,await authoredOriginal());assert.equal((await f.p.intake(old.id)).payload.state.disposition,'historical');
  for(const outcome of ['failed','uncertain'] as const){const j=f.p.prepare(fixturePreparation(f.w,f.config,1)).jobs[0]!;await stageDelivery(f.root,j,null,outcome);assert.equal((await f.p.intake(j.id)).payload.state.disposition,outcome);}
  assert.equal(f.p.jobs().length,5);assert.equal(new VisualWorkspace(f.w).state(f.config.projectId,f.config.initialWorkUnit).candidates.length,0);assert.equal(f.w.kernel.acceptedSelections(f.config.projectId).length,0);
 }finally{f.close();}
});
test('A13 DB failure rolls back all authoritative intake records; original bytes remain recoverable, then replay succeeds',async()=>{
 const f=setup();try{
  const j=f.p.prepare(fixturePreparation(f.w,f.config,1)).jobs[0]!,bytes=await authoredOriginal();await stageDelivery(f.root,j,bytes);const before=snapshot(f.w,f.config.projectId),db=new DatabaseSync(join(f.root,'runtime/kernel.sqlite'));
  db.exec("CREATE TRIGGER fail_production BEFORE INSERT ON kernel_packets WHEN json_extract(NEW.body,'$.payload.kind')='production-receipt' BEGIN SELECT RAISE(ABORT,'injected production failure'); END");
  await assert.rejects(f.p.intake(j.id),/injected/);assert.equal(snapshot(f.w,f.config.projectId),before);assert.equal(f.w.assets.read(bytesHash(bytes)).equals(bytes),true);db.exec('DROP TRIGGER fail_production');db.close();assert.equal((await f.p.intake(j.id)).payload.state.disposition,'ready');
 }finally{f.close();}
});
test('A13 direct kernel writes cannot forge production records or revise frozen jobs; async cancellation preserves history',async()=>{
 const f=setup();try{
  const prep=f.p.prepare(fixturePreparation(f.w,f.config,1)),j=prep.jobs[0]!;
  assert.throws(()=>f.w.kernel.put(packet({type:'work-record',id:'forged-production',projectId:f.config.projectId,payload:{...j.payload,state:{...j.payload.state,ordinal:7}}})),/owning intake service/);
  assert.throws(()=>f.w.kernel.put(revise(j,{...j.payload,state:{...j.payload.state,prompt:'changed'}},'forger','forged')),/owning intake service/);
  await stageDelivery(f.root,j,await authoredOriginal());const pending=f.p.intake(j.id);f.p.cancel(reference(prep.iteration));const r=await pending;assert.equal(r.payload.state.disposition,'historical');assert.equal(r.payload.state.candidate,null);
 }finally{f.close();}
});

test('A04/A07 explicit count bounds and Follow sources freeze exact references and original hashes independently of Brand',async()=>{
 const f=setup();try{
  const input=fixturePreparation(f.w,f.config,6),prepared=f.p.prepare(input);assert.equal(prepared.jobs.length,6);
  for(const count of [0,7]){const before=snapshot(f.w,f.config.projectId);assert.throws(()=>f.p.prepare({...input,specification:{...input.specification,count}}));assert.equal(snapshot(f.w,f.config.projectId),before);}
  const j=prepared.jobs[0]!;await stageDelivery(f.root,j,await authoredOriginal());const receipt=await f.p.intake(j.id),c=f.w.kernel.get<import('../src/kernel/contracts.ts').DesignArtifact<import('../src/modules/website/exploration-contracts.ts').RasterConcept>>(receipt.payload.state.candidate!);
  const e=new (await import('../src/service/exploration.ts')).Exploration(f.w),entry={id:'source-whole',candidate:reference(c),integrity:c.integrity,image:c.payload.state.image,orientation:'encoded-top-left',coordinates:'normalized-original',anchor:{kind:'whole'},intent:'include',preservation:null,notes:[]};
  const selection=e.selections(f.config.projectId,{version:1,workUnit:f.config.initialWorkUnit,entries:[entry]}),nextInput=fixturePreparation(f.w,f.config,1);
  const refined=f.p.prepare({...nextInput,specification:{...nextInput.specification,operation:'refine',direction:'follow',selections:reference(selection),selectionSnapshot:selection.payload.state,sourceScopes:[{entryId:entry.id,style:'included',content:'included'}]}});
  assert.deepEqual(refined.jobs[0]!.payload.state.sources,[{media:c.payload.state.media,hash:c.payload.state.image.checksum,candidate:reference(c)}]);assert.match(refined.jobs[0]!.payload.state.prompt,/"direction":"follow"/);assert.match(refined.jobs[0]!.payload.state.prompt,/"brand":\{"enabled":false\}/);
  await stageDelivery(f.root,refined.jobs[0]!,await authoredOriginal(2));assert.equal((await f.p.intake(refined.jobs[0]!.id)).payload.state.disposition,'ready');
  assert.equal(new VisualWorkspace(f.w).state(f.config.projectId,f.config.initialWorkUnit).productionIterations.length,2);
 }finally{f.close();}
});
test('A13 scope recheck inside transaction rejects a final-boundary race with no partial registration',async()=>{
 const f=setup();try{
  const j=f.p.prepare(fixturePreparation(f.w,f.config,1)).jobs[0]!;await stageDelivery(f.root,j,await authoredOriginal());
  const original=f.w.kernel.putMany.bind(f.w.kernel);let injected=false;
  f.w.kernel.putMany=(packets,guard)=>{
   if(!injected&&packets.some(p=>(p.payload as {kind?:string}).kind==='production-receipt')){
    injected=true;const p=f.w.project(f.config.projectId);f.w.reviseProject(p.id,{expectedProject:reference(p),brief:{intent:'Explicit race fixture revision'},references:undefined,comparison:undefined,reason:'Failure injection before transaction'});
   }return original(packets,guard);
  };
  await assert.rejects(f.p.intake(j.id),/scope changed/);assert.equal(f.p.jobs()[0]!.payload.state.status,'pending');assert.equal(f.p.receipts().length,0);assert.equal(new VisualWorkspace(f.w).state(f.config.projectId,f.config.initialWorkUnit).candidates.length,0);
  assert.equal(f.w.assets.read(bytesHash(await authoredOriginal())).length>0,true);
 }finally{f.close();}
});
