/** Authored originals only; policy never authorizes an image/model invocation. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,readFileSync,writeFileSync,symlinkSync,readdirSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import sharp from 'sharp';
import {startApp} from '../src/service/server.ts';
import {offlineVisualProviders} from '../scripts/visual-fixture.ts';
import {nativeOriginal,nativeReturn,fixtureTar} from '../scripts/native-exchange-fixture.ts';
import {canonical,digest,reference,packet,revise} from '../src/kernel/packets.ts';
import {nativeExchangeGate} from '../src/kernel/native-exchange-gate.ts';
import {parseNativePackage,parseNativeInput,parseNativeResult,nativeAdapter} from '../src/modules/website/native-exchange-contracts.ts';
import {nativeView} from '../src/web/native-exchange.ts';
const policy=(mode:'exact'|'native-resolution')=>({version:1 as const,mode});
function snapshot(root:string){const db=new DatabaseSync(join(root,'kernel.sqlite'),{readOnly:true});try{return JSON.stringify({rows:['kernel_packets','kernel_events','kernel_selections'].map(t=>db.prepare('SELECT * FROM '+t+' ORDER BY 1,2').all()),files:readdirSync(join(root,'native-assets')).sort()});}finally{db.close();}}
function evidence(name:string,v:unknown){const dir=process.env['BVE_NATIVE_RESOLUTION_EVIDENCE_DIR'];if(dir){mkdirSync(dir,{recursive:true});writeFileSync(join(dir,name+'.json'),JSON.stringify(v,null,2)+'\n');}}
async function setup(t:test.TestContext,mode:'exact'|'native-resolution'|'legacy'='native-resolution'){
 const root=mkdtempSync(join(tmpdir(),'bve-native-size-'));let app=await startApp(root,0,undefined,offlineVisualProviders);
 t.after(async()=>{await app.close();rmSync(root,{recursive:true,force:true});});
 const v=app.visual,p=v.create({title:'Authored native-resolution test'}),pid=p.project.id,u=v.exploration.createWorkUnit(pid,{version:1,pageType:'homepage',label:'Homepage',source:'Authored fixture'});
 const prepared=await v.command(pid,'prepare',{expectedProject:p.project,unit:reference(u),selections:null,intent:'Authored offline native-resolution fixture',count:1,direction:'fresh',brand:null,operation:'create',requests:[],level1:[]}) as any;
 const e=v.native,q=await e.compile(pid,reference(prepared.specification),1024,1024,mode==='legacy'?undefined:policy(mode));
 const terms={request:reference(q),slots:[1],maxSubmissions:1,maxStatusCalls:0,maxCancelCalls:0,timeoutMs:30000,expiresAt:new Date(Date.now()+3600000).toISOString(),evidence:'synthetic-fixture',reason:'Authored offline authority only'},g=e.grant(pid,terms),run=e.prepare(pid,reference(g));
 const out=await e.exportRequest(pid,reference(run),1),pkg=parseNativePackage(JSON.parse(out.manifest.toString())),kit=await e.exportReturnKit(pid,reference(run),1);
 e.claim(pid,reference(run),1,pkg.packetDigest);
 return {root,app,v,p,pid,u,prepared,e,q,g,run,terms,out,pkg,kit,reopen:async()=>{await app.close();app=await startApp(root,0,undefined,offlineVisualProviders);return app;}};
}
// Fresh consumer construction uses exported kit files/builder, never nativeReturn or server parsing.
function consume(kit:Buffer,original:Buffer|null,edit?:(r:any)=>void){
 const dir=mkdtempSync(join(tmpdir(),'bve-size-consumer-'));try{
  const files=fixtureTar(kit);for(const [name,b]of files){assert.match(name,/^(manifest\.json|kit\.json|RETURN\.md|build-return\.mjs|result-schema-v[12]\.json|(?:returned|failed)-template-v[12]\.json|assets\/[a-f0-9]{64}\.(png|jpg|webp))$/);mkdirSync(join(dir,name.startsWith('assets/')?'assets':''),{recursive:true});writeFileSync(join(dir,name),b);}
  symlinkSync(resolve('node_modules'),join(dir,'node_modules'),process.platform==='win32'?'junction':'dir');
  const version=JSON.parse(files.get('manifest.json')!.toString()).version;
  const r=JSON.parse(files.get((original?'returned':'failed')+'-template-v'+version+'.json')!.toString());Object.assign(r,{receiptId:'authored-policy-return',rights:'Authored synthetic fixture rights',message:'Offline authored result'});r.attestation.statement='Authored fixture; zero native/model calls';edit?.(r);
  writeFileSync(join(dir,'filled.json'),JSON.stringify(r));if(original)writeFileSync(join(dir,'original'),original);
  execFileSync(process.execPath,[join(dir,'build-return.mjs'),join(dir,'filled.json'),join(dir,'return'),...(original?[join(dir,'original')]:[])],{stdio:'pipe'});
  const manifest=readFileSync(join(dir,'return/result.json')),result=JSON.parse(manifest.toString()),returned=result.output?readFileSync(join(dir,'return',result.output.path)):null;
  return {manifest,result,files:result.output?new Map([[result.output.path,returned!]]):new Map<string,Buffer>(),returned};
 }finally{rmSync(dir,{recursive:true,force:true});}
}
test('legacy and V2 exact1024 reject1254 at portable builder/service/canonical gate without mutation; exact positives remain',async t=>{
 for(const mode of ['legacy','exact'] as const){
  const s=await setup(t,mode),original=await nativeOriginal(1254,1254),before=snapshot(s.root);
  assert.throws(()=>consume(s.kit.bytes,original),/dimensions/);
  const r=await nativeReturn(s.pkg,original);await assert.rejects(s.e.importResult(s.pid,reference(s.run),r.manifest,r.files,false,1),/dimensions/);assert.equal(snapshot(s.root),before);
  const current=s.e.state(s.pid,reference(s.u)).runs[0]!.run;
  const forged=packet({type:'work-record',id:'native-receipt-'+digest({job:s.pkg.binding.exchangeJobId,receipt:r.result.receiptId}),projectId:s.pid,dependencies:[reference(current),reference(s.q)],payload:{moduleId:'website',kind:'native-exchange-receipt',scope:'page-execution',lockedValues:{},state:{version:2,adapter:nativeAdapter,execution:reference(current),result:r.result,payloadHash:digest(r.result),outcome:'historical',candidate:null,media:null,image:null}}});
  assert.throws(()=>nativeExchangeGate(forged,null,{...s.app.workspace.kernel.environment(),nativeWriteAllowed:()=>true}),/dimensions/);assert.equal(snapshot(s.root),before);
  const valid=consume(s.kit.bytes,await nativeOriginal(1024,1024));assert.equal((await s.e.importResult(s.pid,reference(s.run),valid.manifest,valid.files,false,1)).payload.state.outcome,'returned');
 }
});
test('native1254/1024 records both sizes and exact bytes; actual coordinates, cold reopen, memory, Library/package and reconstruction lineage',async t=>{
 const s=await setup(t),original=await nativeOriginal(1254,1254),r=consume(s.kit.bytes,original);
 assert.equal(s.pkg.version,2);assert.equal(s.pkg.request.width,1024);assert.deepEqual(r.result.dimensionPolicy,policy('native-resolution'));assert.deepEqual(r.returned,original);
 const receipt=await s.e.importResult(s.pid,reference(s.run),r.manifest,r.files,false,1),c=s.v.state(s.pid,reference(s.u)).candidates[0]!;assert.equal(c.payload.state.image.width,1254);assert.equal(receipt.payload.state.image!.height,1254);assert.equal(c.payload.state.origin,'imported');assert.equal(c.approval,'proposal');
 const entry={id:'actual-sized-region',candidate:reference(c),integrity:c.integrity,image:c.payload.state.image,orientation:'encoded-top-left',coordinates:'normalized-original',anchor:{kind:'rectangle',x:0.5,y:0.5,width:0.5,height:0.5},intent:'include',preservation:null,notes:[]};
 const selection=s.v.exploration.selections(s.pid,{version:1,workUnit:reference(s.u),entries:[entry]});assert.equal(selection.payload.state.entries[0]!.image.width,1254);
 const request=await s.app.reconstruction.prepare(s.pid,{expectedProject:s.p.project,workUnit:reference(s.u),source:reference(c),integrity:c.integrity,expectedControl:null,instruction:'Authored offline reconstruction preparation',count:1,viewports:[{width:1254,height:1254}],brand:null,base:null,baseSignature:null,resources:[],evidence:[]});
 assert.equal(request.request.payload.state.source.image.width,1254);assert.equal(s.app.reconstruction.availability().connected,false);
 const item=(await s.app.library.save(s.pid,{expectedProject:s.p.project,unit:reference(s.u),candidate:reference(c),integrity:c.integrity,extent:'whole'})).item;
 const exported=(await s.app.library.export(s.pid,'package',reference(item),item.integrity)).bytes,packageFiles=fixtureTar(exported),closure=JSON.parse(packageFiles.get('exchange-evidence.json')!.toString());
 assert.equal(closure.records.request.payload.state.width,1024);assert.equal(closure.records.receipt.payload.state.image.width,1254);assert.deepEqual(closure.records.request.payload.state.dimensionPolicy,policy('native-resolution'));
 assert.deepEqual((await s.app.library.export(s.pid,'original',reference(item),item.integrity)).bytes,original);
 const capsule=s.app.memory.createCapsule(s.pid,{scope:null,previous:null}),memory=s.app.memory.download(s.pid,reference(capsule)).output;assert.ok(memory.includes('native-raster-execution-request'));assert.ok(memory.includes('native-resolution'));
 const before=snapshot(s.root);assert.deepEqual(await s.e.importResult(s.pid,reference(s.run),r.manifest,r.files,false,1),receipt);assert.equal(snapshot(s.root),before);
 const app=await s.reopen();assert.equal(snapshot(s.root),before);assert.deepEqual(app.workspace.assets.read(c.payload.state.image.id),original);assert.deepEqual((await app.library.export(s.pid,'package',reference(item),item.integrity)).bytes,exported);assert.equal(app.memory.download(s.pid,reference(capsule)).output,memory);assert.deepEqual(app.workspace.kernel.acceptedSelections(s.pid),[]);assert.equal(app.visual.executions.availability().connected,false);
 evidence('positive',{synthetic:true,requested:[1024,1024],actual:[1254,1254],policy:policy('native-resolution'),originalHash:c.payload.state.image.checksum,packetDigest:s.pkg.packetDigest,byteEquality:true,actualCoordinateDimensions:true,reconstructionSource:request.request.payload.state.source.image,coldReopen:true,memory:true,exports:true,accepted:[],dispatches:0,nativeCalls:0});
});
test('native mode also admits different ratio, PNG/JPEG/WebP and failed returns without claiming exact compliance',async t=>{
 for(const format of ['png','jpeg','webp'] as const){const s=await setup(t),bytes=await nativeOriginal(1254,700,0,format),r=consume(s.kit.bytes,bytes);await s.e.importResult(s.pid,reference(s.run),r.manifest,r.files,false,1);assert.deepEqual(r.returned,bytes);assert.equal(r.result.output.image.height,700);}
 const s=await setup(t),r=consume(s.kit.bytes,null);assert.equal((await s.e.importResult(s.pid,reference(s.run),r.manifest,r.files,false,1)).payload.state.outcome,'failed');assert.equal(s.v.state(s.pid,reference(s.u)).candidates.length,0);
});
test('unsupported/missing/forged policies, released mutations, digest, scope and descriptors reject before mutation/replay',async t=>{
 const s=await setup(t),r=consume(s.kit.bytes,await nativeOriginal(1254,1254)),before=snapshot(s.root);
 for(const bad of [null,{version:2,mode:'native-resolution'},{version:1,mode:'auto'},{version:1,mode:'native-resolution',extra:true}])await assert.rejects(s.e.compile(s.pid,reference(s.prepared.specification),1024,1024,bad));
 assert.throws(()=>parseNativeInput({...s.q.payload.state,dimensionPolicy:undefined}));
 for(const change of [{dimensionPolicy:policy('exact')},{dimensionPolicy:null},{dimensionPolicy:{version:2,mode:'native-resolution'}},{version:1},{version:3},{packetDigest:'a'.repeat(64)},{binding:{...r.result.binding,slot:2}},{output:{...r.result.output,image:{...r.result.output.image,width:1024}}}]){await assert.rejects(s.e.importResult(s.pid,reference(s.run),Buffer.from(canonical({...r.result,...change})),r.files,false,1));assert.equal(snapshot(s.root),before);}
 const released=structuredClone(s.pkg);if(released.request.version===2)released.request.dimensionPolicy=policy('exact');assert.throws(()=>parseNativePackage(released));
 const changed=revise(s.q,{...s.q.payload,state:({...s.q.payload.state,dimensionPolicy:policy('exact')} as typeof s.q.payload.state)},'local-operator','Forged policy change');assert.throws(()=>nativeExchangeGate(changed,s.q,{...s.app.workspace.kernel.environment(),nativeWriteAllowed:()=>true}),/immutable/);
 const rr=s.e.state(s.pid,reference(s.u)).runs[0]!.run,altered=structuredClone(rr.payload.state);altered.slots[0]!.release=released;const alteredRun=revise(rr,{...rr.payload,state:altered},'local-operator','Forged release');assert.throws(()=>nativeExchangeGate(alteredRun,rr,{...s.app.workspace.kernel.environment(),nativeWriteAllowed:()=>true}));assert.equal(snapshot(s.root),before);
 const receipt=await s.e.importResult(s.pid,reference(s.run),r.manifest,r.files,false,1),after=snapshot(s.root);
 await assert.rejects(s.e.importResult(s.pid,reference(s.run),r.manifest,r.files,false,2),/slot/);await assert.rejects(s.e.importResult(s.pid,reference(s.run),Buffer.from(canonical({...r.result,dimensionPolicy:policy('exact')})),r.files,false,1),/policy/);await assert.rejects(s.e.importResult(s.pid,reference(s.run),Buffer.from(canonical({...r.result,message:'conflict'})),r.files,false,1),/Conflicting/);assert.equal(snapshot(s.root),after);assert.deepEqual(await s.e.importResult(s.pid,reference(s.run),r.manifest,r.files,false,1),receipt);
});
test('both policies retain invalid format/full-decode/bytes/pixels/edge/multiframe and provenance rejection',async t=>{
 // Authored animated WebP (two vertically stacked frames), not generated imagery.
 const animated=await sharp(Buffer.concat([Buffer.alloc(16*16*3,20),Buffer.alloc(16*16*3,220)]),{raw:{width:16,height:32,channels:3,pageHeight:16}}).webp({loop:0,delay:[10,10]}).toBuffer();assert.equal((await sharp(animated,{animated:true}).metadata()).pages,2);
 const tooWide=await nativeOriginal(8193,1),tooMany=await nativeOriginal(4001,4000);
 for(const mode of ['exact','native-resolution'] as const){const s=await setup(t,mode),r=await nativeReturn(s.pkg,await nativeOriginal(1024,1024)),before=snapshot(s.root);
  for(const bytes of [Buffer.from('invalid'),Buffer.alloc(8388609),r.files.values().next().value!.subarray(0,40),animated,tooWide,tooMany]){assert.throws(()=>consume(s.kit.bytes,bytes));await assert.rejects(s.e.importResult(s.pid,reference(s.run),r.manifest,new Map([[r.result.output!.path,bytes]]),false,1));assert.equal(snapshot(s.root),before);}
  for(const change of [{origin:'generated'},{attestation:{...r.result.attestation,verification:'machine-verified'}},{attestation:{...r.result.attestation,kind:'operator-attested-native'}},{attestation:{...r.result.attestation,model:'forged'}}]){await assert.rejects(s.e.importResult(s.pid,reference(s.run),Buffer.from(canonical({...r.result,...change})),r.files,false,1));assert.equal(snapshot(s.root),before);}
 }
});
test('uncertain native-mode return requires explicit history; loss never restores claim; retry keeps policy',async t=>{
 const s=await setup(t),r=consume(s.kit.bytes,await nativeOriginal(1254,1254));s.e.control(s.pid,reference(s.run),1,'uncertain');const before=snapshot(s.root);
 await assert.rejects(s.e.importResult(s.pid,reference(s.run),r.manifest,r.files,false,1),/historical/);assert.equal(snapshot(s.root),before);
 const receipt=await s.e.importResult(s.pid,reference(s.run),r.manifest,r.files,true,1);assert.equal(receipt.payload.state.outcome,'historical');assert.equal(receipt.payload.state.image!.width,1254);assert.equal(s.v.state(s.pid,reference(s.u)).candidates.length,0);assert.throws(()=>s.e.claim(s.pid,reference(s.run),1,s.pkg.packetDigest));
 const run=s.e.state(s.pid,reference(s.u)).runs[0]!.run;
 await assert.rejects(s.e.command(s.pid,'prepare',{expectedProject:s.p.project,spec:null,width:0,height:0,slots:[1],expiresAt:new Date(Date.now()+3600000).toISOString(),evidence:'synthetic-fixture',dimensionPolicy:policy('exact'),retryOf:{execution:reference(run),slot:1}}),/policy/);
 const db=new DatabaseSync(join(s.root,'kernel.sqlite'));db.prepare('DELETE FROM kernel_packets WHERE id=?').run(s.q.id);db.close();const lost=snapshot(s.root);assert.throws(()=>s.e.prepare(s.pid,reference(s.g)),/unavailable/);assert.throws(()=>s.e.claim(s.pid,reference(s.run),1,s.pkg.packetDigest));assert.equal(snapshot(s.root),lost);
});
test('source substitution remains rejected by builder, service and canonical receipt gate in both modes',async t=>{
 for(const mode of ['exact','native-resolution'] as const){const s=await setup(t,mode),initial=consume(s.kit.bytes,await nativeOriginal(1024,1024));await s.e.importResult(s.pid,reference(s.run),initial.manifest,initial.files,false,1);
  const c=s.v.state(s.pid,reference(s.u)).candidates[0]!,entry={id:'exact-source',candidate:reference(c),integrity:c.integrity,image:c.payload.state.image,orientation:'encoded-top-left',coordinates:'normalized-original',anchor:{kind:'whole'},intent:'include',preservation:null,notes:[]};const sel=s.v.exploration.selections(s.pid,{version:1,workUnit:reference(s.u),entries:[entry]});
  const spec=s.v.exploration.freeze(s.pid,{...s.prepared.specification.payload.state,selections:reference(sel),selectionSnapshot:sel.payload.state,operation:'refine',direction:'follow',sourceScopes:[{entryId:entry.id,style:'included',content:'included'}]});const q=await s.e.compile(s.pid,reference(spec),1024,1024,policy(mode)),run=s.e.prepare(s.pid,reference(s.e.grant(s.pid,{...s.terms,request:reference(q)}))),out=await s.e.exportRequest(s.pid,reference(run),1),pkg=JSON.parse(out.manifest.toString()),kit=await s.e.exportReturnKit(s.pid,reference(run),1);s.e.claim(s.pid,reference(run),1,pkg.packetDigest);const before=snapshot(s.root);
  assert.throws(()=>consume(kit.bytes,initial.returned!),/source/);const forged=await nativeReturn(pkg,initial.returned!);await assert.rejects(s.e.importResult(s.pid,reference(run),forged.manifest,forged.files,false,1),/substitute/);assert.equal(snapshot(s.root),before);
 }
});
test('UI explicitly defaults exact, submits a V2 policy, and displays preference/actual ratio truthfully',async t=>{
 const s=await setup(t),r=consume(s.kit.bytes,await nativeOriginal(1254,700));await s.e.importResult(s.pid,reference(s.run),r.manifest,r.files,false,1);
 const html=nativeView(s.e.state(s.pid,reference(s.u)),String,[s.prepared.specification]);assert.match(html,/name="dimensionMode"><option value="exact">Exact size required/);assert.match(html,/preferences: 1024×1024/);assert.match(html,/returned original 1254×700 · ratio 1254:700/);assert.match(html,/Exact size or ratio compliance is not claimed/);
 evidence('negative-controls',{synthetic:true,exactDefault:true,legacyExactPreserved:true,policyForgeryRejected:true,ownedScope:true,hardBounds:true,sourceSubstitution:true,provenance:true,historicalOnly:true,lostAuthorityBlocks:true,nativeCalls:0});
});
