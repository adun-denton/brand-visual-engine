import type { VersionRef } from "../kernel/contracts.ts";
import type {
  Focus,
  DraftTarget,
  DraftToken,
} from "../modules/website/auxiliary-contracts.ts";
import { escapeHtml as esc } from "../modules/website/composition.ts";
import { requestFields } from "../modules/website/visual-controls.ts";
import { bindAuxiliaryReconstructionHook } from "./auxiliary-hooks.ts";
type Edit = { field: string; after: unknown };
type Ctx = {
  pid: string;
  project: VersionRef;
  unit: VersionRef;
  focus: Focus;
  brands: { ref: VersionRef; label: string }[];
  post: (action: string, input: unknown, pid: string) => Promise<any>;
  variation: () => { key: string; values: Record<string, unknown> };
  applyVariation: (edits: Edit[]) => void;
  preparation: () => null | {
    key: string;
    values: Record<string, unknown>;
    focus: Focus;
    apply: (edits: Edit[]) => void;
  };
  operation: () => Focus | null;
  semantic: () => null | {
    unit: VersionRef;
    ref: VersionRef;
    signature: string;
  };
  bridgeDone: (request: VersionRef) => Promise<void>;
};
let ctx: Ctx | null = null,
  opened = false,
  session = "",
  host: HTMLElement | null = null,
  data: any = null,
  notice = "",
  message = "",
  brand = "",
  targetKind = "variation",
  focusMode = "visual",
  busy = false,
  pending: any = null,
  epoch = 0;
let selectedFields = new Set<string>(),
  references = new Set<string>(),
  evidence = new Set<string>();
const drafts = new Map<
  string,
  {
    target: DraftTarget;
    token: DraftToken;
    fingerprint: string;
    values: Record<string, unknown>;
  }
