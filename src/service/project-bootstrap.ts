import {DatabaseSync} from 'node:sqlite';
import { existsSync, readdirSync, mkdirSync, readFileSync, writeFileSync, renameSync, openSync, fsyncSync, closeSync, lstatSync } from 'node:fs';
import { resolve, join, dirname, isAbsolute, relative } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { Workspace } from './workspace.ts';
import {RuntimeOwner,assertNoLinks} from './runtime-owner.ts';
import {record,id,string} from './validation.ts';
import {exactRef} from '../modules/website/exploration-contracts.ts';
import {packet,reference,canonical,digest} from '../kernel/packets.ts';
import {localField,resolveContext} from '../kernel/context.ts';
import type {VersionRef,ModuleProject} from '../kernel/contracts.ts';
export const FEATURE_CONTRACT='bve-vos-local-intake-v1';
export const INSTRUCTION_VERSION='visual-os-ops-v1';
export interface ProjectConfig {
 formatVersion:1; featureContract:typeof FEATURE_CONTRACT; projectId:string; runtimeId:string;
 locations:{runtime:'runtime';staging:'staging';references:'references';exports:'exports';backups:'backups';instructions:'instructions'};
 installation:{path:string;commit:string}; instructionSetVersion:typeof INSTRUCTION_VERSION;
 initialWorkUnit:VersionRef; capabilities:{capture:'deferred';continuation:'deferred';generation:'unverified'};
}
/** Atomic replacement; leftovers from an interrupted rename are disposable, never identity. */
function atomicFile(path:string,content:string|Buffer) {
 assertNoLinks(path);const temp=path+'.'+randomUUID()+'.tmp';const fd=openSync(temp,'wx',0o600);
 try {writeFileSync(fd,content);fsyncSync(fd);}finally{closeSync(fd);}renameSync(temp,path);
 if(process.platform!=='win32'){const dir=openSync(dirname(path),'r');try{fsyncSync(dir);}finally{closeSync(dir);}}
}
export function atomicJson(path:string,data:unknown) {atomicFile(path,JSON.stringify(data,null,2)+'\n');}
export function boundedJson(path:string,max=65536):unknown {
 assertNoLinks(path);const st=lstatSync(path);if(!st.isFile()||st.nlink!==1||st.size>max)throw Error('Unsafe or oversized JSON file');return JSON.parse(readFileSync(path,'utf8'));
}
export function parseProjectConfig(input:unknown):ProjectConfig {
 const r=record(input,['formatVersion','featureContract','projectId','runtimeId','locations','installation','instructionSetVersion','initialWorkUnit','capabilities']);
 if(r['formatVersion']!==1||r['featureContract']!==FEATURE_CONTRACT||r['instructionSetVersion']!==INSTRUCTION_VERSION)throw Error('Unsupported project/instruction compatibility; adoption/update required');
 const locations={runtime:'runtime',staging:'staging',references:'references',exports:'exports',backups:'backups',instructions:'instructions'} as const;
 if(canonical(r['locations'])!==canonical(locations))throw Error('Unsupported project locations; adoption required');
 const capabilities={capture:'deferred',continuation:'deferred',generation:'unverified'} as const;
 if(canonical(r['capabilities'])!==canonical(capabilities))throw Error('Unsupported capability claims');
 const install=record(r['installation'],['path','commit']),path=string(install['path'],4096),commit=string(install['commit'],40);
 if(!isAbsolute(path)||!/^[a-f0-9]{40}$/.test(commit))throw Error('Invalid installation identity');
 return {formatVersion:1,featureContract:FEATURE_CONTRACT,projectId:id(r['projectId']),runtimeId:id(r['runtimeId']),locations,installation:{path,commit},instructionSetVersion:INSTRUCTION_VERSION,initialWorkUnit:exactRef(r['initialWorkUnit']),capabilities};
}
function outsideSourceControl(root:string) {
 for(let path=resolve(root);;path=dirname(path)){
  if(existsSync(join(path,'.git')))throw Error('Private project must be outside source control');
  if(dirname(path)===path)break;
 }
}
export function projectConfig(root:string):ProjectConfig {
 outsideSourceControl(root);assertNoLinks(root);const c=parseProjectConfig(boundedJson(join(root,'bve.project.json')));
 const runtime=boundedJson(join(root,c.locations.runtime,'bve.runtime.json'));
 if(canonical(runtime)!==canonical({version:1,projectId:c.projectId,runtimeId:c.runtimeId}))throw Error('Inconsistent project/runtime identity');
 for(const location of Object.values(c.locations))assertNoLinks(join(root,location));
 const database=join(root,c.locations.runtime,'kernel.sqlite');assertNoLinks(database);
 if(!existsSync(database)||!lstatSync(database).isFile()||lstatSync(database).nlink!==1)throw Error('Missing or redirected authoritative runtime; restore a complete closed project');
 const db=new DatabaseSync(database,{readOnly:true});
 try{
  if(db.prepare('PRAGMA user_version').get()?.['user_version']!==1)throw Error('Unsupported authoritative runtime schema');
  for(const [identity,kind] of [[c.projectId,'module-project'],[c.initialWorkUnit.id,'page-work-unit']] as const){
   const row=kind==='module-project'?db.prepare('SELECT body FROM kernel_packets WHERE id=? ORDER BY version DESC LIMIT 1').get(identity):db.prepare('SELECT body FROM kernel_packets WHERE id=? AND version=?').get(identity,c.initialWorkUnit.version);
   if(!row)throw Error('Inconsistent project/page identity in authoritative runtime');
   const p=JSON.parse(String(row['body'])) as import('../kernel/contracts.ts').NodePacket<{kind?:string}>;const {integrity,...body}=p;
   if(digest(body)!==integrity||p.id!==identity||p.projectId!==c.projectId||(kind==='module-project'?p.type!=='module-project':p.type!=='work-record'||p.payload.kind!==kind))throw Error('Inconsistent project/page integrity in authoritative runtime');
  }
 }finally{db.close();}

 const from=relative(c.installation.path,resolve(root));if(from===''||!from.startsWith('..')&&!isAbsolute(from))throw Error('Private project must be outside software installation');return c;
}
export function verifyProject(w:Workspace,c:ProjectConfig) {
 w.owner.assert();w.project(c.projectId);
 const unit=w.kernel.get<{kind:string}>(c.initialWorkUnit);
 if(unit.projectId!==c.projectId||unit.payload.kind!=='page-work-unit')throw Error('Inconsistent initial page identity');
}
export function initializeProject(root:string,installation:{path:string;commit:string},title='Untitled project', interrupt?:(phase:'identity'|'runtime')=>void):ProjectConfig {
 root=resolve(root);outsideSourceControl(root);assertNoLinks(root);installation={path:resolve(installation.path),commit:installation.commit};string(title,100);
 const from=relative(installation.path,root);if(from===''||!from.startsWith('..')&&!isAbsolute(from))throw Error('Private project must be outside software installation');
 const configPath=join(root,'bve.project.json'),seedPath=join(root,'.bve-init.json');
 const preflight=()=>{if(existsSync(root)&&readdirSync(root).some(n=>!/^\.bve-init\.json\.[a-f0-9-]+\.tmp$/.test(n))&&!existsSync(configPath)&&!existsSync(seedPath))throw Error('Nonempty unregistered root: adoption required');};preflight();
 mkdirSync(root,{recursive:true,mode:0o700});
 // Root lock protects identity/config writes; runtime lock below also excludes legacy launch.
 const owner=new RuntimeOwner(root);let w:Workspace|undefined;
 try {
  if(existsSync(configPath)){
   const c=projectConfig(root);w=new Workspace(join(root,c.locations.runtime));verifyProject(w,c);return c;
  }
  let seed:{config:ProjectConfig;title:string};
  if(existsSync(seedPath)){
   const s=record(boundedJson(seedPath),['config','title']);seed={config:parseProjectConfig(s['config']),title:string(s['title'],100)};
  }else{
   if(readdirSync(root).some(n=>!/^\.bve-init\.json\.[a-f0-9-]+\.tmp$/.test(n)))throw Error('Concurrent unrelated project contents; adoption required');
   seed={config:parseProjectConfig({formatVersion:1,featureContract:FEATURE_CONTRACT,projectId:'website-'+randomUUID(),runtimeId:'runtime-'+randomUUID(),locations:{runtime:'runtime',staging:'staging',references:'references',exports:'exports',backups:'backups',instructions:'instructions'},installation,instructionSetVersion:INSTRUCTION_VERSION,initialWorkUnit:{id:'page-work-unit-'+randomUUID(),version:1,freshness:'pinned'},capabilities:{capture:'deferred',continuation:'deferred',generation:'unverified'}}),title};
   atomicJson(seedPath,seed);
  }
  interrupt?.('identity');const c=seed.config;
  for(const path of Object.values(c.locations)){assertNoLinks(join(root,path));mkdirSync(join(root,path),{recursive:true,mode:0o700});}
  const runtime=join(root,c.locations.runtime),marker=join(runtime,'bve.runtime.json'),identity={version:1,projectId:c.projectId,runtimeId:c.runtimeId};
  // Acquire before inspecting/writing marker or opening any authoritative store.
  const runtimeOwner=new RuntimeOwner(runtime);
  try{
   if(existsSync(marker)){if(canonical(boundedJson(marker))!==canonical(identity))throw Error('Inconsistent runtime identity');}
   else {if(readdirSync(runtime).some(name=>!/^bve\.runtime\.json\.[a-f0-9-]+\.tmp$/.test(name)))throw Error('Nonempty unregistered runtime: adoption required');atomicJson(marker,identity);}
   w=new Workspace(runtime,{},runtimeOwner);
  }catch(e){runtimeOwner.close();throw e;}
  const project=w.kernel.lookup({id:c.projectId,version:1,freshness:'pinned'}),unit=w.kernel.lookup(c.initialWorkUnit);
  if(!project&&!unit){
   if(w.kernel.latestPackets().length)throw Error('Unregistered runtime cannot be adopted');
   const local={title:localField({hasOverride:true,override:seed.title})};
   const p=packet<ModuleProject>({type:'module-project',id:c.projectId,projectId:c.projectId,payload:{moduleId:'website',mode:'freeroam',visualOSRef:null,localContext:local,resolvedContext:resolveContext('freeroam',null,local,['title']),artifactRefs:[]},provenance:{actor:'local-operator',source:'Explicit project bootstrap',previous:null}});
   const u=packet({type:'work-record',id:c.initialWorkUnit.id,projectId:c.projectId,payload:{moduleId:'website',kind:'page-work-unit',scope:'page-exploration',lockedValues:{},state:{version:1,pageType:'homepage',label:'Homepage',source:'Explicit project bootstrap'}},provenance:{actor:'local-operator',source:'Explicit project bootstrap',previous:null}});
   w.kernel.putMany([p,u]);
  }else if(!project||!unit)throw Error('Partial authoritative bootstrap identity refused');
  verifyProject(w,c);interrupt?.('runtime');
  // Bundled instructions are pinned, independently hash-checked, never fetched as latest.
  const manifest=boundedJson(join(c.installation.path,'instructions/manifest.json')) as {instructionSetVersion:string;files:{path:string;sha256:string}[]};
  if(manifest.instructionSetVersion!==INSTRUCTION_VERSION)throw Error('Installed instructions incompatible');
  for(const f of manifest.files){
   if(!/^instructions\/[A-Za-z0-9.-]+$/.test(f.path))throw Error('Invalid installed instruction path');
   const bytes=readFileSync(join(c.installation.path,f.path));if(createHash('sha256').update(bytes).digest('hex')!==f.sha256)throw Error('Installed instruction integrity mismatch');
   const destination=join(root,f.path);if(!existsSync(destination))atomicFile(destination,bytes);
   else if(!readFileSync(destination).equals(bytes))throw Error('Pinned instruction changed; preserve additions in instructions/local.md');
  }
  const agents=join(root,'AGENTS.md');if(!existsSync(agents))atomicFile(agents,readFileSync(join(c.installation.path,'instructions/project-AGENTS.template.md')));
  atomicJson(configPath,c);return c;
 }finally{w?.close();owner.close();}
}
export function inspection(root:string) {
 const c=projectConfig(root);
 return {config:c,environment:{node:process.version,platform:process.platform,architecture:process.arch,supportedNode:/^v24\./.test(process.version)&&Number(process.versions.node.split('.')[1])>=19,featureContract:FEATURE_CONTRACT,nativeGeneration:'unverified',capture:'deferred',continuation:'deferred',generationCalls:0}};
}

