import type { VersionRef } from "../kernel/contracts.ts";
import type {
  Work,
  ReconstructionRequest,
  ReconstructionResult,
  ReconstructionControl,
} from "../modules/website/reconstruction-contracts.ts";
import { escapeHtml } from "../modules/website/composition.ts";
import type { RasterConcept } from "../modules/website/exploration-contracts.ts";
type Ctx = {
  pid: string;
  project: VersionRef;
  unit: VersionRef;
  focus: Work<RasterConcept> | null;
  brands: { ref: VersionRef; label: string }[];
  post: (action: string, input: unknown, pid: string) => Promise<any>;
};
type State = {
  control: Work<ReconstructionControl> | null;
  history: {
    request: Work<ReconstructionRequest>;
    result: Work<ReconstructionResult> | null;
  }[];
  accepted: VersionRef | null;
  availability: { connected: boolean; label: string };
  resources: any[];
  notes: any[];
};
const esc = escapeHtml,
  key = (r: VersionRef) => r.id + ":" + r.version,
  pin = (p: { id: string; version: number }): VersionRef => ({
    id: p.id,
    version: p.version,
    freshness: "pinned",
  }),
  encoded = (r: VersionRef) => encodeURIComponent(JSON.stringify(r));
let ctx: Ctx | null = null,
  data: State | null = null,
  ticket = 0,
  view = "",
  slot = 1,
  side = "original",
  viewport = 0,
  busy = false,
  runningRequests = new Set<string>(),
  shownResult = "",
  autoOpen = true,
  sheetDraft: Record<string, string | string[]> = {},
  notice = "",
  sheet = false,
  sheetSource: Work<RasterConcept> | null = null,
  base: { ref: VersionRef; signature: string } | null = null;
const host = () => document.getElementById("reconstruction-root");
const rawSelected = () =>
  data?.history.find((x) => key(pin(x.request)) === view) ?? null;
const selected = () => {
  const h = rawSelected();
  return h
    ? {
        request: h.request,
        result:
          h.result && key(pin(h.result)) === shownResult ? h.result : null,
      }
    : null;
};
const image = (pid: string, r: VersionRef) =>
  "/api/v1/visual/image?" +
  new URLSearchParams({ project: pid, id: r.id, version: String(r.version) });
