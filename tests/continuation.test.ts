import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,symlinkSync,renameSync,linkSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {initializeProject} from '../src/service/project-bootstrap.ts';
import {Workspace} from '../src/service/workspace.ts';
import {ProductionIntake} from '../src/service/production-intake.ts';
import {Reviews} from '../src/service/reviews.ts';
import {Continuation} from '../src/service/continuation.ts';
import {exportContinuation,inspectContinuationBundle,type PortableBundle} from '../src/service/continuation-bundle.ts';
import type {CaptureAdapter,CaptureView} from '../src/service/controlled-review-tab.ts';
import {reviewSurface,renderedFeedback,type CaptureEvidence,type Finalization} from '../src/modules/website/continuation-contracts.ts';
import {fixtureInstallation,fixturePreparation,authoredOriginal,stageDelivery} from '../scripts/production-fixture.ts';
import {reference,packet,revise,canonical,digest} from '../src/kernel/packets.ts';
import {Exploration} from '../src/service/exploration.ts';
import {inspectRaster} from '../src/service/assets.ts';
const snap=(w:Workspace,pid:string)=>canonical({packets:w.kernel.latestPackets(),ledger:w.kernel.ledger(pid),acceptances:w.kernel.acceptedSelections(pid)});
async function setup(options:{saves?:number;revisedDependency?:boolean}={}){
 const root=mkdtempSync(join(tmpdir(),'bve-continuation-unit-')),c=initializeProject(root,fixtureInstallation),w=new Workspace(join(root,'runtime')),production=new ProductionIntake(w,root),reviews=new Reviews(w,root),service=new Continuation(w,reviews,production,root);
 let historicalImage:string|null=null,historicalDependency:string|null=null;
 if(options.revisedDependency){
  const other=new Exploration(w).createWorkUnit(c.projectId,{version:1,pageType:'about',label:'Historical context only',source:'Authored predecessor fixture'}),bytes=await authoredOriginal(2),facts=await inspectRaster(bytes);w.assets.save(bytes,facts.image);historicalImage=facts.image.id;historicalDependency=other.id;
  const project=w.project(c.projectId),{integrity:ignored,...v2}=revise(project,project.payload,'local-human','Authored earlier project context');const old=packet({...v2,contextRefs:[reference(other)],assets:[{id:facts.image.id,checksum:facts.image.checksum}]});w.kernel.put(old);
  const {integrity:ignoredAgain,...v3}=revise(old,old.payload,'local-human','Authored current project context');w.kernel.put(packet({...v3,contextRefs:[],assets:[]}));
 }
 const prepared=production.prepare(fixturePreparation(w,c,1));await stageDelivery(root,prepared.jobs[0]!,await authoredOriginal());await production.intake(prepared.jobs[0]!.id);
 const scope=reviews.state(c.projectId,c.initialWorkUnit,prepared.iteration.id).scope!;
 let input:import('../src/modules/website/review-contracts.ts').ReviewInput={draftId:'review-draft-continuation',expected:null,scope,feedback:{selections:{version:1,workUnit:c.initialWorkUnit,entries:[]},comment:'Authored initial draft'},parentSubmission:null};
 for(let i=0;i<(options.saves??0);i++){const saved=reviews.save(c.projectId,{...input,feedback:{...input.feedback,comment:'Authored saved revision '+(i+1)}});input={...input,expected:reference(saved)};}
 const sub=reviews.submit(c.projectId,{review:{...input,feedback:{...input.feedback,comment:'Authored immutable feedback'}},actionKey:'authored-submit'});
 service.bindOrigin('http://127.0.0.1:1234');
 let view:CaptureView={version:1,tabId:'fixture-tab',origin:'http://127.0.0.1:1234',mode:'headless-authored-test',documentId:'fixture-document',visibility:'visible',surface:reviewSurface(sub),feedbackHash:digest(renderedFeedback(sub)),images:[],geometry:[],browser:{engine:'chromium',version:'unit-fixture-not-browser-proof'},visualScale:1,project:c.projectId,targetPage:c.initialWorkUnit.id+':1',layout:'sheet',viewport:{width:960,height:640,deviceScale:1},scroll:{x:0,y:0},zoom:1,focused:null,regionTool:null,activeElement:'BODY',focus:[],comparison:[],displayed:scope.proposals.map(p=>p.candidate.id+':'+p.candidate.version),overlays:'',area:'visible-viewport'};
 // Unit-only adapter fixture; actual screenshots are independently exercised in the browser gate.
 const adapter:CaptureAdapter={tabId:'fixture-tab',secret:'fixture-secret',mode:'headless-authored-test',measure:async()=>structuredClone(view),screenshot:async()=>authoredOriginal(),close:async()=>{}};
 const capture=async(key='authored-capture')=>{service.attach(adapter);const request=await service.requestCapture({submission:reference(sub),key},adapter.secret);return {request,capture:await service.runCapture({request:reference(request)})};};
 return {root,c,w,production,reviews,service,prepared,sub,adapter,capture,historicalImage,historicalDependency,setView(v:CaptureView){view=v;},view:()=>structuredClone(view),async close(){await service.close();w.close();rmSync(root,{recursive:true,force:true});}};
}
test('C04/C05 submission absent adapter; deterministic additive degraded/verified receipts preserve immutable feedback and historical scope',async()=>{
 const f=await setup();try{
  const original=structuredClone(f.sub),before=snap(f.w,f.c.projectId);assert.equal(f.service.pending().length,1);assert.equal(snap(f.w,f.c.projectId),before);assert.equal(f.service.continuation(reference(f.sub),'http://127.0.0.1:1234').complete,false);await assert.rejects(f.service.requestCapture({submission:reference(f.sub),key:'unavailable'}),/unavailable/);
  const degraded=f.service.finalize({submission:reference(f.sub),capture:null,key:'degraded'});assert.equal(degraded.payload.state.status,'degraded');assert.equal(f.sub.payload.state.verification,'pending-not-implemented');
  const {capture}=await f.capture();assert.equal(capture.payload.state.status,'available');const page=f.w.kernel.get(f.c.initialWorkUnit);f.w.kernel.put(revise(page,page.payload,'local-human','Later page revision'));
  const receipt=f.service.finalize({submission:reference(f.sub),capture:reference(capture),key:'verified'});assert.deepEqual(receipt.payload.state.checks,{feedback:true,originals:true,capture:true});assert.equal(receipt.payload.state.status,'verified');assert.deepEqual(f.reviews.read(f.c.projectId,reference(f.sub),'production-review-submission'),original);assert.equal(f.w.kernel.acceptedSelections(f.c.projectId).length,0);assert.equal(f.service.status(reference(f.sub)).complete,true);assert.throws(()=>f.service.finalize({submission:reference(f.sub),capture:reference(capture),key:'forged-flag',verified:true}),/Unknown/);
  const source=f.sub.payload.state.scope.proposals[0]!.image,path=join(f.w.assets.root,source.id),bytes=readFileSync(path);writeFileSync(path,'Authored corruption');assert.equal(f.service.status(reference(f.sub)).complete,false);assert.equal(f.service.read<Finalization>(reference(receipt),'review-finalization').payload.state.status,'verified');assert.throws(()=>exportContinuation(f.service,reference(f.sub),reference(receipt)),/requires/);writeFileSync(path,bytes);
  assert.throws(()=>f.w.kernel.put(revise(receipt,receipt.payload,'local-butler','Forbidden rewrite')),/immutable/);
  const {integrity:ignored,...body}=receipt;const forged=packet({...body,id:'forged-receipt'});assert.throws(()=>f.w.kernel.put(forged));
 }finally{await f.close();}
});
test('C03 wrong tab/view, changed request, corrupted/oversized capture and unsafe file paths cannot publish a false screenshot',async()=>{
 const f=await setup();try{
  f.service.attach(f.adapter);const input={submission:reference(f.sub),key:'bound-request'};await assert.rejects(f.service.requestCapture(input,'wrong-secret'),/controlled tab/);const originalView=f.view();f.setView({...originalView,surface:{...reviewSurface(f.sub),project:'foreign'}});await assert.rejects(f.service.requestCapture(input,f.adapter.secret),/different submission/);f.setView({...originalView,origin:'http://127.0.0.1:9999'});await assert.rejects(f.service.requestCapture(input,f.adapter.secret),/runtime\/service mismatch/);f.setView(originalView);
  const request=await f.service.requestCapture(input,f.adapter.secret);f.setView({...originalView,layout:'film'});f.adapter.screenshot=async expected=>{if(canonical(await f.adapter.measure())!==canonical(expected))throw Error('view changed');return authoredOriginal();};const interrupted=await f.service.runCapture({request:reference(request)});assert.equal(interrupted.payload.state.status,'interrupted');assert.equal(interrupted.payload.state.image,null);f.setView(originalView);
  for(const [key,bytes] of [['corrupt',Buffer.from('not a screenshot')],['oversize',Buffer.alloc(8*1024*1024+1)] ] as const){f.adapter.screenshot=async()=>bytes;const r=await f.service.requestCapture({submission:reference(f.sub),key},f.adapter.secret),result=await f.service.runCapture({request:reference(r)});assert.equal(result.payload.state.status,'interrupted');assert.equal(result.payload.state.image,null);}
  const copy=f.reviews.copy(f.c.projectId,{submission:reference(f.sub),draftId:'review-draft-other-submission'}),other=f.reviews.submit(f.c.projectId,{review:{draftId:copy.id,expected:reference(copy),scope:copy.payload.state.scope,feedback:copy.payload.state.feedback,parentSubmission:reference(f.sub)},actionKey:'other-submission'});
  await assert.rejects(f.service.requestCapture({submission:reference(other),key:'wrong-submission-view'},f.adapter.secret),/different submission/);await assert.rejects(f.service.requestCapture({submission:reference(other),key:'bound-request'},f.adapter.secret),/key conflict/);
  let expiredShots=0;f.adapter.screenshot=async()=>{expiredShots++;return authoredOriginal();};const expiring=await f.service.requestCapture({submission:reference(f.sub),key:'expired-request'},f.adapter.secret),now=Date.now;try{Date.now=()=>now()+16000;const expired=await f.service.runCapture({request:reference(expiring)});assert.equal(expired.payload.state.status,'interrupted');assert.match(expired.payload.state.message,/expired/);assert.equal(expiredShots,0);}finally{Date.now=now;}
  await assert.rejects(f.service.requestCapture({...input,path:'../unsafe'},f.adapter.secret),/Unknown/);assert.equal(f.service.status(reference(f.sub)).complete,false);
 }finally{await f.close();}
});
test('C06 duplicate concurrency, lost response and canonical packet/event faults recover the same identities without partial closure',async()=>{
 const f=await setup();try{
  f.service.attach(f.adapter);const input={submission:reference(f.sub),key:'race'};const requests=await Promise.all([f.service.requestCapture(input,f.adapter.secret),f.service.requestCapture(input,f.adapter.secret)]);assert.equal(requests[0].id,requests[1].id);const captures=await Promise.all([f.service.runCapture({request:reference(requests[0])}),f.service.runCapture({request:reference(requests[1])})]);assert.deepEqual(captures[0],captures[1]);
  const other={...f.sub,id:'review-submission-foreign'};await assert.rejects(f.service.requestCapture({submission:reference(other),key:'race'},f.adapter.secret));
  const request=await f.service.requestCapture({submission:reference(f.sub),key:'fault'},f.adapter.secret),db=new DatabaseSync(join(f.root,'runtime/kernel.sqlite'));
  try{for(const table of ['kernel_packets','kernel_events']){const condition=table==='kernel_packets'?"json_extract(NEW.body,'$.payload.kind')='review-capture'":"json_extract(NEW.body,'$.subject.id') LIKE 'capture-%'",before=snap(f.w,f.c.projectId);db.exec(`CREATE TRIGGER fail_capture BEFORE INSERT ON ${table} WHEN ${condition} BEGIN SELECT RAISE(ABORT,'Injected capture boundary'); END`);try{await assert.rejects(f.service.runCapture({request:reference(request)}),/Injected/);assert.equal(snap(f.w,f.c.projectId),before);}finally{db.exec('DROP TRIGGER fail_capture');}}}finally{db.close();}
  const put=f.w.kernel.putMany.bind(f.w.kernel);f.w.kernel.putMany=(...args)=>{put(...args);throw Error('Committed response lost');};await assert.rejects(f.service.runCapture({request:reference(request)}),/response lost/);f.w.kernel.putMany=put;const recovered=await f.service.runCapture({request:reference(request)});assert.equal(recovered.payload.state.status,'available');
  const receiptInput={submission:reference(f.sub),capture:reference(recovered),key:'receipt-retry'},receipt=f.service.finalize(receiptInput),before=snap(f.w,f.c.projectId);assert.deepEqual(f.service.finalize(receiptInput),receipt);assert.equal(snap(f.w,f.c.projectId),before);assert.throws(()=>f.service.finalize({...receiptInput,capture:null}),/key conflict/);
 }finally{await f.close();}
});
test('C08 fresh-client portable validation is read-only, byte exact, bounded and path/identity/hash safe',async()=>{
 const f=await setup();try{
  const {capture}=await f.capture(),receipt=f.service.finalize({submission:reference(f.sub),capture:reference(capture),key:'portable'}),before=snap(f.w,f.c.projectId),bundle=exportContinuation(f.service,reference(f.sub),reference(receipt)),proof=await inspectContinuationBundle(JSON.parse(JSON.stringify(bundle)));assert.equal(proof.valid,true);assert.equal(proof.imported,false);assert.equal(snap(f.w,f.c.projectId),before);
  const image=f.sub.payload.state.scope.proposals[0]!.image;assert.deepEqual(Buffer.from(bundle.content['media/'+image.id]!,'base64'),await authoredOriginal());
  for(const mutate of [(b:typeof bundle)=>{b.submission.id='wrong';},(b:typeof bundle)=>{delete b.content[b.files[0]!.path];},(b:typeof bundle)=>{b.files[0]!.path='../escape';},(b:typeof bundle)=>{b.files[0]!.sha256='a'.repeat(64);},(b:typeof bundle)=>{b.files[0]!.bytes=64*1024*1024+1;}]){const bad=structuredClone(bundle);mutate(bad);await assert.rejects(inspectContinuationBundle(bad));}
  const expected=f.service.continuation(reference(f.sub),'http://127.0.0.1:1234').locator;assert.equal((await inspectContinuationBundle(bundle,expected)).valid,true);await assert.rejects(inspectContinuationBundle(bundle,{...expected,submission:{...expected.submission,integrity:'b'.repeat(64)}}),/expected locator/);
  const alias=join(f.root,'references/hardlink');linkSync(join(f.w.assets.root,capture.payload.state.image!.id),alias);try{assert.throws(()=>f.service.captureImage(reference(capture)),/unavailable or corrupt/);}finally{rmSync(alias);}
  assert.equal(JSON.stringify(bundle).includes(f.root),false);assert.equal(JSON.stringify(bundle).includes(f.adapter.secret),false);
 }finally{await f.close();}
});
test('C09 explicit child preparation retains parent/current-page/source lineage with three authored outcomes and no invocation',async()=>{
 const f=await setup();try{
  const {capture}=await f.capture(),receipt=f.service.finalize({submission:reference(f.sub),capture:reference(capture),key:'parent-receipt'}),page=f.w.kernel.get(f.c.initialWorkUnit),v2=revise(page,page.payload,'local-human','Explicit current page revision');f.w.kernel.put(v2);
  const input={parent:reference(f.sub),receipt:reference(receipt),key:'child-three',expectedProject:reference(f.w.project(f.c.projectId)),targetPage:reference(v2),intent:'A second authored direction',count:3,direction:'follow',operation:'refine',brand:null,sources:f.sub.payload.state.scope.proposals.map(p=>p.media)};
  const child=f.service.composeChild(input);assert.equal(child.lineage.payload.state.parent.id,f.sub.id);assert.equal(child.iteration.payload.state.workUnit.version,2);assert.equal('jobs' in child&&child.jobs.length,3);assert.deepEqual(f.service.composeChild(input).lineage,child.lineage);assert.throws(()=>f.service.composeChild({...input,intent:'Changed key payload'}),/key conflict/);
  const other=new Exploration(f.w).createWorkUnit(f.c.projectId,{version:1,pageType:'about',label:'Other',source:'Authored isolation'});assert.throws(()=>f.service.composeChild({...input,key:'wrong-page',targetPage:reference(other)}),/page/);assert.throws(()=>f.service.composeChild({...input,key:'wrong-source',sources:[reference(other)]}),/source/);
  assert.ok('jobs' in child);for(let i=0;i<child.jobs.length;i++){await stageDelivery(f.root,child.jobs[i]!,await authoredOriginal(i));const r=await f.production.intake(child.jobs[i]!.id);assert.equal(r.payload.state.disposition,'ready');assert.equal(child.jobs[i]!.payload.state.sources[0]!.hash,f.sub.payload.state.scope.proposals[0]!.image.checksum);}
  assert.equal(f.w.kernel.acceptedSelections(f.c.projectId).length,0);assert.equal(f.sub.payload.state.verification,'pending-not-implemented');
 }finally{await f.close();}
});
test('C06 file staging, finalization/lineage insertion faults and closed-root recovery preserve exact evidence and atomic history',async()=>{
 const f=await setup();try{
  f.service.attach(f.adapter);f.adapter.screenshot=async()=>authoredOriginal(2);const request=await f.service.requestCapture({submission:reference(f.sub),key:'staged-orphan'},f.adapter.secret),db=new DatabaseSync(join(f.root,'runtime/kernel.sqlite')),before=snap(f.w,f.c.projectId);
  db.exec("CREATE TRIGGER fail_cap BEFORE INSERT ON kernel_events WHEN json_extract(NEW.body,'$.subject.id') LIKE 'capture-%' BEGIN SELECT RAISE(ABORT,'Injected orphan boundary'); END");try{await assert.rejects(f.service.runCapture({request:reference(request)}),/orphan boundary/);assert.equal(snap(f.w,f.c.projectId),before);}finally{db.exec('DROP TRIGGER fail_cap');}
  const capture=await f.service.runCapture({request:reference(request)}),image=capture.payload.state.image!;assert.deepEqual(readFileSync(join(f.w.assets.root,image.id)),await authoredOriginal(2));
  const finalize={submission:reference(f.sub),capture:reference(capture),key:'receipt-boundaries'};
  for(const table of ['kernel_packets','kernel_events']){const condition=table==='kernel_packets'?"json_extract(NEW.body,'$.payload.kind')='review-finalization'":"json_extract(NEW.body,'$.subject.id') LIKE 'finalization-%'",snapshot=snap(f.w,f.c.projectId);db.exec(`CREATE TRIGGER fail_receipt BEFORE INSERT ON ${table} WHEN ${condition} BEGIN SELECT RAISE(ABORT,'Injected receipt boundary'); END`);try{assert.throws(()=>f.service.finalize(finalize),/receipt boundary/);assert.equal(snap(f.w,f.c.projectId),snapshot);}finally{db.exec('DROP TRIGGER fail_receipt');}}
  const receipt=f.service.finalize(finalize),child={parent:reference(f.sub),receipt:reference(receipt),key:'atomic-child',expectedProject:reference(f.w.project(f.c.projectId)),targetPage:f.c.initialWorkUnit,intent:'Authored atomic child',count:3,direction:'fresh',operation:'create',brand:null,sources:[]},snapshot=snap(f.w,f.c.projectId);
  db.exec("CREATE TRIGGER fail_lineage BEFORE INSERT ON kernel_packets WHEN json_extract(NEW.body,'$.payload.kind')='review-child-lineage' BEGIN SELECT RAISE(ABORT,'Injected child boundary'); END");try{assert.throws(()=>f.service.composeChild(child),/child boundary/);assert.equal(snap(f.w,f.c.projectId),snapshot);}finally{db.exec('DROP TRIGGER fail_lineage');db.close();}
  assert.ok(f.service.composeChild(child).lineage);const save=f.w.assets.save.bind(f.w.assets);f.w.assets.save=()=>{throw Error('Injected file write failure');};const fileRequest=await f.service.requestCapture({submission:reference(f.sub),key:'file-failed'},f.adapter.secret);assert.equal((await f.service.runCapture({request:reference(fileRequest)})).payload.state.status,'interrupted');f.w.assets.save=save;
  const pending=await f.service.requestCapture({submission:reference(f.sub),key:'pending-restart'},f.adapter.secret);assert.ok(f.service.pending().some(s=>s.pendingCaptures.some(r=>r.id===pending.id)));
  const closed=snap(f.w,f.c.projectId);await f.service.close();f.w.close();const w=new Workspace(join(f.root,'runtime'));try{const production=new ProductionIntake(w,f.root),reviews=new Reviews(w,f.root),service=new Continuation(w,reviews,production,f.root);service.bindOrigin('http://127.0.0.1:2345');assert.equal(snap(w,f.c.projectId),closed);assert.ok(service.pending().some(s=>s.pendingCaptures.some(r=>r.id===pending.id)));const interrupted=await service.runCapture({request:reference(pending)});assert.equal(interrupted.payload.state.status,'interrupted');assert.equal(interrupted.payload.state.image,null);await service.close();}finally{w.close();}
 }finally{await f.close();}
});