/** Read-only inspection never opens an application writer, recovers jobs or changes settings. */
export function inspectRecords(root:string) {
 const c=projectConfig(root),path=join(root,c.locations.runtime,'kernel.sqlite');assertNoLinks(path);
 const db=new DatabaseSync(path,{readOnly:true});
 try{
  const rows=db.prepare('SELECT body FROM kernel_packets WHERE (id,version) IN (SELECT id,MAX(version) FROM kernel_packets GROUP BY id) ORDER BY id').all();
  if(rows.length>4096)throw Error('Inspection inventory limit exceeded');
  const packets=rows.map(row=>{const p=JSON.parse(String(row['body'])) as import('../kernel/contracts.ts').NodePacket<unknown>;const {integrity,...body}=p;if(digest(body)!==integrity)throw Error('Inspection integrity mismatch');return p;});
  if(!packets.some(p=>p.id===c.projectId&&p.type==='module-project')||!packets.some(p=>p.id===c.initialWorkUnit.id&&p.projectId===c.projectId))throw Error('Inspection project/page identity mismatch');
  const own=packets.filter(p=>p.projectId===c.projectId),kind=(k:string)=>own.filter(p=>(p.payload as {kind?:string}).kind===k);
  return {projectId:c.projectId,runtimeId:c.runtimeId,jobs:kind('production-job'),receipts:kind('production-receipt'),iterations:kind('production-iteration')};
 }finally{db.close();}
}
