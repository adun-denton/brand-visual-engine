import type { VersionRef } from '../../kernel/contracts.ts';
import type { ImageInfo } from '../../service/assets.ts';
import {record,string,id,choice,integer,list} from '../../service/validation.ts';
import {exactRef,hash} from './exploration-contracts.ts';
import {parseImageInfo} from './workspace-contracts.ts';
import {canonical} from '../../kernel/packets.ts';
export const productionRoles={'production-iteration':'work-record','production-job':'work-record','production-receipt':'work-record'} as const;
export type ProductionKind=keyof typeof productionRoles;
export interface Source { media:VersionRef; hash:string; candidate:VersionRef|null; }
export interface OutputPolicy { preferredWidth:number; preferredHeight:number; formats:('png'|'jpeg'|'webp')[]; maxBytes:number; maxPixels:number; maxDimension:number; }
export interface Iteration {version:1; project:VersionRef; workUnit:VersionRef; spec:VersionRef; specHash:string; jobs:string[]; status:'active'|'cancelled'|'superseded';}
export interface Job {
 version:1; project:VersionRef; workUnit:VersionRef; iteration:VersionRef; spec:VersionRef; specHash:string;
 ordinal:number; count:number; prompt:string; sources:Source[]; staging:string;
 worker:{kind:'native-generator'; configuration:string|null; imageModel:string|null}; output:OutputPolicy; intent:'one-output-no-retry';
 status:'pending'|'ready'|'failed'|'uncertain'|'historical'; receipt:VersionRef|null;
}
export interface Delivery {
 version:1; projectId:string; workUnit:VersionRef; iteration:VersionRef; jobId:string; spec:VersionRef; specHash:string; sources:Source[];
 outcome:'ready'|'failed'|'uncertain'; error:string|null;
 output:{filename:string; image:ImageInfo}|null;
 evidence:{actualPrompt:string|null; worker:string|null; imageModel:string|null; tool:string|null};
 provenance:'authored-fixture'|'reported-native-output';
}
export interface ProductionReceipt {
 version:1; job:VersionRef; delivery:Delivery|null; submissionHash:string;
 disposition:'ready'|'failed'|'uncertain'|'historical'|'incomplete'|'conflict'; message:string;
 observed:ImageInfo|null; media:VersionRef|null; candidate:VersionRef|null; membership:VersionRef|null;
 verification:'independently-decoded-original'|'no-output'; provenanceProof:'declaration-only';
}
export const same=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
export function parseSources(x:unknown):Source[]{return list(x,v=>{const r=record(v,['media','hash','candidate']);return {media:exactRef(r['media']),hash:hash(r['hash']),candidate:r['candidate']===null?null:exactRef(r['candidate'])};},32);}
const nullable=(x:unknown,max=4000)=>x===null?null:string(x,max);
export function parseOutput(x:unknown):OutputPolicy {
 const r=record(x,['preferredWidth','preferredHeight','formats','maxBytes','maxPixels','maxDimension']);
 const formats=list(r['formats'],x=>choice(x,['png','jpeg','webp'] as const),3);if(!formats.length||new Set(formats).size!==formats.length)throw Error('Output formats required');
 return {preferredWidth:integer(r['preferredWidth'],8192),preferredHeight:integer(r['preferredHeight'],8192),formats,maxBytes:integer(r['maxBytes'],8*1024*1024),maxPixels:integer(r['maxPixels'],16_000_000),maxDimension:integer(r['maxDimension'],8192)};
}
export function parseDelivery(x:unknown):Delivery {
 const r=record(x,['version','projectId','workUnit','iteration','jobId','spec','specHash','sources','outcome','error','output','evidence','provenance']);if(r['version']!==1)throw Error('Unsupported delivery version');
 const evidence=record(r['evidence'],['actualPrompt','worker','imageModel','tool']);
 let output:Delivery['output']=null;
 if(r['output']!==null){const o=record(r['output'],['filename','image']),filename=string(o['filename'],160);if(!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(filename))throw Error('Unsafe output filename');output={filename,image:parseImageInfo(o['image'])};}
 const d:Delivery={version:1,projectId:id(r['projectId']),workUnit:exactRef(r['workUnit']),iteration:exactRef(r['iteration']),jobId:id(r['jobId']),spec:exactRef(r['spec']),specHash:hash(r['specHash']),sources:parseSources(r['sources']),outcome:choice(r['outcome'],['ready','failed','uncertain']),error:nullable(r['error']),output,evidence:{actualPrompt:nullable(evidence['actualPrompt'],12000),worker:nullable(evidence['worker']),imageModel:nullable(evidence['imageModel']),tool:nullable(evidence['tool'])},provenance:choice(r['provenance'],['authored-fixture','reported-native-output'])};
 if((d.outcome==='ready')!==!!d.output||d.outcome!=='ready'&&!d.error)throw Error('Delivery outcome/output/error mismatch');return d;
}
export function parseProduction(kind:ProductionKind,x:unknown):Iteration|Job|ProductionReceipt {
 if(kind==='production-iteration'){
  const r=record(x,['version','project','workUnit','spec','specHash','jobs','status']);if(r['version']!==1)throw Error('Unsupported production version');
  const jobs=list(r['jobs'],id,6);if(!jobs.length||new Set(jobs).size!==jobs.length)throw Error('Distinct bounded jobs required');
  return {version:1,project:exactRef(r['project']),workUnit:exactRef(r['workUnit']),spec:exactRef(r['spec']),specHash:hash(r['specHash']),jobs,status:choice(r['status'],['active','cancelled','superseded'])};
 }
 if(kind==='production-job'){
  const r=record(x,['version','project','workUnit','iteration','spec','specHash','ordinal','count','prompt','sources','staging','worker','output','intent','status','receipt']);if(r['version']!==1||r['intent']!=='one-output-no-retry')throw Error('Unsupported job contract');
  const worker=record(r['worker'],['kind','configuration','imageModel']);if(worker['kind']!=='native-generator')throw Error('Unknown requested worker');
  const staging=string(r['staging'],200);if(!/^staging\/[a-zA-Z0-9_-]+$/.test(staging))throw Error('Unsafe staging location');
  const ordinal=integer(r['ordinal'],6),count=integer(r['count'],6);if(ordinal>count)throw Error('Ordinal exceeds count');
  return {version:1,project:exactRef(r['project']),workUnit:exactRef(r['workUnit']),iteration:exactRef(r['iteration']),spec:exactRef(r['spec']),specHash:hash(r['specHash']),ordinal,count,prompt:string(r['prompt'],12000),sources:parseSources(r['sources']),staging,worker:{kind:'native-generator',configuration:nullable(worker['configuration']),imageModel:nullable(worker['imageModel'])},output:parseOutput(r['output']),intent:'one-output-no-retry',status:choice(r['status'],['pending','ready','failed','uncertain','historical']),receipt:r['receipt']===null?null:exactRef(r['receipt'])};
 }
 const r=record(x,['version','job','delivery','submissionHash','disposition','message','observed','media','candidate','membership','verification','provenanceProof']);if(r['version']!==1||r['provenanceProof']!=='declaration-only')throw Error('Unsupported receipt contract');
 return {version:1,job:exactRef(r['job']),delivery:r['delivery']===null?null:parseDelivery(r['delivery']),submissionHash:hash(r['submissionHash']),disposition:choice(r['disposition'],['ready','failed','uncertain','historical','incomplete','conflict']),message:string(r['message']),observed:r['observed']===null?null:parseImageInfo(r['observed']),media:r['media']===null?null:exactRef(r['media']),candidate:r['candidate']===null?null:exactRef(r['candidate']),membership:r['membership']===null?null:exactRef(r['membership']),verification:choice(r['verification'],['independently-decoded-original','no-output']),provenanceProof:'declaration-only'};
}
export function validateProductionRecord(p:Record<string,unknown>):boolean {
 if(!Object.hasOwn(productionRoles,String(p['kind'])))return false;
 if(p['moduleId']!=='website'||p['scope']!=='production-intake'||!same(p['lockedValues'],{}))throw Error('Production record envelope');parseProduction(p['kind'] as ProductionKind,p['state']);return true;
}

export interface ProductionProjection {
 ref:VersionRef; status:Iteration['status']; count:number; outcomes:Job['status'][];
 proposals:{candidate:VersionRef;provenance:Delivery['provenance']}[];
}
