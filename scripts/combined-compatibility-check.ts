/** Exact upstream disposable-root rehearsal. No operator roots or provider calls. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,cpSync,rmSync,symlinkSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {startApp} from '../src/service/server.ts';
import {reference,canonical} from '../src/kernel/packets.ts';
import {pageSignature} from '../src/modules/website/page.ts';
import {visualFixture,offlineVisualProviders} from './visual-fixture.ts';
import {OfflineRasterTransport} from './execution-fixture.ts';
import {ChatFixture} from './chat-fixture.ts';
import {seedRepairPage} from './inference-repair-fixture.ts';
const pins={v05:'d11fa566a9c798aa6b2706ad542a30a5a1905abb',r8:'c6edf5218a1d98870b87a8029270e233c012468d'};
const trees={v05:'255bd24bc2c35e0709217cf628b6aa2c58ab75fa',r8:'7916974727b113e89cfb466b8bd01b736d081583'};
const repo=resolve(import.meta.dirname,'..');
const hash=(x:string|Buffer)=>createHash('sha256').update(x).digest('hex');
function inventory(root:string){
  const files:Record<string,{sha256:string;bytes:number}>={},tables:Record<string,unknown[]>={};
  function walk(dir:string){for(const e of readdirSync(dir,{withFileTypes:true})){
    const p=join(dir,e.name);if(e.isDirectory()){walk(p);continue;}
    if(/\.sqlite-(wal|shm)$/.test(e.name))continue;
    const key=relative(root,p).replaceAll('\\','/'),bytes=readFileSync(p);files[key]={sha256:hash(bytes),bytes:bytes.length};
    if(e.name.endsWith('.sqlite')){const db=new DatabaseSync(p,{readOnly:true});try{
      for(const row of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()){
        const name=String(row['name']);assert.match(name,/^[a-z_]+$/);
        tables[key+':'+name]=db.prepare('SELECT * FROM '+name).all().map(x=>({...x})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
      }
    }finally{db.close();}}
  }}walk(root);return {files,tables};
}
function preserve(before:ReturnType<typeof inventory>,after:ReturnType<typeof inventory>){
  for(const [name,rows] of Object.entries(before.tables))assert.deepEqual(after.tables[name],rows,name+' original serialized records changed');
  for(const [name,f] of Object.entries(before.files))if(!/\.sqlite(?:-|$)/.test(name))assert.deepEqual(after.files[name],f,name+' original bytes changed');
}
async function seed(code:string,root:string,lineage:keyof typeof pins){
  const {startApp:upstream}=await import(pathToFileURL(join(code,'src/service/server.ts')).href);
  const transport=new OfflineRasterTransport(),driver=new ChatFixture();
  const app:any=await upstream(root,0,undefined,offlineVisualProviders,{aiResponseFixture:true,...(lineage==='v05'?{executionFixture:{testOnly:true,transport}}:{chatDriver:driver})});
  let pid:string,unit:any=null,candidate:any=null,item:any=null,capsule:any=null;
  try{
    if(lineage==='v05'){
      const p=app.visual.create({title:'Synthetic V05 compatibility'});pid=p.project.id;
      unit=app.visual.exploration.createWorkUnit(pid,{version:1,pageType:'homepage',label:'Homepage',source:'Disposable rehearsal'});
      candidate=await app.visual.exploration.importCandidate(pid,reference(unit),await visualFixture(0),'Authored synthetic compatibility fixture');
      const prepared:any=await app.visual.command(pid,'prepare',{expectedProject:p.project,unit:reference(unit),selections:null,intent:'Synthetic execution receipt',count:1,direction:'fresh',brand:null,operation:'create',requests:[],level1:[]});
      const e=app.visual.executions,q=await e.compile(pid,reference(prepared.specification),64,48),g=e.grant(pid,{request:reference(q),adapter:transport.capabilities.adapter,slots:[1],maxSubmissions:1,maxStatusCalls:12,maxCancelCalls:6,timeoutMs:1000,expiresAt:new Date(Date.now()+3600000).toISOString(),reason:'Explicit synthetic fixture grant'});
      await e.execute(pid,reference(e.prepare(pid,reference(g))));
      item=(await app.library.save(pid,{expectedProject:p.project,unit:reference(unit),candidate:reference(candidate),integrity:candidate.integrity,extent:'whole'})).item;
      for(const kind of ['original','package']){const out=await app.library.export(pid,kind,reference(item),item.integrity);mkdirSync(join(root,'rehearsal-exports'),{recursive:true});writeFileSync(join(root,'rehearsal-exports','raster-'+kind),out.bytes);}
      app.memory.saveNote(pid,{expected:null,note:{version:1,scope:reference(unit),text:'Immutable synthetic handoff',source:'human-authored',evidence:[]}});
      capsule=app.memory.createCapsule(pid,{scope:reference(unit),previous:null});
      writeFileSync(join(root,'rehearsal-exports','capsule.json'),app.memory.download(pid,reference(capsule)).output);
    }else{
      const turn=app.chat.send({projectId:null,clientId:'compatibility-turn',text:'Synthetic bicycle design',focus:{view:'studio',page:null,resources:[],target:null}});pid=turn.projectId;
      for(let i=0;i<200&&app.chat.state(pid).session.turns.at(-1).status==='running';i++)await new Promise(r=>setTimeout(r,10));
      assert.equal(app.chat.state(pid).session.turns.at(-1).status,'completed');assert.equal(driver.calls,1);
    }
    const page=lineage==='v05'?await seedRepairPage(app.pages,pid!):app.pages.state(pid!).pages[0];
    assert.ok(page);app.pages.accept(pid!,{artifact:reference(page),expected:null,reason:'Synthetic reviewed fixture',reviewedHash:pageSignature(page.payload.state),acknowledgeFindings:true});
    const media=await app.pages.addMedia(pid!,{expectedProject:reference(app.workspace.project(pid!)),file:(await visualFixture(1)).toString('base64'),origin:null,label:'Synthetic retained media',role:'placeable',permission:'Authored disposable fixture'});
    void media;
    const output=await app.pages.export(pid!,reference(page));mkdirSync(join(root,'rehearsal-exports'),{recursive:true});writeFileSync(join(root,'rehearsal-exports','semantic.tar'),output.bytes);
    return {pid:pid!,page:reference(page),unit:unit?reference(unit):null,candidate:candidate?reference(candidate):null,item:item?{ref:reference(item),integrity:item.integrity}:null,capsule:capsule?reference(capsule):null};
  }finally{await app.close();}
}
const evidence=resolve(process.env['BVE_EVIDENCE_DIR']??'/tmp/bve-combined-compatibility');mkdirSync(evidence,{recursive:true});
const scratch=mkdtempSync(join(tmpdir(),'bve-combined-compatibility-')),results:unknown[]=[];
try{for(const lineage of ['v05','r8'] as const){
  assert.equal(execFileSync('git',['rev-parse',pins[lineage]+'^{tree}'],{cwd:repo,encoding:'utf8'}).trim(),trees[lineage]);
  const code=join(scratch,lineage+'-code');mkdirSync(code);execFileSync('tar',['-x','-C',code],{input:execFileSync('git',['archive',pins[lineage]],{cwd:repo,maxBuffer:64*1024*1024})});
  symlinkSync(join(repo,'node_modules'),join(code,'node_modules'),process.platform==='win32'?'junction':'dir');
  const original=join(scratch,lineage+'-original'),meta=await seed(code,original,lineage),before=inventory(original);
  const rollback=join(scratch,lineage+'-closed-control'),copy=join(scratch,lineage+'-candidate');cpSync(original,rollback,{recursive:true});cpSync(original,copy,{recursive:true});assert.deepEqual(inventory(copy),before);
  let app=await startApp(copy,0,undefined,offlineVisualProviders);const first=canonical(app.workspace.kernel.latestPackets());
  assert.deepEqual((await app.pages.export(meta.pid,meta.page)).bytes,readFileSync(join(original,'rehearsal-exports','semantic.tar')));
  if(meta.unit&&meta.item&&meta.capsule){
    assert.ok(app.visual.state(meta.pid,meta.unit).candidates.length>=2);
    assert.equal(app.chat.state(meta.pid).session.turns.length,0);
    for(const kind of ['original','package'] as const)assert.deepEqual((await app.library.export(meta.pid,kind,meta.item.ref,meta.item.integrity)).bytes,readFileSync(join(original,'rehearsal-exports','raster-'+kind)));
    assert.deepEqual(Buffer.from(app.memory.download(meta.pid,meta.capsule).output),readFileSync(join(original,'rehearsal-exports','capsule.json')));
  }else{
    assert.equal(app.visual.project(meta.pid).units.length,0);assert.equal((await app.library.state(meta.pid)).coverage.total,0);assert.equal(app.visual.executions.availability().connected,false);
    assert.equal(app.chat.state(meta.pid).session.turns.length,1);
  }
  await app.close();const after=inventory(copy);preserve(before,after);
  // An ordinary additive write, then a cold reopen; no historical relabelling.
  app=await startApp(copy,0,undefined,offlineVisualProviders);
  const newUnit=app.visual.exploration.createWorkUnit(meta.pid,{version:1,pageType:'about',label:'New combined page',source:'Additive synthetic check'});
  const newNote=app.memory.saveNote(meta.pid,{expected:null,note:{version:1,scope:reference(newUnit),text:'New combined write',source:'human-authored',evidence:[]}});
  await app.close();app=await startApp(copy,0,undefined,offlineVisualProviders);
  assert.equal(app.memory.index(meta.pid,reference(newUnit)).entries.some(x=>x.ref.id===newNote.id),true);
  for(const old of JSON.parse(first))assert.equal(canonical(app.workspace.kernel.get(reference(old))),canonical(old));
  assert.deepEqual((await app.pages.export(meta.pid,meta.page)).bytes,readFileSync(join(original,'rehearsal-exports','semantic.tar')));
  await app.close();assert.deepEqual(inventory(rollback),before);
  const detail={lineage,source:pins[lineage],tree:trees[lineage],meta,before,after,originalRecordBytesPreserved:true,mediaAndExportsPreserved:true,additiveWriteColdReopen:true,closedControlUnchanged:true};
  writeFileSync(join(evidence,lineage+'-inventory.json'),JSON.stringify(detail,null,2)+'\n');results.push({lineage,source:pins[lineage],tables:Object.keys(before.tables),files:Object.keys(before.files).length,pass:true});
}}finally{rmSync(scratch,{recursive:true,force:true});}
writeFileSync(join(evidence,'summary.json'),JSON.stringify({results,accountCalls:0,modelCalls:0,imageProviderCalls:0,gpuCalls:0,protectedRootAccesses:0},null,2)+'\n');console.log(JSON.stringify(results));
