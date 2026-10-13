import type { GateEnvironment } from "./gate.ts";
import type {
  NodePacket,
  DesignArtifact,
  VersionRef,
  VisualOS,
} from "./contracts.ts";
import { canonical, reference, digest } from "./packets.ts";
import { librarySource } from "./library-gate.ts";
import {
  pageSignature,
  preservation,
  type PageState,
  type MediaState,
} from "../modules/website/page.ts";
import { parseSemanticCandidates } from "../modules/website/semantic-candidates.ts";
import {
  reconstructionRoles,
  parseReconstructionRequest,
  parseControl,
  parseReconstructionResult,
  parseReview,
  controlId,
  resultId,
  same,
  type ReconstructionRequest,
  type Work,
} from "../modules/website/reconstruction-contracts.ts";
const eq = (a: unknown, b: unknown, message: string) => {
  if (canonical(a) !== canonical(b)) throw new Error(message);
};
function own<T>(
  env: GateEnvironment,
  pid: string,
  r: VersionRef,
  type: string,
  kind: string,
): Work<T> {
  const p = env.lookup(r) as Work<T> | null;
  if (!p || p.projectId !== pid || p.type !== type || p.payload.kind !== kind)
    throw new Error("Reconstruction owner/type/reference mismatch");
  return p;
}
export function reconstructionHeadsCurrent(
  env: GateEnvironment,
  q: ReconstructionRequest,
) {
  return (
    env.currentVersion(q.project.id) === q.heads.project &&
    env.currentVersion(q.workUnit.id) === q.heads.workUnit &&
    env.currentVersion(q.source.candidate.id) === q.heads.source &&
    (!q.base || env.currentVersion(q.base.ref.id) === q.heads.base) &&
    (!q.brand.enabled ||
      env.currentVersion(q.brand.source.id) === q.heads.brand)
  );
}
export function reconstructionContextFacts(
  env: GateEnvironment,
  pid: string,
  q: ReconstructionRequest,
) {
  const project = env.lookup(q.project);
  if (project?.type !== "module-project" || project.id !== pid)
    throw new Error("Reconstruction project mismatch");
  own(env, pid, q.workUnit, "work-record", "page-work-unit");
  const source = librarySource(
    env,
    pid,
    q.source.candidate,
    q.source.integrity,
    q.source.membership,
  );
  eq(
    source.workUnit,
    q.workUnit,
    "Reconstruction source belongs to a different page",
  );
  eq(
    {
      candidate: source.candidate,
      integrity: source.candidateIntegrity,
      membership: source.membership,
      membershipIntegrity: source.membershipIntegrity,
      media: source.media,
      mediaIntegrity: env.lookup(source.media)!.integrity,
      image: source.image,
      rights: source.rights,
    },
    q.source,
    "Reconstruction exact source snapshot mismatch",
  );
  if (q.brand.enabled) {
    const b = env.lookup(q.brand.source) as NodePacket<VisualOS> | null;
    if (
      !b ||
      b.type !== "visual-os" ||
      b.approval !== "accepted" ||
      b.integrity !== q.brand.integrity
    )
      throw new Error("Reconstruction Brand must be approved");
    eq(
      q.brand.values,
      Object.fromEntries(
        Object.entries(b.payload.values)
          .filter(([, v]) => v.approved)
          .map(([k, v]) => [k, v.value]),
      ),
      "Reconstruction Brand snapshot mismatch",
    );
  }
  if (q.base) {
    const b = own<PageState>(
      env,
      pid,
      q.base.ref,
      "design-artifact",
      "website-page",
    );
    if (pageSignature(b.payload.state) !== q.base.signature)
      throw new Error("Reconstruction base signature mismatch");
    eq(q.base.page, b.payload.state.page, "Reconstruction base tree mismatch");
    preservation(q.base.page, q.locks);
    for (const old of b.payload.state.locks)
      if (!q.locks.some((l) => canonical(l) === canonical(old)))
        throw new Error("Existing preservation lock removed");
    for (const binding of Object.values(q.base.page.media)) {
      if (
        binding &&
        !q.resources.some(
          (r) => same(r.media, binding.asset) && r.role === "placeable",
        )
      )
        throw new Error(
          "Deliberate semantic base media must be explicitly included",
        );
    }
  } else if (q.locks.length)
    throw new Error("Reconstruction locks require explicit base");
  for (const r of q.resources) {
    const m = own<MediaState>(env, pid, r.media, "media-asset", "page-media");
    if (m.integrity !== r.integrity)
      throw new Error("Reconstruction media integrity mismatch");
    eq(r.state, m.payload.state, "Reconstruction media snapshot mismatch");
    if (
      r.role === "placeable" &&
      (r.state.role !== "placeable" || same(r.media, q.source.media))
    )
      throw new Error("Reference-only / target raster media cannot be placed");
  }
  for (const e of q.evidence) {
    const n = own<{ text: string }>(
      env,
      pid,
      e.ref,
      "work-record",
      "project-handoff-note",
    );
    if (n.integrity !== e.integrity || n.payload.state.text !== e.text)
      throw new Error("Explicit supporting evidence mismatch");
  }
}
export function reconstructionDependencies(
  q: ReconstructionRequest,
): VersionRef[] {
  return [
    ...new Map(
      [
        q.project,
        q.workUnit,
        q.source.candidate,
        q.source.membership,
        q.source.media,
        ...(q.base ? [q.base.ref] : []),
        ...(q.brand.enabled ? [q.brand.source] : []),
        ...q.resources.map((r) => r.media),
        ...q.evidence.map((e) => e.ref),
        ...(q.previousControl ? [q.previousControl] : []),
      ].map((r) => [r.id + ":" + r.version, r]),
    ).values(),
  ];
}
export function reconstructionGate(
  p: NodePacket<unknown>,
  previous: NodePacket<unknown> | null,
  env: GateEnvironment,
) {
  const a = p.payload as DesignArtifact<unknown>;
  const old = (previous?.payload as DesignArtifact<unknown> | undefined)?.kind;
  if (old && Object.hasOwn(reconstructionRoles, old) && old !== a.kind)
    throw new Error("Reconstruction record kind cannot change");
  if (!Object.hasOwn(reconstructionRoles, a.kind)) return;
  const pid = p.projectId!;
  if (
    p.type !== "work-record" ||
    p.contextRefs.length ||
    p.assets.length ||
    p.approval !== "proposal"
  )
    throw new Error("Reconstruction work-record envelope");
  const stored = env.lookup(reference(p)) !== null;
  const recorded = env.projectRefs?.(pid, 4096, false) ?? [];
  if (!stored && recorded.some((r) => r.id === p.id && r.version === p.version))
    throw new Error("Lost reconstruction canonical version cannot be reused");
  if (a.kind === "reconstruction-request") {
    if (previous)
      throw new Error("Frozen reconstruction request cannot be revised");
    const q = parseReconstructionRequest(a.state);
    reconstructionContextFacts(env, pid, q);
    eq(
      p.dependencies,
      reconstructionDependencies(q),
      "Reconstruction dependency mismatch",
    );
    if (!stored) {
      const recordedHead = recorded
        .filter((r) => r.id === controlId(q.workUnit))
        .reduce((n, r) => Math.max(n, r.version), 0);
      if (recordedHead !== (env.currentVersion(controlId(q.workUnit)) ?? 0))
        throw new Error(
          "Reconstruction control history unavailable; no version reused",
        );
      if (
        !reconstructionHeadsCurrent(env, q) ||
        q.project.version !== q.heads.project ||
        q.workUnit.version !== q.heads.workUnit
      )
        throw new Error("Stale reconstruction preparation");
      const v = env.currentVersion(controlId(q.workUnit));
      if (v === null) {
        if (q.previousControl !== null || q.epoch !== 1)
          throw new Error("Reconstruction initial control expectation");
      } else if (
        !q.previousControl ||
        q.previousControl.id !== controlId(q.workUnit) ||
        q.previousControl.version !== v ||
        q.epoch !== v + 1
      )
        throw new Error("Reconstruction control expectation changed");
    }
  } else if (a.kind === "reconstruction-control") {
    const c = parseControl(a.state),
      rq = own<ReconstructionRequest>(
        env,
        pid,
        c.request,
        "work-record",
        "reconstruction-request",
      ),
      q = parseReconstructionRequest(rq.payload.state);
    if (
      p.id !== controlId(c.workUnit) ||
      !same(c.workUnit, q.workUnit) ||
      c.requestHash !== rq.integrity
    )
      throw new Error("Reconstruction control binding");
    eq(
      p.dependencies,
      [c.workUnit, c.request, ...(c.result ? [c.result] : [])],
      "Control dependency mismatch",
    );
    const prior = previous
      ? parseControl((previous.payload as DesignArtifact<unknown>).state)
      : null;
    if (!prior || !same(prior.request, c.request)) {
      if (
        c.status !== "pending" ||
        c.result ||
        q.epoch !== p.version ||
        !same(q.previousControl, previous ? reference(previous) : null)
      )
        throw new Error("New reconstruction operation control mismatch");
    } else {
      if (
        prior.status !== "pending" ||
        !["cancelled", "returned"].includes(c.status)
      )
        throw new Error("Invalid reconstruction lifecycle transition");
      if (c.result) {
        const r = own(
          env,
          pid,
          c.result,
          "work-record",
          "reconstruction-result",
        );
        const rs = parseReconstructionResult(r.payload.state);
        if (!same(rs.request, c.request) || rs.outcome !== "current")
          throw new Error("Control result mismatch");
      }
    }
  } else if (a.kind === "reconstruction-result") {
    if (previous) throw new Error("Reconstruction receipts immutable");
    const s = parseReconstructionResult(a.state),
      rq = own<ReconstructionRequest>(
        env,
        pid,
        s.request,
        "work-record",
        "reconstruction-request",
      ),
      q = parseReconstructionRequest(rq.payload.state),
      response = s.response;
    if (
      p.id !== resultId(s.request) ||
      rq.integrity !== s.requestHash ||
      digest(response) !== s.responseHash ||
      response.receiptId !== s.receiptId ||
      !same(s.workUnit, q.workUnit) ||
      !same(response.request, s.request) ||
      response.requestHash !== rq.integrity ||
      !same(response.project, q.project) ||
      !same(response.source.candidate, q.source.candidate) ||
      response.source.integrity !== q.source.integrity ||
      response.baseSignature !== (q.base?.signature ?? null)
    )
      throw new Error(
        "Reconstruction receipt/source/hash/base binding mismatch",
      );
    eq(
      response.slots.map((x) => x.slot),
      q.slots,
      "Reconstruction slot/count mismatch",
    );
    eq(
      s.proposals.map((x) => x.slot),
      q.slots,
      "Proposal slot/count mismatch",
    );
    if (
      new Set(s.proposals.map((x) => x.ref.id + ":" + x.ref.version)).size !==
      s.proposals.length
    )
      throw new Error("Duplicate reconstruction proposal identity");
    const parsed = parseSemanticCandidates(
      response.slots.map((x) => x.candidate),
      q.context,
      q.locks,
      (handle) => {
        const r = q.resources.find((r) => r.handle === handle);
        if (
          !r ||
          r.role !== "placeable" ||
          r.state.role !== "placeable" ||
          same(r.media, q.source.media)
        )
          throw new Error(
            "Unknown or reference-only reconstruction media handle",
          );
        const m = own<MediaState>(
          env,
          pid,
          r.media,
          "media-asset",
          "page-media",
        );
        eq(m.payload.state, r.state, "Reconstruction result resource changed");
        return { asset: r.media, image: r.state.image };
      },
    );
    for (const [i, x] of s.proposals.entries()) {
      const candidate = own<PageState>(
          env,
          pid,
          x.ref,
          "design-artifact",
          "website-page",
        ),
        c = parsed[i]!;
      if (
        candidate.version !== 1 ||
        candidate.contextRefs.length ||
        candidate.integrity === q.source.integrity ||
        pageSignature(candidate.payload.state) !== x.signature
      )
        throw new Error("Reconstruction proposal identity/signature mismatch");
      eq(
        candidate.payload.state,
        {
          page: c.page,
          context: c.context,
          locks: c.locks,
          rationale: c.rationale,
        },
        "Reconstruction semantic proposal mismatch",
      );
    }
    eq(
      s.findings,
      [...response.findings, ...parsed.flatMap((c) => c.notes)],
      "Reconstruction findings mismatch",
    );
    eq(
      p.dependencies,
      [q.workUnit, s.request, ...s.proposals.map((x) => x.ref)],
      "Reconstruction result dependency mismatch",
    );
    if (!stored) {
      reconstructionContextFacts(env, pid, q);
      for (const ref of env.projectRefs?.(pid, 4096, false) ?? []) {
        const old = env.lookup(ref);
        if (
          old?.type === "work-record" &&
          (old.payload as DesignArtifact<unknown>).kind ===
            "reconstruction-result" &&
          old.id !== p.id
        ) {
          const prior = parseReconstructionResult(
            (old.payload as DesignArtifact<unknown>).state,
          );
          if (
            prior.receiptId === s.receiptId ||
            prior.proposals.some((x) =>
              s.proposals.some((n) => same(x.ref, n.ref)),
            )
          )
            throw new Error(
              "Reconstruction receipt/proposal reused by another operation",
            );
        }
      }
      const v = env.currentVersion(controlId(q.workUnit)),
        c =
          v === null
            ? null
            : parseControl(
                own(
                  env,
                  pid,
                  {
                    id: controlId(q.workUnit),
                    version: v,
                    freshness: "pinned",
                  },
                  "work-record",
                  "reconstruction-control",
                ).payload.state,
              );
      const usable =
        c &&
        same(c.request, s.request) &&
        c.status === "pending" &&
        reconstructionHeadsCurrent(env, q);
      if (s.outcome !== (usable ? "current" : "historical"))
        throw new Error("Reconstruction current/historical outcome forged");
    }
  } else {
    if (previous) throw new Error("Immutable reconstruction review");
    const s = parseReview(a.state),
      result = own(env, pid, s.result, "work-record", "reconstruction-result"),
      r = parseReconstructionResult(result.payload.state),
      q = own<ReconstructionRequest>(
        env,
        pid,
        s.request,
        "work-record",
        "reconstruction-request",
      );
    if (
      !same(r.request, s.request) ||
      !same(r.workUnit, s.workUnit) ||
      !r.proposals.some(
        (x) => same(x.ref, s.proposal) && x.signature === s.signature,
      )
    )
      throw new Error("Reconstruction review source/result mismatch");
    eq(
      p.dependencies,
      [s.workUnit, s.request, s.result, s.proposal],
      "Reconstruction review dependency mismatch",
    );
    if (!stored) {
      const v = env.currentVersion(controlId(s.workUnit)),
        c =
          v === null
            ? null
            : parseControl(
                own(
                  env,
                  pid,
                  {
                    id: controlId(s.workUnit),
                    version: v,
                    freshness: "pinned",
                  },
                  "work-record",
                  "reconstruction-control",
                ).payload.state,
              );
      if (
        !c ||
        !same(c.request, s.request) ||
        !same(c.result, s.result) ||
        c.status !== "returned" ||
        r.outcome !== "current" ||
        !reconstructionHeadsCurrent(env, q.payload.state) ||
        env.currentVersion(s.proposal.id) !== s.proposal.version ||
        !env.accepted?.(pid, s.proposal) ||
        !env
          .projectSelections?.(pid)
          .some(
            (x) =>
              x.slot === "reconstruction:" + s.workUnit.id &&
              same(x.ref, s.proposal),
          )
      )
        throw new Error(
          "Reconstruction review lacks current explicit acceptance",
        );
    }
  }
}
