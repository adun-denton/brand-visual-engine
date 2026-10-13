import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readdirSync,mkdirSync,writeFileSync,readFileSync,symlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {startApp} from '../src/service/server.ts';
import {offlineVisualProviders} from '../scripts/visual-fixture.ts';
import {nativeOriginal,fixtureTar} from '../scripts/native-exchange-fixture.ts';
import {reference} from '../src/kernel/packets.ts';
import {NativeExchangeAdapter} from '../src/service/native-exchange-adapter.ts';
import {nativeReturnKit} from '../src/service/native-return-kit.ts';
import {tar} from '../src/service/handoff.ts';
// Consumer construction below has no nativeReturn, result parser/types or server-source knowledge.
function evidence(name:string,value:unknown){const dir=process.env['BVE_NATIVE_REPAIR_EVIDENCE_DIR'];if(dir){mkdirSync(dir,{recursive:true});writeFileSync(join(dir,name+'.json'),JSON.stringify(value,null,2)+'\n');}}
const hash=(s:unknown)=>createHash('sha256').update(JSON.stringify(s)).digest('hex');
async function setup(t:test.TestContext,count=2){
  const root=mkdtempSync(join(tmpdir(),'bve-native-repair-'));let app=await startApp(root,0,undefined,offlineVisualProviders);
  t.after(async()=>{await app.close();rmSync(root,{recursive:true,force:true});});
  const v=app.visual,p=v.create({title:'Authored repair controls'}),pid=p.project.id,u=v.exploration.createWorkUnit(pid,{version:1,pageType:'homepage',label:'Homepage',source:'Synthetic repair fixture'});
  const prepared=await v.command(pid,'prepare',{expectedProject:p.project,unit:reference(u),selections:null,intent:'Synthetic repair',count,direction:'fresh',brand:null,operation:'create',requests:[],level1:[]}) as any;
  const e=v.native,q=await e.compile(pid,reference(prepared.specification),64,48),terms={request:reference(q),slots:Array.from({length:count},(_,i)=>i+1),maxSubmissions:count,maxStatusCalls:0,maxCancelCalls:0,timeoutMs:30000,expiresAt:new Date(Date.now()+3600000).toISOString(),evidence:'synthetic-fixture',reason:'Authored repair authority'},g=e.grant(pid,terms),run=e.prepare(pid,reference(g));
  return {root,app,v,p,pid,u,e,q,terms,run,prepared,reopen:async()=>{await app.close();app=await startApp(root,0,undefined,offlineVisualProviders);return app;}};
}
function snapshot(root:string){const db=new DatabaseSync(join(root,'kernel.sqlite'));try{return {rows:JSON.stringify(['kernel_packets','kernel_events','kernel_selections'].map(n=>db.prepare('SELECT * FROM '+n+' ORDER BY 1,2').all())),files:readdirSync(join(root,'native-assets')).sort()};}finally{db.close();}}
function consumer(kitBytes:Buffer,original:Buffer|null,receiptId:string,outcome='returned',edit?:(config:any)=>void){
  const dir=mkdtempSync(join(tmpdir(),'bve-independent-consumer-'));
  try {
    const kit=fixtureTar(kitBytes);
    // Only generated kit paths are extracted by this test. Production never extracts returns.
    for(const [name,bytes] of kit){assert.match(name,/^(manifest\.json|kit\.json|RETURN\.md|build-return\.mjs|result-schema-v1\.json|(?:returned|failed)-template-v1\.json|assets\/[a-f0-9]{64}\.(png|jpg|webp))$/);mkdirSync(join(dir,name.startsWith('assets/')?'assets':''),{recursive:true});writeFileSync(join(dir,name),bytes);}
    symlinkSync(resolve('node_modules'),join(dir,'node_modules'),process.platform==='win32'?'junction':'dir');
    const template=JSON.parse(kit.get(outcome+'-template-v1.json')!.toString());
    template.receiptId=receiptId;template.rights='Authored synthetic image rights';template.attestation.statement='Authored fixture, no native invocation';template.message='Synthetic consumer output';
    edit?.(template);writeFileSync(join(dir,'filled.json'),JSON.stringify(template));if(original)writeFileSync(join(dir,'original.png'),original);
    execFileSync(process.execPath,[join(dir,'build-return.mjs'),join(dir,'filled.json'),join(dir,'return'),...(original?[join(dir,'original.png')]:[])],{cwd:dir,stdio:'pipe'});
    const manifest=readFileSync(join(dir,'return/result.json')),result=JSON.parse(manifest.toString()),files=new Map<string,Buffer>();
    if(result.output)files.set(result.output.path,readFileSync(join(dir,'return',result.output.path)));
    return {manifest,result,files,kit};
  } finally {rmSync(dir,{recursive:true,force:true});}
}
test('R1 two-slot wrong form, missing/out-of-range scope and foreign authority reject before files or ledger; current/history/replay controls',async t=>{
  const s=await setup(t),first=await s.e.exportRequest(s.pid,reference(s.run),1),p1=JSON.parse(first.manifest.toString());s.e.control(s.pid,reference(s.run),1,'cancel');
  const second=await s.e.exportRequest(s.pid,reference(s.run),2),p2=JSON.parse(second.manifest.toString());s.e.claim(s.pid,reference(s.run),2,p2.packetDigest);
  const r=consumer((await s.e.exportReturnKit(s.pid,reference(s.run),2)).bytes,await nativeOriginal(), 'slot-two'),before=snapshot(s.root);
  const other=s.e.prepare(s.pid,reference(s.e.grant(s.pid,s.terms))),foreign=s.v.create({title:'Foreign project'});const stable=snapshot(s.root);
  const rejected=[];let wrongFormAfter:ReturnType<typeof snapshot>|undefined;
  for(const [pid,run,slot] of [[s.pid,reference(s.run),1],[s.pid,reference(s.run),3],[s.pid,reference(s.run),0],[s.pid,reference(s.run),7],[s.pid,reference(s.run),undefined],[s.pid,reference(other),2],[foreign.project.id,reference(s.run),2]] as const){
    await assert.rejects(s.e.importResult(pid,run,r.manifest,r.files,false,slot as number));const actual=snapshot(s.root);assert.deepEqual(actual,stable);if(slot===1)wrongFormAfter=actual;rejected.push({project:pid===s.pid?'owned':'foreign',run:run.id===s.run.id?'selected':'foreign',slot:slot??'missing',noMutation:true});
  }
  const session=await(await fetch(s.app.origin+'/api/v1/visual/session')).json();
  const body={run:reference(s.run),manifest:r.manifest.toString(),files:[...r.files].map(([path,bytes])=>({path,base64:bytes.toString('base64')})),historical:false};
  for(const fields of [{}, {slot:1}, {slot:7}]){const response=await fetch(s.app.origin+'/api/v1/visual/native/import',{method:'POST',headers:{Origin:s.app.origin,'Content-Type':'application/json','X-BVE-Token':session.token},body:JSON.stringify({projectId:s.pid,input:{...body,...fields}})});assert.ok(response.status>=400);assert.deepEqual(snapshot(s.root),stable);}
  assert.equal(before.files.length,0);assert.deepEqual(stable.files,[]);
  const receipt=await s.e.importResult(s.pid,reference(s.run),r.manifest,r.files,false,2);assert.equal(receipt.payload.state.outcome,'returned');const replayBefore=snapshot(s.root);
  await assert.rejects(s.e.importResult(s.pid,reference(s.run),r.manifest,r.files,false,1),/selected run\/slot/);assert.deepEqual(snapshot(s.root),replayBefore);
  assert.deepEqual(await s.e.importResult(s.pid,reference(s.run),r.manifest,r.files,false,2),receipt);assert.deepEqual(snapshot(s.root),replayBefore);
  await assert.rejects(s.e.importResult(s.pid,reference(s.run),Buffer.from(JSON.stringify({...r.result,message:'conflicting duplicate'})),r.files,false,2),/Conflicting/);assert.deepEqual(snapshot(s.root),replayBefore);
  const historical=consumer((await s.e.exportReturnKit(s.pid,reference(s.run),1)).bytes,await nativeOriginal(64,48,1),'slot-one');
  const lateBefore=snapshot(s.root);await assert.rejects(s.e.importResult(s.pid,reference(s.run),historical.manifest,historical.files,false,1),/historical/);assert.deepEqual(snapshot(s.root),lateBefore);
  const old=await s.e.importResult(s.pid,reference(s.run),historical.manifest,historical.files,true,1);assert.equal(old.payload.state.outcome,'historical');assert.equal(old.payload.state.candidate,null);
  assert.equal(s.v.state(s.pid,reference(s.u)).candidates.length,1);assert.deepEqual(s.app.workspace.kernel.acceptedSelections(s.pid),[]);assert.equal(p1.binding.slot,1);
  evidence('r1-scoped-intake',{synthetic:true,originalCase:{selectedSlot:1,manifestSlot:2,rejected:true,beforeHash:hash(stable),afterHash:hash(wrongFormAfter),originalFiles:stable.files,candidatesBefore:0},rejected,ambiguousHttpRejected:true,duplicateWrongSlotRejected:true,identicalReplayReadOnly:true,conflictingDuplicateRejected:true,correctSlot2:receipt.payload.state.outcome,correctSlot1:old.payload.state.outcome,currentCandidates:s.v.state(s.pid,reference(s.u)).candidates.length,accepted:[],nativeCalls:0});
});
test('R2 fresh consumer kit builds generation then exact-source refinement, independent intake/cold reopen/memory/original and package export',async t=>{
  const s=await setup(t,1),out=await s.e.exportRequest(s.pid,reference(s.run),1),pkg=JSON.parse(out.manifest.toString()),before=snapshot(s.root);
  const kit=await s.e.exportReturnKit(s.pid,reference(s.run),1);assert.deepEqual((await s.e.exportReturnKit(s.pid,reference(s.run),1)).bytes,kit.bytes);assert.deepEqual(snapshot(s.root),before);
  const r=consumer(kit.bytes,await nativeOriginal(),'consumer-generation');assert.ok(r.kit.has('result-schema-v1.json'));assert.ok(r.kit.has('build-return.mjs'));assert.deepEqual(r.kit.get('manifest.json'),out.manifest);
  s.e.claim(s.pid,reference(s.run),1,pkg.packetDigest);const receipt=await s.e.importResult(s.pid,reference(s.run),r.manifest,r.files,false,1);assert.equal(receipt.payload.state.result.attestation.model,null);
  const candidate=s.v.state(s.pid,reference(s.u)).candidates[0]!,entry={id:'consumer-exact-source',candidate:reference(candidate),integrity:candidate.integrity,image:candidate.payload.state.image,orientation:'encoded-top-left',coordinates:'normalized-original',anchor:{kind:'whole'},intent:'include',preservation:null,notes:[]};
  const selection=s.v.exploration.selections(s.pid,{version:1,workUnit:reference(s.u),entries:[entry]});
  const spec=s.v.exploration.freeze(s.pid,{...s.prepared.specification.payload.state,selections:reference(selection),selectionSnapshot:selection.payload.state,operation:'refine',direction:'follow',sourceScopes:[{entryId:entry.id,style:'included',content:'included'}]});
  const q=await s.e.compile(s.pid,reference(spec),64,48),run=s.e.prepare(s.pid,reference(s.e.grant(s.pid,{...s.terms,request:reference(q)}))),refinedOut=await s.e.exportRequest(s.pid,reference(run),1),refinedPkg=JSON.parse(refinedOut.manifest.toString());
  const refineKit=(await s.e.exportReturnKit(s.pid,reference(run),1)).bytes;assert.throws(()=>consumer(refineKit,[...r.files.values()][0]!, 'source-substitution'));
  const refined=consumer(refineKit,await nativeOriginal(64,48,1),'consumer-refinement');assert.deepEqual(refined.kit.get(refinedPkg.sources[0].path),[...r.files.values()][0]);
  s.e.claim(s.pid,reference(run),1,refinedPkg.packetDigest);const refinedReceipt=await s.e.importResult(s.pid,reference(run),refined.manifest,refined.files,false,1);assert.equal(refinedReceipt.payload.state.outcome,'returned');
  const items=[];
  for(const c of s.v.state(s.pid,reference(s.u)).candidates){const item=(await s.app.library.save(s.pid,{expectedProject:s.p.project,unit:reference(s.u),candidate:reference(c),integrity:c.integrity,extent:'whole'})).item;items.push({item,original:(await s.app.library.export(s.pid,'original',reference(item),item.integrity)).bytes,pack:(await s.app.library.export(s.pid,'package',reference(item),item.integrity)).bytes});}
  assert.deepEqual(items.map(x=>x.original),[[...r.files.values()][0],[...refined.files.values()][0]]);
  const capsule=s.app.memory.createCapsule(s.pid,{scope:null,previous:null}),memory=s.app.memory.download(s.pid,reference(capsule)).output;assert.ok(memory.includes('native-exchange-receipt'));
  const app=await s.reopen();for(const x of items){assert.deepEqual((await app.library.export(s.pid,'package',reference(x.item),x.item.integrity)).bytes,x.pack);assert.deepEqual((await app.library.export(s.pid,'original',reference(x.item),x.item.integrity)).bytes,x.original);}
  assert.equal(app.memory.download(s.pid,reference(capsule)).output,memory);assert.deepEqual(app.workspace.kernel.acceptedSelections(s.pid),[]);
  assert.deepEqual((await app.visual.native.adapter.request(pkg,new Map())).bytes,out.bytes);assert.deepEqual((await app.visual.native.exportReturnKit(s.pid,reference(s.run),1)).bytes,kit.bytes);
  evidence('r2-consumer',{synthetic:true,kitEntries:[...r.kit.keys()],freshDirectoryConsumer:true,constructsFrom:'exported kit builder/templates plus authored originals; standard locked tooling only',generation:receipt.payload.state.outcome,refinement:refinedReceipt.payload.state.outcome,exactSourceOriginal:true,sourceSubstitutionRejected:true,unknownMetadataNull:true,coldReopen:true,memoryPreserved:true,originalAndPackageExportsByteStable:true,frozenV1RequestByteStable:true,nativeCalls:0});
});
test('R2 failed consumer, incomplete template and provenance/binding/descriptor/size/source/altered byte negatives',async t=>{
  const s=await setup(t),out=await s.e.exportRequest(s.pid,reference(s.run),1),pkg=JSON.parse(out.manifest.toString());s.e.claim(s.pid,reference(s.run),1,pkg.packetDigest);
  const kit=(await s.e.exportReturnKit(s.pid,reference(s.run),1)).bytes,r=consumer(kit,await nativeOriginal(),'negatives'),before=snapshot(s.root);
  const changes=[JSON.parse(r.kit.get('returned-template-v1.json')!.toString()),{...r.result,binding:{...r.result.binding,requestHash:'a'.repeat(64)}},{...r.result,packetDigest:'b'.repeat(64)},{...r.result,attestation:{...r.result.attestation,kind:'operator-attested-native'}},{...r.result,attestation:{...r.result.attestation,model:'fabricated'}},{...r.result,attestation:{...r.result.attestation,verification:'machine-verified'}},{...r.result,output:{...r.result.output,image:{...r.result.output.image,bytes:1}}},{...r.result,output:{...r.result.output,image:{...r.result.output.image,width:65}}}];
  for(const result of changes){await assert.rejects(s.e.importResult(s.pid,reference(s.run),Buffer.from(JSON.stringify(result)),r.files,false,1));assert.deepEqual(snapshot(s.root),before);}
  const damaged=new Map(r.files);damaged.set(r.result.output.path,Buffer.from('altered bytes'));await assert.rejects(s.e.importResult(s.pid,reference(s.run),r.manifest,damaged,false,1));assert.deepEqual(snapshot(s.root),before);
  assert.throws(()=>consumer(kit,Buffer.alloc(0),'incomplete')); // Empty originals fail deterministic tooling.
  assert.throws(()=>consumer(kit,null,'incomplete'));
  assert.throws(()=>consumer(kit,[...r.files.values()][0]!, 'incomplete','returned',c=>{c.attestation.statement=null;}));
  assert.throws(()=>consumer(kit,[...r.files.values()][0]!, 'forged','returned',c=>{c.attestation.kind='operator-attested-native';}));
  assert.throws(()=>consumer(kit,[...r.files.values()][0]!, 'digest','returned',c=>{c.packetDigest='a'.repeat(64);}));
  assert.throws(()=>consumer(kit,[...r.files.values()][0]!, 'binding','returned',c=>{c.binding.slot=2;}));
  const wrongSize=await nativeOriginal(65,48);assert.throws(()=>consumer(kit,wrongSize,'wrong-size'));
  const failed=consumer(kit,null,'consumer-failure','failed'),receipt=await s.e.importResult(s.pid,reference(s.run),failed.manifest,failed.files,false,1);assert.equal(receipt.payload.state.outcome,'failed');assert.equal(receipt.payload.state.media,null);
  const app=await s.reopen();assert.deepEqual(await app.visual.native.importResult(s.pid,reference(s.run),failed.manifest,failed.files,false,1),receipt);
  evidence('r2-negatives',{failedOutput:receipt.payload.state.outcome,failedReplayAfterReopen:true,incompleteTemplateRejected:true,fixtureForgedNativeRejected:true,wrongBindingDigestRejected:true,malformedDescriptorRejected:true,alteredBytesRejected:true,wrongDimensionsRejected:true,noMutationOnRejectedIntake:true,nativeCalls:0});
});
test('R2 published authored kit equality and native template retains unknown metadata without invoking/importing native evidence',async t=>{
  const p=JSON.parse(readFileSync('fixtures/native-exchange/request.json','utf8'));
  const out=await new NativeExchangeAdapter().request(p,new Map()),kit=tar(new Map([['manifest.json',out.manifest],...nativeReturnKit(p)]),'native-kit');
  assert.deepEqual(kit,readFileSync('fixtures/native-exchange/return-kit.tar'));assert.deepEqual(out.bytes,readFileSync('fixtures/native-exchange/request.tar'));
  const s=await setup(t,1),g=s.e.grant(s.pid,{...s.terms,evidence:'operator-attested-native'}),run=s.e.prepare(s.pid,reference(g));await s.e.exportRequest(s.pid,reference(run),1);
  const files=fixtureTar((await s.e.exportReturnKit(s.pid,reference(run),1)).bytes),template=JSON.parse(files.get('returned-template-v1.json')!.toString());
  assert.equal(template.attestation.kind,'operator-attested-native');for(const key of ['hostInvocationId','model','seed','usage','cost','providerId'])assert.equal(template.attestation[key],null);
  assert.equal(template.attestation.verification,'operator-attestation-only');assert.equal(template.origin,'imported');assert.equal(s.v.state(s.pid,reference(s.u)).candidates.length,0);assert.equal(s.e.state(s.pid,reference(s.u)).runs.find(x=>x.run.id===run.id)!.slots[0]!.status,'awaiting-operator');
  for(const name of ['../schema.json','arbitrary-url.txt','RETURN.md/link'])assert.throws(()=>tar(new Map([[name,Buffer.from('unsafe')]]),'native-kit'));
  assert.throws(()=>tar(new Map([['RETURN.md',Buffer.alloc(262145)]]),'native-kit'));
});
