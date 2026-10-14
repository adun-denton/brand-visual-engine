/** Closed accepted exchange root with old releases/receipts; no actual roots or dispatch. */
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,cpSync,rmSync,symlinkSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {startApp} from '../src/service/server.ts';
import {reference} from '../src/kernel/packets.ts';
import {offlineVisualProviders} from './visual-fixture.ts';
import {nativeOriginal,nativeReturn} from './native-exchange-fixture.ts';
const base='b2e214dd43185832a7811742c5b45723c755c00c',tree='1f48333116af7026a5648b1d84c257caa0ff8bdd',repo=resolve(import.meta.dirname,'..');
const evidence=resolve(process.env['BVE_EVIDENCE_DIR']??'/tmp/bve-native-resolution-compatibility');mkdirSync(evidence,{recursive:true});
const scratch=mkdtempSync(join(tmpdir(),'bve-native-resolution-compat-'));
function inventory(root:string){
  const tables:Record<string,string[]>={},files:Record<string,string>={};
  const walk=(dir:string)=>{for(const e of readdirSync(dir,{withFileTypes:true})){const path=join(dir,e.name);if(e.isDirectory()){walk(path);continue;}if(/\.sqlite-(wal|shm)$/.test(e.name))continue;
    const name=relative(root,path).replaceAll('\\','/');if(e.name.endsWith('.sqlite')){const db=new DatabaseSync(path,{readOnly:true});try{for(const r of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()){const n=String(r['name']);assert.match(n,/^[a-z_]+$/);tables[name+':'+n]=db.prepare('SELECT * FROM '+n).all().map(x=>JSON.stringify(x)).sort();}}finally{db.close();}}else files[name]=createHash('sha256').update(readFileSync(path)).digest('hex');
  }};walk(root);return {tables,files};
}
function preserve(before:ReturnType<typeof inventory>,after:ReturnType<typeof inventory>){for(const [name,rows] of Object.entries(before.tables)){const next=new Set(after.tables[name]);for(const r of rows)assert.ok(next.has(r),name+' original row missing/changed');}for(const [name,hash] of Object.entries(before.files))assert.equal(after.files[name],hash,name+' original file changed');}
try {
  assert.equal(execFileSync('git',['rev-parse',base+'^{tree}'],{cwd:repo,encoding:'utf8'}).trim(),tree);
  const code=join(scratch,'old-code');mkdirSync(code);execFileSync('tar',['-x','-C',code],{input:execFileSync('git',['archive',base],{cwd:repo,maxBuffer:64*1024*1024})});symlinkSync(join(repo,'node_modules'),join(code,'node_modules'),process.platform==='win32'?'junction':'dir');
  const {startApp:oldStart}=await import(pathToFileURL(join(code,'src/service/server.ts')).href),{nativeReturn:oldReturn}=await import(pathToFileURL(join(code,'scripts/native-exchange-fixture.ts')).href);
  const original=join(scratch,'original'),old:any=await oldStart(original,0,undefined,offlineVisualProviders);let meta:any;const returns:any[]=[],downloads:any[]=[],exports:any[]=[];
  try {
    const v=old.visual,p=v.create({title:'Authored PR19 closed repair copy'}),pid=p.project.id,u=v.exploration.createWorkUnit(pid,{version:1,pageType:'homepage',label:'Homepage',source:'Synthetic closed copy'});
    const prep=await v.command(pid,'prepare',{expectedProject:p.project,unit:reference(u),selections:null,intent:'Synthetic old release',count:3,direction:'fresh',brand:null,operation:'create',requests:[],level1:[]}),e=v.native,q=await e.compile(pid,reference(prep.specification),64,48),terms={request:reference(q),slots:[1,2,3],maxSubmissions:3,maxStatusCalls:0,maxCancelCalls:0,timeoutMs:30000,expiresAt:new Date(Date.now()+86400000).toISOString(),evidence:'synthetic-fixture',reason:'Synthetic PR19 copy'};
    const make=()=>e.prepare(pid,reference(e.grant(pid,terms))),run=make();
    for(let slot=1;slot<=3;slot++){
      const out=await e.exportRequest(pid,reference(run),slot),pkg=JSON.parse(out.manifest.toString());
      if(slot===1)e.control(pid,reference(run),slot,'cancel');else e.claim(pid,reference(run),slot,pkg.packetDigest);
      let r=await oldReturn(pkg,await nativeOriginal(64,48,slot%3),'old-'+slot);
      if(slot===3){r.result.outcome='failed';r.result.output=null;r.manifest=Buffer.from(JSON.stringify(r.result));r.files=new Map();}
      const receipt=await e.importResult(pid,reference(run),r.manifest,r.files,slot===1,slot);returns.push({kit:(await e.exportReturnKit(pid,reference(run),slot)).bytes,run:reference(run),slot,manifest:r.manifest,files:r.files,receipt,out,pkg});
      if(slot===2){const c=v.state(pid,reference(u)).candidates[0],item=(await old.library.save(pid,{expectedProject:p.project,unit:reference(u),candidate:reference(c),integrity:c.integrity,extent:'whole'})).item;exports.push({item,bytes:(await old.library.export(pid,'package',reference(item),item.integrity)).bytes});}
    }
    for(const claimed of [false,true]){const r=make(),out=await e.exportRequest(pid,reference(r),1),pkg=JSON.parse(out.manifest.toString());if(claimed)e.claim(pid,reference(r),1,pkg.packetDigest);downloads.push({kit:(await e.exportReturnKit(pid,reference(r),1)).bytes,run:reference(r),out,pkg,claimed});}
    const capsule=old.memory.createCapsule(pid,{scope:null,previous:null});meta={pid,project:p.project,u:reference(u),q:reference(q),terms,capsule:reference(capsule),capsuleBytes:old.memory.download(pid,reference(capsule)).output};
    mkdirSync(join(original,'exports'));for(const [i,r] of returns.entries())writeFileSync(join(original,'exports','old-request-'+i+'.tar'),r.out.bytes);for(const [i,r] of downloads.entries())writeFileSync(join(original,'exports','active-request-'+i+'.tar'),r.out.bytes);writeFileSync(join(original,'exports','old-raster.tar'),exports[0].bytes);writeFileSync(join(original,'exports','capsule.json'),meta.capsuleBytes);
  }finally{await old.close();}
  const before=inventory(original),control=join(scratch,'closed-control'),copy=join(scratch,'additive-copy');cpSync(original,control,{recursive:true});cpSync(original,copy,{recursive:true});assert.deepEqual(inventory(copy),before);
  let app=await startApp(copy,0,undefined,offlineVisualProviders);let newReceipt:any;
  const check=async()=>{
    for(const r of downloads)assert.deepEqual((await app.visual.native.exportRequest(meta.pid,r.run,1)).bytes,r.out.bytes);
    for(const r of returns){assert.deepEqual((await app.visual.native.adapter.request(r.pkg,new Map())).bytes,r.out.bytes);assert.deepEqual(await app.visual.native.importResult(meta.pid,r.run,r.manifest,r.files,r.slot===1,r.slot),r.receipt);}
    for(const x of exports)assert.deepEqual((await app.library.export(meta.pid,'package',reference(x.item),x.item.integrity)).bytes,x.bytes);
    assert.equal(app.memory.download(meta.pid,meta.capsule).output,meta.capsuleBytes);assert.deepEqual(app.workspace.kernel.acceptedSelections(meta.pid),[]);
  };
  try {
    await check();assert.deepEqual(inventory(copy),before);
    // Companion kit is available for old jobs, with no new reservation or mutation.
    for(const r of [...returns,...downloads]){const slot=r.slot??1;const kit=await app.visual.native.exportReturnKit(meta.pid,r.run,slot);assert.deepEqual(kit.bytes,r.kit);}
    assert.deepEqual(inventory(copy),before);
    const active=downloads.find(x=>x.claimed),result=await nativeReturn(active.pkg,await nativeOriginal(64,48,1),'new-scoped-old-claim');
    newReceipt=await app.visual.native.importResult(meta.pid,active.run,result.manifest,result.files,false,1);assert.equal(newReceipt.payload.state.outcome,'returned');
    const e=app.visual.native,fresh=e.prepare(meta.pid,reference(e.grant(meta.pid,meta.terms))),out=await e.exportRequest(meta.pid,reference(fresh),1),pkg=JSON.parse(out.manifest.toString());e.claim(meta.pid,reference(fresh),1,pkg.packetDigest);const r=await nativeReturn(pkg,await nativeOriginal(64,48,2),'new-scoped-run');assert.equal((await e.importResult(meta.pid,reference(fresh),r.manifest,r.files,false,1)).payload.state.outcome,'returned');
    // Add a native-only V2 job alongside retained legacy exact jobs, never rebinding old authority.
    const oldRequest=app.workspace.kernel.get<any>(meta.q).payload.state;
    const nativeQ=await e.compile(meta.pid,oldRequest.spec,1024,1024,{version:1,mode:'native-resolution'}),nativeRun=e.prepare(meta.pid,reference(e.grant(meta.pid,{...meta.terms,request:reference(nativeQ),slots:[1],maxSubmissions:1}))),nativeOut=await e.exportRequest(meta.pid,reference(nativeRun),1),nativePkg=JSON.parse(nativeOut.manifest.toString()),nativeKit=await e.exportReturnKit(meta.pid,reference(nativeRun),1);
    e.claim(meta.pid,reference(nativeRun),1,nativePkg.packetDigest);const nativeBytes=await nativeOriginal(1254,1254),nativeResult=await nativeReturn(nativePkg,nativeBytes,'authored-native-size');const nativeReceipt=await e.importResult(meta.pid,reference(nativeRun),nativeResult.manifest,nativeResult.files,false,1);
    assert.equal(nativeReceipt.payload.state.image!.width,1254);meta.native={run:reference(nativeRun),receipt:nativeReceipt,result:nativeResult};
    writeFileSync(join(evidence,'native-request.tar'),nativeOut.bytes);writeFileSync(join(evidence,'native-return-kit.tar'),nativeKit.bytes);writeFileSync(join(evidence,'authored-original.png'),nativeBytes);writeFileSync(join(evidence,'native-result.json'),nativeResult.manifest);
    preserve(before,inventory(copy));
  }finally{await app.close();}
  const after=inventory(copy);app=await startApp(copy,0,undefined,offlineVisualProviders);
  try {
    // The unresolved old awaiting-operator release remains byte-identical after additive receipts/reopen.
    const pending=downloads.find(x=>!x.claimed);assert.deepEqual((await app.visual.native.exportRequest(meta.pid,pending.run,1)).bytes,pending.out.bytes);
    for(const r of returns)assert.deepEqual(await app.visual.native.importResult(meta.pid,r.run,r.manifest,r.files,r.slot===1,r.slot),r.receipt);
    assert.equal(app.memory.download(meta.pid,meta.capsule).output,meta.capsuleBytes);assert.equal(app.visual.native.state(meta.pid,meta.u).runs.find(x=>x.run.id===newReceipt.payload.state.execution.id)!.slots[0]!.status,'returned');
    assert.deepEqual(await app.visual.native.importResult(meta.pid,meta.native.run,meta.native.result.manifest,meta.native.result.files,false,1),meta.native.receipt);
    assert.equal(app.visual.executions.availability().connected,false);
  }finally{await app.close();}
  preserve(before,inventory(copy));assert.deepEqual(inventory(control),before);
  writeFileSync(join(evidence,'inventories.json'),JSON.stringify({base,tree,before,after,closedControlUnchanged:true,originalRowsAndFilesPreserved:true},null,2)+'\n');
  const summary={base,tree,tableCount:Object.keys(before.tables).length,fileCount:Object.keys(before.files).length,oldReceipts:returns.map(x=>x.receipt.payload.state.outcome),oldActiveReleases:downloads.map(x=>x.claimed?'claimed':'awaiting-operator'),oldPackageReplayAndExportsByteStable:true,legacyKitBytesUnchanged:true,additiveScopedIntake:true,newNativeMode:{requested:[1024,1024],actual:[1254,1254],policy:meta.native.result.result.dimensionPolicy,originalHash:meta.native.receipt.payload.state.image.checksum},coldReopen:true,dispatches:0,nativeCalls:0};writeFileSync(join(evidence,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
}finally{rmSync(scratch,{recursive:true,force:true});}
