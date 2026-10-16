import {ProductionReviewUI} from './production-review.ts';
import type {ProductionProjection} from '../modules/website/production-contracts.ts';
import {nativeView,bindNative,type NativeViewState} from './native-exchange.ts';
import { bindAuxiliary, auxiliaryDraftChanged } from "./auxiliary.ts";
import {
  auxiliaryPreparationDraft,
  auxiliaryOperationFocus,
  auxiliarySemanticProposal,
  auxiliaryBridgeDone,
} from "./reconstruction.ts";
import {bindReconstruction} from './reconstruction.ts';
import type { MemoryIndex, HandoffNote, EvidenceEntry, EvidenceLink } from "../modules/website/memory-contracts.ts";
import type { LibraryItem, RasterManifest } from '../modules/website/library-contracts.ts';
import type { Execution, Grant, ExecutionRequest } from '../modules/website/execution-contracts.ts';
import type {
  VersionRef,
  DesignArtifact,
  NodePacket,
} from "../kernel/contracts.ts";
import type {
  WorkUnit,
  RasterConcept,
  Selections,
  SelectionEntry,
  Batch,
  Specification,
  Anchor,
} from "../modules/website/exploration-contracts.ts";
import { requestControls, requestFields, type RequestControl } from "../modules/website/visual-controls.ts";
import { normalizedPoint, regionBetween } from "./visual-geometry.ts";
import { VisualDrafts, type PageDraft } from "./visual-drafts.ts";
type Work<T> = NodePacket<DesignArtifact<T>>;
type State = {
  reviewAvailable:boolean;
  nativeExchange: NativeViewState;
  productionIterations: ProductionProjection[];
  project: VersionRef;
  title: string;
  units: Work<WorkUnit>[];
  unit: Work<WorkUnit>;
  records: Work<unknown>[];
  candidates: Work<RasterConcept>[];
  selectedSources: Work<RasterConcept>[];
  sourceOrigins: Record<string, string[]>;
  executionAvailability: { connected:boolean; mode:string; label:string; adapter:unknown };
  executions: { run:Work<Execution>; active:boolean; pendingDeliveries:{slot:number;kind:string;sequence:number}[]; deliveryErrors:{sequence:number;slot:number;kind:string;stage:string;message:string;retryable:boolean}[]; outputs:VersionRef[]; slots:(Execution['slots'][number]&{displayStatus:string;receiptSummary:{outcome:string;message:string;hasMedia:boolean}|null})[]; grant:Work<Grant>; request:Work<ExecutionRequest> }[];
};
const root = document.querySelector<HTMLDivElement>("#visual-app")!;
const notice = document.querySelector<HTMLDivElement>("#visual-notice")!;
const esc = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const ref = (p: { id: string; version: number }): VersionRef => ({
  id: p.id,
  version: p.version,
  freshness: "pinned",
});
const key = (p: { id: string; version: number }) => p.id + ":" + p.version;
let token = "",
  catalog: {
    reviewAvailable?:boolean;
    projects: { ref: VersionRef; title: string }[];
    brands: { ref: VersionRef; label: string }[];
  } = { projects: [], brands: [] };
let pid = "",
  project: VersionRef | null = null,
  units: Work<WorkUnit>[] = [],
  state: State | null = null;
let layout = "sheet",
  focused = "",
  compared: string[] = [],
  entry = "",
  tool: "rectangle" | "ellipse" = "rectangle",
  zoom = 1,
  busy = false,
  epoch = 0;
let observers: ResizeObserver[] = [];
const drafts = new VisualDrafts();
const review = new ProductionReviewUI(()=>render(),(action,input,pid)=>post(action,input,pid));
let workspaceError = "", errorUnit = "", pendingRemoval: string[] = [];
const draft = (): PageDraft => drafts.page(pid, state ? key(state.unit) : errorUnit);
const allCandidates = () => [...new Map([...(state?.candidates ?? []), ...(state?.selectedSources ?? [])].map(c => [key(c), c])).values()];
const noteKey = (e: SelectionEntry) => JSON.stringify([selectionId, e.id, key(e.candidate), e.anchor]);
const sourceLabel = (c: Work<RasterConcept>) => {
  const index = state!.candidates.findIndex(x => key(x) === key(c));
  return index >= 0 ? `Concept ${index + 1} · v${c.version}` : `${(state!.sourceOrigins[key(c)] ?? []).join(" / ") || "Same-project reference"} · v${c.version}`;
};
const requestScopeKey = () => {
  const e = entries().find(e => e.id === draft().scope);
  return e ? noteKey(e) : draft().scope === "" ? "page" : "unresolved:" + draft().scope;
};
const requestValues = () => draft().requests[requestScopeKey()]?.values ?? {};
function setRequest(key: string, value: string) {
  const scope = draft().scope;
  if (scope !== "" && !entries().some(e => e.id === scope)) throw Error("Choose an existing source scope");
  const k = requestScopeKey();
  const r = draft().requests[k] ??= { entryId: scope === "" ? null : scope, selectionId, values: {} };
  if (value === "") delete r.values[key]; else r.values[key] = value;
}
function dirtyNote(e: SelectionEntry) {
  const n = draft().notes[noteKey(e)];
  return !!n && (n.note !== (e.notes[0]?.text ?? "") || n.intent !== e.intent);
}
function requestRemoval(ids: string[]) {
  if(review.active){review.remove(ids);return;}
  if (entries().some(e => ids.includes(e.id) && (dirtyNote(e) || Object.keys(draft().requests[noteKey(e)]?.values ?? {}).length))) {
    pendingRemoval = ids;
    render();
    notice.textContent = "This source has unsaved intent. Explicitly discard its drafts to remove it.";
  } else void removeSources(ids);
}
async function removeSources(ids: string[]) {
  await run(async () => {
    const removed = entries().filter(e => ids.includes(e.id));
    await saveEntries(entries().filter(e => !ids.includes(e.id)));
    for (const e of removed) { delete draft().notes[noteKey(e)]; delete draft().requests[noteKey(e)]; }
    if (ids.includes(draft().scope)) draft().scope = "";
    if (ids.includes(entry)) entry = "";
    pendingRemoval = [];
    render();
  }, "Source and its explicitly discarded drafts removed; other scopes retained");
}
let prepared: {
  specification: Work<Specification>;
  batch: Work<Batch>;
} | null = null;
const query = (r: VersionRef) =>
  new URLSearchParams({
    project: pid,
    id: r.id,
    version: String(r.version),
  }).toString();
const imageURL = (c: Work<RasterConcept>) =>
  "/api/v1/visual/image?" + query(ref(c));
async function get(path: string) {
  const r = await fetch("/api/v1/visual/" + path);
  const v = await r.json();
  if (!r.ok) throw Error(v.error);
  return v;
}
async function post(action: string, input: unknown, projectId = pid) {
  const r = await fetch("/api/v1/visual/" + action, {
    method: "POST",
    keepalive: action === "auxiliary/close",
    headers: { "Content-Type": "application/json", "X-BVE-Token": token },
    body: JSON.stringify(
      action === "create" ? input : { projectId, input },
    ),
  });
  const v = await r.json();
  if (!r.ok) throw Object.assign(Error(v.error),{status:r.status});
  return v;
}
let selectionId = "";
const selectionSets = () =>
  state?.records.filter((p) => p.payload.kind === "raster-selections") as
    | Work<Selections>[]
    | undefined;
const selection = () => selectionSets()?.find((p) => p.id === selectionId);
const entries = () => review.active ? review.entries : selection()?.payload.state.entries ?? [];
const active = () => allCandidates().find((c) => key(c) === focused);
function focusSource(k: string) {
  focused = k;
  entry = entries().find(e => key(e.candidate) === k)?.id ?? "";
  draft().scope = entry || "";
}
const selected = (c: Work<RasterConcept>) =>
  entries().filter((e) => key(e.candidate) === key(c));
