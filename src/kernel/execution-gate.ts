import type { DesignArtifact, NodePacket, VersionRef } from "./contracts.ts";
import type { GateEnvironment } from "./gate.ts";
import { canonical, reference, digest } from "./packets.ts";
import {
  executionRoles,
  parseExecution,
} from "../modules/website/execution-contracts.ts";
import type {
  ExecutionKind,
  ExecutionRequest,
  Grant,
  Execution,
  ExecutionReceipt,
} from "../modules/website/execution-contracts.ts";
import type {
  Specification,
  RasterConcept,
} from "../modules/website/exploration-contracts.ts";
export function compileRequest(
  q: NodePacket<DesignArtifact<Specification>>,
  width: number,
  height: number,
  lookup: (r: VersionRef) => NodePacket<unknown> | null,
): ExecutionRequest {
  const s = q.payload.state;
  const sources: ExecutionRequest["sources"] = [];
  for (const scope of s.sourceScopes) {
    if (scope.style === "excluded" && scope.content === "excluded") continue;
    const entry = s.selectionSnapshot!.entries.find(
      (e) => e.id === scope.entryId,
    )!;
    const c = lookup(entry.candidate) as NodePacket<
      DesignArtifact<RasterConcept>
    >;
    const m = lookup(c.payload.state.media) as NodePacket<
      DesignArtifact<{ permission: string }>
    >;
    sources.push({
      entry,
      media: c.payload.state.media,
      image: c.payload.state.image,
      rights: m.payload.state.permission,
      style: scope.style,
      content: scope.content,
    });
  }
  for (const r of s.resources)
    if (r.style === "included" || r.content === "included")
      sources.push({ entry: null, ...r });
  return {
    version: 1,
    compiler: "raster-execution-v1",
    spec: reference(q),
    specHash: q.integrity,
    workUnit: s.workUnit,
    width,
    height,
    count: s.count,
    operation: s.operation,
    intent: s.rawIntent,
    direction: s.direction,
    brand: s.brand,
    facts: s.facts,
    constraints: s.constraints,
    requests: s.metricRequests,
    sources,
  };
}
export function executionGate(
  p: NodePacket<unknown>,
  previous: NodePacket<unknown> | null,
  env: GateEnvironment,
): void {
  const a = p.payload as DesignArtifact<unknown>,
    k = a.kind as ExecutionKind,
    oldKind = (previous?.payload as DesignArtifact<unknown> | undefined)?.kind;
  if (
    previous &&
    (Object.hasOwn(executionRoles, k) ||
      Object.hasOwn(executionRoles, oldKind ?? "")) &&
    oldKind !== k
  )
    throw new Error("Execution semantic kind immutable");
  if (!Object.hasOwn(executionRoles, k)) return;
  if (
    p.type !== "work-record" ||
    p.approval !== "proposal" ||
    p.contextRefs.length ||
    p.constraints.length ||
    p.placeholders.length ||
    p.assets.length
  )
    throw new Error("Execution envelope invalid");
  const s = parseExecution(k, a.state),
    deps: VersionRef[] = [];
  const eq = (x: unknown, y: unknown, msg: string) => {
    if (canonical(x) !== canonical(y)) throw new Error(msg);
  };
  const own = <T>(
    r: VersionRef,
    kind: string,
  ): NodePacket<DesignArtifact<T>> => {
    const n = env.lookup(r) as NodePacket<DesignArtifact<T>> | null;
    if (!n || n.projectId !== p.projectId || n.payload.kind !== kind)
      throw new Error("Execution dependency owner/kind mismatch");
    deps.push(r);
    return n;
  };
  if (k === "raster-execution-request") {
    const r = s as ExecutionRequest,
      q = own<Specification>(r.spec, "raster-specification");
    if (q.integrity !== r.specHash)
      throw new Error("Execution spec hash mismatch");
    eq(
      r,
      compileRequest(q, r.width, r.height, env.lookup),
      "Execution compilation mismatch",
    );
    for (const source of r.sources) {
      const m = own<{ image: unknown; permission: string }>(
        source.media,
        "page-media",
      );
      eq(m.payload.state.image, source.image, "Input media mismatch");
      eq(m.payload.state.permission, source.rights, "Input rights mismatch");
      if (!env.imageMatches?.(source.image))
        throw new Error("Missing execution source bytes");
    }
    if (previous) throw new Error("Execution request immutable");
  }
  if (k === "raster-execution-grant") {
    const g = s as Grant,
      r = own<ExecutionRequest>(g.request, "raster-execution-request");
    if (
      r.integrity !== g.requestHash ||
      r.payload.state.specHash !== g.specHash
    )
      throw new Error("Grant binding mismatch");
    eq(r.payload.state.spec, g.spec, "Grant spec mismatch");
    if (
      g.slots.some((slot) => slot > r.payload.state.count) ||
      g.maxSubmissions !== g.slots.length
    )
      throw new Error("Grant slot/submission bounds mismatch");
    if (previous) {
      const old = (previous.payload as DesignArtifact<Grant>).state;
      eq(
        { ...old, revoked: false },
        { ...g, revoked: false },
        "Grant terms immutable",
      );
      if (old.revoked || !g.revoked)
        throw new Error("Grant revocation monotonic");
    } else if (g.revoked) throw new Error("New grant already revoked");
  }
  if (k === "raster-execution") {
    const e = s as Execution,
      r = own<ExecutionRequest>(e.request, "raster-execution-request"),
      g = own<Grant>(e.grant, "raster-execution-grant").payload.state;
    if (
      p.id !== "raster-execution-" + digest(e.grant.id) ||
      r.integrity !== e.requestHash
    )
      throw new Error("Execution identity/request binding mismatch");
    eq(
      [e.request, e.requestHash, e.spec, e.specHash, e.adapter],
      [g.request, g.requestHash, g.spec, g.specHash, g.adapter],
      "Execution grant mismatch",
    );
    eq(e.workUnit, r.payload.state.workUnit, "Execution work-unit mismatch");
    eq(
      e.slots.map((s) => s.slot),
      g.slots,
      "Execution slots mismatch",
    );
    for (const kind of ["submit", "status", "cancel"] as const) {
      const max =
        kind === "submit"
          ? g.maxSubmissions
          : kind === "status"
            ? g.maxStatusCalls
            : g.maxCancelCalls;
      if (e.calls.filter((c) => c.kind === kind).length > max)
        throw new Error("Execution transport allowance exceeded");
    }
    for (const slot of e.slots) {
      if (!slot.submissionId && !["pending", "cancelled"].includes(slot.status))
        throw new Error("Attempt has no reservation");
      if (
        slot.receipt === null &&
        ["succeeded", "invalid", "failed"].includes(slot.status)
      )
        throw new Error("Attempt missing receipt");
      const submits = e.calls.filter(
        (c) => c.slot === slot.slot && c.kind === "submit",
      );
      if (
        submits.length > 1 ||
        (slot.submissionId !== null) !== (submits.length === 1)
      )
        throw new Error("Submission identity/count mismatch");
      if (
        slot.submissionId &&
        slot.submissionId !== digest({ execution: p.id, slot: slot.slot })
      )
        throw new Error("Wrong submission identity");
      if (slot.cancelConfirmed && !slot.cancelRequested)
        throw new Error("Cancellation confirmation lacks intent");
      if (slot.receipt) {
        const receipt = own<ExecutionReceipt>(
          slot.receipt,
          "raster-execution-receipt",
        ).payload.state;
        eq(
          [
            receipt.execution.id,
            receipt.slot,
            receipt.requestHash,
            receipt.specHash,
            receipt.submissionId,
            receipt.jobId,
          ],
          [
            p.id,
            slot.slot,
            e.requestHash,
            e.specHash,
            slot.submissionId,
            slot.jobId,
          ],
          "Receipt lineage mismatch",
        );
        if (receipt.outcome !== "historical" && receipt.outcome !== slot.status)
          throw new Error("Receipt status mismatch");
      }
      if (
        ["succeeded", "invalid", "failed"].includes(slot.status) &&
        !slot.receipt
      )
        throw new Error("Terminal execution requires receipt");
    }
    for (const c of e.calls) {
      const slot = e.slots.find((s) => s.slot === c.slot);
      if (
        !slot ||
        c.submissionId !== slot.submissionId ||
        (c.kind === "cancel" && !c.jobId)
      )
        throw new Error("Call scope invalid");
    }
    if (e.retryOf) {
      const parent = own<Execution>(e.retryOf.execution, "raster-execution")
          .payload.state,
        slot = parent.slots.find((s) => s.slot === e.retryOf!.slot);
      if (
        !slot ||
        !["failed", "invalid", "cancelled", "uncertain"].includes(
          slot.status,
        ) ||
        parent.grant.id === e.grant.id
      )
        throw new Error("Manual retry needs consumed lineage and new grant");
      eq(parent.request, e.request, "Retry request mismatch");
      eq(
        e.slots.map((s) => s.slot),
        [slot.slot],
        "Retry must be scoped to original slot",
      );
    }
    if (previous) {
      const old = (previous.payload as DesignArtifact<Execution>).state;
      eq(
        { ...old, slots: [], calls: [] },
        { ...e, slots: [], calls: [] },
        "Execution binding immutable",
      );
      eq(
        e.calls.slice(0, old.calls.length),
        old.calls,
        "Accounting append-only",
      );
      if (e.calls.length > old.calls.length) {
        const call = e.calls.at(-1)!;
        const latest = env.lookup({
          ...e.grant,
          version: env.currentVersion(e.grant.id)!,
        }) as NodePacket<DesignArtifact<Grant>>;
        const stored = env.lookup(reference(p))?.integrity === p.integrity;
        if (
          !stored &&
          (latest.payload.state.revoked ||
            Date.parse(latest.payload.state.expiresAt) <= Date.now())
        )
          throw new Error("Dispatch grant expired or revoked");
        const before = old.slots.find((s) => s.slot === call.slot);
        if (call.kind === "submit" && before?.status !== "pending")
          throw new Error("Submission already reserved");
      }
      if (e.calls.length - old.calls.length > 1)
        throw new Error("One transport reservation per transition");
      for (const before of old.slots) {
        const next = e.slots.find((s) => s.slot === before.slot)!;
        if (before.receipt)
          eq(
            { ...next, cancelConfirmed: before.cancelConfirmed },
            before,
            "Consumed outcome/receipt cannot replay",
          );
        if (
          !before.cancelConfirmed &&
          next.cancelConfirmed &&
          !e.calls.some(
            (c) =>
              c.slot === next.slot && ["cancel", "status"].includes(c.kind),
          )
        )
          throw new Error(
            "Cancellation confirmation requires an owned control call",
          );
        if (before.submissionId && next.submissionId !== before.submissionId)
          throw new Error("Submission cannot reset");
        if (before.jobId && next.jobId !== before.jobId)
          throw new Error("Owned job cannot drift");
        if (
          (before.cancelRequested && !next.cancelRequested) ||
          (before.cancelConfirmed && !next.cancelConfirmed)
        )
          throw new Error("Cancellation cannot reset");
        if (next.status === "pending" && before.status !== "pending")
          throw new Error("Execution cannot resend");
        if (
          ["cancelled", "uncertain"].includes(before.status) &&
          ["succeeded", "pending", "running", "reserved"].includes(next.status)
        )
          throw new Error("Uncertain/closed output is historical only");
      }
    } else if (
      e.calls.length ||
      e.slots.some(
        (s) =>
          s.status !== "pending" ||
          s.submissionId ||
          s.jobId ||
          s.receipt ||
          s.cancelRequested ||
          s.cancelConfirmed,
      )
    )
      throw new Error("Execution starts unreserved");
  }
  if (k === "raster-execution-receipt") {
    const r = s as ExecutionReceipt,
      e = own<Execution>(r.execution, "raster-execution").payload.state,
      slot = e.slots.find((s) => s.slot === r.slot),
      q = own<ExecutionRequest>(e.request, "raster-execution-request").payload
        .state;
    if (
      p.id !==
        "raster-execution-receipt-" +
          digest({ execution: r.execution.id, receiptId: r.receiptId }) ||
      !slot ||
      slot.submissionId !== r.submissionId ||
      slot.jobId !== r.jobId ||
      e.requestHash !== r.requestHash ||
      e.specHash !== r.specHash
    )
      throw new Error("Result lineage mismatch");
    const stored = env.lookup(reference(p))?.integrity === p.integrity;
    const current = env.lookup({
      ...r.execution,
      version: env.currentVersion(r.execution.id)!,
    }) as NodePacket<DesignArtifact<Execution>>;
    if (
      !stored &&
      (current.version !== r.execution.version ||
        current.payload.state.slots.find((s) => s.slot === r.slot)?.receipt)
    )
      throw new Error("Stale or consumed receipt revision");
    const spec = env.lookup(q.spec) as NodePacket<
      DesignArtifact<Specification>
    >;
    if (
      !stored &&
      r.outcome === "succeeded" &&
      (env.currentVersion(spec.payload.state.project.id) !==
        spec.payload.state.project.version ||
        (spec.payload.state.selections &&
          env.currentVersion(spec.payload.state.selections.id) !==
            spec.payload.state.selections.version))
    )
      throw new Error("Stale result cannot be adopted");
    if (r.candidate) {
      const c = own<RasterConcept>(r.candidate, "raster-concept");
      if (r.outcome !== "succeeded" || c.payload.state.origin !== "synthetic")
        throw new Error("Offline output origin mismatch");
      eq(c.payload.state.media, r.media, "Result candidate/media mismatch");
      eq(c.payload.state.image, r.image, "Result candidate image mismatch");
    }
    if (
      (r.outcome === "succeeded") !== (r.candidate !== null) ||
      (r.media === null) !== (r.image === null)
    )
      throw new Error("Result outcome mismatch");
    if (r.media) {
      const m = own<{ image: unknown; role: string }>(r.media, "page-media");
      eq(m.payload.state.image, r.image, "Result descriptor mismatch");
      if (!env.imageMatches?.(r.image!))
        throw new Error("Result bytes unavailable");
      if (r.image!.width !== q.width || r.image!.height !== q.height)
        throw new Error("Result dimensions mismatch");
      if (r.outcome === "historical" && m.payload.state.role !== "reference")
        throw new Error("Historical result cannot be placeable");
    }
    if (
      slot.cancelRequested ||
      ["uncertain", "cancelled"].includes(slot.status)
    ) {
      if (r.outcome !== "historical")
        throw new Error("Late output must remain historical");
    }
    if (previous) throw new Error("Execution receipt immutable");
  }
  eq(
    p.dependencies,
    [...new Map(deps.map((r) => [r.id + ":" + r.version, r])).values()],
    "Execution exact closure mismatch",
  );
}
