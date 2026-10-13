import type {
  NodePacket,
  DesignArtifact,
  ModuleProject,
  Value,
  VersionRef,
  VisualOS,
} from "../../kernel/contracts.ts";
import { canonical, digest, reference } from "../../kernel/packets.ts";
import {
  record,
  string,
  list,
  integer,
  choice,
  InputError,
} from "../../service/validation.ts";
import { exactRef, hash } from "./exploration-contracts.ts";
export const memoryRoles = {
  "project-handoff-note": "work-record",
  "project-continuation-capsule": "work-record",
} as const;
export const MEMORY_LIMITS = {
  inventory: 4096,
  snapshot: 2048,
  page: 50,
  text: 4000,
  links: 16,
  evidenceBytes: 262144,
  downloadBytes: 2097152,
} as const;
export interface EvidenceLink {
  ref: VersionRef;
  integrity: string;
}
export interface HandoffNote {
  version: 1;
  scope: VersionRef | null;
  text: string;
  source: "human-authored";
  evidence: EvidenceLink[];
}
export interface EvidenceEntry {
  ref: VersionRef;
  integrity: string | null;
  latestVersion: number | null;
  type: string;
  kind: string;
  status: "available" | "missing" | "corrupt";
  summary: Value | null;
  media: "available" | "unavailable" | "not-applicable";
}
export interface MemoryEvent {
  sequence: number;
  kind: string;
  subject: VersionRef;
  related: VersionRef[];
}
export interface MemoryIndex {
  version: 1;
  authority: "navigation-only";
  project: VersionRef;
  scope: VersionRef | null;
  entries: EvidenceEntry[];
  events: MemoryEvent[];
  acceptance: { slot: string; ref: VersionRef }[];
  digest: string;
  coverage: {
    entries: number;
    events: number;
    unsupported: number;
    omitted: number;
    mediaIncluded: false;
    context: "supported canonical records only; no chat, account or process cache";
  };
}
export interface Capsule {
  version: 1;
  scope: VersionRef | null;
  previous: VersionRef | null;
  snapshot: MemoryIndex;
}
export const evidenceKey = (r: VersionRef) => r.id + ":" + r.version;
export function noteText(x: unknown) {
  const s = string(x, MEMORY_LIMITS.text);
  if (/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s))
    throw new InputError("Use plain note text");
  return s;
}
export function parseLink(x: unknown): EvidenceLink {
  const r = record(x, ["ref", "integrity"]);
  return { ref: exactRef(r["ref"]), integrity: hash(r["integrity"]) };
}
export function parseNote(x: unknown): HandoffNote {
  const r = record(x, ["version", "scope", "text", "source", "evidence"]);
  if (r["version"] !== 1) throw new InputError("Note schema version");
  const evidence = list(r["evidence"], parseLink, MEMORY_LIMITS.links);
  if (new Set(evidence.map((e) => evidenceKey(e.ref))).size !== evidence.length)
    throw new InputError("Duplicate evidence");
  return {
    version: 1,
    scope: r["scope"] === null ? null : exactRef(r["scope"]),
    text: noteText(r["text"]),
    source: choice(r["source"], ["human-authored"]),
    evidence,
  };
}
export function indexDigest(x: Omit<MemoryIndex, "digest"> | MemoryIndex) {
  const { digest: _, ...body } = x as MemoryIndex;
  return digest(body);
}
export function parseIndex(x: unknown): MemoryIndex {
  const r = record(x, [
    "version",
    "authority",
    "project",
    "scope",
    "entries",
    "events",
    "acceptance",
    "digest",
    "coverage",
  ]);
  if (r["version"] !== 1) throw new InputError("Index schema version");
  const entries = list(
    r["entries"],
    (x) => {
      const e = record(x, [
        "ref",
        "integrity",
        "latestVersion",
        "type",
        "kind",
        "status",
        "summary",
        "media",
      ]);
      canonical(e["summary"]);
      return {
        ref: exactRef(e["ref"]),
        integrity: e["integrity"] === null ? null : hash(e["integrity"]),
        latestVersion:
          e["latestVersion"] === null
            ? null
            : integer(e["latestVersion"], Number.MAX_SAFE_INTEGER),
        type: string(e["type"], 80),
        kind: string(e["kind"], 80),
        status: choice(e["status"], ["available", "missing", "corrupt"]),
        summary: e["summary"] as Value,
        media: choice(e["media"], [
          "available",
          "unavailable",
          "not-applicable",
        ]),
      };
    },
    MEMORY_LIMITS.inventory,
  );
  if (
    new Set(entries.map((e) => evidenceKey(e.ref))).size !== entries.length ||
    entries.some((e, i) => i > 0 && compare(entries[i - 1]!, e) >= 0)
  )
    throw new InputError("Index ordering/identity");
  const events = list(
    r["events"],
    (x) => {
      const e = record(x, ["sequence", "kind", "subject", "related"]);
      return {
        sequence: integer(e["sequence"], Number.MAX_SAFE_INTEGER),
        kind: choice(e["kind"], [
          "revision",
          "selection",
          "acceptance",
          "legacy-import",
        ]),
        subject: exactRef(e["subject"]),
        related: list(e["related"], exactRef, 100),
      };
    },
    MEMORY_LIMITS.inventory,
  );
  if (events.some((e, i) => i > 0 && events[i - 1]!.sequence >= e.sequence))
    throw new InputError("Event ordering");
  const c = record(r["coverage"], [
    "entries",
    "events",
    "unsupported",
    "omitted",
    "mediaIncluded",
    "context",
  ]);
  for (const k of ["entries", "events", "unsupported", "omitted"])
    if (!Number.isSafeInteger(c[k]) || Number(c[k]) < 0)
      throw new InputError("Coverage count");
  if (
    c["entries"] !== entries.length ||
    c["events"] !== events.length ||
    c["omitted"] !== 0 ||
    c["mediaIncluded"] !== false ||
    c["context"] !==
      "supported canonical records only; no chat, account or process cache"
  )
    throw new InputError("Coverage mismatch");
  const out: MemoryIndex = {
    version: 1,
    authority: choice(r["authority"], ["navigation-only"]),
    project: exactRef(r["project"]),
    scope: r["scope"] === null ? null : exactRef(r["scope"]),
    entries,
    events,
    acceptance: list(
      r["acceptance"],
      (x) => {
        const a = record(x, ["slot", "ref"]);
        return { slot: string(a["slot"], 160), ref: exactRef(a["ref"]) };
      },
      MEMORY_LIMITS.inventory,
    ),
    digest: hash(r["digest"]),
    coverage: c as unknown as MemoryIndex["coverage"],
  };
  if (indexDigest(out) !== out.digest)
    throw new InputError("Index digest mismatch");
  return out;
}
export function parseCapsule(x: unknown): Capsule {
  const r = record(x, ["version", "scope", "previous", "snapshot"]);
  if (r["version"] !== 1) throw new InputError("Capsule schema version");
  const out: Capsule = {
    version: 1,
    scope: r["scope"] === null ? null : exactRef(r["scope"]),
    previous: r["previous"] === null ? null : exactRef(r["previous"]),
    snapshot: parseIndex(r["snapshot"]),
  };
  if (
    canonical(out.scope) !== canonical(out.snapshot.scope) ||
    out.snapshot.entries.length > MEMORY_LIMITS.snapshot ||
    new TextEncoder().encode(canonical(out)).byteLength >
      MEMORY_LIMITS.downloadBytes
  )
    throw new InputError("Capsule scope/size limit");
  return out;
}
export const compare = (a: EvidenceEntry, b: EvidenceEntry) =>
  a.ref.id < b.ref.id
    ? -1
    : a.ref.id > b.ref.id
      ? 1
      : a.ref.version - b.ref.version;
