import type { VersionRef } from '../../kernel/contracts.ts';
import type { ExecutionRequest } from './execution-contracts.ts';
import { parseExecution, zeroBound } from './execution-contracts.ts';
import { exactRef, hash } from './exploration-contracts.ts';
import { parseImageInfo } from './workspace-contracts.ts';
import type { ImageInfo } from '../../service/assets.ts';
import { canonical, digest } from '../../kernel/packets.ts';
import { record, choice, id, integer, list, string, bool, InputError } from '../../service/validation.ts';
export const nativeRoles = {'native-exchange-grant':'work-record','native-exchange':'work-record','native-exchange-receipt':'work-record'} as const;
export type NativeKind = keyof typeof nativeRoles;
export const nativeAdapter = {id:'account-native-exchange',version:'1',mode:'manual-exchange'} as const;
export type Evidence = 'operator-attested-native' | 'synthetic-fixture';
export interface NativeGrant {
  version:2; adapter:typeof nativeAdapter; request:VersionRef; requestHash:string;
  slots:number[]; maxSubmissions:number; maxStatusCalls:number; maxCancelCalls:number;
  timeoutMs:number; expiresAt:string; revoked:boolean; evidence:Evidence; reason:string;
}
export interface Binding {
  projectId:string; workUnit:VersionRef; spec:VersionRef; specHash:string;
  request:VersionRef; requestHash:string; grant:VersionRef; execution:VersionRef;
  slot:number; submissionId:string; exchangeJobId:string;
}
export interface NativePackage {
  version:1; kind:'bve-native-request'; adapter:typeof nativeAdapter;
  authority:'one-manual-invocation'; evidence:Evidence; binding:Binding;
  request:ExecutionRequest; sources:{path:string; checksum:string}[];
  prompt:string; instructions:string; packetDigest:string;
}
export type NativeStatus = 'pending'|'awaiting-operator'|'claimed'|'returned'|'failed'|'uncertain'|'withdrawn';
export interface NativeSlot {slot:number;status:NativeStatus;release:NativePackage|null;receipt:VersionRef|null;cancelRequested:boolean;}
export interface NativeRun {
  version:2;adapter:typeof nativeAdapter;request:VersionRef;requestHash:string;grant:VersionRef;
  workUnit:VersionRef;slots:NativeSlot[]; retryOf:{execution:VersionRef;slot:number}|null;
}
export interface Attestation {
  kind:Evidence; verification:'operator-attestation-only'; hostInvocationId:string|null;
  model:string|null;seed:string|null;usage:Record<string,unknown>|null;cost:number|null;providerId:string|null;
  statement:string;
}
export interface NativeResult {
  version:1;kind:'bve-native-result';binding:Binding;packetDigest:string;receiptId:string;
  origin:'imported';outcome:'returned'|'failed';output:{path:string;image:ImageInfo}|null;
  rights:string;attestation:Attestation;message:string;
}
export interface NativeReceipt {
  version:2;adapter:typeof nativeAdapter;execution:VersionRef;result:NativeResult;payloadHash:string;
  outcome:'returned'|'failed'|'historical';candidate:VersionRef|null;media:VersionRef|null;image:ImageInfo|null;
}
const evidence=(x:unknown)=>choice(x,['operator-attested-native','synthetic-fixture']);
const identity=(x:unknown)=>{if(canonical(x)!==canonical(nativeAdapter))throw new InputError('Native adapter mismatch');return nativeAdapter;};
const nullableText=(x:unknown)=>x===null?null:string(x,160);
export function parseBinding(x:unknown):Binding {
  const r=record(x,['projectId','workUnit','spec','specHash','request','requestHash','grant','execution','slot','submissionId','exchangeJobId']);
  return {projectId:id(r['projectId']),workUnit:exactRef(r['workUnit']),spec:exactRef(r['spec']),specHash:hash(r['specHash']),request:exactRef(r['request']),requestHash:hash(r['requestHash']),grant:exactRef(r['grant']),execution:exactRef(r['execution']),slot:integer(r['slot'],6),submissionId:id(r['submissionId']),exchangeJobId:id(r['exchangeJobId'])};
}
export const sourcePath=(image:ImageInfo)=>'assets/'+image.checksum+'.'+(image.format==='jpeg'?'jpg':image.format);
export const nativeInstructions = 'Manual exchange. This package authorizes at most one invocation for its exact slot. Claim with BVE before invoking; stop if denied, expired, withdrawn or uncertain. Re-download does not authorize a second invocation. BVE cannot physically prevent duplicate manual execution. Use only the frozen request and ordered original sources, without project/chat history. Return the original PNG/JPEG/WebP bytes and a bve-native-result manifest; never transcribe base64, convert, resize, substitute a source, or fetch manifest URLs. Exact requested dimensions are required by BVE but native-host support is unverified. Keep unknown host IDs/model/seed/usage/cost/provider IDs null. Packet digest binding is not authentication or generation proof. Selection and acceptance are separate operator actions.';
export function nativePrompt(q:ExecutionRequest):string {return canonical({operation:q.operation,intent:q.intent,width:q.width,height:q.height,direction:q.direction,brand:q.brand,facts:q.facts,constraints:q.constraints,requests:q.requests,sources:q.sources});}
export function compileNativePackage(binding:Binding,q:ExecutionRequest,e:Evidence):NativePackage {
  const body={version:1 as const,kind:'bve-native-request' as const,adapter:nativeAdapter,authority:'one-manual-invocation' as const,evidence:e,binding,request:q,sources:q.sources.map(s=>({path:sourcePath(s.image),checksum:s.image.checksum})),prompt:nativePrompt(q),instructions:nativeInstructions};
  return {...body,packetDigest:digest(body)};
}
export function parseNativePackage(x:unknown):NativePackage {
  const r=record(x,['version','kind','adapter','authority','evidence','binding','request','sources','prompt','instructions','packetDigest']);
  if(r['version']!==1||r['kind']!=='bve-native-request'||r['authority']!=='one-manual-invocation')throw new InputError('Native request version/authority');
  identity(r['adapter']);
  const result=compileNativePackage(parseBinding(r['binding']),parseExecution('raster-execution-request',r['request']) as ExecutionRequest,evidence(r['evidence']));
  if(canonical(result)!==canonical(x))throw new InputError('Native packet digest/compilation mismatch');
  if(Buffer.byteLength(canonical(result))>262144)throw new InputError('Native manifest exceeds 256 KiB',413);
  return result;
}
export function parseNativeResult(x:unknown):NativeResult {
  const r=record(x,['version','kind','binding','packetDigest','receiptId','origin','outcome','output','rights','attestation','message']);
  if(r['version']!==1||r['kind']!=='bve-native-result'||r['origin']!=='imported')throw new InputError('Only imported native result provenance is admitted');
  const a=record(r['attestation'],['kind','verification','hostInvocationId','model','seed','usage','cost','providerId','statement']);
  const usage=a['usage']===null?null:record(a['usage'],Object.keys(a['usage'] as object));
  if(canonical(usage).length>12000||!(a['cost']===null||typeof a['cost']==='number'&&Number.isFinite(a['cost'])&&a['cost']>=0))throw new InputError('Invalid attested usage/cost');
  const attestation:Attestation={kind:evidence(a['kind']),verification:choice(a['verification'],['operator-attestation-only']),hostInvocationId:nullableText(a['hostInvocationId']),model:nullableText(a['model']),seed:nullableText(a['seed']),usage,cost:a['cost'] as number|null,providerId:nullableText(a['providerId']),statement:string(a['statement'])};
  if(attestation.kind==='synthetic-fixture'&&[attestation.hostInvocationId,attestation.model,attestation.seed,usage,attestation.cost,attestation.providerId].some(v=>v!==null))throw new InputError('Fixture cannot claim real invocation provenance');
  const o=r['output']===null?null:record(r['output'],['path','image']);
  const output=o?{path:string(o['path'],100),image:parseImageInfo(o['image'])}:null;
  if(output&&output.path!==sourcePath(output.image))throw new InputError('Unsafe or substituted output path');
  const outcome=choice(r['outcome'],['returned','failed']);
  if((outcome==='returned')!==(output!==null))throw new InputError('Native outcome/output mismatch');
  const result:NativeResult={version:1,kind:'bve-native-result',binding:parseBinding(r['binding']),packetDigest:hash(r['packetDigest']),receiptId:id(r['receiptId']),origin:'imported',outcome,output,rights:string(r['rights']),attestation,message:string(r['message'])};
  if(Buffer.byteLength(canonical(result))>262144)throw new InputError('Native result manifest exceeds bound',413);
  return result;
}
export function parseNative(kind:NativeKind,x:unknown):NativeGrant|NativeRun|NativeReceipt {
  const v=record(x,Object.keys(x as object));if(v['version']!==2)throw new InputError('Native record version');identity(v['adapter']);
  if(kind==='native-exchange-grant'){
    const r=record(x,['version','adapter','request','requestHash','slots','maxSubmissions','maxStatusCalls','maxCancelCalls','timeoutMs','expiresAt','revoked','evidence','reason']);
    const slots=list(r['slots'],s=>integer(s,6),6),expiresAt=string(r['expiresAt'],40);
    if(!slots.length||new Set(slots).size!==slots.length||!Number.isFinite(Date.parse(expiresAt))||new Date(expiresAt).toISOString()!==expiresAt)throw new InputError('Native grant slots/expiry');
    return {version:2,adapter:nativeAdapter,request:exactRef(r['request']),requestHash:hash(r['requestHash']),slots,maxSubmissions:integer(r['maxSubmissions'],6),maxStatusCalls:zeroBound(r['maxStatusCalls'],24),maxCancelCalls:zeroBound(r['maxCancelCalls'],6),timeoutMs:integer(r['timeoutMs'],30000),expiresAt,revoked:bool(r['revoked']),evidence:evidence(r['evidence']),reason:string(r['reason'])};
  }
  if(kind==='native-exchange'){
    const r=record(x,['version','adapter','request','requestHash','grant','workUnit','slots','retryOf']);
    const slots=list(r['slots'],s=>{const a=record(s,['slot','status','release','receipt','cancelRequested']);return {slot:integer(a['slot'],6),status:choice(a['status'],['pending','awaiting-operator','claimed','returned','failed','uncertain','withdrawn']),release:a['release']===null?null:parseNativePackage(a['release']),receipt:a['receipt']===null?null:exactRef(a['receipt']),cancelRequested:bool(a['cancelRequested'])};},6);
    if(!slots.length||new Set(slots.map(a=>a.slot)).size!==slots.length)throw new InputError('Native run slots');
    const retry=r['retryOf']===null?null:record(r['retryOf'],['execution','slot']);
    return {version:2,adapter:nativeAdapter,request:exactRef(r['request']),requestHash:hash(r['requestHash']),grant:exactRef(r['grant']),workUnit:exactRef(r['workUnit']),slots,retryOf:retry?{execution:exactRef(retry['execution']),slot:integer(retry['slot'],6)}:null};
  }
  const r=record(x,['version','adapter','execution','result','payloadHash','outcome','candidate','media','image']);
  return {version:2,adapter:nativeAdapter,execution:exactRef(r['execution']),result:parseNativeResult(r['result']),payloadHash:hash(r['payloadHash']),outcome:choice(r['outcome'],['returned','failed','historical']),candidate:r['candidate']===null?null:exactRef(r['candidate']),media:r['media']===null?null:exactRef(r['media']),image:r['image']===null?null:parseImageInfo(r['image'])};
}
export function validateNativeRecord(p:Record<string,unknown>):boolean {
  if(!Object.hasOwn(nativeRoles,String(p['kind'])))return false;
  record(p,['moduleId','kind','scope','lockedValues','state']);
  if(p['moduleId']!=='website'||p['scope']!=='page-execution'||Object.keys(record(p['lockedValues'],[])).length||canonical(parseNative(p['kind'] as NativeKind,p['state']))!==canonical(p['state']))throw new InputError('Noncanonical native record');
  return true;
}
