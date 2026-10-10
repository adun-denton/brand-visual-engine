import type { Chat } from "../service/chat.ts";
import type { Pages } from "../service/pages.ts";
import type {
  NodePacket,
  ModuleProject,
  VersionRef,
} from "../kernel/contracts.ts";
import type { ChatFocus, ImageTarget } from "../service/chat-contracts.ts";
import type { Page, Element } from "../modules/website/page.ts";
const nodes = (p: Page): Element[] => {
  const walk = (n: Element): Element[] => [
    n,
    ...(n.children ?? []).flatMap(walk),
  ];
  return walk(p.root);
};
const pageFindings = (p: Page): string[] =>
  state?.activePage?.payload.state.page === p
    ? state.activeFindings
    : ctx.studio?.pages.find((x) => x.payload.state.page === p)
      ? (ctx.studio.findings[
          ctx.studio.pages.find((x) => x.payload.state.page === p)!.id
        ] ?? [])
      : [];
type State = ReturnType<Chat["state"]>;
interface Context {
  project: NodePacket<ModuleProject> | undefined;
  studio: ReturnType<Pages["state"]> | undefined;
  view: string;
  post: (path: string, input: unknown) => Promise<unknown>;
  refresh: () => Promise<void>;
  notice: (s: string, error?: boolean) => void;
}
const esc = (v: unknown) =>
  String(v ?? "").replace(
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
let state: State | undefined,
  owner: string | undefined,
  ctx: Context,
  refreshing = false;
let regionShape: "rectangle" | "ellipse" = "rectangle";
let imagePreset: ImageTarget["preset"];
const drafts = new Map<string | undefined, string>();
let included: VersionRef[] = [],
  target: ImageTarget | null = null,
  selectedImage: string | null = null,
  draft = "",
  returnedJob: string | null = null;
const url = (path: string, pid: string, r: VersionRef) =>
  "/api/v1/" +
  path +
  "?project=" +
  encodeURIComponent(pid) +
  "&id=" +
  encodeURIComponent(r.id) +
  "&version=" +
  r.version;
const active = () =>
  state?.activePage ??
  ctx.studio?.pages
    .filter(
      (p) =>
        !state?.session.turns.some((t) =>
          t.candidates.some((r) => r.id === p.id),
        ) &&
        !ctx.studio!.results.some(
          (r) =>
            r.payload.state.outcome === "historical" &&
            r.payload.state.proposals.some((q) => q.id === p.id),
        ),
    )
    .at(-1);
export function chatCanvas() {
  const p = active(),
    pid = ctx.project?.id;
  const candidates = ctx.studio?.pages ?? [];
  return `<section class="chat-canvas panel"><div class="section-heading"><p class="eyebrow">DESIGN CANVAS</p><h2>${esc(p?.payload.state.page.title ?? "Start with a conversation")}</h2><p>${p ? "Choose, compare and explicitly review an exact candidate." : "Describe what you want to make. Unknown details can stay unresolved."}</p></div><div class="chat-candidates">${candidates.map((x) => `<button type="button" data-chat-candidate="${esc(JSON.stringify(ptr(x)))}" aria-pressed="${x.id === p?.id && x.version === p?.version}">${esc(x.payload.state.page.title)} · v${x.version}</button>`).join("")}</div>${
    p && pid
      ? `<iframe id="chat-preview" title="Selected design candidate" sandbox="allow-same-origin" src="${url("page/preview", pid, ptr(p))}"></iframe><div class="chat-review"><button type="button" data-chat-compare>Compare</button><button type="button" data-chat-accept>Accept exact candidate</button>${ctx.studio?.accepted[p.id] ? `<a href="${url("page/export", pid, ctx.studio.accepted[p.id]!)}">Export accepted page</a>` : ""}</div>${pageFindings(p.payload.state.page).length ? `<label><input type="checkbox" id="chat-findings"> I reviewed the listed findings: ${esc(pageFindings(p.payload.state.page).join(" · "))}</label>` : ""}<div class="chat-comparison">${state?.session.compared.map((r) => `<iframe title="Comparison candidate ${esc(r.id)} v${r.version}" sandbox="allow-same-origin" src="${url("page/preview", pid, r)}"></iframe>`).join("") ?? ""}</div><div class="chat-image-targets">${nodes(
          p.payload.state.page,
        )
          .filter(
            (n) => n.kind === "media" && p.payload.state.page.media[n.slot!],
          )
          .map(
            (n) =>
              `<button type="button" data-chat-image="${esc(n.slot)}">Edit image: ${esc(n.alt || n.slot)}</button>`,
          )
          .join("")}</div><div id="chat-mask-area">${
          selectedImage && p.payload.state.page.media[selectedImage]
            ? `<p>Drag a region on the original image, then describe the change.</p><button type="button" id="chat-region-shape">${regionShape === "rectangle" ? "Use circle region" : "Use rectangle region"}</button><div class="chat-mask-wrap"><img id="chat-mask-image" alt="Original image for region selection" src="${url("page/media", pid, p.payload.state.page.media[selectedImage]!.asset)}"><canvas id="chat-mask" aria-label="Select image region by dragging" tabindex="0"></canvas></div><details><summary>Optional image controls</summary><label>Preset<select id="chat-image-preset">${[
                ["", "Automatic"],
                ["strict-region", "Strict region"],
                ["preserve-form-change-finish", "Preserve form; change finish"],
                ["explore", "Explore"],
              ]
                .map(
                  ([value, label]) =>
                    `<option value="${value}" ${value === (imagePreset ?? "") ? "selected" : ""}>${label}</option>`,
                )
                .join(
                  "",
                )}</select></label></details><button type="button" id="chat-select-whole">Select whole image</button><span id="chat-mask-receipt" role="status">${target ? esc(JSON.stringify(target.bounds)) : "No region selected"}</span>`
            : ""
        }</div>`
      : `<div class="chat-empty-canvas">Your page alternatives will appear here.<p>No connected engine means no generated candidates.</p></div>`
  }</section>`;
}
export function mountChat(c: Context) {
  ctx = c;
  const pid = c.project?.id;
  const switched = pid !== owner;
  if (pid !== owner) {
    drafts.set(
      owner,
      document.querySelector<HTMLTextAreaElement>("#chat-message")?.value ??
        draft,
    );
    draft = drafts.get(pid) ?? "";
    owner = pid;
    state = undefined;
    included = [];
    target = null;
    selectedImage = null;
    imagePreset = undefined;
    returnedJob = null;
  }
  draw(!switched);
  bindCanvas();
  if (pid) void poll();
}
async function poll() {
  if (refreshing || !owner) return;
  refreshing = true;
  const pid = owner;
  try {
    const response = await fetch(
      "/api/v1/chat/state?project=" + encodeURIComponent(pid),
    );
    if (!response.ok) throw Error("Conversation read unavailable");
    const next = (await response.json()) as State;
    if (owner !== pid) return;
    const changed = JSON.stringify(next) !== JSON.stringify(state);
    const canvasChanged =
      next.activePage?.integrity !== state?.activePage?.integrity;
    const ended =
      state?.session.turns.at(-1)?.status === "running" &&
      next.session.turns.at(-1)?.status !== "running";
    state = next;
    if (changed) draw();
    if (ended || canvasChanged) await ctx.refresh();
  } catch {
    if (owner === pid)
      ctx.notice(
        "Conversation connection interrupted; saved drafts and receipts retained.",
        true,
      );
  } finally {
    refreshing = false;
  }
}
setInterval(() => {
  if (document.visibilityState === "visible") void poll();
}, 400);
function draw(preserveDraft = true) {
  const root = document.querySelector<HTMLElement>("#conversation")!;
  const focused = document.activeElement?.id === "chat-message";
  if (preserveDraft)
    draft =
      document.querySelector<HTMLTextAreaElement>("#chat-message")?.value ??
      draft;
  const turns = state?.session.turns ?? [];
  const running = turns.at(-1)?.status === "running";
  const brief = ctx.project?.payload.localContext;
  root.innerHTML = `<aside class="conversation panel" aria-label="Project conversation"><div class="chat-heading"><h2>Conversation</h2><span class="badge" id="chat-connection">${esc(state?.connection ?? "disconnected")}</span></div><p class="hint">${ctx.project ? "This project conversation follows you across views." : "Tell me what you want to make."}</p><button type="button" id="chat-connect">Continue with ChatGPT</button>${brief ? `<details class="chat-summary"><summary>Current brief and choices</summary><dl>${["intent", "audience", "offer", "response", "content", "unresolved"].map((k) => `<dt>${esc(k)}</dt><dd>${esc(JSON.stringify(brief[k]?.override ?? "Unknown"))}</dd>`).join("")}</dl><button type="button" id="chat-correct">Correct in conversation</button></details>` : ""}<div class="chat-transcript" role="log" aria-live="polite">${turns.map((t) => `<article class="chat-user"><strong>You</strong><p>${esc(t.text)}</p></article><article class="chat-reply"><strong>Assistant · ${esc(t.status)}</strong><p>${esc(t.reply)}</p><small>${esc(t.detail)}</small></article>`).join("")}</div><div class="chat-job-cards">${state?.jobs.map((j) => `<article class="chat-image-job"><strong>${j.status === "unavailable" ? "image engine unavailable" : "Returned image candidate"}</strong><p>${esc(j.instruction)}</p><small>${esc(j.preset)} · original ${j.dimensions.width} × ${j.dimensions.height} · ${esc(j.target.slot)}</small><button type="button" data-chat-return="${esc(j.id)}">Attach returned image</button>${j.candidate ? `<img alt="Returned image candidate" src="${url("page/media", ctx.project!.id, j.candidate)}"><button type="button" data-chat-permit="${esc(j.id)}">I have permission to use this image</button><button type="button" data-chat-place="${esc(j.id)}">Choose image for preview</button>` : ""}</article>`).join("") ?? ""}</div><form id="chat-send"><label for="chat-message">Describe or refine your design</label><textarea id="chat-message" rows="3" maxlength="12000" placeholder="Make a landing page for a bicycle repair shop, friendly and practical" required>${esc(draft)}</textarea><div class="chat-send-actions"><button class="primary" type="submit" ${running ? "disabled" : ""}>Send</button><button type="button" id="chat-stop" ${running ? "" : "disabled"}>Stop</button><label class="chat-attach-label">Attach to conversation<input id="chat-attach" type="file" accept="image/png,image/jpeg,image/webp"></label></div></form><div class="chat-attached">${included.map((r) => `<button type="button" data-chat-remove="${esc(r.id)}">Attached reference · remove ${esc(r.id.slice(-6))}</button>`).join("")}</div></aside>`;
  if (focused)
    root.querySelector<HTMLTextAreaElement>("#chat-message")?.focus();
  const run = async (f: () => Promise<void>) => {
    try {
      await f();
    } catch (e) {
      ctx.notice(
        e instanceof Error ? e.message : "Conversation action failed",
        true,
      );
    }
  };
  root.querySelector("#chat-send")!.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void run(async () => {
      const text =
        root.querySelector<HTMLTextAreaElement>("#chat-message")!.value;
      const p = active();
      const focus: ChatFocus = {
        view: ctx.view,
        page: p ? ptr(p) : null,
        resources: included,
        target,
      };
      const result = (await ctx.post("chat/send", {
        projectId: ctx.project?.id ?? null,
        text,
        focus,
        clientId: "turn-" + crypto.randomUUID(),
      })) as { projectId: string };
      draft = "";
      root.querySelector<HTMLTextAreaElement>("#chat-message")!.value = "";
      if (!ctx.project)
        sessionStorage.setItem("bve.chat-created", result.projectId);
      await ctx.refresh();
      await poll();
    });
  });
  root.querySelector("#chat-stop")!.addEventListener(
    "click",
    () =>
      void run(async () => {
        await ctx.post("chat/cancel", {
          projectId: owner,
          input: { turn: state!.session.turns.at(-1)!.id },
        });
        await poll();
        await ctx.refresh();
      }),
  );
  root.querySelector("#chat-connect")!.addEventListener(
    "click",
    () =>
      void run(async () => {
        const v = (await ctx.post("chat/connect", {})) as { url: string };
        const u = new URL(v.url);
        if (u.origin !== "https://auth.openai.com")
          throw Error("Unsupported sign-in URL");
        window.open(v.url, "_blank", "noopener,noreferrer");
      }),
  );
  root.querySelector("#chat-correct")?.addEventListener("click", () => {
    draft = "Please correct the brief: ";
    draw(false);
    root.querySelector<HTMLTextAreaElement>("#chat-message")?.focus();
  });
  root.querySelector<HTMLInputElement>("#chat-attach")!.addEventListener(
    "change",
    (ev) =>
      void run(async () => {
        const file = (ev.target as HTMLInputElement).files?.[0];
        if (!file || !owner)
          throw Error(
            "Start a project conversation before attaching a reference",
          );
        if (file.size > 8 * 1024 * 1024)
          throw Error("Use an image under 8 MiB");
        const b64 = await new Promise<string>((resolve, reject) => {
          const f = new FileReader();
          f.onload = () => resolve(String(f.result).split(",")[1]!);
          f.onerror = () => reject(Error("File read failed"));
          f.readAsDataURL(file);
        });
        const v = (await ctx.post("chat/attach", {
          projectId: owner,
          input: { file: b64, job: returnedJob },
        })) as { media: VersionRef };
        included.push(v.media);
        returnedJob = null;
        await ctx.refresh();
        await poll();
        draw();
      }),
  );
  root.querySelectorAll<HTMLElement>("[data-chat-remove]").forEach((b) =>
    b.addEventListener("click", () => {
      included = included.filter((r) => r.id !== b.dataset["chatRemove"]);
      draw();
    }),
  );
  root.querySelectorAll<HTMLElement>("[data-chat-return]").forEach((b) =>
    b.addEventListener("click", () => {
      returnedJob = b.dataset["chatReturn"]!;
      root.querySelector<HTMLInputElement>("#chat-attach")!.click();
    }),
  );
  root.querySelectorAll<HTMLElement>("[data-chat-permit]").forEach((b) =>
    b.addEventListener(
      "click",
      () =>
        void run(async () => {
          await ctx.post("chat/permit", {
            projectId: owner,
            input: { job: b.dataset["chatPermit"], confirmed: true },
          });
          await ctx.refresh();
          await poll();
          ctx.notice(
            "Usage permission confirmed for the exact returned original.",
          );
        }),
    ),
  );
  root.querySelectorAll<HTMLElement>("[data-chat-place]").forEach((b) =>
    b.addEventListener(
      "click",
      () =>
        void run(async () => {
          await ctx.post("chat/place", {
            projectId: owner,
            input: { job: b.dataset["chatPlace"] },
          });
          target = null;
          selectedImage = null;
          await ctx.refresh();
          ctx.notice(
            "Image candidate chosen for preview; accepted page stays pinned.",
          );
        }),
    ),
  );
}
function redrawCanvas() {
  const panel = document.querySelector(".chat-canvas");
  if (panel) {
    panel.outerHTML = chatCanvas();
    bindCanvas();
  }
}
function bindCanvas() {
  const run = async (f: () => Promise<void>) => {
    try {
      await f();
    } catch (e) {
      ctx.notice(e instanceof Error ? e.message : "Review failed", true);
    }
  };
  document.querySelectorAll<HTMLElement>("[data-chat-candidate]").forEach((b) =>
    b.addEventListener(
      "click",
      () =>
        void run(async () => {
          target = null;
          selectedImage = null;
          await ctx.post("chat/select", {
            projectId: owner,
            input: {
              candidate: JSON.parse(b.dataset["chatCandidate"]!),
              compare: false,
            },
          });
          await poll();
          await ctx.refresh();
          ctx.notice("Candidate selected for viewing; acceptance is separate.");
        }),
    ),
  );
  document.querySelector("[data-chat-compare]")?.addEventListener(
    "click",
    () =>
      void run(async () => {
        const p = active()!;
        await ctx.post("chat/select", {
          projectId: owner,
          input: { candidate: ptr(p), compare: true },
        });
        await poll();
        await ctx.refresh();
      }),
  );
  document.querySelector("[data-chat-accept]")?.addEventListener(
    "click",
    () =>
      void run(async () => {
        const p = active()!;
        await ctx.post("chat/accept", {
          projectId: owner,
          input: {
            candidate: ptr(p),
            reviewedHash: ctx.studio!.signatures[p.id],
            acknowledgeFindings:
              document.querySelector<HTMLInputElement>("#chat-findings")
                ?.checked ?? false,
          },
        });
        await ctx.refresh();
        ctx.notice("Exact page accepted. Website acceptance remains separate.");
      }),
  );
  document.querySelectorAll<HTMLElement>("[data-chat-image]").forEach((b) =>
    b.addEventListener("click", () => {
      selectedImage = b.dataset["chatImage"]!;
      target = null;
      redrawCanvas();
    }),
  );
  const canvas = document.querySelector<HTMLCanvasElement>("#chat-mask"),
    image = document.querySelector<HTMLImageElement>("#chat-mask-image"),
    p = active();
  if (!canvas || !image || !p || !selectedImage) return;
  const binding = p.payload.state.page.media[selectedImage]!;
  document
    .querySelector<HTMLSelectElement>("#chat-image-preset")
    ?.addEventListener("change", (ev) => {
      imagePreset =
        ((ev.target as HTMLSelectElement).value as ImageTarget["preset"]) ||
        undefined;
      if (target) {
        delete target.preset;
        if (imagePreset) target.preset = imagePreset;
      }
    });
  canvas.width = binding.image.width;
  canvas.height = binding.image.height;
  let start: { x: number; y: number } | null = null;
  const point = (ev: PointerEvent) => {
    const box = canvas.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(
          canvas.width - 1,
          Math.floor(((ev.clientX - box.left) / box.width) * canvas.width),
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          canvas.height - 1,
          Math.floor(((ev.clientY - box.top) / box.height) * canvas.height),
        ),
      ),
    };
  };
  const capture = (
    a: { x: number; y: number },
    b: { x: number; y: number },
  ) => {
    const x = Math.min(a.x, b.x),
      y = Math.min(a.y, b.y),
      width = Math.max(1, Math.abs(b.x - a.x)),
      height = Math.max(1, Math.abs(b.y - a.y));
    target = {
      page: ptr(p),
      slot: selectedImage!,
      media: binding.asset,
      shape: regionShape,
      bounds: { x, y, width, height },
      ...(imagePreset ? { preset: imagePreset } : {}),
    };
    const c = canvas.getContext("2d")!;
    c.clearRect(0, 0, canvas.width, canvas.height);
    c.fillStyle = "rgba(12,110,190,.3)";
    if (regionShape === "ellipse") {
      c.beginPath();
      c.ellipse(
        x + width / 2,
        y + height / 2,
        width / 2,
        height / 2,
        0,
        0,
        Math.PI * 2,
      );
      c.fill();
    } else c.fillRect(x, y, width, height);
    document.querySelector("#chat-mask-receipt")!.textContent =
      `Original pixels: ${x}, ${y}, ${width} × ${height}`;
  };
  document
    .querySelector("#chat-region-shape")
    ?.addEventListener("click", () => {
      regionShape = regionShape === "rectangle" ? "ellipse" : "rectangle";
      target = null;
      redrawCanvas();
    });
  canvas.addEventListener("pointerdown", (ev) => {
    start = point(ev);
    canvas.setPointerCapture(ev.pointerId);
  });
  canvas.addEventListener("pointerup", (ev) => {
    if (start) capture(start, point(ev));
    start = null;
  });
  document
    .querySelector("#chat-select-whole")
    ?.addEventListener("click", () =>
      capture({ x: 0, y: 0 }, { x: canvas.width, y: canvas.height }),
    );
  canvas.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      capture({ x: 0, y: 0 }, { x: canvas.width, y: canvas.height });
    }
  });
}
