import type {VersionRef,NodePacket,DesignArtifact} from '../kernel/contracts.ts';
import type {ReviewDraft,ReviewSubmission,ReviewInput,ReviewScope} from '../modules/website/review-contracts.ts';
import type {SelectionEntry,RasterConcept,Anchor} from '../modules/website/exploration-contracts.ts';
import type {ProductionProjection} from '../modules/website/production-contracts.ts';
type Work<T>=NodePacket<DesignArtifact<T>>;
type ReviewState={scope:ReviewScope|null;current:boolean;message:string;partial:boolean;drafts:{draft:Work<ReviewDraft>;stale:boolean;submission:VersionRef|null;originals:{available:boolean;message:string}[]}[];submissions:{submission:Work<ReviewSubmission>;originals:{available:boolean;message:string}[]}[]};
type ReviewTarget=ProductionProjection&{workUnit?:VersionRef};
type Context={pid:string;unit:VersionRef;iterations:ReviewTarget[];readOnly?:boolean};
type Local={input:ReviewInput;dirty:boolean;status:string;pending:boolean;submitted:Work<ReviewSubmission>|null;unresolved:{review:ReviewInput;actionKey:string}|null;canRetry:boolean;data:ReviewState;counter:number};
const key=(r:{id:string;version:number})=>r.id+':'+r.version;
const ref=(p:{id:string;version:number}):VersionRef=>({id:p.id,version:p.version,freshness:'pinned'});
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
/** Review content has one canonical authority. Browser copies are unsaved edits, never legacy selections. */
export class ProductionReviewUI {
 private context:Context|null=null;private chosen=new Map<string,string>();private locals=new Map<string,Local>();private next:(()=>void)|null=null;private ticket=0;private recoveryCatalog=new Map<string,ReviewTarget[]>();private recovering=new Set<string>();
 private rerender:()=>void;private post:(action:string,input:unknown,pid:string)=>Promise<unknown>;
 constructor(rerender:()=>void,post:(action:string,input:unknown,pid:string)=>Promise<unknown>){
  this.rerender=rerender;this.post=post;
  // Native reload/close warnings supplement the explicit app guard; they never write feedback.
  window.addEventListener('beforeunload',event=>{if([...this.locals.values()].some(l=>l.dirty||l.pending||l.unresolved)){event.preventDefault();event.returnValue='';}});
  document.addEventListener('click',event=>{
   if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
   const anchor=event.target instanceof Element?event.target.closest<HTMLAnchorElement>('a[href]'):null;
   if(!anchor||anchor.hasAttribute('download')||anchor.target&&anchor.target!=='_self')return;
   const url=new URL(anchor.href,location.href);if(url.origin!==location.origin)return;
   const l=this.local();if(!l||!(l.dirty||l.pending||l.unresolved))return;
   event.preventDefault();this.navigate(()=>location.assign(url.href));
  });
 }
 private owner(c=this.context){return c?JSON.stringify([c.pid,c.unit.id]):'';}
 private target(c:Context){const it=this.chosen.get(this.owner(c));return c.iterations.find(i=>i.ref.id===it)?.workUnit??c.unit;}
 private identity(c=this.context){return c?JSON.stringify([c.pid,key(this.target(c)),this.chosen.get(this.owner(c))??'']):'';}
 private editable(l:Local){return !this.context?.readOnly&&l.data.current&&l.data.scope?.fingerprint===l.input.scope.fingerprint;}
 private local(){return this.locals.get(this.identity());}
 get active(){return !!this.local();}
 get entries(){return this.local()?.input.feedback.selections.entries??[];}
 private storage(k:string){return 'bve-review-action-v1:'+k;}
 private persist(l:Local,k=this.identity()){try{if(l.unresolved)sessionStorage.setItem(this.storage(k),JSON.stringify(l.unresolved));else sessionStorage.removeItem(this.storage(k));}catch{/* Canonical draft/submission relationships remain the recovery authority if tab storage is unavailable. */}}
 private persisted(identity:string){try{return sessionStorage.getItem(this.storage(identity));}catch{return null;}}
 private url(){const c=this.context;if(!c)return;const u=new URL(location.href);u.searchParams.set('project',c.pid);u.searchParams.set('page',key(this.target(c)));const it=this.chosen.get(this.owner());if(it)u.searchParams.set('reviewIteration',it);else u.searchParams.delete('reviewIteration');history.replaceState(null,'',u);}
 setContext(c:Context|null){const changed=this.owner()!==this.owner(c);this.context=c;if(changed){++this.ticket;this.next=null;}if(!c)return;
  const owner=this.owner(c),cached=this.recoveryCatalog.get(owner);
  if(cached){const targets=new Map(cached.map(i=>[i.ref.id,i]));for(const i of c.iterations)targets.set(i.ref.id,{...targets.get(i.ref.id),...i});c.iterations=[...targets.values()];}
  if(!cached&&!this.recovering.has(owner)){this.recovering.add(owner);const query=new URLSearchParams({project:c.pid,unit:JSON.stringify(c.unit)});void fetch('/api/v1/visual/review/catalog?'+query).then(async r=>{if(!r.ok)throw Error('Stored review catalog unavailable');return r.json();}).then(data=>{this.recoveryCatalog.set(owner,data);if(this.owner()===owner)this.rerender();}).catch(()=>{}).finally(()=>this.recovering.delete(owner));}
  const u=new URL(location.href),explicit=u.searchParams.get('reviewIteration'),page=u.searchParams.get('page');
  if(!this.chosen.has(owner)&&u.searchParams.get('project')===c.pid&&c.iterations.some(i=>i.ref.id===explicit&&key(i.workUnit??c.unit)===page)){this.chosen.set(owner,explicit!);void this.load();}
 }
 private async fetchState(c:Context,it:string):Promise<ReviewState>{const q=new URLSearchParams({project:c.pid,unit:JSON.stringify(this.target(c)),iteration:it});const r=await fetch('/api/v1/visual/review/state?'+q);const v=await r.json();if(!r.ok)throw Error(v.error);return v;}
 async load(force=false){const c=this.context,it=c&&this.chosen.get(this.owner());if(!c||!it)return;const identity=this.identity(),ticket=++this.ticket;
  try{const data=await this.fetchState(c,it);if(ticket!==this.ticket||identity!==this.identity())return;
   let l=this.locals.get(identity);if(!l||force){
    const open=data.drafts.filter(d=>!d.submission).at(-1),sub=data.submissions.at(-1)?.submission??null,s=open?.draft.payload.state;
    const scope=s?.scope??sub?.payload.state.scope??data.scope;
    if(!scope){this.locals.delete(identity);this.rerender();return;}
    l={input:{draftId:open?.draft.id??'review-draft-'+crypto.randomUUID(),expected:open?ref(open.draft):null,scope,feedback:structuredClone(s?.feedback??sub?.payload.state.feedback??{selections:{version:1,workUnit:c.unit,entries:[]},comment:''}),parentSubmission:s?.parentSubmission??null},dirty:false,status:open?(open.stale?'Historical draft · scope changed; submission unavailable':'Saved draft reopened'):sub?'Submitted · operational verification pending / not implemented':'Unsaved review · no candidate selected',pending:false,submitted:open?null:sub,unresolved:null,canRetry:false,data,counter:0};
    const saved=this.persisted(identity);if(saved){try{l.unresolved=JSON.parse(saved);if(l.unresolved){l.input=l.unresolved.review;l.submitted=null;l.dirty=true;l.status='Submission outcome unresolved · reconcile before editing or retry';}}catch{l.status='Unreadable local retry evidence; inspect submission history before continuing';}}
    this.locals.set(identity,l);
   }else l.data=data;
   this.recover(l,identity);this.url();this.rerender();
  }catch(error){const l=this.locals.get(identity);if(l)l.status='Read failed: '+String(error);if(identity===this.identity())this.rerender();}
 }
 private recover(l:Local,identity=this.identity()){
  if(!l.unresolved)return;
  const sub=l.data.submissions.find(s=>s.submission.payload.state.actionKey===l.unresolved!.actionKey)?.submission;
  if(sub){l.submitted=sub;l.input.feedback=structuredClone(sub.payload.state.feedback);l.input.expected=sub.payload.state.finalDraft;l.dirty=false;l.status='Submitted · recovered durable confirmation · verification pending';l.unresolved=null;l.canRetry=false;this.persist(l,identity);}
  else {l.canRetry=true;l.status='No committed submission found for this action. Retry the same submission explicitly; feedback retained.';}
 }
 private changed(l:Local){l.dirty=true;l.counter++;l.status='Unsaved review edits';const status=document.querySelector('#review-status');if(status)status.textContent=l.status;}
 add(c:Work<RasterConcept>,anchor:Anchor){const l=this.local();if(!l||!this.editable(l)||l.submitted||l.pending||l.unresolved)return;
  if(!l.input.scope.proposals.some(p=>key(p.candidate)===key(c))){l.status='Choose a candidate from this review iteration';this.rerender();return;}
  l.input.feedback.selections.entries.push({id:'review-entry-'+crypto.randomUUID(),candidate:ref(c),integrity:c.integrity,image:c.payload.state.image,orientation:'encoded-top-left',coordinates:'normalized-original',anchor,intent:'inspiration',preservation:null,notes:[]});this.changed(l);this.rerender();
 }
 remove(ids:string[]){const l=this.local();if(!l||!this.editable(l)||l.submitted||l.pending||l.unresolved)return;l.input.feedback.selections.entries=l.input.feedback.selections.entries.filter(e=>!ids.includes(e.id));this.changed(l);this.rerender();}
 navigate(next:()=>void){const l=this.local();if(l&&(l.dirty||l.pending||l.unresolved)){this.next=next;this.rerender();return;}next();}
 private async save():Promise<boolean>{const l=this.local(),c=this.context;if(!l||!c||!this.editable(l)||l.pending||l.submitted||l.unresolved)return false;
  const identity=this.identity(),input=structuredClone(l.input),counter=l.counter;l.pending=true;l.status='Saving review draft…';this.rerender();
  try{const saved=await this.post('review/save',input,c.pid) as Work<ReviewDraft>;l.input.expected=ref(saved);if(l.counter===counter){l.input.feedback=structuredClone(saved.payload.state.feedback);l.dirty=false;}l.status=l.dirty?'Saved revision; newer local edits remain unsaved':'Saved draft · durable';return !l.dirty;
  }catch(error){l.status='Save failed/conflict: '+String(error)+' · typed feedback retained';return false;}
  finally{l.pending=false;if(identity===this.identity())this.rerender();}
 }
 private async submit(){const l=this.local(),c=this.context;if(!l||!c||!l.unresolved&&!this.editable(l)||l.pending||l.submitted)return;const identity=this.identity();
  if(l.unresolved&&!l.canRetry){l.status='Reconcile submission status first';this.rerender();return;}
  // Read before retry; never rotate an unresolved action key or silently resend it.
  if(l.unresolved){try{l.data=await this.fetchState(c,this.chosen.get(this.owner(c))!);this.recover(l,identity);if(l.submitted){this.rerender();return;}}catch(error){l.status='Reconciliation unavailable: '+String(error);this.rerender();return;}}
  l.unresolved??={review:structuredClone(l.input),actionKey:'review-action-'+crypto.randomUUID()};this.persist(l,identity);l.pending=true;l.canRetry=false;l.status='Submitting current feedback…';this.rerender();
  try{const sub=await this.post('review/submit',l.unresolved,c.pid) as Work<ReviewSubmission>;l.submitted=sub;l.input.expected=sub.payload.state.finalDraft;l.input.feedback=structuredClone(sub.payload.state.feedback);l.dirty=false;l.unresolved=null;this.persist(l,identity);l.status='Submitted · operational verification pending / not implemented';
  }catch(error){l.status='Submission not confirmed: '+String(error)+' · feedback retained';try{l.data=await this.fetchState(c,this.chosen.get(this.owner(c))!);this.recover(l,identity);if(!l.submitted&&(error as {status?:number}).status&&Number((error as {status?:number}).status)<500){l.unresolved=null;l.canRetry=false;this.persist(l,identity);l.status='Submission rejected: '+String(error)+' · typed feedback retained; reload scope explicitly if needed';}}catch{l.status+=' · status unavailable; Reconcile before retry';}}
  finally{l.pending=false;if(identity===this.identity())this.rerender();}
 }
 panel(){const c=this.context;if(!c)return '';const it=this.chosen.get(this.owner())??'',l=this.local();
  return `<section id="production-review" class="project-memory"><h2>Production review</h2>${c.readOnly?'<p role="alert">Read-only review recovery · workspace originals are unavailable. Stored feedback remains available; no newer image is substituted.</p>':''}<label>Iteration to review<select id="review-iteration"><option value="">Choose an iteration explicitly</option>${c.iterations.map((p,i)=>`<option value="${esc(p.ref.id)}" ${p.ref.id===it?'selected':''}>Iteration ${i+1}${p.workUnit&&key(p.workUnit)!==key(c.unit)?` · Historical page v${p.workUnit.version} · read-only`:``} · ${p.proposals.length}/${p.count} proposals · ${esc(p.status)}</option>`).join('')}</select></label>${it&&!l?'<p>No reviewable proposals, or review data unavailable. Zero-proposal iterations cannot be reviewed.</p><button id="review-reload">Reload review records</button>':''}${l?this.form(l):''}${this.next?`<div role="alertdialog" aria-label="Unsaved review navigation" class="draft-removal"><p>Review edits are unsaved or an action is unresolved. Save before leaving, explicitly discard local edits, or stay. Unresolved submission keys must be reconciled first.</p><button id="review-leave-save" ${l?.unresolved||l?.pending?'disabled':''}>Save draft and continue</button><button id="review-leave-discard" ${l?.unresolved||l?.pending?'disabled':''}>Discard local edits and continue</button><button id="review-leave-stay">Stay with review</button></div>`:''}</section>`;
 }
 private form(l:Local){const saved=l.data.drafts.find(d=>key(d.draft)===key(l.input.expected??{id:"",version:0})),record=l.submitted??saved?.draft,s=l.submitted?.payload.state,disabled=!!s||!this.editable(l)||l.pending||!!l.unresolved,historical=!l.data.current||l.data.scope?.fingerprint!==l.input.scope.fingerprint;
  return `<p id="review-status" role="status" aria-live="polite">${esc(l.status)}</p><p>${l.input.scope.proposals.length}/${l.input.scope.jobs.length} proposals · ${l.input.scope.proposals.length<l.input.scope.jobs.length?'Partial iteration · ':''}${esc(l.input.scope.jobs.map(j=>j.status).join(' / '))}</p><p>Saving or submitting feedback does not generate or accept a design. Butler is not required.</p>${s?`<p id="review-submitted">Submitted feedback · draft revision ${s.finalDraft.version} · verification pending / not implemented</p>`:''}<label>Overall review comment<textarea id="review-comment" maxlength="4000" rows="3" ${disabled?'readonly':''}>${esc(l.input.feedback.comment)}</textarea></label>${historical?`<p id="review-stale" role="alert">Historical review scope · page v${l.input.scope.workUnit.version} · outcomes or source versions changed. Saved feedback stays readable; submission requires an explicit new review.</p>${l.data.current?'<button id="review-new-current">Start new review of current outcomes</button>':''}`:''}<p>Select whole images or add regions using the existing image controls. Review selections are separate from next-variation selections.</p>${!s?`<button id="review-save" ${disabled?'disabled':''}>Save draft</button><button id="review-submit" ${!l.unresolved&&!this.editable(l)||l.pending||l.unresolved&&!l.canRetry?'disabled':''}>${l.unresolved?'Retry same submission':'Submit review'}</button>`:`<button id="review-copy" ${!this.editable(l)?'disabled':''}>Edit as new draft</button>`}<button id="review-reconcile" ${l.pending?'disabled':''}>Reconcile / refresh status</button><button id="review-reload" ${l.pending?'disabled':''}>Reload saved feedback</button><details><summary>Saved review history and exact identity</summary>${l.data.drafts.map(d=>`<button data-review-draft="${esc(key(d.draft))}">Draft v${d.draft.version}${d.stale?' · historical':''}${d.submission?' · submitted':''}</button>`).join('')}${l.data.submissions.map((v,i)=>`<button data-review-sub="${esc(key(v.submission))}">Submission ${i+1} · ${esc(v.submission.payload.state.submittedAt)}</button>`).join('')}<pre>${esc(JSON.stringify(s?{submission:ref(l.submitted!),finalDraft:s.finalDraft,contentHash:s.contentHash}:l.input.expected,null,2))}</pre></details>${record&&(s||historical)?`<div class="review-originals">${record.payload.state.scope.proposals.map((p,i)=>{const available=(s?l.data.submissions.find(x=>x.submission.id===l.submitted!.id)?.originals:saved?.originals)?.[i]?.available??true;return `<figure><img src="/api/v1/visual/review/original?${esc(new URLSearchParams({project:this.context!.pid,record:JSON.stringify(ref(record)),index:String(i)}))}" alt="Exact ${s?'submitted':'saved'} source ${i+1}"><figcaption>${available?'Exact original source':'Exact original unavailable or corrupt; no substitution'}</figcaption></figure>`;}).join('')}</div>`:''}`;
 }
 selections(){const l=this.local();if(!l)return '';const disabled=!!l.submitted||!this.editable(l)||l.pending||!!l.unresolved;return `<aside class="selections"><h2>Review selections · ${this.entries.length}</h2>${this.entries.map((e,i)=>`<article><h3>Review source ${i+1} · ${e.anchor.kind}</h3><p>Concept ${l.input.scope.proposals.findIndex(p=>key(p.candidate)===key(e.candidate))+1} · source revision ${e.candidate.version}</p><label>Source ${i+1} comment<textarea id="review-note-${esc(e.id)}" data-review-note="${esc(e.id)}" rows="3" maxlength="4000" ${disabled?'readonly':''}>${esc(e.notes[0]?.text??'')}</textarea></label><label>Source ${i+1} intent<select id="review-intent-${esc(e.id)}" data-review-intent="${esc(e.id)}" ${disabled?'disabled':''}><option value="inspiration" ${e.intent==='inspiration'?'selected':''}>Inspiration</option><option value="include" ${e.intent==='include'?'selected':''}>Include</option>${e.anchor.kind==='whole'||e.intent==='exact'?`<option value="exact" ${e.intent==='exact'?'selected':''}>Exact · existing preservation scope</option>`:''}</select></label><p class="hint">Intent uses existing source constraints; no new preservation promise.</p><details><summary>Original coordinates</summary><pre>${esc(JSON.stringify(e.anchor,null,2))}</pre></details><button data-review-remove="${esc(e.id)}" ${disabled?'disabled':''}>Remove review source ${i+1}</button></article>`).join('')}${!this.entries.length?'<p>No selected source. A comment-only review can explain that none works.</p>':''}</aside>`;}
 bind(root:HTMLElement){const on=(id:string,event:string,fn:(e:Event)=>void)=>root.querySelector('#'+id)?.addEventListener(event,fn);const l=this.local();
  on('review-iteration','change',e=>{const value=(e.target as HTMLSelectElement).value;this.navigate(()=>{this.chosen.set(this.owner(),value);++this.ticket;this.url();if(value)void this.load();this.rerender();});});
  on('review-comment','input',e=>{if(l&&this.editable(l)&&!l.submitted&&!l.pending&&!l.unresolved){l.input.feedback.comment=(e.target as HTMLTextAreaElement).value;this.changed(l);}});
  root.querySelectorAll<HTMLTextAreaElement>('[data-review-note]').forEach(n=>n.oninput=()=>{if(!l||!this.editable(l)||l.submitted||l.pending||l.unresolved)return;const e=this.entries.find(e=>e.id===n.dataset['reviewNote'])!;e.notes=n.value?[{id:e.notes[0]?.id??'review-note-'+crypto.randomUUID(),text:n.value,source:'User annotation'},...e.notes.slice(1)]:e.notes.slice(1);this.changed(l);});
  root.querySelectorAll<HTMLSelectElement>('[data-review-intent]').forEach(n=>n.onchange=()=>{if(!l||!this.editable(l)||l.submitted||l.pending||l.unresolved)return;const e=this.entries.find(e=>e.id===n.dataset['reviewIntent'])!;e.intent=n.value as SelectionEntry['intent'];e.preservation=e.intent==='exact'?(e.preservation??{predicate:'retained-bytes',target:'asset-'+e.id}):null;this.changed(l);});
  root.querySelectorAll<HTMLButtonElement>('[data-review-remove]').forEach(n=>n.onclick=()=>this.remove([n.dataset['reviewRemove']!]));
  on('review-new-current','click',()=>{if(!l?.data.scope)return;this.navigate(()=>{this.locals.set(this.identity(),l);l.input={draftId:'review-draft-'+crypto.randomUUID(),expected:null,scope:l.data.scope!,feedback:{selections:{version:1,workUnit:this.context!.unit,entries:[]},comment:''},parentSubmission:l.submitted?ref(l.submitted):null};l.submitted=null;l.dirty=false;l.status='Unsaved new review of explicitly refreshed outcomes';this.rerender();});});
  on('review-save','click',()=>void this.save());on('review-submit','click',()=>void this.submit());
  on('review-reconcile','click',()=>void this.load());on('review-reload','click',()=>this.navigate(()=>void this.load(true)));
  on('review-leave-stay','click',()=>{this.next=null;this.rerender();});
  on('review-leave-save','click',()=>{const next=this.next;void this.save().then(ok=>{if(ok){this.next=null;next?.();}});});
  on('review-leave-discard','click',()=>{const next=this.next;this.locals.delete(this.identity());this.next=null;next?.();});
  const open=(s:ReviewDraft,draftId:string,expected:VersionRef|null,sub:Work<ReviewSubmission>|null)=>{if(!l)return;this.navigate(()=>{this.locals.set(this.identity(),l);l.input={draftId,expected,scope:s.scope,feedback:structuredClone(s.feedback),parentSubmission:s.parentSubmission};l.submitted=sub;l.dirty=false;l.unresolved=null;l.status=sub?'Submitted · verification pending':'Saved draft reopened';this.rerender();});};
  root.querySelectorAll<HTMLButtonElement>('[data-review-sub]').forEach(b=>b.onclick=()=>{const sub=l!.data.submissions.find(s=>key(s.submission)===b.dataset['reviewSub'])!.submission;open(sub.payload.state,sub.payload.state.finalDraft.id,sub.payload.state.finalDraft,sub);});
  root.querySelectorAll<HTMLButtonElement>('[data-review-draft]').forEach(b=>b.onclick=()=>{const d=l!.data.drafts.find(d=>key(d.draft)===b.dataset['reviewDraft'])!;const sub=d.submission?l!.data.submissions.find(s=>s.submission.id===d.submission!.id)!.submission:null;open(d.draft.payload.state,d.draft.id,ref(d.draft),sub);});
  on('review-copy','click',()=>{if(!l?.submitted||!this.editable(l)||l.pending)return;const c=this.context!,identity=this.identity(),submission=ref(l.submitted);l.pending=true;this.rerender();void this.post('review/copy',{submission,draftId:'review-draft-'+crypto.randomUUID()},c.pid).then(value=>{const draft=value as Work<ReviewDraft>;l.input={draftId:draft.id,expected:ref(draft),scope:draft.payload.state.scope,feedback:structuredClone(draft.payload.state.feedback),parentSubmission:submission};l.submitted=null;l.status='Saved new draft · parent submission preserved';l.dirty=false;}).catch(error=>{l.status=String(error);}).finally(()=>{l.pending=false;if(identity===this.identity())this.rerender();});});
 }
}
