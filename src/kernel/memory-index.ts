import type {
  DesignArtifact,
  NodePacket,
  ModuleProject,
  VersionRef,
} from "./contracts.ts";
import type { GateEnvironment } from "./gate.ts";
import { reference } from "./packets.ts";
import { exactRef } from "../modules/website/exploration-contracts.ts";
import { InputError } from "../service/validation.ts";
import {
  MEMORY_LIMITS,
  memoryKind,
  evidenceSummary,
  evidenceKey,
  compare,
  indexDigest,
  type MemoryIndex,
  type EvidenceEntry,
} from "../modules/website/memory-contracts.ts";
type Work<T> = NodePacket<DesignArtifact<T>>;
const pin = (r: VersionRef): VersionRef => ({ ...r, freshness: "pinned" });
const sameRef = (a: VersionRef | null | undefined, b: VersionRef) =>
  a?.id === b.id && a.version === b.version;
const corruptRecord = (e: unknown) =>
  e instanceof SyntaxError ||
  (e instanceof Error && e.message === "stored packet integrity mismatch");
const storageReadFailure = () =>
  new InputError(
    "Canonical memory storage read failed; no corruption outcome inferred",
    503,
  );

/** Deterministic canonical read model shared by service reads and transactional persistence gates. */
export class CanonicalMemory {
  readonly env: GateEnvironment;
  constructor(env: GateEnvironment) {
    this.env = env;
  }
  private owner(pid: string): NodePacket<ModuleProject> {
    const version = this.env.currentVersion(pid),
      p =
        version === null
          ? null
          : (this.env.lookup({
              id: pid,
              version,
              freshness: "pinned",
            }) as NodePacket<ModuleProject> | null);
    if (
      !p ||
      p.type !== "module-project" ||
      p.id !== pid ||
      p.projectId !== pid ||
      p.payload.moduleId !== "website"
    )
      throw new InputError("Unknown memory project");
    return p;
  }
  scope(pid: string, x: unknown): VersionRef | null {
    this.owner(pid);
    if (x === null) return null;
    const r = exactRef(x),
      p = this.env.lookup(r);
    if (!p || p.projectId !== pid || memoryKind(p) !== "page-work-unit")
      throw new InputError("Foreign or missing memory page");
    return r;
  }
  inventory(pid: string, excludeCapsules = true) {
    this.owner(pid);
    if (
      !this.env.projectRefs ||
      !this.env.projectEvents ||
      !this.env.projectSelections
    )
      throw new Error("Canonical memory inventory unavailable");
    let refs: VersionRef[];
    try {
      refs = this.env.projectRefs!(
        pid,
        MEMORY_LIMITS.inventory,
        excludeCapsules,
      );
    } catch (e) {
      if (e instanceof Error && e.message.includes("inventory limit")) throw e;
      throw storageReadFailure();
    }
    return refs.map((r) => {
      try {
        return { ref: r, packet: this.env.lookup(r), corrupt: false };
      } catch (e) {
        if (!corruptRecord(e)) throw storageReadFailure();
        return { ref: r, packet: null, corrupt: true };
      }
    });
  }
  private boundBrand(
    r: VersionRef,
    rows: ReturnType<CanonicalMemory["inventory"]>,
  ) {
    return rows.some(
      ({ packet: p }) =>
        p &&
        ((p.type === "module-project" &&
          sameRef((p.payload as ModuleProject).visualOSRef, r)) ||
          (["raster-specification","reconstruction-request","auxiliary-scope"].includes(memoryKind(p)) &&
            sameRef(
              (p.payload as Work<{ brand: { source?: VersionRef } }>["payload"])
                .state.brand?.source ?? (p.payload as any).state.brand?.ref,
              r,
            ))),
    );
  }
  private authorized(
    pid: string,
    r: VersionRef,
    rows: ReturnType<CanonicalMemory["inventory"]>,
  ) {
    const p = this.env.lookup(r);
    if (!p) {
      if (
        this.env.currentVersion(r.id) !== null &&
        !rows.some((row) => row.ref.id === r.id) &&
        !this.boundBrand(r, rows)
      )
        throw new InputError("Foreign memory evidence", 403);
      return null;
    }
    if (p.projectId === pid) return p;
    if (p.type !== "visual-os" || p.approval !== "accepted")
      throw new InputError("Foreign memory evidence", 403);
    const attached = this.boundBrand(r, rows);
    if (!attached)
      throw new InputError("Brand outside approved project context", 403);
    return p;
  }
  entry(
    pid: string,
    r: VersionRef,
    rows: ReturnType<CanonicalMemory["inventory"]>,
    expected: string | null = null,
  ): EvidenceEntry {
    let p: NodePacket<unknown> | null;
    try {
      p = this.authorized(pid, r, rows);
    } catch (e) {
      if (e instanceof InputError) throw e;
      if (!corruptRecord(e)) throw storageReadFailure();
      if (!rows.some((row) => row.ref.id === r.id) && !this.boundBrand(r, rows))
        throw new InputError("Foreign memory evidence", 403);
      return {
        ref: r,
        integrity: expected,
        latestVersion: this.env.currentVersion(r.id),
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
        latestVersion: this.env.currentVersion(r.id),
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
        latestVersion: this.env.currentVersion(r.id),
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
      media = p.assets.every((a) => this.env.assetExists(a.id, a.checksum))
        ? "available"
        : "unavailable";
    return {
      ref: r,
      integrity: p.integrity,
      latestVersion: this.env.currentVersion(r.id),
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
          ((s["workUnit"] as VersionRef | undefined)?.id === scope.id || (['production-review-draft','production-review-submission'].includes(k) && (s['scope'] as {workUnit?:VersionRef}|undefined)?.workUnit?.id===scope.id)))
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
      const p = this.env.lookup(r)!;
      for (const dep of [...p.dependencies, ...p.contextRefs]) {
        let n: NodePacket<unknown> | null = null;
        try {
          n = this.env.lookup(dep);
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
      if (["raster-specification","reconstruction-request","auxiliary-scope"].includes(e.kind)) {
        const b = (
          p as Work<{ brand: { enabled: boolean; source?: VersionRef } }>
        ).payload.state.brand;
        if (b?.enabled && b.source) add(b.source);
        if ((b as any)?.ref) add((b as any).ref);
      }
    };
    for (const row of rows) {
      const p = row.packet;
      if (!p) {
        add(row.ref); // Owner is known; damaged primary evidence has unknown page scope.
        continue;
      }
      if (memoryKind(p) === "project-continuation-capsule") continue;
      if (evidenceSummary(p) === null) {
        if (related(p)) unsupported.add(evidenceKey(row.ref));
        continue;
      }
      if (related(p)) add(row.ref);
    }
    const events = this.env.projectEvents!(pid)
      .filter((e) => entries.has(evidenceKey(e.subject)))
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
      project: reference(this.owner(pid)),
      scope,
      entries: [...entries.values()].sort(compare),
      events,
      acceptance: this.env.projectSelections!(pid)
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
}
export function memoryAvailability(index: MemoryIndex) {
  return {
    missing: index.entries.filter((e) => e.status === "missing").length,
    corrupt: index.entries.filter((e) => e.status === "corrupt").length,
    mediaUnavailable: index.entries.filter((e) => e.media === "unavailable")
      .length,
    unknownScope: index.entries.filter((e) => e.type === "unknown").length,
  };
}
