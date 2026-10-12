import { randomUUID } from "node:crypto";
import type {
  DesignArtifact,
  NodePacket,
  ModuleProject,
  VersionRef,
  Value,
} from "../kernel/contracts.ts";
import {
  canonical,
  digest,
  packet,
  reference,
  revise,
} from "../kernel/packets.ts";
import { record, integer, InputError } from "./validation.ts";
import { exactRef } from "../modules/website/exploration-contracts.ts";
import {
  MEMORY_LIMITS,
  memoryKind,
  evidenceSummary,
  parseNote,
  parseCapsule,
  evidenceKey,
  compare,
  indexDigest,
  type MemoryIndex,
  type HandoffNote,
  type Capsule,
  type EvidenceEntry,
} from "../modules/website/memory-contracts.ts";
import type { Workspace } from "./workspace.ts";
type Work<T> = NodePacket<DesignArtifact<T>>;
const repack = <T>(p: NodePacket<T>, deps: VersionRef[]) => {
  const { integrity: _, ...body } = p;
  return packet({ ...body, dependencies: unique(deps) });
};
const pin = (r: VersionRef): VersionRef => ({ ...r, freshness: "pinned" });
const sameRef = (a: VersionRef | null | undefined, b: VersionRef) =>
  a?.id === b.id && a.version === b.version;
