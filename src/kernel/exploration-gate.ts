import type {
  DesignArtifact,
  NodePacket,
  VersionRef,
  VisualOS,
} from "./contracts.ts";
import type { GateEnvironment } from "./gate.ts";
import { canonical, reference, digest } from "./packets.ts";
import {
  explorationRoles,
  parseExploration,
  parseConcept,
  type ExplorationKind,
  type RasterConcept,
  type Selections,
  type Specification,
  type Batch,
  type Receipt,
  type Metrics,
  type Membership,
} from "../modules/website/exploration-contracts.ts";

/** All new records are checked at the persistence boundary, including direct KernelStore writes. */
export function explorationGate(
  p: NodePacket<unknown>,
  previous: NodePacket<unknown> | null,
  env: GateEnvironment,
): void {
  const a = p.payload as DesignArtifact<unknown>,
    kind = a.kind as ExplorationKind;
  const previousKind = (
    previous?.payload as DesignArtifact<unknown> | undefined
  )?.kind;
  if (
    previous &&
    (Object.hasOwn(explorationRoles, kind) ||
      (previousKind !== undefined &&
        Object.hasOwn(explorationRoles, previousKind))) &&
    previousKind !== kind
  )
    throw new Error("Exploration semantic kind is immutable across lineage");
  if (!Object.hasOwn(explorationRoles, kind)) return;
  if (
    p.type !== explorationRoles[kind] ||
    p.approval !== "proposal" ||
    p.contextRefs.length ||
    p.constraints.length ||
    p.placeholders.length
  )
    throw new Error("Exploration envelope/role mismatch");
  const persisted = env.lookup(reference(p))?.integrity === p.integrity;
  const state = parseExploration(kind, a.state),
    expected: VersionRef[] = [],
    assets: { id: string; checksum: string }[] = [];
  const eq = (x: unknown, y: unknown, message: string) => {
    if (canonical(x) !== canonical(y)) throw new Error(message);
  };
  const own = <T>(r: VersionRef, type: string, k?: string): NodePacket<T> => {
    if (r.freshness !== "pinned")
      throw new Error("Unpinned exploration dependency");
    const target = env.lookup(r);
    if (
      !target ||
      target.projectId !== p.projectId ||
      target.type !== type ||
      (k && (target.payload as DesignArtifact<unknown>).kind !== k)
    )
      throw new Error("Exploration reference owner/type mismatch");
    expected.push(r);
    return target as NodePacket<T>;
  };
  const candidate = (r: VersionRef) => {
    const c = own<DesignArtifact<RasterConcept>>(
      r,
      "design-artifact",
      "raster-concept",
    );
    const s = parseConcept(c.payload.state),
      m = env.lookup(s.media) as NodePacket<
        DesignArtifact<{ image: RasterConcept["image"] }>
      > | null;
    if (
      m?.type !== "media-asset" ||
      m.projectId !== p.projectId ||
      m.payload.kind !== "page-media" ||
      canonical(m.payload.state.image) !== canonical(s.image) ||
      canonical(c.dependencies) !== canonical([s.media]) ||
      c.contextRefs.length ||
      canonical(c.assets) !==
        canonical([{ id: s.image.id, checksum: s.image.checksum }]) ||
      !env.imageMatches?.(s.image)
    )
      throw new Error("Candidate closure unavailable or corrupt");
    return c;
  };
  const media = (r: VersionRef, image: RasterConcept["image"]) => {
    const m = own<
      DesignArtifact<{ image: RasterConcept["image"]; permission: string }>
    >(r, "media-asset", "page-media");
    eq(m.payload.state.image, image, "Raster media descriptor mismatch");
    if (!env.imageMatches?.(image))
      throw new Error("Raster media bytes/dimensions unavailable or corrupt");
    return m;
  };
  if (kind === "raster-concept") {
    const s = state as RasterConcept;
    if (s.origin === "generated")
      throw new Error(
        "Generated origin requires a future authorized executor record",
      );
    media(s.media, s.image);
    assets.push({ id: s.image.id, checksum: s.image.checksum });
    if (previous)
      eq(
        (previous.payload as DesignArtifact<RasterConcept>).state.origin,
        s.origin,
        "Raster revision cannot relabel its origin",
      );
  }
  if (kind === "page-work-unit") {
    if (previous)
      eq(
        (previous.payload as DesignArtifact<unknown>).state,
        state,
        "Work-unit identity/type/source is immutable",
      );
  }
  if (kind === "raster-selections") {
    const s = state as Selections;
    own(s.workUnit, "work-record", "page-work-unit");
    for (const e of s.entries) {
      const c = candidate(e.candidate);
      if (c.integrity !== e.integrity)
        throw new Error("Selection source integrity mismatch");
      eq(c.payload.state.image, e.image, "Selection image binding mismatch");
      eq(
        c.payload.state.orientation,
        e.orientation,
        "Selection orientation mismatch",
      );
      media(c.payload.state.media, c.payload.state.image);
    }
    if (previous)
      eq(
        (previous.payload as DesignArtifact<Selections>).state.workUnit,
        s.workUnit,
        "Selection cannot move work unit",
      );
  }
  if (kind === "raster-specification") {
    const s = state as Specification;
    own(s.project, "module-project");
    if (s.project.id !== p.projectId) throw new Error("Spec project mismatch");
    own(s.workUnit, "work-record", "page-work-unit");
    if (
      !persisted &&
      (env.currentVersion(s.project.id) !== s.project.version ||
        env.currentVersion(s.workUnit.id) !== s.workUnit.version ||
        (s.selections &&
          env.currentVersion(s.selections.id) !== s.selections.version))
    )
      throw new Error("Stale specification inputs");
    if (s.selections) {
      const sel = own<DesignArtifact<Selections>>(
        s.selections,
        "work-record",
        "raster-selections",
      );
      eq(sel.payload.state, s.selectionSnapshot, "Frozen selection mismatch");
      eq(sel.payload.state.workUnit, s.workUnit, "Spec work-unit mismatch");
      for (const e of sel.payload.state.entries) {
        const c = candidate(e.candidate);
        if (c.integrity !== e.integrity)
          throw new Error("Frozen source integrity mismatch");
        media(c.payload.state.media, c.payload.state.image);
      }
    }
    for (const r of s.resources) {
      const m = media(r.media, r.image);
      eq(m.payload.state.permission, r.rights, "Resource rights mismatch");
    }
    if (s.brand.enabled) {
      const b = env.lookup(s.brand.source) as NodePacket<VisualOS> | null;
      if (
        b?.type !== "visual-os" ||
        b.projectId !== null ||
        b.approval !== "accepted" ||
        b.integrity !== s.brand.integrity
      )
        throw new Error("Brand requires real approved exact context");
      expected.push(s.brand.source);
      eq(
        s.brand.values,
        Object.fromEntries(
          Object.entries(b.payload.values)
            .filter(([, v]) => v.approved)
            .map(([k, v]) => [k, v.value]),
        ),
        "Brand frozen values mismatch",
      );
    }
    if (previous)
      throw new Error(
        "Frozen specification is immutable; create a new identity",
      );
  }
  if (kind === "raster-membership") {
    const s = state as Membership;
    own(s.workUnit, "work-record", "page-work-unit");
    const c = candidate(s.candidate);
    if (c.integrity !== s.integrity)
      throw new Error("Membership integrity mismatch");
    s.derivation.forEach(candidate);
    if (previous) throw new Error("Membership is immutable");
  }
  if (kind === "raster-metrics") {
    const s = state as Metrics,
      c = candidate(s.candidate);
    if (c.integrity !== s.integrity)
      throw new Error("Metric source integrity mismatch");
    for (const m of s.values)
      if (m.status === "observed") {
        // Only V01's mechanically verifiable static measurements may be called observed.
        const actual =
          m.key === "image-width"
            ? c.payload.state.image.width
            : m.key === "image-height"
              ? c.payload.state.image.height
              : undefined;
        if (
          actual === undefined ||
          m.scale.kind !== "continuous" ||
          m.scale.unit !== "px" ||
          m.value !== actual
        )
          throw new Error("Unsupported or false observed metric");
      }
    if (previous) {
      const old = (previous.payload as DesignArtifact<Metrics>).state;
      eq(old.candidate, s.candidate, "Metric artifact version cannot drift");
      eq(old.integrity, s.integrity, "Metric integrity cannot drift");
    }
  }
  if (kind === "raster-batch") {
    const s = state as Batch,
      q = own<DesignArtifact<Specification>>(
        s.spec,
        "work-record",
        "raster-specification",
      );
    if (q.integrity !== s.specHash) throw new Error("Batch spec hash mismatch");
    eq(q.payload.state.workUnit, s.workUnit, "Batch work-unit mismatch");
    if (s.attempts.length !== q.payload.state.count)
      throw new Error("Attempt count differs from frozen spec");
    if (s.retryOf) {
      const parent = own<DesignArtifact<Batch>>(
          s.retryOf.batch,
          "work-record",
          "raster-batch",
        ),
        slot = parent.payload.state.attempts[s.retryOf.slot - 1];
      if (!slot || ["pending", "running"].includes(slot.status))
        throw new Error("Retry must link a consumed original attempt");
      eq(parent.payload.state.workUnit, s.workUnit, "Retry work-unit mismatch");
    }
    for (const slot of s.attempts) {
      if (
        ["succeeded", "invalid", "failed"].includes(slot.status) &&
        !slot.receipt
      )
        throw new Error("Terminal result requires an exact receipt");
      if (slot.result) candidate(slot.result);
      if (slot.receipt) {
        const r = own<DesignArtifact<Receipt>>(
          slot.receipt,
          "work-record",
          "raster-receipt",
        ).payload.state;
        if (
          r.batch.id !== p.id ||
          r.slot !== slot.slot ||
          r.specHash !== s.specHash
        )
          throw new Error("Attempt receipt mismatch");
        eq(r.result, slot.result, "Attempt result mismatch");
        if (
          previous &&
          !(previous.payload as DesignArtifact<Batch>).state.attempts[
            slot.slot - 1
          ]!.receipt &&
          r.batch.version !== previous.version
        )
          throw new Error("Receipt does not bind the consumed batch revision");
        if (
          r.outcome !== slot.status &&
          !(
            ["cancelled", "uncertain"].includes(slot.status) &&
            r.outcome === "uncertain"
          )
        )
          throw new Error("Attempt outcome mismatch");
      }
    }
    if (previous) {
      const old = (previous.payload as DesignArtifact<Batch>).state;
      eq(
        { ...old, attempts: [] },
        { ...s, attempts: [] },
        "Batch scope/lineage immutable",
      );
      s.attempts.forEach((slot, i) => {
        const before = old.attempts[i]!;
        if (before.receipt)
          eq(before, slot, "Consumed attempt cannot reset/replay");
        else if (["cancelled", "uncertain"].includes(before.status)) {
          if (slot.status !== before.status || slot.result !== null)
            throw new Error("Closed attempt cannot become success");
        } else if (!["pending", "running"].includes(before.status))
          eq(before, slot, "Terminal attempt cannot reset");
        else if (before.status === "running" && slot.status === "pending")
          throw new Error("Attempt cannot reset to pending");
      });
    } else if (
      s.attempts.some((x) => x.status !== "pending" || x.receipt || x.result)
    )
      throw new Error(
        "New batch must be prepared pending without authorization",
      );
  }
  if (kind === "raster-receipt") {
    const s = state as Receipt;
    if (p.id !== "raster-receipt-" + digest(s.receiptId))
      throw new Error("Receipt identity binding mismatch");
    const b = own<DesignArtifact<Batch>>(
        s.batch,
        "work-record",
        "raster-batch",
      ),
      slot = b.payload.state.attempts[s.slot - 1];
    if (
      !slot ||
      b.payload.state.specHash !== s.specHash ||
      (!persisted && (env.currentVersion(b.id) !== b.version || slot.receipt))
    )
      throw new Error("Receipt stale/foreign/consumed envelope");
    if (
      ["cancelled", "uncertain"].includes(slot.status) &&
      s.outcome !== "uncertain"
    )
      throw new Error("Late receipt must remain uncertain");
    if (s.result) {
      const c = candidate(s.result);
      if (c.payload.state.origin !== "synthetic")
        throw new Error("V01 registration results must be synthetic");
    }
    if (s.evidence) {
      if (s.outcome !== "uncertain")
        throw new Error("Only uncertain evidence is stored separately");
      const m = media(s.evidence.media, s.evidence.image);
      if ((m.payload.state as unknown as { role: string }).role !== "reference")
        throw new Error("Uncertain evidence must be reference-only");
    }
    s.derivation.forEach(candidate);
    if (previous) throw new Error("Receipts are immutable");
  }
  const unique = (xs: VersionRef[]) => [
    ...new Map(xs.map((r) => [r.id + ":" + r.version, r])).values(),
  ];
  eq(
    p.dependencies,
    unique(expected),
    "Exploration dependencies must match exact typed closure",
  );
  eq(p.assets, assets, "Exploration asset inventory mismatch");
}