>();
let queue: Promise<unknown> = Promise.resolve();
const key = (r: VersionRef) => r.id + ":" + r.version;
const fingerprint = (x: unknown) => JSON.stringify(x);
function short(x: unknown) {
  let hash = 2166136261;
  for (const c of fingerprint(x)) {
    hash ^= c.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
function element() {
  if (!host) {
    host = document.createElement("div");
    host.id = "auxiliary-root";
  }
  return host;
}
function portal() {
  const node = element(),
    dialog = document.getElementById("reconstruction-sheet");
  (
    dialog ??
    document.getElementById("workspace") ??
    document.getElementById("visual-app") ??
    document.body
  ).append(node);
}
function current() {
  if (!ctx) throw Error("Choose an exact project/page");
  const prep = ctx.preparation();
  if (targetKind === "reconstruction" && !prep)
    throw Error(
      "Open the reconstruction preparation sheet to discuss its draft",
    );
  const draft = targetKind === "reconstruction" ? prep! : ctx.variation();
  const focus = targetKind === "reconstruction" ? prep!.focus : ctx.focus;
  const target: DraftTarget = {
    session,
    projectId: ctx.pid,
    workUnit: ctx.unit,
    kind: targetKind as "variation" | "reconstruction",
    key:
      draft.key +
      "-" +
      short({
        focus,
        brand,
        references: [...references].sort(),
        evidence: [...evidence].sort(),
        focusMode,
        fields: [...selectedFields].sort(),
      }),
  };
  const values = { ...draft.values };
  for (const field of selectedFields)
    if (
      targetKind === "variation" &&
      field.startsWith("level") &&
      !Object.hasOwn(values, field)
    )
      values[field] = null;
  return {
    target,
    values,
    stamp: fingerprint(target),
    fingerprint: fingerprint(values),
    draft,
    focus,
  };
}
async function sync() {
  const c = ctx!,
    now = current(),
    old = drafts.get(now.stamp);
  if (old && old.fingerprint === now.fingerprint) {
    await c.post("auxiliary/navigate", { session, target: now.target }, c.pid);
    return old;
  }
  const response = await c.post(
    "auxiliary/observe",
    { target: now.target, expected: old?.token ?? null, values: now.values },
    c.pid,
  );
  const stored = {
    ...response,
    target: now.target,
    fingerprint: now.fingerprint,
  };
  drafts.set(now.stamp, stored);
  return stored;
}
function queued<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}
export function auxiliaryDraftChanged() {
  if (opened && ctx && session)
    void queued(sync).catch((e) => {
      notice = e.message;
      render();
    });
}
export function bindAuxiliary(c: Ctx | null) {
  const changed =
    !ctx ||
    !c ||
    ctx.pid !== c.pid ||
    key(ctx.unit) !== key(c.unit) ||
    fingerprint(ctx.focus) !== fingerprint(c.focus);
  ctx = c;
  if (changed) {
    epoch++;
    selectedFields.clear();
    references.clear();
    evidence.clear();
    brand = "";
    focusMode = "visual";
    if (!c) targetKind = "variation";
    if (session)
      void queued(async () => {
        if (ctx) await sync();
        else if (c === null)
          await fetchPost("navigate", { session, target: null });
      }).catch((e) => {
        notice = e.message;
        render();
      });
    if (opened && c) void load();
  }
  portal();
  render();
}
async function fetchPost(action: string, input: unknown) {
  if (ctx) return ctx.post("auxiliary/" + action, input, ctx.pid);
  const token = await (await fetch("/api/v1/session")).json();
  const response = await fetch("/api/v1/visual/auxiliary/" + action, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-BVE-Token": token.token },
    body: JSON.stringify({ projectId: "closed-view", input }),
  });
  const v = await response.json();
  if (!response.ok) throw Error(v.error);
  return v;
}
async function load() {
  if (!ctx) return;
  const c = ctx,
    t = ++epoch;
  const response = await fetch(
    "/api/v1/visual/auxiliary/state?" +
      new URLSearchParams({ project: c.pid, unit: JSON.stringify(c.unit) }),
  );
  const v = await response.json();
  if (t !== epoch || !ctx || ctx.pid !== c.pid || key(ctx.unit) !== key(c.unit))
    return;
  if (!response.ok) {
    notice = v.error;
    render();
    return;
  }
  data = v;
  render();
}
async function chosenFocus(): Promise<Focus> {
  const c = ctx!;
  if (targetKind === "reconstruction") return current().focus;
  if (focusMode === "operation") {
    const operation = c.operation();
    if (!operation)
      throw Error("Select an exact reconstruction operation first");
    return operation;
  }
  if (focusMode === "semantic") {
    const page = c.semantic();
    if (!page) throw Error("Select an exact semantic proposal first");
    return c.post(
      "auxiliary/describe",
      { unit: page.unit, page: page.ref },
      c.pid,
    );
  }
  return c.focus;
}
async function inclusion() {
  const c = ctx!,
    focus = await chosenFocus();
  const b = brand === "" ? null : c.brands[Number(brand)];
  let frozenBrand = null;
  if (b) frozenBrand = await c.post("auxiliary/brand", { ref: b.ref }, c.pid);
  return {
    project: c.project,
    focus,
    brand: frozenBrand,
    references: (data?.references ?? [])
      .filter((m: any) => references.has(m.id))
      .map((m: any) => ({
        ref: { id: m.id, version: m.version, freshness: "pinned" },
        integrity: m.integrity,
        label: m.payload.state.label,
      })),
    evidence: (data?.evidence ?? [])
      .filter((m: any) => evidence.has(m.id))
      .map((m: any) => ({
        ref: { id: m.id, version: m.version, freshness: "pinned" },
        integrity: m.integrity,
      })),
  };
}
async function closePanel() {
  const c = ctx,
    closingSession = session;
  opened = false;
  session = "";
  drafts.clear();
  selectedFields.clear();
  references.clear();
  evidence.clear();
  brand = "";
  targetKind = "variation";
  focusMode = "visual";
  message = "";
  pending = null;
  render();
  document.getElementById("auxiliary-toggle")?.focus();
  if (c && closingSession)
    await c.post("auxiliary/close", { session: closingSession }, c.pid);
}
window.addEventListener("pagehide", () => {
  if (ctx && session)
    void ctx.post("auxiliary/close", { session }, ctx.pid).catch(() => {});
});
function render() {
  const root = element();
  if (!ctx) {
    root.innerHTML = "";
    return;
  }
  const prep = ctx.preparation(),
    operation = ctx.operation(),
    semantic = ctx.semantic();
  const shown =
    targetKind === "reconstruction"
      ? prep?.focus
      : focusMode === "operation"
        ? operation
        : focusMode === "semantic"
          ? semantic
          : ctx.focus;
  const description =
    shown && "kind" in shown
      ? shown.kind === "visual-page"
        ? shown.raster
          ? `Whole raster ${shown.raster.ref.id} · v${shown.raster.ref.version}${shown.region ? " · explicit original-geometry region reference" : ""}`
          : "Visual page, no raster attached"
        : shown.kind === "reconstruction"
          ? `Frozen reconstruction ${shown.request.id} · v${shown.request.version}`
          : `Semantic page ${shown.page.id} · v${shown.page.version}`
      : semantic
        ? `Semantic proposal ${semantic.ref.id} · v${semantic.ref.version}`
        : "Exact focus unavailable";
  const title = "Auxiliary chat";
  root.innerHTML = `<button id="auxiliary-toggle" aria-expanded="${opened}">${opened ? "Close" : "Open"} ${title.toLowerCase()}</button>${
    opened
      ? `<section class="auxiliary-panel" aria-label="Auxiliary chat"><div class="section-head"><h2>${title}</h2><span>${esc(data?.availability?.label ?? "Production visual transport disconnected")}</span></div><p id="auxiliary-notice" role="status">${esc(notice)}</p><p id="auxiliary-owner">Project ${esc(ctx.pid)} · Page ${esc(ctx.unit.id)} v${ctx.unit.version}</p><p>Chat proposes. Apply changes only the named session draft; Prepare, Execute and acceptance remain separate.</p><label>Named editable draft<select id="auxiliary-target"><option value="variation" ${targetKind === "variation" ? "selected" : ""}>Next variation</option>${prep ? `<option value="reconstruction" ${targetKind === "reconstruction" ? "selected" : ""}>Reconstruction preparation</option>` : ""}</select></label><label>Exact focus for next message<select id="auxiliary-focus"><option value="visual" ${focusMode === "visual" ? "selected" : ""}>Current visual page / raster / region</option>${operation ? `<option value="operation" ${focusMode === "operation" ? "selected" : ""}>Selected frozen reconstruction operation</option>` : ""}${semantic ? `<option value="semantic" ${focusMode === "semantic" ? "selected" : ""}>Selected semantic proposal</option>` : ""}</select></label><p id="auxiliary-focus-summary">Next message includes: ${esc(description)}. Brand ${brand === "" ? "off" : "explicitly selected"} · ${references.size} additional image references · ${evidence.size} evidence references.</p><details><summary>Inspect exact focus references</summary><pre id="auxiliary-focus-inspector">${esc(JSON.stringify(targetKind === "reconstruction" ? prep?.focus : focusMode === "operation" ? operation : focusMode === "semantic" ? semantic : ctx.focus, null, 2))}</pre></details><label>Separate approved Brand<select id="auxiliary-brand"><option value="">Off · exclude separate Brand and old context</option>${ctx.brands.map((b, i) => `<option value="${i}" ${String(i) === brand ? "selected" : ""}>${esc(b.label)} · v${b.ref.version}</option>`).join("")}</select></label><p>Source-visible styling remains visible. Legacy history, old semantic context and capsule contents are excluded.</p>${
          targetKind === "variation"
            ? `<details><summary>Explicitly requested Level 1 / Level 2 edit fields</summary>${requestFields
                .filter((c) => !c.unavailable)
                .map(
                  (c) =>
                    `<label><input type="checkbox" data-aux-field="level${c.level}:${esc(c.key)}" ${selectedFields.has("level" + c.level + ":" + c.key) ? "checked" : ""}>Level ${c.level} · ${esc(c.label)}</label>`,
                )
                .join("")}</details>`
            : ""
        }<details><summary>Deliberately included image references</summary>${(data?.references ?? []).map((m: any) => `<label><input type="checkbox" data-aux-reference="${esc(m.id)}" ${references.has(m.id) ? "checked" : ""}>${esc(m.payload.state.label)} · reference only · v${m.version}</label>`).join("") || "<p>No additional reference selected.</p>"}</details><details><summary>Exact supporting evidence</summary>${(data?.evidence ?? []).map((m: any) => `<label><input type="checkbox" data-aux-evidence="${esc(m.id)}" ${evidence.has(m.id) ? "checked" : ""}>${esc(m.payload.kind)} · ${esc(m.id)} · v${m.version}</label>`).join("") || "<p>No notes or dated capsule included.</p>"}</details>${data?.missingEvidence?.length ? `<p>Unavailable canonical evidence: ${data.missingEvidence.length}. No contents inferred.</p>` : ""}<button id="auxiliary-inspect">Inspect explicit input context · no turn</button><details id="auxiliary-context"><summary>Compiled explicit context</summary><pre id="auxiliary-context-value"></pre></details><label>Message<textarea id="auxiliary-message" rows="3" placeholder="Ask about this scope or suggest a draft edit">${esc(message)}</textarea></label><button id="auxiliary-send" ${busy || !data?.availability?.connected ? "disabled" : ""}>Send scoped offline message</button>${busy ? '<button id="auxiliary-cancel">Cancel this auxiliary turn</button>' : ""}<p>Every send freezes fresh scope; no project-wide thread or hidden history is resumed.</p><div class="auxiliary-history">${(
          data?.turns ?? []
        )
          .slice(-6)
          .map(
            (t: any) =>
              `<article><h3>Captured turn · ${esc(t.id)} · ${esc(t.payload.state.status)}</h3><p>${esc(t.payload.state.text)}</p><p>${esc(t.payload.state.reply)}</p><p>${esc(t.payload.state.detail)}</p><details><summary>Captured turn scope · current navigation stays authoritative</summary><pre>${esc(JSON.stringify((data.scopes ?? []).find((scope: any) => scope.id === t.payload.state.scope.id)?.payload.state ?? { unavailable: true }, null, 2))}</pre></details></article>`,
          )
          .join("")}</div><div id="auxiliary-proposals">${(
          data?.proposals ?? []
        )
          .slice(-8)
          .map((p: any) => {
            const staleTarget = (() => {
              try {
                return (
                  fingerprint(p.payload.state.target) !==
                  fingerprint(current().target)
                );
              } catch {
                return true;
              }
            })();
            const a = (data?.actions ?? []).find(
              (a: any) => a.payload.state.proposal.id === p.id,
            );
            return `<article class="auxiliary-proposal"><h3>Draft proposal · ${esc(p.id)}</h3><p>Captured ${esc(p.payload.state.target.kind)} · ${esc(p.payload.state.target.workUnit.id)} · revision ${p.payload.state.draft.revision}${p.payload.state.historical || staleTarget ? " · historical captured scope" : ""}</p><p>${esc(p.payload.state.rationale)}</p><table><thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead><tbody>${p.payload.state.edits.map((e: any) => `<tr><td>${esc(e.field)}</td><td>${esc(JSON.stringify(e.before))}</td><td>${esc(JSON.stringify(e.after))}</td></tr>`).join("")}</tbody></table><p>${esc(a?.payload.state.detail ?? "Awaiting explicit Apply or Dismiss")}</p><button data-aux-apply="${esc(p.id)}" ${a || p.payload.state.historical || staleTarget ? "disabled" : ""}>Apply to named draft</button><button data-aux-dismiss="${esc(p.id)}" ${a ? "disabled" : ""}>Dismiss</button></article>`;
          })
          .join(
            "",
          )}</div>${operation ? `<div class="auxiliary-bridge"><p>Separate operation-scoped reconstruction bridge · exact frozen request ${(operation as any).request.id}. This is an execution action, not a chat suggestion.</p><button id="auxiliary-bridge" ${busy || !data?.availability?.connected ? "disabled" : ""}>Execute frozen reconstruction · authored offline session</button>${(data?.bridges ?? []).some((b: any) => b.payload.state.request.id === (operation as any).request.id && b.payload.state.status === "running") ? `<button id="auxiliary-bridge-cancel">Cancel this operation bridge</button>` : ""}</div>` : ""}</section>`
      : ""
  }`;
  document.getElementById("auxiliary-toggle")!.onclick = () =>
    void (async () => {
      if (!opened) {
        opened = true;
        if (!session) {
          session = (await ctx!.post("auxiliary/open", {}, ctx!.pid)).session;
        }
        await queued(sync);
        await load();
        render();
        document.getElementById("auxiliary-message")?.focus();
      } else {
        await closePanel();
      }
    })().catch(error);
  if (!opened) return;
  const on = (name: string, fn: (e: Event) => void, event = "click") =>
    document.getElementById(name)?.addEventListener(event, fn);
  on(
    "auxiliary-message",
    (e) => {
      message = (e.target as HTMLTextAreaElement).value;
    },
    "input",
  );
  on(
    "auxiliary-target",
    (e) => {
      targetKind = (e.target as HTMLSelectElement).value;
      selectedFields.clear();
      render();
      auxiliaryDraftChanged();
    },
    "change",
  );
  on(
    "auxiliary-focus",
    (e) => {
      focusMode = (e.target as HTMLSelectElement).value;
      render();
      auxiliaryDraftChanged();
    },
    "change",
  );
  on(
    "auxiliary-brand",
    (e) => {
      brand = (e.target as HTMLSelectElement).value;
      auxiliaryDraftChanged();
    },
    "change",
  );
  for (const [attribute, set] of [
    ["auxField", selectedFields],
    ["auxReference", references],
    ["auxEvidence", evidence],
  ] as const)
    root
      .querySelectorAll<HTMLInputElement>(
        "[data-" +
          attribute.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()) +
          "]",
      )
      .forEach(
        (n) =>
          (n.onchange = () => {
            n.checked
              ? set.add(n.dataset[attribute]!)
              : set.delete(n.dataset[attribute]!);
            auxiliaryDraftChanged();
          }),
      );
  on(
    "auxiliary-inspect",
    () =>
      void (async () => {
        const context = await ctx!.post(
          "auxiliary/inspect",
          await inclusion(),
          ctx!.pid,
        );
        document.getElementById("auxiliary-context-value")!.textContent =
          JSON.stringify(context.context, null, 2);
        (
          document.getElementById("auxiliary-context") as HTMLDetailsElement
        ).open = true;
      })().catch(error),
  );
  on("auxiliary-send", () => void send().catch(error));
  on("auxiliary-cancel", () => void cancel().catch(error));
  root
    .querySelectorAll<HTMLButtonElement>("[data-aux-apply],[data-aux-dismiss]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          void apply(
            b.dataset["auxApply"] ?? b.dataset["auxDismiss"]!,
            !!b.dataset["auxApply"],
          ).catch(error)),
    );
  on("auxiliary-bridge", () => void bridge().catch(error));
  on("auxiliary-bridge-cancel", () => void cancelBridge().catch(error));
  root.onkeydown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      void closePanel().catch(error);
    }
  };
}
function error(e: any) {
  notice = e?.message ?? "Auxiliary action rejected";
  busy = false;
  render();
}
async function send() {
  if (!ctx || !message.trim()) throw Error("Write a deliberate scoped message");
  const c = ctx,
    text = message,
    sendingSession = session;
  const scope = await queued(async () => {
    const d = await sync(),
      policy = await inclusion();
    return c.post(
      "auxiliary/freeze",
      {
        ...policy,
        target: d.target,
        draft: d.token,
        editable:
          targetKind === "variation"
            ? ["intent", ...selectedFields]
            : ["instruction", "count", "viewports"],
        ttlMs: 300000,
        limits: {
          turns: 1,
          tools: 8,
          proposals: 4,
          timeoutMs: 30000,
          automaticRetry: false,
        },
      },
      c.pid,
    );
  });
  busy = true;
  notice = "Running authored offline auxiliary turn; no draft writes.";
  pending = { pid: c.pid, scope };
  render();
  const poll = setInterval(() => void load(), 150);
  try {
    const response = await c.post(
      "auxiliary/send",
      {
        scope: { id: scope.id, version: scope.version, freshness: "pinned" },
        text,
      },
      c.pid,
    );
    if (
      session === sendingSession &&
      ctx?.pid === c.pid &&
      key(ctx.unit) === key(c.unit)
    ) {
      notice =
        "Reply retained under its captured scope; no focus or draft was adopted.";
      message = "";
    }
    pending = response.record ?? pending;
  } finally {
    clearInterval(poll);
    busy = false;
    await load();
    render();
  }
}
async function cancel() {
  if (!pending || !ctx) return;
  await load();
  const running = (data?.turns ?? []).find(
    (t: any) =>
      t.payload.state.scope.id === pending.scope.id &&
      t.payload.state.status === "running",
  );
  if (!running) throw Error("No owned active auxiliary turn");
  await ctx.post(
    "auxiliary/cancel",
    {
      record: { id: running.id, version: running.version, freshness: "pinned" },
      reason: "Explicit user cancellation",
    },
    ctx.pid,
  );
  notice = "Cancellation saved; any delayed proposal remains historical.";
  await load();
}
async function apply(identity: string, wantsApply: boolean) {
  const c = ctx!,
    proposal = data.proposals.find((p: any) => p.id === identity);
  if (!proposal) throw Error("Exact proposal unavailable");
  await queued(async () => {
    const d = await sync(),
      before = current(),
      response = await c.post(
        "auxiliary/action",
        {
          proposal: {
            id: proposal.id,
            version: proposal.version,
            freshness: "pinned",
          },
          session: wantsApply ? session : proposal.payload.state.target.session,
          actionId: "action-" + crypto.randomUUID(),
          decision: wantsApply ? "apply" : "dismiss",
          expected: wantsApply ? d.token : proposal.payload.state.draft,
        },
        c.pid,
      );
    const a = response.action.payload.state;
    if (response.values && a.result) {
      drafts.set(before.stamp, {
        target: d.target,
        token: a.result,
        fingerprint: fingerprint(response.values),
        values: response.values,
      });
      if (
        ctx?.pid === c.pid &&
        key(ctx.unit) === key(c.unit) &&
        current().stamp === before.stamp &&
        current().fingerprint === before.fingerprint
      ) {
        if (targetKind === "variation")
          c.applyVariation(proposal.payload.state.edits);
        else c.preparation()!.apply(proposal.payload.state.edits);
      } else
        notice =
          "Newer UI draft/navigation wins; the old diff was not adopted.";
    }
    notice = a.detail;
    if (a.decision === "conflict") notice = "Conflict: " + a.detail;
  });
  await load();
  render();
}
async function cancelBridge() {
  await load();
  const focus = ctx!.operation() as Extract<
    Focus,
    { kind: "reconstruction" }
  > | null;
  const running = (data?.bridges ?? []).find(
    (b: any) =>
      b.payload.state.request.id === focus?.request.id &&
      b.payload.state.status === "running",
  );
  if (!running) throw Error("No owned active operation bridge");
  await ctx!.post(
    "auxiliary/cancel",
    {
      record: { id: running.id, version: running.version, freshness: "pinned" },
      reason: "Explicit operation bridge cancellation",
    },
    ctx!.pid,
  );
  notice = "Operation cancelled; delayed semantic delivery remains historical.";
  await load();
  render();
}
async function bridge() {
  const c = ctx!,
    focus = c.operation() as Extract<Focus, { kind: "reconstruction" }> | null;
  if (!focus) throw Error("Choose a frozen reconstruction operation");
  busy = true;
  notice =
    "Explicit offline bridge · fresh operation context, no conversation history.";
  render();
  const poll = setInterval(() => void load().then(render).catch(error), 100);
  try {
    await c.post(
      "auxiliary/bridge",
      { request: focus.request, integrity: focus.integrity, timeoutMs: 30000 },
      c.pid,
    );
    if (ctx?.pid === c.pid && key(ctx.unit) === key(c.unit))
      await c.bridgeDone(focus.request);
  } finally {
    clearInterval(poll);
    busy = false;
    await load();
    render();
  }
}
bindAuxiliaryReconstructionHook((phase) => {
  if (phase === "draft") {
    auxiliaryDraftChanged();
    return;
  }
  const node = element();
  if (phase === "before") document.body.append(node);
  else {
    if(targetKind === "reconstruction" && !ctx?.preparation()) targetKind = "variation";
    portal();
    render();
    if (opened && session && ctx) auxiliaryDraftChanged();
  }
});
