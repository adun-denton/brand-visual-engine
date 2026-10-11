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
import { requestControls } from "../modules/website/visual-controls.ts";
import { normalizedPoint, regionBetween } from "./visual-geometry.ts";
type Work<T> = NodePacket<DesignArtifact<T>>;
type State = {
  project: VersionRef;
  title: string;
  units: Work<WorkUnit>[];
  unit: Work<WorkUnit>;
  records: Work<unknown>[];
  candidates: Work<RasterConcept>[];
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
async function post(action: string, input: unknown) {
  const r = await fetch("/api/v1/visual/" + action, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-BVE-Token": token },
    body: JSON.stringify(
      action === "create" ? input : { projectId: pid, input },
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
const active = () => state?.candidates.find((c) => key(c) === focused);
const selected = (c: Work<RasterConcept>) =>
  entries().filter((e) => key(e.candidate) === key(c));
async function reload() {
  if (!state) return;
  const ticket = ++epoch;
  const next = (await get("state?" + query(ref(state.unit)))) as State;
  if (ticket !== epoch) return;
  state = next;
  if (!selectionId && selectionSets()?.length === 1)
    selectionId = selectionSets()![0]!.id;
  project = next.project;
  units = next.units;
  if (!state.candidates.some((c) => key(c) === focused))
    focused = state.candidates[0] ? key(state.candidates[0]) : "";
  render();
}
async function run(action: () => Promise<void>, message: string) {
  if (busy) return;
  busy = true;
  const returnFocus = (document.activeElement as HTMLElement)?.id;
  root.inert = true;
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
async function openProject(id: string) {
  ++epoch;
  pid = id;
  state = null;
  prepared = null;
  compared = [];
  focused = "";
  entry = "";
  const p = await get("project?project=" + encodeURIComponent(pid));
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
  state = await get("state?" + query(ref(u)));
  focused = state!.candidates[0] ? key(state!.candidates[0]) : "";
  selectionId = selectionSets()?.length === 1 ? selectionSets()![0]!.id : "";
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
  entry = "selection-" + crypto.randomUUID();
  const e: SelectionEntry = {
    id: entry,
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
      ? state!.candidates.filter((c) => compared.includes(key(c)))
      : [c];
  return `<section class="focus-view"><div class="focus-toolbar"><span>Concept ${state!.candidates.indexOf(c) + 1} · v${c.version}</span><label>Region <select id="region-tool"><option value="rectangle" ${tool === "rectangle" ? "selected" : ""}>Rectangle</option><option value="ellipse" ${tool === "ellipse" ? "selected" : ""}>Ellipse</option></select></label><label>Zoom <select id="zoom">${[1, 1.5, 2].map((z) => `<option value="${z}" ${zoom === z ? "selected" : ""}>${z * 100}%</option>`).join("")}</select></label><button id="clear-compare">Single focus</button></div><div class="comparison ${comparisons.length > 1 ? "multiple" : ""}">${comparisons.map(canvas).join("")}</div><p class="hint">Drag on an image to select a region, or enter a region below. Requests do not change these pixels.</p><details class="region-access"><summary>Add region without dragging</summary><form id="region-form"><label>Shape <select name="shape"><option value="rectangle">Rectangle</option><option value="ellipse">Ellipse</option></select></label>${["x", "y", "width", "height"].map((n) => `<label>${n} (%)<input name="${n}" type="number" min="0" max="100" step="0.1" required></label>`).join("")}<button>Add region to focused concept</button></form></details></section>`;
}
function selectionView() {
  return `<aside class="selections"><div class="section-head"><h2>Selected sources <span>${entries().length}</span></h2></div>${
    entries().length
      ? entries()
          .map(
            (e, i) =>
              `<button class="selection-item ${entry === e.id ? "active" : ""}" data-entry="${esc(e.id)}"><img src="${imageURL(state!.candidates.find((c) => key(c) === key(e.candidate))!)}" alt=""><span>Source ${i + 1} · ${e.anchor.kind}<small>Concept ${state!.candidates.findIndex((c) => key(c) === key(e.candidate)) + 1} · v${e.candidate.version} · ${e.intent}</small><small>${esc(e.notes[0]?.text ?? "Add a note")}</small></span></button>`,
          )
          .join("")
      : '<p class="empty">Select whole concepts or regions to guide your next variation.</p>'
  }${entryView()}</aside>`;
}
function entryView() {
  const e = entries().find((e) => e.id === entry);
  if (!e) return "";
  return `<form id="annotation"><h3>Source ${entries().indexOf(e) + 1}</h3><label>Use as <select name="intent"><option value="inspiration" ${e.intent === "inspiration" ? "selected" : ""}>Inspiration</option><option value="include" ${e.intent === "include" ? "selected" : ""}>Include</option><option value="exact" ${e.intent === "exact" ? "selected" : ""} ${e.anchor.kind !== "whole" ? "disabled" : ""}>Exact retained bytes · whole only</option></select></label><p class="hint">${e.anchor.kind === "whole" ? "Exact requests retention of these original bytes as a named asset. It does not promise an identical rendered region." : "Exact region preservation needs a binary mask; rectangle/ellipse Exact is unavailable in this slice."}</p>${e.notes
    .slice(1)
    .map((n) => `<p class="hint">Additional saved note: ${esc(n.text)}</p>`)
    .join(
      "",
    )}<label>Note<textarea name="note" rows="3" placeholder="What should carry forward or change?">${esc(e.notes[0]?.text ?? "")}</textarea></label><button>Save source note</button><button type="button" id="remove-entry">Remove selection</button><details><summary>Original coordinates</summary><pre>${esc(JSON.stringify(e.anchor, null, 2))}</pre></details></form>`;
}
function controls(level: 1 | 2) {
  return requestControls
    .filter((c) => c.level === level)
    .map(
      (c) =>
        `<label class="request-control ${c.unavailable ? "unavailable" : ""}">${esc(c.label)}${c.type === "category" ? `<select data-request="${c.key}"><option value="">No request</option>${c.options!.map((o) => `<option>${o}</option>`).join("")}</select>` : `<input data-request="${c.key}" ${c.unavailable ? "disabled" : ""} type="${["scale", "count", "px"].includes(c.type) ? "number" : "text"}" placeholder="${c.unavailable ? "Unavailable for static raster" : c.type === "scale" ? "1.0–10.0" : c.type === "px" ? "Requested px" : c.type === "color" ? "#RRGGBB" : "No request"}" ${["scale", "count", "px"].includes(c.type) ? `min="${c.key === "corner-rounding" ? 0 : 1}" max="${c.type === "scale" ? 10 : c.type === "count" ? 100 : 8192}" step="${c.type === "scale" ? "0.1" : "1"}"` : ""}>`}${c.unavailable ? `<small>${c.unavailable}</small>` : ""}</label>`,
    )
    .join("");
}
function prepareView() {
  return `<section class="prepare"><div class="section-head"><h2>Next variation</h2><span>Preparation only</span></div><form id="prepare"><label class="intent">Intent<textarea name="intent" rows="2" required placeholder="Describe the next visual direction…"></textarea></label><div class="prepare-core"><label>Operation<select name="operation"><option value="refine">Refine selected sources</option><option value="refresh">Refresh alternatives</option><option value="create">Create direction</option><option value="branch">Branch</option></select></label><label>Attempts<select name="count" required><option value="">Choose 1–6</option>${[1, 2, 3, 4, 5, 6].map((n) => `<option>${n}</option>`).join("")}</select></label><label>Direction<select name="direction" required><option value="">Choose Direction</option><option value="fresh">Fresh</option><option value="follow">Follow selected direction</option></select></label></div><div class="optional"><details><summary>Direct requests · Level 1</summary><p class="hint">Intent for the next attempt. Current font, spacing and colors are not measured.</p><label>Request scope<select id="request-scope"><option value="">This page</option>${entries()
    .map((e, i) => `<option value="${e.id}">Source ${i + 1}</option>`)
    .join(
      "",
    )}</select></label><div class="controls">${controls(1)}</div></details><details><summary>Tune · Level 2</summary><p class="hint">Requested characteristics, not design quality or observations. Scales 1.0–10.0; no conversion from legacy 0–100.</p><div class="controls">${controls(2)}</div></details><details><summary>Brand · off</summary><label>Optional approved Brand<select name="brand"><option value="">Off · unbranded</option>${catalog.brands.map((b, i) => `<option value="${i}">${esc(b.label)}</option>`).join("")}</select></label><p class="hint">Brand and Direction are independent. Fresh still retains explicit Include/Exact requests.</p></details></div><p class="execution-note">Image execution is unavailable in this review slice. Preparation saves inputs and pending slots only.</p><button class="primary">Prepare next attempt</button></form>${prepared ? `<div class="prepared" role="status"><strong>${prepared.batch.payload.state.attempts.length} pending attempts prepared</strong><p>${esc(prepared.specification.payload.state.rawIntent)} · ${prepared.specification.payload.state.direction} · Brand ${prepared.specification.payload.state.brand.enabled ? "on" : "off"}</p><details><summary>Inspect exact frozen input</summary><pre>${esc(JSON.stringify(prepared.specification.payload.state, null, 2))}</pre></details></div>` : ""}</section>`;
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
        }<details class="entry-extra" id="import-tools" ${state.candidates.length ? "" : "open"}><summary>Import raster</summary><form id="import"><label class="import-pick">Import PNG / JPEG / WebP<input name="file" type="file" accept="image/png,image/jpeg,image/webp" required></label><input name="permission" aria-label="Image use permission" placeholder="Permission / source" required><label>Import as<select name="previous"><option value="">New concept</option>${state.candidates.map((c, i) => `<option value="${key(c)}">Replace Concept ${i + 1} · v${c.version}</option>`).join("")}</select></label><button>Import raster</button></form></details><div class="deferred"><button disabled title="Library contract is deferred">Add to Library</button><button disabled title="Raster export contract is deferred">Export As</button><button disabled title="HTML reconstruction is a later process">Build as HTML</button></div></div><p class="hint">Library, raster export and HTML reconstruction are separate deferred operations.</p><div class="studio ${layout}"><div class="visual-area">${state.candidates.length ? (layout === "sheet" ? `<section class="contact-sheet" aria-label="Candidate contact sheet">${groups()}</section>${focusView()}` : `${focusView()}<section class="filmstrip" aria-label="Candidate filmstrip">${state.candidates.map((c, i) => card(c, i, true)).join("")}</section>`) : '<div class="empty-canvas"><h2>Your next direction starts here.</h2><p>Import raster concepts to compare, select and annotate.</p><p>No image generator is connected in this review slice.</p></div>'}</div>${selectionView()}</div>${prepareView()}${historyView()}`
      : '<section class="welcome"><h2>A visual place to explore.</h2><p>Create a Website project and choose Homepage, About Us or a custom page. Brand setup and chat are optional.</p></section>'
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
    if (value) void run(() => openProject(value), "Project reopened");
  });
  on("page", "change", (e) => {
    const value = (e.target as HTMLSelectElement).value;
    if (value) void run(() => openUnit(value), "Page reopened");
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
        focused = b.dataset["open"]!;
        compared = [];
        render();
      }),
  );
  root.querySelectorAll<HTMLButtonElement>("[data-whole]").forEach(
    (b) =>
      (b.onclick = () =>
        void run(async () => {
          const c = state!.candidates.find(
            (c) => key(c) === b.dataset["whole"],
          )!;
          if (selected(c).some((e) => e.anchor.kind === "whole"))
            await saveEntries(
              entries().filter(
                (e) => key(e.candidate) !== key(c) || e.anchor.kind !== "whole",
              ),
            );
          else await add(c, { kind: "whole" });
        }, "Whole source saved")),
  );
  root.querySelectorAll<HTMLButtonElement>("[data-compare]").forEach(
    (b) =>
      (b.onclick = () => {
        const k = b.dataset["compare"]!;
        compared = compared.includes(k)
          ? compared.filter((x) => x !== k)
          : [...compared, k];
        focused = k;
        render();
      }),
  );
  root.querySelectorAll<HTMLButtonElement>("[data-entry]").forEach(
    (b) =>
      (b.onclick = () => {
        entry = b.dataset["entry"]!;
        focused = key(entries().find((e) => e.id === entry)!.candidate);
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
          ? {
              predicate: "retained-bytes" as const,
              target: current.preservation?.target ?? "asset-" + current.id,
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
      () => saveEntries(entries().map((e) => (e.id === entry ? next : e))),
      "Source note saved",
    );
  });
  on(
    "remove-entry",
    "click",
    () =>
      void run(async () => {
        await saveEntries(entries().filter((e) => e.id !== entry));
        entry = "";
        render();
      }, "Selection removed"),
  );
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
    const scope =
      (form.querySelector("#request-scope") as HTMLSelectElement).value || null;
    const values = (level: 1 | 2) =>
      requestControls
        .filter((c) => c.level === level && !c.unavailable)
        .flatMap((c) => {
          const v = (
            form.querySelector(`[data-request="${c.key}"]`) as HTMLInputElement
          ).value.trim();
          return v
            ? [
                {
                  key: c.key,
                  value: ["scale", "count", "px"].includes(c.type)
                    ? Number(v)
                    : v,
                  entryId: scope,
                },
              ]
            : [];
        });
    void run(async () => {
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
        requests: values(2),
        level1: values(1),
      });
      await reload();
    }, "Prepared pending attempts only. Image execution is unavailable.");
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
    const candidate = state!.candidates.find(
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
          add(state!.candidates.find((c) => key(c) === k)!, {
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
