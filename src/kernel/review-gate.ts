import type {GateEnvironment} from './gate.ts';
import type {NodePacket,DesignArtifact,VersionRef} from './contracts.ts';
import {canonical,digest,reference} from './packets.ts';
import {reviewRoles,parseReview,reviewContentHash,reviewSubmissionId,type ReviewScope,type ReviewDraft,type ReviewSubmission,type ReviewKind} from '../modules/website/review-contracts.ts';
import type {Iteration,Job,ProductionReceipt} from '../modules/website/production-contracts.ts';
import type {RasterConcept,Membership} from '../modules/website/exploration-contracts.ts';
const eq=(a:unknown,b:unknown)=>{if(canonical(a)!==canonical(b))throw Error('Review scope/source closure mismatch');};
export const reviewDependencies=(s:ReviewDraft)=>[...new Map([s.scope.project,s.scope.workUnit,s.scope.iteration,...s.scope.receipts.map(r=>r.ref),...s.scope.jobs.flatMap(j=>[j.job,...(j.receipt?[j.receipt]:[])]),...s.scope.proposals.flatMap(p=>[p.candidate,p.media,p.receipt,p.membership]),...(s.parentSubmission?[s.parentSubmission]:[])].map(r=>[r.id+':'+r.version,r])).values()];
function own<T>(env:GateEnvironment,pid:string,r:VersionRef,kind:string):NodePacket<DesignArtifact<T>> {
 const p=env.lookup(r) as NodePacket<DesignArtifact<T>>|null;if(!p||p.projectId!==pid||p.payload.kind!==kind)throw Error('Review project/page/source mismatch');return p;
}
/** Reconstruct exact observed closure. Explicit historical job refs are never replaced by latest. */
export function reviewSnapshot(env:GateEnvironment,project:VersionRef,unit:VersionRef,iteration:VersionRef,jobRefs?:VersionRef[],receiptRefs?:VersionRef[]):ReviewScope {
 const pid=project.id,p=env.lookup(project);if(p?.type!=='module-project'||p.projectId!==pid)throw Error('Review project mismatch');own(env,pid,unit,'page-work-unit');
 const it=own<Iteration>(env,pid,iteration,'production-iteration');eq([it.payload.state.project,it.payload.state.workUnit],[project,unit]);
 const proposals:ReviewScope['proposals']=[];
 const jobs=it.payload.state.jobs.map((id,n)=>{
  const job=own<Job>(env,pid,jobRefs?.[n]??{id,version:env.currentVersion(id)??1,freshness:'pinned'},'production-job'),j=job.payload.state;
  if(job.id!==id)throw Error('Review job inventory mismatch');eq(j.iteration,{...iteration,version:1});eq([j.project,j.workUnit],[project,unit]);
  const receipt=j.receipt?own<ProductionReceipt>(env,pid,j.receipt,'production-receipt'):null,r=receipt?.payload.state;
  if(r&&r.job.id!==job.id)throw Error('Review receipt job mismatch');
  if(j.status==='ready'){
   if(!r||r.disposition!=='ready'||!r.candidate||!r.media||!r.membership||!r.observed)throw Error('Review proposal closure incomplete');
   const c=own<RasterConcept>(env,pid,r.candidate,'raster-concept'),m=own<{image:unknown}>(env,pid,r.media,'page-media'),member=own<Membership>(env,pid,r.membership,'raster-membership');
   eq([c.payload.state.media,c.payload.state.image,m.payload.state.image,member.payload.state.workUnit,member.payload.state.candidate,member.payload.state.integrity],[r.media,r.observed,r.observed,unit,r.candidate,c.integrity]);
   proposals.push({candidate:reference(c),integrity:c.integrity,media:reference(m),mediaIntegrity:m.integrity,receipt:reference(receipt!),membership:reference(member),image:c.payload.state.image});
  }
  return {job:reference(job),integrity:job.integrity,status:j.status,receipt:receipt?reference(receipt):null,receiptIntegrity:receipt?.integrity??null,disposition:r?.disposition??null};
 });
 const inventory=receiptRefs??(env.projectRefs?.(pid,4096,false)??[]).filter(ref=>{const p=env.lookup(ref);return (p?.payload as {kind?:string})?.kind==='production-receipt'&&it.payload.state.jobs.includes((p!.payload as DesignArtifact<ProductionReceipt>).state.job.id);});
 if(inventory.length>64)throw Error('Review receipt inventory exceeds 64; no incomplete snapshot saved');
 const receipts=inventory.map(ref=>{const r=own<ProductionReceipt>(env,pid,ref,'production-receipt');if(!it.payload.state.jobs.includes(r.payload.state.job.id))throw Error('Foreign review receipt');return {ref:reference(r),integrity:r.integrity,jobId:r.payload.state.job.id,disposition:r.payload.state.disposition};}).sort((a,b)=>a.ref.id.localeCompare(b.ref.id));
 if(!proposals.length)throw Error('Iteration has no reviewable proposals');
 const scope={project,workUnit:unit,iteration:reference(it),iterationIntegrity:it.integrity,jobs,receipts,proposals};return {...scope,fingerprint:digest(scope)};
}
export function assertReviewFresh(env:GateEnvironment,s:ReviewScope) {
 const refs=[s.project,s.workUnit,s.iteration,...s.jobs.map(j=>j.job),...s.proposals.flatMap(p=>[p.candidate,p.media,p.membership])];
 if(refs.some(r=>env.currentVersion(r.id)!==r.version)||own<Iteration>(env,s.project.id,s.iteration,'production-iteration').payload.state.status!=='active')throw Error('Review scope changed; reload and review current outcomes explicitly');
 eq(reviewSnapshot(env,s.project,s.workUnit,s.iteration),s);
}
export function reviewGate(p:NodePacket<unknown>,previous:NodePacket<unknown>|null,env:GateEnvironment) {
 const a=p.payload as DesignArtifact<unknown>,old=previous?.payload as DesignArtifact<unknown>|undefined;
 if(old&&Object.hasOwn(reviewRoles,old.kind)&&old.kind!==a.kind)throw Error('Review kind immutable');if(!Object.hasOwn(reviewRoles,a.kind))return;
 const stored=env.lookup(reference(p));if(!stored&&!env.reviewWriteAllowed?.(p))throw Error('Review writes require the owning review service');
 if(p.type!=='work-record'||p.approval!=='proposal'||p.contextRefs.length||p.assets.length||p.constraints.length||p.placeholders.length||p.provenance.actor!=='local-human')throw Error('Review envelope/provenance mismatch');
 const s=parseReview(a.kind as ReviewKind,a.state);if(p.projectId!==s.scope.project.id)throw Error('Review owner mismatch');
 eq(reviewSnapshot(env,s.scope.project,s.scope.workUnit,s.scope.iteration,s.scope.jobs.map(j=>j.job),s.scope.receipts.map(r=>r.ref)),s.scope);
 eq(s.feedback.selections.workUnit,s.scope.workUnit);
 for(const entry of s.feedback.selections.entries){const source=s.scope.proposals.find(c=>canonical(c.candidate)===canonical(entry.candidate));if(!source)throw Error('Selection outside frozen review proposal set');eq([entry.integrity,entry.image],[source.integrity,source.image]);if(!stored&&!env.rasterFacts?.(source.image))throw Error('Review original unavailable or corrupt');}
 if(!stored){assertReviewFresh(env,s.scope);for(const source of s.scope.proposals)if(!env.rasterFacts?.(source.image))throw Error('Review original unavailable or corrupt');}
 if(s.parentSubmission){const parent=own<ReviewSubmission>(env,p.projectId!,s.parentSubmission,'production-review-submission');eq([parent.payload.state.scope.workUnit,parent.payload.state.scope.iteration.id],[s.scope.workUnit,s.scope.iteration.id]);}
 let deps=reviewDependencies(s);
 if(a.kind==='production-review-draft'){
  if(previous){const before=(previous.payload as DesignArtifact<ReviewDraft>).state;eq([before.scope,before.parentSubmission],[s.scope,s.parentSubmission]);if(!stored&&env.reviewForDraft?.(p.id))throw Error('Submitted draft is immutable; edit as new draft');}
 }else{
  if(previous)throw Error('Submitted review immutable');const sub=s as ReviewSubmission,draft=own<ReviewDraft>(env,p.projectId!,sub.finalDraft,'production-review-draft');
  eq(draft.payload.state,{version:s.version,scope:s.scope,feedback:s.feedback,parentSubmission:s.parentSubmission});eq(draft.integrity,sub.draftIntegrity);
  eq(sub.contentHash,reviewContentHash(s));eq(p.id,reviewSubmissionId(p.projectId!,sub.actionKey));
  eq(sub.requestHash,digest({draftId:draft.id,expected:sub.expectedDraft,scope:s.scope,feedback:s.feedback,parentSubmission:s.parentSubmission}));
  if(sub.finalDraft.version!==(sub.expectedDraft?.version??0)+1||sub.expectedDraft&&sub.expectedDraft.id!==draft.id)throw Error('Review final draft revision mismatch');
  if(!stored&&(env.currentVersion(draft.id)!==draft.version||env.reviewForDraft?.(draft.id)))throw Error('Draft already submitted or revised');
  deps=[...deps,sub.finalDraft];
 }
 eq(p.dependencies,deps);
}
