import type { GateEnvironment } from './gate.ts';
import type { NodePacket, DesignArtifact, VersionRef } from './contracts.ts';
import { canonical, digest, reference } from './packets.ts';
import { nativeRoles, parseNative, compileNativePackage, type NativeKind, type NativeGrant, type NativeRun, type NativeReceipt } from '../modules/website/native-exchange-contracts.ts';
import type { ExecutionRequest } from '../modules/website/execution-contracts.ts';
import type { Specification, RasterConcept } from '../modules/website/exploration-contracts.ts';
const eq=(a:unknown,b:unknown,message:string)=>{if(canonical(a)!==canonical(b))throw Error(message);};
export function nativeFresh(env:GateEnvironment,q:ExecutionRequest):boolean {
  const p=env.lookup(q.spec) as NodePacket<DesignArtifact<Specification>>|null;
  if(!p||p.integrity!==q.specHash)return false;
  const s=p.payload.state;
  const refs=[s.project,s.workUnit,...(s.selections?[s.selections]:[]),...(s.brand.enabled?[s.brand.source]:[]),...q.sources.flatMap(a=>[a.media,...(a.entry?[a.entry.candidate]:[])])];
  if(refs.some(r=>env.currentVersion(r.id)!==r.version))return false;
  const seq=env.projectEvents?.(p.projectId!)??[];
  const created=seq.find(e=>e.kind==='revision'&&e.subject.id===p.id)?.sequence??0;
  return !seq.some(e=>e.kind==='acceptance'&&e.sequence>created);
}
export const nativeRunId=(g:VersionRef)=>'native-exchange-'+digest(g.id);
export function nativeExchangeGate(p:NodePacket<unknown>,previous:NodePacket<unknown>|null,env:GateEnvironment) {
  const a=p.payload as DesignArtifact<unknown>,old=previous?.payload as DesignArtifact<unknown>|undefined;
  if(old&&Object.hasOwn(nativeRoles,old.kind)&&old.kind!==a.kind)throw Error('Native kind immutable');
  if(!Object.hasOwn(nativeRoles,a.kind))return;
  if(p.type!=='work-record'||p.approval!=='proposal'||p.contextRefs.length||p.assets.length||p.constraints.length||p.placeholders.length)throw Error('Native envelope');
  const stored=env.lookup(reference(p));
  if(!stored&&!env.nativeWriteAllowed?.(p))throw Error('Native write requires owned adapter controller');
  if(!stored&&(env.projectRefs?.(p.projectId!,4096,false)??[]).some(r=>r.id===p.id&&r.version===p.version))throw Error('Lost native canonical evidence cannot replenish allowance');
  const s=parseNative(a.kind as NativeKind,a.state),deps:VersionRef[]=[];
  const own=<T>(r:VersionRef,kind:string)=>{const n=env.lookup(r) as NodePacket<DesignArtifact<T>>|null;if(!n||n.projectId!==p.projectId||n.payload.kind!==kind)throw Error('Native dependency owner/kind');deps.push(r);return n;};
  if(a.kind==='native-exchange-grant'){
    const g=s as NativeGrant,q=own<ExecutionRequest>(g.request,'raster-execution-request');
    if(q.integrity!==g.requestHash||g.maxSubmissions!==g.slots.length||g.slots.some(i=>i>q.payload.state.count))throw Error('Native grant binding/bounds');
    if(previous){const before=(previous.payload as DesignArtifact<NativeGrant>).state;eq({...before,revoked:false},{...g,revoked:false},'Native grant terms immutable');if(before.revoked||!g.revoked)throw Error('Native revocation monotonic');}
    else if(g.revoked)throw Error('New native grant revoked');
  } else if(a.kind==='native-exchange'){
    const e=s as NativeRun,q=own<ExecutionRequest>(e.request,'raster-execution-request'),g=own<NativeGrant>(e.grant,'native-exchange-grant');
    if(p.id!==nativeRunId(e.grant)||q.integrity!==e.requestHash)throw Error('Native execution identity');
    eq([e.request,e.requestHash],[g.payload.state.request,g.payload.state.requestHash],'Native request/grant');eq(e.workUnit,q.payload.state.workUnit,'Native unit');eq(e.slots.map(a=>a.slot),g.payload.state.slots,'Native slots');
    const latestGrant=env.lookup({...e.grant,version:env.currentVersion(e.grant.id)!}) as NodePacket<DesignArtifact<NativeGrant>>;
    const allowed=()=>{if(latestGrant.payload.state.revoked||Date.parse(latestGrant.payload.state.expiresAt)<=Date.now()||!nativeFresh(env,q.payload.state))throw Error('Native claim/release authority stale, expired or revoked');};
    const before=previous?(previous.payload as DesignArtifact<NativeRun>).state:null;
    if(before)eq({...before,slots:[]},{...e,slots:[]},'Native run binding immutable');
    if(e.retryOf){const parent=own<NativeRun>(e.retryOf.execution,'native-exchange').payload.state,slot=parent.slots.find(a=>a.slot===e.retryOf!.slot);if(parent.grant.id===e.grant.id||!slot||!['failed','uncertain','withdrawn'].includes(slot.status))throw Error('Manual retry needs consumed parent and new authority');eq(parent.request,e.request,'Native retry request');eq(e.slots.map(a=>a.slot),[slot.slot],'Native retry slot');}
    for(const slot of e.slots){
      const prior=before?.slots.find(a=>a.slot===slot.slot);
      if(!before&&(slot.status!=='pending'||slot.release||slot.receipt||slot.cancelRequested))throw Error('Native starts unreserved');
      if(prior?.receipt)eq(slot,prior,'Consumed native output immutable');
      if(prior?.release)eq(slot.release,prior.release,'Native release immutable');
      if(prior?.cancelRequested&&!slot.cancelRequested)throw Error('Native cancellation monotonic');
      if(prior&&slot.status!==prior.status){const transitions:Record<string,string[]>={pending:['awaiting-operator','withdrawn'],'awaiting-operator':['claimed','uncertain','withdrawn'],claimed:['returned','failed','uncertain'],uncertain:[],withdrawn:[],returned:[],failed:[]};if(!transitions[prior.status]?.includes(slot.status))throw Error('Native status cannot restore/resend');}
      if(slot.release){
        const b=slot.release.binding;
        eq(slot.release,compileNativePackage(b,q.payload.state,g.payload.state.evidence),'Native frozen package');
        eq([b.projectId,b.workUnit,b.spec,b.specHash,b.request,b.requestHash,b.grant,b.execution.id,b.slot,b.submissionId,b.exchangeJobId],[p.projectId,e.workUnit,q.payload.state.spec,q.payload.state.specHash,e.request,e.requestHash,e.grant,p.id,slot.slot,digest({execution:p.id,slot:slot.slot}),digest({nativeJob:p.id,slot:slot.slot})],'Native package binding');
        if(b.execution.version>p.version||!prior?.release&&b.execution.version!==p.version)throw Error('Native release revision');
        if(slot.status==='pending')throw Error('Released native slot cannot become pending');
      } else if(!['pending','withdrawn'].includes(slot.status))throw Error('Native consumed slot lacks package');
      if(!stored&&((!prior?.release&&slot.release)||(prior?.status==='awaiting-operator'&&slot.status==='claimed'))){allowed();if(slot.cancelRequested)throw Error('Native revoked invocation intent');if(e.slots.some(a=>a.slot!==slot.slot&&a.release&&!a.receipt&&a.status!=='withdrawn'))throw Error('Native slots require explicit serial continuation');}
      if(['returned','failed'].includes(slot.status)&&!slot.receipt)throw Error('Native terminal status needs receipt');
      if(slot.receipt){const receipt=own<NativeReceipt>(slot.receipt,'native-exchange-receipt').payload.state;eq([receipt.result.binding.execution.id,receipt.result.binding.slot,receipt.result.packetDigest],[p.id,slot.slot,slot.release?.packetDigest],'Native receipt ownership');if(receipt.outcome!=='historical'&&receipt.outcome!==slot.status)throw Error('Native receipt status');}
    }
  } else {
    const r=s as NativeReceipt;if(r.payloadHash!==digest(r.result))throw Error('Native payload hash mismatch');const e=own<NativeRun>(r.execution,'native-exchange').payload.state,slot=e.slots.find(a=>a.slot===r.result.binding.slot),q=own<ExecutionRequest>(e.request,'raster-execution-request').payload.state;
    if(!slot?.release||slot.receipt||p.id!=='native-receipt-'+digest({job:slot.release.binding.exchangeJobId,receipt:r.result.receiptId}))throw Error('Native receipt identity');
    eq(r.result.binding,slot.release.binding,'Native return binding');if(r.result.packetDigest!==slot.release.packetDigest||r.result.attestation.kind!==slot.release.evidence)throw Error('Native return provenance/digest');
    const late=slot.cancelRequested||['uncertain','withdrawn'].includes(slot.status)||!nativeFresh(env,q)||Date.parse((env.lookup({...e.grant,version:env.currentVersion(e.grant.id)!}) as NodePacket<DesignArtifact<NativeGrant>>).payload.state.expiresAt)<=Date.now()||(env.lookup({...e.grant,version:env.currentVersion(e.grant.id)!}) as NodePacket<DesignArtifact<NativeGrant>>).payload.state.revoked;
    if(!stored){if(env.currentVersion(r.execution.id)!==r.execution.version)throw Error('Native stale intake revision');if(late&&r.outcome!=='historical'||!late&&slot.status!=='claimed')throw Error('Native intake needs reported claim or historical authority');}
    if(r.outcome!=='historical'&&r.outcome!==r.result.outcome)throw Error('Native outcome mismatch');
    if((r.outcome==='returned')!==(r.candidate!==null)||(r.image===null)!==(r.media===null))throw Error('Native output closure');
    if(r.candidate){const c=own<RasterConcept>(r.candidate,'raster-concept');if(c.payload.state.origin!=='imported')throw Error('Native result must retain imported origin');eq([c.payload.state.media,c.payload.state.image],[r.media,r.image],'Native candidate media');}
    if(r.media){const m=own<{image:unknown;role:string}>(r.media,'page-media');eq(m.payload.state.image,r.image,'Native media facts');eq(r.image,r.result.output?.image,'Native original output');if(!env.imageMatches?.(r.image!)||r.image!.width!==q.width||r.image!.height!==q.height||r.outcome==='historical'&&m.payload.state.role!=='reference')throw Error('Native strict original dimensions/role');}
    if(previous)throw Error('Native receipt immutable');
  }
  eq(p.dependencies,[...new Map(deps.map(r=>[r.id+':'+r.version,r])).values()],'Native exact closure');
}
