import {createHash,randomUUID} from 'node:crypto';
import {join,resolve} from 'node:path';
import {existsSync,lstatSync,openSync,closeSync,fstatSync,readSync,constants,mkdirSync,realpathSync} from 'node:fs';
import type {Workspace} from './workspace.ts';
import {inspectRaster,MAX_IMAGE_BYTES} from './assets.ts';
import {projectConfig,verifyProject,type ProjectConfig} from './project-bootstrap.ts';
import {assertNoLinks} from './runtime-owner.ts';
import {packet,reference,revise,digest,canonical} from '../kernel/packets.ts';
import {revalidatePacket,writePort} from '../kernel/gate.ts';
import {productionInput,productionFresh,productionReceiptId} from '../kernel/production-gate.ts';
import type {DesignArtifact,NodePacket,VersionRef} from '../kernel/contracts.ts';
import {parseProduction,parseDelivery,parseOutput,type Iteration,type Job,type ProductionReceipt,type ProductionKind,type Delivery,same} from '../modules/website/production-contracts.ts';
import {Exploration} from './exploration.ts';
import {parseSpecification,type Specification} from '../modules/website/exploration-contracts.ts';
import {record,id} from './validation.ts';
export type ProductionWork<T>=NodePacket<DesignArtifact<T>>;
export const bytesHash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const dependencies=(refs:VersionRef[])=>[...new Map(refs.map(r=>[r.id+':'+r.version,r])).values()];
/** Read a bounded, regular, singly linked file; no user-provided paths enter this function. */
export function stagedFile(path:string,max:number):Buffer {
 assertNoLinks(path);const before=lstatSync(path);if(!before.isFile()||before.nlink!==1||before.size<1||before.size>max)throw Error('Unsafe, empty or oversized staged file');
 const fd=openSync(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
 try{
  const stat=fstatSync(fd);if(!stat.isFile()||stat.nlink!==1||stat.size!==before.size||stat.ino!==before.ino||stat.dev!==before.dev)throw Error('Staged file changed while opening');
  const bytes=Buffer.alloc(stat.size+1);let size=0,n:number;while(size<bytes.length&&(n=readSync(fd,bytes,size,bytes.length-size,null))>0)size+=n;
  const after=fstatSync(fd);assertNoLinks(path);if((process.platform==='win32'?realpathSync(path).toLowerCase():realpathSync(path))!==(process.platform==='win32'?resolve(path).toLowerCase():resolve(path)))throw Error('Redirected staging file refused');if(size!==stat.size||after.size!==stat.size||after.mtimeMs!==stat.mtimeMs||after.ctimeMs!==stat.ctimeMs)throw Error('Staged file changed while reading');return bytes.subarray(0,size);
 }finally{closeSync(fd);}
}
export class ProductionIntake {
 readonly w:Workspace;readonly root:string;readonly config:ProjectConfig;
 private allowed=new Set<NodePacket<unknown>>();
 constructor(w:Workspace,root:string){this.w=w;this.root=resolve(root);this.config=projectConfig(this.root);if(w.owner.root!==join(this.root,'runtime'))throw Error('Production runtime ownership mismatch');verifyProject(w,this.config);w.kernel.bindProductionAuthority(p=>this.allowed.has(p));}
 private write(packets:NodePacket<unknown>[],guard?:()=>void){this.w.owner.assert();this.allowed=new Set(packets);try{this.w.kernel.putMany(packets,()=>{verifyProject(this.w,this.config);if(!same(projectConfig(this.root),this.config))throw Error('Project configuration changed');guard?.();});}finally{this.allowed.clear();}}
 private make<T>(kind:ProductionKind,state:T,refs:VersionRef[],identity=kind+'-'+randomUUID()):ProductionWork<T>{return packet({type:'work-record',id:identity,projectId:this.config.projectId,dependencies:dependencies(refs),payload:{moduleId:'website',kind,scope:'production-intake',lockedValues:{},state},provenance:{actor:'local-butler',source:'Verified local production boundary; no invocation',previous:null}});}
 read<T>(ref:VersionRef,kind:ProductionKind):ProductionWork<T>{const p=this.w.kernel.get<DesignArtifact<T>>(ref);if(p.projectId!==this.config.projectId||p.payload.kind!==kind)throw Error('Production owner/kind mismatch');revalidatePacket(p,writePort(p.type),this.w.kernel.environment());return p;}
 jobs(){return this.w.kernel.latestPackets().filter(p=>p.projectId===this.config.projectId&&(p.payload as DesignArtifact<unknown>).kind==='production-job').map(p=>this.read<Job>(reference(p),'production-job'));}
 receipts(){return this.w.kernel.latestPackets().filter(p=>p.projectId===this.config.projectId&&(p.payload as DesignArtifact<unknown>).kind==='production-receipt').map(p=>this.read<ProductionReceipt>(reference(p),'production-receipt'));}
 iterations(){return this.w.kernel.latestPackets().filter(p=>p.projectId===this.config.projectId&&(p.payload as DesignArtifact<unknown>).kind==='production-iteration').map(p=>this.read<Iteration>(reference(p),'production-iteration'));}
 // Internal owning-service hook appends lineage inside the same transaction; HTTP callers cannot supply it.
 prepare(input:unknown,lineage?:(iteration:ProductionWork<Iteration>,specification:ProductionWork<Specification>,jobs:ProductionWork<Job>[])=>NodePacket<unknown>){
  const r=record(input,['specification','output','worker']);const spec=parseSpecification(r['specification']),output=parseOutput(r['output']);
  const project=this.w.project(this.config.projectId);if(!same(spec.project,reference(project)))throw Error('Wrong/stale production project');
  const unit=this.w.kernel.get<DesignArtifact<unknown>>(spec.workUnit);if(unit.projectId!==project.id||unit.payload.kind!=='page-work-unit')throw Error('Wrong production page');
  // Frozen specification is prepared without creating a synthetic batch.
  const q=new Exploration(this.w).specificationPacket(project.id,spec);
  const iterationId='production-iteration-'+randomUUID(),jobIds=Array.from({length:spec.count},(_,n)=>'production-job-'+digest({iteration:iterationId,ordinal:n+1}));
  const iteration=this.make<Iteration>('production-iteration',{version:1,project:spec.project,workUnit:spec.workUnit,spec:reference(q),specHash:q.integrity,jobs:jobIds,status:'active'},[spec.project,spec.workUnit,reference(q)],iterationId);
  const compiled=productionInput(q,output.preferredWidth,output.preferredHeight,this.w.kernel.environment());
  const jobs=jobIds.map((jobId,n)=>{
   const state=parseProduction('production-job',{version:1,project:spec.project,workUnit:spec.workUnit,iteration:reference(iteration),spec:reference(q),specHash:q.integrity,ordinal:n+1,count:spec.count,...compiled,staging:'staging/'+jobId,worker:r['worker'],output,intent:'one-output-no-retry',status:'pending',receipt:null}) as Job;
   return this.make('production-job',state,[reference(iteration),reference(q)],jobId);
  });
  const superseded=this.iterations().filter(p=>same(p.payload.state.workUnit,spec.workUnit)&&p.payload.state.status==='active').map(p=>revise(p,{...p.payload,state:{...p.payload.state,status:'superseded' as const}},'local-operator','Explicit new production iteration'));
  this.write([...superseded,q,iteration,...jobs,...(lineage?[lineage(iteration,q,jobs)]:[])]);
  // Disposable staging can be reconstructed from jobs if interrupted here.
  for(const j of jobs)this.stagingDirectory(j.payload.state);
  return {specification:q,iteration,jobs};
 }
 cancel(iteration:VersionRef){const p=this.read<Iteration>(iteration,'production-iteration');if(this.w.kernel.currentVersion(p.id)!==p.version)throw Error('Stale iteration');if(p.payload.state.status!=='active')return p;const next=revise(p,{...p.payload,state:{...p.payload.state,status:'cancelled' as const}},'local-operator','Explicit production cancellation; no invocation');this.write([next]);return next;}
 private stagingDirectory(j:Job){const dir=join(this.root,j.staging);assertNoLinks(dir);mkdirSync(dir,{recursive:true,mode:0o700});return dir;}
 private diagnostic(job:ProductionWork<Job>,disposition:'incomplete'|'conflict',submissionHash:string,message:string,delivery:Delivery|null=null,bytes:Buffer|null=null,observed:ProductionReceipt['observed']=null){
  const identity=productionReceiptId(job.id,submissionHash),prior=this.w.kernel.lookup({id:identity,version:1,freshness:'pinned'});if(prior)return this.read<ProductionReceipt>(reference(prior),'production-receipt');
  const writes:NodePacket<unknown>[]=[];let media:VersionRef|null=null;
  if(bytes&&observed){
   const m=packet({type:'media-asset',id:'production-conflict-media-'+digest({job:job.id,submissionHash}),projectId:this.config.projectId,assets:[{id:observed.id,checksum:observed.checksum}],payload:{moduleId:'website',kind:'page-media',scope:'media',lockedValues:{},state:{image:observed,label:'Conflicting production original · reference only',role:'reference',permission:'Declared '+delivery!.provenance+'; conflicting output, no replacement'}},provenance:{actor:'local-butler',source:'Verified conflicting original retained without active membership',previous:null}});
   this.w.assets.save(bytes,observed);media=reference(m);writes.push(m);
  }
  const receipt=this.make<ProductionReceipt>('production-receipt',{version:1,job:reference(job),delivery,submissionHash,disposition,message,observed,media,candidate:null,membership:null,verification:observed?'independently-decoded-original':'no-output',provenanceProof:'declaration-only'},[reference(job),...(media?[media]:[])],identity);this.write([...writes,receipt]);return receipt;
 }

 async intake(jobId:string){
  id(jobId);const version=this.w.kernel.currentVersion(jobId);if(version===null)throw Error('Unknown production job');const j=this.read<Job>({id:jobId,version,freshness:'pinned'},'production-job'),s=j.payload.state;
  const dir=this.stagingDirectory(s),marker=join(dir,'complete.json');
  if(!existsSync(marker))return this.diagnostic(j,'incomplete',digest({jobId,incomplete:true}),'Completion marker missing; existing job outcome unchanged, no retry invoked');
  // A marker commits to the exact delivery JSON, and is written only after the original.
  const markerBytes=stagedFile(marker,4096),m=record(JSON.parse(markerBytes.toString('utf8')),['version','jobId','deliveryHash']);if(m['version']!==1||m['jobId']!==j.id)throw Error('Invalid completion marker');
  const manifest=stagedFile(join(dir,'delivery.json'),65536);if(m['deliveryHash']!==bytesHash(manifest))throw Error('Incomplete or changed delivery manifest');
  const d=parseDelivery(JSON.parse(manifest.toString('utf8')));
  if(!same([d.projectId,d.workUnit,d.iteration,d.jobId,d.spec,d.specHash,d.sources],[this.config.projectId,s.workUnit,s.iteration,j.id,s.spec,s.specHash,s.sources]))throw Error('Delivery project/page/job/spec/source binding rejected');
  let bytes:Buffer|null=null,observed:ProductionReceipt['observed']=null;
  if(d.output){bytes=stagedFile(join(dir,d.output.filename),Math.min(MAX_IMAGE_BYTES,s.output.maxBytes));observed=(await inspectRaster(bytes)).image;
   if(!same(observed,d.output.image))throw Error('Declared original does not match independently decoded bytes');
   if(observed.width>s.output.maxDimension||observed.height>s.output.maxDimension||observed.width*observed.height>s.output.maxPixels||!s.output.formats.includes(observed.format))throw Error('Original exceeds frozen output hard limits');
  }
  const submissionHash=digest({delivery:d,observed}),receiptId=productionReceiptId(j.id,submissionHash),prior=this.w.kernel.lookup({id:receiptId,version:1,freshness:'pinned'});
  if(prior)return this.read<ProductionReceipt>(reference(prior),'production-receipt');
  const current=this.read<Job>({id:jobId,version:this.w.kernel.currentVersion(jobId)!,freshness:'pinned'},'production-job');
  if(current.payload.state.receipt)return this.diagnostic(current,'conflict',submissionHash,'Same job returned a changed delivery; original result retained',d,bytes,observed);
  // A scope change while decoding forces historical evidence, never a current membership.
  const fresh=productionFresh(this.w.kernel.environment(),s),disposition=fresh?d.outcome:'historical';
  const writes:NodePacket<unknown>[]=[];let media:VersionRef|null=null,candidate:VersionRef|null=null,membership:VersionRef|null=null;
  if(observed&&bytes){
   const asset=[{id:observed.id,checksum:observed.checksum}];
   const m=packet({type:'media-asset',id:'production-media-'+digest(j.id),projectId:this.config.projectId,assets:asset,payload:{moduleId:'website',kind:'page-media',scope:'media',lockedValues:{},state:{image:observed,label:'Production original · '+d.provenance,role:fresh?'placeable':'reference',permission:'Declared '+d.provenance+'; provenance is not independently proven'}},provenance:{actor:'local-butler',source:'Independently decoded original; '+d.provenance,previous:null}});
   media=reference(m);writes.push(m);
   if(fresh){
    const c=packet({type:'design-artifact',id:'production-candidate-'+digest(j.id),projectId:this.config.projectId,assets:asset,dependencies:[media],payload:{moduleId:'website',kind:'raster-concept',scope:'page-exploration',lockedValues:{},state:{version:1,representation:'raster-v1',media,image:observed,orientation:'encoded-top-left',origin:'imported'}},provenance:{actor:'local-butler',source:'Verified production intake; '+d.provenance,previous:null}});
    candidate=reference(c);
    const member=packet({type:'work-record',id:'production-membership-'+digest(j.id),projectId:this.config.projectId,dependencies:dependencies([s.workUnit,candidate,...s.sources.flatMap(x=>x.candidate?[x.candidate]:[])]),payload:{moduleId:'website',kind:'raster-membership',scope:'page-exploration',lockedValues:{},state:{version:1,workUnit:s.workUnit,candidate,integrity:c.integrity,derivation:s.sources.flatMap(x=>x.candidate?[x.candidate]:[])}},provenance:{actor:'local-butler',source:'Verified current production proposal; no acceptance',previous:null}});
    membership=reference(member);writes.push(c,member);
   }
   this.w.assets.save(bytes,observed);
  }
  const receipt=this.make<ProductionReceipt>('production-receipt',{version:1,job:reference(j),delivery:d,submissionHash,disposition,message:fresh?'Verified delivery; no creative judgment or acceptance':'Late/cancelled/superseded delivery retained as historical evidence',observed,media,candidate,membership,verification:observed?'independently-decoded-original':'no-output',provenanceProof:'declaration-only'},[reference(j),...(media?[media]:[]),...(candidate?[candidate]:[]),...(membership?[membership]:[])],receiptId);
  const next=revise(j,{...j.payload,state:{...s,status:disposition,receipt:reference(receipt)}},'local-butler','Record verified delivery outcome');
  const {integrity:_,...body}=next;const bound=packet({...body,dependencies:dependencies([s.iteration,s.spec,reference(receipt)])});
  this.write([...writes,receipt,bound],()=>{if(this.w.kernel.currentVersion(j.id)!==j.version)throw Error('Concurrent intake changed job');if(productionFresh(this.w.kernel.environment(),s)!==fresh)throw Error('Production scope changed inside intake boundary');});return receipt;
 }
}