function executionFocus() {
  const n=document.activeElement as HTMLInputElement|HTMLTextAreaElement|HTMLButtonElement|null;
  if(!n||!root.contains(n))return ()=>{};
  let selector=n.id?"#"+CSS.escape(n.id):n.getAttribute("name")&&n.closest("form")?.id?"#"+CSS.escape(n.closest("form")!.id)+` [name="${CSS.escape(n.getAttribute("name")!)}"]`:"";
  if(!selector)for(const a of ["data-execution-cancel","data-execution-revoke","data-execution-run","data-execution-reconcile","data-execution-delivery","data-library-inspect"]){const value=n.getAttribute(a);if(value){selector=`[${a}^="${CSS.escape(value.split(":")[0]+":")}"]`;break;}}
  if(!selector && n.hasAttribute("data-native-action")) selector=`[data-native-action="${CSS.escape(n.getAttribute("data-native-action")!)}"][data-native-run="${CSS.escape(n.getAttribute("data-native-run")!)}"][data-slot="${CSS.escape(n.getAttribute("data-slot")!)}"]`;
  if(!selector && n.hasAttribute("data-native-retry")) selector=`[data-native-retry="${CSS.escape(n.getAttribute("data-native-retry")!)}"][data-slot="${CSS.escape(n.getAttribute("data-slot")!)}"]`;
  const nativeForm=n.closest<HTMLFormElement>("form[data-native-import]");
  if(!selector && nativeForm && n.name) selector=`[data-native-import="${CSS.escape(nativeForm.dataset["nativeImport"]!)}"][data-slot="${CSS.escape(nativeForm.dataset["slot"]!)}"] [name="${CSS.escape(n.name)}"]`;
  const start="selectionStart" in n?n.selectionStart:null,end="selectionEnd" in n?n.selectionEnd:null;
  return ()=>{let target=selector?root.querySelector<HTMLInputElement|HTMLTextAreaElement>(selector):null;if(n.closest("#native-exchange-panel")&&(!target||target.disabled))target=root.querySelector("#native-refresh");target?.focus({preventScroll:true});if(target&&start!==null&&end!==null&&"setSelectionRange" in target)try{target.setSelectionRange(start,end);}catch{}};
}
async function reload(keepExecutionFocus=false) {
  if (!state) return;
  const ticket = ++epoch;
  errorUnit = key(state.unit);
  let next: State;
  try { next = (await get("state?" + query(ref(state.unit)))) as State; }
  catch (e) { state = null; workspaceError = e instanceof Error ? e.message : "Stored source unavailable"; render(); throw e; }
  if (ticket !== epoch) return;
  // Stored-progress reads must not detach an unchanged Cancel/Revoke control during input.
  if (keepExecutionFocus && state && JSON.stringify(next) === JSON.stringify(state)) return;
  state = next;
  workspaceError = "";
  if (!selectionId && selectionSets()?.length === 1)
    selectionId = selectionSets()![0]!.id;
  project = next.project;
  units = next.units;
  if (!allCandidates().some((c) => key(c) === focused))
    focused = state.candidates[0] ? key(state.candidates[0]) : "";
  const restore=keepExecutionFocus?executionFocus():()=>{};render();restore();
}
const executionCommands = new Map<string,{projectId:string;unit:string;executionId:string;action:string}>();
const dispatchPending = (id:string) => [...executionCommands.values()].some(c=>c.executionId===id && c.action==="execute");
const pageDispatching = () => [...executionCommands.values()].some(c=>c.projectId===pid && state && c.unit===key(state.unit) && c.action==="execute");
async function run(action: () => Promise<void>, message: string, readOnly=false) {
  if(pageDispatching() && !readOnly){notice.textContent="Dispatch in progress. Cancel and Revoke remain available; other writes wait.";return;}
  if (busy) return;
  busy = true;
  const returnFocus = (document.activeElement as HTMLElement)?.id;
  root.inert = !readOnly;
  root.setAttribute("aria-busy", "true");
  try {
    await action();
    notice.textContent = message;
  } catch (e) {
    notice.textContent = e instanceof Error ? e.message : "Operation rejected";
  } finally {
    busy = false;
    root.inert = false;
    if (returnFocus) document.getElementById(returnFocus)?.focus();
    root.removeAttribute("aria-busy");
  }
}
async function executionAction(e:State["executions"][number], owner:VersionRef, attribute:string, action:string, slot?:number, sequence?:number) {
  const projectId=owner.id, unit=e.run.payload.state.workUnit, operationKey=projectId+":"+e.run.id+":"+attribute;
  if(executionCommands.has(operationKey)||attribute==="run" && (dispatchPending(e.run.id)||e.active))return;
  if(busy && !["cancel","revoke"].includes(attribute))return;
  const ownsView=()=>pid===projectId && state && key(state.unit)===key(unit);
  executionCommands.set(operationKey,{projectId,unit:key(unit),executionId:e.run.id,action});
  if ((attribute === "cancel" || attribute === "revoke") && ownsView()) {
    // Interrupt input must not synchronously rebuild unrelated workspace controls.
    root.querySelector<HTMLButtonElement>(`[data-execution-${attribute}="${CSS.escape(key(e.run))}"]`)?.setAttribute("disabled", "");
  } else render();
  let finished=false, observing=true, reads=0, timer:ReturnType<typeof setTimeout>|undefined;
  const refresh=async()=>{if(ownsView())await reload(true);};
  // These GETs refresh stored progress only. They never call transport.status or spend a grant.
  const tick=async()=>{try{await refresh();}catch(err){if(ownsView())notice.textContent=err instanceof Error?err.message:"Execution progress unavailable";}if(observing && ++reads<60 && (!finished || ownsView() && state!.executions.some(x=>x.run.id===e.run.id&&x.pendingDeliveries.length)))timer=setTimeout(()=>void tick(),150);};
  timer=setTimeout(()=>void tick(),0);
  try {
    await post(action,{expectedProject:owner,unit,...(attribute==="revoke"?{grant:ref(e.grant)}:{execution:ref(e.run)}),...(attribute==="cancel"?{slot:null}:attribute==="reconcile"?{slot}:attribute==="delivery"?{sequence}:{})},projectId);
    if(ownsView())notice.textContent=attribute==="cancel"?"Cancellation intent saved. Remote confirmation is shown separately.":attribute==="revoke"?"Grant revoked. Already sent work is not claimed killed.":"Execution state refreshed · offline fixture only";
  }catch(err){if(ownsView())notice.textContent=err instanceof Error?err.message:"Execution action failed; inspect stored progress";}
  finally {
    finished=true;executionCommands.delete(operationKey);
    if(ownsView()){try{await refresh();}catch{}const restore=executionFocus();render();restore();}
    if(!ownsView()||!state!.executions.some(x=>x.run.id===e.run.id&&x.pendingDeliveries.length)){observing=false;if(timer)clearTimeout(timer);}
  }
}
async function openProject(id: string) {
  ++epoch;
  pid = id;
  workspaceError = "";
  pendingRemoval = [];
  state = null;
  prepared = null;
  compared = [];
  focused = "";
  entry = "";
  let p;
  try { p = await get("project?project=" + encodeURIComponent(pid)); }
  catch (e) { units = []; project = null; workspaceError = e instanceof Error ? e.message : "Project unavailable"; render(); throw e; }
  project = p.project;
  units = p.units;
  if (units[0]) await openUnit(key(units[0]));
  else render();
}
async function openUnit(k: string) {
  ++epoch;
  prepared = null;
  compared = [];
  focused = "";
  entry = "";
  const u = units.find((u) => key(u) === k)!;
  errorUnit = k;
  state = null;
  pendingRemoval = [];
  try { state = await get("state?" + query(ref(u))); workspaceError = ""; }
  catch (e) { workspaceError = e instanceof Error ? e.message : "Stored source unavailable"; render(); throw e; }
  focused = state!.candidates[0] ? key(state!.candidates[0]) : "";
  selectionId = selectionSets()?.length === 1 ? selectionSets()![0]!.id : "";
  project = state!.project;
  units = state!.units;
  zoom = 1;
  render();
}
async function saveEntries(next: SelectionEntry[]) {
  await post("selections", {
    expectedProject: project,
    unit: ref(state!.unit),
    previous: selection() ? ref(selection()!) : null,
    entries: next.map((e) => ({
      id: e.id,
      candidate: e.candidate,
      anchor: e.anchor,
      intent: e.intent,
      target: e.preservation?.target ?? null,
      notes: e.notes.map((n) => ({ id: n.id, text: n.text })),
    })),
  });
  await reload();
}
async function add(c: Work<RasterConcept>, anchor: Anchor) {
  if(review.active){review.add(c,anchor);return;}
  const nextEntry = "selection-" + crypto.randomUUID();
  const e: SelectionEntry = {
    id: nextEntry,
    candidate: ref(c),
    integrity: c.integrity,
    image: c.payload.state.image,
    orientation: "encoded-top-left",
    coordinates: "normalized-original",
    anchor,
    intent: "inspiration",
    preservation: null,
    notes: [],
  };
  await saveEntries([...entries(), e]);
  entry = nextEntry;
  focused = key(c);
  draft().scope = entry;
  render();
}
const originLabel = (c: Work<RasterConcept>) => {
  const proposal=state?.productionIterations.flatMap(i=>i.proposals).find(p=>key(p.candidate)===key(c));
  if(proposal)return proposal.provenance==='authored-fixture'?'Authored delivery · verified bytes':'Reported native · verified bytes';
  return c.payload.state.origin === "synthetic"
    ? "Synthetic interaction fixture"
    : c.payload.state.origin === "imported"
      ? "Imported raster"
      : "Raster reference";
};
function card(c: Work<RasterConcept>, i: number, strip = false) {
  const whole = selected(c).some((e) => e.anchor.kind === "whole");
  return `<article class="candidate ${key(c) === focused ? "focused" : ""}" data-candidate="${esc(key(c))}"><button class="open-image" data-open="${esc(key(c))}" aria-label="Focus candidate ${i + 1}, revision ${c.version}"><img src="${imageURL(c)}" alt="Page composition ${i + 1}, revision ${c.version}" loading="lazy"></button><div class="card-meta"><strong>Concept ${i + 1} <small>v${c.version}</small></strong><span class="origin">${originLabel(c)}</span></div><div class="card-actions"><button data-whole="${esc(key(c))}" aria-pressed="${whole}">${whole ? "Whole selected" : "Select whole"}</button><button data-compare="${esc(key(c))}" aria-pressed="${compared.includes(key(c))}">Compare</button></div></article>`;
}
function canvas(c: Work<RasterConcept>) {
  return `<div class="canvas" data-canvas="${esc(key(c))}"><div class="image-plane"><img class="original" src="${imageURL(c)}" alt="Focused page concept, encoded orientation" draggable="false"><svg class="anchors" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">${selected(
    c,
  )
    .map((e) => {
      const a = e.anchor;
      if (a.kind === "whole")
        return `<rect class="whole-anchor" x="1" y="1" width="998" height="998"/>`;
      if (a.kind === "mask") return "";
      return a.kind === "rectangle"
        ? `<rect x="${a.x * 1000}" y="${a.y * 1000}" width="${a.width * 1000}" height="${a.height * 1000}"/>`
        : `<ellipse cx="${(a.x + a.width / 2) * 1000}" cy="${(a.y + a.height / 2) * 1000}" rx="${a.width * 500}" ry="${a.height * 500}"/>`;
    })
    .join("")}</svg></div></div>`;
}
function focusView() {
  const c = active();
  if (!c) return "";
  const comparisons =
    compared.length > 1
      ? allCandidates().filter((c) => compared.includes(key(c)))
      : [c];
  return `<section class="focus-view"><div class="focus-toolbar"><span>${esc(sourceLabel(c))}</span><label>Region <select id="region-tool"><option value="rectangle" ${tool === "rectangle" ? "selected" : ""}>Rectangle</option><option value="ellipse" ${tool === "ellipse" ? "selected" : ""}>Ellipse</option></select></label><label>Zoom <select id="zoom">${[1, 1.5, 2].map((z) => `<option value="${z}" ${zoom === z ? "selected" : ""}>${z * 100}%</option>`).join("")}</select></label><button id="clear-compare">Single focus</button></div><div class="comparison ${comparisons.length > 1 ? "multiple" : ""}">${comparisons.map(canvas).join("")}</div>${contextControls()}<p class="hint">Drag on an image to select a region, or enter a region below. Requests do not change these pixels.</p><details class="region-access"><summary>Add region without dragging</summary><form id="region-form"><label>Shape <select name="shape"><option value="rectangle">Rectangle</option><option value="ellipse">Ellipse</option></select></label>${["x", "y", "width", "height"].map((n) => `<label>${n} (%)<input name="${n}" type="number" min="0" max="100" step="0.1" required></label>`).join("")}<button>Add region to focused concept</button></form></details></section>`;
}
function selectionView() {
  if(review.active)return review.selections();
  return `<aside class="selections"><div class="section-head"><h2>Selected sources <span>${entries().length}</span></h2></div>${
    entries().length
      ? entries()
          .map(
            (e, i) =>
              `<button class="selection-item ${entry === e.id ? "active" : ""}" data-entry="${esc(e.id)}"><img src="${imageURL(allCandidates().find((c) => key(c) === key(e.candidate))!)}" alt=""><span>Source ${i + 1} · ${e.anchor.kind}<small>${esc(sourceLabel(allCandidates().find(c => key(c) === key(e.candidate))!))} · ${e.intent}</small><small>${esc(e.notes[0]?.text ?? "Add a note")}</small></span></button>`,
          )
          .join("")
      : '<p class="empty">Select whole concepts or regions to guide your next variation.</p>'
  }${entryView()}${pendingRemoval.length ? `<div class="draft-removal" role="alert"><p>Removing this source discards its unsaved note and scoped requests. Other drafts stay intact.</p><button id="confirm-remove">Discard source drafts and remove</button><button id="cancel-remove">Keep source drafts</button></div>` : ""}</aside>`;
}
function entryView() {
  const e = entries().find((e) => e.id === entry);
  if (!e) return "";
  const n = draft().notes[noteKey(e)] ?? { note: e.notes[0]?.text ?? "", intent: e.intent };
  return `<form id="annotation"><h3>Source ${entries().indexOf(e) + 1}</h3><label>Use as <select name="intent"><option value="inspiration" ${n.intent === "inspiration" ? "selected" : ""}>Inspiration</option><option value="include" ${n.intent === "include" ? "selected" : ""}>Include</option><option value="exact" ${n.intent === "exact" ? "selected" : ""} ${e.anchor.kind !== "whole" && e.intent !== "exact" ? "disabled" : ""}>${e.preservation?.predicate === "outside-mask-pixels" ? "Exact · existing mask request" : "Exact retained bytes · whole only"}</option></select></label><p class="hint">${e.anchor.kind === "whole" ? "Exact requests retention of these original bytes as a named asset. It does not promise an identical rendered region." : "Exact region preservation needs a binary mask; rectangle/ellipse Exact is unavailable in this slice."}</p>${e.notes
    .slice(1)
    .map((n) => `<p class="hint">Additional saved note: ${esc(n.text)}</p>`)
    .join(
      "",
    )}<label>Note<textarea name="note" rows="3" placeholder="What should carry forward or change?">${esc(n.note)}</textarea></label><button>Save source note</button><button type="button" id="remove-entry">Remove selection</button><details><summary>Original coordinates</summary><pre>${esc(JSON.stringify(e.anchor, null, 2))}</pre></details></form>`;
}
function controls(level: 1 | 2) {
  if (draft().scope !== "" && !entries().some(e => e.id === draft().scope)) return '<p role="status">Source scope unavailable. Restore its saved set, choose another scope explicitly, or discard this page’s drafts.</p>';
  const values = requestValues();
  const fieldView = (c: RequestControl): string => {
    if (c.fields) return `<fieldset data-request="${c.key}"><legend>${esc(c.label)}</legend>${c.fields.map(fieldView).join("")}</fieldset>`;
    const value = values[c.key] ?? "";
    if (c.unavailable) return `<label class="request-control unavailable">${esc(c.label)}<input disabled placeholder="Unavailable for static raster"><small>${esc(c.unavailable)}</small></label>`;
    const field = c.type === "scale"
      ? `<div class="semantic-scale ${value === "" ? "unset" : ""}"><input type="range" data-request="${c.key}" aria-label="${esc(c.label)} request" min="1" max="10" step="0.1" value="${esc(value || "1")}" aria-valuetext="${esc(value || "No request")}"><input type="number" data-number="${c.key}" aria-label="${esc(c.label)} numeric request" min="1" max="10" step="0.1" value="${esc(value)}" placeholder="No request"><button type="button" data-clear="${c.key}" aria-label="Clear ${esc(c.label)} request">Clear</button><output data-output="${c.key}">${esc(value || "No request")}</output></div>`
      : c.type === "category" ? `<select data-request="${c.key}"><option value="">No request</option>${c.options!.map(o => `<option ${value === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`
      : `<input data-request="${c.key}" type="${["count","px"].includes(c.type) ? "number" : "text"}" value="${esc(value)}" placeholder="${c.type === "px" ? "Requested px" : c.type === "color" ? "#RRGGBB" : "No request"}" ${["count","px"].includes(c.type) ? `min="${c.key === "corner-rounding" ? 0 : 1}" max="${c.type === "count" ? 100 : 8192}" step="1"` : ""}>`;
    return `<div class="request-control"><label>${esc(c.label)}${field}</label></div>`;
  };
  return requestControls.filter(c => c.level === level).map(fieldView).join("");
}
function scopeView() {
  return `<label>Request scope<select id="request-scope"><option value="" ${draft().scope === "" ? "selected" : ""}>This page</option>${draft().scope !== "" && !entries().some(e => e.id === draft().scope) ? `<option value="${esc(draft().scope)}" selected disabled>Unavailable source scope</option>` : ""}${entries().map((e,i) => `<option value="${esc(e.id)}" ${draft().scope === e.id ? "selected" : ""}>Source ${i+1} · ${esc(sourceLabel(allCandidates().find(c => key(c) === key(e.candidate))!))}</option>`).join("")}</select></label>`;
}
function contextControls() {
  if(review.active)return "";
  return `<details id="level1-panel" class="context-controls" ${draft().open["level1-panel"] ? "open" : ""}><summary>Direct requests · Level 1 · ${draft().scope === "" ? "This page" : "Selected source"}</summary>${scopeView()}<p class="hint">Six optional requests for the visible scope. Current properties are unmeasured; requests change the next input, not these pixels.</p><div class="controls">${controls(1)}</div></details>`;
}
function prepareView() {
  if(review.active)return `<p class="hint">Review feedback is separate from next-variation input. Choose the blank review iteration option to return to your retained variation draft.</p>`;
  const d = draft();
  const option = (value: string, label: string, current: string) => `<option value="${value}" ${value === current ? "selected" : ""}>${label}</option>`;
  return `<section class="prepare"><div class="section-head"><h2>Next variation</h2><span>Preparation only</span></div><form id="prepare"><label class="intent">Intent<textarea name="intent" rows="2" required placeholder="Describe the next visual direction…">${esc(d.intent)}</textarea></label><div class="prepare-core"><label>Operation<select name="operation">${[["refine","Refine selected sources"],["refresh","Refresh alternatives"],["create","Create direction"],["branch","Branch"]].map(([v,l])=>option(v!,l!,d.operation)).join("")}</select></label><label>Attempts<select name="count" required>${option("","Choose 1–6",d.count)}${[1,2,3,4,5,6].map(n=>option(String(n),String(n),d.count)).join("")}</select></label><label>Direction<select name="direction" required>${option("","Choose Direction",d.direction)}${option("fresh","Fresh",d.direction)}${option("follow","Follow selected direction",d.direction)}</select></label></div><div class="optional"><details id="tune-panel" ${d.open["tune-panel"] ? "open" : ""}><summary>Tune · Level 2 · ${d.scope === "" ? "This page" : "Selected source"}</summary><p class="hint">Requested characteristics only, not measurements. Scales 1.0–10.0. No request until changed; Clear restores unset. Current effect category/strength are unknown.</p><div class="controls">${controls(2)}</div></details><details id="brand-panel" ${d.open["brand-panel"] ? "open" : ""}><summary>Brand · ${d.brand === "" ? "off" : "on"}</summary><label>Optional approved Brand<select name="brand"><option value="">Off · unbranded</option>${catalog.brands.map((b,i) => `<option value="${i}" ${d.brand === String(i) ? "selected" : ""}>${esc(b.label)}</option>`).join("")}</select></label><p class="hint">Brand and Direction are independent.</p></details></div><p class="execution-note">${state!.executionAvailability.connected ? "Offline fixture executor only." : "Image execution is unavailable."} Preparation saves canonical sources and pending slots only; save source notes explicitly before freezing.</p><p class="hint">Session drafts survive view and page/project switches. Reload closes this draft session. Successful preparation retains this editable draft for another explicit operation.</p><button class="primary">Prepare next attempt</button><button type="button" id="discard-draft">Discard this page's unsaved drafts</button></form>${prepared ? `<div class="prepared" role="status"><strong>${prepared.batch.payload.state.attempts.length} pending attempts prepared · draft retained</strong><p>${esc(prepared.specification.payload.state.rawIntent)} · ${prepared.specification.payload.state.direction} · Brand ${prepared.specification.payload.state.brand.enabled ? "on" : "off"}</p><details><summary>Inspect exact frozen input</summary><pre>${esc(JSON.stringify(prepared.specification.payload.state, null, 2))}</pre></details></div>` : ""}</section>`;
}
function executionView() {
  const option=(value:string,label:string,selected:string)=>`<option value="${esc(value)}" ${value===selected?"selected":""}>${esc(label)}</option>`;
  const a=state!.executionAvailability, d=draft().execution;
  const specs=state!.records.filter(p=>p.payload.kind==='raster-specification') as Work<Specification>[];
  const retry=state!.executions.find(e=>e.run.id===d["retry"]);
  return `<section class="execution"><div class="section-head"><h2>Execution</h2><span>${esc(a.connected?"Offline fixture only":"Unavailable")}</span></div><p>${esc(a.label)}</p>${!a.connected?'<button disabled>Execute · no connected executor</button>':`<details id="execution-panel" ${draft().open["execution-panel"]?"open":""}><summary>Explicit offline grant · no image generation</summary><p>Preparing, selecting and tuning grant nothing. Each submit, status and cancellation call consumes a separate bounded allowance. No automatic retry.</p><form id="execution-grant"><label>Frozen operation<select name="spec" required>${option("","Choose prepared input",d["spec"]??"")}${specs.map(q=>option(key(q),`${q.payload.state.count} attempts · ${q.payload.state.rawIntent.slice(0,60)}`,d["spec"]??"")).join("")}</select></label>${retry?`<p>Manual retry of attempt ${esc(d["slot"])} · new grant required. Original frozen request reused.</p>`:""}<div class="execution-fields">${[["width","Raster width (px)"],["height","Raster height (px)"],["submissions","Submission allowance"],["status","Status-call allowance (0–24)"],["cancels","Cancellation-call allowance (0–6)"],["timeout","Call timeout (ms, ≤30000)"],["expires","Grant lifetime (seconds)"]].map(([name,label])=>`<label>${label}<input type="number" name="${name}" required min="${["status","cancels"].includes(name!)?0:1}" value="${esc(d[name!]??"")}"></label>`).join("")}</div><label><input type="checkbox" required> I explicitly grant these bounded offline fixture calls.</label><button>Grant offline execution</button>${retry?'<button type="button" id="clear-execution-retry">Cancel retry preparation</button>':""}</form></details>`}
  ${state!.executions.map(e=>`<article class="execution-run" ${dispatchPending(e.run.id)?'data-dispatch-pending="true"':""}><h3>${e.run.payload.state.retryOf?"Manual retry":"Frozen operation"} · synthetic execution</h3>${dispatchPending(e.run.id)||e.active?'<p role="status">Dispatch in progress · Cancel and Revoke remain available.</p>':""}${e.pendingDeliveries.length&&!e.active?'<p role="status">Response wait ended. A response may still arrive; no resend or provider poll is scheduled.</p>':""}${e.deliveryErrors.map(d=>`<p role="alert">Received-response issue (attempt ${d.slot}): ${esc(d.message)}${d.retryable?` <button data-execution-delivery="${key(e.run)}" data-sequence="${d.sequence}">Retry received evidence · no transport call</button>`:" · No result bytes available; deliberate reconciliation remains separate."}</p>`).join("")}<div class="slots">${e.slots.map(s=>`<span class="slot ${s.displayStatus}">Attempt ${s.slot} · ${esc(s.displayStatus)}${s.receiptSummary?.outcome==="historical"?` · ${s.receiptSummary.hasMedia?"Historical raster retained · not adopted":"Historical response retained · no valid raster"}`:""}${s.cancelRequested?` · cancel requested${s.cancelConfirmed?" / confirmed":" / confirmation unknown"}`:""}${!s.receipt&&s.submissionId?` <button data-execution-reconcile="${key(e.run)}" data-slot="${s.slot}" ${!a.connected||e.active?"disabled":""}>Reconcile owned job</button>`:""}${["failed","invalid","cancelled","uncertain"].includes(s.displayStatus)?` <button data-execution-retry="${key(e.run)}" data-slot="${s.slot}" ${!a.connected?"disabled":""}>Prepare deliberate retry</button>`:""}</span>`).join("")}</div><p>${e.run.payload.state.calls.filter(c=>c.kind==="submit").length}/${e.grant.payload.state.maxSubmissions} submits · ${e.run.payload.state.calls.filter(c=>c.kind==="status").length}/${e.grant.payload.state.maxStatusCalls} status calls · ${e.run.payload.state.calls.filter(c=>c.kind==="cancel").length}/${e.grant.payload.state.maxCancelCalls} cancellation calls${e.grant.payload.state.revoked?" · Grant revoked":""}</p><button data-execution-run="${key(e.run)}" ${!a.connected||e.active||dispatchPending(e.run.id)||e.grant.payload.state.revoked||e.slots.some(s=>["uncertain","running","reserved"].includes(s.displayStatus)&&!s.receipt)||!e.slots.some(s=>s.status==="pending")?"disabled":""}>Execute granted slots</button><button data-execution-cancel="${key(e.run)}" ${e.slots.every(s=>s.receipt||s.cancelRequested) && !e.slots.some(s=>s.cancelRequested&&!s.cancelConfirmed&&!s.receipt&&s.jobId) || [...executionCommands.values()].some(c=>c.executionId===e.run.id&&c.action==="cancel-execution")?"disabled":""}>Cancel this execution</button><button data-execution-revoke="${key(e.run)}" ${e.grant.payload.state.revoked||[...executionCommands.values()].some(c=>c.executionId===e.run.id&&c.action==="revoke-execution")?"disabled":""}>Revoke grant</button><button data-execution-refresh="${key(e.run)}">Refresh stored progress · no provider poll</button><details><summary>Inspect frozen request and accounting</summary><pre>${esc(JSON.stringify({request:e.request.payload.state,execution:e.run.payload.state},null,2))}</pre></details></article>`).join("")}</section>`;
}
function historyView() {
  const batches = state!.records.filter(
    (p) => p.payload.kind === "raster-batch",
  ) as Work<Batch>[];
  return `<details class="history"><summary>History · ${batches.length} batches</summary>${batches.map((b, i) => `<article><h3>Batch ${i + 1} · ${b.payload.state.retryOf ? "Manual retry" : "Prepared operation"}</h3><div class="slots">${b.payload.state.attempts.map((a) => `<span class="slot ${a.status}">Attempt ${a.slot} · ${a.status}${["failed", "invalid", "cancelled", "uncertain"].includes(a.status) ? ` <button data-retry="${key(b)}" data-slot="${a.slot}">Prepare manual retry</button>` : ""}</span>`).join("")}</div>${b.payload.state.attempts.some((a) => ["pending", "running"].includes(a.status)) ? `<button data-cancel="${key(b)}">Cancel pending work</button>` : ""}<details><summary>Frozen specification</summary><pre>${esc(JSON.stringify((state!.records.find((q) => key(q) === key(b.payload.state.spec)) as Work<Specification>)?.payload.state, null, 2))}</pre></details></article>`).join("")}</details>`;
}
type MemoryState = {
  notes: { ref: VersionRef; integrity: string; note: HandoffNote }[];
  capsules: { ref: VersionRef; scope: VersionRef | null }[];
  coverage: {
    notes: number;
    capsules: number;
    omittedNotes: number;
    omittedCapsules: number;
    next: number | null;
  };
};
type MemoryCapsule = {
  ref: VersionRef;
  integrity: string;
  snapshot: MemoryIndex;
  currency: {
    availability:{missing:number;corrupt:number;mediaUnavailable:number;unknownScope:number};
    status: string;
    details: { ref: VersionRef; status: string }[];
    added: number | null;
  };
  preview: {
    entries: number;
    events: number;
    scope: VersionRef | null;
    content: string;
  };
};
type MemoryView = {
  text: string;
  expected: VersionRef | null;
  noteScope: VersionRef | null;
  links: EvidenceLink[];
  data: MemoryState | null;
  index:
    | (MemoryIndex & {
        next: number | null;
        coverage: MemoryIndex["coverage"] & {
          returned: number;
          omitted: number;
        };
      })
    | null;
  capsule: MemoryCapsule | null;
  inspection: EvidenceEntry | null;
  status: string;
  pending: boolean;
};
let memoryScope: "page" | "project" = "page";
const memoryViews = new Map<string, MemoryView>();
const memoryOwner = () => ({
  projectId: pid,
  scope: memoryScope === "page" && state ? ref(state.unit) : null,
});
const memoryKey = (o: ReturnType<typeof memoryOwner>) =>
  JSON.stringify([o.projectId, o.scope]);
function memoryView() {
  const k = memoryKey(memoryOwner());
  if (!memoryViews.has(k))
    memoryViews.set(k, {
      text: "",
      expected: null,
      noteScope: memoryOwner().scope,
      links: [],
      data: null,
      index: null,
      capsule: null,
      inspection: null,
      status: "Load saved project evidence to continue.",
      pending: false,
    });
  return memoryViews.get(k)!;
}
const memoryQuery = (o: ReturnType<typeof memoryOwner>, r?: VersionRef) =>
  new URLSearchParams({
    project: o.projectId,
    ...(o.scope
      ? { scope: o.scope.id, scopeVersion: String(o.scope.version) }
      : {}),
    ...(r ? { id: r.id, version: String(r.version) } : {}),
  }).toString();
async function memoryAction(
  action: (v: MemoryView, o: ReturnType<typeof memoryOwner>) => Promise<void>,
) {
  const o = memoryOwner(),
    v = memoryView();
  if (v.pending) return;
  v.pending = true;
  v.status = "Reading or saving project memory…";
  render();
  try {
    await action(v, o);
  } catch (e) {
    v.status =
      e instanceof Error ? e.message : "Memory unavailable; draft retained";
  } finally {
    v.pending = false;
    if (memoryKey(memoryOwner()) === memoryKey(o)) {
      const restore = executionFocus();
      render();
      restore();
    }
  }
}
async function loadMemory(
  v: MemoryView,
  o: ReturnType<typeof memoryOwner>,
  from = 0,
) {
  const q = memoryQuery(o);
  v.data = await get("memory/state?" + q);
  v.index = await get("memory/index?" + q + "&offset=" + from + "&limit=20");
  if (v.capsule)
    v.capsule = await get("memory/capsule?" + memoryQuery(o, v.capsule.ref));
  v.status =
    "Stored evidence loaded. Unsaved drafts are separate; no execution or adoption occurred.";
}
type LibraryView = {
  open: boolean;
  pending: boolean;
  status: string;
  target: string;
  data: {
    entries: {
      ref: VersionRef;
      integrity: string;
      state: LibraryItem | null;
      status: string;
    }[];
    coverage: { total: number; omitted: number; unknownPrimary: number };
    next: number | null;
  } | null;
  preview: {
    manifest: RasterManifest;
    pointer: VersionRef;
    integrity: string;
    unit: VersionRef | null;
  } | null;
};
const libraryViews = new Map<string, LibraryView>();
const libraryOwner = () => ({
  projectId: pid,
  project: project!,
  unit: ref(state!.unit),
});
const libraryKey = (o: ReturnType<typeof libraryOwner>) =>
  o.projectId + ":" + key(o.unit);
function libraryView() {
  const k = libraryKey(libraryOwner());
  if (!libraryViews.has(k))
    libraryViews.set(k, {
      open: false,
      pending: false,
      status: "Load project Library to browse saved rasters.",
      target: key(state!.unit),
      data: null,
      preview: null,
    });
  return libraryViews.get(k)!;
}
const libraryQuery = (
  pid: string,
  r: VersionRef,
  integrity: string,
  unit: VersionRef | null = null,
) =>
  new URLSearchParams({
    project: pid,
    id: r.id,
    version: String(r.version),
    integrity,
    ...(unit ? { unit: unit.id, unitVersion: String(unit.version) } : {}),
  }).toString();
async function libraryAction(
  action: (v: LibraryView, o: ReturnType<typeof libraryOwner>) => Promise<void>,
) {
  const o = libraryOwner(),
    v = libraryView();
  if (v.pending) return;
  v.pending = true;
  v.open = true;
  v.status = "Reading or saving this whole raster…";
  const restore = executionFocus();
  render();
  restore();
  try {
    await action(v, o);
  } catch (e) {
    v.status =
      e instanceof Error
        ? e.message
        : "Library unavailable; no selection or acceptance changed";
  } finally {
    v.pending = false;
    if (state && libraryKey(libraryOwner()) === libraryKey(o)) {
      const focus = root.contains(document.activeElement)
        ? executionFocus()
        : restore;
      render();
      focus();
    }
  }
}
function libraryPanel() {
  const v = libraryView(),
    preview = v.preview,
    m = preview?.manifest;
  const rows = (v.data?.entries ?? [])
    .map(
      (e, i) =>
        `<article class="library-card"><button data-library-inspect="${key(e.ref)}" ${v.pending ? "disabled" : ""}>${e.state ? `<img src="/api/v1/visual/library/original?${esc(libraryQuery(pid, e.ref, e.integrity))}" alt="Saved whole raster ${i + 1}">` : ""}<span>Saved raster ${i + 1} · v${e.ref.version}</span></button><p>${e.state ? `${esc(e.state.origin)} · source v${e.state.candidate.version} · ${e.state.image.width} × ${e.state.image.height} encoded px` : "Exact source or media unavailable; inspect to retry."}</p><p>${esc(e.status)}</p></article>`,
    )
    .join("");
  const exportQuery = preview
      ? libraryQuery(pid, preview.pointer, preview.integrity, preview.unit)
      : "",
    prefix = preview?.unit ? "candidate-" : "";
  return `<details id="project-library" class="project-memory" ${v.open ? "open" : ""}><summary>Project Library / Raster export</summary><p>Save one whole raster or reuse it on a named page in this project. Selection, acceptance, Brand and execution stay separate.</p><button id="library-load" ${v.pending ? "disabled" : ""}>Load project Library</button><p id="library-status" role="status">${esc(v.status)}</p>${v.data ? `<p>${v.data.coverage.total} saved rasters · ${v.data.coverage.omitted} outside this list · ${v.data.coverage.unknownPrimary} canonical versions with unknown content. Project memory exposes that unresolved evidence.</p>${v.data.coverage.total === 0 ? '<p id="library-empty">No rasters saved in this project yet.</p>' : ""}<div class="library-grid">${rows}</div>${v.data.next !== null ? `<button id="library-more" data-offset="${v.data.next}" ${v.pending ? "disabled" : ""}>Next Library items</button>` : ""}` : ""}${m ? `<article class="library-preview"><h3>Whole raster · source v${m.source.candidate.version}</h3><img class="library-image" src="/api/v1/visual/library/${prefix}original?${esc(exportQuery)}" alt="Preview of exact whole raster to reuse or export"><p>${esc(m.provenance.origin)} · ${m.raster.image.width} × ${m.raster.image.height} stored pixels · ${m.raster.orientation.displayWidth} × ${m.raster.orientation.displayHeight} displayed pixels · EXIF orientation ${m.raster.orientation.exif ?? "absent"}</p><p id="library-rights">Rights / provenance: ${esc(m.provenance.rights)}</p><p>Whole image only. Region selections are not exported; crop and batch export are unavailable. Original metadata and bytes are preserved.</p>${m.library ? `<label>Reuse on page<select id="library-target">${units.map((u) => `<option value="${key(u)}" ${v.target === key(u) ? "selected" : ""}>${esc(u.payload.state.label)}</option>`).join("")}</select></label><button id="library-reuse" ${v.pending ? "disabled" : ""}>Use whole raster on named page</button><p>Creates a new candidate; explicitly select it afterward. Repeating this item/page action retains the same candidate.</p>` : "<p>This focused raster can be exported without saving or accepting it.</p>"}<div class="library-downloads"><a id="library-original" download href="/api/v1/visual/library/${prefix}original?${esc(exportQuery)}">Download original ${esc(m.raster.extension.toUpperCase())}</a><a id="library-package" download href="/api/v1/visual/library/${prefix}package?${esc(exportQuery)}">Download raster + manifest package</a></div><details><summary>Exact identity and export manifest</summary><pre id="library-manifest">${esc(JSON.stringify(m, null, 2))}</pre></details></article>` : ""}</details>`;
}
function bindLibrary() {
  if (!state) return;
  const boundView = libraryView();
  root
    .querySelector<HTMLDetailsElement>("#project-library")
    ?.addEventListener("toggle", (e) => {
      boundView.open = (e.target as HTMLDetailsElement).open;
    });
  const on = (id: string, action: () => void) =>
    root.querySelector("#" + id)?.addEventListener("click", action);
  const load = (
    v: LibraryView,
    o: ReturnType<typeof libraryOwner>,
    offset = 0,
  ) =>
    get(
      "library/state?" +
        new URLSearchParams({ project: o.projectId, offset: String(offset) }),
    ).then((x) => {
      v.data = x;
    });
  on(
    "library-load",
    () =>
      void libraryAction(async (v, o) => {
        await load(v, o);
        v.status =
          "Saved project rasters loaded. No selection or execution changed.";
      }),
  );
  on(
    "library-more",
    () =>
      void libraryAction(async (v, o) => {
        await load(
          v,
          o,
          Number(
            root.querySelector<HTMLElement>("#library-more")?.dataset["offset"],
          ),
        );
        v.status = "Next saved rasters loaded.";
      }),
  );
  on("library-save", () => {
    const c = active();
    if (!c) return;
    void libraryAction(async (v, o) => {
      const result = await post(
        "library/save",
        {
          expectedProject: o.project,
          unit: o.unit,
          candidate: ref(c),
          integrity: c.integrity,
          extent: "whole",
        },
        o.projectId,
      );
      await load(v, o);
      const inspected = await get(
        "library/item?" +
          libraryQuery(o.projectId, ref(result.item), result.item.integrity),
      );
      v.preview = {
        manifest: inspected.manifest,
        pointer: ref(result.item),
        integrity: result.item.integrity,
        unit: null,
      };
      v.status = result.duplicate
        ? "This exact whole raster is already saved; no duplicate created."
        : "Whole raster saved to project Library. No selection or acceptance changed.";
    });
  });
  on("raster-export", () => {
    const c = active();
    if (!c) return;
    void libraryAction(async (v, o) => {
      const p = await get(
        "library/candidate-preview?" +
          libraryQuery(o.projectId, ref(c), c.integrity, o.unit),
      );
      v.preview = {
        manifest: p.manifest,
        pointer: ref(c),
        integrity: c.integrity,
        unit: o.unit,
      };
      v.status =
        "Preview the focused whole raster before downloading. No Library save or acceptance required.";
    });
  });
  root
    .querySelectorAll<HTMLButtonElement>("[data-library-inspect]")
    .forEach((b) =>
      b.addEventListener(
        "click",
        () =>
          void libraryAction(async (v, o) => {
            const e = v.data?.entries.find(
              (e) => key(e.ref) === b.dataset["libraryInspect"],
            );
            if (!e) throw Error("Reload project Library");
            const p = await get(
              "library/item?" + libraryQuery(o.projectId, e.ref, e.integrity),
            );
            v.preview = {
              manifest: p.manifest,
              pointer: e.ref,
              integrity: e.integrity,
              unit: null,
            };
            v.status =
              "Exact saved source previewed; source replacements cannot substitute its bytes.";
          }),
      ),
    );
  root.querySelector("#library-target")?.addEventListener("change", (e) => {
    libraryView().target = (e.target as HTMLSelectElement).value;
  });
  on(
    "library-reuse",
    () =>
      void libraryAction(async (v, o) => {
        const p = v.preview,
          target = units.find((u) => key(u) === v.target);
        if (!p || !p.manifest.library || !target)
          throw Error("Choose a saved item and named project page");
        const result = await post(
          "library/reuse",
          {
            expectedProject: o.project,
            unit: ref(target),
            item: p.pointer,
            integrity: p.integrity,
          },
          o.projectId,
        );
        v.status =
          (result.duplicate
            ? "Existing reused candidate retained"
            : "New candidate added") +
          " on " +
          target.payload.state.label +
          ". Choose it explicitly to select or annotate.";
        if (state && libraryKey(libraryOwner()) === libraryKey(o))
          await reload(true);
      }),
  );
}
function memoryPanel() {
  const v = memoryView(),
    scope = memoryScope,
    preview = v.capsule?.preview;
  const outcome = (e: EvidenceEntry) => {
    const s = e.summary as Record<string, any> | null;
    if (!s) return "";
    if (e.kind === "raster-execution-receipt" || e.kind === "raster-receipt")
      return ` · ${s["outcome"]} · ${s["outcome"] === "historical" ? "historical evidence, not adopted" : s["outcome"] === "succeeded" ? "canonical result, not acceptance" : "no adopted result"}`;
    if (e.kind === "raster-execution")
      return ` · ${(s["slots"] as { status: string }[]).map((s) => (["reserved", "running"].includes(s.status) ? s.status + " (unresolved)" : s.status)).join(" / ")} · ${s["calls"].length} recorded transport calls`;
    if (e.kind === "raster-batch")
      return ` · ${(s["attempts"] as { status: string }[]).map((a) => a.status).join(" / ")} · synthetic registration only`;
    if (e.kind === "raster-specification")
      return ` · ${s["count"]} requested attempts · ${s["direction"]} · Brand ${s["brand"].enabled ? "on" : "off"}`;
    if (e.kind === "raster-selections")
      return ` · ${s["entries"].length} saved sources · selection is not acceptance`;
    return "";
  };
  const eList = (entries: EvidenceEntry[]) =>
    entries
      .map(
        (e) =>
          `<li><button data-memory-evidence="${esc(key(e.ref))}" data-memory-integrity="${esc(e.integrity ?? "")}">${esc(e.kind)} · v${e.ref.version}</button> <span>${esc(e.status)}${e.media === "unavailable" ? " · media unavailable" : ""}</span>${e.kind==="unknown"?" · page scope unknown; unavailable evidence":""}${esc(outcome(e))}${e.kind === "raster-concept" ? ` · ${esc((e.summary as { origin?: string } | null)?.origin ?? "unknown provenance")} · selection is not acceptance` : ""}</li>`,
      )
      .join("");
  return `<details id="memory-panel" class="project-memory" ${draft().open["memory-panel"] ? "open" : ""}><summary>Project memory / Continue</summary><p>Saved canonical evidence and human notes. Chat is optional. This index grants no execution and approves no design or Brand rule.</p><label>Continuation scope<select id="memory-scope"><option value="page" ${scope === "page" ? "selected" : ""}>This page + exact source closure</option><option value="project" ${scope === "project" ? "selected" : ""}>Whole project</option></select></label><button id="memory-load" ${v.pending ? "disabled" : ""}>Load / refresh stored evidence</button><p id="memory-status" role="status">${esc(v.status)}</p>
 <div class="memory-columns"><section><h2>Saved handoff notes</h2>${v.data?.notes.map((n) => `<article><p>${esc(n.note.text)}</p><small>Human-authored · v${n.ref.version} · ${n.note.scope ? "Page note" : "Project note"}</small><button data-memory-edit="${esc(key(n.ref))}" ${v.pending ? "disabled" : ""}>Edit saved note</button></article>`).join("") ?? ""}${v.data?.coverage.omittedNotes ? `<p>${v.data.coverage.omittedNotes} notes beyond the first 50; use Next saved records.</p>` : ""}
 <form id="memory-note"><label>${v.expected ? "Edit exact note revision v" + v.expected.version : "New human handoff note"}<textarea id="memory-note-text" name="text" maxlength="4000" rows="3" required>${esc(v.text)}</textarea></label><p>${v.links.length} exact evidence links attached. Notes express intent, never tool instructions.</p><button ${v.pending ? "disabled" : ""}>Save handoff note</button><button id="memory-new-note" type="button" ${v.pending ? "disabled" : ""}>New note draft</button></form></section>
 <section><h2>Continuation capsules</h2><button id="memory-create" ${v.pending ? "disabled" : ""}>Create frozen capsule</button>${v.data?.capsules.map((c) => `<button data-memory-capsule="${esc(key(c.ref))}" ${v.pending ? "disabled" : ""}>Inspect capsule ${esc(c.ref.id.slice(-8))}</button>`).join("") ?? ""}${v.data?.coverage.omittedCapsules ? `<p>${v.data.coverage.omittedCapsules} more capsules; use Next saved records.</p>` : ""}
 ${v.capsule ? `<article class="memory-capsule"><h3>Capsule currency: <span id="memory-currency">${esc(v.capsule.currency.status)}</span></h3><p id="memory-availability">${v.capsule.currency.availability.missing} missing · ${v.capsule.currency.availability.corrupt} corrupt · ${v.capsule.currency.availability.mediaUnavailable} unavailable media · ${v.capsule.currency.availability.unknownScope} unknown scope. Unavailable sources are unresolved coverage, not recovered content.</p><p>${preview!.entries} exact evidence versions · ${preview!.events} workflow events · ${preview!.scope ? "Page scope" : "Project scope"}</p><p>${esc(preview!.content)}</p><p>JSON contains saved summaries and references only. Media bytes, chat, accounts and process observations are absent. This is not a media backup or restore package.</p><button id="memory-refresh" ${v.pending ? "disabled" : ""}>Refresh into new capsule</button><a id="memory-download" download href="/api/v1/visual/memory/download?${esc(memoryQuery(memoryOwner(), v.capsule.ref))}">Download previewed JSON</a><details><summary>Frozen exact sources · ${v.capsule.snapshot.entries.length}</summary><ul>${eList(v.capsule.snapshot.entries.slice(0, 50))}</ul>${v.capsule.snapshot.entries.length > 50 ? "<p>First 50 shown; the previewed JSON includes the full bounded snapshot.</p>" : ""}</details><p>${v.capsule.currency.details.filter((d) => d.status !== "current").length} changed or unavailable exact sources; ${v.capsule.currency.added ?? "unknown"} added versions.</p></article>` : ""}</section></div>
 ${v.data?.coverage.next !== null && v.data?.coverage.next !== undefined ? `<button id="memory-saved-more" data-offset="${v.data.coverage.next}" ${v.pending ? "disabled" : ""}>Next saved records</button>` : ""}<button id="memory-saved-first" ${v.pending ? "disabled" : ""}>First saved records</button>
 ${v.index ? `<details open><summary>Evidence index · ${v.index.coverage.entries} versions · ${v.index.coverage.omitted} outside this page</summary><ul>${eList(v.index.entries)}</ul>${v.index.next !== null ? `<button id="memory-more" data-offset="${v.index.next}" ${v.pending ? "disabled" : ""}>Next evidence page</button>` : ""}<button id="memory-first" ${v.pending ? "disabled" : ""}>First evidence page</button><p>${v.index.coverage.unsupported} unsupported records explicitly excluded. Raster provenance and receipt outcome are factual; visual quality and cost remain unknown.</p></details>` : ""}
 ${v.inspection ? `<section class="memory-inspection"><h3>Exact evidence · ${esc(v.inspection.kind)} · v${v.inspection.ref.version}</h3><p>${esc(v.inspection.status)} · media ${esc(v.inspection.media)}</p><pre id="memory-evidence-json">${esc(JSON.stringify(v.inspection, null, 2))}</pre>${v.inspection.status === "available" ? '<button id="memory-link-note">Attach exact evidence to note draft</button>' : ""}</section>` : ""}
 ${state!.executions.some((e) => e.active || e.pendingDeliveries.length || e.deliveryErrors.length) ? '<p class="hint">Current-session execution activity is shown in Execution below. It is not included in saved capsules or promised after restart.</p>' : ""}</details>`;
}
function bindMemory() {
  if (!state) return;
  const on = (id: string, event: string, fn: (e: Event) => void) =>
    document.getElementById(id)?.addEventListener(event, fn);
  const owner = memoryKey(memoryOwner());
  on("memory-note-text", "input", (e) => {
    if (memoryKey(memoryOwner()) === owner)
      memoryView().text = (e.target as HTMLTextAreaElement).value;
  });
  on("memory-scope", "change", (e) => {
    memoryScope = (e.target as HTMLSelectElement).value as typeof memoryScope;
    render();
  });
  on(
    "memory-load",
    "click",
    () => void memoryAction((v, o) => loadMemory(v, o)),
  );
  on(
    "memory-more",
    "click",
    (e) =>
      void memoryAction((v, o) =>
        loadMemory(
          v,
          o,
          Number((e.currentTarget as HTMLElement).dataset["offset"]),
        ),
      ),
  );
  on(
    "memory-saved-more",
    "click",
    (e) =>
      void memoryAction(async (v, o) => {
        v.data = await get(
          "memory/state?" +
            memoryQuery(o) +
            "&offset=" +
            (e.currentTarget as HTMLElement).dataset["offset"],
        );
        v.status = "Next bounded saved-record page loaded; draft retained.";
      }),
  );
  on(
    "memory-saved-first",
    "click",
    () =>
      void memoryAction(async (v, o) => {
        v.data = await get("memory/state?" + memoryQuery(o));
        v.status = "First saved records loaded; draft retained.";
      }),
  );
  on(
    "memory-first",
    "click",
    () => void memoryAction((v, o) => loadMemory(v, o)),
  );
  on("memory-note", "submit", (e) => {
    e.preventDefault();
    void memoryAction(async (v, o) => {
      const saved = await post(
        "memory/note",
        {
          expected: v.expected,
          note: {
            version: 1,
            scope: v.expected ? v.noteScope : o.scope,
            text: v.text,
            source: "human-authored",
            evidence: v.links,
          },
        },
        o.projectId,
      );
      v.expected = ref(saved);
      await loadMemory(v, o);
      v.status =
        "Handoff note saved explicitly. Earlier revisions remain available.";
    });
  });
  on("memory-new-note", "click", () => {
    const v = memoryView();
    v.expected = null;
    v.status =
      "New note draft. Existing text and links retained for explicit editing.";
    render();
  });
  root.querySelectorAll<HTMLButtonElement>("[data-memory-edit]").forEach(
    (b) =>
      (b.onclick = () => {
        const v = memoryView(),
          n = v.data!.notes.find(
            (n) => key(n.ref) === b.dataset["memoryEdit"],
          )!;
        if (
          v.text &&
          v.text !== n.note.text &&
          !confirm(
            "Replace the current unsaved handoff-note draft with this saved revision?",
          )
        )
          return;
        v.text = n.note.text;
        v.links = n.note.evidence;
        v.expected = n.ref;
        v.noteScope = n.note.scope;
        v.status =
          "Editing exact saved note revision; conflicting saves preserve this draft.";
        render();
      }),
  );
  const freeze = (refresh: boolean) =>
    void memoryAction(async (v, o) => {
      const saved = await post(
        "memory/create",
        {
          scope: refresh ? v.capsule!.snapshot.scope : o.scope,
          previous: refresh ? v.capsule!.ref : null,
        },
        o.projectId,
      );
      v.capsule = await get("memory/capsule?" + memoryQuery(o, ref(saved)));
      await loadMemory(v, o);
      v.status =
        "Frozen capsule saved. Creation bookkeeping does not change its evidence currency.";
    });
  on("memory-create", "click", () => freeze(false));
  on("memory-refresh", "click", () => freeze(true));
  root.querySelectorAll<HTMLButtonElement>("[data-memory-capsule]").forEach(
    (b) =>
      (b.onclick = () =>
        void memoryAction(async (v, o) => {
          const c = v.data!.capsules.find(
            (c) => key(c.ref) === b.dataset["memoryCapsule"],
          )!;
          v.capsule = await get("memory/capsule?" + memoryQuery(o, c.ref));
          v.status = "Frozen evidence inspected; currency checked separately.";
        })),
  );
  root.querySelectorAll<HTMLButtonElement>("[data-memory-evidence]").forEach(
    (b) =>
      (b.onclick = () =>
        void memoryAction(async (v, o) => {
          const [id, version] = b.dataset["memoryEvidence"]!.split(":"),
            r = {
              id: id!,
              version: Number(version),
              freshness: "pinned" as const,
            };
          v.inspection = await get(
            "memory/evidence?" +
              memoryQuery(o, r) +
              (b.dataset["memoryIntegrity"]
                ? "&integrity=" + b.dataset["memoryIntegrity"]
                : ""),
          );
          v.status = "Exact version inspected; no latest-version substitution.";
        })),
  );
  on("memory-link-note", "click", () => {
    const v = memoryView(),
      e = v.inspection!;
    if (!v.links.some((l) => key(l.ref) === key(e.ref)))
      v.links.push({ ref: e.ref, integrity: e.integrity! });
    v.status =
      "Exact evidence attached to unsaved note draft. Save explicitly.";
    render();
  });
}

function render() {
  const recoveryUnit=units.find(u=>key(u)===errorUnit);
  review.setContext(state?.reviewAvailable?{pid,unit:ref(state.unit),iterations:state.productionIterations}:workspaceError&&catalog.reviewAvailable&&recoveryUnit?{pid,unit:ref(recoveryUnit),iterations:[],readOnly:true}:null);
  const focusId = (document.activeElement as HTMLElement)?.id;
  root.innerHTML = `<header><a class="wordmark" href="/visual">BVE <span>VISUAL STUDIO</span></a><span class="review-tag">Interaction review · no image execution</span><a href="/legacy">Legacy semantic workspace</a></header><main id="workspace"><div class="workspace-title"><div><p class="eyebrow">WEBSITE EXPLORATION</p><h1>${esc(state?.title ?? (workspaceError?catalog.projects.find(p=>p.ref.id===pid)?.title:undefined) ?? (pid ? "Start a page" : "Start with a page."))}</h1></div><label>Review layout<select id="layout"><option value="sheet" ${layout === "sheet" ? "selected" : ""}>A · Contact sheet + Focus</option><option value="film" ${layout === "film" ? "selected" : ""}>B · Focus + Filmstrip</option></select></label></div><div class="entry-bar"><label>Project<select id="project"><option value="">Choose project</option>${catalog.projects.map((p) => `<option value="${p.ref.id}" ${pid === p.ref.id ? "selected" : ""}>${esc(p.title)}</option>`).join("")}</select></label><details class="entry-extra" ${pid ? "" : "open"}><summary>New project</summary><form id="new-project"><input name="title" required aria-label="New Website project name" placeholder="New Website project"><button>Create project</button></form></details>${pid ? `<label>Page<select id="page"><option value="">Choose page</option>${units.map((u) => `<option value="${key(u)}" ${(state ? key(state.unit) === key(u) : workspaceError && errorUnit === key(u)) ? "selected" : ""}>${esc(u.payload.state.label)}</option>`).join("")}</select></label><details class="entry-extra" id="page-tools" ${state ? "" : "open"}><summary>Add page</summary><form id="new-page"><select name="type" aria-label="Page type"><option value="homepage">Homepage</option><option value="about">About Us</option><option value="custom">Custom page</option></select><input name="label" aria-label="Page label" placeholder="Page label (optional)"><button>Add page</button></form></details>` : ""}</div>${
    state
      ? `<div class="action-bar">${
          selectionSets()!.length > 1
            ? `<label>Saved selections<select id="selection-set"><option value="">Choose a saved set</option>${selectionSets()!
                .map(
                  (s, i) =>
                    `<option value="${s.id}" ${selectionId === s.id ? "selected" : ""}>Set ${i + 1} · v${s.version}</option>`,
                )
                .join("")}</select></label>`
            : ""
        }<details class="entry-extra" id="import-tools" ${state.candidates.length ? "" : "open"}><summary>Import raster</summary><form id="import"><label class="import-pick">Import PNG / JPEG / WebP<input name="file" type="file" accept="image/png,image/jpeg,image/webp" required></label><input name="permission" aria-label="Image use permission" placeholder="Permission / source" required><label>Import as<select name="previous"><option value="">New concept</option>${state.candidates.map((c, i) => `<option value="${key(c)}">Replace Concept ${i + 1} · v${c.version}</option>`).join("")}</select></label><button>Import raster</button></form></details><div class="deferred"><button id="library-save" ${active()&&!libraryView().pending?"":"disabled"}>Add whole raster to Library</button><button id="raster-export" ${active()&&!libraryView().pending?"":"disabled"}>Export whole raster</button><button id="build-html" ${active()?"":"disabled"}>Build as HTML</button></div></div><p class="hint">Library save, raster export and later HTML reconstruction are separate operations.</p>${review.panel()}<div class="studio ${layout}"><div class="visual-area">${(state.candidates.length || state.selectedSources.length) ? (layout === "sheet" ? `<section class="contact-sheet" aria-label="Candidate contact sheet">${groups()}</section>${focusView()}` : `${focusView()}<section class="filmstrip" aria-label="Candidate filmstrip">${state.candidates.map((c, i) => card(c, i, true)).join("")}</section>`) : `<div class="empty-canvas"><h2>Your next direction starts here.</h2><p>Import raster concepts to compare, select and annotate.</p><p>No image generator is connected in this review slice.</p>${contextControls()}</div>`}</div>${selectionView()}</div><div id="reconstruction-root"></div>${libraryPanel()}${memoryPanel()}${prepareView()}${nativeView(state.nativeExchange,esc,state.records.filter(p=>p.payload.kind==="raster-specification"),Boolean(draft().open["native-exchange-panel"]))}${executionView()}${historyView()}`
      : workspaceError ? `<section class="workspace-error" role="alert"><h2>Workspace unavailable</h2><p>${esc(workspaceError)}</p><p>Stored sources could not be validated. No records or drafts were changed.</p><button id="retry-open">Retry reopen</button></section>${review.panel()}${review.selections()}` : '<section class="welcome"> <h2>A visual place to explore.</h2><p>Create a Website project and choose Homepage, About Us or a custom page. Brand setup and chat are optional.</p></section>'
  }</main>`;
  bind();
  if (focusId) document.getElementById(focusId)?.focus();
}
function groups() {
  const batches = state!.records.filter(
    (p) => p.payload.kind === "raster-batch",
  ) as Work<Batch>[];
  const assigned = new Set<string>();
  let html = "";
  for (const [i, b] of batches.entries()) {
    const candidates = b.payload.state.attempts.flatMap((a) =>
      a.result
        ? state!.candidates.filter((c) => key(c) === key(a.result!))
        : [],
    );
    candidates.forEach((c) => assigned.add(key(c)));
    html += `<div class="batch-group"><h2>Batch ${i + 1} <small>${b.payload.state.attempts.map((a) => a.status).join(" / ")}</small></h2><div class="card-grid">${candidates.map((c) => card(c, state!.candidates.indexOf(c))).join("")}</div></div>`;
  }
  for(const [i,e] of state!.executions.entries()) {
    const candidates=e.outputs.map(r=>state!.candidates.find(c=>key(c)===key(r))).filter((c):c is Work<RasterConcept>=>!!c);
    candidates.forEach(c=>assigned.add(key(c)));
    if(candidates.length)html+=`<div class="batch-group"><h2>Offline execution ${i+1} <small>Synthetic fixtures · ${e.slots.map(s=>s.displayStatus).join(" / ")}</small></h2><div class="card-grid">${candidates.map(c=>card(c,state!.candidates.indexOf(c))).join("")}</div></div>`;
  }
  for(const [i,iteration] of state!.productionIterations.entries()) {
    const candidates=iteration.proposals.map(p=>state!.candidates.find(c=>key(c)===key(p.candidate))).filter((c):c is Work<RasterConcept>=>!!c);
    candidates.forEach(c=>assigned.add(key(c)));
    html+=`<div class="batch-group"><h2>Production iteration ${i+1} <small>${esc(iteration.status)} · ${candidates.length}/${iteration.count} proposals</small></h2><div class="card-grid">${candidates.map(c=>card(c,state!.candidates.indexOf(c))).join("")}</div></div>`;
  }
  const imports = state!.candidates.filter((c) => !assigned.has(key(c)));
  return (
    html +
    (imports.length
      ? `<div class="batch-group"><h2>Imported & reference concepts</h2><div class="card-grid">${imports.map((c) => card(c, state!.candidates.indexOf(c))).join("")}</div></div>`
      : "")
  );
}
function bind() {
  review.bind(root);
  bindLibrary();
  bindMemory();
  bindReconstruction(state&&project?{pid,project,unit:ref(state.unit),focus:active()??null,brands:catalog.brands,post}:null);
  bindAuxiliary(
    state && project
      ? {
          pid,
          project,
          unit: ref(state.unit),
          focus: {
            kind: "visual-page",
            unit: ref(state.unit),
            raster: active()
              ? { ref: ref(active()!), integrity: active()!.integrity }
              : null,
            region:
              entry &&
              selection() &&
              entries().find(
                (e) =>
                  e.id === entry &&
                  e.anchor.kind !== "whole" &&
                  active() &&
                  key(e.candidate) === key(active()!),
              )
                ? {
                    selections: ref(selection()!),
                    integrity: selection()!.integrity,
                    entryId: entry,
                  }
                : null,
          },
          brands: catalog.brands,
          post,
          variation: () => ({
            key: requestScopeKey(),
            values: {
              intent: draft().intent,
              ...Object.fromEntries(
                requestFields
                  .filter((c) => !c.unavailable && requestValues()[c.key])
                  .map((c) => [
                    "level" + c.level + ":" + c.key,
                    ["scale", "count", "px"].includes(c.type)
                      ? Number(requestValues()[c.key])
                      : requestValues()[c.key],
                  ]),
              ),
            },
          }),
          applyVariation: (edits) => {
            for (const e of edits) {
              if (e.field === "intent") draft().intent = String(e.after);
              else setRequest(e.field.split(":")[1]!, String(e.after));
            }
            render();
          },
          preparation: auxiliaryPreparationDraft,
          operation: auxiliaryOperationFocus,
          semantic: auxiliarySemanticProposal,
          bridgeDone: auxiliaryBridgeDone,
        }
      : null,
  );
  observers.forEach((o) => o.disconnect());
  observers = [];
  root.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
    img.onerror = () => {
      img.alt = "Raster unavailable: stored media could not be validated";
      img.closest(".candidate, .canvas")?.classList.add("invalid-media");
      notice.textContent =
        "Raster unavailable. Stored media could not be validated; no source was changed.";
    };
  });
  const on = (id: string, event: string, fn: (e: Event) => void) =>
    document.getElementById(id)?.addEventListener(event, fn);
  const boundScope=JSON.stringify([pid,state?key(state.unit):null]);
  root.querySelectorAll<HTMLElement>("input,textarea,select").forEach(n=>n.dataset["draftOwner"]=boundScope);
  root.oninput = root.onchange = (event) => {
    if (!state) return;
    const target = event.target as HTMLInputElement;
    if(target.dataset["draftOwner"]!==JSON.stringify([pid,key(state.unit)]))return;
    const form = target.closest("form");
    if (form?.id === "annotation") {
      const e = entries().find(e => e.id === entry);
      if (e) draft().notes[noteKey(e)] = { note: (form.querySelector("textarea") as HTMLTextAreaElement).value, intent: (form.querySelector("select") as HTMLSelectElement).value };
    } else if (form?.id === "execution-grant") {
      draft().execution[target.name] = target.value;
    } else if (form?.id === "prepare" && ["intent","count","direction","brand","operation"].includes(target.name)) {
      const name = target.name as "intent" | "count" | "direction" | "brand" | "operation";
      draft()[name] = target.value;
    }
    const k = target.dataset["request"] ?? target.dataset["number"];
    if (k) {
      setRequest(k, target.value);
      const slider = root.querySelector<HTMLInputElement>(`input[type=range][data-request="${k}"]`);
      const number = root.querySelector<HTMLInputElement>(`[data-number="${k}"]`);
      if (slider) { slider.value = target.value || "1"; slider.setAttribute("aria-valuetext", target.value || "No request"); slider.closest(".semantic-scale")!.classList.toggle("unset", !target.value); }
      if (number) number.value = target.value;
      const output = root.querySelector(`[data-output="${k}"]`); if (output) output.textContent = target.value || "No request";
    }
    if (form?.id === "prepare" || k) auxiliaryDraftChanged();
  };
  root.querySelectorAll<HTMLDetailsElement>("details[id]").forEach(panel => panel.ontoggle = () => { if (state) draft().open[panel.id] = panel.open; });
  root.querySelectorAll<HTMLButtonElement>("[data-clear]").forEach(b => b.onclick = () => { setRequest(b.dataset["clear"]!, ""); render(); });
  on("request-scope", "change", e => { draft().scope = (e.target as HTMLSelectElement).value; render(); });
  on("discard-draft", "click", () => { if (confirm("Discard all unsaved notes, operation fields and requests on this page? Saved records remain.")) { drafts.discard(pid, key(state!.unit)); pendingRemoval = []; render(); notice.textContent = "This page's session drafts discarded; saved records unchanged"; } });
  on("confirm-remove", "click", () => void removeSources(pendingRemoval));
  on("cancel-remove", "click", () => { pendingRemoval = []; render(); });
  on("retry-open", "click", () => void run(() => errorUnit && units.some(u => key(u) === errorUnit) ? openUnit(errorUnit) : openProject(pid), "Workspace reopened"));
  on("selection-set", "change", (e) => {
    selectionId = (e.target as HTMLSelectElement).value;
    entry = "";
    render();
  });
  on("layout", "change", (e) => {
    layout = (e.target as HTMLSelectElement).value;
    render();
  });
  on("project", "change", (e) => {
    const value = (e.target as HTMLSelectElement).value;
    if (value) review.navigate(()=>void run(() => openProject(value), "Project reopened", true));
    else review.navigate(()=>{ pid = ""; state = null; project = null; units = []; workspaceError = ""; prepared = null; pendingRemoval = []; render(); notice.textContent = "Choose a project; session drafts retained"; });
  });
  on("page", "change", (e) => {
    const value = (e.target as HTMLSelectElement).value;
    if (value) review.navigate(()=>void run(() => openUnit(value), "Page reopened", true));
    else review.navigate(()=>{ state = null; workspaceError = ""; prepared = null; pendingRemoval = []; render(); notice.textContent = "Choose a page; session drafts retained"; });
  });
  on("new-project", "submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target as HTMLFormElement);
    review.navigate(()=>void run(async () => {
      const p = await post("create", { title: f.get("title") });
      catalog = await get("session");
      await openProject(p.project.id);
    }, "Website project created"));
  });
  on("new-page", "submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target as HTMLFormElement);
    review.navigate(()=>void run(async () => {
      const u = await post("page", {
        expectedProject: project,
        pageType: f.get("type"),
        label:
          f.get("label") ||
          ({ homepage: "Homepage", about: "About Us", custom: "Custom page" }[
            String(f.get("type"))
          ] ??
            "Page"),
      });
      const p = await get("project?project=" + pid);
      units = p.units;
      await openUnit(key(u));
    }, "Page created"));
  });
  on("import", "submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target as HTMLFormElement);
    void run(async () => {
      const file = f.get("file") as File;
      if (!file.size) throw Error("Choose a raster image");
      if (file.size > 8 * 1024 * 1024) throw Error("Image exceeds 8 MiB");
      const encoded = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]!);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const previous = state!.candidates.find(
        (c) => key(c) === f.get("previous"),
      );
      const c = await post("import", {
        expectedProject: project,
        unit: ref(state!.unit),
        file: encoded,
        permission: f.get("permission"),
        previous: previous ? ref(previous) : null,
      });
      focused = key(c);
      await reload();
    }, "Raster imported; prior versions remain available");
  });
  root.querySelectorAll<HTMLButtonElement>("[data-open]").forEach(
    (b) =>
      (b.onclick = () => {
        focusSource(b.dataset["open"]!);
        compared = [];
        render();
      }),
  );
  root.querySelectorAll<HTMLButtonElement>("[data-whole]").forEach(b => b.onclick = () => {
    const c = allCandidates().find(c => key(c) === b.dataset["whole"])!;
    const ids = selected(c).filter(e => e.anchor.kind === "whole").map(e => e.id);
    if (ids.length) requestRemoval(ids); else void run(() => add(c, { kind: "whole" }), review.active?"Review source added · unsaved":"Whole source saved");
  });
  root.querySelectorAll<HTMLButtonElement>("[data-compare]").forEach(
    (b) =>
      (b.onclick = () => {
        const k = b.dataset["compare"]!;
        compared = compared.includes(k)
          ? compared.filter((x) => x !== k)
          : [...compared, k];
        focusSource(k);
        render();
      }),
  );
  root.querySelectorAll<HTMLButtonElement>("[data-entry]").forEach(
    (b) =>
      (b.onclick = () => {
        entry = b.dataset["entry"]!;
        focused = key(entries().find((e) => e.id === entry)!.candidate);
        draft().scope = entry;
        render();
      }),
  );
  on("clear-compare", "click", () => {
    compared = [];
    render();
  });
  on("region-tool", "change", (e) => {
    tool = (e.target as HTMLSelectElement).value as typeof tool;
  });
  on("zoom", "change", (e) => {
    zoom = Number((e.target as HTMLSelectElement).value);
    render();
  });
  on("region-form", "submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target as HTMLFormElement);
    const anchor = {
      kind: String(f.get("shape")) as "rectangle" | "ellipse",
      ...Object.fromEntries(
        ["x", "y", "width", "height"].map((n) => [n, Number(f.get(n)) / 100]),
      ),
    } as Anchor;
    void run(() => add(active()!, anchor), review.active?"Review region added · unsaved":"Region source saved");
  });
  on("annotation", "submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target as HTMLFormElement);
    const current = entries().find((e) => e.id === entry)!;
    const intent = f.get("intent") as SelectionEntry["intent"];
    const text = String(f.get("note")).trim();
    const next = {
      ...current,
      intent,
      preservation:
        intent === "exact"
          ? current.preservation ?? {
              predicate: "retained-bytes" as const,
              target: "asset-" + current.id,
            }
          : null,
      notes: text
        ? [
            {
              id: current.notes[0]?.id ?? "note-" + crypto.randomUUID(),
              text,
              source: "User annotation",
            },
            ...current.notes.slice(1),
          ]
        : current.notes.slice(1),
    };
    void run(
      async () => { await saveEntries(entries().map((e) => (e.id === entry ? next : e))); delete draft().notes[noteKey(current)]; render(); },
      "Source note saved",
    );
  });
  on("remove-entry", "click", () => requestRemoval([entry]));
  const brandSelect = root.querySelector<HTMLSelectElement>(
    "#prepare [name=brand]",
  );
  if (brandSelect)
    brandSelect.onchange = () => {
      brandSelect.closest("details")!.querySelector("summary")!.textContent =
        brandSelect.value === "" ? "Brand · off" : "Brand · on";
    };
  on("prepare", "submit", (e) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const f = new FormData(form);
    const values = (level: 1 | 2) => Object.entries(draft().requests).flatMap(([k, r]) => {
      if (r.entryId !== null && !entries().some(e => noteKey(e) === k)) {
        if (Object.keys(r.values).length) throw Error("A request belongs to another or removed source. Restore its saved set or explicitly discard the page drafts.");
        return [];
      }
      return requestFields.filter(c => c.level === level && !c.unavailable).flatMap(c => {
        const value = r.values[c.key];
        return value ? [{ key: c.key, value: ["scale","count","px"].includes(c.type) ? Number(value) : value, entryId: r.entryId }] : [];
      });
    });
    void run(async () => {
      const requests = values(2), level1 = values(1);
      prepared = await post("prepare", {
        expectedProject: project,
        unit: ref(state!.unit),
        selections: selection() ? ref(selection()!) : null,
        intent: f.get("intent"),
        count: Number(f.get("count")),
        direction: f.get("direction"),
        brand:
          f.get("brand") === ""
            ? null
            : catalog.brands[Number(f.get("brand"))]!.ref,
        operation: f.get("operation"),
        requests,
        level1,
      });
      await reload();
    }, "Prepared pending attempts only. Image execution is unavailable.");
  });
  if(state) {
    bindNative(root,state.nativeExchange,state.records.filter(p=>p.payload.kind==="raster-specification"),{pid,project:project!,token,run:(f,m)=>{const restore=executionFocus();return run(async()=>{await f();await reload();},m).finally(restore);}});
    on("native-refresh","click",()=>void run(()=>reload(true),"Stored manual progress refreshed; no dispatch."));
  }
  on("execution-grant","submit",e=>{
    e.preventDefault(); const d=draft().execution;
    void run(async()=>{
      const retry=state!.executions.find(e=>e.run.id===d["retry"]);
      const spec=state!.records.find(p=>key(p)===d["spec"]) as Work<Specification>|undefined;
      if(!spec)throw Error("Choose a frozen operation");
      const base={expectedProject:project,unit:ref(state!.unit)};
      const q:Work<ExecutionRequest>=retry?retry.request:await post("compile-execution",{...base,spec:ref(spec),width:Number(d["width"]),height:Number(d["height"])});
      if(retry&&(Number(d["width"])!==q.payload.state.width||Number(d["height"])!==q.payload.state.height||key(q.payload.state.spec)!==key(spec)))throw Error("Retry uses the original exact input and dimensions");
      const slots=retry?[Number(d["slot"])]:Array.from({length:spec.payload.state.count},(_,i)=>i+1);
      const lifetime=Number(d["expires"]);if(!Number.isSafeInteger(lifetime)||lifetime<1||lifetime>86400)throw Error("Choose grant lifetime 1–86400 seconds");
      const g:Work<Grant>=await post("grant-execution",{...base,request:ref(q),adapter:state!.executionAvailability.adapter,slots,maxSubmissions:Number(d["submissions"]),maxStatusCalls:Number(d["status"]),maxCancelCalls:Number(d["cancels"]),timeoutMs:Number(d["timeout"]),expiresAt:new Date(Date.now()+lifetime*1000).toISOString(),reason:"Explicit visual workspace offline fixture grant"});
      await post("prepare-execution",{...base,grant:ref(g),retryOf:retry?{execution:ref(retry.run),slot:Number(d["slot"])}:null});
      delete d["retry"];delete d["slot"];await reload();
    },"Offline grant prepared. Execute is a separate deliberate action.");
  });
  on("clear-execution-retry","click",()=>{delete draft().execution["retry"];delete draft().execution["slot"];render();});
  for(const [attribute,action] of [["run","execute"],["cancel","cancel-execution"],["revoke","revoke-execution"],["reconcile","reconcile-execution"],["delivery","retry-delivery"]])root.querySelectorAll<HTMLButtonElement>(`[data-execution-${attribute}]`).forEach(b=>{
    const e=state!.executions.find(e=>key(e.run)===b.getAttribute(`data-execution-${attribute}`))!, owner=project!;
    b.onclick=()=>void executionAction(e,owner,attribute!,action!,Number(b.dataset["slot"]),Number(b.dataset["sequence"]));
  });
  root.querySelectorAll<HTMLButtonElement>("[data-execution-refresh]").forEach(b=>b.onclick=()=>void run(()=>reload(true),"Stored progress refreshed; no provider poll",true));
  root.querySelectorAll<HTMLButtonElement>("[data-execution-retry]").forEach(b=>b.onclick=()=>{
    const e=state!.executions.find(e=>key(e.run)===b.dataset["executionRetry"])!,d=draft().execution;
    d["retry"]=e.run.id;d["slot"]=b.dataset["slot"]!;d["spec"]=key(e.request.payload.state.spec);d["width"]=String(e.request.payload.state.width);d["height"]=String(e.request.payload.state.height);
    for(const name of ["submissions","status","cancels","timeout","expires"])delete d[name];draft().open["execution-panel"]=true;render();
    root.querySelector("#execution-grant")?.scrollIntoView({block:"center"});notice.textContent="Retry prepared locally; new explicit grant required. Nothing dispatched.";
  });
  root.querySelectorAll<HTMLButtonElement>("[data-cancel]").forEach(
    (b) =>
      (b.onclick = () =>
        void run(async () => {
          const batch = state!.records.find(
            (p) => key(p) === b.dataset["cancel"],
          )!;
          await post("cancel", {
            expectedProject: project,
            unit: ref(state!.unit),
            batch: ref(batch),
          });
          await reload();
        }, "Pending slots cancelled; no remote execution was invoked")),
  );
  root.querySelectorAll<HTMLButtonElement>("[data-retry]").forEach(
    (b) =>
      (b.onclick = () =>
        void run(async () => {
          const batch = state!.records.find(
            (p) => key(p) === b.dataset["retry"],
          )!;
          await post("retry", {
            expectedProject: project,
            unit: ref(state!.unit),
            batch: ref(batch),
            slot: Number(b.dataset["slot"]),
          });
          await reload();
        }, "Manual retry prepared; execution remains unavailable")),
  );
  root.querySelectorAll<HTMLElement>(".image-plane").forEach((plane) => {
    const candidate = allCandidates().find(
      (c) => key(c) === plane.parentElement!.dataset["canvas"],
    )!;
    const image = candidate.payload.state.image;
    plane.style.aspectRatio = image.width + "/" + image.height;
    const size = () => {
      const canvas = plane.parentElement!;
      plane.style.width =
        Math.min(
          (canvas.clientWidth - 24) / image.width,
          (canvas.clientHeight - 24) / image.height,
        ) *
          image.width *
          zoom +
        "px";
    };
    const observer = new ResizeObserver(size);
    observer.observe(plane.parentElement!);
    observers.push(observer);
    size();
    let start: { x: number; y: number } | null = null;
    const img = plane.querySelector<HTMLImageElement>("img")!;
    plane.onpointerdown = (e) => {
      if (busy || e.button !== 0 || !img.complete || !img.naturalWidth) return;
      const r = img.getBoundingClientRect();
      start = normalizedPoint(e.clientX, e.clientY, {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
      });
      if (start) {
        plane.setPointerCapture(e.pointerId);
        plane.classList.add("drawing");
      }
    };
    plane.onpointercancel = () => {
      start = null;
      plane.classList.remove("drawing");
    };
    plane.onpointerup = (e) => {
      if (!start) return;
      const r = img.getBoundingClientRect();
      const end = normalizedPoint(e.clientX, e.clientY, {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
      });
      const a = start;
      start = null;
      plane.classList.remove("drawing");
      if (!end) return;
      const box = regionBetween(a, end);
      if (box.width < 0.005 || box.height < 0.005) return;
      const k = plane.parentElement!.dataset["canvas"]!;
      void run(
        () =>
          add(allCandidates().find((c) => key(c) === k)!, {
            kind: tool,
            ...box,
          }),
        review.active?"Review region added · unsaved":"Region source saved",
      );
    };
  });
}
void run(async () => {
  const s = await get("session");
  token = s.token;
  catalog = s;
  render();
  const requested=new URL(location.href).searchParams,projectId=requested.get("project"),page=requested.get("page");
  if(projectId&&catalog.projects.some(p=>p.ref.id===projectId)){
    await openProject(projectId);
    // A historical review URL opens the current owned page, then its exactly pinned review target.
    const requestedUnit=units.find(u=>key(u)===page)??units.find(u=>u.id===page?.slice(0,page.lastIndexOf(':')));
    if(requestedUnit&&(!state||key(state.unit)!==key(requestedUnit)))await openUnit(key(requestedUnit));
  }
}, "Choose a project or create a Website project");
