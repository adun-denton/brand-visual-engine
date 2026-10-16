import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {initializeProject} from '../src/service/project-bootstrap.ts';
import {Workspace} from '../src/service/workspace.ts';
import {ProductionIntake} from '../src/service/production-intake.ts';
import {Reviews} from '../src/service/reviews.ts';
import {reference,packet,revise,digest} from '../src/kernel/packets.ts';
import type {ReviewInput,ReviewSubmission} from '../src/modules/website/review-contracts.ts';
import {fixtureInstallation,fixturePreparation,authoredOriginal,stageDelivery} from '../scripts/production-fixture.ts';
const snapshot=(w:Workspace,pid:string)=>JSON.stringify({packets:w.kernel.latestPackets(),ledger:w.kernel.ledger(pid),accepted:w.kernel.acceptedSelections(pid)});
async function setup(count=3,delivered=count){const root=mkdtempSync(join(tmpdir(),'bve-review-')),c=initializeProject(root,fixtureInstallation),w=new Workspace(join(root,'runtime')),p=new ProductionIntake(w,root),reviews=new Reviews(w,root),prepared=p.prepare(fixturePreparation(w,c,count));
 for(let i=0;i<delivered;i++){await stageDelivery(root,prepared.jobs[i]!,await authoredOriginal(i));await p.intake(prepared.jobs[i]!.id);}
 const input=():ReviewInput=>{const scope=reviews.state(c.projectId,c.initialWorkUnit,prepared.iteration.id).scope!;return {draftId:'review-draft-authored',expected:null,scope,feedback:{selections:{version:1 as const,workUnit:c.initialWorkUnit,entries:scope.proposals.slice(0,2).map((p,i)=>({id:'entry-'+i,candidate:p.candidate,integrity:p.integrity,image:p.image,orientation:'encoded-top-left' as const,coordinates:'normalized-original' as const,anchor:i?{kind:'rectangle' as const,x:.1,y:.2,width:.3,height:.4}:{kind:'whole' as const},intent:'inspiration' as const,preservation:null,notes:[{id:'note-'+i,text:'Source feedback '+i,source:'User annotation'}]}))},comment:'Overall authored feedback'},parentSubmission:null} satisfies ReviewInput;};
 return {root,c,w,p,reviews,prepared,input,close(){w.close();rmSync(root,{recursive:true,force:true});}};
}
test('R01-R04/R10 saved draft + unsaved final edits submit atomically without agents; immutable cold recovery and edit as new draft',async()=>{
 const f=await setup();try{
  let r=f.input();const saved=f.reviews.save(f.c.projectId,r);r={...r,expected:reference(saved),feedback:{...r.feedback,comment:' Includes pending final edits \n',selections:{...r.feedback.selections,entries:r.feedback.selections.entries.map((e,i)=>({...e,notes:[{...e.notes[0]!,text:' Pending note '+i+' \n'}]}))}}};
  const sub=f.reviews.submit(f.c.projectId,{review:r,actionKey:'action-one'});assert.deepEqual(sub.payload.state.feedback,r.feedback);assert.equal(sub.payload.state.finalDraft.version,2);assert.equal(sub.payload.state.verification,'pending-not-implemented');assert.equal(f.w.kernel.acceptedSelections(f.c.projectId).length,0);
  const final=f.w.kernel.get(sub.payload.state.finalDraft);assert.equal(sub.payload.state.draftIntegrity,final.integrity);
  const copied=f.reviews.copy(f.c.projectId,{submission:reference(sub),draftId:'review-draft-next'});assert.deepEqual(copied.payload.state.parentSubmission,reference(sub));
  const next=f.reviews.submit(f.c.projectId,{review:{...r,draftId:copied.id,expected:reference(copied),parentSubmission:reference(sub),feedback:{...r.feedback,comment:'A deliberate second review'}},actionKey:'action-two'});
  assert.notEqual(next.id,sub.id);assert.deepEqual(f.reviews.read(f.c.projectId,reference(sub),'production-review-submission'),sub);
  const memory=new (await import('../src/service/project-memory.ts')).ProjectMemory(f.w).index(f.c.projectId,f.c.initialWorkUnit);assert.ok(memory.entries.some(e=>e.kind==='production-review-submission'&&e.summary!==null));
  const before=snapshot(f.w,f.c.projectId);f.w.close();const w=new Workspace(join(f.root,'runtime'));try{const reviews=new Reviews(w,f.root),state=reviews.state(f.c.projectId,f.c.initialWorkUnit,f.prepared.iteration.id);assert.equal(state.submissions.length,2);assert.equal(snapshot(w,f.c.projectId),before);assert.deepEqual(reviews.read(f.c.projectId,reference(sub),'production-review-submission'),sub);assert.deepEqual(reviews.original(f.c.projectId,reference(sub),0).bytes,await authoredOriginal(0));}finally{w.close();}
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
test('R05/R06 duplicate, lost-response readback, changed-key payload and two-client revision guards',async()=>{
 const f=await setup();try{
  const r=f.input(),saved=f.reviews.save(f.c.projectId,r);assert.deepEqual(f.reviews.save(f.c.projectId,r),saved);
  const winner={...r,expected:reference(saved),feedback:{...r.feedback,comment:'Winning tab'}};const rev=f.reviews.save(f.c.projectId,winner),before=snapshot(f.w,f.c.projectId);
  assert.throws(()=>f.reviews.save(f.c.projectId,{...winner,feedback:{...r.feedback,comment:'Losing tab'}}),/revision conflict/);assert.equal(snapshot(f.w,f.c.projectId),before);
  const input={review:{...winner,expected:reference(rev)},actionKey:'stable-action'};
  const original=f.w.kernel.putMany.bind(f.w.kernel);let lost=true;f.w.kernel.putMany=(...args)=>{original(...args);if(lost){lost=false;throw Error('Response lost after commit');}};
  assert.throws(()=>f.reviews.submit(f.c.projectId,input),/Response lost/);f.w.kernel.putMany=original;
  const recovered=f.reviews.submit(f.c.projectId,input),after=snapshot(f.w,f.c.projectId);assert.deepEqual(f.reviews.submit(f.c.projectId,input),recovered);assert.equal(snapshot(f.w,f.c.projectId),after);
  assert.throws(()=>f.reviews.submit(f.c.projectId,{...input,review:{...input.review,feedback:{...r.feedback,comment:'Changed retry'}}}),/Action key conflict/);
  assert.throws(()=>f.reviews.submit(f.c.projectId,{...input,review:{...input.review,feedback:{...input.review.feedback,comment:input.review.feedback.comment+' '}}}),/Action key conflict/);
  assert.throws(()=>f.reviews.submit(f.c.projectId,{...input,actionKey:'another-action'}),/revision conflict|already submitted/);assert.equal(snapshot(f.w,f.c.projectId),after);
  assert.equal(f.reviews.state(f.c.projectId,f.c.initialWorkUnit,f.prepared.iteration.id).submissions.length,1);
 }finally{f.close();}
});
test('R07 invalid closure/geometry/bounds and direct kernel forgery reject without writes',async()=>{
 const f=await setup();try{
  const r=f.input(),before=snapshot(f.w,f.c.projectId);
  for(const change of [()=>({...r,scope:{...r.scope,project:{...r.scope.project,id:'other'}}}),()=>({...r,feedback:{...r.feedback,comment:'x'.repeat(4001)}}),()=>({...r,feedback:{...r.feedback,selections:{...r.feedback.selections,entries:[{...r.feedback.selections.entries[0]!,candidate:{...r.scope.proposals[0]!.candidate,id:'other'}}]}}}),()=>({...r,feedback:{...r.feedback,selections:{...r.feedback.selections,entries:[{...r.feedback.selections.entries[0]!,anchor:{kind:'ellipse',x:.9,y:0,width:.5,height:.2}}]}}}),()=>({...r,feedback:{...r.feedback,selections:{...r.feedback.selections,entries:[{...r.feedback.selections.entries[0]!,image:{...r.scope.proposals[0]!.image,width:1}}]}}})])assert.throws(()=>f.reviews.save(f.c.projectId,change()));
  assert.equal(snapshot(f.w,f.c.projectId),before);
  const forged=packet({type:'work-record',id:'review-draft-forged',projectId:f.c.projectId,payload:{moduleId:'website',kind:'production-review-draft',scope:'production-review',lockedValues:{},state:{version:1,scope:r.scope,feedback:r.feedback,parentSubmission:null}},provenance:{actor:'local-human',source:'Forged direct write',previous:null}});assert.throws(()=>f.w.kernel.put(forged),/owning review service/);assert.equal(snapshot(f.w,f.c.projectId),before);
  const sub=f.reviews.submit(f.c.projectId,{review:r,actionKey:'real'});assert.throws(()=>f.w.kernel.put(revise(sub,{...sub.payload,state:{...sub.payload.state,verification:'complete'}},'local-human','Forge verification')));assert.throws(()=>f.w.kernel.put(revise(f.w.kernel.get(sub.payload.state.finalDraft),finalPayload(f.w.kernel.get(sub.payload.state.finalDraft)),'local-human','Rewrite submitted content')));
 }finally{f.close();}
});
function finalPayload(p:import('../src/kernel/contracts.ts').NodePacket<unknown>){return p.payload;}
test('R08/R11 late delivery and cancellation conflict; historical drafts remain readable, comment-only partial reviews truthful',async()=>{
 const f=await setup(3,1);try{
  const r=f.input();r.feedback.selections.entries=[];r.feedback.comment='None works yet';const saved=f.reviews.save(f.c.projectId,r);assert.equal(r.scope.jobs.filter(j=>j.status==='pending').length,2);assert.equal(f.reviews.state(f.c.projectId,f.c.initialWorkUnit,f.prepared.iteration.id).partial,true);
  await f.p.intake(f.prepared.jobs[2]!.id);assert.throws(()=>f.reviews.submit(f.c.projectId,{review:{...r,expected:reference(saved)},actionKey:'diagnostic-arrival'}),/closure mismatch/);
  await stageDelivery(f.root,f.prepared.jobs[1]!,await authoredOriginal(1));await f.p.intake(f.prepared.jobs[1]!.id);
  const before=snapshot(f.w,f.c.projectId);assert.throws(()=>f.reviews.submit(f.c.projectId,{review:{...r,expected:reference(saved)},actionKey:'late'}),/scope changed/);assert.equal(snapshot(f.w,f.c.projectId),before);assert.equal(f.reviews.state(f.c.projectId,f.c.initialWorkUnit,f.prepared.iteration.id).drafts[0]!.stale,true);
  const fresh=f.input();fresh.draftId='review-draft-fresh';fresh.feedback.selections.entries=[];fresh.feedback.comment='Comment only';const sub=f.reviews.submit(f.c.projectId,{review:fresh,actionKey:'comment-only'});assert.equal(sub.payload.state.feedback.selections.entries.length,0);
  f.p.cancel(reference(f.prepared.iteration));assert.deepEqual(f.reviews.read(f.c.projectId,reference(sub),'production-review-submission'),sub);
  assert.throws(()=>f.reviews.save(f.c.projectId,{...fresh,draftId:'review-draft-empty',feedback:{...fresh.feedback,comment:''}}),/substantive/);
 }finally{f.close();}
 const zero=await setup(1,0);try{assert.equal(zero.reviews.state(zero.c.projectId,zero.c.initialWorkUnit,zero.prepared.iteration.id).scope,null);assert.throws(()=>zero.reviews.save(zero.c.projectId,zero.input()));}finally{zero.close();}
});
test('R09/R14 failure at each canonical insert rolls back closure; transaction race and strict instruction guard preserve history',async()=>{
 const f=await setup();try{
  const r=f.input(),before=snapshot(f.w,f.c.projectId),put=f.w.kernel.putMany.bind(f.w.kernel),db=new DatabaseSync(join(f.root,'runtime/kernel.sqlite'));
  try{
   for(const [table,condition] of [['kernel_packets',"json_extract(NEW.body,'$.payload.kind')='production-review-draft'"],['kernel_packets',"json_extract(NEW.body,'$.payload.kind')='production-review-submission'"],['kernel_events',"json_extract(NEW.body,'$.subject.id') LIKE 'review-draft-%'"],['kernel_events',"json_extract(NEW.body,'$.subject.id') LIKE 'review-submission-%'"]]){
    db.exec(`CREATE TRIGGER fail_review BEFORE INSERT ON ${table} WHEN ${condition} BEGIN SELECT RAISE(ABORT,'Injected canonical write failure'); END`);
    try{assert.throws(()=>f.reviews.submit(f.c.projectId,{review:r,actionKey:'failed'}),/Injected/);assert.equal(snapshot(f.w,f.c.projectId),before);}finally{db.exec('DROP TRIGGER fail_review');}
   }
  }finally{db.close();}
  f.w.kernel.putMany=(packets,guard)=>{f.w.kernel.putMany=put;f.p.cancel(reference(f.prepared.iteration));return put(packets,guard);};assert.throws(()=>f.reviews.submit(f.c.projectId,{review:r,actionKey:'racing'}),/scope changed/);f.w.kernel.putMany=put;
  assert.equal(f.w.kernel.latestPackets().filter(p=>(p.payload as {kind?:string}).kind==='production-review-submission').length,0);
  const role=join(f.root,'instructions/butler.md');writeFileSync(role,'Changed pinned instruction');assert.throws(()=>f.reviews.submit(f.c.projectId,{review:r,actionKey:'bad-pin'}),/Pinned instructions/);
 }finally{f.close();}
});
test('R10 exact originals fail explicitly when corrupt; submitted snapshots survive later source revisions',async()=>{
 const f=await setup();try{
  const sub=f.reviews.submit(f.c.projectId,{review:f.input(),actionKey:'snapshot'}),source=sub.payload.state.scope.proposals[0]!,candidate=f.w.kernel.get<import('../src/kernel/contracts.ts').DesignArtifact<import('../src/modules/website/exploration-contracts.ts').RasterConcept>>(source.candidate);
  f.w.kernel.put(revise(candidate,candidate.payload,'local-human','Later independent source revision'));
  assert.deepEqual(f.reviews.read(f.c.projectId,reference(sub),'production-review-submission'),sub);
  const path=join(f.w.assets.root,source.image.id),bytes=readFileSync(path);writeFileSync(path,'corrupt');assert.throws(()=>f.reviews.original(f.c.projectId,reference(sub),0),/unavailable or corrupt/);const state=f.reviews.state(f.c.projectId,f.c.initialWorkUnit,f.prepared.iteration.id);assert.equal(state.submissions[0]!.originals[0]!.available,false);writeFileSync(path,bytes);assert.deepEqual(f.reviews.original(f.c.projectId,reference(sub),0).bytes,bytes);
 }finally{f.close();}
});
test('R02/R07 supported ellipse and mask geometry retain exact sources; forged complete scope is independently rejected',async()=>{
 const f=await setup();try{
  const r=f.input(),e=r.feedback.selections.entries[0]!,pixels=Array(e.image.width*e.image.height).fill(0) as number[];pixels[0]=1;const maskHash=(await import('../src/kernel/raster.ts')).checksum(Uint8Array.from(pixels));
  r.feedback.selections.entries.push({...e,id:'ellipse',anchor:{kind:'ellipse',x:.2,y:.3,width:.4,height:.5}}, {...e,id:'mask',anchor:{kind:'mask',width:e.image.width,height:e.image.height,pixels,hash:maskHash}});
  const saved=f.reviews.save(f.c.projectId,r);assert.deepEqual(saved.payload.state.feedback.selections.entries,r.feedback.selections.entries);
  const before=snapshot(f.w,f.c.projectId),{fingerprint,...scope}=r.scope,forged={...scope,proposals:scope.proposals.map(p=>({...p,media:{...p.media,id:'foreign-media'}}))};
  assert.throws(()=>f.reviews.save(f.c.projectId,{...r,draftId:'review-draft-forged-scope',scope:{...forged,fingerprint:digest(forged)}}),/closure mismatch|scope changed/);assert.equal(snapshot(f.w,f.c.projectId),before);
 }finally{f.close();}
});
test('R05/R14 concurrent HTTP retries resolve one identity; token defense and installation refusal remain intact',async()=>{
 const {startApp}=await import('../src/service/server.ts');const f=await setup(),r=f.input();f.w.close();let app:Awaited<ReturnType<typeof startApp>>|undefined;
 try{
  app=await startApp(join(f.root,'runtime'),0,undefined,undefined,{projectRoot:f.root});const origin=app.origin,token=(await fetch(origin+'/api/v1/visual/session').then(r=>r.json()) as {token:string}).token;
  const body=JSON.stringify({projectId:f.c.projectId,input:{review:r,actionKey:'concurrent-http-action'}}),request=()=>fetch(origin+'/api/v1/visual/review/submit',{method:'POST',headers:{origin,'content-type':'application/json','x-bve-token':token},body});
  const denied=await fetch(origin+'/api/v1/visual/review/submit',{method:'POST',headers:{origin,'content-type':'application/json'},body});assert.equal(denied.status,403);
  const responses=await Promise.all([request(),request()]);assert.deepEqual(responses.map(r=>r.status),[200,200]);const values=await Promise.all(responses.map(r=>r.json()));assert.equal(values[0].id,values[1].id);assert.equal(app.reviews!.state(f.c.projectId,f.c.initialWorkUnit,f.prepared.iteration.id).submissions.length,1);
  const before=snapshot(app.workspace,f.c.projectId),path=join(f.root,'bve.project.json'),old=readFileSync(path);writeFileSync(path,JSON.stringify({...f.c,installation:{...f.c.installation,commit:'8312893f1ef715a1507c3275d991b42c0dbafa1c'}}));
  assert.throws(()=>app!.reviews!.save(f.c.projectId,{...r,draftId:'review-draft-mismatch'}),/Installation mismatch/);assert.equal(snapshot(app.workspace,f.c.projectId),before);writeFileSync(path,old);
 }finally{await app?.close();rmSync(f.root,{recursive:true,force:true});}
});
test('R08 project/page revision, cancellation and supersession preserve historical drafts and reject stale submit/save',async()=>{
 for(const mode of ['project','page','cancel','supersede']){
  const f=await setup(1);try{
   const r=f.input(),saved=f.reviews.save(f.c.projectId,r);
   if(mode==='project'){const p=f.w.project(f.c.projectId);f.w.kernel.put(revise(p,p.payload,'local-human','Authored concurrent project revision'));}
   else if(mode==='page'){const p=f.w.kernel.get(f.c.initialWorkUnit);f.w.kernel.put(revise(p,p.payload,'local-human','Authored concurrent page revision'));}
   else if(mode==='cancel')f.p.cancel(reference(f.prepared.iteration));
   else f.p.prepare(fixturePreparation(f.w,f.c,1));
   const before=snapshot(f.w,f.c.projectId),review={...r,expected:reference(saved),feedback:{...r.feedback,comment:'Pending final feedback'}};
   assert.throws(()=>f.reviews.submit(f.c.projectId,{review,actionKey:'stale-'+mode}),/scope changed/);assert.throws(()=>f.reviews.save(f.c.projectId,review),/scope changed/);assert.equal(snapshot(f.w,f.c.projectId),before);assert.equal(f.reviews.state(f.c.projectId,f.c.initialWorkUnit,f.prepared.iteration.id).drafts[0]!.stale,true);
  }finally{f.close();}
 }
});
