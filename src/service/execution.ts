import { randomUUID } from "node:crypto";
import type {
  DesignArtifact,
  NodePacket,
  VersionRef,
} from "../kernel/contracts.ts";
import {
  packet,
  revise,
  reference,
  digest,
  canonical,
} from "../kernel/packets.ts";
import { revalidatePacket, writePort } from "../kernel/gate.ts";
import { compileRequest } from "../kernel/execution-gate.ts";
import type {
  ExecutionRequest,
  Grant,
  Execution,
  ExecutionSlot,
  ExecutionReceipt,
  AdapterIdentity,
  Call,
  ExecutionKind,
} from "../modules/website/execution-contracts.ts";
import {
  parseExecution,
  adapter,
  zeroBound,
} from "../modules/website/execution-contracts.ts";
import type {
  Specification,
  RasterConcept,
  Membership,
} from "../modules/website/exploration-contracts.ts";
import { exactRef } from "../modules/website/exploration-contracts.ts";
import { decode } from "./assets.ts";
import type { Workspace } from "./workspace.ts";
import { Exploration } from "./exploration.ts";
import {
  record,
  id,
  string,
  list,
  integer,
  choice,
  InputError,
} from "./validation.ts";
type Work<T> = NodePacket<DesignArtifact<T>>;
export interface ExecutionCapabilities {
  version: 1;
  adapter: AdapterIdentity;
  operations: Specification["operation"][];
  maxWidth: number;
  maxHeight: number;
  maxPixels: number;
  sourceInfluence: ("style" | "content" | "region")[];
  preservation: never[];
}
export interface OwnedJob {
  submissionId: string;
  jobId: string | null;
}
export interface RasterResult {
  receiptId: string;
  requestHash: string;
  specHash: string;
  slot: number;
  submissionId: string;
  jobId: string;
  outcome: "succeeded" | "failed";
  bytes: Buffer | null;
  observed: Record<string, unknown>;
  message: string;
}
export interface ExecutionTransport {
  capabilities: ExecutionCapabilities;
  submit(
    input: {
      request: ExecutionRequest;
      requestHash: string;
      slot: number;
      submissionId: string;
      sources: Buffer[];
    },
    signal: AbortSignal,
  ): Promise<{ jobId: string; result?: RasterResult }>;
  status(
    job: OwnedJob,
    signal: AbortSignal,
  ): Promise<{
    state: "running" | "cancelled" | "unknown" | "returned";
    jobId: string | null;
    result?: RasterResult;
  }>;
  cancel(
    job: OwnedJob & { jobId: string },
    signal: AbortSignal,
  ): Promise<{ confirmed: boolean }>;
}
/** Only programmatic test injection is enabled in this slice. No URL/env/browser selection exists. */
export interface OfflineExecutionInjection {
  testOnly: true;
  transport: ExecutionTransport;
}
interface DeliveryContext {
  execution: VersionRef;
  project: string;
  slot: number;
  kind: Call["kind"];
  sequence: number;
}
interface DeliveryError {
  sequence: number;
  slot: number;
  kind: Call["kind"];
  stage: "received-intake" | "transport-rejection";
  message: string;
  retry: (() => Promise<void>) | null;
}
class ExecutionTimeout extends Error {}
export class Executions {
  readonly w: Workspace;
  readonly exploration: Exploration;
  private injection: OfflineExecutionInjection | undefined;
  private active = new Set<string>();
  private closed = false;
  private controllers = new Set<AbortController>();
  private completions = new Set<Promise<void>>();
  private receiving = new Set<Promise<void>>();
  private foreground = new Set<Promise<unknown>>();
  private track<T>(promise: Promise<T>): Promise<T> {
    this.foreground.add(promise);
    void promise.then(
      () => this.foreground.delete(promise),
      () => this.foreground.delete(promise),
    );
    return promise;
  }
  private pendingDeliveries = new Map<string, DeliveryContext>();
  private deliveryErrors = new Map<string, DeliveryError>();
  private deliveryKey(c: DeliveryContext) {
    return c.execution.id + ":" + c.sequence;
  }
  private context(
    pid: string,
    p: Work<Execution>,
    slot: number,
  ): DeliveryContext {
    const call = p.payload.state.calls.at(-1)!;
    return {
      execution: reference(p),
      project: pid,
      slot,
      kind: call.kind,
      sequence: call.sequence,
    };
  }
  private async received(
    c: DeliveryContext,
    handle: (historical: boolean) => Promise<void>,
    historical: boolean,
  ) {
    const key = this.deliveryKey(c);
    try {
      await handle(historical);
      this.deliveryErrors.delete(key);
    } catch (error) {
      this.deliveryErrors.set(key, {
        sequence: c.sequence,
        slot: c.slot,
        kind: c.kind,
        stage: "received-intake",
        message:
          error instanceof Error
            ? error.message.slice(0, 1000)
            : "Received evidence could not be committed",
        retry: () => this.received(c, handle, true),
      });
      throw error;
    }
  }
  private async retryReceived(
    pid: string,
    execution: VersionRef,
    sequence: number,
  ) {
    const p = this.latest<Execution>(pid, execution, "raster-execution"),
      key = p.id + ":" + sequence;
    const error = this.deliveryErrors.get(key);
    if (!error?.retry)
      throw new InputError(
        "No received response remains available in this process",
      );
    await error.retry();
    return this.latest<Execution>(pid, execution, "raster-execution");
  }
  /** Test/host drain for responses already awaited in this process, never a transport query. */
  async waitForDeliveries() {
    while (this.completions.size) await Promise.all([...this.completions]);
  }
  async close() {
    while (this.foreground.size) await Promise.allSettled([...this.foreground]);
    this.closed = true;
    for (const controller of this.controllers) controller.abort();
    // Do not wait forever for an abort-ignoring transport. Drain only intake already in progress.
    while (this.receiving.size) await Promise.all([...this.receiving]);
    this.deliveryErrors.clear();
  }
  constructor(w: Workspace, injection?: OfflineExecutionInjection) {
    this.w = w;
    this.exploration = new Exploration(w);
    if (
      injection &&
      (injection.testOnly !== true ||
        adapter(injection.transport.capabilities.adapter).mode !==
          "offline-test")
    )
      throw new InputError(
        "Only explicitly offline test execution is supported",
      );
    this.injection = injection;
  }
  availability() {
    return this.injection
      ? {
          connected: true,
          mode: "offline-test",
          label: "Offline fixture executor · synthetic interaction only",
          adapter: this.injection.transport.capabilities.adapter,
        }
      : {
          connected: false,
          mode: "unavailable",
          label:
            "No connected executor. Preparation does not authorize execution.",
          adapter: null,
        };
  }
  private own<T>(pid: string, r: VersionRef, kind: ExecutionKind): Work<T> {
    exactRef(r);
    this.w.project(pid);
    const p = this.w.kernel.get<DesignArtifact<T>>(r);
    if (
      p.projectId !== pid ||
      p.type !== "work-record" ||
      p.payload.kind !== kind
    )
      throw new InputError("Foreign execution reference");
    revalidatePacket(p, writePort(p.type), this.w.kernel.environment());
    return p;
  }
  private latest<T>(pid: string, r: VersionRef, kind: ExecutionKind): Work<T> {
    this.own(pid, r, kind);
    const version = this.w.kernel.currentVersion(r.id)!;
    return this.own(pid, { id: r.id, version, freshness: "pinned" }, kind);
  }
  private make<T>(
    pid: string,
    kind: ExecutionKind,
    state: T,
    deps: VersionRef[],
    identity?: string,
  ): Work<T> {
    return packet({
      type: "work-record",
      id: identity ?? kind + "-" + randomUUID(),
      projectId: pid,
      dependencies: [
        ...new Map(deps.map((r) => [r.id + ":" + r.version, r])).values(),
      ],
      payload: {
        moduleId: "website",
        kind,
        scope: "page-execution",
        lockedValues: {},
        state,
      },
      provenance: {
        actor: "local-operator",
        source: "Explicit offline execution orchestration; no generation claim",
        previous: null,
      },
    });
  }
  private capability(r: ExecutionRequest) {
    const t = this.injection?.transport;
    if (!t) throw new InputError("No connected executor", 409);
    const c = t.capabilities;
    if (
      c.version !== 1 ||
      !c.operations.includes(r.operation) ||
      r.width > c.maxWidth ||
      r.height > c.maxHeight ||
      r.width * r.height > c.maxPixels
    )
      throw new InputError("Executor does not support operation or dimensions");
    if (r.sources.some((s) => s.entry?.preservation))
      throw new InputError(
        "Exact preservation execution is unsupported; no reservation made",
      );
    for (const s of r.sources)
      if (
        (s.style === "included" && !c.sourceInfluence.includes("style")) ||
        (s.content === "included" && !c.sourceInfluence.includes("content")) ||
        (s.entry &&
          s.entry.anchor.kind !== "whole" &&
          !c.sourceInfluence.includes("region"))
      )
        throw new InputError(
          "Executor does not support requested source influence",
        );
    return t;
  }
  async compile(
    pid: string,
    spec: VersionRef,
    width: number,
    height: number,
  ): Promise<Work<ExecutionRequest>> {
    const q = this.exploration.read<Specification>(
      pid,
      spec,
      "raster-specification",
    );
    const r = compileRequest(
      q,
      integer(width, 8192),
      integer(height, 8192),
      (x) => this.w.kernel.lookup(x),
    );
    parseExecution("raster-execution-request", r);
    this.capability(r);
    for (const s of r.sources)
      if (
        canonical(await decode(this.w.assets.read(s.image.id))) !==
        canonical(s.image)
      )
        throw new InputError("Execution input descriptor mismatch");
    this.exploration.read(pid, spec, "raster-specification");
    const p = this.make(pid, "raster-execution-request", r, [
      spec,
      ...r.sources.map((s) => s.media),
    ]);
    this.w.kernel.put(p);
    return p;
  }
  grant(pid: string, input: unknown): Work<Grant> {
    const r = record(input, [
      "request",
      "adapter",
      "slots",
      "maxSubmissions",
      "maxStatusCalls",
      "maxCancelCalls",
      "timeoutMs",
      "expiresAt",
      "reason",
    ]);
    const q = this.own<ExecutionRequest>(
      pid,
      exactRef(r["request"]),
      "raster-execution-request",
    );
    this.capability(q.payload.state);
    const identity = adapter(r["adapter"]);
    if (
      canonical(identity) !==
      canonical(this.injection!.transport.capabilities.adapter)
    )
      throw new InputError("Adapter binding changed");
    const g = parseExecution("raster-execution-grant", {
      version: 1,
      request: reference(q),
      requestHash: q.integrity,
      spec: q.payload.state.spec,
      specHash: q.payload.state.specHash,
      adapter: identity,
      slots: r["slots"],
      maxSubmissions: r["maxSubmissions"],
      maxStatusCalls: r["maxStatusCalls"],
      maxCancelCalls: r["maxCancelCalls"],
      timeoutMs: r["timeoutMs"],
      expiresAt: r["expiresAt"],
      revoked: false,
      reason: r["reason"],
    }) as Grant;
    if (Date.parse(g.expiresAt) <= Date.now())
      throw new InputError("Grant expired");
    const p = this.make(pid, "raster-execution-grant", g, [reference(q)]);
    this.w.kernel.put(p);
    return p;
  }
  revoke(pid: string, grant: VersionRef) {
    const p = this.latest<Grant>(pid, grant, "raster-execution-grant");
    if (p.payload.state.revoked) return p;
    const next = revise(
      p,
      { ...p.payload, state: { ...p.payload.state, revoked: true } },
      "local-operator",
      "Revoke execution grant; future dispatch blocked",
    );
    this.w.kernel.put(next);
    return next;
  }
  private authorize(pid: string, grant: VersionRef) {
    const g = this.latest<Grant>(pid, grant, "raster-execution-grant");
    if (
      g.payload.state.revoked ||
      Date.parse(g.payload.state.expiresAt) <= Date.now()
    )
      throw new InputError("Execution grant revoked or expired");
    if (
      canonical(g.payload.state.adapter) !==
      canonical(this.injection?.transport.capabilities.adapter)
    )
      throw new InputError("Executor binding unavailable or changed");
    const q = this.own<ExecutionRequest>(
      pid,
      g.payload.state.request,
      "raster-execution-request",
    );
    if (q.integrity !== g.payload.state.requestHash)
      throw new InputError("Grant request hash mismatch");
    this.capability(q.payload.state);
    return { g, q };
  }
  private deps(s: Execution) {
    return [
      s.request,
      s.grant,
      ...s.slots.flatMap((s) => (s.receipt ? [s.receipt] : [])),
      ...(s.retryOf ? [s.retryOf.execution] : []),
    ];
  }
  private change(p: Work<Execution>, s: Execution) {
    const n = revise(
      p,
      { ...p.payload, state: s },
      "local-operator",
      "Durable bounded execution transition",
    );
    const { integrity: _, ...b } = n;
    return packet({ ...b, dependencies: this.deps(s) });
  }
  private mutate(pid: string, r: VersionRef, fn: (s: Execution) => void) {
    const p = this.latest<Execution>(pid, r, "raster-execution"),
      s = structuredClone(p.payload.state);
    fn(s);
    if (canonical(s) === canonical(p.payload.state)) return p;
    const n = this.change(p, s);
    this.w.kernel.put(n);
    return n;
  }
  prepare(
    pid: string,
    grant: VersionRef,
    retryOf: Execution["retryOf"] = null,
  ): Work<Execution> {
    const { g, q } = this.authorize(pid, grant),
      identity = "raster-execution-" + digest(g.id);
    const old = this.w.kernel.lookup({
      id: identity,
      version: 1,
      freshness: "pinned",
    });
    if (old) {
      const p = this.latest<Execution>(pid, reference(old), "raster-execution");
      if (canonical(p.payload.state.retryOf) !== canonical(retryOf))
        throw new InputError("Grant already bound to different lineage", 409);
      return p;
    }
    const s: Execution = {
      version: 1,
      request: reference(q),
      requestHash: q.integrity,
      spec: g.payload.state.spec,
      specHash: g.payload.state.specHash,
      workUnit: q.payload.state.workUnit,
      grant: reference(g),
      adapter: g.payload.state.adapter,
      provenance: "offline-fixture",
      slots: g.payload.state.slots.map((slot) => ({
        slot,
        status: "pending",
        submissionId: null,
        jobId: null,
        cancelRequested: false,
        cancelConfirmed: false,
        receipt: null,
      })),
      calls: [],
      retryOf,
    };
    const p = this.make(pid, "raster-execution", s, this.deps(s), identity);
    this.w.kernel.put(p);
    return p;
  }
  private call(
    pid: string,
    execution: VersionRef,
    slot: number,
    kind: Call["kind"],
  ) {
    const p = this.latest<Execution>(pid, execution, "raster-execution"),
      { g, q } = this.authorize(pid, p.payload.state.grant),
      s = structuredClone(p.payload.state),
      a = s.slots.find((a) => a.slot === slot);
    if (!a) throw new InputError("Unowned slot");
    const limit =
      kind === "submit"
        ? g.payload.state.maxSubmissions
        : kind === "status"
          ? g.payload.state.maxStatusCalls
          : g.payload.state.maxCancelCalls;
    if (s.calls.filter((c) => c.kind === kind).length >= limit)
      throw new InputError("Transport-call allowance exhausted");
    if (kind === "submit") {
      if (
        a.status !== "pending" ||
        a.cancelRequested ||
        s.slots.some(
          (x) =>
            x.slot !== slot &&
            ["reserved", "running", "uncertain"].includes(x.status) &&
            !x.receipt,
        )
      )
        throw new InputError("Serial slot unavailable");
      a.submissionId = digest({ execution: p.id, slot });
      a.status = "reserved";
    } else if (!a.submissionId || (kind === "cancel" && !a.jobId))
      throw new InputError(
        "No exact owned job/submission identity to reconcile",
      );
    s.calls.push({
      sequence: s.calls.length + 1,
      kind,
      slot,
      submissionId: a.submissionId!,
      jobId: a.jobId,
    });
    const n = this.change(p, s);
    this.w.kernel.put(n);
    return { p: n, a: structuredClone(a), q, g };
  }
  private async bounded<T>(
    ms: number,
    action: (signal: AbortSignal) => Promise<T>,
    context: DeliveryContext,
    onLate: (value: T) => Promise<void>,
  ): Promise<T> {
    if (this.closed) throw new InputError("Execution service is closed");
    const controller = new AbortController(),
      key = this.deliveryKey(context);
    this.controllers.add(controller);
    this.pendingDeliveries.set(key, context);
    let timedOut = false,
      timer: ReturnType<typeof setTimeout>;
    let resolve!: (value: T) => void, reject!: (error: unknown) => void;
    const foreground = new Promise<T>((a, b) => {
      resolve = a;
      reject = b;
    });
    timer = setTimeout(() => {
      timedOut = true;
      reject(new ExecutionTimeout("Transport timeout; outcome uncertain"));
      controller.abort();
    }, ms);
    const completion = Promise.resolve()
      .then(() => action(controller.signal))
      .then(
        async (value) => {
          clearTimeout(timer);
          if (!timedOut) {
            resolve(value);
            return;
          }
          if (this.closed) return;
          const intake = onLate(value).catch(() => {});
          this.receiving.add(intake);
          try {
            await intake;
          } finally {
            this.receiving.delete(intake);
          }
        },
        (error) => {
          clearTimeout(timer);
          if (!timedOut) reject(error);
          else if (!this.closed)
            this.deliveryErrors.set(key, {
              sequence: context.sequence,
              slot: context.slot,
              kind: context.kind,
              stage: "transport-rejection",
              message:
                error instanceof Error
                  ? error.message.slice(0, 1000)
                  : "Transport rejected after timeout; no response retained",
              retry: null,
            });
        },
      )
      .then(() => {
        this.controllers.delete(controller);
        this.pendingDeliveries.delete(key);
        this.completions.delete(completion);
      });
    this.completions.add(completion);
    return foreground;
  }
  private async acknowledgement(
    c: DeliveryContext,
    ack: { jobId: string; result?: RasterResult },
    historical: boolean,
  ) {
    record(ack, ["jobId", "result"]);
    id(ack.jobId);
    let p = this.latest<Execution>(c.project, c.execution, "raster-execution"),
      slot = p.payload.state.slots.find((s) => s.slot === c.slot)!;
    if (slot.jobId && slot.jobId !== ack.jobId)
      throw new InputError("Delivered acknowledgement changed owned job");
    if (
      ack.result &&
      (ack.result.slot !== c.slot ||
        ack.result.submissionId !== slot.submissionId ||
        ack.result.jobId !== ack.jobId ||
        ack.result.requestHash !== p.payload.state.requestHash ||
        ack.result.specHash !== p.payload.state.specHash)
    )
      throw new InputError("Delivered result does not match owned submission");
    if (historical) p = this.uncertain(c.project, p, c.slot);
    p = this.mutate(c.project, reference(p), (s) => {
      s.slots.find((s) => s.slot === c.slot)!.jobId = ack.jobId;
    });
    if (ack.result) await this.intake(c.project, reference(p), ack.result);
  }
  private async statusResponse(
    c: DeliveryContext,
    reply: Awaited<ReturnType<ExecutionTransport["status"]>>,
    historical: boolean,
  ) {
    record(reply, ["state", "jobId", "result"]);
    choice(reply.state, ["running", "cancelled", "unknown", "returned"]);
    if (reply.jobId !== null) id(reply.jobId);
    let p = this.latest<Execution>(c.project, c.execution, "raster-execution"),
      slot = p.payload.state.slots.find((s) => s.slot === c.slot)!;
    if (slot.jobId && reply.jobId !== slot.jobId)
      throw new InputError("Reconciliation changed owned job");
    if (reply.state === "returned") {
      if (!reply.result || !reply.jobId)
        throw new InputError("Returned status lacks owned receipt");
      await this.acknowledgement(
        c,
        { jobId: reply.jobId, result: reply.result },
        historical,
      );
      return;
    }
    if (historical) p = this.uncertain(c.project, p, c.slot);
    this.mutate(c.project, reference(p), (s) => {
      const a = s.slots.find((s) => s.slot === c.slot)!;
      if (reply.jobId) a.jobId = reply.jobId;
      if (reply.state === "cancelled") {
        if (a.cancelRequested) a.cancelConfirmed = true;
        if (!a.receipt) a.status = "cancelled";
      } else if (reply.state === "unknown" && !a.receipt)
        a.status = "uncertain";
    });
  }
  private async cancelResponse(
    c: DeliveryContext,
    jobId: string,
    reply: { confirmed: boolean },
  ) {
    record(reply, ["confirmed"]);
    if (typeof reply.confirmed !== "boolean")
      throw new InputError("Invalid cancellation response");
    const p = this.latest<Execution>(
      c.project,
      c.execution,
      "raster-execution",
    );
    if (p.payload.state.slots.find((s) => s.slot === c.slot)!.jobId !== jobId)
      throw new InputError("Cancellation changed owned job");
    if (reply.confirmed)
      this.mutate(c.project, reference(p), (s) => {
        const a = s.slots.find((s) => s.slot === c.slot)!;
        a.cancelConfirmed = true;
        if (!a.receipt) a.status = "cancelled";
      });
  }
  private uncertain(pid: string, p: Work<Execution>, slot: number) {
    return this.mutate(pid, reference(p), (s) => {
      const a = s.slots.find((a) => a.slot === slot)!;
      if (!a.receipt && a.status !== "cancelled") a.status = "uncertain";
    });
  }
  execute(pid: string, execution: VersionRef) {
    return this.track(this.dispatch(pid, execution));
  }
  reconcile(pid: string, execution: VersionRef, slot: number) {
    return this.track(this.reconcileWork(pid, execution, slot));
  }
  cancel(pid: string, execution: VersionRef, slot: number | null) {
    return this.track(this.cancelWork(pid, execution, slot));
  }
  retryDelivery(pid: string, execution: VersionRef, sequence: number) {
    return this.track(this.retryReceived(pid, execution, sequence));
  }
  private async dispatch(
    pid: string,
    execution: VersionRef,
  ): Promise<Work<Execution>> {
    if (this.closed) throw new InputError("Execution service is closed");
    let p = this.latest<Execution>(pid, execution, "raster-execution");
    if (this.active.has(p.id)) return p;
    this.active.add(p.id);
    try {
      for (const slot of p.payload.state.slots) {
        p = this.latest(pid, reference(p), "raster-execution");
        const a = p.payload.state.slots.find((a) => a.slot === slot.slot)!;
        if (
          ["reserved", "running", "uncertain"].includes(a.status) &&
          !a.receipt
        )
          break;
        if (a.status !== "pending") continue;
        const { g, q } = this.authorize(pid, p.payload.state.grant);
        const sources = q.payload.state.sources.map((s) =>
          this.w.assets.read(s.image.id),
        );
        for (let i = 0; i < sources.length; i++)
          if (
            canonical(await decode(sources[i]!)) !==
            canonical(q.payload.state.sources[i]!.image)
          )
            throw new InputError("Input closure changed");
        const reserved = this.call(pid, reference(p), a.slot, "submit");
        p = reserved.p;
        // Reserved alone is never permission for a restart to send. This live invocation alone owns it.
        p = this.mutate(pid, reference(p), (s) => {
          s.slots.find((s) => s.slot === a.slot)!.status = "running";
        });
        const delivery = this.context(pid, p, a.slot);
        let ack: { jobId: string; result?: RasterResult };
        try {
          ack = await this.bounded(
            g.payload.state.timeoutMs,
            (signal) =>
              this.injection!.transport.submit(
                {
                  request: structuredClone(q.payload.state),
                  requestHash: q.integrity,
                  slot: a.slot,
                  submissionId: reserved.a.submissionId!,
                  sources,
                },
                signal,
              ),
            delivery,
            (value) =>
              this.received(
                delivery,
                (historical) =>
                  this.acknowledgement(delivery, value, historical),
                true,
              ),
          );
        } catch {
          p = this.uncertain(pid, p, a.slot);
          break;
        }
        await this.received(
          delivery,
          (historical) => this.acknowledgement(delivery, ack, historical),
          false,
        );
        p = this.latest(pid, reference(p), "raster-execution");
        if (!p.payload.state.slots.find((s) => s.slot === a.slot)!.receipt)
          break;
      }
      return this.latest<Execution>(pid, reference(p), "raster-execution");
    } finally {
      this.active.delete(p.id);
    }
  }
  recover(pid: string, execution: VersionRef) {
    const p = this.latest<Execution>(pid, execution, "raster-execution");
    if (this.active.has(p.id))
      throw new InputError("Live dispatch still active", 409);
    return this.mutate(pid, reference(p), (s) => {
      for (const a of s.slots)
        if (["reserved", "running"].includes(a.status) && !a.receipt)
          a.status = "uncertain";
    });
  }
  private async reconcileWork(
    pid: string,
    execution: VersionRef,
    slot: number,
  ): Promise<Work<Execution>> {
    const current = this.latest<Execution>(pid, execution, "raster-execution");
    if (this.active.has(current.id))
      throw new InputError("Wait for live dispatch; no poll was sent", 409);
    const original = current.payload.state.slots.find((s) => s.slot === slot);
    if (
      !original ||
      original.receipt ||
      !["running", "reserved", "uncertain", "cancelled"].includes(
        original.status,
      )
    )
      throw new InputError("Slot does not need reconciliation");
    const { p, a, g } = this.call(pid, reference(current), slot, "status");
    const delivery = this.context(pid, p, slot);
    let reply: Awaited<ReturnType<ExecutionTransport["status"]>>;
    try {
      reply = await this.bounded(
        g.payload.state.timeoutMs,
        (signal) =>
          this.injection!.transport.status(
            { submissionId: a.submissionId!, jobId: a.jobId },
            signal,
          ),
        delivery,
        (value) =>
          this.received(
            delivery,
            (historical) => this.statusResponse(delivery, value, historical),
            true,
          ),
      );
    } catch {
      return this.uncertain(pid, p, slot);
    }
    await this.received(
      delivery,
      (historical) => this.statusResponse(delivery, reply, historical),
      false,
    );
    return this.latest<Execution>(pid, reference(p), "raster-execution");
  }
  private async cancelWork(
    pid: string,
    execution: VersionRef,
    slot: number | null,
  ): Promise<Work<Execution>> {
    let p = this.latest<Execution>(pid, execution, "raster-execution");
    if (slot !== null && !p.payload.state.slots.some((s) => s.slot === slot))
      throw new InputError("Unowned cancellation slot");
    p = this.mutate(pid, reference(p), (s) => {
      for (const a of s.slots)
        if ((slot === null || a.slot === slot) && !a.receipt) {
          a.cancelRequested = true;
          if (a.status === "pending") a.status = "cancelled";
          else if (a.status !== "cancelled") a.status = "uncertain";
        }
    });
    for (const a of p.payload.state.slots) {
      if (
        (slot !== null && a.slot !== slot) ||
        !a.cancelRequested ||
        !a.jobId ||
        a.cancelConfirmed ||
        a.receipt
      )
        continue;
      const call = this.call(pid, reference(p), a.slot, "cancel");
      const delivery = this.context(pid, call.p, a.slot);
      let reply: { confirmed: boolean };
      try {
        reply = await this.bounded(
          call.g.payload.state.timeoutMs,
          (signal) =>
            this.injection!.transport.cancel(
              { submissionId: a.submissionId!, jobId: a.jobId! },
              signal,
            ),
          delivery,
          (value) =>
            this.received(
              delivery,
              () => this.cancelResponse(delivery, a.jobId!, value),
              true,
            ),
        );
      } catch {
        continue;
      }
      await this.received(
        delivery,
        () => this.cancelResponse(delivery, a.jobId!, reply),
        false,
      );
    }
    return this.latest<Execution>(pid, reference(p), "raster-execution");
  }
  async intake(
    pid: string,
    execution: VersionRef,
    input: RasterResult,
  ): Promise<Work<ExecutionReceipt>> {
    // Transport envelope identity is trusted only after validation, independently of the raster body.
    const x = record(input, [
      "receiptId",
      "requestHash",
      "specHash",
      "slot",
      "submissionId",
      "jobId",
      "outcome",
      "bytes",
      "observed",
      "message",
    ]);
    id(x["receiptId"]);
    id(x["jobId"]);
    id(x["submissionId"]);
    integer(x["slot"], 6);
    choice(x["outcome"], ["succeeded", "failed"]);
    string(x["message"]);
    const observed = record(
      x["observed"],
      Object.keys(x["observed"] as object),
    );
    if (canonical(observed).length > 12000)
      throw new InputError("Observation exceeds bound");
    if (input.bytes !== null && !Buffer.isBuffer(input.bytes))
      throw new InputError("Result must contain raster bytes");
    if (input.outcome === "failed" && input.bytes !== null)
      throw new InputError("Failure cannot contain output bytes");
    const payloadHash = digest({
      ...input,
      bytes: input.bytes
        ? {
            checksum: digest(input.bytes.toString("base64")),
            length: input.bytes.length,
          }
        : null,
    });
    const identity =
      "raster-execution-receipt-" +
      digest({ execution: execution.id, receiptId: input.receiptId });
    const duplicate = () => {
      const d = this.w.kernel.lookup({
        id: identity,
        version: 1,
        freshness: "pinned",
      }) as Work<ExecutionReceipt> | null;
      if (!d) return null;
      if (d.projectId !== pid || d.payload.state.payloadHash !== payloadHash)
        throw new InputError("Conflicting result receipt identity", 409);
      return this.own<ExecutionReceipt>(
        pid,
        reference(d),
        "raster-execution-receipt",
      );
    };
    const prior = duplicate();
    if (prior) return prior;
    let p = this.latest<Execution>(pid, execution, "raster-execution");
    const a = p.payload.state.slots.find((s) => s.slot === input.slot);
    if (
      !a ||
      a.receipt ||
      a.submissionId !== input.submissionId ||
      a.jobId !== input.jobId ||
      p.payload.state.requestHash !== input.requestHash ||
      p.payload.state.specHash !== input.specHash
    )
      throw new InputError("Unbound or consumed execution result");
    const q = this.own<ExecutionRequest>(
      pid,
      p.payload.state.request,
      "raster-execution-request",
    );
    let image: Awaited<ReturnType<typeof decode>> | null = null,
      invalid = false;
    if (input.outcome === "succeeded") {
      try {
        if (!input.bytes) throw new InputError("Missing raster");
        image = await decode(input.bytes);
        if (
          image.width !== q.payload.state.width ||
          image.height !== q.payload.state.height
        )
          throw new InputError("Unexpected output dimensions");
      } catch (error) {
        if (!(error instanceof InputError)) throw error;
        image = null;
        invalid = true;
      }
    }
    const replay = duplicate();
    if (replay) return replay;
    p = this.latest(pid, reference(p), "raster-execution");
    const current = p.payload.state.slots.find((s) => s.slot === input.slot)!;
    if (current.receipt) throw new InputError("Slot already consumed", 409);
    const spec = this.exploration.read<Specification>(
      pid,
      p.payload.state.spec,
      "raster-specification",
    ).payload.state;
    const late =
      current.cancelRequested ||
      ["uncertain", "cancelled"].includes(current.status) ||
      this.w.kernel.currentVersion(spec.project.id) !== spec.project.version ||
      (spec.selections !== null &&
        this.w.kernel.currentVersion(spec.selections.id) !==
          spec.selections.version) ||
      this.w.kernel
        .ledger(pid)
        .events.some(
          (e) =>
            e.kind === "acceptance" &&
            e.sequence >
              (this.w.kernel
                .ledger(pid)
                .events.find((x) => x.subject.id === q.id)?.sequence ?? 0),
        );
    const outcome: ExecutionReceipt["outcome"] = late
      ? "historical"
      : invalid
        ? "invalid"
        : input.outcome;
    const writes: NodePacket<unknown>[] = [];
    let media: NodePacket<DesignArtifact<unknown>> | null = null,
      candidate: Work<RasterConcept> | null = null;
    if (image) {
      media = packet({
        type: "media-asset",
        id: "page-media-" + randomUUID(),
        projectId: pid,
        assets: [{ id: image.id, checksum: image.checksum }],
        payload: {
          moduleId: "website",
          kind: "page-media",
          scope: "media",
          lockedValues: {},
          state: {
            image,
            label: "Offline fixture result · not generated",
            role: late ? "reference" : "placeable",
            permission: "Authored synthetic fixture; testing only",
          },
        },
      });
      writes.push(media);
      if (!late) {
        candidate = packet({
          type: "design-artifact",
          id: "raster-concept-" + randomUUID(),
          projectId: pid,
          dependencies: [reference(media)],
          assets: [{ id: image.id, checksum: image.checksum }],
          payload: {
            moduleId: "website",
            kind: "raster-concept",
            scope: "page-exploration",
            lockedValues: {},
            state: {
              version: 1,
              representation: "raster-v1",
              media: reference(media),
              image,
              orientation: "encoded-top-left",
              origin: "synthetic",
            },
          },
        });
        const membership: Work<Membership> = packet({
          type: "work-record",
          id: "raster-membership-" + randomUUID(),
          projectId: pid,
          dependencies: [p.payload.state.workUnit, reference(candidate)],
          payload: {
            moduleId: "website",
            kind: "raster-membership",
            scope: "page-exploration",
            lockedValues: {},
            state: {
              version: 1,
              workUnit: p.payload.state.workUnit,
              candidate: reference(candidate),
              integrity: candidate.integrity,
              derivation: [],
            },
          },
        });
        writes.push(candidate, membership);
      }
      // Storage errors deliberately escape. They do not consume the slot as malformed output.
      this.w.assets.save(input.bytes!, image);
    }
    const state: ExecutionReceipt = {
      version: 1,
      receiptId: input.receiptId,
      execution: reference(p),
      requestHash: p.payload.state.requestHash,
      specHash: p.payload.state.specHash,
      slot: input.slot,
      submissionId: input.submissionId,
      jobId: input.jobId,
      payloadHash,
      outcome,
      candidate: candidate ? reference(candidate) : null,
      media: media ? reference(media) : null,
      image,
      observed: structuredClone(observed),
      message: invalid
        ? "Raster rejected during full validation"
        : input.message,
      provenance: "offline-fixture",
    };
    const receipt = this.make(
      pid,
      "raster-execution-receipt",
      state,
      [
        reference(p),
        p.payload.state.request,
        ...(candidate ? [reference(candidate)] : []),
        ...(media ? [reference(media)] : []),
      ],
      identity,
    );
    const s = structuredClone(p.payload.state),
      slot = s.slots.find((s) => s.slot === input.slot)!;
    slot.receipt = reference(receipt);
    if (!late) slot.status = outcome as ExecutionSlot["status"];
    else if (slot.status !== "cancelled") slot.status = "uncertain";
    this.w.kernel.putMany([...writes, receipt, this.change(p, s)]);
    return receipt;
  }
  state(pid: string, unit: VersionRef) {
    this.exploration.read(pid, unit, "page-work-unit");
    const records = this.w.kernel.latestPackets().filter(
      (p) =>
        p.projectId === pid &&
        Object.hasOwn(
          {
            "raster-execution-request": 1,
            "raster-execution-grant": 1,
            "raster-execution": 1,
            "raster-execution-receipt": 1,
          },
          (p.payload as DesignArtifact<unknown>).kind,
        ),
    );
    const sequence = new Map(
      this.w.kernel
        .ledger(pid)
        .events.filter((e) => e.kind === "revision")
        .toReversed()
        .map((e) => [e.subject.id, e.sequence]),
    );
    return records
      .sort((a, b) => (sequence.get(a.id) ?? 0) - (sequence.get(b.id) ?? 0))
      .filter((p) => {
        const k = (p.payload as DesignArtifact<unknown>).kind as ExecutionKind;
        this.own(pid, reference(p), k);
        return (
          k === "raster-execution" &&
          canonical((p.payload as DesignArtifact<Execution>).state.workUnit) ===
            canonical(unit)
        );
      })
      .map((p) => {
        const run = p as Work<Execution>;
        const active = this.active.has(p.id);
        return {
          run,
          active,
          pendingDeliveries: [...this.pendingDeliveries.values()]
            .filter((c) => c.execution.id === run.id)
            .map((c) => ({ slot: c.slot, kind: c.kind, sequence: c.sequence })),
          deliveryErrors: [...this.deliveryErrors.entries()]
            .filter(([key]) => key.startsWith(run.id + ":"))
            .map(([, e]) => ({
              sequence: e.sequence,
              slot: e.slot,
              kind: e.kind,
              stage: e.stage,
              message: e.message,
              retryable: e.retry !== null,
            })),
          outputs: run.payload.state.slots.flatMap((s) =>
            s.receipt
              ? [
                  this.own<ExecutionReceipt>(
                    pid,
                    s.receipt,
                    "raster-execution-receipt",
                  ).payload.state.candidate,
                ].filter((r): r is VersionRef => r !== null)
              : [],
          ),
          slots: run.payload.state.slots.map((s) => ({
            ...s,
            receiptSummary: s.receipt
              ? (() => {
                  const receipt = this.own<ExecutionReceipt>(
                    pid,
                    s.receipt!,
                    "raster-execution-receipt",
                  ).payload.state;
                  return {
                    outcome: receipt.outcome,
                    message: receipt.message,
                    hasMedia: receipt.media !== null,
                  };
                })()
              : null,
            displayStatus:
              !active && ["running", "reserved"].includes(s.status)
                ? "uncertain"
                : s.status,
          })),
          grant: this.latest<Grant>(
            pid,
            run.payload.state.grant,
            "raster-execution-grant",
          ),
          request: this.own<ExecutionRequest>(
            pid,
            run.payload.state.request,
            "raster-execution-request",
          ),
        };
      });
  }
  async command(pid: string, action: string, input: unknown) {
    const fields: Record<string, string[]> = {
      "compile-execution": ["spec", "width", "height"],
      "grant-execution": [
        "request",
        "adapter",
        "slots",
        "maxSubmissions",
        "maxStatusCalls",
        "maxCancelCalls",
        "timeoutMs",
        "expiresAt",
        "reason",
      ],
      "prepare-execution": ["grant", "retryOf"],
      execute: ["execution"],
      "retry-delivery": ["execution", "sequence"],
      "recover-execution": ["execution"],
      "reconcile-execution": ["execution", "slot"],
      "cancel-execution": ["execution", "slot"],
      "revoke-execution": ["grant"],
    };
    if (!fields[action]) throw new InputError("Not found", 404);
    const r = record(input, ["expectedProject", "unit", ...fields[action]!]);
    this.w.project(pid, exactRef(r["expectedProject"]));
    const unit = exactRef(r["unit"]);
    this.exploration.read(pid, unit, "page-work-unit");
    if (action === "compile-execution") {
      const q = this.exploration.read<Specification>(
        pid,
        exactRef(r["spec"]),
        "raster-specification",
      );
      if (canonical(q.payload.state.workUnit) !== canonical(unit))
        throw new InputError("Foreign page spec");
      return this.compile(
        pid,
        reference(q),
        integer(r["width"], 8192),
        integer(r["height"], 8192),
      );
    }
    if (action === "grant-execution") {
      const q = this.own<ExecutionRequest>(
        pid,
        exactRef(r["request"]),
        "raster-execution-request",
      );
      if (canonical(q.payload.state.workUnit) !== canonical(unit))
        throw new InputError("Foreign page request");
      const { expectedProject: _, unit: __, ...grant } = r;
      return this.grant(pid, grant);
    }
    if (action === "prepare-execution") {
      const g = this.own<Grant>(
          pid,
          exactRef(r["grant"]),
          "raster-execution-grant",
        ),
        q = this.own<ExecutionRequest>(
          pid,
          g.payload.state.request,
          "raster-execution-request",
        );
      if (canonical(q.payload.state.workUnit) !== canonical(unit))
        throw new InputError("Foreign page grant");
      let retry: Execution["retryOf"] = null;
      if (r["retryOf"] !== null) {
        const b = record(r["retryOf"], ["execution", "slot"]);
        retry = {
          execution: exactRef(b["execution"]),
          slot: integer(b["slot"], 6),
        };
      }
      return this.prepare(pid, reference(g), retry);
    }
    if (action === "revoke-execution") {
      const g = this.own<Grant>(
          pid,
          exactRef(r["grant"]),
          "raster-execution-grant",
        ),
        q = this.own<ExecutionRequest>(
          pid,
          g.payload.state.request,
          "raster-execution-request",
        );
      if (canonical(q.payload.state.workUnit) !== canonical(unit))
        throw new InputError("Foreign page grant");
      return this.revoke(pid, reference(g));
    }
    const e = this.own<Execution>(
      pid,
      exactRef(r["execution"]),
      "raster-execution",
    );
    if (canonical(e.payload.state.workUnit) !== canonical(unit))
      throw new InputError("Foreign page execution");
    if (action === "retry-delivery")
      return this.retryDelivery(pid, reference(e), integer(r["sequence"], 36));
    if (action === "execute") return this.execute(pid, reference(e));
    if (action === "recover-execution") return this.recover(pid, reference(e));
    if (action === "reconcile-execution")
      return this.reconcile(pid, reference(e), integer(r["slot"], 6));
    if (action === "cancel-execution")
      return this.cancel(
        pid,
        reference(e),
        r["slot"] === null ? null : integer(r["slot"], 6),
      );
    throw new InputError("Not found", 404);
  }
}
