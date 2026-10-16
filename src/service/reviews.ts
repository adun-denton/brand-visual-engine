import {join,resolve} from 'node:path';
import type {Workspace} from './workspace.ts';
import type {NodePacket,DesignArtifact,VersionRef} from '../kernel/contracts.ts';
import {packet,reference,revise,digest,canonical} from '../kernel/packets.ts';
import {reviewSnapshot,reviewDependencies,assertReviewFresh} from '../kernel/review-gate.ts';
import {revalidatePacket,writePort} from '../kernel/gate.ts';
import {parseReviewInput,reviewContentHash,reviewSubmissionId,type ReviewInput,type ReviewDraft,type ReviewSubmission,type ReviewScope} from '../modules/website/review-contracts.ts';
import type {Iteration} from '../modules/website/production-contracts.ts';
import {record,id,InputError} from './validation.ts';
import {exactRef} from '../modules/website/exploration-contracts.ts';
import {projectConfig,verifyProject} from './project-bootstrap.ts';
export type ReviewWork<T>=NodePacket<DesignArtifact<T>>;
export class Reviews {
 readonly w:Workspace;readonly root:string;private allowed=new Set<NodePacket<unknown>>();
 constructor(w:Workspace,root:string){this.w=w;this.root=resolve(root);this.project();w.kernel.bindReviewAuthority(p=>this.allowed.has(p));}
 private project(){const c=projectConfig(this.root);if(this.w.owner.root!==join(this.root,'runtime'))throw Error('Review runtime owner mismatch');verifyProject(this.w,c);return c;}
 private conflict(error:unknown):never {if(error instanceof InputError)throw error;throw new InputError(error instanceof Error?error.message:'Review rejected; feedback retained',409);}
 private write(packets:NodePacket<unknown>[],scope:ReviewScope){this.w.owner.assert();this.allowed=new Set(packets);try{this.w.kernel.putMany(packets,()=>{this.project();assertReviewFresh(this.w.kernel.environment(),scope);});}finally{this.allowed.clear();}}
 private make<T extends ReviewDraft>(kind:'production-review-draft'|'production-review-submission',identity:string,s:T):ReviewWork<T>{return packet({type:'work-record',id:identity,projectId:s.scope.project.id,dependencies:[...reviewDependencies(s),...(kind==='production-review-submission'?[(s as unknown as ReviewSubmission).finalDraft]:[])],payload:{moduleId:'website',kind,scope:'production-review',lockedValues:{},state:s},provenance:{actor:'local-human',source:'Explicit local human review; no agent or acceptance',previous:null}});}
 read<T extends ReviewDraft>(pid:string,ref:VersionRef,kind:'production-review-draft'|'production-review-submission'):ReviewWork<T>{const p=this.w.kernel.get<DesignArtifact<T>>(ref);if(p.projectId!==pid||p.payload.kind!==kind)throw Error('Review record owner/kind mismatch');revalidatePacket(p,writePort(p.type),this.w.kernel.environment());return p;}
 private availability(scope:ReviewScope){return scope.proposals.map(p=>{const available=!!this.w.assets.facts(p.image);return {candidate:p.candidate,available,message:available?'Exact original available':'Exact original unavailable or corrupt; no substitution'};});}
 catalog(pid:string,unit:VersionRef){
  if(this.project().projectId!==pid)throw new InputError('Wrong review project');
  const page=this.w.kernel.get<DesignArtifact<unknown>>(unit);if(page.projectId!==pid||page.payload.kind!=='page-work-unit')throw Error('Wrong review page');
  const order=new Map<string,number>();for(const event of this.w.kernel.ledger(pid).events)if(!order.has(event.subject.id))order.set(event.subject.id,event.sequence);
  return this.w.kernel.latestPackets().filter(p=>p.projectId===pid&&(p.payload as DesignArtifact<unknown>).kind==='production-iteration').sort((a,b)=>(order.get(a.id)??0)-(order.get(b.id)??0)).map(p=>p as ReviewWork<Iteration>).filter(p=>p.payload.state.workUnit.id===page.id).map(it=>{
   const jobs=it.payload.state.jobs.map(id=>this.w.kernel.get<DesignArtifact<import('../modules/website/production-contracts.ts').Job>>({id,version:this.w.kernel.currentVersion(id)??1,freshness:'pinned'}));
   return {ref:reference(it),workUnit:it.payload.state.workUnit,status:it.payload.state.status,count:jobs.length,outcomes:jobs.map(j=>j.payload.state.status),proposals:jobs.flatMap(j=>{const r=j.payload.state.receipt?this.w.kernel.get<DesignArtifact<import('../modules/website/production-contracts.ts').ProductionReceipt>>(j.payload.state.receipt).payload.state:null;return r?.candidate?[{candidate:r.candidate,provenance:r.delivery!.provenance}]:[];})};
  });
 }
 state(pid:string,unit:VersionRef,iterationId:string){
  const c=this.project();if(c.projectId!==pid)throw new InputError('Wrong review project');
  const env=this.w.kernel.environment(),it=this.w.kernel.get<DesignArtifact<Iteration>>({id:iterationId,version:this.w.kernel.currentVersion(iterationId)??1,freshness:'pinned'});
  if(it.projectId!==pid||it.payload.kind!=='production-iteration'||canonical(it.payload.state.workUnit)!==canonical(unit))throw new InputError('Wrong review iteration/page');
  let scope:ReviewScope|null=null,current=false,message='';try{scope=reviewSnapshot(env,it.payload.state.project,unit,reference(it));assertReviewFresh(env,scope);current=true;}catch(error){message=String(error);}
  const sequence=new Map(this.w.kernel.ledger(pid).events.map(e=>[e.subject.id+':'+e.subject.version,e.sequence]));
  const rows=this.w.kernel.latestPackets().filter(p=>p.projectId===pid&&['production-review-draft','production-review-submission'].includes((p.payload as DesignArtifact<unknown>).kind)).filter(p=>{const s=(p.payload as DesignArtifact<ReviewDraft>).state;return s.scope.iteration.id===iterationId&&canonical(s.scope.workUnit)===canonical(unit);}).sort((a,b)=>(sequence.get(a.id+':'+a.version)??0)-(sequence.get(b.id+':'+b.version)??0));
  const drafts=rows.filter(p=>(p.payload as DesignArtifact<unknown>).kind==='production-review-draft').map(p=>{const draft=this.read<ReviewDraft>(pid,reference(p),'production-review-draft');let stale=false;try{assertReviewFresh(env,draft.payload.state.scope);}catch{stale=true;}const submission=this.w.kernel.reviewForDraft(p.id);return {draft,stale,submission:submission?reference(submission):null,originals:this.availability(draft.payload.state.scope)};});
  const submissions=rows.filter(p=>(p.payload as DesignArtifact<unknown>).kind==='production-review-submission').map(p=>{const submission=this.read<ReviewSubmission>(pid,reference(p),'production-review-submission');return {submission,originals:this.availability(submission.payload.state.scope)};});
  const parentLineage=this.w.kernel.latestPackets().filter(p=>p.projectId===pid&&(p.payload as DesignArtifact<unknown>).kind==='review-child-lineage').filter(p=>(p.payload as DesignArtifact<import('../modules/website/continuation-contracts.ts').ChildLineage>).state.iteration.id===iterationId).map(p=>{revalidatePacket(p,writePort(p.type),env);const s=(p.payload as DesignArtifact<import('../modules/website/continuation-contracts.ts').ChildLineage>).state,parent=this.read<ReviewSubmission>(pid,s.parent,'production-review-submission');return {lineage:reference(p),parent:s.parent,receipt:s.receipt,workUnit:parent.payload.state.scope.workUnit,iteration:parent.payload.state.scope.iteration,preparedAt:s.preparedAt};});
  return {projectId:pid,unit,iterationId,parentLineage,scope,current,message,partial:scope?scope.proposals.length<scope.jobs.length:false,drafts,submissions};
 }
 private input(pid:string,input:unknown){const c=this.project();if(c.projectId!==pid)throw Error('Wrong review project');const r=parseReviewInput(input);if(r.scope.project.id!==pid||r.expected&&r.expected.id!==r.draftId)throw Error('Review expected identity mismatch');return r;}
 private draft(r:ReviewInput):ReviewWork<ReviewDraft>{
  const s:ReviewDraft={version:1,scope:r.scope,feedback:r.feedback,parentSubmission:r.parentSubmission};
  const version=this.w.kernel.currentVersion(r.draftId);
  if(version!==r.expected?.version&&!(version===null&&r.expected===null))throw Error('Review revision conflict; typed feedback retained. Reload saved feedback explicitly');
  if(this.w.kernel.reviewForDraft(r.draftId))throw Error('Review already submitted; reopen submission or Edit as new draft');
  if(!r.expected)return this.make('production-review-draft',r.draftId,s);
  const previous=this.read<ReviewDraft>(r.scope.project.id,r.expected,'production-review-draft');
  return revise(previous,{...previous.payload,state:s},'local-human','Explicit review draft save');
 }
 save(pid:string,input:unknown){try{
  const r=this.input(pid,input),version=this.w.kernel.currentVersion(r.draftId);
  // Exact retry of the immediately preceding save resolves a lost response without another revision.
  if(version===(r.expected?.version??0)+1&&!this.w.kernel.reviewForDraft(r.draftId)){
   const old=this.read<ReviewDraft>(pid,{id:r.draftId,version,freshness:'pinned'},'production-review-draft');
   if(reviewContentHash(old.payload.state)===reviewContentHash({version:1,...r}))return old;
  }
  const draft=this.draft(r);this.write([draft],r.scope);return draft;
 }catch(error){this.conflict(error);}}
 submit(pid:string,input:unknown){try{
  const outer=record(input,['review','actionKey']),r=this.input(pid,outer['review']),actionKey=id(outer['actionKey']),identity=reviewSubmissionId(pid,actionKey),requestHash=digest(r);
  const existing=this.w.kernel.lookup({id:identity,version:1,freshness:'pinned'});
  if(existing){const sub=this.read<ReviewSubmission>(pid,reference(existing),'production-review-submission');if(sub.payload.state.requestHash!==requestHash)throw Error('Action key conflict: changed feedback; reconcile original action before editing');return sub;}
  const draft=this.draft(r),s:ReviewSubmission={...draft.payload.state,finalDraft:reference(draft),draftIntegrity:draft.integrity,contentHash:reviewContentHash(draft.payload.state),actionKey,expectedDraft:r.expected,requestHash,submittedAt:new Date().toISOString(),verification:'pending-not-implemented'},submission=this.make('production-review-submission',identity,s);
  this.write([draft,submission],r.scope);return submission;
 }catch(error){this.conflict(error);}}
 copy(pid:string,input:unknown){try{
  const r=record(input,['submission','draftId']),parent=this.read<ReviewSubmission>(pid,exactRef(r['submission']),'production-review-submission'),s=parent.payload.state;
  return this.save(pid,{draftId:id(r['draftId']),expected:null,scope:s.scope,feedback:s.feedback,parentSubmission:reference(parent)});
 }catch(error){this.conflict(error);}}
 /** Exact original route stays bound to stored review content, even when current proposals change. */
 original(pid:string,recordRef:VersionRef,index:number){
  const p=this.w.kernel.get<DesignArtifact<ReviewDraft>>(recordRef);if(!['production-review-draft','production-review-submission'].includes(p.payload.kind)||p.projectId!==pid)throw Error('Wrong review original owner');
  const checked=this.read<ReviewDraft>(pid,recordRef,p.payload.kind as 'production-review-draft'|'production-review-submission');
  const source=checked.payload.state.scope.proposals[index];if(!source)throw Error('Unknown reviewed source');if(!this.w.assets.facts(source.image))throw new InputError('Exact reviewed original unavailable or corrupt',404);return {bytes:this.w.assets.read(source.image.id),image:source.image};
 }
}
