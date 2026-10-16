import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import { existsSync, readdirSync, mkdirSync, readFileSync, writeFileSync, renameSync, openSync, fsyncSync, closeSync, lstatSync, realpathSync } from 'node:fs';
import { resolve, join, dirname, isAbsolute, relative } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { Workspace } from './workspace.ts';
import {RuntimeOwner,assertNoLinks} from './runtime-owner.ts';
import {record,id,string} from './validation.ts';
import {exactRef} from '../modules/website/exploration-contracts.ts';
import {packet,reference,canonical,digest} from '../kernel/packets.ts';
import {localField,resolveContext} from '../kernel/context.ts';
import type {VersionRef,ModuleProject} from '../kernel/contracts.ts';
export const FEATURE_CONTRACT='bve-vos-continuation-v1';
export const INSTRUCTION_VERSION='visual-os-ops-v2';
export interface ProjectConfig {
 formatVersion:2; featureContract:typeof FEATURE_CONTRACT; projectId:string; runtimeId:string;
 locations:{runtime:'runtime';staging:'staging';references:'references';exports:'exports';backups:'backups';instructions:'instructions'};
 installation:{path:string;commit:string}; instructionSetVersion:typeof INSTRUCTION_VERSION;
 initialWorkUnit:VersionRef; capabilities:{capture:'host-dependent';continuation:'contract-dependent';generation:'unverified'};
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
 if(r['formatVersion']!==2||r['featureContract']!==FEATURE_CONTRACT||r['instructionSetVersion']!==INSTRUCTION_VERSION)throw Error('Unsupported project/instruction compatibility; adoption/update required');
 const locations={runtime:'runtime',staging:'staging',references:'references',exports:'exports',backups:'backups',instructions:'instructions'} as const;
 if(canonical(r['locations'])!==canonical(locations))throw Error('Unsupported project locations; adoption required');
 const capabilities={capture:'host-dependent',continuation:'contract-dependent',generation:'unverified'} as const;
 if(canonical(r['capabilities'])!==canonical(capabilities))throw Error('Unsupported capability claims');
 const install=record(r['installation'],['path','commit']),path=string(install['path'],4096),commit=string(install['commit'],40);
 if(!isAbsolute(path)||!/^[a-f0-9]{40}$/.test(commit))throw Error('Invalid installation identity');
 return {formatVersion:2,featureContract:FEATURE_CONTRACT,projectId:id(r['projectId']),runtimeId:id(r['runtimeId']),locations,installation:{path,commit},instructionSetVersion:INSTRUCTION_VERSION,initialWorkUnit:exactRef(r['initialWorkUnit']),capabilities};
}
function outsideSourceControl(root:string) {
 for(let path=resolve(root);;path=dirname(path)){
  if(existsSync(join(path,'.git')))throw Error('Private project must be outside source control');
  if(dirname(path)===path)break;
 }
}
function storedProjectConfig(root:string):ProjectConfig {
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
export interface InstallationIdentity {path:string;commit:string}
/** Resolve this executing checkout, never the selected project's saved metadata. */
export function runningInstallation():InstallationIdentity {
 const path=realpathSync(resolve(import.meta.dirname,'../..'));
 const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:path,encoding:'utf8',timeout:5000}).trim();
 if(!/^[a-f0-9]{40}$/.test(commit))throw Error('Cannot resolve running installation commit');
 return {path,commit};
}
export function assertInstallation(selected:InstallationIdentity,running:InstallationIdentity) {
 // Canonicalize existing checkout paths, including Windows casing, without rebinding saved config.
 if(!selected||!running||typeof selected.path!=='string'||typeof running.path!=='string'||!isAbsolute(selected.path)||!isAbsolute(running.path)||!(/^[a-f0-9]{40}$/.test(selected.commit))||!(/^[a-f0-9]{40}$/.test(running.commit)))throw Error('Installation mismatch: missing or invalid running/selected identity');
 const identityPath=(path:string)=>{const actual=realpathSync(path);return process.platform==='win32'?actual.toLowerCase():actual;};
 if(identityPath(selected.path)!==identityPath(running.path)||selected.commit!==running.commit)throw Error('Installation mismatch: selected checkout/commit differs from running installation; use matching code and a complete closed root; migration is unsupported');
}
// Fixed inventory for visual-os-ops-v2; local additions are deliberately outside it.
const PINNED_INSTRUCTIONS=[
 {
  "path": "instructions/AGENTS.md",
  "sha256": "27f608b50b0568a315c967c9aea1658d168cfef8b73290ebc5feed684e4bb34d"
 },
 {
  "path": "instructions/project-AGENTS.template.md",
  "sha256": "b5ff70b3204b8169ba9bc48305d12b36c6e2a76d994fd4c097678618af59a13a"
 },
 {
  "path": "instructions/conductor.md",
  "sha256": "b51efae4c71a929004ebc264bd7fa5666fa69dc9707786be8068e2550c1916c2"
 },
 {
  "path": "instructions/butler.md",
  "sha256": "e20cad7e7d6a806dcc6bf59b69c2579ddae8dc844795ffcabdc69468c5de4465"
 },
 {
  "path": "instructions/generator.md",
  "sha256": "8d8f649307959cb9ada99ab3d777f088cd44aa3d91b245d9693e3f8563c92ce2"
 },
 {
  "path": "instructions/bootstrap.md",
  "sha256": "c194548e273d0319379b8184b871b9d9c0e4413b7816924bf08dbf01ac9b8335"
 },
 {
  "path": "instructions/foreman.md",
  "sha256": "e7e002f0e0c2bbb18a83594ca412344b31b3161b4f0cfcae345c9519ace8ca36"
 },
 {
  "path": "instructions/reviewer.md",
  "sha256": "31adc6dd0b60deead3fb987f8f6282d3ce329c0202c37059478fa3b44f5ed805"
 },
 {
  "path": "instructions/manifest.json",
  "sha256": "afabc7282bf8fc19bb781d6430acb8ccce76a19d09cac5b816d79564388d28c0"
 }
] as const;
function bundledInstructions() {
 const path=resolve(import.meta.dirname,'../..');
 const manifest=boundedJson(join(path,'instructions/manifest.json')) as {instructionSetVersion?:unknown;files?:unknown};
 if(createHash('sha256').update(readFileSync(join(path,'instructions/manifest.json'))).digest('hex')!==PINNED_INSTRUCTIONS.at(-1)!.sha256||manifest.instructionSetVersion!==INSTRUCTION_VERSION||canonical(manifest.files)!==canonical(PINNED_INSTRUCTIONS.slice(0,-1)))throw Error('Bundled instruction inventory incompatible');
 return PINNED_INSTRUCTIONS.map(f=>{
  const source=join(path,f.path);assertNoLinks(source);const st=lstatSync(source);
  if(!st.isFile()||st.nlink!==1||st.size>65536)throw Error('Unsafe bundled instruction');
  const bytes=readFileSync(source);if(createHash('sha256').update(bytes).digest('hex')!==f.sha256)throw Error('Bundled instruction integrity mismatch');
  return {...f,bytes};
 });
}
export function instructionCompatibility(root:string) {
 let bundleError:string|null=null;
 try{bundledInstructions();}catch(error){bundleError=String(error);}
 const files=PINNED_INSTRUCTIONS.map(f=>{
  const path=join(root,f.path);let status:'ok'|'missing'|'changed'|'unsafe'='ok';
  try{assertNoLinks(path);if(!existsSync(path))status='missing';else{const st=lstatSync(path);if(!st.isFile()||st.nlink!==1||st.size>65536)status='unsafe';else if(createHash('sha256').update(readFileSync(path)).digest('hex')!==f.sha256)status='changed';}}catch{status='unsafe';}
  return {path:f.path,status};
 });
 const localAdditions={current:existsSync(join(root,'instructions/local.md')),legacy:existsSync(join(root,'instructions.local.md')),conflict:false,issue:null as string|null};
 try{for(const p of ['instructions/local.md','instructions.local.md'])if(existsSync(join(root,p))){assertNoLinks(join(root,p));const st=lstatSync(join(root,p));if(!st.isFile()||st.nlink!==1||st.size>65536)throw Error('Unsafe local additions');}
  if(localAdditions.current&&localAdditions.legacy&&!readFileSync(join(root,'instructions/local.md')).equals(readFileSync(join(root,'instructions.local.md'))))throw Error('Conflicting instructions/local.md and legacy instructions.local.md; preserve both and resolve explicitly');
 }catch(error){localAdditions.conflict=true;localAdditions.issue=String(error);}
 return {version:INSTRUCTION_VERSION,localAdditions,compatible:!bundleError&&!localAdditions.conflict&&files.every(f=>f.status==='ok'),bundleError,files};
}
export function projectConfig(root:string):ProjectConfig {
 const c=storedProjectConfig(root);assertInstallation(c.installation,runningInstallation());
 const instructions=instructionCompatibility(root);
 if(!instructions.compatible)throw Error('Pinned instructions incompatible: '+JSON.stringify(instructions));
 return c;
}
export function verifyProject(w:Workspace,c:ProjectConfig) {
 w.owner.assert();w.project(c.projectId);
 const unit=w.kernel.get<{kind:string}>(c.initialWorkUnit);
 if(unit.projectId!==c.projectId||unit.payload.kind!=='page-work-unit')throw Error('Inconsistent initial page identity');
}
export function initializeProject(root:string,installation:{path:string;commit:string},title='Untitled project', interrupt?:(phase:'identity'|'runtime')=>void):ProjectConfig {
 root=resolve(root);outsideSourceControl(root);assertNoLinks(root);installation={path:resolve(installation.path),commit:installation.commit};string(title,100);
 assertInstallation(installation,runningInstallation());bundledInstructions();
 const from=relative(installation.path,root);if(from===''||!from.startsWith('..')&&!isAbsolute(from))throw Error('Private project must be outside software installation');
 const configPath=join(root,'bve.project.json'),seedPath=join(root,'.bve-init.json');
 const preflight=()=>{if(existsSync(root)&&readdirSync(root).some(n=>!/^\.bve-init\.json\.[a-f0-9-]+\.tmp$/.test(n))&&!existsSync(configPath)&&!existsSync(seedPath))throw Error('Nonempty unregistered root: adoption required');};preflight();
 mkdirSync(root,{recursive:true,mode:0o700});
 // Root lock protects identity/config writes; runtime lock below also excludes legacy launch.
 const owner=new RuntimeOwner(root);let w:Workspace|undefined;
 try {
  if(existsSync(configPath)){
   const c=projectConfig(root);assertInstallation(c.installation,installation);w=new Workspace(join(root,c.locations.runtime));verifyProject(w,c);return c;
  }
  let seed:{config:ProjectConfig;title:string};
  if(existsSync(seedPath)){
   const s=record(boundedJson(seedPath),['config','title']);seed={config:parseProjectConfig(s['config']),title:string(s['title'],100)};
  }else{
   if(readdirSync(root).some(n=>!/^\.bve-init\.json\.[a-f0-9-]+\.tmp$/.test(n)))throw Error('Concurrent unrelated project contents; adoption required');
   seed={config:parseProjectConfig({formatVersion:2,featureContract:FEATURE_CONTRACT,projectId:'website-'+randomUUID(),runtimeId:'runtime-'+randomUUID(),locations:{runtime:'runtime',staging:'staging',references:'references',exports:'exports',backups:'backups',instructions:'instructions'},installation,instructionSetVersion:INSTRUCTION_VERSION,initialWorkUnit:{id:'page-work-unit-'+randomUUID(),version:1,freshness:'pinned'},capabilities:{capture:'host-dependent',continuation:'contract-dependent',generation:'unverified'}}),title};
   atomicJson(seedPath,seed);
  }
  const c=seed.config;assertInstallation(c.installation,installation);
  // A partial bootstrap may fill absent files, but must refuse altered existing pins before history writes.
  const present=instructionCompatibility(root).files.filter(f=>f.status!=='missing'&&f.status!=='ok');
  if(present.length||instructionCompatibility(root).localAdditions.conflict)throw Error('Pinned instructions incompatible: '+JSON.stringify(instructionCompatibility(root)));
  interrupt?.('identity');
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
  for(const f of bundledInstructions()){
   const destination=join(root,f.path);assertNoLinks(destination);
   if(!existsSync(destination))atomicFile(destination,f.bytes);
   else {const st=lstatSync(destination);if(!st.isFile()||st.nlink!==1||st.size>65536||!readFileSync(destination).equals(f.bytes))throw Error('Pinned instruction changed; preserve additions in instructions/local.md');}
  }
  const agents=join(root,'AGENTS.md');if(!existsSync(agents))atomicFile(agents,readFileSync(join(c.installation.path,'instructions/project-AGENTS.template.md')));
  atomicJson(configPath,c);return c;
 }finally{w?.close();owner.close();}
}
export function inspection(root:string) {
 try{return compatibleInspection(root);}catch(error){if(!String(error).includes('Unsupported project/instruction compatibility'))throw error;return {config:boundedJson(join(root,'bve.project.json')),installation:{selected:null,running:runningInstallation(),compatible:false,issue:String(error)},environment:{node:process.version,platform:process.platform,architecture:process.arch,supportedNode:true,featureContract:FEATURE_CONTRACT,nativeGeneration:'unverified',capture:'unavailable',continuation:'unavailable',generationCalls:0},compatibility:{compatible:false,issue:String(error)},instructions:instructionCompatibility(root)};}
}
function compatibleInspection(root:string) {
 const c=storedProjectConfig(root),running=runningInstallation();let installationIssue:string|null=null;
 try{assertInstallation(c.installation,running);}catch(error){installationIssue=String(error);}
 return {config:c,compatibility:{compatible:true,issue:null},installation:{selected:c.installation,running,compatible:installationIssue===null,issue:installationIssue},instructions:instructionCompatibility(root),environment:{node:process.version,platform:process.platform,architecture:process.arch,supportedNode:/^v24\./.test(process.version)&&Number(process.versions.node.split('.')[1])>=19,featureContract:FEATURE_CONTRACT,nativeGeneration:'unverified',capture:'host-dependent',continuation:'contract-dependent',generationCalls:0}};
}

/** Read-only inspection never opens an application writer, recovers jobs or changes settings. */
export function inspectRecords(root:string):{projectId:string;runtimeId:string;jobs:import('../kernel/contracts.ts').NodePacket<unknown>[];receipts:import('../kernel/contracts.ts').NodePacket<unknown>[];iterations:import('../kernel/contracts.ts').NodePacket<unknown>[];issue?:string} {
 try{return compatibleRecords(root);}catch(error){if(!String(error).includes('Unsupported project/instruction compatibility'))throw error;return {projectId:'unavailable',runtimeId:'unavailable',jobs:[],receipts:[],iterations:[],issue:String(error)};}
}
function compatibleRecords(root:string) {
 const c=storedProjectConfig(root),path=join(root,c.locations.runtime,'kernel.sqlite');assertNoLinks(path);
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
