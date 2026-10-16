import type {GateEnvironment} from './gate.ts';
import type {NodePacket,DesignArtifact,VersionRef} from './contracts.ts';
import {canonical,digest,reference} from './packets.ts';
import {productionRoles,parseProduction,same,type Job,type Iteration,type ProductionReceipt,type ProductionKind,type Source} from '../modules/website/production-contracts.ts';
import type {Specification,RasterConcept,Membership} from '../modules/website/exploration-contracts.ts';
import {compileRequest} from './execution-gate.ts';
export function productionInput(q:NodePacket<DesignArtifact<Specification>>,width:number,height:number,env:Pick<GateEnvironment,'lookup'>):{prompt:string;sources:Source[]} {
 const compiled=compileRequest(q,width,height,r=>env.lookup(r));
 if(compiled.sources.some(s=>s.entry?.preservation))throw Error('Production preservation predicates are not implemented');
 return {prompt:canonical(compiled),sources:compiled.sources.map(s=>({media:s.media,hash:s.image.checksum,candidate:s.entry?.candidate??null}))};
}
export function productionFresh(env:GateEnvironment,s:Job):boolean {
 const it=env.lookup({...s.iteration,version:env.currentVersion(s.iteration.id)??1}) as NodePacket<DesignArtifact<Iteration>>|null;
 const spec=env.lookup(s.spec) as NodePacket<DesignArtifact<Specification>>|null;
 if(!it||it.payload.state.status!=='active'||!spec||spec.integrity!==s.specHash)return false;
 const q=spec.payload.state,refs=[q.project,q.workUnit,...(q.selections?[q.selections]:[]),...(q.brand.enabled?[q.brand.source]:[]),...s.sources.flatMap(x=>[x.media,...(x.candidate?[x.candidate]:[])])];
 if(refs.some(r=>env.currentVersion(r.id)!==r.version))return false;
 const events=env.projectEvents?.(s.project.id)??[],sequence=events.find(e=>e.subject.id===spec.id)?.sequence??0;
 return !events.some(e=>e.kind==='acceptance'&&e.sequence>sequence);
}
export const productionReceiptId=(jobId:string,submissionHash:string)=>'production-receipt-'+digest({jobId,submissionHash});
export function productionGate(p:NodePacket<unknown>,previous:NodePacket<unknown>|null,env:GateEnvironment) {
 const a=p.payload as DesignArtifact<unknown>,old=previous?.payload as DesignArtifact<unknown>|undefined;
 if(old&&Object.hasOwn(productionRoles,old.kind)&&old.kind!==a.kind)throw Error('Production kind immutable');
 if(!Object.hasOwn(productionRoles,a.kind))return;
 const stored=env.lookup(reference(p));
 if(!stored&&!env.productionWriteAllowed?.(p))throw Error('Production writes require the owning intake service');
 if(p.type!=='work-record'||p.approval!=='proposal'||p.contextRefs.length||p.assets.length||p.constraints.length||p.placeholders.length)throw Error('Production envelope mismatch');
 const s=parseProduction(a.kind as ProductionKind,a.state),deps:VersionRef[]=[];
 const eq=(x:unknown,y:unknown)=>{if(!same(x,y))throw Error('Production binding/integrity mismatch');};
 const own=<T>(ref:VersionRef,kind:string)=>{const target=env.lookup(ref) as NodePacket<DesignArtifact<T>>|null;if(!target||target.projectId!==p.projectId||target.payload.kind!==kind)throw Error('Production owner/kind mismatch');deps.push(ref);return target;};
 if(a.kind==='production-iteration'){
  const i=s as Iteration;
  const project=env.lookup(i.project);if(project?.type!=='module-project'||project.id!==p.projectId)throw Error('Production project mismatch');deps.push(i.project);
  own(i.workUnit,'page-work-unit');const q=own<Specification>(i.spec,'raster-specification');eq([i.specHash,i.workUnit,i.jobs.length],[q.integrity,q.payload.state.workUnit,q.payload.state.count]);
  eq(i.jobs,Array.from({length:i.jobs.length},(_,n)=>'production-job-'+digest({iteration:p.id,ordinal:n+1})));
  if(previous){const b=(previous.payload as DesignArtifact<Iteration>).state;eq({...b,status:null},{...i,status:null});if(b.status!=='active'||i.status==='active')throw Error('Production iteration closure is monotonic');}
  else if(i.status!=='active')throw Error('Iteration must start active');
 }else if(a.kind==='production-job'){
  const j=s as Job,it=own<Iteration>(j.iteration,'production-iteration'),q=own<Specification>(j.spec,'raster-specification');
  eq([j.project,j.workUnit,j.spec,j.specHash,j.count,p.id],[it.payload.state.project,it.payload.state.workUnit,it.payload.state.spec,it.payload.state.specHash,it.payload.state.jobs.length,it.payload.state.jobs[j.ordinal-1]]);
  eq({prompt:j.prompt,sources:j.sources},productionInput(q,j.output.preferredWidth,j.output.preferredHeight,env));
  if(j.staging!=='staging/'+p.id)throw Error('Job staging must be project owned');
  if(previous){const b=(previous.payload as DesignArtifact<Job>).state;eq({...b,status:null,receipt:null},{...j,status:null,receipt:null});if(b.status!=='pending'||j.status==='pending'||!j.receipt)throw Error('Production job terminal outcome immutable');
   const r=own<ProductionReceipt>(j.receipt,'production-receipt');eq([r.payload.state.job,r.payload.state.disposition],[reference(previous),j.status]);
  }else if(j.status!=='pending'||j.receipt)throw Error('Job must start pending');
 }else{
  if(previous)throw Error('Production receipt immutable');const r=s as ProductionReceipt,j=own<Job>(r.job,'production-job'),js=j.payload.state;
  if(p.id!==productionReceiptId(j.id,r.submissionHash))throw Error('Receipt identity mismatch');
  if(r.delivery){if(r.submissionHash!==digest({delivery:r.delivery,observed:r.observed}))throw Error('Production submission hash mismatch');const d=r.delivery;eq([d.projectId,d.workUnit,d.iteration,d.jobId,d.spec,d.specHash,d.sources],[p.projectId,js.workUnit,js.iteration,j.id,js.spec,js.specHash,js.sources]);}
  const diagnostic=['incomplete','conflict'].includes(r.disposition);
  if(!diagnostic&&!r.delivery)throw Error('Final receipt needs delivery');
  if(!stored&&!diagnostic){
   if(js.status!=='pending'||env.currentVersion(j.id)!==j.version)throw Error('Stale production job');
   const fresh=productionFresh(env,js);
   if(fresh?(r.disposition!==r.delivery!.outcome):(r.disposition!=='historical'))throw Error('Production current/historical scope mismatch');
  }
  if(r.observed){
   const o=r.observed,limits=js.output;if(o.bytes>limits.maxBytes||o.width>limits.maxDimension||o.height>limits.maxDimension||o.width*o.height>limits.maxPixels||!limits.formats.includes(o.format))throw Error('Production output hard limits exceeded');
   if(!r.delivery?.output||!env.rasterFacts?.(r.observed)||!same(r.observed,r.delivery.output.image))throw Error('Production original not independently verified');
   if(!r.media)throw Error('Observed output requires media');const m=own<{image:unknown;role:string}>(r.media,'page-media');eq(m.payload.state.image,r.observed);
   eq(m.payload.state.role,r.disposition==='ready'?'placeable':'reference');
   if(r.verification!=='independently-decoded-original')throw Error('Missing verification');
  }else if(r.media||r.verification!=='no-output')throw Error('Unexpected output evidence');
  if(r.disposition==='ready'){
   if(!r.observed||!r.candidate||!r.membership)throw Error('Ready receipt closure missing');
   const c=own<RasterConcept>(r.candidate,'raster-concept'),m=own<Membership>(r.membership,'raster-membership');
   eq([c.payload.state.media,c.payload.state.image,c.payload.state.origin],[r.media,r.observed,'imported']);
   eq([m.payload.state.workUnit,m.payload.state.candidate,m.payload.state.integrity],[js.workUnit,r.candidate,c.integrity]);
  }else if(r.candidate||r.membership)throw Error('Historical/error receipt cannot register active proposal');
 }
 const unique=[...new Map(deps.map(r=>[r.id+':'+r.version,r])).values()];eq(p.dependencies,unique);
}
