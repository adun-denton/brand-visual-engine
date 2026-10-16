import {createHash} from 'node:crypto';
import type {Continuation} from './continuation.ts';
import {inspectRaster,type ImageInfo,type RasterFacts} from './assets.ts';
import {record,integer,string,list} from './validation.ts';
import type {NodePacket,VersionRef,DesignArtifact} from '../kernel/contracts.ts';
import type {ReviewSubmission} from '../modules/website/review-contracts.ts';
import type {Finalization,CaptureEvidence} from '../modules/website/continuation-contracts.ts';
import {reference,canonical,digest} from '../kernel/packets.ts';
import {revalidatePacket,writePort,type GateEnvironment} from '../kernel/gate.ts';
import {verificationChecks} from '../kernel/continuation-gate.ts';
import {moduleExists,validateArtifact} from '../modules/registry.ts';
import {exactRef,hash} from '../modules/website/exploration-contracts.ts';
const MAX=64*1024*1024,MAX_JSON=90*1024*1024;
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
export type PortableBundle={format:'bve-continuation-bundle';version:1;submission:VersionRef;receipt:VersionRef;files:{path:string;bytes:number;sha256:string}[];content:Record<string,string>};
export function exportContinuation(service:Continuation,submission:VersionRef,receipt:VersionRef):PortableBundle{
 const status=service.status(submission),f=service.read<Finalization>(receipt,'review-finalization');if(f.payload.state.status!=='verified'||canonical(f.payload.state.submission)!==canonical(submission)||!Object.values(verificationChecks(service.w.kernel.environment(),service.w.kernel.get(submission).projectId!,submission,f.payload.state.capture)).every(Boolean))throw Error('Completed export requires available exact verified capture/original closure');
 const records=new Map<string,NodePacket<unknown>>(),queue=[submission,receipt];while(queue.length){const ref=queue.shift()!,key=ref.id+':'+ref.version;if(records.has(key))continue;if(records.size>=512)throw Error('Portable closure exceeds 512 records');const p=service.w.kernel.get(ref);records.set(key,p);queue.push(...p.dependencies,...p.contextRefs);}
 const files:PortableBundle['files']=[],content:Record<string,string>={},images=new Set<string>();let total=0;
 const add=(path:string,b:Buffer)=>{total+=b.length;if(total>MAX||files.length>=1024)throw Error('Portable export exceeds 64 MiB / 1024 files');files.push({path,bytes:b.length,sha256:sha(b)});content[path]=b.toString('base64');};
 for(const [key,p] of [...records].sort(([a],[b])=>a.localeCompare(b))){add('records/'+key.replace(':','_')+'.json',Buffer.from(JSON.stringify(p)));for(const a of p.assets)images.add(a.id);const s=(p.payload as DesignArtifact<CaptureEvidence>).state;if((p.payload as {kind?:string}).kind==='review-capture'&&s.image)images.add(s.image.id);}
 for(const id of [...images].sort())add('media/'+id,service.w.assets.read(id));
 const bundle:PortableBundle={format:'bve-continuation-bundle',version:1,submission,receipt,files,content};if(Buffer.byteLength(JSON.stringify(bundle))>MAX_JSON)throw Error('Portable JSON exceeds 90 MiB');return bundle;
}
/** Fresh-client, read-only inspection. This does not import records or execute bundle text. */
export async function inspectContinuationBundle(input:unknown,expectedLocator?:unknown){
 if(Buffer.byteLength(JSON.stringify(input))>MAX_JSON)throw Error('Portable JSON exceeds 90 MiB');const r=record(input,['format','version','submission','receipt','files','content']);if(r['format']!=='bve-continuation-bundle'||r['version']!==1)throw Error('Unsupported portable schema');
 const submission=exactRef(r['submission']),receipt=exactRef(r['receipt']),entries=list(r['files'],x=>{const f=record(x,['path','bytes','sha256']),path=string(f['path'],220);if(!/^(records\/[A-Za-z0-9_-]+\.json|media\/[a-f0-9]{64})$/.test(path))throw Error('Unsafe portable path');return {path,bytes:integer(f['bytes'],MAX),sha256:hash(f['sha256'])};},1024),content=record(r['content'],entries.map(e=>e.path));
 if(!entries.length||new Set(entries.map(e=>e.path)).size!==entries.length||Object.keys(content).length!==entries.length)throw Error('Incomplete/duplicate portable file inventory');
 const records=new Map<string,NodePacket<unknown>>(),facts=new Map<string,RasterFacts>();let total=0;
 for(const f of entries){const encoded=content[f.path];if(typeof encoded!=='string'||encoded.length>Math.ceil(MAX/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))throw Error('Invalid portable bytes');const b=Buffer.from(encoded,'base64');if(b.toString('base64')!==encoded||b.length!==f.bytes||sha(b)!==f.sha256)throw Error('Portable hash/size mismatch');total+=b.length;if(total>MAX)throw Error('Portable bytes exceed 64 MiB');
  if(f.path.startsWith('media/')){const image=await inspectRaster(b);if(image.image.id!==f.path.slice(6))throw Error('Portable media identity mismatch');facts.set(image.image.id,image);}
  else{if(!Buffer.from(b.toString('utf8')).equals(b))throw Error('Invalid UTF-8 record');const p=JSON.parse(b.toString('utf8')) as NodePacket<unknown>,{integrity,...body}=p;if(digest(body)!==integrity||f.path!=='records/'+p.id+'_'+p.version+'.json'||records.has(p.id+':'+p.version))throw Error('Portable record identity/integrity mismatch');records.set(p.id+':'+p.version,p);}
 }
 const versions=new Map<string,number>();for(const p of records.values())versions.set(p.id,Math.max(p.version,versions.get(p.id)??0));
 const env:GateEnvironment={lookup:r=>records.get(r.id+':'+r.version)??null,currentVersion:id=>versions.get(id)??null,assetExists:(id,h)=>id===h&&facts.has(id),rasterFacts:image=>canonical(facts.get(image.id)?.image)===canonical(image)?facts.get(image.id)!:null,imageMatches:image=>canonical(facts.get(image.id)?.image)===canonical(image),moduleExists,validateArtifact,grantedPermissions:['read','write','accept']};
 const sub=env.lookup(submission) as NodePacket<DesignArtifact<ReviewSubmission>>|null,f=env.lookup(receipt) as NodePacket<DesignArtifact<Finalization>>|null;if(!sub||sub.payload.kind!=='production-review-submission'||!f||f.payload.kind!=='review-finalization'||f.projectId!==sub.projectId||canonical(f.payload.state.submission)!==canonical(submission)||f.payload.state.status!=='verified')throw Error('Portable selected identity mismatch');
 if(expectedLocator!==undefined){const e=record(expectedLocator,['format','version','status','project','workUnit','iteration','submission','receipt','capture','localService','read','issues','authority']),s=record(e['submission'],['ref','integrity','contentHash']),frozen=record(e['receipt'],['ref','integrity']);if(e['format']!=='bve-continuation-locator'||e['version']!==1||e['status']!=='complete'||canonical([exactRef(s['ref']),hash(s['integrity']),exactRef(frozen['ref']),hash(frozen['integrity'])])!==canonical([submission,sub.integrity,receipt,f.integrity]))throw Error('Portable bundle does not match expected locator');}
 const reachable=new Set<string>(),pending=[submission,receipt],requiredImages=new Set<string>();while(pending.length){const ref=pending.shift()!,k=ref.id+':'+ref.version;if(reachable.has(k))continue;const p=records.get(k);if(!p)throw Error('Portable dependency missing');reachable.add(k);pending.push(...p.dependencies,...p.contextRefs);for(const a of p.assets)requiredImages.add(a.id);if((p.payload as {kind?:string}).kind==='review-capture'){const c=(p.payload as DesignArtifact<CaptureEvidence>).state;if(c.image)requiredImages.add(c.image.id);}}
 if(reachable.size!==records.size||requiredImages.size!==facts.size||[...facts.keys()].some(id=>!requiredImages.has(id)))throw Error('Portable bundle contains unrelated records/media');
 for(const p of records.values()){for(const ref of [...p.dependencies,...p.contextRefs])if(!env.lookup(ref))throw Error('Portable dependency missing');revalidatePacket(p,writePort(p.type),env);}
 const checks=verificationChecks(env,sub.projectId!,submission,f.payload.state.capture);if(!Object.values(checks).every(Boolean))throw Error('Portable closure incomplete');
 const cap=env.lookup(f.payload.state.capture!) as NodePacket<DesignArtifact<CaptureEvidence>>;if(expectedLocator!==undefined){const e=expectedLocator as {capture?:{ref:VersionRef;integrity:string;image:ImageInfo}};if(!e.capture||canonical([e.capture.ref,e.capture.integrity,e.capture.image])!==canonical([reference(cap),cap.integrity,cap.payload.state.image]))throw Error('Portable capture does not match expected locator');}if(!cap.payload.state.image||!facts.has(cap.payload.state.image.id))throw Error('Portable capture missing');
 return {valid:true,untrustedSnapshot:true,imported:false,submission,submissionIntegrity:sub.integrity,receipt,receiptIntegrity:f.integrity,capture:f.payload.state.capture,recordCount:records.size,fileCount:entries.length,bytes:total,originals:sub.payload.state.scope.proposals.map(p=>({candidate:p.candidate,image:p.image})),captureImage:cap.payload.state.image,generationCalls:0,acceptances:0};
}