function portableFile(b:PortableBundle,path:string,bytes:Buffer){
 b.files=b.files.filter(f=>f.path!==path);b.files.push({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});b.content[path]=bytes.toString('base64');
}
function portablePacket(b:PortableBundle,p:import('../src/kernel/contracts.ts').NodePacket<unknown>){portableFile(b,'records/'+p.id+'_'+p.version+'.json',Buffer.from(JSON.stringify(p)));}
function omitPortable(b:PortableBundle,path:string){b.files=b.files.filter(f=>f.path!==path);delete b.content[path];}
test('F1/C08 portable evidence retains direct-submit and one/multiple saved draft predecessors and revised dependency context/media',async()=>{
 for(const saves of [0,1,3]){
  const f=await setup({saves,revisedDependency:true});try{
   const unrelated=new Exploration(f.w).createWorkUnit(f.c.projectId,{version:1,pageType:'about',label:'Unrelated',source:'Authored isolation'});
   const {capture}=await f.capture(),receipt=f.service.finalize({submission:reference(f.sub),capture:reference(capture),key:'saved-portable'}),before=snap(f.w,f.c.projectId),bundle=exportContinuation(f.service,reference(f.sub),reference(receipt)),locator=f.service.continuation(reference(f.sub),'http://127.0.0.1:1234').locator;
   assert.equal(f.sub.payload.state.finalDraft.version,saves+1);
   for(let v=1;v<=saves+1;v++)assert.ok(bundle.content['records/'+f.sub.payload.state.finalDraft.id+'_'+v+'.json']);
   for(const v of [1,2,3])assert.ok(bundle.content['records/'+f.c.projectId+'_'+v+'.json']);
   assert.ok(bundle.content['records/'+f.historicalDependency+'_1.json']);assert.deepEqual(Buffer.from(bundle.content['media/'+f.historicalImage]!,'base64'),await authoredOriginal(2));
   assert.equal((await inspectContinuationBundle(bundle,locator)).valid,true);assert.equal(snap(f.w,f.c.projectId),before);
   const draftPath='records/'+(saves?f.sub.payload.state.finalDraft.id:f.c.projectId)+'_1.json';
   for(const path of [...Array.from({length:saves},(_,i)=>'records/'+f.sub.payload.state.finalDraft.id+'_'+(i+1)+'.json'),'records/'+f.c.projectId+'_2.json','records/'+f.historicalDependency+'_1.json','media/'+f.historicalImage]){const missing=structuredClone(bundle);omitPortable(missing,path);await assert.rejects(inspectContinuationBundle(missing,locator));}
   const tampered=structuredClone(bundle),old=JSON.parse(Buffer.from(tampered.content[draftPath]!,'base64').toString());old.provenance.source='Tampered predecessor';portablePacket(tampered,old);await assert.rejects(inspectContinuationBundle(tampered,locator),/integrity/);
   const wrongOwner=structuredClone(bundle),{integrity:ignored,...body}=JSON.parse(Buffer.from(wrongOwner.content[draftPath]!,'base64').toString());portablePacket(wrongOwner,packet({...body,projectId:'foreign-project'}));await assert.rejects(inspectContinuationBundle(wrongOwner,locator),/owner|lineage|scope|project/);
   const badLineage=structuredClone(bundle);portablePacket(badLineage,packet({...body,provenance:{...body.provenance,previous:reference(f.sub)}}));await assert.rejects(inspectContinuationBundle(badLineage,locator),/invalid initial version/);
   const extra=structuredClone(bundle);portablePacket(extra,unrelated);await assert.rejects(inspectContinuationBundle(extra,locator),/unrelated/);
   const extraFiles=structuredClone(bundle);extraFiles.files=Array.from({length:1025},()=>extraFiles.files[0]!);await assert.rejects(inspectContinuationBundle(extraFiles,locator));
   // Cold receiving process: no root/owner/browser, and no checkout working directory.
   const client=mkdtempSync(join(tmpdir(),'bve-portable-cold-'));try{
    const path=join(client,'evidence.json'),expected=join(client,'locator.json');writeFileSync(path,JSON.stringify(bundle));writeFileSync(expected,JSON.stringify(locator));await f.service.close();f.w.close();const db=readFileSync(join(f.root,'runtime/kernel.sqlite'));
    const cli=fileURLToPath(new URL('../scripts/bve.ts',import.meta.url)),result=JSON.parse((await promisify(execFile)(process.execPath,[cli,'inspect-bundle',path,expected],{cwd:client,timeout:30000})).stdout);assert.equal(result.valid,true);assert.equal(result.imported,false);assert.deepEqual(result.submission,reference(f.sub));assert.deepEqual(readFileSync(join(f.root,'runtime/kernel.sqlite')),db);assert.deepEqual(readdirSync(client).sort(),['evidence.json','locator.json']);
   }finally{rmSync(client,{recursive:true,force:true});}
  }finally{await f.close();}
 }
});

test('F1/C08 predecessor histories count against the same 512-record export and inspection bound',async()=>{
 const f=await setup({saves:512});try{
  const {capture}=await f.capture(),receipt=f.service.finalize({submission:reference(f.sub),capture:reference(capture),key:'bounded-history'});assert.throws(()=>exportContinuation(f.service,reference(f.sub),reference(receipt)),/512 records/);
  // Supply the actual stored history as untrusted oversized input; bounds must refuse it.
  const oversized:PortableBundle={format:'bve-continuation-bundle',version:1,submission:reference(f.sub),receipt:reference(receipt),files:[],content:{}};
  for(const e of f.w.kernel.ledger(f.c.projectId).events)portablePacket(oversized,f.w.kernel.get(e.subject));
  await assert.rejects(inspectContinuationBundle(oversized),/512 records/);
 }finally{await f.close();}
});