export function memoryKind(p: NodePacket<unknown>) {
  return p.type === "module-project"
    ? "module-project"
    : p.type === "visual-os"
      ? "visual-os"
      : String((p.payload as DesignArtifact<unknown>).kind ?? p.type);
}
const fullKinds = new Set([
  "auxiliary-scope", "auxiliary-turn", "auxiliary-proposal", "auxiliary-action", "auxiliary-bridge",
  "reconstruction-request", "reconstruction-control", "reconstruction-result", "reconstruction-review",
  "page-work-unit",
  "raster-concept",
  "raster-membership",
  "raster-selections",
  "raster-specification",
  "raster-batch",
  "raster-receipt",
  "raster-metrics",
  "raster-execution-request",
  "raster-execution",
  "raster-execution-receipt",
  "project-handoff-note",
  "project-raster-library-item",
  "project-raster-library-reuse",
]);
/** Whitelisted public continuation projection. Never serialize runtime objects, raw exports or grants. */
export function evidenceSummary(p: NodePacket<unknown>): Value | null {
  const k = memoryKind(p),
    a = p.payload as DesignArtifact<Record<string, Value>>;
  if (k === "module-project") {
    const q = p.payload as ModuleProject;
    return {
      mode: q.mode,
      brand: q.visualOSRef as unknown as Value,
      title: q.localContext["title"]?.override ?? null,
      artifacts: q.artifactRefs as unknown as Value,
    };
  }
  if (k === "visual-os") {
    const q = p.payload as VisualOS;
    return {
      approvedValues: Object.fromEntries(
        Object.entries(q.values)
          .filter(([, v]) => v.approved)
          .map(([k, v]) => [k, v.value]),
      ),
      approval: p.approval,
    };
  }
  if (k === "raster-execution-grant") {
    const s = a.state;
    return {
      revoked: s["revoked"]!,
      expiresAt: s["expiresAt"]!,
      slots: s["slots"]!,
      binding: s["request"]!,
      authority:
        "informational only; original canonical grant required by execution service",
    };
  }
  if (k === "page-media") {
    const s = a.state;
    return {
      image: s["image"]!,
      role: s["role"]!,
      permission: s["permission"]!,
    };
  }
  if (k === "raster-execution")
    return {
      ...a.state,
      continuationObservation:
        "Stored reservations/running markers are unresolved evidence, not proof of current transport activity; active calls and pending deliveries are process-only",
    };
  if (fullKinds.has(k)) return a.state;
  if (
    [
      "website-page",
      "website-design",
      "legacy-snapshot",
      "website-assembly",
      "iteration-bundle",
      "artifact-metadata",
    ].includes(k)
  )
    return {
      type: p.type,
      kind: k,
      approval: p.approval,
      dependencies: p.dependencies as unknown as Value,
      placeholders: p.placeholders as unknown as Value,
    };
  return null;
}
