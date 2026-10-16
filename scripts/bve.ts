import {resolve,join} from 'node:path';
import {existsSync,rmSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {initializeProject,projectConfig,inspection,boundedJson,atomicJson,inspectRecords,runningInstallation,assertInstallation} from '../src/service/project-bootstrap.ts';
import {startApp} from '../src/service/server.ts';
import {record,string} from '../src/service/validation.ts';
const args=process.argv.slice(2),action=args.shift(),rootFlag=args.indexOf('--root');
if(rootFlag<0||!args[rootFlag+1])throw Error('Usage: npm run bve -- init|inspect|start|prepare|jobs|intake|receipts|cancel --root <explicit-private-root> [argument]');
const root=resolve(args[rootFlag+1]!);args.splice(rootFlag,2);
const discovery=join(root,'.bve-service.json');
if(action==='init'){
 const {path,commit}=runningInstallation();
 console.log(JSON.stringify(initializeProject(root,{path,commit},args[0]??'Untitled project'),null,2));
}else if(action==='inspect'){
 console.log(JSON.stringify({...inspection(root),state:inspectRecords(root)},null,2));
}else{
 const c=projectConfig(root);
 if(['jobs','receipts'].includes(action??'')&&!existsSync(discovery)){
  const state=inspectRecords(root);console.log(JSON.stringify(action==='jobs'?state.jobs:state.receipts,null,2));
 }else if(action==='start'){
  const port=Number(args[0]??0);if(!Number.isInteger(port)||port<0||port>65535)throw Error('Invalid loopback port');
  const app=await startApp(join(root,c.locations.runtime),port,undefined,undefined,{projectRoot:root}),owner=randomUUID();
  atomicJson(discovery,{origin:app.origin,projectId:c.projectId,runtimeId:c.runtimeId,owner,pid:process.pid});
  console.log(JSON.stringify({url:app.origin,projectId:c.projectId,runtimeId:c.runtimeId,installation:app.installation,selectedInstallation:c.installation,instructionSetVersion:c.instructionSetVersion,generation:'unverified',calls:0},null,2));
  for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{void app.close().then(()=>{if(existsSync(discovery)&&(boundedJson(discovery) as {owner?:string}).owner===owner)rmSync(discovery);process.exit(0);});});
 }else{
  let local:Awaited<ReturnType<typeof startApp>>|undefined;
  try{
   let origin:string;
   if(existsSync(discovery)){
    const d=record(boundedJson(discovery),['origin','projectId','runtimeId','owner','pid']);origin=string(d['origin'],200);
    if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)||d['projectId']!==c.projectId||d['runtimeId']!==c.runtimeId)throw Error('Invalid local service discovery');
    // An unreachable saved owner is explicit evidence, never permission to steal its runtime.
   }else{local=await startApp(join(root,c.locations.runtime),0,undefined,undefined,{projectRoot:root});origin=local.origin;}
   const request=async(path:string,input?:unknown)=>{
    let headers:Record<string,string>={};
    if(input!==undefined){const session=await fetch(origin+'/api/v1/visual/session',{signal:AbortSignal.timeout(5000)}).then(r=>r.json()) as {token:string};headers={origin,'content-type':'application/json','x-bve-token':session.token};}
    const res=await fetch(origin+path,{method:input===undefined?'GET':'POST',headers,...(input===undefined?{}:{body:JSON.stringify(input)}),signal:AbortSignal.timeout(15000)});const result=await res.json();if(!res.ok)throw Error(JSON.stringify(result));return result;
   };
   const state=await request('/api/v1/production/state') as {projectId:string;runtimeId:string;installation:{path:string;commit:string};jobs:unknown;receipts:unknown};
   if(state.projectId!==c.projectId||state.runtimeId!==c.runtimeId)throw Error('Local service identity mismatch');
   assertInstallation(c.installation,state.installation);assertInstallation(runningInstallation(),state.installation);
   let output:unknown;
   if(action==='jobs')output=state.jobs;
   else if(action==='receipts')output=state.receipts;
   else if(action==='prepare')output=await request('/api/v1/production/prepare',boundedJson(resolve(args[0]??'')));
   else if(action==='intake')output=await request('/api/v1/production/intake',{jobId:args[0]});
   else if(action==='cancel')output=await request('/api/v1/production/cancel',{iteration:JSON.parse(args[0]??'null')});
   else throw Error('Unknown project operation');
   console.log(JSON.stringify(output,null,2));
  }catch(error){
   if(!local&&['jobs','receipts'].includes(action??'')){
    const state=inspectRecords(root);console.log(JSON.stringify(action==='jobs'?state.jobs:state.receipts,null,2));
   }else throw error;
  }finally{await local?.close();}
 }
}
