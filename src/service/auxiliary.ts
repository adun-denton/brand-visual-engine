import { reconstructionHeadsCurrent } from "../kernel/reconstruction-gate.ts";
import {
  auxiliaryToolSchemas,
  bridgeToolSchemas,
} from "./auxiliary-tool-schema.ts";
import { CanonicalMemory } from "../kernel/memory-index.ts";
import { randomUUID } from "node:crypto";
import type {
  NodePacket,
  DesignArtifact,
  VersionRef,
  Value,
} from "../kernel/contracts.ts";
import {
  packet,
  reference,
  revise,
  canonical,
  digest,
} from "../kernel/packets.ts";
import {
  scopeFacts,
  scopeBoundary,
  focusFacts,
  scopedEvidence,
} from "../kernel/auxiliary-context.ts";
import {
  parseScope,
  parseTurn,
  parseProposal,
  parseTarget,
  parseToken,
  draftValues,
  draftDigest,
  targetKey,
  auxiliaryTools,
  bridgeTools,
  parseFocus,
  fieldValue,
  provenance,
  type Scope,
  type Turn,
  type Proposal,
  type Action,
  type Bridge,
  type DraftTarget,
  type DraftToken,
  type DraftKind,
  type AuxiliaryKind,
} from "../modules/website/auxiliary-contracts.ts";
import { exactRef, hash } from "../modules/website/exploration-contracts.ts";
import {
  same,
  parseSubmission,
  type Work,
  type ReconstructionRequest,
} from "../modules/website/reconstruction-contracts.ts";
import { InputError, record, id, string, list, integer } from "./validation.ts";
import { exactImageInput } from "./session-inputs.ts";
import type { Workspace } from "./workspace.ts";
import type { Pages } from "./pages.ts";
import type { Reconstruction } from "./reconstruction.ts";
export interface OfflineAuxiliaryDriver {
  kind: "authored-test-fixture";
  run(input: {
    mode: "auxiliary" | "reconstruction";
    context: Record<string, unknown>;
    contextDigest: string;
    thread: { id: string; resume: false };
    images: {
      label: string;
      role: string;
      ref: VersionRef;
      input: ReturnType<typeof exactImageInput>;
    }[];
    text: string;
    history: { role: "user" | "assistant"; text: string }[];
    draft: null | {
      kind: DraftKind;
      values: Record<string, Value | null>;
      editable: string[];
    };
    request: Work<
      import("../modules/website/reconstruction-contracts.ts").ReconstructionRequest
    > | null;
    tools: readonly string[];
    toolSchemas: Record<string, unknown>;
    tool: (name: string, actionId: string, args: unknown) => Promise<unknown>;
    signal: AbortSignal;
  }): Promise<{
    reply: string;
    provenance: { kind: "authored-test-fixture"; generation: false };
  }>;
  close?(): Promise<void>;
}
export interface OfflineAuxiliaryInjection {
  testOnly: true;
  driver: OfflineAuxiliaryDriver;
}
type LiveDraft = {
  target: DraftTarget;
  token: DraftToken;
  values: Record<string, Value | null>;
};
type Job = {
  record: Work<Turn> | Work<Bridge>;
  abort: AbortController;
  promise: Promise<unknown>;
  timer: ReturnType<typeof setTimeout> | null;
  mode: "auxiliary" | "reconstruction";
  cancelled: boolean;
};
const authored = {
  kind: "authored-test-fixture" as const,
  generation: false as const,
};
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
export class Auxiliary {
  readonly w: Workspace;
  readonly pages: Pages;
  readonly reconstruction: Reconstruction;
  readonly injection: OfflineAuxiliaryInjection | undefined;
  private sessions = new Map<
    string,
    { active: DraftTarget | null; closed: boolean; scope: VersionRef | null }
  >();
  private drafts = new Map<string, LiveDraft>();
  private permits = new Map<string, string>();
  private jobs = new Map<string, Job>();
  private closing = false;
  constructor(
    w: Workspace,
    pages: Pages,
    reconstruction: Reconstruction,
    injection?: OfflineAuxiliaryInjection,
  ) {
    this.w = w;
    this.pages = pages;
    this.reconstruction = reconstruction;
    if (
      injection &&
      (injection.testOnly !== true ||
        injection.driver.kind !== "authored-test-fixture")
    )
      throw Error("Only injected authored auxiliary fixtures are available");
    this.injection = injection;
    w.kernel.bindAuxiliaryAuthority(
      (p) => this.permits.get(p.id) === p.integrity,
    );
  }
  availability() {
    return {
      connected: !!this.injection,
      label: this.injection
        ? "Authored offline auxiliary fixtures · no AI generation"
        : "Auxiliary execution unavailable · production visual transport disconnected",
    };
  }
  private make<T>(
    pid: string,
    kind: AuxiliaryKind,
    state: T,
    deps: VersionRef[],
    identity?: string,
  ): Work<T> {
    return packet({
      type: "work-record",
      id: identity ?? kind + "-" + randomUUID(),
      projectId: pid,
      payload: {
        moduleId: "website",
        kind,
        scope: "auxiliary",
        lockedValues: {},
        state,
      },
      dependencies: deps,
      provenance: {
        actor: "local-operator",
        source: "Explicit scoped auxiliary bookkeeping; authored fixture only",
        previous: null,
      },
    });
  }
  private commit = (packets: NodePacket<unknown>[], guard?: () => void) => {
    if (this.closing) throw new InputError("Auxiliary session is closing", 409);
    for (const p of packets)
      if ((p.payload as DesignArtifact<any>).kind?.startsWith("auxiliary-"))
        this.permits.set(p.id, p.integrity);
    try {
      this.w.kernel.putMany(packets, guard);
    } finally {
      for (const p of packets) this.permits.delete(p.id);
    }
  };
  private read<T>(pid: string, r: VersionRef, kind: AuxiliaryKind): Work<T> {
    this.w.project(pid);
    const p = this.w.kernel.get<DesignArtifact<T>>(exactRef(r));
    if (
      p.projectId !== pid ||
      p.type !== "work-record" ||
      p.payload.kind !== kind
    )
      throw new InputError("Auxiliary exact owner/type mismatch");
    return p;
  }
  private records(pid: string, kind: AuxiliaryKind) {
    this.w.project(pid);
    const order = new Map<string, number>();
    for (const event of this.w.kernel.ledger(pid).events)
      if (event.kind === "revision" && !order.has(event.subject.id))
        order.set(event.subject.id, event.sequence);
    return this.w.kernel
      .latestPackets()
      .filter(
        (p) =>
          p.projectId === pid &&
          (p.payload as DesignArtifact<any>).kind === kind,
      )
      .sort(
        (a, b) =>
          (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0) ||
          a.id.localeCompare(b.id),
      ) as Work<any>[];
  }
  /** Revision inventory is authority; surviving latest rows are only evidence. */
  private turnHistory(pid: string, scope: VersionRef): Work<Turn>[] {
    const rows = new CanonicalMemory(this.w.kernel.environment()).inventory(
      pid,
      false,
    );
    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const group = groups.get(row.ref.id) ?? [];
      group.push(row);
      groups.set(row.ref.id, group);
    }
    const unavailable = () => {
      throw new InputError(
        "Canonical turn history unavailable; no allowance or history inferred",
        409,
      );
    };
    const turns: Work<Turn>[] = [];
    for (const [identity, group] of groups) {
      const available = group.filter((row) => row.packet !== null);
      if (!available.length) unavailable(); // Kind and scope are unknown, not empty history.
      const evidence = available.map((row) => row.packet!);
      if (evidence.some((p) => p.projectId !== pid)) unavailable();
      const turnPackets = evidence.filter(
        (p) =>
          p.type === "work-record" &&
          (p.payload as DesignArtifact<any>).kind === "auxiliary-turn",
      ) as Work<Turn>[];
      if (!turnPackets.length) {
        // A missing unclassified version could have held execution evidence.
        if (available.length !== group.length) unavailable();
        continue;
      }
      if (turnPackets.length !== evidence.length) unavailable();
      const states = turnPackets.map((p) => parseTurn(p.payload.state));
      const bound = states[0]!;
      const binding = (t: Turn) => ({
        version: t.version,
        workUnit: t.workUnit,
        scope: t.scope,
        contextDigest: t.contextDigest,
        text: t.text,
        provenance: t.provenance,
      });
      if (states.some((t) => !equal(binding(t), binding(bound)))) unavailable();
      // This same identity's immutable binding can isolate known loss to its scope.
      if (!same(bound.scope, scope)) continue;
      const versions = group
        .map((row) => row.ref.version)
        .sort((a, b) => a - b);
      const head = versions.at(-1)!;
      if (
        available.length !== group.length ||
        versions.some((v, i) => v !== i + 1) ||
        this.w.kernel.currentVersion(identity) !== head
      )
        unavailable();
      turns.push(turnPackets.find((p) => p.version === head)!);
    }
    const order = new Map<string, number>();
    for (const event of this.w.kernel.ledger(pid).events)
      if (event.kind === "revision" && !order.has(event.subject.id))
        order.set(event.subject.id, event.sequence);
    return turns.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  }
  private bridgeAuthority(
    pid: string,
    request: Work<ReconstructionRequest>,
    deadline = Infinity,
  ) {
    if (this.closing) throw new InputError("Auxiliary session is closing", 409);
    if (Date.now() >= deadline)
      throw new InputError(
        "Bridge preparation timeout; no driver dispatch",
        409,
      );
    const exact = this.reconstruction.request(pid, reference(request));
    const control = this.reconstruction.state(
      pid,
      request.payload.state.workUnit,
    ).control;
    if (
      exact.integrity !== request.integrity ||
      this.w.kernel.currentVersion(request.id) !== request.version ||
      !control ||
      !same(control.payload.state.request, reference(request)) ||
      control.payload.state.status !== "pending" ||
      !reconstructionHeadsCurrent(
        this.w.kernel.environment(),
        request.payload.state,
      )
    )
      throw new InputError(
        "Operation superseded; frozen operation is not current/pending",
        409,
      );
  }
  state(pid: string, unit: VersionRef) {
    focusFacts(this.w.kernel.environment(), pid, {
      kind: "visual-page",
      unit,
      raster: null,
      region: null,
    });
    const heads = new Map<string, number>();
    for (const r of this.w.kernel.projectRefs(pid, 4096, false))
      heads.set(r.id, Math.max(heads.get(r.id) ?? 0, r.version));
    return {
      availability: this.availability(),
      scopes: this.records(pid, "auxiliary-scope").filter((p) =>
        same(p.payload.state.workUnit, unit),
      ),
      turns: this.records(pid, "auxiliary-turn")
        .filter((p) => same(p.payload.state.workUnit, unit))
        .map((p) => ({
          ...p,
          resumable: false,
          latestRecordedVersion: heads.get(p.id),
          latestVersionAvailable: heads.get(p.id) === p.version,
          interrupted:
            p.payload.state.status === "running" && !this.jobs.has(p.id),
        })),
      proposals: this.records(pid, "auxiliary-proposal").filter((p) =>
        same(p.payload.state.workUnit, unit),
      ),
      actions: this.records(pid, "auxiliary-action").filter((p) =>
        same(p.payload.state.workUnit, unit),
      ),
      bridges: this.records(pid, "auxiliary-bridge").filter((p) =>
        same(p.payload.state.workUnit, unit),
      ),
      draftRestoration: false,
      references: this.w.kernel
        .latestPackets()
        .filter(
          (p) =>
            p.projectId === pid && (p.payload as any).kind === "page-media",
        ),
      evidence: this.w.kernel
        .latestPackets()
        .filter(
          (p) =>
            p.projectId === pid &&
            ["project-handoff-note", "project-continuation-capsule"].includes(
              (p.payload as any).kind,
            ),
        ),
      missingEvidence: new CanonicalMemory(this.w.kernel.environment())
        .index(pid, unit)
        .entries.filter((e) => e.status !== "available")
        .map((e) => ({ ref: e.ref, status: e.status })),
    };
  }
  open() {
    if (this.closing) throw new InputError("Auxiliary is closing", 409);
    const session = "visual-session-" + randomUUID();
    this.sessions.set(session, { active: null, closed: false, scope: null });
    return { session, availability: this.availability() };
  }
  private live(session: string) {
    const s = this.sessions.get(id(session));
    if (!s || s.closed || this.closing)
      throw new InputError(
        "UI session unavailable; new explicit session required",
        409,
      );
    return s;
  }
  observe(pid: string, input: unknown) {
    const r = record(input, ["target", "expected", "values"]),
      target = parseTarget(r["target"]);
    if (target.projectId !== pid)
      throw new InputError("Draft project mismatch");
    const session = this.live(target.session);
    focusFacts(this.w.kernel.environment(), pid, {
      kind: "visual-page",
      unit: target.workUnit,
      raster: null,
      region: null,
    });
    const key = targetKey(target),
      prior = this.drafts.get(key),
      expected = r["expected"] === null ? null : parseToken(r["expected"]);
    if (!equal(prior?.token ?? null, expected))
      throw new InputError("Current draft revision changed; reload token", 409);
    const values = draftValues(target.kind, r["values"]),
      token = {
        id: prior?.token.id ?? "draft-" + randomUUID(),
        revision: (prior?.token.revision ?? 0) + 1,
        digest: draftDigest(target, values),
      };
    this.drafts.set(key, { target, token, values });
    session.active = target;
    return { target, token, values };
  }
  navigate(session: string, target: unknown) {
    const s = this.live(session);
    s.active = target === null ? null : parseTarget(target);
    if (s.active && s.active.session !== session)
      throw new InputError("Navigation session mismatch");
    return { active: s.active };
  }
  private currentDraft(target: DraftTarget, token: DraftToken) {
    const s = this.live(target.session),
      d = this.drafts.get(targetKey(target));
    if (!equal(s.active, target) || !d || !equal(d.token, token))
      throw new InputError(
        "Draft revision/navigation conflict; request a newly based proposal",
        409,
      );
    return d;
  }
  inspect(pid: string, input: unknown) {
    const r = record(input, [
      "project",
      "focus",
      "brand",
      "references",
      "evidence",
    ]);
    const partial = {
      project: exactRef(r["project"]),
      focus: parseFocus(r["focus"]),
      brand:
        r["brand"] === null
          ? null
          : {
              ref: exactRef(record(r["brand"], ["ref", "integrity"])["ref"]),
              integrity: hash((r["brand"] as any).integrity),
            },
      references: list(
        r["references"],
        (v) => {
          const p = record(v, ["ref", "integrity", "label"]);
          return {
            ref: exactRef(p["ref"]),
            integrity: hash(p["integrity"]),
            label: string(p["label"], 200),
          };
        },
        8,
      ),
      evidence: list(
        r["evidence"],
        (v) => {
          const e = record(v, ["ref", "integrity"]);
          return { ref: exactRef(e["ref"]), integrity: hash(e["integrity"]) };
        },
        8,
      ),
    };
    return {
      ...partial,
      ...scopeFacts(this.w.kernel.environment(), pid, partial),
    };
  }
  freeze(pid: string, input: unknown) {
    const r = record(input, [
      "project",
      "focus",
      "brand",
      "references",
      "evidence",
      "target",
      "draft",
      "editable",
      "ttlMs",
      "limits",
    ]);
    const target = parseTarget(r["target"]),
      draft = parseToken(r["draft"]);
    const current = this.currentDraft(target, draft);
    const facts = this.inspect(pid, {
      project: r["project"],
      focus: r["focus"],
      brand: r["brand"],
      references: r["references"],
      evidence: r["evidence"],
    });
    if (target.projectId !== pid || !same(target.workUnit, facts.focus.unit))
      throw new InputError("Auxiliary focus/draft owner mismatch");
    const ttlMs = integer(r["ttlMs"], 300000);
    if (ttlMs < 50) throw new InputError("Scope expiry too short");
    const raw = {
      version: 1,
      session: target.session,
      workUnit: target.workUnit,
      project: facts.project,
      focus: facts.focus,
      brand: facts.brand,
      references: facts.references,
      evidence: facts.evidence,
      target,
      draft,
      editable: r["editable"],
      context: facts.context,
      contextDigest: facts.contextDigest,
      boundaryDigest: "a".repeat(64),
      expiresAt: Date.now() + ttlMs,
      limits: r["limits"],
    };
    raw.boundaryDigest = scopeBoundary(raw as any);
    const state = parseScope(raw);
    for (const field of state.editable)
      if (!Object.hasOwn(current.values, field))
        throw new InputError(
          "Editable field must be explicitly registered in this draft",
        );
    const scope = this.make(pid, "auxiliary-scope", state, facts.refs);
    this.commit([scope], () => {
      this.currentDraft(target, draft);
      if (this.w.kernel.currentVersion(pid) !== state.project.version)
        throw new InputError("Project changed before scope freeze", 409);
    });
    this.live(target.session).scope = reference(scope);
    return scope;
  }
  private currentScope(s: Scope, ref: VersionRef) {
    const live = this.live(s.session);
    if (!same(live.scope, ref))
      throw new InputError(
        "Scope superseded; fresh explicit context required",
        409,
      );
    return this.currentDraft(s.target, s.draft);
  }
  async images(facts: ReturnType<typeof scopeFacts>) {
    return facts.images.map((image) => {
      const bytes = this.w.assets.read(image.image.id);
      if (!this.w.assets.facts(image.image))
        throw new InputError("Exact input image bytes unavailable");
      return {
        label: image.label,
        role: image.role,
        ref: image.ref,
        input: exactImageInput(bytes, image.image.format),
      };
    });
  }
  private running(job: Job, scope?: Scope) {
    if (
      job.cancelled ||
      job.abort.signal.aborted ||
      this.closing ||
      (scope && Date.now() >= scope.expiresAt)
    )
      throw new InputError(
        "Scope cancelled/expired; no further tool rounds",
        409,
      );
    if (scope)
      this.currentScope(scope, (job.record.payload.state as Turn).scope);
    if (job.mode === "reconstruction") {
      const b = job.record.payload.state as Bridge,
        q = this.reconstruction.request(job.record.projectId!, b.request),
        control = this.reconstruction.state(
          job.record.projectId!,
          b.workUnit,
        ).control;
      if (
        !control ||
        !same(control.payload.state.request, b.request) ||
        control.payload.state.status !== "pending" ||
        !reconstructionHeadsCurrent(
          this.w.kernel.environment(),
          q.payload.state,
        )
      )
        throw new InputError(
          "Operation superseded; no further tool rounds",
          409,
        );
    }
  }
  private tools(
    pid: string,
    job: Job,
    s: Scope | null,
    context: Record<string, unknown>,
    draft: LiveDraft | null,
    turn: Work<Turn> | null,
    request: Work<any> | null,
  ) {
    const receipts: Turn["tools"] = [],
      cache = new Map<string, { hash: string; value: unknown }>(),
      proposals: Work<Proposal>[] = [],
      allowed = job.mode === "auxiliary" ? auxiliaryTools : bridgeTools;
    let submission: unknown = null;
    let invalid: Error | null = null;
    const tool = async (name: string, actionId: string, args: unknown) => {
      this.running(job, s ?? undefined);
      try {
        if (!(allowed as readonly string[]).includes(name))
          throw new InputError(
            "Unsupported visual auxiliary runtime tool: " + name,
            403,
          );
        id(actionId);
        const inputHash = digest({ name, args }),
          old = cache.get(actionId);
        if (old) {
          if (old.hash !== inputHash)
            throw new InputError("Conflicting tool action reuse", 409);
          return structuredClone(old.value);
        }
        if (receipts.length >= (s?.limits.tools ?? 8))
          throw new InputError("Tool-round bound reached", 409);
        let value: unknown;
        if (name === "read_scope") {
          record(args, []);
          value = context;
        } else if (name === "read_evidence") {
          const r = record(args, ["ref", "integrity"]),
            ref = exactRef(r["ref"]),
            integrity = hash(r["integrity"]);
          const authorized = (
            s?.evidence ??
            request?.payload.state.evidence ??
            []
          ).some((e: any) => same(e.ref, ref) && e.integrity === integrity);
          if (!authorized)
            throw new InputError(
              "Evidence was not authorized by this exact scope",
              403,
            );
          value = scopedEvidence(
            this.w.kernel.environment(),
            pid,
            ref,
            integrity,
          );
        } else if (name === "recommend_prepare") {
          const r = record(args, ["text"]);
          value = {
            recommendation: string(r["text"], 2000),
            prepared: false,
            executed: false,
          };
        } else if (name === "propose_edit") {
          if (!s || !draft || !turn) throw Error("Draft unavailable");
          const r = record(args, ["edits", "rationale"]);
          if (proposals.length >= s.limits.proposals)
            throw new InputError("Proposal bound reached");
          const edits = list(
            r["edits"],
            (v) => {
              const e = record(v, ["field", "after"]),
                field = string(e["field"], 100);
              if (
                !s.editable.includes(field) ||
                !Object.hasOwn(draft.values, field)
              )
                throw new InputError(
                  "Field not explicitly requested by this scope",
                );
              return {
                field,
                before: draft.values[field] ?? null,
                after: fieldValue(draft.target.kind, field, e["after"])!,
              };
            },
            16,
          );
          const state = parseProposal({
            version: 1,
            workUnit: s.workUnit,
            scope: reference(
              this.read(pid, turn.payload.state.scope, "auxiliary-scope"),
            ),
            turn: reference(turn),
            contextDigest: s.contextDigest,
            target: s.target,
            draft: s.draft,
            edits,
            rationale: r["rationale"],
            historical: false,
            provenance: authored,
          });
          const p = this.make(pid, "auxiliary-proposal", state, [
            s.workUnit,
            turn.payload.state.scope,
            reference(turn),
          ]);
          proposals.push(p);
          value = {
            proposal: reference(p),
            edits: state.edits,
            applied: false,
          };
        } else {
          const r = record(args, ["response"]);
          if (submission)
            throw new InputError("One semantic submission per operation");
          submission = parseSubmission(r["response"]);
          value = { staged: true, committed: false };
        }
        receipts.push({ name, actionId, inputHash, resultHash: digest(value) });
        cache.set(actionId, { hash: inputHash, value: structuredClone(value) });
        return structuredClone(value);
      } catch (e) {
        invalid = e instanceof Error ? e : new Error(String(e));
        throw e;
      }
    };
    return {
      tool,
      receipts,
      proposals,
      get submission() {
        return submission;
      },
      get invalid() {
        return invalid;
      },
    };
  }
  send(pid: string, input: unknown) {
    if (!this.injection)
      throw new InputError(
        "Auxiliary execution unavailable; no visual production transport",
        403,
      );
    const r = record(input, ["scope", "text"]),
      scope = this.read<Scope>(pid, exactRef(r["scope"]), "auxiliary-scope"),
      s = parseScope(scope.payload.state),
      draft = this.currentScope(s, reference(scope));
    if (Date.now() >= s.expiresAt) throw new InputError("Scope expired", 409);
    const existing = this.turnHistory(pid, reference(scope));
    if (
      existing.length >= s.limits.turns ||
      existing.some((t) => t.payload.state.status !== "completed")
    )
      throw new InputError(
        "Fresh scope required; cancelled/unfinished/used bound cannot authorize continuation",
        409,
      );
    const facts = scopeFacts(this.w.kernel.environment(), pid, s);
    if (!equal(facts.context, s.context))
      throw new InputError("Captured context changed; new scope required", 409);
    const turn = this.make<Turn>(
      pid,
      "auxiliary-turn",
      {
        version: 1,
        workUnit: s.workUnit,
        scope: reference(scope),
        text: string(r["text"], 8000),
        status: "running",
        reply: "",
        detail: "Explicit authored offline turn; proposals only",
        contextDigest: s.contextDigest,
        tools: [],
        proposals: [],
        provenance: authored,
      },
      [s.workUnit, reference(scope)],
    );
    this.commit([turn], () => {
      this.currentScope(s, reference(scope));
      if (
        Date.now() >= s.expiresAt ||
        !equal(this.turnHistory(pid, reference(scope)), existing)
      )
        throw new InputError(
          "Canonical turn admission changed; fresh scope required",
          409,
        );
    });
    const abort = new AbortController(),
      job: Job = {
        record: turn,
        abort,
        promise: Promise.resolve(),
        timer: null,
        mode: "auxiliary",
        cancelled: false,
      };
    this.jobs.set(turn.id, job);
    const tools = this.tools(
      pid,
      job,
      s,
      s.context,
      structuredClone(draft),
      turn,
      null,
    );
    const history = existing
      .map((t) => [
        { role: "user" as const, text: t.payload.state.text },
        { role: "assistant" as const, text: t.payload.state.reply },
      ])
      .flat();
    job.timer = setTimeout(() => {
      try {
        this.cancel(
          pid,
          { record: reference(turn), reason: "Declared turn timeout" },
          "expired",
        );
      } catch (e) {
        if (this.jobs.has(turn.id)) throw e;
      }
    }, s.limits.timeoutMs);
    job.promise = (async () => {
      try {
        const images = await this.images(facts);
        this.running(job, s);
        const admitted = this.turnHistory(pid, reference(scope));
        if (
          admitted.length !== existing.length + 1 ||
          !admitted.some((t) => same(reference(t), reference(turn))) ||
          !equal(
            admitted.filter((t) => t.id !== turn.id),
            existing,
          )
        )
          throw new InputError(
            "Canonical turn admission changed before dispatch",
            409,
          );
        const output = await this.injection!.driver.run({
          mode: "auxiliary",
          context: structuredClone(s.context),
          contextDigest: s.contextDigest,
          thread: { id: scope.id, resume: false },
          images,
          text: turn.payload.state.text,
          history,
          draft: {
            kind: draft.target.kind,
            values: Object.fromEntries(
              s.editable.map((field) => [
                field,
                structuredClone(draft.values[field] ?? null),
              ]),
            ),
            editable: s.editable,
          },
          request: null,
          tools: auxiliaryTools,
          toolSchemas: auxiliaryToolSchemas,
          tool: tools.tool,
          signal: abort.signal,
        });
        provenance(output.provenance);
        if (tools.invalid) throw tools.invalid;
        if (this.closing) return null;
        const current = this.w.kernel.get<DesignArtifact<Turn>>({
          id: turn.id,
          version: this.w.kernel.currentVersion(turn.id)!,
          freshness: "pinned",
        });
        let historical = job.cancelled || Date.now() >= s.expiresAt;
        try {
          this.currentScope(s, reference(scope));
        } catch {
          historical = true;
        }
        const proposals = tools.proposals.map((p) => {
          const { integrity: _, ...b } = p;
          return packet({
            ...b,
            payload: {
              ...p.payload,
              state: { ...p.payload.state, historical },
            },
          });
        });
        const next = revise(
          current,
          {
            ...current.payload,
            state: {
              ...current.payload.state,
              status: historical ? "historical" : "completed",
              reply: string(output.reply, 16000, true),
              detail: historical
                ? "Late/scoped history; no draft or focus adoption"
                : "Authored proposals ready for explicit user Apply",
              tools: tools.receipts,
              proposals: proposals.map((p) => reference(p)),
            },
          },
          "authored-test-fixture",
          "Bounded auxiliary turn outcome",
        );
        const { integrity: _, ...body } = next;
        const bound = packet({
          ...body,
          dependencies: [
            s.workUnit,
            reference(scope),
            ...proposals.map((p) => reference(p)),
          ],
        });
        this.commit([...proposals, bound]);
        return bound;
      } catch (e) {
        if (this.closing) return null;
        const v = this.w.kernel.currentVersion(turn.id)!,
          current = this.w.kernel.get<DesignArtifact<Turn>>({
            id: turn.id,
            version: v,
            freshness: "pinned",
          });
        if (current.payload.state.status === "running")
          this.commit([
            revise(
              current,
              {
                ...current.payload,
                state: {
                  ...current.payload.state,
                  status: "failed",
                  detail:
                    e instanceof Error ? e.message : "Offline turn failed",
                  reply: "",
                  tools: [],
                  proposals: [],
                },
              },
              "authored-test-fixture",
              "Turn rejected; no proposals or design writes",
            ),
          ]);
        throw e;
      } finally {
        if (job.timer) clearTimeout(job.timer);
        this.jobs.delete(turn.id);
      }
    })();
    void job.promise.catch(() => {});
    return { turn, completion: this.visibleCompletion(job) };
  }
  action(pid: string, input: unknown) {
    const r = record(input, [
        "proposal",
        "session",
        "actionId",
        "decision",
        "expected",
      ]),
      proposal = this.read<Proposal>(
        pid,
        exactRef(r["proposal"]),
        "auxiliary-proposal",
      ),
      p = parseProposal(proposal.payload.state),
      session = id(r["session"]),
      actionId = id(r["actionId"]),
      expected = parseToken(r["expected"]);
    if (
      session !== p.target.session ||
      !["apply", "dismiss"].includes(String(r["decision"]))
    )
      throw new InputError("Proposal action owner/decision mismatch");
    const inputHash = digest(r),
      identity = "auxiliary-action-" + session + "-" + actionId,
      old = this.w.kernel.lookup({
        id: identity,
        version: 1,
        freshness: "pinned",
      }) as Work<Action> | null;
    if (old) {
      if (old.payload.state.inputHash !== inputHash)
        throw new InputError("Conflicting apply/action identity", 409);
      return { action: old, replayed: true, values: null };
    }
    let decision: Action["decision"] =
        r["decision"] === "dismiss" ? "dismissed" : "applied",
      detail = "Explicit dismissal; no editable draft change",
      next: LiveDraft | null = null;
    if (decision === "applied") {
      try {
        const d = this.currentDraft(p.target, expected);
        const scope = this.read<Scope>(pid, p.scope, "auxiliary-scope");
        this.currentScope(scope.payload.state, p.scope);
        const version = this.w.kernel.currentVersion(p.turn.id),
          known = this.w.kernel
            .projectRefs(pid, 4096, false)
            .filter((r) => r.id === p.turn.id)
            .reduce((n, r) => Math.max(n, r.version), 0);
        const turn =
          version === null
            ? null
            : this.read<Turn>(
                pid,
                { id: p.turn.id, version, freshness: "pinned" },
                "auxiliary-turn",
              );
        if (
          version !== known ||
          turn?.payload.state.status !== "completed" ||
          !turn.payload.state.proposals.some((r) =>
            same(r, reference(proposal)),
          )
        )
          throw new InputError(
            "Completed turn evidence unavailable; no draft Apply inferred",
            409,
          );

        if (
          !equal(expected, p.draft) ||
          p.historical ||
          Date.now() >= scope.payload.state.expiresAt ||
          p.edits.some((e) => !equal(d.values[e.field] ?? null, e.before))
        )
          throw new InputError(
            "Proposal is stale/expired; newly based diff required",
            409,
          );
        const values = { ...d.values };
        for (const e of p.edits) values[e.field] = e.after;
        next = {
          target: d.target,
          values,
          token: {
            id: d.token.id,
            revision: d.token.revision + 1,
            digest: draftDigest(d.target, values),
          },
        };
        detail = "Explicit draft Apply only; no operation prepared/executed";
      } catch (e) {
        decision = "conflict";
        detail = e instanceof Error ? e.message : "Draft conflict";
      }
    }
    const action = this.make<Action>(
      pid,
      "auxiliary-action",
      {
        version: 1,
        workUnit: p.workUnit,
        proposal: reference(proposal),
        session,
        actionId,
        inputHash,
        decision,
        expected,
        result: next?.token ?? null,
        detail,
      },
      [p.workUnit, reference(proposal)],
      identity,
    );
    this.commit([action], () => {
      if (next) this.currentDraft(p.target, expected);
    });
    if (next) this.drafts.set(targetKey(p.target), next);
    return { action, replayed: false, values: next?.values ?? null };
  }
  cancel(
    pid: string,
    input: unknown,
    status: "cancelled" | "expired" = "cancelled",
  ) {
    const r = record(input, ["record", "reason"]),
      ref = exactRef(r["record"]),
      p = this.w.kernel.get<DesignArtifact<Turn | Bridge>>(ref);
    if (
      p.projectId !== pid ||
      !["auxiliary-turn", "auxiliary-bridge"].includes(p.payload.kind)
    )
      throw new InputError("Cancellation ownership mismatch");
    const job = this.jobs.get(p.id);
    if (!job)
      throw new InputError(
        "This cold/finished record has no resumable transport",
        409,
      );
    job.cancelled = true;
    const current = this.w.kernel.get<DesignArtifact<any>>({
      id: p.id,
      version: this.w.kernel.currentVersion(p.id)!,
      freshness: "pinned",
    });
    if (current.payload.state.status === "running")
      this.commit([
        revise(
          current,
          {
            ...current.payload,
            state: {
              ...current.payload.state,
              status,
              detail: string(r["reason"], 2000),
            },
          },
          "local-operator",
          "Explicit auxiliary cancellation/expiry",
        ),
      ]);
    job.abort.abort();
    if (job.mode === "reconstruction") {
      const q = current.payload.state.request,
        unit = current.payload.state.workUnit,
        control = this.reconstruction.state(pid, unit).control;
      if (
        control &&
        same(control.payload.state.request, q) &&
        control.payload.state.status === "pending"
      )
        this.reconstruction.cancel(pid, {
          request: q,
          expectedControl: reference(control),
          reason: "Explicit auxiliary bridge " + status,
        });
    }
    return { cancelled: true };
  }
  /** Pure exact operation inputs; no admission, dispatch or canonical writes. */
  async bridgeImages(request: Work<ReconstructionRequest>) {
    const q = request.payload.state;
    const source = this.w.assets.read(q.source.image.id);
    return [
      {
        label: "Exact whole reconstruction raster",
        role: "source",
        ref: q.source.media,
        input: exactImageInput(source, q.source.image.format),
      },
      ...q.resources.map((resource) => ({
        label: resource.label,
        role: resource.role,
        ref: resource.media,
        input: exactImageInput(
          this.w.assets.read(resource.state.image.id),
          resource.state.image.format,
        ),
      })),
    ];
  }
  async bridge(pid: string, input: unknown) {
    if (!this.injection)
      throw new InputError(
        "Operation-scoped visual session transport unavailable",
        403,
      );
    const r = record(input, ["request", "integrity", "timeoutMs"]),
      request = this.reconstruction.request(pid, exactRef(r["request"])),
      q = request.payload.state;
    if (request.integrity !== hash(r["integrity"]))
      throw new InputError("Bridge request hash mismatch");
    const identity = "auxiliary-bridge-" + request.id;
    const old = this.w.kernel.lookup({
      id: identity,
      version: 1,
      freshness: "pinned",
    });
    if (old)
      throw new InputError(
        "Operation already has a bridge attempt; explicit new request required",
        409,
      );
    const timeoutMs = integer(r["timeoutMs"], 60000);
    if (timeoutMs < 50) throw new InputError("Bridge timeout too short");
    const deadline = Date.now() + timeoutMs;
    this.bridgeAuthority(pid, request, deadline);
    const context = {
      mode: "reconstruction",
      request: q,
      grammar: await import(
        "../modules/website/reconstruction-schemas.ts"
      ).then((m) => m.reconstructionOutputSchema),
      policy: "Fresh frozen operation; no auxiliary/legacy history",
    };
    const images = await this.bridgeImages(request);
    const contextDigest = digest(context),
      bridge = this.make<Bridge>(
        pid,
        "auxiliary-bridge",
        {
          version: 1,
          workUnit: q.workUnit,
          request: reference(request),
          requestHash: request.integrity,
          contextDigest,
          status: "running",
          result: null,
          detail: "Explicit authored offline operation-scoped session attempt",
          tools: [],
          provenance: authored,
        },
        [q.workUnit, reference(request)],
        identity,
      );
    this.commit([bridge], () => {
      this.bridgeAuthority(pid, request, deadline);
      if (
        this.w.kernel
          .projectRefs(pid, 4096, false)
          .some((r) => r.id === identity) ||
        this.w.kernel.currentVersion(identity) !== null
      )
        throw new InputError(
          "Operation already has a bridge attempt; explicit new request required",
          409,
        );
    });
    const abort = new AbortController(),
      job: Job = {
        record: bridge,
        abort,
        promise: Promise.resolve(),
        timer: null,
        mode: "reconstruction",
        cancelled: false,
      };
    this.jobs.set(bridge.id, job);
    const tools = this.tools(pid, job, null, context, null, null, request);
    job.timer = setTimeout(
      () => {
        try {
          this.cancel(
            pid,
            { record: reference(bridge), reason: "Declared bridge timeout" },
            "expired",
          );
        } catch (e) {
          if (this.jobs.has(bridge.id)) throw e;
        }
      },
      Math.max(1, deadline - Date.now()),
    );
    job.promise = (async () => {
      try {
        this.running(job);
        this.bridgeAuthority(pid, request, deadline);
        const output = await this.injection!.driver.run({
          mode: "reconstruction",
          context: structuredClone(context),
          contextDigest,
          thread: { id: request.id, resume: false },
          images,
          text: q.instruction,
          history: [],
          draft: null,
          request: structuredClone(request),
          tools: bridgeTools,
          toolSchemas: bridgeToolSchemas,
          tool: tools.tool,
          signal: abort.signal,
        });
        provenance(output.provenance);
        if (tools.invalid) throw tools.invalid;
        if (this.closing) return null;
        if (!tools.submission)
          throw new InputError("Bridge did not submit a semantic response");
        const intake = this.reconstruction.offlineSessionIntake(
          true,
          "authored-test-fixture",
        );
        return await intake(
          pid,
          { request: reference(request), response: tools.submission },
          (result) => {
            const current = this.w.kernel.get<DesignArtifact<Bridge>>({
              id: bridge.id,
              version: this.w.kernel.currentVersion(bridge.id)!,
              freshness: "pinned",
            });
            const next = revise(
              current,
              {
                ...current.payload,
                state: {
                  ...current.payload.state,
                  status:
                    result.payload.state.outcome === "current"
                      ? "completed"
                      : "historical",
                  result: reference(result),
                  tools: tools.receipts,
                  detail:
                    "Authored session bridge intake; generation:false; explicit semantic review remains separate",
                },
              },
              "authored-test-fixture",
              "Atomic reconstruction result and bridge evidence",
            );
            const { integrity: _, ...body } = next;
            return [
              packet({
                ...body,
                dependencies: [
                  q.workUnit,
                  reference(request),
                  reference(result),
                ],
              }),
            ];
          },
          this.commit,
        );
      } catch (e) {
        if (this.closing) return null;
        const current = this.w.kernel.get<DesignArtifact<Bridge>>({
          id: bridge.id,
          version: this.w.kernel.currentVersion(bridge.id)!,
          freshness: "pinned",
        });
        if (current.payload.state.status === "running")
          this.commit([
            revise(
              current,
              {
                ...current.payload,
                state: {
                  ...current.payload.state,
                  status: "failed",
                  detail: e instanceof Error ? e.message : "Bridge rejected",
                },
              },
              "authored-test-fixture",
              "Bridge failed; no semantic result adoption",
            ),
          ]);
        throw e;
      } finally {
        if (job.timer) clearTimeout(job.timer);
        this.jobs.delete(bridge.id);
      }
    })();
    void job.promise.catch(() => {});
    return { bridge, completion: this.visibleCompletion(job) };
  }
  private visibleCompletion(job: Job) {
    return Promise.race([
      job.promise,
      new Promise((resolve) => {
        const done = () => {
          const p = this.w.kernel.lookup({
            id: job.record.id,
            version: this.w.kernel.currentVersion(job.record.id)!,
            freshness: "pinned",
          });
          resolve(p);
        };
        if (job.abort.signal.aborted) done();
        else job.abort.signal.addEventListener("abort", done, { once: true });
      }),
    ]);
  }
  async closeSession(session: string) {
    const s = this.live(session);
    for (const job of this.jobs.values())
      if (
        job.mode === "auxiliary" &&
        (job.record.payload.state as Turn).scope
      ) {
        const scope = this.read<Scope>(
          job.record.projectId!,
          (job.record.payload.state as Turn).scope,
          "auxiliary-scope",
        );
        if (scope.payload.state.session === session)
          this.cancel(job.record.projectId!, {
            record: reference(job.record),
            reason: "UI session closed",
          });
      }
    s.closed = true;
    s.active = null;
    for (const [key, d] of this.drafts)
      if (d.target.session === session) this.drafts.delete(key);
    return { closed: true, draftsRestored: false };
  }
  async close() {
    if (this.closing) return;
    for (const job of this.jobs.values()) {
      if (job.timer) clearTimeout(job.timer);
      job.cancelled = true;
      const current = this.w.kernel.get<DesignArtifact<any>>({
        id: job.record.id,
        version: this.w.kernel.currentVersion(job.record.id)!,
        freshness: "pinned",
      });
      if (current.payload.state.status === "running")
        this.commit([
          revise(
            current,
            {
              ...current.payload,
              state: {
                ...current.payload.state,
                status: "interrupted",
                detail:
                  "Service shutdown; no transport replay or draft restoration",
              },
            },
            "local-operator",
            "Offline interruption",
          ),
        ]);
      job.abort.abort();
    }
    this.closing = true;
    this.sessions.clear();
    this.drafts.clear();
    this.jobs.clear();
    await this.injection?.driver.close?.();
  }
}