const unique = (refs: VersionRef[]) => [
  ...new Map(refs.map((r) => [evidenceKey(r), r])).values(),
];
const offset = (x: unknown) => {
  if (
    !Number.isSafeInteger(x) ||
    Number(x) < 0 ||
    Number(x) > MEMORY_LIMITS.inventory
  )
    throw new InputError("Invalid memory offset");
  return Number(x);
};
/** A derived navigator over existing authority. No executor, filesystem exporter, or task system. */
export class ProjectMemory {
  readonly w: Workspace;
  constructor(w: Workspace) {
    this.w = w;
  }
  private scope(pid: string, x: unknown): VersionRef | null {
    this.w.project(pid);
    if (x === null) return null;
    const r = exactRef(x),
      p = this.w.kernel.lookup(r);
    if (!p || p.projectId !== pid || memoryKind(p) !== "page-work-unit")
      throw new InputError("Foreign or missing memory page");
    return r;
  }
  private inventory(pid: string, excludeCapsules = true) {
    this.w.project(pid);
    const refs = this.w.kernel.projectRefs(
      pid,
      MEMORY_LIMITS.inventory,
      excludeCapsules,
    );
    return refs.map((r) => {
      try {
        return { ref: r, packet: this.w.kernel.lookup(r), corrupt: false };
      } catch {
        return { ref: r, packet: null, corrupt: true };
      }
    });
  }
  private authorized(
    pid: string,
    r: VersionRef,
    rows: ReturnType<ProjectMemory["inventory"]>,
  ) {
    const p = this.w.kernel.lookup(r);
    if (!p) return null;
    if (p.projectId === pid) return p;
    if (p.type !== "visual-os" || p.approval !== "accepted")
      throw new InputError("Foreign memory evidence", 403);
    const attached = rows.some(
      ({ packet: p }) =>
        p &&
        ((p.type === "module-project" &&
          sameRef((p.payload as ModuleProject).visualOSRef, r)) ||
          (memoryKind(p) === "raster-specification" &&
            sameRef(
              (p.payload as Work<{ brand: { source?: VersionRef } }>["payload"])
                .state.brand?.source,
              r,
            ))),
    );
    if (!attached)
      throw new InputError("Brand outside approved project context", 403);
    return p;
  }
  private entry(
    pid: string,
    r: VersionRef,
    rows: ReturnType<ProjectMemory["inventory"]>,
    expected: string | null = null,
  ): EvidenceEntry {
    let p: NodePacket<unknown> | null;
    try {
      p = this.authorized(pid, r, rows);
    } catch (e) {
      if (e instanceof InputError) throw e;
      return {
        ref: r,
        integrity: expected,
        latestVersion: this.w.kernel.currentVersion(r.id),
        type: "unknown",
        kind: "unknown",
        status: "corrupt",
        summary: null,
        media: "not-applicable",
      };
    }
    if (!p)
      return {
        ref: r,
        integrity: expected,
        latestVersion: this.w.kernel.currentVersion(r.id),
        type: "unknown",
        kind: "unknown",
        status: "missing",
        summary: null,
        media: "not-applicable",
      };
    if (expected && expected !== p.integrity)
      return {
        ref: r,
        integrity: expected,
        latestVersion: this.w.kernel.currentVersion(r.id),
        type: p.type,
        kind: memoryKind(p),
        status: "corrupt",
        summary: null,
        media: "not-applicable",
      };
    const summary = evidenceSummary(p);
    if (summary === null)
      throw new InputError("Unsupported primary memory evidence");
    let media: EvidenceEntry["media"] = "not-applicable";
    if (p.assets.length)
      media = p.assets.every(
        (a) =>
          this.w.assets.exists(a.id, a.checksum) ||
          this.w.legacy.exists(a.id, a.checksum),
      )
        ? "available"
        : "unavailable";
    return {
      ref: r,
      integrity: p.integrity,
      latestVersion: this.w.kernel.currentVersion(r.id),
      type: p.type,
      kind: memoryKind(p),
      status: "available",
      summary,
      media,
    };
  }
  index(pid: string, scopeInput: unknown = null): MemoryIndex {
    const scope = this.scope(pid, scopeInput),
      rows = this.inventory(pid),
      entries = new Map<string, EvidenceEntry>();
    const unsupported = new Set<string>();
    const related = (p: NodePacket<unknown>) => {
      if (!scope) return true;
      const k = memoryKind(p),
        s = (p.payload as DesignArtifact<Record<string, unknown>>).state;
      return (
        p.type === "module-project" ||
        (k === "page-work-unit" && p.id === scope.id) ||
        (k === "project-handoff-note" &&
          (!s["scope"] || (s["scope"] as VersionRef).id === scope.id)) ||
        (s &&
          typeof s === "object" &&
          (s["workUnit"] as VersionRef | undefined)?.id === scope.id)
      );
    };
    const add = (r: VersionRef, expected: string | null = null) => {
      r = pin(r);
      const key = evidenceKey(r);
      if (entries.has(key)) return;
      if (entries.size >= MEMORY_LIMITS.inventory)
        throw new InputError(
          "Memory exact closure exceeds inventory bound",
          413,
        );
      const e = this.entry(pid, r, rows, expected);
      entries.set(key, e);
      if (e.status !== "available") return;
      const p = this.w.kernel.lookup(r)!;
      for (const dep of [...p.dependencies, ...p.contextRefs]) {
        let n: NodePacket<unknown> | null = null;
        try {
          n = this.w.kernel.lookup(dep);
        } catch {
          add(dep);
          continue;
        }
        if (n && memoryKind(n) === "project-continuation-capsule") continue;
        if (n && evidenceSummary(n) === null) {
          unsupported.add(evidenceKey(dep));
          continue;
        }
        add(dep);
      }
      if (e.kind === "module-project") {
        const b = (p.payload as ModuleProject).visualOSRef;
        if (b) add(b);
      }
      if (e.kind === "raster-specification") {
        const b = (
          p as Work<{ brand: { enabled: boolean; source?: VersionRef } }>
        ).payload.state.brand;
        if (b.enabled && b.source) add(b.source);
      }
    };
    for (const row of rows) {
      const p = row.packet;
      if (!p) {
        if (!scope) add(row.ref);
        continue;
      }
      if (memoryKind(p) === "project-continuation-capsule") continue;
      if (evidenceSummary(p) === null) {
        if (related(p)) unsupported.add(evidenceKey(row.ref));
        continue;
      }
      if (related(p)) add(row.ref);
    }
    const events = this.w.kernel
      .ledger(pid)
      .events.filter((e) => entries.has(evidenceKey(e.subject)))
      .map((e) => ({
        sequence: e.sequence,
        kind: e.kind,
        subject: pin(e.subject),
        related: e.related.filter((r) => entries.has(evidenceKey(r))).map(pin),
      }));
    if (events.length > MEMORY_LIMITS.inventory)
      throw new InputError("Memory event bound exceeded", 413);
    const body = {
      version: 1 as const,
      authority: "navigation-only" as const,
      project: reference(this.w.project(pid)),
      scope,
      entries: [...entries.values()].sort(compare),
      events,
      acceptance: this.w.kernel
        .acceptedSelections(pid)
        .filter((a) => entries.has(evidenceKey(a.ref)))
        .map((a) => ({ ...a, ref: pin(a.ref) })),
      coverage: {
        entries: entries.size,
        events: events.length,
        unsupported: unsupported.size,
        omitted: 0,
        mediaIncluded: false as const,
        context:
          "supported canonical records only; no chat, account or process cache" as const,
      },
    };
    return { ...body, digest: indexDigest(body) };
  }
  page(pid: string, scope: unknown, from: unknown = 0, limit: unknown = 20) {
    const i = this.index(pid, scope),
      start = offset(from),
      size = integer(limit, MEMORY_LIMITS.page),
      entries = i.entries.slice(start, start + size);
    const output = {
      ...i,
      entries,
      events: [],
      coverage: {
        ...i.coverage,
        returned: entries.length,
        omitted: i.entries.length - entries.length,
        eventCount: i.events.length,
      },
      offset: start,
      next:
        start + entries.length < i.entries.length
          ? start + entries.length
          : null,
    };
    if (Buffer.byteLength(canonical(output)) > MEMORY_LIMITS.downloadBytes)
      throw new InputError(
        "Memory page exceeds 2 MiB; request a smaller page or narrower scope",
        413,
      );
    return output;
  }
  evidence(pid: string, r: VersionRef, integrity: string | null = null) {
    exactRef(r);
    const e = this.entry(pid, r, this.inventory(pid), integrity);
    if (Buffer.byteLength(canonical(e)) > MEMORY_LIMITS.evidenceBytes)
      throw new InputError(
        "Evidence exceeds response bound; use indexed snapshot",
        413,
      );
    return e;
  }
  private read<T>(pid: string, r: VersionRef, kind: string): Work<T> {
    exactRef(r);
    this.w.project(pid);
    const p = this.w.kernel.lookup(r) as Work<T> | null;
    if (!p || p.projectId !== pid || p.payload.kind !== kind)
      throw new InputError("Foreign or missing memory record");
    return p;
  }
  private make<T>(
    pid: string,
    kind: keyof typeof import("../modules/website/memory-contracts.ts").memoryRoles,
    state: T,
    deps: VersionRef[],
  ) {
    return packet({
      type: "work-record",
      id: kind + "-" + randomUUID(),
      projectId: pid,
      dependencies: unique(deps),
      payload: {
        moduleId: "website",
        kind,
        scope: "project-memory",
        lockedValues: {},
        state,
      },
      provenance: {
        actor: "local-operator",
        source: "Explicit local project continuation",
        previous: null,
      },
    });
  }
  saveNote(pid: string, input: unknown) {
    const r = record(input, ["expected", "note"]),
      s = parseNote(r["note"]);
    this.scope(pid, s.scope);
    for (const e of s.evidence) {
      const x = this.evidence(pid, e.ref, e.integrity);
      if (x.status !== "available")
        throw new InputError("Note evidence unavailable");
    }
    const old =
      r["expected"] === null
        ? null
        : this.read<HandoffNote>(
            pid,
            exactRef(r["expected"]),
            "project-handoff-note",
          );
    if (old && this.w.kernel.currentVersion(old.id) !== old.version)
      throw new InputError(
        "Saved note changed. Draft retained; inspect current note before explicitly editing its revision.",
        409,
      );
    const deps = [
      ...(s.scope ? [s.scope] : []),
      ...s.evidence.map((e) => e.ref),
    ];
    const p = old
      ? repack(
          revise(
            old,
            { ...old.payload, state: s },
            "local-operator",
            "Explicit human handoff note revision",
          ),
          deps,
        )
      : this.make(pid, "project-handoff-note", s, deps);
    return this.w.kernel.put(p);
  }
  createCapsule(pid: string, input: unknown) {
    const r = record(input, ["scope", "previous"]),
      scope = this.scope(pid, r["scope"]);
    const previous =
      r["previous"] === null
        ? null
        : this.read<Capsule>(
            pid,
            exactRef(r["previous"]),
            "project-continuation-capsule",
          );
    if (
      previous &&
      canonical(previous.payload.state.scope) !== canonical(scope)
    )
      throw new InputError("Refresh scope mismatch");
    const snapshot = this.index(pid, scope);
    if (snapshot.entries.length > MEMORY_LIMITS.snapshot)
      throw new InputError(
        "Snapshot exceeds 2048 evidence entries. Use a narrower page scope; nothing was saved.",
        413,
      );
    const s = parseCapsule({
      version: 1,
      scope,
      previous: previous ? reference(previous) : null,
      snapshot,
    });
    const deps = [
      snapshot.project,
      ...(scope ? [scope] : []),
      ...(previous ? [reference(previous)] : []),
      ...snapshot.entries
        .filter((e) => e.status === "available")
        .map((e) => e.ref),
    ];
    return this.w.kernel.put(
      this.make(pid, "project-continuation-capsule", s, deps),
    );
  }
  capsule(pid: string, r: VersionRef) {
    const p = this.read<Capsule>(pid, r, "project-continuation-capsule"),
      s = parseCapsule(p.payload.state);
    let latest: MemoryIndex | null = null,
      unavailable = false;
    try {
      latest = this.index(pid, s.scope);
    } catch {
      unavailable = true;
    }
    const rows = this.inventory(pid),
      details = s.snapshot.entries.map((e) => {
        const now = this.entry(pid, e.ref, rows, e.integrity);
        return {
          ref: e.ref,
          status:
            now.status !== "available"
              ? now.status
              : now.media === "unavailable"
                ? "media-unavailable"
                : this.w.kernel.currentVersion(e.ref.id) !== e.latestVersion
                  ? "changed"
                  : "current",
        };
      });
    return {
      ref: reference(p),
      integrity: p.integrity,
      snapshot: s.snapshot,
      previous: s.previous,
      currency: {
        status: unavailable
          ? "unavailable"
          : latest!.digest === s.snapshot.digest
            ? "current"
            : "changed",
        details,
        added: latest
          ? latest.entries.filter(
              (e) =>
                !s.snapshot.entries.some(
                  (old) => evidenceKey(old.ref) === evidenceKey(e.ref),
                ),
            ).length
          : null,
      },
      preview: {
        entries: s.snapshot.entries.length,
        events: s.snapshot.events.length,
        scope: s.scope,
        mediaIncluded: false,
        authority: "navigation-only",
        content:
          "Exact reference index and saved evidence summaries; no media archive, restore support or execution permission",
      },
    };
  }
  download(pid: string, r: VersionRef) {
    const p = this.read<Capsule>(pid, r, "project-continuation-capsule"),
      s = parseCapsule(p.payload.state);
    const output = canonical(s.snapshot) + "\n";
    if (Buffer.byteLength(output) > MEMORY_LIMITS.downloadBytes)
      throw new InputError("Continuation download exceeds 2 MiB", 413);
    return { filename: p.id + ".json", output };
  }
  state(
    pid: string,
    scopeInput: unknown = null,
    from: unknown = 0,
    limit: unknown = MEMORY_LIMITS.page,
  ) {
    const scope = this.scope(pid, scopeInput),
      rows = this.inventory(pid, false),
      latest = rows
        .filter(
          (r) =>
            r.packet &&
            this.w.kernel.currentVersion(r.ref.id) === r.ref.version,
        )
        .map((r) => r.packet!);
    const scoped = (s: { scope: VersionRef | null }) =>
      !scope || !s.scope || s.scope.id === scope.id;
    const order = new Map(
      this.w.kernel.ledger(pid).events.map((e) => [e.subject.id, e.sequence]),
    );
    latest.sort((a, b) => (order.get(b.id) ?? 0) - (order.get(a.id) ?? 0));
    const notes = latest
      .filter(
        (p) =>
          memoryKind(p) === "project-handoff-note" &&
          scoped(parseNote((p.payload as DesignArtifact<unknown>).state)),
      )
      .map((p) => ({
        ref: reference(p),
        integrity: p.integrity,
        note: parseNote((p.payload as DesignArtifact<unknown>).state),
      }));
    const capsules = latest
      .filter(
        (p) =>
          memoryKind(p) === "project-continuation-capsule" &&
          scoped(parseCapsule((p.payload as DesignArtifact<unknown>).state)),
      )
      .map((p) => ({
        ref: reference(p),
        scope: (p as Work<Capsule>).payload.state.scope,
      }));
    const start = offset(from),
      size = integer(limit, MEMORY_LIMITS.page);
    const bounded = (x: unknown[]) => x.slice(start, start + size);
    return {
      scope,
      notes: bounded(notes),
      capsules: bounded(capsules),
      coverage: {
        notes: notes.length,
        capsules: capsules.length,
        offset: start,
        next:
          start + size < Math.max(notes.length, capsules.length)
            ? start + size
            : null,
        omittedNotes: notes.length - bounded(notes).length,
        omittedCapsules: capsules.length - bounded(capsules).length,
      },
      limits: MEMORY_LIMITS,
    };
  }
}