async function load() {
  if (!ctx) return;
  const c = ctx,
    t = ++ticket;
  try {
    const response = await fetch(
      "/api/v1/visual/reconstruction/state?" +
        new URLSearchParams({ project: c.pid, unit: JSON.stringify(c.unit) }),
    );
    const value = await response.json();
    if (!response.ok) throw Error(value.error);
    if (t !== ticket || ctx !== c) return;
    data = value;
    if (autoOpen && !view && data?.control) {
      view = key(data.control.payload.state.request);
      shownResult = data.control.payload.state.result
        ? key(data.control.payload.state.result)
        : "";
    }
    render();
  } catch (e) {
    if (t === ticket) {
      notice =
        e instanceof Error ? e.message : "Reconstruction state unavailable";
      render();
    }
  }
}
export function bindReconstruction(c: Ctx | null) {
  const changed =
    !ctx || !c || ctx.pid !== c.pid || key(ctx.unit) !== key(c.unit);
  ctx = c;
  if (changed) {
    ticket++;
    data = null;
    view = "";
    slot = 1;
    sheet = false;
    base = null;
    notice = "";
    busy = false;
    shownResult = "";
    autoOpen = true;
    sheetDraft = {};
  }
  render();
  if (c) void load();
  document.getElementById("build-html")?.addEventListener("click", () => {
    if (ctx?.focus) {
      sheetSource = ctx.focus;
      base = null;
      sheetDraft = {};
      sheet = true;
      render();
    }
  });
}
function render() {
  const root = host();
  if (!root || !ctx) return;
  const chosen = selected(),
    q = chosen?.request,
    s = q?.payload.state,
    result = chosen?.result,
    r = result?.payload.state,
    p = r?.proposals.find((x) => x.slot === slot) ?? r?.proposals[0],
    current =
      !!q &&
      key(pin(q)) ===
        key(
          data?.control?.payload.state.request ?? {
            id: "none",
            version: 1,
            freshness: "pinned",
          },
        ) &&
      data?.control?.payload.state.status === "returned" &&
      r?.outcome === "current";
  const qOptions =
    data?.history
      .map(
        (x) =>
          `<option value="${esc(key(pin(x.request)))}" ${key(pin(x.request)) === view ? "selected" : ""}>${esc(x.request.id)} · v${x.request.version}${x.result ? " · " + esc(x.result.payload.state.outcome) : " · pending / cancelled"}</option>`,
      )
      .join("") ?? "";
  let comparison = "";
  if (s && q) {
    const original = `<figure class="reconstruction-original"><img src="${esc(image(ctx.pid, s.source.candidate))}" alt="Exact whole raster reconstruction reference"><figcaption>${esc(s.source.candidate.id)} · v${s.source.candidate.version} · ${esc(s.source.integrity)}</figcaption></figure>`;
    const v = s.viewports[viewport] ?? s.viewports[0]!;
    const implementation =
      p && result
        ? `<div class="reconstruction-implementation"><div class="reconstruction-frame" style="--preview-width:${v.width}px;--preview-height:${v.height}px"><iframe title="Semantic implementation preview" sandbox="allow-same-origin" width="${v.width}" height="${v.height}" src="/api/v1/visual/reconstruction/preview?${esc(new URLSearchParams({ project: ctx.pid, request: JSON.stringify(pin(q)), result: JSON.stringify(pin(result)), proposal: JSON.stringify(p.ref) }).toString())}"></iframe></div><p>Requested preview ${v.width} × ${v.height} CSS pixels</p></div>`
        : '<div class="reconstruction-implementation"><p>Pending semantic slots. ' +
          esc(
            data?.availability.label ?? "Reconstruction execution unavailable",
          ) +
          ".</p></div>";
    comparison = `<p class="reconstruction-identity">Whole raster ${esc(s.source.candidate.id)} · v${s.source.candidate.version} · integrity ${esc(s.source.integrity)} · page ${esc(s.workUnit.id)} · request ${esc(q.id)} · v${q.version}. Brand ${s.brand.enabled ? "on · " + esc(s.brand.source.id) + " v" + s.brand.source.version : "off"}. The source-visible styling remains visible.</p><div class="reconstruction-toggle"><button data-reconstruction-side="original" aria-pressed="${side === "original"}">Original</button><button data-reconstruction-side="implementation" aria-pressed="${side === "implementation"}">Implementation</button></div><div class="reconstruction-pair" data-side="${side}"><section data-side-pane="original"><h3>Original raster</h3>${original}</section><section data-side-pane="implementation"><h3>Implementation</h3>${implementation}</section></div><label>Requested viewport<select id="reconstruction-viewport">${s.viewports.map((v, i) => `<option value="${i}" ${i === viewport ? "selected" : ""}>${v.width} × ${v.height}</option>`).join("")}</select></label><details><summary>Inspect frozen explicit context</summary><pre>${esc(JSON.stringify(s.context, null, 2))}</pre></details>`;
    if (p && result) {
      comparison += `<label>Semantic proposal<select id="reconstruction-slot">${r!.proposals.map((x) => `<option value="${x.slot}" ${x.slot === p.slot ? "selected" : ""}>Attempt ${x.slot} · ${esc(x.ref.id)} · v${x.ref.version}</option>`).join("")}</select></label><section class="reconstruction-notes"><h3>Differences / unresolved</h3><p>Authored semantic test fixture. Structural validity does not establish visual fidelity.</p><ul>${[...r!.findings, ...((r!.response.slots.find((x) => x.slot === p.slot)?.candidate as { page?: { unresolved?: string[] } })?.page?.unresolved ?? [])].map((x) => `<li>${esc(x)}</li>`).join("")}</ul></section><label class="check"><input type="checkbox" id="reconstruction-ack">I reviewed this exact semantic proposal and its unresolved findings.</label><div class="reconstruction-actions"><button id="reconstruction-accept" ${current && !busy ? "" : "disabled"}>Accept semantic proposal</button><button id="reconstruction-revise" ${!busy ? "" : "disabled"}>Revise this proposal</button><button id="reconstruction-export" ${data?.accepted?.id === p.ref.id && !busy ? "" : "disabled"}>Export accepted semantic page</button><button id="reconstruction-return">Return to exploration</button></div><p>${current ? "Explicit acceptance is separate from raster selection and Website acceptance." : "Historical / stale evidence: prepare a new explicit operation before acceptance."}</p>`;
    } else if (
      data?.control?.payload.state.status === "pending" &&
      q &&
      key(data.control.payload.state.request) === key(pin(q))
    )
      comparison += `<button id="reconstruction-fixture" ${data.availability.connected && !busy && !runningRequests.has(q.id) ? "" : "disabled"}>Run authored offline fixture</button><button id="reconstruction-cancel" ${busy ? "disabled" : ""}>Cancel pending reconstruction</button>`;
  }
  if (q && !result && rawSelected()?.result)
    comparison +=
      '<button id="reconstruction-inspect">Inspect exact recorded result</button>';
  root.innerHTML = `<section class="reconstruction-panel" aria-label="HTML reconstruction"><div class="section-head"><h2>HTML reconstruction</h2><span>${esc(data?.availability.label ?? "Reconstruction execution unavailable")}</span></div><p id="reconstruction-notice" role="status">${esc(notice)}</p>${data?.history.length ? `<label>Exact operation<select id="reconstruction-history"><option value="">Choose exact request</option>${qOptions}</select></label>` : "<p>No reconstruction operations saved on this page.</p>"}${comparison}</section>${sheet && sheetSource ? sheetMarkup() : ""}`;
  bind();
  if (sheet) {
    const d = document.getElementById(
      "reconstruction-sheet",
    ) as HTMLDialogElement;
    d.showModal();
    for (const [name, value] of Object.entries(sheetDraft)) {
      const fields = d.querySelectorAll<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >('[name="' + name + '"]');
      fields.forEach((n) => {
        if (n instanceof HTMLInputElement && n.type === "checkbox")
          n.checked = Array.isArray(value) && value.includes(n.value);
        else n.value = String(value);
      });
    }
    d.addEventListener("cancel", (e) => {
      e.preventDefault();
      closeSheet();
    });
  }
  root
    .querySelector<HTMLImageElement>(".reconstruction-original img")
    ?.addEventListener("error", () => {
      notice =
        "Exact original raster unavailable or corrupt. Independent accepted semantic export remains separate.";
      const n = document.getElementById("reconstruction-notice");
      if (n) n.textContent = notice;
    });
  root.querySelectorAll<HTMLIFrameElement>("iframe").forEach((frame) => {
    const scale = () => {
      const box = frame.parentElement!,
        ratio = Math.min(1, box.clientWidth / Number(frame.width));
      frame.style.transform = `scale(${ratio})`;
      box.style.height = Number(frame.height) * ratio + "px";
    };
    frame.onload = scale;
    scale();
  });
}
function sheetMarkup() {
  const source = sheetSource!,
    resources = (data?.resources ?? []).filter(
      (m) => m.id !== source.payload.state.media.id,
    );
  return `<dialog id="reconstruction-sheet" aria-labelledby="reconstruction-sheet-title"><form id="reconstruction-prepare"><h2 id="reconstruction-sheet-title">Build whole raster as HTML</h2><button type="button" id="reconstruction-close">Close preparation</button><img class="reconstruction-sheet-source" src="${esc(image(ctx!.pid, pin(source)))}" alt="Exact whole raster to reconstruct"><p>Project ${esc(ctx!.pid)} · Page ${esc(ctx!.unit.id)} · v${ctx!.unit.version}</p><p id="reconstruction-source-identity">${esc(source.id)} · v${source.version} · ${esc(source.integrity)}</p><p>Reconstruct the whole raster. Existing selected regions are not cropped or substituted.</p><label>Implementation instructions<textarea name="instruction" required rows="3" placeholder="Describe implementation intent and unknowns"></textarea></label><label>Attempts<select name="count" required><option value="">Choose 1–6</option>${[1, 2, 3, 4, 5, 6].map((n) => `<option value="${n}">${n}</option>`).join("")}</select></label><label>Requested viewport(s)<select name="viewports" required><option value="">Choose preview viewports</option><option value="desktop">Desktop · 1440 × 1000</option><option value="narrow">Narrow · 390 × 844</option><option value="both">Desktop and narrow</option></select></label><label>Optional approved Brand<select name="brand"><option value="">Off · no project or old Brand context</option>${ctx!.brands.map((b, i) => `<option value="${i}">${esc(b.label)} · v${b.ref.version}</option>`).join("")}</select></label><p>Brand off excludes separate project defaults and old base context. Visible source styling and a deliberately selected semantic tree remain explicit inputs.</p>${base ? `<p>Explicit semantic base ${esc(base.ref.id)} · v${base.ref.version} · ${esc(base.signature)}</p>` : ""}<details><summary>Deliberately included references / placeable media</summary>${resources.map((m, i) => `<label><input type="checkbox" name="resource" value="${i}">${esc(m.payload.state.label)} · v${m.version}</label><select name="role-${i}" aria-label="Role for ${esc(m.payload.state.label)}"><option value="reference">Reference only</option>${m.payload.state.role === "placeable" ? '<option value="placeable">Placeable media</option>' : ""}</select>`).join("") || "<p>No additional media available.</p>"}<p>Placed base media must be explicitly included as placeable. Missing media stays unresolved.</p></details><details><summary>Explicit human handoff evidence</summary>${(data?.notes ?? []).map((n, i) => `<label><input type="checkbox" name="evidence" value="${i}">${esc(n.payload.state.text)} · v${n.version}</label>`).join("") || "<p>No handoff notes included.</p>"}</details><p>Preparing saves an operation and pending slots. Production execution is unavailable.</p><button class="primary" ${busy ? "disabled" : ""}>Prepare reconstruction</button></form></dialog>`;
}
function closeSheet() {
  sheet = false;
  render();
  document.getElementById("build-html")?.focus();
}
async function action(fn: () => Promise<unknown>) {
  if (!ctx || busy) return;
  const c = ctx;
  busy = true;
  notice = "Saving explicit reconstruction action…";
  render();
  try {
    await fn();
    if (ctx === c) {
      notice =
        "Reconstruction action saved. No actual model or image generation.";
      await load();
    }
  } catch (e) {
    if (ctx === c) {
      notice =
        e instanceof Error
          ? e.message
          : "Action rejected; saved state retained";
      await load();
    }
  } finally {
    if (ctx === c) {
      busy = false;
      render();
    }
  }
}
function bind() {
  const on = (id: string, fn: (e: Event) => void, event = "click") =>
    document.getElementById(id)?.addEventListener(event, fn);
  on("reconstruction-close", () => closeSheet());
  on(
    "reconstruction-history",
    (e) => {
      view = (e.target as HTMLSelectElement).value;
      slot = 1;
      viewport = 0;
      shownResult = rawSelected()?.result
        ? key(pin(rawSelected()!.result!))
        : "";
      render();
    },
    "change",
  );
  on(
    "reconstruction-slot",
    (e) => {
      slot = Number((e.target as HTMLSelectElement).value);
      render();
    },
    "change",
  );
  on(
    "reconstruction-viewport",
    (e) => {
      viewport = Number((e.target as HTMLSelectElement).value);
      render();
    },
    "change",
  );
  host()
    ?.querySelectorAll<HTMLElement>("[data-reconstruction-side]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          side = b.dataset["reconstructionSide"]!;
          render();
        }),
    );
  const chosen = selected(),
    q = chosen?.request,
    result = chosen?.result,
    p =
      result?.payload.state.proposals.find((x) => x.slot === slot) ??
      result?.payload.state.proposals[0];
  on("reconstruction-fixture", () => {
    if (!ctx || runningRequests.has(q!.id)) return;
    const c = ctx,
      request = pin(q!);
    runningRequests.add(request.id);
    notice = "Running an authored offline fixture; Cancel remains available.";
    render();
    void (async () => {
      try {
        await c.post("reconstruction/fixture-run", { request }, c.pid);
        if (ctx === c) {
          await load();
          const control = data?.control;
          if (
            control?.payload.state.status === "returned" &&
            key(control.payload.state.request) === key(request) &&
            view === key(request)
          ) {
            shownResult = key(control.payload.state.result!);
            notice = "Authored fixture result ready for explicit review.";
          } else
            notice =
              "Historical fixture result retained; inspect its exact recorded result explicitly.";
        }
      } catch (e) {
        if (ctx === c)
          notice =
            e instanceof Error
              ? e.message
              : "Fixture rejected; prepare a new operation.";
      } finally {
        runningRequests.delete(request.id);
        if (ctx === c) render();
      }
    })();
  });
  on("reconstruction-inspect", () => {
    shownResult = key(pin(rawSelected()!.result!));
    render();
  });
  on(
    "reconstruction-cancel",
    () =>
      void action(() =>
        ctx!.post(
          "reconstruction/cancel",
          {
            request: pin(q!),
            expectedControl: pin(data!.control!),
            reason: "Explicit operator cancellation",
          },
          ctx!.pid,
        ),
      ),
  );
  on("reconstruction-accept", () => {
    if (
      !(document.getElementById("reconstruction-ack") as HTMLInputElement)
        .checked
    ) {
      notice = "Review and acknowledge the exact proposal and findings first.";
      render();
      return;
    }
    void action(() =>
      ctx!.post(
        "reconstruction/accept",
        {
          request: pin(q!),
          result: pin(result!),
          proposal: p!.ref,
          reviewedHash: p!.signature,
          expectedControl: pin(data!.control!),
          expectedAcceptance: data!.accepted,
          reason: "Explicit reviewed reconstruction proposal",
          acknowledgeFindings: true,
        },
        ctx!.pid,
      ),
    );
  });
  on("reconstruction-revise", () => {
    sheetSource = {
      ...ctx!.focus!,
      id: q!.payload.state.source.candidate.id,
      version: q!.payload.state.source.candidate.version,
      integrity: q!.payload.state.source.integrity,
      payload: {
        ...ctx!.focus!.payload,
        state: {
          ...ctx!.focus!.payload.state,
          media: q!.payload.state.source.media,
        },
      },
    };
    base = { ref: p!.ref, signature: p!.signature };
    sheetDraft = {};
    sheet = true;
    render();
  });
  on("reconstruction-return", () => {
    view = "";
    shownResult = "";
    autoOpen = false;
    render();
    document.getElementById("build-html")?.focus();
  });
  on(
    "reconstruction-export",
    () =>
      void action(async () => {
        const session = await (await fetch("/api/v1/session")).json();
        const response = await fetch("/api/v1/visual/reconstruction/export", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-BVE-Token": session.token,
          },
          body: JSON.stringify({
            projectId: ctx!.pid,
            input: { proposal: p!.ref },
          }),
        });
        if (!response.ok) {
          const v = await response.json();
          throw Error(v.error);
        }
        const url = URL.createObjectURL(await response.blob()),
          a = document.createElement("a");
        a.href = url;
        a.download = "semantic-page.tar";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      }),
  );
  on(
    "reconstruction-prepare",
    (e) => {
      e.preventDefault();
      const f = new FormData(e.target as HTMLFormElement);
      sheetDraft = Object.fromEntries(
        [...new Set(f.keys())].map((k) => [
          k,
          ["resource", "evidence"].includes(k)
            ? f.getAll(k).map(String)
            : String(f.get(k)),
        ]),
      );
      const available = (data?.resources ?? []).filter(
          (m) => m.id !== sheetSource!.payload.state.media.id,
        ),
        source = pin(sheetSource!),
        integrity = sheetSource!.integrity,
        c = ctx!,
        resources = f.getAll("resource").map((v) => {
          const i = Number(v),
            m = available[i];
          return {
            media: pin(m),
            label: m.payload.state.label,
            role: f.get("role-" + i),
          };
        }),
        evidence = f.getAll("evidence").map((v) => {
          const n = data!.notes[Number(v)];
          return { ref: pin(n), integrity: n.integrity };
        }),
        viewports =
          f.get("viewports") === "both"
            ? [
                { width: 1440, height: 1000 },
                { width: 390, height: 844 },
              ]
            : f.get("viewports") === "narrow"
              ? [{ width: 390, height: 844 }]
              : [{ width: 1440, height: 1000 }],
        expected = data?.control ? pin(data.control) : null,
        selectedBase = base;
      void action(async () => {
        const prepared = await c.post(
          "reconstruction/prepare",
          {
            expectedProject: c.project,
            workUnit: c.unit,
            source,
            integrity,
            expectedControl: expected,
            instruction: f.get("instruction"),
            count: f.get("count") ? Number(f.get("count")) : null,
            viewports,
            brand:
              f.get("brand") === ""
                ? null
                : c.brands[Number(f.get("brand"))]!.ref,
            base: selectedBase?.ref ?? null,
            baseSignature: selectedBase?.signature ?? null,
            resources,
            evidence,
          },
          c.pid,
        );
        sheet = false;
        view = key(pin(prepared.request));
        shownResult = "";
        autoOpen = false;
        slot = 1;
        viewport = 0;
      });
    },
    "submit",
  );
  document
    .querySelector<HTMLImageElement>(".reconstruction-sheet-source")
    ?.addEventListener("error", () => {
      notice = "Exact raster unavailable or corrupt; preparation is blocked.";
      const b = document.querySelector<HTMLButtonElement>(
        "#reconstruction-prepare button.primary",
      );
      if (b) b.disabled = true;
    });
}
