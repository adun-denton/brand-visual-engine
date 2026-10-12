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
    headers: { "Content-Type": "application/json", "X-BVE-Token": token },
    body: JSON.stringify(
      action === "create" ? input : { projectId, input },
    ),
  });
  const v = await r.json();
  if (!r.ok) throw Error(v.error);
  return v;
}
let selectionId = "";
const selectionSets = () =>
  state?.records.filter((p) => p.payload.kind === "raster-selections") as
    | Work<Selections>[]
    | undefined;
const selection = () => selectionSets()?.find((p) => p.id === selectionId);
const entries = () => selection()?.payload.state.entries ?? [];
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
  if(!selector)for(const a of ["data-execution-cancel","data-execution-revoke","data-execution-run","data-execution-reconcile","data-execution-delivery"]){const value=n.getAttribute(a);if(value){selector=`[${a}^="${CSS.escape(value.split(":")[0]+":")}"]`;break;}}
  const start="selectionStart" in n?n.selectionStart:null,end="selectionEnd" in n?n.selectionEnd:null;
  return ()=>{const target=selector?root.querySelector<HTMLInputElement|HTMLTextAreaElement>(selector):null;target?.focus({preventScroll:true});if(target&&start!==null&&end!==null&&"setSelectionRange" in target)try{target.setSelectionRange(start,end);}catch{}};
}
async function reload(keepExecutionFocus=false) {
  if (!state) return;
  const ticket = ++epoch;
  errorUnit = key(state.unit);
  let next: State;
  try { next = (await get("state?" + query(ref(state.unit)))) as State; }
  catch (e) { state = null; workspaceError = e instanceof Error ? e.message : "Stored source unavailable"; render(); throw e; }
  if (ticket !== epoch) return;
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
  executionCommands.set(operationKey,{projectId,unit:key(unit),executionId:e.run.id,action});render();
  const ownsView=()=>pid===projectId && state && key(state.unit)===key(unit);
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
const originLabel = (c: Work<RasterConcept>) =>
  c.payload.state.origin === "synthetic"
    ? "Synthetic interaction fixture"
    : c.payload.state.origin === "imported"
      ? "Imported raster"
      : "Raster reference";
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
  return `<details id="level1-panel" class="context-controls" ${draft().open["level1-panel"] ? "open" : ""}><summary>Direct requests · Level 1 · ${draft().scope === "" ? "This page" : "Selected source"}</summary>${scopeView()}<p class="hint">Six optional requests for the visible scope. Current properties are unmeasured; requests change the next input, not these pixels.</p><div class="controls">${controls(1)}</div></details>`;
}
function prepareView() {
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
function render() {
  const focusId = (document.activeElement as HTMLElement)?.id;
  root.innerHTML = `<header><a class="wordmark" href="/visual">BVE <span>VISUAL STUDIO</span></a><span class="review-tag">Interaction review · no image execution</span><a href="/">Semantic & legacy workspace</a></header><main id="workspace"><div class="workspace-title"><div><p class="eyebrow">WEBSITE EXPLORATION</p><h1>${esc(state?.title ?? (pid ? "Start a page" : "Start with a page."))}</h1></div><label>Review layout<select id="layout"><option value="sheet" ${layout === "sheet" ? "selected" : ""}>A · Contact sheet + Focus</option><option value="film" ${layout === "film" ? "selected" : ""}>B · Focus + Filmstrip</option></select></label></div><div class="entry-bar"><label>Project<select id="project"><option value="">Choose project</option>${catalog.projects.map((p) => `<option value="${p.ref.id}" ${pid === p.ref.id ? "selected" : ""}>${esc(p.title)}</option>`).join("")}</select></label><details class="entry-extra" ${pid ? "" : "open"}><summary>New project</summary><form id="new-project"><input name="title" required aria-label="New Website project name" placeholder="New Website project"><button>Create project</button></form></details>${pid ? `<label>Page<select id="page"><option value="">Choose page</option>${units.map((u) => `<option value="${key(u)}" ${state && key(state.unit) === key(u) ? "selected" : ""}>${esc(u.payload.state.label)}</option>`).join("")}</select></label><details class="entry-extra" id="page-tools" ${state ? "" : "open"}><summary>Add page</summary><form id="new-page"><select name="type" aria-label="Page type"><option value="homepage">Homepage</option><option value="about">About Us</option><option value="custom">Custom page</option></select><input name="label" aria-label="Page label" placeholder="Page label (optional)"><button>Add page</button></form></details>` : ""}</div>${
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
        }<details class="entry-extra" id="import-tools" ${state.candidates.length ? "" : "open"}><summary>Import raster</summary><form id="import"><label class="import-pick">Import PNG / JPEG / WebP<input name="file" type="file" accept="image/png,image/jpeg,image/webp" required></label><input name="permission" aria-label="Image use permission" placeholder="Permission / source" required><label>Import as<select name="previous"><option value="">New concept</option>${state.candidates.map((c, i) => `<option value="${key(c)}">Replace Concept ${i + 1} · v${c.version}</option>`).join("")}</select></label><button>Import raster</button></form></details><div class="deferred"><button disabled title="Library contract is deferred">Add to Library</button><button disabled title="Raster export contract is deferred">Export As</button><button disabled title="HTML reconstruction is a later process">Build as HTML</button></div></div><p class="hint">Library, raster export and HTML reconstruction are separate deferred operations.</p><div class="studio ${layout}"><div class="visual-area">${(state.candidates.length || state.selectedSources.length) ? (layout === "sheet" ? `<section class="contact-sheet" aria-label="Candidate contact sheet">${groups()}</section>${focusView()}` : `${focusView()}<section class="filmstrip" aria-label="Candidate filmstrip">${state.candidates.map((c, i) => card(c, i, true)).join("")}</section>`) : `<div class="empty-canvas"><h2>Your next direction starts here.</h2><p>Import raster concepts to compare, select and annotate.</p><p>No image generator is connected in this review slice.</p>${contextControls()}</div>`}</div>${selectionView()}</div>${prepareView()}${executionView()}${historyView()}`
      : workspaceError ? `<section class="workspace-error" role="alert"><h2>Workspace unavailable</h2><p>${esc(workspaceError)}</p><p>Stored sources could not be validated. No records or drafts were changed.</p><button id="retry-open">Retry reopen</button></section>` : '<section class="welcome"> <h2>A visual place to explore.</h2><p>Create a Website project and choose Homepage, About Us or a custom page. Brand setup and chat are optional.</p></section>'
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
  const imports = state!.candidates.filter((c) => !assigned.has(key(c)));
  return (
    html +
    (imports.length
      ? `<div class="batch-group"><h2>Imported & reference concepts</h2><div class="card-grid">${imports.map((c) => card(c, state!.candidates.indexOf(c))).join("")}</div></div>`
      : "")
  );
}
function bind() {
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
    if (value) void run(() => openProject(value), "Project reopened", true);
    else { pid = ""; state = null; project = null; units = []; workspaceError = ""; prepared = null; pendingRemoval = []; render(); notice.textContent = "Choose a project; session drafts retained"; }
  });
  on("page", "change", (e) => {
    const value = (e.target as HTMLSelectElement).value;
    if (value) void run(() => openUnit(value), "Page reopened", true);
    else { state = null; workspaceError = ""; prepared = null; pendingRemoval = []; render(); notice.textContent = "Choose a page; session drafts retained"; }
  });
  on("new-project", "submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target as HTMLFormElement);
    void run(async () => {
      const p = await post("create", { title: f.get("title") });
      catalog = await get("session");
      await openProject(p.project.id);
    }, "Website project created");
  });
  on("new-page", "submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target as HTMLFormElement);
    void run(async () => {
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
    }, "Page created");
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
    if (ids.length) requestRemoval(ids); else void run(() => add(c, { kind: "whole" }), "Whole source saved");
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
    void run(() => add(active()!, anchor), "Region source saved");
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
        "Region source saved",
      );
    };
  });
}
void run(async () => {
  const s = await get("session");
  token = s.token;
  catalog = s;
  render();
}, "Choose a project or create a Website project");
