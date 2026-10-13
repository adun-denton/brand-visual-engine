import { randomUUID } from 'node:crypto';
import type { Workspace } from './workspace.ts';
import { Exploration } from './exploration.ts';
import { NativeExchangeAdapter } from './native-exchange-adapter.ts';
import type { NodePacket, DesignArtifact, VersionRef } from '../kernel/contracts.ts';
import { canonical, digest, packet, reference, revise } from '../kernel/packets.ts';
import { revalidatePacket, writePort } from '../kernel/gate.ts';
import { nativeFresh, nativeRunId } from '../kernel/native-exchange-gate.ts';
import { compileRequest } from '../kernel/execution-gate.ts';
import { CanonicalMemory } from '../kernel/memory-index.ts';
import { parseExecution, type ExecutionRequest } from '../modules/website/execution-contracts.ts';
import { exactRef, type Specification, type RasterConcept, type Membership } from '../modules/website/exploration-contracts.ts';
import { nativeAdapter, parseNative, compileNativePackage, type NativeKind, type NativeGrant, type NativeRun, type NativeReceipt, type NativePackage } from '../modules/website/native-exchange-contracts.ts';
import { InputError, record, integer, string, bool, list } from './validation.ts';
type Work<T> = NodePacket<DesignArtifact<T>>;
const same=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
/** Manual controller only. This service has no image/account driver or transport, and no auto continuation. */
export class NativeExchange {
  readonly w:Workspace;readonly adapter=new NativeExchangeAdapter();readonly exploration:Exploration;
  private writes=new Set<string>();
  private static owners=new WeakMap<Workspace,NativeExchange>();
  static for(w:Workspace){let service=this.owners.get(w);if(!service){service=new NativeExchange(w);this.owners.set(w,service);}return service;}
  private constructor(w:Workspace){this.w=w;this.exploration=new Exploration(w);w.kernel.bindNativeAuthority(p=>this.writes.has(p.integrity));}
  private commit(packets:NodePacket<unknown>[],guard?:()=>void){
    for(const p of packets)this.writes.add(p.integrity);
    try{this.w.kernel.putMany(packets,guard);}finally{for(const p of packets)this.writes.delete(p.integrity);}
  }
  private audit(pid:string){
    // Ledger inventory, rather than surviving latest rows, prevents a lost release/claim restoring allowance.
    const rows=new CanonicalMemory(this.w.kernel.environment()).inventory(pid,false);
    if(rows.some(r=>!r.packet||r.corrupt))throw new InputError('Canonical evidence unavailable; allowance cannot be reconstructed',409);
    return rows.map(r=>r.packet!);
  }
  private own<T>(pid:string,r:VersionRef,kind:string):Work<T> {
    exactRef(r);this.w.project(pid);const p=this.w.kernel.get<DesignArtifact<T>>(r);
    if(p.projectId!==pid||p.payload.kind!==kind||p.type!=='work-record')throw new InputError('Foreign native reference');
    revalidatePacket(p,writePort(p.type),this.w.kernel.environment());return p;
  }
  private latest<T>(pid:string,r:VersionRef,kind:string):Work<T>{this.own(pid,r,kind);return this.own(pid,{...r,version:this.w.kernel.currentVersion(r.id)!},kind);}
  private make<T>(pid:string,kind:string,state:T,deps:VersionRef[],identity=kind+'-'+randomUUID()):Work<T>{return packet({type:'work-record',id:identity,projectId:pid,dependencies:[...new Map(deps.map(r=>[r.id+':'+r.version,r])).values()],payload:{moduleId:'website',kind,scope:'page-execution',lockedValues:{},state},provenance:{actor:'local-operator',source:'Explicit manual exchange; operator attestation only, no verified generation',previous:null}});}
  private deps(s:NativeRun){return [s.request,s.grant,...(s.retryOf?[s.retryOf.execution]:[]),...s.slots.flatMap(a=>a.receipt?[a.receipt]:[])];}
  private change(p:Work<NativeRun>,state:NativeRun){const n=revise(p,{...p.payload,state},'local-operator','Durable manual exchange transition'),{integrity:_,...body}=n;return packet({...body,dependencies:this.deps(state)});}
  private authority(pid:string,p:Work<NativeRun>){
    this.audit(pid);const g=this.latest<NativeGrant>(pid,p.payload.state.grant,'native-exchange-grant'),q=this.own<ExecutionRequest>(pid,p.payload.state.request,'raster-execution-request');
    if(g.payload.state.revoked||Date.parse(g.payload.state.expiresAt)<=Date.now()||!nativeFresh(this.w.kernel.environment(),q.payload.state))throw new InputError('Native authority stale, expired or revoked',409);
    return {g,q};
  }
  async compile(pid:string,spec:VersionRef,width:number,height:number){
    this.audit(pid);const p=this.exploration.read<Specification>(pid,spec,'raster-specification');
    const s=compileRequest(p,integer(width,8192),integer(height,8192),r=>this.w.kernel.lookup(r));parseExecution('raster-execution-request',s);
    if(s.sources.some(a=>a.entry?.preservation))throw new InputError('Native exact-preservation support is unverified');
    if(!nativeFresh(this.w.kernel.environment(),s))throw new InputError('Native request context is stale',409);
    for(const source of s.sources)await this.w.assets.inspect(source.image);
    const q=this.make(pid,'raster-execution-request',s,[spec,...s.sources.map(a=>a.media)]);
    this.commit([q],()=>{this.audit(pid);if(!nativeFresh(this.w.kernel.environment(),s))throw new InputError('Native context changed during preparation',409);});return q;
  }
  grant(pid:string,input:unknown){
    this.audit(pid);const r=record(input,['request','slots','maxSubmissions','maxStatusCalls','maxCancelCalls','timeoutMs','expiresAt','evidence','reason']),q=this.own<ExecutionRequest>(pid,exactRef(r['request']),'raster-execution-request');
    const s=parseNative('native-exchange-grant',{...r,version:2,adapter:nativeAdapter,request:reference(q),requestHash:q.integrity,revoked:false}) as NativeGrant;
    if(s.maxStatusCalls!==0||s.maxCancelCalls!==0)throw new InputError('Manual adapter has no remote status/cancel calls');
    if(Date.parse(s.expiresAt)<=Date.now()||!nativeFresh(this.w.kernel.environment(),q.payload.state))throw new InputError('Native grant expired/stale');
    const g=this.make(pid,'native-exchange-grant',s,[reference(q)]);this.commit([g]);return g;
  }
  prepare(pid:string,grant:VersionRef,retryOf:NativeRun['retryOf']=null){
    this.audit(pid);const g=this.latest<NativeGrant>(pid,grant,'native-exchange-grant'),q=this.own<ExecutionRequest>(pid,g.payload.state.request,'raster-execution-request'),identity=nativeRunId(reference(g));
    const existing=this.w.kernel.lookup({id:identity,version:1,freshness:'pinned'});
    if(existing){const p=this.latest<NativeRun>(pid,reference(existing),'native-exchange');if(!same(p.payload.state.retryOf,retryOf))throw new InputError('Native grant lineage already bound');return p;}
    const s:NativeRun={version:2,adapter:nativeAdapter,request:reference(q),requestHash:q.integrity,grant:reference(g),workUnit:q.payload.state.workUnit,slots:g.payload.state.slots.map(slot=>({slot,status:'pending',release:null,receipt:null,cancelRequested:false})),retryOf};
    const p=this.make(pid,'native-exchange',s,this.deps(s),identity);this.authority(pid,p);this.commit([p]);return p;
  }
  private sourceFiles(p:NativePackage){return new Map(p.sources.map((a,i)=>[a.path,this.w.assets.read(p.request.sources[i]!.image.id)]));}
  async exportRequest(pid:string,run:VersionRef,slot:number){
    this.audit(pid);let p=this.latest<NativeRun>(pid,run,'native-exchange');let a=p.payload.state.slots.find(a=>a.slot===slot);if(!a)throw new InputError('Unowned native slot');
    const {g,q}=this.authority(pid,p);
    if(a.cancelRequested||['uncertain','withdrawn','returned','failed'].includes(a.status))throw new InputError('Native package no longer executable');
    if(a.release)return this.adapter.request(a.release,this.sourceFiles(a.release));
    if(a.status!=='pending'||p.payload.state.slots.some(a=>a.release&&!a.receipt&&a.status!=='withdrawn'))throw new InputError('Native serial slot unavailable');
    const binding={projectId:pid,workUnit:q.payload.state.workUnit,spec:q.payload.state.spec,specHash:q.payload.state.specHash,request:reference(q),requestHash:q.integrity,grant:p.payload.state.grant,execution:{...reference(p),version:p.version+1},slot,submissionId:digest({execution:p.id,slot}),exchangeJobId:digest({nativeJob:p.id,slot})};
    const release=compileNativePackage(binding,q.payload.state,g.payload.state.evidence);
    // Validate and serialize originals before durable reservation. Failure after reservation never releases a new allowance.
    const out=await this.adapter.request(release,this.sourceFiles(release));
    p=this.latest(pid,reference(p),'native-exchange');a=p.payload.state.slots.find(a=>a.slot===slot)!;
    if(a.release)return this.adapter.request(a.release,this.sourceFiles(a.release));
    if(binding.execution.version!==p.version+1)throw new InputError('Native run changed while preparing package',409);
    const state=structuredClone(p.payload.state),s=state.slots.find(a=>a.slot===slot)!;s.release=release;s.status='awaiting-operator';
    this.commit([this.change(p,state)],()=>this.authority(pid,p));return out;
  }
  claim(pid:string,run:VersionRef,slot:number,packetDigest:string){
    const p=this.latest<NativeRun>(pid,run,'native-exchange');this.authority(pid,p);
    const s=structuredClone(p.payload.state),a=s.slots.find(a=>a.slot===slot);
    if(!a?.release||a.release.packetDigest!==packetDigest||a.status!=='awaiting-operator'||a.cancelRequested)throw new InputError('Native invocation claim denied or already consumed',409);
    a.status='claimed';const n=this.change(p,s);this.commit([n],()=>this.authority(pid,p));
    return {run:n,acknowledgement:'Invocation reported/claimed; operator attestation only',exchangeJobId:a.release.binding.exchangeJobId};
  }
  control(pid:string,run:VersionRef,slot:number,action:'cancel'|'uncertain'){
    this.audit(pid);const p=this.latest<NativeRun>(pid,run,'native-exchange'),s=structuredClone(p.payload.state),a=s.slots.find(a=>a.slot===slot);
    if(!a)throw new InputError('Unowned native control');if(a.receipt)return p;
    if(action==='cancel'){a.cancelRequested=true;if(['pending','awaiting-operator'].includes(a.status))a.status='withdrawn';else if(a.status==='claimed')a.status='uncertain';}
    else {if(!a.release||!['awaiting-operator','claimed','uncertain'].includes(a.status))throw new InputError('No released native attempt');a.status='uncertain';}
    if(same(s,p.payload.state))return p;const n=this.change(p,s);this.commit([n]);return n;
  }
  revoke(pid:string,grant:VersionRef){this.audit(pid);const p=this.latest<NativeGrant>(pid,grant,'native-exchange-grant');if(p.payload.state.revoked)return p;const n=revise(p,{...p.payload,state:{...p.payload.state,revoked:true}},'local-operator','Withdraw future manual invocation claims; no termination proof');this.commit([n]);return n;}
  async importResult(pid:string,run:VersionRef,manifest:Buffer,files:Map<string,Buffer>,historical:boolean){
    this.audit(pid);const {result,bytes}=await this.adapter.readResult(manifest,files);
    const identity='native-receipt-'+digest({job:result.binding.exchangeJobId,receipt:result.receiptId}),payloadHash=digest(result);
    const duplicate=()=>{const d=this.w.kernel.lookup({id:identity,version:1,freshness:'pinned'}) as Work<NativeReceipt>|null;if(!d)return null;if(d.projectId!==pid||d.payload.state.payloadHash!==payloadHash||d.payload.state.result.binding.execution.id!==run.id)throw new InputError('Conflicting native receipt payload',409);return this.own<NativeReceipt>(pid,reference(d),'native-exchange-receipt');};
    const prior=duplicate();if(prior)return prior;
    const p=this.latest<NativeRun>(pid,run,'native-exchange'),s=p.payload.state,a=s.slots.find(a=>a.slot===result.binding.slot),q=this.own<ExecutionRequest>(pid,s.request,'raster-execution-request'),g=this.latest<NativeGrant>(pid,s.grant,'native-exchange-grant');
    if(!a?.release||a.receipt||!same(a.release.binding,result.binding)||a.release.packetDigest!==result.packetDigest||a.release.evidence!==result.attestation.kind)throw new InputError('Native result unbound, forged or already consumed');
    const image=result.output?.image??null;
    if(image&&(image.width!==q.payload.state.width||image.height!==q.payload.state.height))throw new InputError('Native result dimensions mismatch; original rejected atomically');
    if(image&&q.payload.state.sources.some(a=>a.image.checksum===image.checksum))throw new InputError('Native output cannot substitute an input original');
    const late=a.cancelRequested||['uncertain','withdrawn'].includes(a.status)||g.payload.state.revoked||Date.parse(g.payload.state.expiresAt)<=Date.now()||!nativeFresh(this.w.kernel.environment(),q.payload.state);
    if(late&&!historical)throw new InputError('Explicit historical intake required for late native evidence',409);
    if(!late&&a.status!=='claimed')throw new InputError('Native result needs explicit invocation report/claim');
    const outcome=late?'historical':result.outcome,writes:NodePacket<unknown>[]=[];
    let media:NodePacket<DesignArtifact<unknown>>|null=null,candidate:Work<RasterConcept>|null=null;
    if(image){
      media=packet({type:'media-asset',id:'page-media-'+randomUUID(),projectId:pid,assets:[{id:image.id,checksum:image.checksum}],payload:{moduleId:'website',kind:'page-media',scope:'media',lockedValues:{},state:{image,label:result.attestation.kind==='synthetic-fixture'?'Synthetic native-envelope fixture · not generated':'Manual native return · operator attested, unverified',role:late?'reference':'placeable',permission:result.rights}}});writes.push(media);
      if(!late){candidate=packet<DesignArtifact<RasterConcept>>({type:'design-artifact',id:'raster-concept-'+randomUUID(),projectId:pid,dependencies:[reference(media)],assets:[{id:image.id,checksum:image.checksum}],payload:{moduleId:'website',kind:'raster-concept',scope:'page-exploration',lockedValues:{},state:{version:1,representation:'raster-v1',media:reference(media),image,orientation:'encoded-top-left',origin:'imported'}},provenance:{actor:'local-operator',source:'Original manual import; native generation not machine verified',previous:null}});
        const membership=packet<DesignArtifact<Membership>>({type:'work-record',id:'raster-membership-'+randomUUID(),projectId:pid,dependencies:[s.workUnit,reference(candidate)],payload:{moduleId:'website',kind:'raster-membership',scope:'page-exploration',lockedValues:{},state:{version:1,workUnit:s.workUnit,candidate:reference(candidate),integrity:candidate.integrity,derivation:[]}}});writes.push(candidate,membership);}
      this.w.assets.save(bytes!,image);await this.w.assets.inspect(image);
    }
    const receiptState:NativeReceipt={version:2,adapter:nativeAdapter,execution:reference(p),result,payloadHash,outcome,candidate:candidate?reference(candidate):null,media:media?reference(media):null,image};
    const receipt=this.make(pid,'native-exchange-receipt',receiptState,[reference(p),s.request,...(candidate?[reference(candidate)]:[]),...(media?[reference(media)]:[])],identity);
    const next=structuredClone(s),slot=next.slots.find(a=>a.slot===result.binding.slot)!;slot.receipt=reference(receipt);if(!late)slot.status=result.outcome;else if(slot.status==='claimed'||slot.status==='awaiting-operator')slot.status='uncertain';
    this.commit([...writes,receipt,this.change(p,next)],()=>{this.audit(pid);if(this.w.kernel.currentVersion(p.id)!==p.version)throw new InputError('Native run changed during intake',409);});return receipt;
  }
  state(pid:string,unit:VersionRef){
    const rows=new CanonicalMemory(this.w.kernel.environment()).inventory(pid,false),missing=rows.filter(r=>!r.packet||r.corrupt).length;
    const runs=rows.flatMap(r=>r.packet&&r.packet.payload&&((r.packet.payload as DesignArtifact<unknown>).kind==='native-exchange')&&this.w.kernel.currentVersion(r.packet.id)===r.packet.version?[r.packet as Work<NativeRun>]:[]).filter(p=>same(p.payload.state.workUnit,unit));
    return {manual:true,unavailableEvidence:missing,runs:runs.map(run=>({run,grant:this.latest<NativeGrant>(pid,run.payload.state.grant,'native-exchange-grant'),slots:run.payload.state.slots.map(a=>({...a,receipt:a.receipt?this.own<NativeReceipt>(pid,a.receipt,'native-exchange-receipt'):null})),message:'Stored progress only. No invocation on refresh/reopen.'}))};
  }
  async command(pid:string,action:string,input:unknown):Promise<unknown>{
    if(action==='prepare'){
      const r=record(input,['expectedProject','spec','width','height','slots','expiresAt','evidence','retryOf']);this.w.project(pid,exactRef(r['expectedProject']));
      const retry=r['retryOf']===null?null:record(r['retryOf'],['execution','slot']);
      const parent=retry?this.latest<NativeRun>(pid,exactRef(retry['execution']),'native-exchange'):null;
      const q=parent?this.own<ExecutionRequest>(pid,parent.payload.state.request,'raster-execution-request'):await this.compile(pid,exactRef(r['spec']),integer(r['width'],8192),integer(r['height'],8192));
      const slots=list(r['slots'],s=>integer(s,6),6),g=this.grant(pid,{request:reference(q),slots,maxSubmissions:slots.length,maxStatusCalls:0,maxCancelCalls:0,timeoutMs:30000,expiresAt:r['expiresAt'],evidence:r['evidence'],reason:'Explicit manual exchange grant; no automatic invocation'});
      return this.prepare(pid,reference(g),parent?{execution:reference(parent),slot:integer(retry!['slot'],6)}:null);
    }
    const r=record(input,action==='import'?['run','manifest','files','historical']:action==='claim'?['run','slot','packetDigest']:['run','slot']);
    const run=exactRef(r['run']);
    if(action==='export')return this.exportRequest(pid,run,integer(r['slot'],6));
    if(action==='claim')return this.claim(pid,run,integer(r['slot'],6),string(r['packetDigest'],64));
    if(action==='cancel'||action==='uncertain')return this.control(pid,run,integer(r['slot'],6),action);
    if(action==='revoke'){const p=this.latest<NativeRun>(pid,run,'native-exchange');return this.revoke(pid,p.payload.state.grant);}
    if(action==='import'){
      const files=list(r['files'],f=>{const a=record(f,['path','base64']);const b=string(a['base64'],12*1024*1024);if(!/^[A-Za-z0-9+/]*={0,2}$/.test(b))throw new InputError('Invalid original upload encoding');const bytes=Buffer.from(b,'base64');if(bytes.toString('base64')!==b)throw new InputError('Noncanonical original upload');return {path:string(a['path'],100),bytes};},1);
      return this.importResult(pid,run,Buffer.from(string(r['manifest'],262144)),this.adapter.fileInput(files),bool(r['historical']));
    }
    throw new InputError('Unknown manual exchange action',404);
  }
}
