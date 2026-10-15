import type { NativeRun, NativeGrant, NativeReceipt } from '../modules/website/native-exchange-contracts.ts';
import type { VersionRef, DesignArtifact, NodePacket } from '../kernel/contracts.ts';
type Work<T>=NodePacket<DesignArtifact<T>>;
export interface NativeViewState {manual:boolean;unavailableEvidence:number;runs:{run:Work<NativeRun>;grant:Work<NativeGrant>;slots:{slot:number;status:string;release:NativeRun['slots'][number]['release'];receipt:Work<NativeReceipt>|null;cancelRequested:boolean}[];message:string}[];}
const pointer=(p:{id:string;version:number}):VersionRef=>({id:p.id,version:p.version,freshness:'pinned'});
type RunView = NativeViewState['runs'][number];
type SlotView = RunView['slots'][number];
const policyLabel = (a: SlotView) => a.release?.request.version === 2 && a.release.request.dimensionPolicy.mode === 'native-resolution' ? 'Native resolution · preferences' : 'Exact size required';
/** Administrative context only. The immutable kit remains the receiving artifact. */
export function nativeHandoff(e: RunView, a: SlotView): string {
  const p = a.release;
  if (!p) return '';
  return [
    'BVE manual exchange — administrative handoff, not invocation approval.',
    `Project: ${p.binding.projectId}; page: ${p.binding.workUnit.id}:${p.binding.workUnit.version}`,
    `Run: ${p.binding.execution.id}:${p.binding.execution.version}; slot: ${p.binding.slot}; job: ${p.binding.exchangeJobId}`,
    `Packet SHA-256: ${p.packetDigest}`,
    `Saved state: ${a.status}; receipt: ${a.receipt?.payload.state.outcome ?? 'none'}; grant expiry: ${e.grant.payload.state.expiresAt}; revoked: ${e.grant.payload.state.revoked}`,
    `Size policy: ${policyLabel(a)}; requested ${p.request.width}×${p.request.height}.`,
    `Operation: ${p.request.operation}; ordered original sources: ${p.sources.length}.`,
    ...p.sources.map((s, i) => `Source ${i + 1}: ${s.path}; SHA-256 ${s.checksum}`),
    'Download the complete bound return kit and deliver its files to a separate image-capable session. Use its frozen manifest/prompt, exact ordered sources, schema, templates and offline builder; do not rewrite or combine archives.',
    'Obtain separate operator approval for this exact slot. Report invocation / claim in BVE before invoking; stop if denied, expired, revoked, withdrawn, already consumed or uncertain. Copying or downloading grants no new approval and performs no invocation.',
    'Never automatically retry. If the external outcome is unknown, mark it uncertain and stop. A re-download is the same reservation, not another call.',
    p.instructions,
    'Retrieve the exact original output file. Verify bytes/hash and dimensions using the kit builder, then explicitly import its result manifest and original into this same run/slot. Stop on missing originals or validation failure. Do not resize, re-encode or substitute sources.',
    'Refresh or cold reopen reads saved evidence only. Historical intake creates no current proposal. Inspect the result before separately selecting, saving to Library or accepting.'
  ].join('\n');
}
export function nativeGuidance(a: SlotView): string {
  if (a.receipt?.payload.state.outcome === 'historical') return 'Historical evidence only. No current proposal; the saved terminal state and consumed allowance remain.';
  if (a.status === 'returned') return 'Original imported as a proposal. Inspect it in the canvas; selection, Library save and acceptance remain separate.';
  if (a.status === 'failed') return 'Failure evidence retained. No successful result; any new retry requires an explicit new grant and separate approval.';
  if (a.status === 'uncertain') return 'External outcome unknown. Stop; no automatic retry or restored allowance. Late evidence requires explicit historical intake.';
  if (a.status === 'withdrawn') return 'Withdrawn / cancellation intent retained. External termination is unknown; late evidence requires explicit historical intake.';
  if (a.status === 'claimed') return 'Claim recorded as operator attestation only. This does not prove a host call or output. Import exact original evidence when available; stop on unknown outcome.';
  if (a.status === 'awaiting-operator') return 'Frozen slot reserved. Download the complete return kit; separately obtain approval and report claim before using the external session.';
  return 'Prepared only. Explicitly export this slot to reserve its frozen handoff; no invocation has been reported.';
}
/** Fail before POST on accidental empty, repeated or out-of-range slot tokens. */
export function nativeSlots(text: string): number[] {
  if (!/^\s*[1-6]\s*(,\s*[1-6]\s*)*$/.test(text)) throw Error('Choose explicit slots 1–6, comma separated; no empty slots.');
  const slots = text.split(',').map(Number);
  if (new Set(slots).size !== slots.length) throw Error('Choose each slot only once.');
  return slots;
}
export function nativeView(state:NativeViewState,esc:(x:unknown)=>string,specs:Work<unknown>[],open=false) {
  const slotView = (e: RunView, a: SlotView) => {
    const p = a.release, receipt = a.receipt?.payload.state, handoffId = `native-handoff-${e.run.id}-${a.slot}`;
    const serialBlocked = !p && e.slots.some(other=>other.slot!==a.slot&&other.release&&!other.receipt&&other.status!=='withdrawn');
    const attrs = `data-native-run="${esc(e.run.id)}" data-slot="${a.slot}"`;
    return `<section class="native-slot" aria-label="Slot ${a.slot}"><h4>Slot ${a.slot}</h4><p>Saved state: <strong>${esc(a.status)}</strong>${a.cancelRequested?' · cancellation intent retained; termination unknown':''}</p>
      <p class="native-guidance">${esc(nativeGuidance(a))}</p>
      <div class="native-step"><h5>2. Download the bound handoff</h5><p>The complete return kit is the receiving-session artifact: frozen request, ordered original sources, schema, templates and offline builder. Export the request first to reserve this slot. Downloads retain the same frozen bytes. Slots run serially: finish or withdraw an earlier released slot before exporting the next.${serialBlocked?' This slot is waiting for the earlier released slot.':''}</p>
      <button data-native-action="export" ${attrs} ${['pending','awaiting-operator','claimed'].includes(a.status)&&!e.grant.payload.state.revoked&&!a.cancelRequested&&!serialBlocked?'':'disabled'}>${p?'Re-download request':'Export request'}</button>
      <button data-native-action="return-kit" ${attrs} ${p?'':'disabled'}>Export return kit</button>
      ${p?`<details class="native-handoff"><summary>Administrative handoff · run / slot ${a.slot}</summary><label for="${esc(handoffId)}">Copy with the complete kit; this text grants no approval<textarea id="${esc(handoffId)}" readonly rows="9">${esc(nativeHandoff(e,a))}</textarea></label><button type="button" data-native-copy="${esc(handoffId)}">Copy handoff instructions</button><p data-native-copy-status role="status"></p></details>`:''}</div>
      <div class="native-step"><h5>3. Report claim before external invocation</h5><p>Use a separately approved image-capable session. BVE does not invoke ChatGPT. Stop on denial or expiry; a saved claim is attestation, not proof of generation.</p>
      <button data-native-action="claim" ${attrs} ${a.status==='awaiting-operator'&&!e.grant.payload.state.revoked?'':'disabled'}>Report invocation / claim</button>
      <button data-native-action="cancel" ${attrs} ${a.receipt?'disabled':''}>Withdraw / cancel intent</button>
      <button data-native-action="uncertain" ${attrs} ${p&&!a.receipt&&['awaiting-operator','claimed'].includes(a.status)?'':'disabled'}>Mark outcome uncertain</button></div>
      ${p?`<p class="native-dimensions">${policyLabel(a)}: ${p.request.width}×${p.request.height}; ${receipt?.image?`returned original ${receipt.image.width}×${receipt.image.height} · ratio ${receipt.image.width}:${receipt.image.height}`:'original not received'}. ${policyLabel(a).includes('preferences')?'Exact size or ratio compliance is not claimed.':''}</p><p class="native-sources">${esc(p.request.operation)} · ${p.sources.length} ordered original source(s)${p.request.sources.map((s,i)=>`; source ${i+1}: media ${esc(s.media.id)}:${s.media.version}${s.entry?`, candidate ${esc(s.entry.candidate.id)}:${s.entry.candidate.version}`:''}`).join('')}. Exact source files and hashes are in the kit.</p>`:''}
      ${p&&!a.receipt?`<form data-native-import="${esc(e.run.id)}" data-slot="${a.slot}"><h5>4. Import manifest and untouched original</h5><p class="native-import-scope">Selected run ${esc(e.run.id)}, slot ${a.slot} · ${policyLabel(a)}: ${p.request.width}×${p.request.height}. Use the kit's offline builder; no archive intake or image conversion.</p><label>Result manifest<input name="manifest" type="file" accept=".json,application/json" required></label><label>Original image<input name="original" type="file" accept="image/png,image/jpeg,image/webp"></label><p data-native-incoming role="status">No incoming files selected. Server validation remains authoritative.</p><label><input name="historical" type="checkbox"> Retain late evidence as history only</label><button>Import result</button></form>`:''}
      ${receipt?`<div class="native-review"><h5>5. Inspect the received evidence</h5><p>${receipt.outcome==='historical'?'Historical only · no current candidate.':receipt.candidate?`Current proposal: ${esc(receipt.candidate.id)}:${receipt.candidate.version}. Inspect in the candidate canvas.`:'Failure received · no current candidate.'} Imported provenance · ${esc(receipt.result.attestation.kind)} · operator attestation only.</p><p>Saving the whole raster to Library and design acceptance are separate actions; import does neither.</p></div>`:''}
      <button data-native-retry="${esc(e.run.id)}" data-slot="${a.slot}" ${['failed','uncertain','withdrawn'].includes(a.status)?'':'disabled'}>Prepare retry for slot ${a.slot}</button><p>Retry preparation is explicit, requires a new lifetime and grants no external approval or automatic dispatch.</p>
      <details><summary>Exchange inspector</summary><pre>${esc(JSON.stringify({release:p,receipt},null,2))}</pre></details></section>`;
  };
  return `<details id="native-exchange-panel" class="execution" ${open?'open':''}><summary>Export request / Import result · manual exchange</summary>
    <p>Manual route to a separate image-capable session. BVE does not call a native image tool or automatically invoke ChatGPT.</p>
    <ol class="native-guide"><li>Prepare an explicit grant.</li><li>Export the request, then download the complete return kit.</li><li>Separately approve and report claim before external invocation.</li><li>Use the offline builder, then import manifest and exact original.</li><li>Inspect the proposal; selection, Library save and acceptance are separate.</li></ol>
    ${state.unavailableEvidence?'<p role="alert">Canonical evidence unavailable. Invocation allowance cannot be restored.</p>':''}
    <form id="native-prepare"><h3>1. Prepare a manual grant</h3><p>Choose the frozen request for this page, a size policy, explicit slots and a lifetime. This prepares evidence only; it does not infer an approval or call budget.</p><div class="execution-fields"><label>Frozen request<select name="spec" required>${specs.map((p,i)=>`<option value="${esc(p.id)}">Prepared request ${i+1} · ${esc(p.id)}:${p.version}</option>`).join('')}</select></label><label>Size policy<select name="dimensionMode"><option value="exact">Exact size required</option><option value="native-resolution">Native resolution · size preferences</option></select></label><label>Requested width<input name="width" type="number" min="1" max="8192" required></label><label>Requested height<input name="height" type="number" min="1" max="8192" required></label><label>Slots (1–6, comma separated)<input name="slots" required placeholder="Choose explicit slots"></label><label>Grant lifetime in seconds<input name="lifetime" type="number" min="1" max="86400" required></label><label>Provenance<select name="evidence"><option value="operator-attested-native">Operator-attested native</option><option value="synthetic-fixture">Authored synthetic fixture</option></select></label></div><p>Exact size is the default requirement. Native resolution deliberately makes dimensions preferences; actual dimensions and ratio come from the untouched original.</p><button>Prepare manual grant</button></form>
    ${state.runs.map((e,i)=>`<article class="execution-run"><h3>Manual exchange ${i+1}</h3><p class="native-run-scope">Run ${esc(e.run.id)} · page ${esc(e.run.payload.state.workUnit.id)}:${e.run.payload.state.workUnit.version} · expiry ${esc(e.grant.payload.state.expiresAt)}${e.grant.payload.state.revoked?' · revoked':''}</p><p>${e.grant.payload.state.evidence==='synthetic-fixture'?'Authored synthetic fixture · no native invocation':'Operator-attested native · unverified'}</p>${e.slots.map(a=>slotView(e,a)).join('')}<button data-native-action="revoke" data-native-run="${esc(e.run.id)}" data-slot="1" ${e.grant.payload.state.revoked?'disabled':''}>Revoke future invocation claims</button><details><summary>Grant inspector</summary><pre>${esc(JSON.stringify(e.grant.payload.state,null,2))}</pre></details></article>`).join('')}
    <button id="native-refresh">Refresh stored progress</button><p>Refresh and restart read saved state only. Downloads, copy and refresh never claim, invoke, retry, select or accept. Unknown outcomes remain unknown.</p></details>`;
}
export function bindNative(root:HTMLElement,state:NativeViewState,specs:Work<unknown>[],ctx:{pid:string;project:VersionRef;token:string;run:(f:()=>Promise<unknown>,message:string)=>Promise<unknown>}) {
  const call=async(action:string,input:unknown,download=false)=>{
    const r=await fetch('/api/v1/visual/native/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-BVE-Token':ctx.token},body:JSON.stringify({projectId:ctx.pid,input})});
    if(!r.ok){const body=await r.json();throw Error(body.error??'Manual exchange rejected');}
    if(download){const blob=await r.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=action==='return-kit'?'native-return-kit.tar':'native-request.tar';a.click();URL.revokeObjectURL(url);return;}
    return r.json();
  };
  root.querySelectorAll<HTMLButtonElement>('[data-native-copy]').forEach(b=>b.onclick=async()=>{
    const text=root.querySelector<HTMLTextAreaElement>('#'+CSS.escape(b.dataset['nativeCopy']!))!,status=b.closest('.native-handoff')!.querySelector<HTMLElement>('[data-native-copy-status]')!;
    try{await navigator.clipboard.writeText(text.value);status.textContent='Administrative handoff copied. No approval, claim or invocation performed.';}
    catch{text.focus();text.select();status.textContent='Clipboard unavailable. Copy the selected text manually; no claim or invocation performed.';}
  });
  root.querySelectorAll<HTMLFormElement>('[data-native-import]').forEach(f=>{
    let revision=0;
    f.addEventListener('change',async()=>{
      const ticket=++revision,data=new FormData(f),file=data.get('manifest') as File,original=data.get('original') as File,output=f.querySelector<HTMLElement>('[data-native-incoming]')!;
      let message=original.size?`Selected original: ${original.name} · ${original.size} bytes. `:'No original selected. ';
      try{
        if(file.size>262144||original.size>8*1024*1024)throw Error('Manifest or original exceeds limits');
        if(file.size){const m=JSON.parse(await file.text());message+=`Manifest declares slot ${m.binding?.slot ?? 'missing'}, outcome ${m.outcome ?? 'missing'}${m.output?.image?`, ${m.output.image.width}×${m.output.image.height}, SHA-256 ${m.output.image.checksum}`:''}. `;if(m.binding?.execution?.id!==f.dataset['nativeImport']||m.binding?.slot!==Number(f.dataset['slot']))message+='Scope mismatch: this is not the selected run/slot. ';}
        message+='Declarations are unverified until server byte/hash, image and frozen-policy validation. '+(data.has('historical')?'Historical intake selected; no current proposal.':'Current intake requested; terminal evidence may require history only.');
      }catch(e){message+=e instanceof Error?e.message:'Cannot read manifest';}
      if(ticket===revision&&f.isConnected)output.textContent=message;
    });
  });
  root.querySelector<HTMLFormElement>('#native-prepare')?.addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.currentTarget as HTMLFormElement),spec=specs.find(s=>s.id===f.get('spec'));if(!spec)return;void ctx.run(()=>{const slots=nativeSlots(String(f.get('slots')));return call('prepare',{expectedProject:ctx.project,spec:pointer(spec),width:Number(f.get('width')),height:Number(f.get('height')),dimensionPolicy:{version:1,mode:f.get('dimensionMode')},slots,expiresAt:new Date(Date.now()+Number(f.get('lifetime'))*1000).toISOString(),evidence:f.get('evidence'),retryOf:null});},'Manual grant prepared; export is a separate action.');});
  root.querySelectorAll<HTMLButtonElement>('[data-native-action]').forEach(b=>b.onclick=()=>{const e=state.runs.find(e=>e.run.id===b.dataset['nativeRun'])!,slot=Number(b.dataset['slot']),a=e.slots.find(a=>a.slot===slot),action=b.dataset['nativeAction']!;void ctx.run(()=>call(action,{run:pointer(e.run),slot,...(action==='claim'?{packetDigest:a!.release!.packetDigest}:{})},action==='export'||action==='return-kit'),action==='return-kit'?'Bound return kit exported; give it to the receiving session.':action==='export'?'Frozen manual request exported; one slot reserved.':action==='claim'?'Invocation reported/claimed; this is operator attestation only.':'Manual exchange control saved; termination is unknown.');});
  root.querySelectorAll<HTMLFormElement>('[data-native-import]').forEach(f=>f.onsubmit=e=>{e.preventDefault();const data=new FormData(f),entry=state.runs.find(e=>e.run.id===f.dataset['nativeImport'])!,file=data.get('manifest') as File,original=data.get('original') as File;
    void ctx.run(async()=>{if(file.size>262144||original.size>8*1024*1024)throw Error('Manifest or original exceeds limits');const manifest=await file.text(),m=JSON.parse(manifest);const files=[];if(original.size){const b=new Uint8Array(await original.arrayBuffer());let binary='';for(const v of b)binary+=String.fromCharCode(v);files.push({path:m.output?.path,base64:btoa(binary)});}return call('import',{run:pointer(entry.run),slot:Number(f.dataset['slot']),manifest,files,historical:data.has('historical')});},'Return evidence imported; inspect current or historical state. No selection or acceptance changed.');});
  root.querySelectorAll<HTMLButtonElement>('[data-native-retry]').forEach(b=>b.onclick=()=>{const e=state.runs.find(e=>e.run.id===b.dataset['nativeRetry'])!,slot=e.slots.find(a=>a.slot===Number(b.dataset['slot']))!;void ctx.run(async()=>{const lifetimeInput=root.querySelector<HTMLInputElement>('#native-prepare input[name="lifetime"]')!;if(!lifetimeInput.value)throw Error('Choose a new grant lifetime before preparing retry');return call('prepare',{expectedProject:ctx.project,spec:null,width:0,height:0,slots:[slot.slot],expiresAt:new Date(Date.now()+Number(lifetimeInput.value)*1000).toISOString(),evidence:e.grant.payload.state.evidence,retryOf:{execution:pointer(e.run),slot:slot.slot}});},'New explicit retry grant prepared; export is still separate.');});
}
