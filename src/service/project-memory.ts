import { CanonicalMemory, memoryAvailability } from "../kernel/memory-index.ts";
import { randomUUID } from "node:crypto";
import type {
  DesignArtifact,
  NodePacket,
  VersionRef,
} from "../kernel/contracts.ts";
import { canonical, packet, reference, revise } from "../kernel/packets.ts";
import { record, integer, InputError } from "./validation.ts";
import { exactRef } from "../modules/website/exploration-contracts.ts";
import {
  MEMORY_LIMITS,
  memoryKind,
  parseNote,
  parseCapsule,
  evidenceKey,
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
  private canonical() {
    return new CanonicalMemory(this.w.kernel.environment());
  }
  private scope(pid: string, x: unknown) {
    this.w.project(pid);
    return this.canonical().scope(pid, x);
  }
  private inventory(pid: string, excludeCapsules = true) {
    this.w.project(pid);
    return this.canonical().inventory(pid, excludeCapsules);
  }
  private entry(
    pid: string,
    r: VersionRef,
    rows: ReturnType<CanonicalMemory["inventory"]>,
    expected: string | null = null,
  ) {
    return this.canonical().entry(pid, r, rows, expected);
  }
  index(pid: string, scopeInput: unknown = null): MemoryIndex {
    this.w.project(pid);
    return this.canonical().index(pid, scopeInput);
  }
  page(pid: string, scope: unknown, from: unknown = 0, limit: unknown = 20) {
    const i = this.index(pid, scope),
      start = offset(from),
      size = integer(limit, MEMORY_LIMITS.page),
      entries = i.entries.slice(start, start + size);
    const output = {
      ...i,
      availability: memoryAvailability(i),
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
    const availability = memoryAvailability(latest ?? s.snapshot);
    return {
      ref: reference(p),
      integrity: p.integrity,
      snapshot: s.snapshot,
      previous: s.previous,
      currency: {
        availability,
        status: unavailable
          ? "unavailable"
          : latest!.digest === s.snapshot.digest
            ? availability.missing ||
              availability.corrupt ||
              availability.mediaUnavailable
              ? "incomplete"
              : "current"
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
