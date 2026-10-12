import { CanonicalMemory } from "./memory-index.ts";
import type {
  NodePacket,
  DesignArtifact,
  ModuleProject,
  VersionRef,
} from "./contracts.ts";
import type { GateEnvironment } from "./gate.ts";
import { canonical, reference } from "./packets.ts";
import {
  memoryRoles,
  memoryKind,
  evidenceSummary,
  parseNote,
  parseCapsule,
} from "../modules/website/memory-contracts.ts";
export function approvedMemoryBrand(
  pid: string,
  r: VersionRef,
  env: GateEnvironment,
) {
  const p = env.lookup(r);
  if (p?.type !== "visual-os" || p.approval !== "accepted") return false;
  const version = env.currentVersion(pid);
  if (!version) return false;
  const project = env.lookup({
    id: pid,
    version,
    freshness: "pinned",
  }) as NodePacket<ModuleProject>;
  if (
    project.payload.visualOSRef?.id === r.id &&
    project.payload.visualOSRef.version === r.version
  )
    return true;
  for (const event of env.projectEvents?.(pid) ?? []) {
    let source: NodePacket<unknown> | null = null;
    try {
      source = env.lookup(event.subject);
    } catch {
      continue;
    }
    if (source?.projectId !== pid) continue;
    const brand =
      source.type === "module-project"
        ? (source.payload as ModuleProject).visualOSRef
        : memoryKind(source) === "raster-specification"
          ? (
              source.payload as DesignArtifact<{
                brand: { source?: VersionRef };
              }>
            ).state.brand.source
          : null;
    if (brand?.id === r.id && brand.version === r.version) return true;
  }
  return false;
}
export function memoryGate(
  p: NodePacket<unknown>,
  previous: NodePacket<unknown> | null,
  env: GateEnvironment,
) {
  const a = p.payload as DesignArtifact<unknown>,
    old = (previous?.payload as DesignArtifact<unknown> | undefined)?.kind;
  if (
    previous &&
    (Object.hasOwn(memoryRoles, a.kind) ||
      Object.hasOwn(memoryRoles, old ?? "")) &&
    old !== a.kind
  )
    throw new Error("Memory semantic kind immutable");
  if (!Object.hasOwn(memoryRoles, a.kind)) return;
  if (
    p.type !== "work-record" ||
    p.approval !== "proposal" ||
    p.assets.length ||
    p.contextRefs.length ||
    p.constraints.length ||
    p.placeholders.length ||
    a.scope !== "project-memory" ||
    Object.keys(a.lockedValues).length
  )
    throw new Error("Memory envelope invalid");
  const deps: VersionRef[] = [];
  const own = (r: VersionRef) => {
    const n = env.lookup(r);
    if (!n || n.projectId !== p.projectId)
      throw new Error("Memory evidence owner mismatch");
    deps.push(r);
    return n;
  };
  if (a.kind === "project-handoff-note") {
    const s = parseNote(a.state);
    if (s.scope) {
      const unit = own(s.scope);
      if (memoryKind(unit) !== "page-work-unit")
        throw new Error("Note scope not page");
    }
    for (const e of s.evidence) {
      const n = env.lookup(e.ref);
      if (
        !n ||
        (n.projectId !== p.projectId &&
          !approvedMemoryBrand(p.projectId!, e.ref, env))
      )
        throw new Error("Memory evidence owner mismatch");
      deps.push(e.ref);
      if (
        n.integrity !== e.integrity ||
        memoryKind(n) === "project-continuation-capsule" ||
        evidenceSummary(n) === null
      )
        throw new Error("Note exact primary evidence mismatch");
    }
    if (
      previous &&
      canonical(
        parseNote((previous.payload as DesignArtifact<unknown>).state).scope,
      ) !== canonical(s.scope)
    )
      throw new Error("Note scope immutable");
  } else {
    const s = parseCapsule(a.state);
    if (previous)
      throw new Error("Capsule immutable; refresh creates new snapshot");
    if (s.snapshot.project.id !== p.projectId)
      throw new Error("Snapshot owner mismatch");
    own(s.snapshot.project);
    if (s.scope && memoryKind(own(s.scope)) !== "page-work-unit")
      throw new Error("Capsule scope not page");
    if (
      s.previous &&
      memoryKind(own(s.previous)) !== "project-continuation-capsule"
    )
      throw new Error("Refresh lineage invalid");
    if (
      s.previous &&
      canonical(
        parseCapsule(
          (env.lookup(s.previous)!.payload as DesignArtifact<unknown>).state,
        ).scope,
      ) !== canonical(s.scope)
    )
      throw new Error("Refresh scope immutable");
    const actualEvents = env.projectEvents?.(p.projectId!) ?? [];
    for (const event of s.snapshot.events) {
      const actual = actualEvents.find((e) => e.sequence === event.sequence);
      if (
        !actual ||
        actual.kind !== event.kind ||
        canonical({ ...actual.subject, freshness: "pinned" }) !==
          canonical(event.subject) ||
        canonical(
          actual.related
            .filter((r) =>
              s.snapshot.entries.some(
                (e) => e.ref.id === r.id && e.ref.version === r.version,
              ),
            )
            .map((r) => ({ ...r, freshness: "pinned" })),
        ) !== canonical(event.related)
      )
        throw new Error("Snapshot event is not canonical");
    }
    const stored = env.lookup(reference(p))?.integrity === p.integrity;
    // Creation alone must cover the independently derived canonical scope. Stored history never
    // compares against today's inventory; immutable snapshot evidence retains its original meaning.
    if(!stored&&canonical(new CanonicalMemory(env).index(p.projectId!,s.scope))!==canonical(s.snapshot))throw new Error('Capsule scoped completeness/coverage mismatch');
    const expectedEvents = actualEvents
      .filter((e) =>
        s.snapshot.entries.some(
          (x) =>
            x.ref.id === e.subject.id && x.ref.version === e.subject.version,
        ),
      )
      .map((e) => ({
        sequence: e.sequence,
        kind: e.kind,
        subject: { ...e.subject, freshness: "pinned" },
        related: e.related
          .filter((r) =>
            s.snapshot.entries.some(
              (x) => x.ref.id === r.id && x.ref.version === r.version,
            ),
          )
          .map((r) => ({ ...r, freshness: "pinned" })),
      }));
    if (!stored && canonical(expectedEvents) !== canonical(s.snapshot.events))
      throw new Error("Snapshot event coverage mismatch");
    const accepted = env.projectSelections?.(p.projectId!) ?? [];
    if (
      !stored &&
      canonical(s.snapshot.acceptance) !==
        canonical(
          accepted
            .filter((a) =>
              s.snapshot.entries.some(
                (e) => e.ref.id === a.ref.id && e.ref.version === a.ref.version,
              ),
            )
            .map((a) => ({ ...a, ref: { ...a.ref, freshness: "pinned" } })),
        )
    )
      throw new Error("Snapshot acceptance is not canonical");
    const brands = new Set<string>();
    for (const e of s.snapshot.entries)
      if (e.status === "available" && e.kind === "raster-specification") {
        const n = env.lookup(e.ref) as NodePacket<
          DesignArtifact<{ brand: { enabled: boolean; source?: VersionRef } }>
        > | null;
        const b = n?.payload.state.brand;
        if (b?.enabled && b.source) brands.add(canonical(b.source));
      }
    for (const e of s.snapshot.entries) {
      if (e.status !== "available") {
        let n: NodePacket<unknown> | null = null;
        let corrupt = false;
        try {
          n = env.lookup(e.ref);
        } catch {
          corrupt = true;
        }
        if (
          e.summary !== null ||
          (e.status === "missing" && (n || corrupt)) ||
          (e.status === "corrupt" && !corrupt && n?.integrity === e.integrity)
        )
          throw new Error("Snapshot unavailable evidence status mismatch");
        continue;
      }
      const n = env.lookup(e.ref);
      if (
        !n ||
        n.integrity !== e.integrity ||
        (!stored && env.currentVersion(e.ref.id) !== e.latestVersion) ||
        memoryKind(n) !== e.kind ||
        n.type !== e.type ||
        memoryKind(n) === "project-continuation-capsule" ||
        canonical(evidenceSummary(n)) !== canonical(e.summary)
      )
        throw new Error("Snapshot canonical evidence mismatch");
      if (
        n.projectId !== p.projectId &&
        !(
          n.type === "visual-os" &&
          n.approval === "accepted" &&
          (brands.has(canonical(e.ref)) ||
            approvedMemoryBrand(p.projectId!, e.ref, env))
        )
      )
        throw new Error("Snapshot foreign evidence");
      deps.push(e.ref);
    }
  }
  if (
    canonical([
      ...new Map(deps.map((r) => [r.id + ":" + r.version, r])).values(),
    ]) !== canonical(p.dependencies)
  )
    throw new Error("Memory exact dependencies mismatch");
}
