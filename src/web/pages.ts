import type { Pages } from "../service/pages.ts";
import type {
  ModuleProject,
  NodePacket,
  VersionRef,
  DesignArtifact,
} from "../kernel/contracts.ts";
import type { Element } from "../modules/website/page.ts";
type Studio = ReturnType<Pages["state"]>;
type Context = {
  project: NodePacket<ModuleProject>;
  studio: Studio;
  legacy: NodePacket<DesignArtifact<unknown>>[];
  onForm: (s: string, f: (form: HTMLFormElement) => Promise<void>) => void;
  mutate: (path: string, input: unknown, message: string) => Promise<void>;
  render: () => void;
};
const e = (x: unknown) =>
  String(x ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const ptr = (p: { id: string; version: number }): VersionRef => ({
  id: p.id,
  version: p.version,
  freshness: "pinned",
});
const enc = (p: { id: string; version: number }) => e(JSON.stringify(ptr(p)));
const walk = (n: Element): Element[] => [
  n,
  ...(n.children ?? []).flatMap(walk),
];
let active = "";
let comparison: VersionRef | null = null;
let width = "desktop";
const url = (path: string, pid: string, r: VersionRef) =>
  "/api/v1/" +
  path +
  "?project=" +
  encodeURIComponent(pid) +
  "&id=" +
  encodeURIComponent(r.id) +
  "&version=" +
  r.version;
export function studioView(c: Context) {
  const { studio: s, project } = c;
  const p = s.pages.find((p) => p.id === active) ?? s.pages.at(-1);
  if (p) active = p.id;
  const pending = s.requests.filter(
    (q) => q.payload.state.status === "awaiting",
  );
  const page = p?.payload.state;
  const signature = p ? s.signatures[p.id] : "";
  const accepted = p ? s.accepted[p.id] : null;
  const options = s.pages
    .map(
      (x) =>
        `<option value="${enc(x)}" ${x.id === p?.id ? "selected" : ""}>${e(x.payload.state.page.title)} · v${x.version}</option>`,
    )
    .join("");
  const tree = page ? walk(page.page.root) : [];
  return `<section class="studio-banner"><div><p class="eyebrow">INFERENCE WORKSPACE</p><h2>Design, inspect, decide.</h2><p>Give the AI a scoped instruction. Review the returned proposals beside the page.</p></div><span class="badge">Session handoff · paid API disabled</span></section>
 <div class="studio-pair"><section class="panel studio-preview"><div class="studio-controls"><label>Active page<select id="studio-active">${options || "<option>No page yet</option>"}</select></label><label>Preview width<select id="studio-width"><option value="desktop" ${width === "desktop" ? "selected" : ""}>Desktop</option><option value="narrow" ${width === "narrow" ? "selected" : ""}>390 px</option></select></label></div>${
   p
     ? `<p class="hint">${e(p.id)} · v${p.version} · ${accepted ? `accepted v${accepted.version}` : "proposal"} · ${page!.page.responsive.length} responsive rules</p><div class="studio-frame ${width === "narrow" ? "narrow" : "desktop"}"><iframe title="Active page preview" sandbox="allow-same-origin" src="${url("page/preview", project.id, ptr(p))}"></iframe></div><a href="${url("page/preview", project.id, ptr(p))}" target="_blank" rel="noopener">Open full preview</a><p>${e(page!.rationale)}</p><details><summary>Exact state and local elements</summary><pre class="json-result">${e(JSON.stringify(page, null, 2))}</pre></details><ul>${[
         ...page!.page.unresolved,
         ...Object.entries(page!.page.media)
           .filter(([, b]) => !b)
           .map(([slot]) => "Unresolved media: " + slot),
       ]
         .map((x) => "<li>" + e(x) + "</li>")
         .join("")}</ul>
 <form id="studio-accept"><label class="check"><input name="reviewed" type="checkbox" required> I reviewed this exact preview and its unresolved findings.</label><label>Acceptance reason<input name="reason" required value="Reviewed the exact page and unresolved findings"></label><input type="hidden" name="signature" value="${e(signature)}"><button type="submit">Accept page v${p.version}</button></form>${accepted ? `<a href="${url("page/export", project.id, accepted)}">Download accepted page v${accepted.version}</a>` : ""}
 <form id="studio-history"><label>Compare with earlier version<select name="version">${Array.from({ length: p.version }, (_, i) => `<option value="${i + 1}">Version ${i + 1}</option>`).join("")}</select></label><button>Compare exact versions</button></form>${comparison?.id === p.id ? `<iframe class="studio-comparison" title="Earlier page preview" sandbox="allow-same-origin" src="${url("page/preview", project.id, comparison)}"></iframe>` : ""}`
     : '<div class="empty"><h3>Your page starts with an instruction</h3><p>Ask for alternatives, a single page, or a focused experiment. Internal sections and media slots are chosen by the design.</p></div>'
 }</section>
 <section class="panel studio-instructions"><h3>Instruction and AI exchange</h3><form id="studio-prepare"><label>Operation<select name="operation"><option value="create">New alternatives</option>${p ? '<option value="revise">Revise active page</option><option value="critique">Critique active page</option>' : ""}</select></label><label>Instruction<textarea name="instruction" required rows="5" placeholder="Explore three distinct directions. Explain the choices and unresolved needs."></textarea></label>${
   p
     ? `<label>Focus on a local element<select name="target"><option value="">Whole page</option>${tree.map((n) => `<option value="${e(n.id)}">${e(n.kind + " · " + n.id)}</option>`).join("")}</select></label><label>Preserve exactly<select name="lock"><option value="">Inherited locks only</option>${tree
         .filter((n) => n.text)
         .map((n) => `<option value="${e(n.id)}">Text · ${e(n.id)}</option>`)
         .join("")}</select></label>`
     : ""
 }<fieldset><legend>Include media deliberately</legend>${s.media.map((m) => `<label class="check"><input type="checkbox" name="resource" value="${enc(m)}"> ${e(m.payload.state.label)} · ${m.payload.state.role}</label>`).join("") || '<p class="hint">No media selected. A text-only exploration can proceed.</p>'}</fieldset><button class="primary">Prepare scoped AI request</button></form>
 ${pending.map((q) => `<article class="studio-request"><strong>${e(q.payload.state.operation)} · awaiting result</strong><p>${e(q.payload.state.instruction)}</p><a href="${url("page/request", project.id, ptr(q))}">Download request JSON</a> · <a href="${url("page/package", project.id, ptr(q))}">Request with selected files</a><form class="studio-cancel"><input name="request" type="hidden" value="${enc(q)}"><button>Cancel request</button></form></article>`).join("")}
 <form id="studio-apply"><label>Original request<select name="request">${s.requests.flatMap((q) => Array.from({ length: q.version }, (_, i) => `<option value="${e(JSON.stringify({ ...ptr(q), version: i + 1 }))}">${e(q.payload.state.operation)} · ${q.id.slice(-8)} · v${i + 1}</option>`)).join("")}</select></label><label>Returned result JSON<textarea name="response" rows="7" required></textarea></label><label>AI source<input name="source" required placeholder="ChatGPT session, local executor, or other AI source"></label><label>Observed model <small>Blank if unknown</small><input name="model"></label><details><summary>Attach a returned image</summary><label>Returned image<input type="file" name="returnedFile" accept="image/png,image/jpeg,image/webp"></label><label>Upload handle<input name="uploadHandle" value="upload-result"></label><label>Returned file label<input name="uploadLabel"></label><label>Permission<input name="uploadPermission"></label></details><label class="check"><input name="authorship" type="checkbox" required> This result was authored by AI. Importing creates proposals.</label><button>Validate and import AI result</button></form>
 ${s.results
   .slice(-5)
   .reverse()
   .map(
     (r) =>
       `<details><summary>${e(r.payload.state.outcome)} · ${e(r.payload.state.source)} · ${r.payload.state.proposals.length} proposals</summary><p>Model: ${e(r.payload.state.executor.model ?? "unknown")} · usage unknown</p><ul>${r.payload.state.findings.map((f) => "<li>" + e(f) + "</li>").join("")}</ul></details>`,
   )
   .join("")}</section></div>
 <div class="studio-tools"><section class="panel"><h3>Reusable media</h3><p class="hint">Original image bytes are independent resources. Declaring permission is your responsibility.</p><form id="studio-media"><label>Original file<input type="file" name="file" accept="image/png,image/jpeg,image/webp"></label><label>Or copy an exact original from the retained tools<select name="origin"><option value="">Upload above</option>${c.legacy
   .filter((x) =>
     [
       "website-image",
       "website-api-image",
       "website-region-image",
       "website-reference",
     ].includes(x.payload.kind),
   )
   .map(
     (x) =>
       `<option value="${enc(x)}">${e(x.payload.kind)} · ${x.id.slice(-8)} · v${x.version}</option>`,
   )
   .join(
     "",
   )}</select></label><label>Label<input name="label" required></label><label>Role<select name="role"><option value="placeable">Placeable</option><option value="reference">Reference only</option></select></label><label>Permission or license<input name="permission" required></label><button>Save media resource</button></form>${
   p && Object.keys(page!.page.media).length
     ? `<form id="studio-place"><label>Page media slot<select name="slot">${Object.keys(
         page!.page.media,
       )
         .map((x) => `<option>${e(x)}</option>`)
         .join(
           "",
         )}</select></label><label>Exact media<select name="media">${s.media
         .filter((m) => m.payload.state.role === "placeable")
         .map(
           (m) =>
             `<option value="${enc(m)}">${e(m.payload.state.label)} · v${m.version}</option>`,
         )
         .join(
           "",
         )}</select></label><button>Place exact media in a new revision</button></form>`
     : ""
 }</section>
 <section class="panel"><h3>Independent Website assembly</h3><p class="hint">Use exact accepted pages. New page acceptance never updates an existing Website.</p><form id="studio-website"><label>Title<input name="title" required value="${e(project.payload.localContext["title"]?.override)}"></label><label>Route records JSON <small>[{route,label,artifact:{id,version,freshness}}]</small><textarea name="pages" required rows="5">${e(
   JSON.stringify(
     s.pages
       .filter((x) => s.accepted[x.id])
       .map((x, i) => ({
         route: i === 0 ? "/" : "/page-" + i + "/",
         label: x.payload.state.page.title,
         artifact: s.accepted[x.id],
       })),
     null,
     2,
   ),
 )}</textarea></label><button>Create Website proposal</button></form>${s.websites.map((w) => `<article><p>${e(w.payload.state.title)} · v${w.version} · ${w.payload.state.pages.map((x) => e(x.route + " → " + x.artifact.id.slice(-8) + " v" + x.artifact.version)).join(", ")}</p><form class="studio-website-accept"><input name="assembly" type="hidden" value="${enc(w)}"><input name="hash" type="hidden" value="${e(s.signatures[w.id])}"><label class="check"><input type="checkbox" required> I reviewed these exact routes and page versions.</label><button>Accept Website v${w.version}</button></form></article>`).join("")}${s.acceptedWebsite ? `<a href="${url("website/export", project.id, s.acceptedWebsite)}">Download accepted Website</a>` : ""}</section></div>
 <details class="panel"><summary>Portable page import and legacy conversion</summary><p class="hint">Import reconstructs a proposal. Source approval remains evidence. Legacy conversion carries a loss report for layout, chrome and responsive differences.</p><form id="studio-import"><label>Exported manifest JSON<textarea name="manifest" required rows="5"></textarea></label><label>Extracted media files<input type="file" name="files" multiple accept="image/png,image/jpeg,image/webp"></label><button>Import portable proposal</button></form><form id="studio-convert"><label>Legacy composition<select name="composition">${c.legacy
   .filter((x) => x.payload.kind === "website-composition")
   .map(
     (x) =>
       `<option value="${enc(x)}">${x.id.slice(-8)} · v${x.version}</option>`,
   )
   .join(
     "",
   )}</select></label><button>Convert into a new proposal</button></form></details>
 ${p ? `<details class="panel"><summary>Manual structured revision</summary><form id="studio-save"><label>Page JSON<textarea name="page" rows="12" required>${e(JSON.stringify(page!.page, null, 2))}</textarea></label><label>Reason<input name="reason" required></label><button>Save operator revision</button></form></details>` : ""}`;
}
export function bindStudio(c: Context) {
  const { studio: s, project } = c;
  const p = s.pages.find((x) => x.id === active) ?? s.pages.at(-1);
  const encodeFile = async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let data = "";
    for (let i = 0; i < bytes.length; i += 8192)
      data += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(data);
  };
  const field = (f: HTMLFormElement, k: string) =>
    String(new FormData(f).get(k) ?? "");
  document.querySelector("#studio-active")?.addEventListener("change", (ev) => {
    active = (JSON.parse((ev.target as HTMLSelectElement).value) as VersionRef)
      .id;
    comparison = null;
    c.render();
  });
  document.querySelector("#studio-width")?.addEventListener("change", (ev) => {
    width = (ev.target as HTMLSelectElement).value;
    c.render();
  });
  c.onForm("#studio-prepare", async (f) => {
    const op = field(f, "operation");
    const locks = p && op !== "create" ? [...p.payload.state.locks] : [];
    const target = field(f, "target"),
      locked = field(f, "lock");
    if (locked && p && op !== "create") {
      const n = walk(p.payload.state.page.root).find((x) => x.id === locked)!;
      locks.push({ nodeId: n.id, field: "text", value: n.text! });
    }
    await c.mutate(
      "page/prepare",
      {
        expectedProject: ptr(project),
        base: op === "create" ? null : ptr(p!),
        operation: op,
        instruction:
          field(f, "instruction") +
          (target ? "\nFocus on local element " + target : ""),
        locks,
        resources: new FormData(f)
          .getAll("resource")
          .map((x) => JSON.parse(String(x))),
      },
      "Scoped AI request saved",
    );
  });
  c.onForm("#studio-apply", async (f) => {
    const file = new FormData(f).get("returnedFile") as File;
    const uploads = file?.size
      ? [
          {
            handle: field(f, "uploadHandle"),
            label: field(f, "uploadLabel"),
            permission: field(f, "uploadPermission"),
            file: await encodeFile(file),
          },
        ]
      : [];
    await c.mutate(
      "page/apply",
      {
        request: JSON.parse(field(f, "request")),
        response: JSON.parse(field(f, "response")),
        source: field(f, "source"),
        model: field(f, "model") || null,
        uploads,
        aiAuthorship: new FormData(f).has("authorship"),
      },
      "AI proposals saved; acceptance remains separate",
    );
  });
  c.onForm(".studio-cancel", async (f) => {
    await c.mutate(
      "page/cancel",
      {
        request: JSON.parse(field(f, "request")),
        reason: "Cancelled by operator",
      },
      "AI request cancelled",
    );
  });
  c.onForm("#studio-accept", async (f) => {
    await c.mutate(
      "page/accept",
      {
        artifact: ptr(p!),
        expected: s.accepted[p!.id] ?? null,
        reason: field(f, "reason"),
        reviewedHash: field(f, "signature"),
        acknowledgeFindings: true,
      },
      "Exact page accepted",
    );
  });
  c.onForm("#studio-history", async (f) => {
    comparison = { ...ptr(p!), version: Number(field(f, "version")) };
    c.render();
  });
  c.onForm("#studio-media", async (f) => {
    const file = new FormData(f).get("file") as File;
    const origin = field(f, "origin");
    if (origin && file?.size) throw Error("Choose one original or upload");
    await c.mutate(
      "page/add-media",
      {
        expectedProject: ptr(project),
        ...(origin ? {} : { file: await encodeFile(file) }),
        origin: origin ? JSON.parse(origin) : null,
        label: field(f, "label"),
        role: field(f, "role"),
        permission: field(f, "permission"),
      },
      "Independent media saved",
    );
  });
  c.onForm("#studio-place", async (f) => {
    await c.mutate(
      "page/place",
      {
        artifact: ptr(p!),
        slot: field(f, "slot"),
        media: JSON.parse(field(f, "media")),
        reason: "Operator placed selected exact media",
      },
      "Media placed in new page revision",
    );
  });
  c.onForm("#studio-website", async (f) => {
    await c.mutate(
      "website/assemble",
      {
        base: null,
        title: field(f, "title"),
        pages: JSON.parse(field(f, "pages")),
        reason: "Explicit route assembly",
      },
      "Website proposal saved",
    );
  });
  c.onForm(".studio-website-accept", async (f) => {
    await c.mutate(
      "website/accept",
      {
        assembly: JSON.parse(field(f, "assembly")),
        expected: s.acceptedWebsite,
        reason: "Reviewed exact Website routes",
        reviewedHash: field(f, "hash"),
      },
      "Exact Website accepted",
    );
  });
  c.onForm("#studio-import", async (f) => {
    const selected = Array.from(
      (f.elements.namedItem("files") as HTMLInputElement).files ?? [],
    );
    const files = Object.fromEntries(
      await Promise.all(
        selected.map(async (file) => [
          "assets/" + file.name,
          await encodeFile(file),
        ]),
      ),
    );
    await c.mutate(
      "page/import",
      {
        expectedProject: ptr(project),
        manifest: JSON.parse(field(f, "manifest")),
        files,
        reason: "Operator imported standalone page evidence",
      },
      "Portable page imported as proposal",
    );
  });
  c.onForm("#studio-convert", async (f) => {
    await c.mutate(
      "page/convert",
      {
        composition: JSON.parse(field(f, "composition")),
        reason:
          "Operator requested additive legacy conversion with loss report",
      },
      "Legacy composition converted as proposal",
    );
  });
  c.onForm("#studio-save", async (f) => {
    await c.mutate(
      "page/save",
      {
        artifact: ptr(p!),
        page: JSON.parse(field(f, "page")),
        reason: field(f, "reason"),
      },
      "Operator page revision saved",
    );
  });
}
