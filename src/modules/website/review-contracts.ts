import type {VersionRef} from '../../kernel/contracts.ts';
import type {ImageInfo} from '../../service/assets.ts';
import {parseImageInfo} from './workspace-contracts.ts';
import {exactRef,hash,parseSelections,type Selections} from './exploration-contracts.ts';
import {record,id,list,string,choice} from '../../service/validation.ts';
import {canonical,digest} from '../../kernel/packets.ts';
export const reviewRoles={'production-review-draft':'work-record','production-review-submission':'work-record'} as const;
export type ReviewKind=keyof typeof reviewRoles;
export interface ReviewScope {
 project:VersionRef; workUnit:VersionRef; iteration:VersionRef; iterationIntegrity:string;
 receipts:{ref:VersionRef;integrity:string;jobId:string;disposition:string}[];
 jobs:{job:VersionRef;integrity:string;status:string;receipt:VersionRef|null;receiptIntegrity:string|null;disposition:string|null}[];
 proposals:{candidate:VersionRef;integrity:string;media:VersionRef;mediaIntegrity:string;receipt:VersionRef;membership:VersionRef;image:ImageInfo}[];
 fingerprint:string;
}
export interface ReviewFeedback {selections:Selections;comment:string}
export interface ReviewDraft {version:1;scope:ReviewScope;feedback:ReviewFeedback;parentSubmission:VersionRef|null}
export interface ReviewSubmission extends ReviewDraft {
 finalDraft:VersionRef;draftIntegrity:string;contentHash:string;actionKey:string;expectedDraft:VersionRef|null;requestHash:string;submittedAt:string;verification:'pending-not-implemented';
}
export interface ReviewInput {draftId:string;expected:VersionRef|null;scope:ReviewScope;feedback:ReviewFeedback;parentSubmission:VersionRef|null}
const nullableRef=(x:unknown)=>x===null?null:exactRef(x);
export function parseReviewScope(x:unknown):ReviewScope {
 const r=record(x,['project','workUnit','iteration','iterationIntegrity','jobs','receipts','proposals','fingerprint']);
 const jobs=list(r['jobs'],x=>{const j=record(x,['job','integrity','status','receipt','receiptIntegrity','disposition']);return {job:exactRef(j['job']),integrity:hash(j['integrity']),status:choice(j['status'],['pending','ready','failed','uncertain','historical']),receipt:nullableRef(j['receipt']),receiptIntegrity:j['receiptIntegrity']===null?null:hash(j['receiptIntegrity']),disposition:j['disposition']===null?null:choice(j['disposition'],['ready','failed','uncertain','historical','incomplete','conflict'])};},6);
 const receipts=list(r['receipts'],x=>{const p=record(x,['ref','integrity','jobId','disposition']);return {ref:exactRef(p['ref']),integrity:hash(p['integrity']),jobId:id(p['jobId']),disposition:choice(p['disposition'],['ready','failed','uncertain','historical','incomplete','conflict'])};},64);
 const proposals=list(r['proposals'],x=>{const p=record(x,['candidate','integrity','media','mediaIntegrity','receipt','membership','image']);return {candidate:exactRef(p['candidate']),integrity:hash(p['integrity']),media:exactRef(p['media']),mediaIntegrity:hash(p['mediaIntegrity']),receipt:exactRef(p['receipt']),membership:exactRef(p['membership']),image:parseImageInfo(p['image'])};},6);
 if(!jobs.length||!proposals.length||new Set(jobs.map(j=>j.job.id)).size!==jobs.length||new Set(proposals.map(p=>p.candidate.id+':'+p.candidate.version)).size!==proposals.length)throw Error('Review needs a distinct bounded proposal set');
 const scope={project:exactRef(r['project']),workUnit:exactRef(r['workUnit']),iteration:exactRef(r['iteration']),iterationIntegrity:hash(r['iterationIntegrity']),jobs,receipts,proposals};
 if(hash(r['fingerprint'])!==digest(scope))throw Error('Review scope fingerprint mismatch');return {...scope,fingerprint:digest(scope)};
}
export function parseReviewFeedback(x:unknown):ReviewFeedback {
 if(Buffer.byteLength(canonical(x),'utf8')>10*1024*1024)throw Error('Review exceeds 10 MiB');
 const r=record(x,['selections','comment']),selections=parseSelections(r['selections']);string(r['comment'],4000,true);const comment=r['comment'] as string;
 // Reuse selection validation/geometry, retaining the human's exact text rather than trimming it.
 const raw=(r['selections'] as {entries:{notes:{text:string;source:string}[]}[]}).entries;
 selections.entries=selections.entries.map((entry,i)=>({...entry,notes:entry.notes.map((note,j)=>({...note,text:raw[i]!.notes[j]!.text,source:raw[i]!.notes[j]!.source}))}));
 if(!selections.entries.length&&!comment.trim())throw Error('Select a source or enter substantive review feedback');
 return {selections,comment};
}
export function parseReviewInput(x:unknown):ReviewInput {
 const r=record(x,['draftId','expected','scope','feedback','parentSubmission']);const draftId=id(r['draftId']);if(!draftId.startsWith('review-draft-'))throw Error('Invalid review draft identity');
 return {draftId,expected:nullableRef(r['expected']),scope:parseReviewScope(r['scope']),feedback:parseReviewFeedback(r['feedback']),parentSubmission:nullableRef(r['parentSubmission'])};
}
export const reviewContentHash=(s:ReviewDraft)=>digest({scope:s.scope,feedback:s.feedback,parentSubmission:s.parentSubmission});
export const reviewSubmissionId=(projectId:string,actionKey:string)=>'review-submission-'+digest({projectId,actionKey});
export function parseReview(kind:ReviewKind,x:unknown):ReviewDraft|ReviewSubmission {
 const extra=kind==='production-review-submission'?['finalDraft','draftIntegrity','contentHash','actionKey','expectedDraft','requestHash','submittedAt','verification']:[];
 const r=record(x,['version','scope','feedback','parentSubmission',...extra]);if(r['version']!==1)throw Error('Unsupported review contract');
 const base:ReviewDraft={version:1,scope:parseReviewScope(r['scope']),feedback:parseReviewFeedback(r['feedback']),parentSubmission:nullableRef(r['parentSubmission'])};
 if(kind==='production-review-draft')return base;
 const submittedAt=string(r['submittedAt'],40);if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(submittedAt)||!Number.isFinite(Date.parse(submittedAt))||r['verification']!=='pending-not-implemented')throw Error('Invalid review provenance/verification');
 return {...base,finalDraft:exactRef(r['finalDraft']),draftIntegrity:hash(r['draftIntegrity']),contentHash:hash(r['contentHash']),actionKey:id(r['actionKey']),expectedDraft:nullableRef(r['expectedDraft']),requestHash:hash(r['requestHash']),submittedAt,verification:'pending-not-implemented'};
}
export function validateReviewRecord(p:Record<string,unknown>):boolean {
 if(!Object.hasOwn(reviewRoles,String(p['kind'])))return false;
 if(p['moduleId']!=='website'||p['scope']!=='production-review'||canonical(p['lockedValues'])!=='{}')throw Error('Review envelope mismatch');
 if(canonical(parseReview(p['kind'] as ReviewKind,p['state']))!==canonical(p['state']))throw Error('Noncanonical review');return true;
}
