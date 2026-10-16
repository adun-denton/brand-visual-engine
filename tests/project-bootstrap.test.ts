import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,mkdirSync,existsSync,symlinkSync,renameSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync,spawn,execFileSync,execFile} from 'node:child_process';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {initializeProject,projectConfig,inspection,runningInstallation} from '../src/service/project-bootstrap.ts';
import {Workspace} from '../src/service/workspace.ts';
import {fixtureInstallation} from '../scripts/production-fixture.ts';
import {startApp} from '../src/service/server.ts';
const fresh=()=>mkdtempSync(join(tmpdir(),'bve-bootstrap-'));
test('A01/A03/A10 durable initialization resume, same identities and local additions',()=>{
 const root=fresh();try{
  assert.throws(()=>initializeProject(root,fixtureInstallation,'Authored project',phase=>{if(phase==='identity')throw Error('interrupted');}),/interrupted/);
  const identity=JSON.parse(readFileSync(join(root,'.bve-init.json'),'utf8')).config;
  mkdirSync(join(root,'runtime'));writeFileSync(join(root,'runtime/foreign.txt'),'Unregistered runtime');
  assert.throws(()=>initializeProject(root,fixtureInstallation),/adoption required/);assert.equal(existsSync(join(root,'runtime/bve.runtime.json')),false);assert.equal(existsSync(join(root,'runtime/kernel.sqlite')),false);rmSync(join(root,'runtime'),{recursive:true});
  mkdirSync(join(root,'runtime'));writeFileSync(join(root,'runtime/bve.runtime.json.00000000-0000-0000-0000-000000000000.tmp'),'Interrupted atomic marker bytes');
  assert.throws(()=>initializeProject(root,fixtureInstallation,'Ignored',phase=>{if(phase==='runtime')throw Error('interrupted-runtime');}),/interrupted-runtime/);
  const c=initializeProject(root,fixtureInstallation,'Ignored');assert.deepEqual(c,identity);
  writeFileSync(join(root,'instructions/local.md'),'User local additions');writeFileSync(join(root,'AGENTS.md'),'User project instructions');writeFileSync(join(root,'references/keep.txt'),'Keep reference');
  assert.deepEqual(initializeProject(root,fixtureInstallation,'Ignored title'),c);
  assert.equal(readFileSync(join(root,'AGENTS.md'),'utf8'),'User project instructions');assert.equal(readFileSync(join(root,'instructions/local.md'),'utf8'),'User local additions');
  const w=new Workspace(join(root,'runtime'));try{assert.equal(w.kernel.latestPackets().filter(p=>p.type==='module-project').length,1);assert.equal(w.kernel.latestPackets().filter(p=>(p.payload as {kind?:string}).kind==='page-work-unit').length,1);}finally{w.close();}
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('A02 incompatible/foreign/inconsistent roots refuse without canonical mutation',()=>{
 const root=fresh();try{
  writeFileSync(join(root,'foreign.txt'),'untouched');assert.throws(()=>initializeProject(root,fixtureInstallation),/adoption required/);assert.equal(existsSync(join(root,'runtime')),false);assert.equal(existsSync(join(root,'bve.project.json')),false);
  rmSync(join(root,'foreign.txt'));mkdirSync(join(root,'.git'));assert.throws(()=>initializeProject(root,fixtureInstallation),/outside source control/);rmSync(join(root,'.git'),{recursive:true});const c=initializeProject(root,fixtureInstallation);
  const kernel=readFileSync(join(root,'runtime/kernel.sqlite'));
  writeFileSync(join(root,'bve.project.json'),JSON.stringify({...c,formatVersion:99}));assert.throws(()=>initializeProject(root,fixtureInstallation),/Unsupported/);assert.deepEqual(readFileSync(join(root,'runtime/kernel.sqlite')),kernel);
  writeFileSync(join(root,'bve.project.json'),JSON.stringify({...c,runtimeId:'wrong'}));assert.throws(()=>projectConfig(root),/Inconsistent/);
  writeFileSync(join(root,'bve.project.json'),JSON.stringify(c));renameSync(join(root,'runtime/kernel.sqlite'),join(root,'references/closed-kernel.sqlite'));
  assert.throws(()=>initializeProject(root,fixtureInstallation),/Missing or redirected/);assert.equal(existsSync(join(root,'runtime/kernel.sqlite')),false);renameSync(join(root,'references/closed-kernel.sqlite'),join(root,'runtime/kernel.sqlite'));
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('A14 live app, CLI and direct workspaces cannot acquire competing runtime ownership',async()=>{
 const root=fresh();let app:Awaited<ReturnType<typeof startApp>>|undefined;try{
  const c=initializeProject(root,fixtureInstallation);app=await startApp(join(root,'runtime'),0,undefined,undefined,{projectRoot:root});
  assert.throws(()=>new Workspace(join(root,'runtime')),/owning writer/);assert.throws(()=>initializeProject(root,fixtureInstallation),/owning writer/);
  const child=spawnSync(process.execPath,['--input-type=module','-e',`import {Workspace} from ${JSON.stringify(new URL('../src/service/workspace.ts',import.meta.url).href)};new Workspace(${JSON.stringify(join(root,'runtime'))})`],{encoding:'utf8'});assert.notEqual(child.status,0);assert.match(child.stderr,/owning writer/);
  const old=app.workspace;await app.close();app=undefined;
  assert.throws(()=>old.kernel.putMany([]));assert.throws(()=>old.owner.assert(),/closed/);
  assert.deepEqual(initializeProject(root,fixtureInstallation),c);
 }finally{await app?.close();rmSync(root,{recursive:true,force:true});}
});
test('A14 OS releases writer lock after process death, without reset or second job database',async()=>{
 const root=fresh();try{
  const c=initializeProject(root,fixtureInstallation);
  const child=spawn(process.execPath,['--input-type=module','-e',`import {Workspace} from ${JSON.stringify(new URL('../src/service/workspace.ts',import.meta.url).href)};const workspace=new Workspace(${JSON.stringify(join(root,'runtime'))});console.log('owned');setInterval(()=>workspace.owner.assert(),1000)`],{stdio:['ignore','pipe','pipe']});
  try{
   await new Promise<void>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Writer child startup timeout')),30000);
    child.stdout!.once('data',()=>{clearTimeout(timer);resolve();});
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',code=>{clearTimeout(timer);reject(Error('Writer child exited before readiness: '+code));});
   });
   let unexpected:Workspace|undefined;try{assert.throws(()=>{unexpected=new Workspace(join(root,'runtime'));},/owning writer/);}finally{unexpected?.close();}
   child.kill('SIGKILL');await once(child,'exit');
   assert.deepEqual(initializeProject(root,fixtureInstallation),c);
  }finally{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await once(child,'exit');}}
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('A14 occupied loopback port fails without retaining its writer',async()=>{
 const root=fresh(),other=fresh();let app:Awaited<ReturnType<typeof startApp>>|undefined;try{
  initializeProject(root,fixtureInstallation);initializeProject(other,fixtureInstallation);app=await startApp(join(root,'runtime'),0);
  await assert.rejects(startApp(join(other,'runtime'),Number(new URL(app.origin).port)),/EADDRINUSE/);
  const w=new Workspace(join(other,'runtime'));w.close();
 }finally{await app?.close();rmSync(root,{recursive:true,force:true});rmSync(other,{recursive:true,force:true});}
});

test('A15 versioned JSON schema and read-only inspection preserve identity, bytes and capability unknowns',async()=>{
 const {Ajv}=await import('ajv'),{inspectRecords,inspection}=await import('../src/service/project-bootstrap.ts');
 const root=fresh();try{
  const c=initializeProject(root,fixtureInstallation),before=readFileSync(join(root,'runtime/kernel.sqlite'));
  const validate=new Ajv().compile(JSON.parse(readFileSync(new URL('../schemas/project-config.schema.json',import.meta.url),'utf8')));
  assert.equal(validate(c),true);assert.equal(validate({...c,formatVersion:99}),false);assert.equal(validate({...c,extra:true}),false);
  const state=inspectRecords(root);assert.equal(state.projectId,c.projectId);assert.equal(state.jobs.length,0);assert.deepEqual(readFileSync(join(root,'runtime/kernel.sqlite')),before);
  assert.equal(inspection(root).environment.generationCalls,0);assert.equal(inspection(root).environment.nativeGeneration,'unverified');assert.equal(existsSync(join(root,'runtime/chat-account-private')),false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('A14/A15 actual CLI operations reuse the owning HTTP service; closed inspection writes no canonical data',async()=>{
 const root=fresh(),cli=new URL('../scripts/bve.ts',import.meta.url);let child:ReturnType<typeof spawn>|undefined;
 const command=(args:string[])=>{const r=spawnSync(process.execPath,[fileURLToPath(cli),...args,'--root',root],{encoding:'utf8',timeout:20000});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);};
 try{
  const c=command(['init','Authored CLI project']);const before=readFileSync(join(root,'runtime/kernel.sqlite'));assert.equal(command(['inspect']).config.projectId,c.projectId);assert.deepEqual(readFileSync(join(root,'runtime/kernel.sqlite')),before);
  child=spawn(process.execPath,[fileURLToPath(cli),'start','--root',root,'0'],{stdio:['ignore','pipe','pipe']});
  let output='';await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('CLI start timeout')),15000);child!.stdout!.on('data',chunk=>{output+=chunk;try{if(JSON.parse(output).url){clearTimeout(timer);resolve();}}catch{}});child!.once('exit',code=>{clearTimeout(timer);if(code)reject(Error('CLI start exited '+code));});});
  assert.deepEqual(JSON.parse(output).installation,runningInstallation());assert.deepEqual(JSON.parse(output).selectedInstallation,c.installation);
  const {fixturePreparation,authoredOriginal,stageDelivery}=await import('../scripts/production-fixture.ts');
  const request=fixturePreparation({project:()=>({id:c.projectId,version:1})} as unknown as Workspace,c),requestPath=join(root,'references/request.json');writeFileSync(requestPath,JSON.stringify(request));
  const prepared=command(['prepare',requestPath]);assert.equal(command(['jobs']).length,3);await stageDelivery(root,prepared.jobs[0],await authoredOriginal());assert.equal(command(['intake',prepared.jobs[0].id]).payload.state.disposition,'ready');assert.equal(command(['receipts']).length,1);assert.equal(command(['inspect']).state.projectId,c.projectId);
  const denied=spawnSync(process.execPath,[fileURLToPath(cli),'init','--root',root],{encoding:'utf8',timeout:10000});assert.notEqual(denied.status,0);assert.match(denied.stderr,/owning writer/);
  child.kill('SIGTERM');await once(child,'exit');child=undefined;assert.equal(command(['inspect']).state.jobs.length,3);assert.equal(command(['receipts']).length,1);
 }finally{if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await once(child,'exit');}rmSync(root,{recursive:true,force:true});}
});

// Compare canonical bytes and config, rather than trusting an exception or an empty response.
function canonicalSnapshot(root:string) {
 const files=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(dir,e.name)):e.isFile()?[join(dir,e.name)]:[]);
 // SQLite may create disposable shared-memory and empty WAL files for read-only WAL access.
 return Object.fromEntries([join(root,'bve.project.json'),...files(join(root,'runtime'))].filter(path=>!path.endsWith('-shm')&&(!path.endsWith('-wal')||readFileSync(path).length>0)).map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex')]));
}
test('F1 actual installation mismatch refuses reopen/start without rebind or canonical mutation',async()=>{
 const root=fresh(),other=fresh();
 try{
  const c=initializeProject(root,fixtureInstallation),configPath=join(root,'bve.project.json');
  assert.deepEqual(runningInstallation(),{path:fixtureInstallation.path,commit:execFileSync('git',['rev-parse','HEAD'],{cwd:fixtureInstallation.path,encoding:'utf8'}).trim()});
  // A different real checkout identity, including the same commit, is not silently selected.
  execFileSync('git',['clone','--quiet','--shared','--no-checkout',fixtureInstallation.path,other]);
  for(const installation of [{...c.installation,commit:'8312893f1ef715a1507c3275d991b42c0dbafa1c'},{...c.installation,path:other}]){
   writeFileSync(configPath,JSON.stringify({...c,installation}));const before=canonicalSnapshot(root);
   assert.throws(()=>initializeProject(root,fixtureInstallation),/Installation mismatch/);
   assert.throws(()=>projectConfig(root),/Installation mismatch/);
   await assert.rejects(startApp(join(root,'runtime'),0,undefined,undefined,{projectRoot:root}),/Installation mismatch/);
   const report=inspection(root);assert.equal(report.installation.compatible,false);assert.deepEqual(report.installation.selected,installation);assert.deepEqual(report.installation.running,runningInstallation());
   const cli=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/bve.ts',import.meta.url)),'inspect','--root',root],{encoding:'utf8',timeout:15000});assert.equal(cli.status,0,cli.stderr);assert.equal(JSON.parse(cli.stdout).installation.compatible,false);
   assert.deepEqual(canonicalSnapshot(root),before);
  }
  writeFileSync(configPath,JSON.stringify(c));assert.deepEqual(initializeProject(root,fixtureInstallation),c);
  const app=await startApp(join(root,'runtime'),0,undefined,undefined,{projectRoot:root});try{assert.deepEqual(app.installation,c.installation);const state=await fetch(app.origin+'/api/v1/production/state').then(r=>r.json());assert.deepEqual(state.installation,c.installation);}finally{await app.close();}
 }finally{rmSync(root,{recursive:true,force:true});rmSync(other,{recursive:true,force:true});}
});
test('F1 CLI refuses a reused service with different running identity before requesting a token or mutation',async()=>{
 const root=fresh();let server:ReturnType<typeof createServer>|undefined;
 try{
  const c=initializeProject(root,fixtureInstallation),before=canonicalSnapshot(root);let reads=0,otherRequests=0;
  server=createServer((req,res)=>{if(req.url==='/api/v1/production/state'&&req.method==='GET'){reads++;res.setHeader('content-type','application/json');res.end(JSON.stringify({projectId:c.projectId,runtimeId:c.runtimeId,installation:{...c.installation,commit:'8312893f1ef715a1507c3275d991b42c0dbafa1c'},jobs:[],receipts:[]}));}else{otherRequests++;res.statusCode=500;res.end('{}');}});
  server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address!=='string');
  writeFileSync(join(root,'.bve-service.json'),JSON.stringify({origin:'http://127.0.0.1:'+address.port,projectId:c.projectId,runtimeId:c.runtimeId,owner:'authored-service',pid:process.pid}));
  await assert.rejects(promisify(execFile)(process.execPath,[fileURLToPath(new URL('../scripts/bve.ts',import.meta.url)),'intake','authored-job','--root',root],{timeout:20000}),/Installation mismatch/);
  assert.equal(reads,1);assert.equal(otherRequests,0);assert.deepEqual(canonicalSnapshot(root),before);
 }finally{if(server)await new Promise<void>((resolve,reject)=>server!.close(error=>error?reject(error):resolve()));rmSync(root,{recursive:true,force:true});}
});
test('F2 pinned missing/changed/unsafe instructions are diagnosed read-only and refuse resume/start',async()=>{
 const root=fresh();try{
  const c=initializeProject(root,fixtureInstallation),role=join(root,'instructions/butler.md'),original=readFileSync(role);
  writeFileSync(join(root,'instructions/local.md'),'Supported local addition');writeFileSync(join(root,'instructions/additional-role.md'),'Local extension');writeFileSync(join(root,'AGENTS.md'),'User-owned project guidance');
  assert.equal(inspection(root).instructions.compatible,true);assert.deepEqual(initializeProject(root,fixtureInstallation),c);
  const cases=[{status:'changed',change:()=>writeFileSync(role,'Changed role bytes'),restore:()=>writeFileSync(role,original)}, {status:'missing',change:()=>rmSync(role),restore:()=>writeFileSync(role,original)}, {status:'unsafe',change:()=>{rmSync(role);mkdirSync(role);},restore:()=>{rmSync(role,{recursive:true});writeFileSync(role,original);}}];
  for(const check of cases){
   check.change();const before=canonicalSnapshot(root),report=inspection(root);assert.equal(report.instructions.compatible,false);assert.equal(report.instructions.files.find(f=>f.path==='instructions/butler.md')?.status,check.status);
   assert.throws(()=>initializeProject(root,fixtureInstallation),/Pinned instructions incompatible/);
   await assert.rejects(startApp(join(root,'runtime'),0,undefined,undefined,{projectRoot:root}),/Pinned instructions incompatible/);
   const cli=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/bve.ts',import.meta.url)),'inspect','--root',root],{encoding:'utf8',timeout:15000});assert.equal(cli.status,0,cli.stderr);assert.equal(JSON.parse(cli.stdout).instructions.files.find((f:{path:string})=>f.path==='instructions/butler.md').status,check.status);
   assert.deepEqual(canonicalSnapshot(root),before);assert.equal(readFileSync(join(root,'AGENTS.md'),'utf8'),'User-owned project guidance');assert.equal(readFileSync(join(root,'instructions/local.md'),'utf8'),'Supported local addition');assert.equal(readFileSync(join(root,'instructions/additional-role.md'),'utf8'),'Local extension');check.restore();
  }
  // Reproduce the review's simultaneous changed Butler + missing Generator case.
  writeFileSync(role,'Changed role bytes');rmSync(join(root,'instructions/generator.md'));const report=inspection(root);assert.equal(report.instructions.files.filter(f=>f.status!=='ok').length,2);assert.throws(()=>projectConfig(root),/Pinned instructions incompatible/);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('C01 exact v2 complete inventory, local spelling conflict, and v1 configuration refusal are read-only',async()=>{
 const root=fresh();try{
  const c=initializeProject(root,fixtureInstallation);assert.equal(c.formatVersion,2);assert.equal(c.featureContract,'bve-vos-continuation-v1');assert.equal(c.instructionSetVersion,'visual-os-ops-v2');
  const manifest=JSON.parse(readFileSync(new URL('../instructions/manifest.json',import.meta.url),'utf8'));
  assert.equal(inspection(root).instructions.files.length,9);
  for(const f of [...manifest.files,{path:'instructions/manifest.json'}]){
   const path=join(root,f.path),bytes=readFileSync(path);assert.deepEqual(bytes,readFileSync(new URL('../'+f.path,import.meta.url)));
   if(f.sha256)assert.equal(createHash('sha256').update(bytes).digest('hex'),f.sha256);
   for(const mode of ['missing','changed']){if(mode==='missing')rmSync(path);else writeFileSync(path,'Authored changed pin');const before=canonicalSnapshot(root);assert.throws(()=>projectConfig(root),/Pinned instructions/);assert.deepEqual(canonicalSnapshot(root),before);writeFileSync(path,bytes);}
  }
  writeFileSync(join(root,'instructions.local.md'),'Legacy local additions');assert.deepEqual(initializeProject(root,fixtureInstallation),c);
  writeFileSync(join(root,'instructions/local.md'),'Conflicting modern local additions');const local=inspection(root).instructions.localAdditions;assert.equal(local.conflict,true);assert.throws(()=>projectConfig(root),/Conflicting/);assert.equal(readFileSync(join(root,'instructions.local.md'),'utf8'),'Legacy local additions');
  writeFileSync(join(root,'instructions/local.md'),'Legacy local additions');assert.deepEqual(initializeProject(root,fixtureInstallation),c);
  writeFileSync(join(root,'bve.project.json'),JSON.stringify({...c,formatVersion:1,featureContract:'bve-vos-local-intake-v1',instructionSetVersion:'visual-os-ops-v1',capabilities:{capture:'deferred',continuation:'deferred',generation:'unverified'}}));const before=canonicalSnapshot(root);
  assert.throws(()=>initializeProject(root,fixtureInstallation),/Unsupported/);await assert.rejects(startApp(join(root,'runtime'),0,undefined,undefined,{projectRoot:root}),/Unsupported/);assert.equal(inspection(root).compatibility?.compatible,false);assert.deepEqual(canonicalSnapshot(root),before);
 }finally{rmSync(root,{recursive:true,force:true});}
});
