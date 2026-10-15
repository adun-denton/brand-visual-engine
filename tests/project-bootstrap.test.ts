import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,mkdirSync,existsSync,symlinkSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync,spawn} from 'node:child_process';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {initializeProject,projectConfig} from '../src/service/project-bootstrap.ts';
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
  writeFileSync(join(root,'bve.project.json'),JSON.stringify({...c,formatVersion:2}));assert.throws(()=>initializeProject(root,fixtureInstallation),/Unsupported/);assert.deepEqual(readFileSync(join(root,'runtime/kernel.sqlite')),kernel);
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
  assert.equal(validate(c),true);assert.equal(validate({...c,formatVersion:2}),false);assert.equal(validate({...c,extra:true}),false);
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
  const {fixturePreparation,authoredOriginal,stageDelivery}=await import('../scripts/production-fixture.ts');
  const request=fixturePreparation({project:()=>({id:c.projectId,version:1})} as unknown as Workspace,c),requestPath=join(root,'references/request.json');writeFileSync(requestPath,JSON.stringify(request));
  const prepared=command(['prepare',requestPath]);assert.equal(command(['jobs']).length,3);await stageDelivery(root,prepared.jobs[0],await authoredOriginal());assert.equal(command(['intake',prepared.jobs[0].id]).payload.state.disposition,'ready');assert.equal(command(['receipts']).length,1);assert.equal(command(['inspect']).state.projectId,c.projectId);
  const denied=spawnSync(process.execPath,[fileURLToPath(cli),'init','--root',root],{encoding:'utf8',timeout:10000});assert.notEqual(denied.status,0);assert.match(denied.stderr,/owning writer/);
  child.kill('SIGTERM');await once(child,'exit');child=undefined;assert.equal(command(['inspect']).state.jobs.length,3);assert.equal(command(['receipts']).length,1);
 }finally{if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await once(child,'exit');}rmSync(root,{recursive:true,force:true});}
});
