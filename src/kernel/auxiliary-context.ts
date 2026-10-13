import type { GateEnvironment } from "./gate.ts";
import type {
  VersionRef,
  DesignArtifact,
  NodePacket,
  VisualOS,
} from "./contracts.ts";
import { canonical, digest, reference } from "./packets.ts";
import { librarySource } from "./library-gate.ts";
import { CanonicalMemory } from "./memory-index.ts";
import {
  memoryKind,
  evidenceKey,
} from "../modules/website/memory-contracts.ts";
import { parseSelections } from "../modules/website/exploration-contracts.ts";
import {
  parseReconstructionRequest,
  parseReconstructionResult,
  same,
} from "../modules/website/reconstruction-contracts.ts";
import {
  pageSignature,
  type PageState,
  type MediaState,
} from "../modules/website/page.ts";
import {
  parseFocus,
  type Focus,
  type Scope,
} from "../modules/website/auxiliary-contracts.ts";
export function auxiliaryOwn(
  env: GateEnvironment,
  pid: string,
  r: VersionRef,
  kind: string,
  integrity?: string,
) {
  const p = env.lookup(r);
  if (
    !p ||
    p.projectId !== pid ||
    memoryKind(p) !== kind ||
    (integrity && p.integrity !== integrity)
  )
    throw new Error("Auxiliary exact owner/type/integrity mismatch");
  return p;
}
export function focusFacts(env: GateEnvironment, pid: string, input: Focus) {
  const f = parseFocus(input);
  auxiliaryOwn(env, pid, f.unit, "page-work-unit");
  const refs: VersionRef[] = [f.unit];
  const images: {
    ref: VersionRef;
    image: import("../service/assets.ts").ImageInfo;
    label: string;
    role: string;
  }[] = [];
  let context: unknown;
  if (f.kind === "visual-page") {
    let raster: unknown = null,
      region: unknown = null;
    if (f.raster) {
      auxiliaryOwn(
        env,
        pid,
        f.raster.ref,
        "raster-concept",
        f.raster.integrity,
      );
      const membership = (env.projectRefs?.(pid, 4096, false) ?? [])
        .map((r) => env.lookup(r) as NodePacket<DesignArtifact<any>> | null)
        .find(
          (p) =>
            p?.payload.kind === "raster-membership" &&
            same(p.payload.state.candidate, f.raster!.ref) &&
            same(p.payload.state.workUnit, f.unit),
        );
      if (!membership) throw Error("Raster membership unavailable");
      const source = librarySource(
        env,
        pid,
        f.raster.ref,
        f.raster.integrity,
        reference(membership),
      );
      if (!same(source.workUnit, f.unit))
        throw Error("Raster belongs to another visual page");
      refs.push(source.candidate, source.membership, source.media);
      images.push({
        ref: source.media,
        image: source.image,
        label: "Exact whole raster",
        role: "focus-raster",
      });
      raster = {
        ref: source.candidate,
        integrity: source.candidateIntegrity,
        image: source.image,
        rights: source.rights,
      };
    }
    if (f.region) {
      if (!f.raster) throw Error("Region requires exact raster");
      const p = auxiliaryOwn(
          env,
          pid,
          f.region.selections,
          "raster-selections",
          f.region.integrity,
        ) as NodePacket<DesignArtifact<unknown>>,
        s = parseSelections(p.payload.state),
        e = s.entries.find((e) => e.id === f.region!.entryId);
      if (
        !same(s.workUnit, f.unit) ||
        !e ||
        !same(e.candidate, f.raster.ref) ||
        e.integrity !== f.raster.integrity ||
        e.anchor.kind === "whole"
      )
        throw Error("Region is not bound to original raster/page");
      refs.push(f.region.selections);
      region = {
        source: f.raster,
        anchor: e.anchor,
        orientation: e.orientation,
        coordinates: e.coordinates,
        referenceOnly: true,
        cropped: false,
      };
    }
    context = { kind: f.kind, unit: f.unit, raster, region };
  } else if (f.kind === "semantic-page") {
    const p = auxiliaryOwn(
      env,
      pid,
      f.page,
      "website-page",
      f.integrity,
    ) as NodePacket<DesignArtifact<PageState>>;
    if (pageSignature(p.payload.state) !== f.signature)
      throw Error("Semantic focus signature mismatch");
    refs.push(f.page);
    if (f.placement) {
      const m = auxiliaryOwn(
        env,
        pid,
        f.placement.media,
        "page-media",
        f.placement.integrity,
      ) as NodePacket<DesignArtifact<MediaState>>;
      if (
        !same(
          p.payload.state.page.media[f.placement.slot]?.asset ?? null,
          f.placement.media,
        )
      )
        throw Error("Semantic placement mismatch");
      if (!env.rasterFacts?.(m.payload.state.image))
        throw Error("Placement bytes unavailable");
      refs.push(f.placement.media);
      images.push({
        ref: f.placement.media,
        image: m.payload.state.image,
        label: "Exact semantic placement reference",
        role: "focus-placement",
      });
    }
    context = {
      kind: f.kind,
      unit: f.unit,
      page: f.page,
      signature: f.signature,
      tree: p.payload.state.page,
      locks: p.payload.state.locks,
      placement: f.placement,
    };
  } else {
    const p = auxiliaryOwn(
        env,
        pid,
        f.request,
        "reconstruction-request",
        f.integrity,
      ) as NodePacket<DesignArtifact<unknown>>,
      q = parseReconstructionRequest(p.payload.state);
    if (!same(q.workUnit, f.unit)) throw Error("Reconstruction page mismatch");
    const source = librarySource(
      env,
      pid,
      q.source.candidate,
      q.source.integrity,
      q.source.membership,
    );
    refs.push(f.request, source.candidate, source.membership, source.media);
    images.push({
      ref: source.media,
      image: source.image,
      label: "Whole reconstruction source",
      role: "focus-raster",
    });
    let result: unknown = null;
    if (f.result) {
      const rp = auxiliaryOwn(
          env,
          pid,
          f.result.ref,
          "reconstruction-result",
          f.result.integrity,
        ) as NodePacket<DesignArtifact<unknown>>,
        r = parseReconstructionResult(rp.payload.state);
      if (!same(r.request, f.request) || r.requestHash !== p.integrity)
        throw Error("Reconstruction result binding mismatch");
      refs.push(f.result.ref);
      result = {
        ref: f.result.ref,
        outcome: r.outcome,
        proposals: r.proposals,
        findings: r.findings,
      };
    }
    context = {
      kind: f.kind,
      unit: f.unit,
      request: f.request,
      source: q.source,
      instruction: q.instruction,
      count: q.count,
      viewports: q.viewports,
      base: q.base?.page ?? null,
      locks: q.locks,
      result,
    };
  }
  return { focus: f, context, refs, images };
}
export function scopedEvidence(
  env: GateEnvironment,
  pid: string,
  r: VersionRef,
  integrity: string,
) {
  const memory = new CanonicalMemory(env),
    rows = memory.inventory(pid, false);
  const capsule = rows.find((row) => same(row.ref, r))?.packet as
    | NodePacket<DesignArtifact<any>>
    | undefined;
  if (
    capsule?.projectId === pid &&
    memoryKind(capsule) === "project-continuation-capsule"
  ) {
    if (capsule.integrity !== integrity)
      return {
        ref: r,
        status: "corrupt",
        currency: "unavailable",
        summary: null,
      };
    const s = capsule.payload.state.snapshot;
    return {
      ref: r,
      status: "available",
      currency: "dated-snapshot",
      summary: {
        kind: "project-continuation-capsule",
        datedEvidence: true,
        digest: s.digest,
        scope: s.scope,
        coverage: s.coverage,
        entries: s.entries
          .slice(0, 32)
          .map((x: any) => ({ ref: x.ref, kind: x.kind, status: x.status })),
        omitted: Math.max(0, s.entries.length - 32),
        warning:
          "Dated pointers only; no automatic capsule contents or Brand restoration",
      },
    };
  }
  const e = memory.entry(pid, r, rows, integrity);
  if (e.status !== "available")
    return {
      ref: r,
      status: e.status,
      currency:
        e.latestVersion === r.version
          ? "pinned-current"
          : "historical-or-unavailable",
      summary: null,
    };
  if (e.kind === "project-handoff-note") {
    const p = auxiliaryOwn(env, pid, r, e.kind, integrity) as NodePacket<
      DesignArtifact<{ text: string; source: string }>
    >;
    return {
      ref: r,
      status: e.status,
      currency:
        e.latestVersion === r.version
          ? "pinned-current"
          : "historical-or-unavailable",
      summary: {
        kind: e.kind,
        text: p.payload.state.text,
        source: p.payload.state.source,
      },
    };
  }
  if (e.kind === "project-continuation-capsule") {
    const p = auxiliaryOwn(env, pid, r, e.kind, integrity) as NodePacket<
        DesignArtifact<any>
      >,
      s = p.payload.state.snapshot;
    return {
      ref: r,
      status: e.status,
      currency:
        e.latestVersion === r.version
          ? "pinned-current"
          : "historical-or-unavailable",
      summary: {
        kind: e.kind,
        datedEvidence: true,
        digest: s.digest,
        scope: s.scope,
        coverage: s.coverage,
        entries: s.entries
          .slice(0, 32)
          .map((x: any) => ({ ref: x.ref, kind: x.kind, status: x.status })),
        omitted: Math.max(0, s.entries.length - 32),
        warning:
          "Dated pointers only; no automatic capsule contents or Brand restoration",
      },
    };
  }
  throw Error(
    "Unsupported auxiliary supporting evidence; include an exact human note or dated capsule",
  );
}
export function scopeFacts(
  env: GateEnvironment,
  pid: string,
  s: Pick<Scope, "focus" | "brand" | "references" | "evidence" | "project">,
) {
  const project = env.lookup(s.project);
  if (project?.type !== "module-project" || project.id !== pid)
    throw Error("Auxiliary project mismatch");
  const f = focusFacts(env, pid, s.focus),
    refs = [s.project, ...f.refs];
  let brand: unknown = { enabled: false };
  if (s.brand) {
    const b = env.lookup(s.brand.ref) as NodePacket<VisualOS> | null;
    if (
      !b ||
      b.type !== "visual-os" ||
      b.approval !== "accepted" ||
      b.integrity !== s.brand.integrity
    )
      throw Error("Explicit approved Brand required");
    brand = {
      enabled: true,
      ref: s.brand.ref,
      integrity: s.brand.integrity,
      values: Object.fromEntries(
        Object.entries(b.payload.values)
          .filter(([, v]) => v.approved)
          .map(([k, v]) => [k, v.value]),
      ),
    };
    refs.push(s.brand.ref);
  }
  const references = s.references.map((r) => {
    const m = auxiliaryOwn(
      env,
      pid,
      r.ref,
      "page-media",
      r.integrity,
    ) as NodePacket<DesignArtifact<MediaState>>;
    if (!env.rasterFacts?.(m.payload.state.image))
      throw Error("Reference bytes unavailable");
    refs.push(r.ref);
    f.images.push({
      ref: r.ref,
      image: m.payload.state.image,
      label: r.label,
      role: "explicit-reference",
    });
    return {
      ref: r.ref,
      integrity: r.integrity,
      label: r.label,
      image: m.payload.state.image,
      rights: m.payload.state.permission,
      referenceOnly: true,
    };
  });
  const evidence = s.evidence.map((e) => {
    const out = scopedEvidence(env, pid, e.ref, e.integrity);
    if (out.status === "available") refs.push(e.ref);
    return out;
  });
  const context = {
    project: s.project,
    focus: f.context,
    brand,
    references,
    evidence,
    policy:
      "Explicit inputs only; source-visible styling remains visible; no legacy history or old render context",
  };
  return {
    context,
    contextDigest: digest(context),
    refs: [...new Map(refs.map((r) => [evidenceKey(r), r])).values()],
    images: f.images,
  };
}
export function scopeBoundary(
  s: Pick<
    Scope,
    | "session"
    | "project"
    | "focus"
    | "brand"
    | "references"
    | "evidence"
    | "target"
    | "editable"
  >,
) {
  return digest({
    session: s.session,
    project: s.project,
    focus: s.focus,
    brand: s.brand,
    references: s.references,
    evidence: s.evidence,
    target: s.target,
    editable: s.editable,
  });
}
