import type { Workspace } from "./workspace.ts";
import type {
  DesignArtifact,
  NodePacket,
  VersionRef,
} from "../kernel/contracts.ts";
import { canonical, packet, reference } from "../kernel/packets.ts";
import { revalidatePacket, writePort } from "../kernel/gate.ts";
import { librarySource } from "../kernel/library-gate.ts";
import { CanonicalMemory } from "../kernel/memory-index.ts";
import { record, integer, InputError } from "./validation.ts";
import {
  exactRef,
  hash,
  type RasterConcept,
  type Membership,
} from "../modules/website/exploration-contracts.ts";
import {
  parseLibraryItem,
  parseRasterManifest,
  libraryItemId,
  libraryReuseKey,
  rasterExtension,
  rasterMime,
  type LibraryItem,
  type LibraryReuse,
  type LibraryKind,
  type LibraryPacket,
  type RasterManifest,
} from "../modules/website/library-contracts.ts";
import { tar } from "./handoff.ts";
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
/** Project-local canonical work records; no provider, archive import or second database. */
export class RasterLibrary {
  readonly w: Workspace;
  constructor(w: Workspace) {
    this.w = w;
  }
  private own<T>(
    pid: string,
    r: VersionRef,
    type: string,
    kind: string,
  ): NodePacket<DesignArtifact<T>> {
    this.w.project(pid);
    exactRef(r);
    const p = this.w.kernel.get<DesignArtifact<T>>(r);
    if (p.projectId !== pid || p.type !== type || p.payload.kind !== kind)
      throw new InputError("Foreign Library source or page", 403);
    revalidatePacket(p, writePort(p.type), this.w.kernel.environment());
    return p;
  }
  private page(pid: string, r: VersionRef, current = false) {
    const p = this.own(pid, r, "work-record", "page-work-unit");
    if (current && this.w.kernel.currentVersion(p.id) !== p.version)
      throw new InputError("Page changed; reload", 409);
    return p;
  }
  private make<T>(
    pid: string,
    kind: LibraryKind,
    id: string,
    state: T,
    dependencies: VersionRef[],
    assets: { id: string; checksum: string }[] = [],
  ): LibraryPacket<T> {
    return packet({
      type: "work-record",
      id,
      projectId: pid,
      dependencies,
      assets,
      payload: {
        moduleId: "website",
        kind,
        scope: "project-raster-library",
        lockedValues: {},
        state,
      },
      provenance: {
        actor: "local-operator",
        source:
          "Explicit project-local whole-raster " +
          (kind.endsWith("item") ? "save" : "reuse"),
        previous: null,
      },
    });
  }
  private membership(pid: string, candidate: VersionRef): VersionRef {
    const rows = new CanonicalMemory(this.w.kernel.environment()).inventory(
      pid,
    );
    const memberships = rows
      .flatMap(({ packet: p }) =>
        p?.type === "work-record" &&
        (p.payload as DesignArtifact<unknown>).kind === "raster-membership"
          ? [p as NodePacket<DesignArtifact<Membership>>]
          : [],
      )
      .filter((p) => same(p.payload.state.candidate, candidate));
    if (!memberships.length)
      throw new InputError("Candidate has no canonical page membership");
    return reference(memberships[0]!); // Stable ledger inventory order; exact identity is frozen on save.
  }
  private async source(
    pid: string,
    unit: VersionRef,
    candidate: VersionRef,
    integrity: string,
  ): Promise<LibraryItem> {
    this.page(pid, unit);
    const c = this.own<RasterConcept>(
      pid,
      candidate,
      "design-artifact",
      "raster-concept",
    );
    if (c.integrity !== integrity)
      throw new InputError(
        "Focused candidate changed or integrity differs",
        409,
      );
    await this.w.assets.inspect(c.payload.state.image);
    return librarySource(
      this.w.kernel.environment(),
      pid,
      candidate,
      integrity,
      this.membership(pid, candidate),
    );
  }
  async save(pid: string, input: unknown) {
    const r = record(input, [
        "expectedProject",
        "unit",
        "candidate",
        "integrity",
        "extent",
      ]),
      project = exactRef(r["expectedProject"]),
      unit = exactRef(r["unit"]),
      candidate = exactRef(r["candidate"]),
      integrity = hash(r["integrity"]);
    if (r["extent"] !== "whole")
      throw new InputError(
        "Choose whole raster explicitly; crop export is unavailable",
      );
    this.w.project(pid, project);
    this.page(pid, unit, true);
    const id = libraryItemId(pid, candidate, integrity),
      prior = this.w.kernel.lookup({ id, version: 1, freshness: "pinned" });
    if (prior) {
      const item = await this.readyItem(pid, reference(prior), prior.integrity);
      this.w.project(pid, project);
      this.page(pid, unit, true);
      return { item, duplicate: true };
    }
    const s = await this.source(pid, unit, candidate, integrity);
    this.w.project(pid, project);
    this.page(pid, unit, true);
    const existing = this.w.kernel.lookup({
      id,
      version: 1,
      freshness: "pinned",
    });
    if (existing) {
      const item = this.item(pid, reference(existing), existing.integrity);
      return { item, duplicate: true };
    }
    const item = this.make(
      pid,
      "project-raster-library-item",
      id,
      s,
      [s.workUnit, s.candidate, s.membership, s.media],
      [{ id: s.image.id, checksum: s.image.checksum }],
    );
    this.w.kernel.putMany([item], () => {
      this.w.project(pid, project);
      this.page(pid, unit, true);
    });
    return { item, duplicate: false };
  }
  item(pid: string, r: VersionRef, integrity?: string): LibraryPacket {
    const p = this.own<LibraryItem>(
      pid,
      r,
      "work-record",
      "project-raster-library-item",
    );
    parseLibraryItem(p.payload.state);
    if (integrity !== undefined && p.integrity !== integrity)
      throw new InputError("Library item integrity mismatch", 409);
    return p;
  }
  private async readyItem(
    pid: string,
    r: VersionRef,
    integrity: string,
  ): Promise<LibraryPacket> {
    this.w.project(pid);
    exactRef(r);
    const p = this.w.kernel.get<DesignArtifact<LibraryItem>>(r);
    if (
      p.projectId !== pid ||
      p.type !== "work-record" ||
      p.payload.kind !== "project-raster-library-item" ||
      p.integrity !== integrity
    )
      throw new InputError("Foreign or changed Library item", 403);
    // Decode asynchronously before the synchronous gate. Cancel/Revoke can run during cold reads.
    await this.w.assets.inspect(parseLibraryItem(p.payload.state).image);
    return this.item(pid, r, integrity);
  }
  async state(pid: string, offset = 0, limit = 20) {
    this.w.project(pid);
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw new InputError("Library offset");
    integer(limit, 50);
    const rows = new CanonicalMemory(this.w.kernel.environment()).inventory(
        pid,
      ),
      items = rows.filter(
        ({ packet: p }) =>
          p?.type === "work-record" &&
          (p.payload as DesignArtifact<unknown>).kind ===
            "project-raster-library-item",
      );
    const entries: {
      ref: VersionRef;
      integrity: string;
      state: LibraryItem | null;
      status: "available" | "unavailable";
    }[] = [];
    for (const { packet: p } of items.slice(offset, offset + limit)) {
      const item = p as LibraryPacket;
      try {
        entries.push({
          ref: reference(item),
          integrity: item.integrity,
          state: (await this.readyItem(pid, reference(item), item.integrity))
            .payload.state,
          status: "available",
        });
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          String(error.code).startsWith("ERR_SQLITE")
        )
          throw new InputError("Library storage unavailable", 503);
        entries.push({
          ref: reference(item),
          integrity: item.integrity,
          state: null,
          status: "unavailable",
        });
      }
    }
    return {
      entries,
      coverage: {
        total: items.length,
        omitted: items.length - entries.length,
        unknownPrimary: rows.filter((r) => !r.packet).length,
      },
      next:
        offset + entries.length < items.length ? offset + entries.length : null,
    };
  }
  async reuse(pid: string, input: unknown) {
    const r = record(input, ["expectedProject", "unit", "item", "integrity"]),
      project = exactRef(r["expectedProject"]),
      unit = exactRef(r["unit"]),
      itemRef = exactRef(r["item"]),
      integrity = hash(r["integrity"]);
    this.w.project(pid, project);
    this.page(pid, unit, true);
    let item = await this.readyItem(pid, itemRef, integrity);
    this.w.project(pid, project);
    this.page(pid, unit, true);
    item = this.item(pid, itemRef, integrity);
    const key = libraryReuseKey(pid, itemRef, unit),
      id = "raster-library-reuse-" + key,
      existing = this.w.kernel.lookup({ id, version: 1, freshness: "pinned" });
    if (existing) {
      const reuse = this.own<LibraryReuse>(
        pid,
        reference(existing),
        "work-record",
        "project-raster-library-reuse",
      );
      return {
        reuse,
        candidate: this.own<RasterConcept>(
          pid,
          reuse.payload.state.candidate,
          "design-artifact",
          "raster-concept",
        ),
        duplicate: true,
      };
    }
    const s = item.payload.state;
    // Construct an independent media-only proposal. Source artifact is lineage in work records only.
    const c = packet<DesignArtifact<RasterConcept>>({
      type: "design-artifact",
      id: "library-candidate-" + key,
      projectId: pid,
      dependencies: [s.media],
      assets: [{ id: s.image.id, checksum: s.image.checksum }],
      payload: {
        moduleId: "website",
        kind: "raster-concept",
        scope: "page-exploration",
        lockedValues: {},
        state: {
          version: 1,
          representation: "raster-v1",
          media: s.media,
          image: s.image,
          orientation: "encoded-top-left",
          origin: s.origin,
        },
      },
      provenance: {
        actor: "local-operator",
        source: "Explicit Library reuse; original raster origin retained",
        previous: null,
      },
    });
    const m = packet<DesignArtifact<Membership>>({
      type: "work-record",
      id: "library-membership-" + key,
      projectId: pid,
      dependencies: [unit, reference(c), s.candidate],
      payload: {
        moduleId: "website",
        kind: "raster-membership",
        scope: "page-exploration",
        lockedValues: {},
        state: {
          version: 1,
          workUnit: unit,
          candidate: reference(c),
          integrity: c.integrity,
          derivation: [s.candidate],
        },
      },
    });
    const reuse = this.make<LibraryReuse>(
      pid,
      "project-raster-library-reuse",
      id,
      {
        version: 1,
        workUnit: unit,
        item: itemRef,
        itemIntegrity: item.integrity,
        candidate: reference(c),
        candidateIntegrity: c.integrity,
        membership: reference(m),
        membershipIntegrity: m.integrity,
      },
      [itemRef, unit, reference(c), reference(m)],
    );
    this.w.kernel.putMany([c, m, reuse], () => {
      this.w.project(pid, project);
      this.page(pid, unit, true);
      this.item(pid, itemRef, integrity);
    });
    return { reuse, candidate: c, duplicate: false };
  }
  private manifest(
    pid: string,
    s: LibraryItem,
    item: LibraryPacket | null,
  ): RasterManifest {
    return parseRasterManifest({
      version: 1,
      kind: "bve-raster-package",
      authority: "raster-reference-only",
      projectId: pid,
      library: item
        ? { ref: reference(item), integrity: item.integrity }
        : null,
      source: {
        candidate: s.candidate,
        integrity: s.candidateIntegrity,
        workUnit: s.workUnit,
        membership: s.membership,
        membershipIntegrity: s.membershipIntegrity,
        media: s.media,
        mediaIntegrity: s.mediaIntegrity,
      },
      raster: {
        path: "assets/" + s.image.checksum + "." + rasterExtension(s.image),
        mime: rasterMime(s.image),
        extension: rasterExtension(s.image),
        image: s.image,
        orientation: s.orientation,
      },
      provenance: {
        origin: s.origin,
        rights: s.rights,
        generationClaim: "not-established",
        executor: null,
        requestedControls: "not-included",
        inferredControls: "not-included",
      },
    });
  }
  async preview(pid: string, r: VersionRef, integrity: string) {
    const item = await this.readyItem(pid, r, integrity);
    return { item, manifest: this.manifest(pid, item.payload.state, item) };
  }
  async candidatePreview(
    pid: string,
    unit: VersionRef,
    c: VersionRef,
    integrity: string,
  ) {
    const s = await this.source(pid, unit, c, integrity);
    return { manifest: this.manifest(pid, s, null) };
  }
  async export(
    pid: string,
    mode: "original" | "package",
    r: VersionRef,
    integrity: string,
    unit?: VersionRef,
  ) {
    const preview = unit
        ? await this.candidatePreview(pid, unit, r, integrity)
        : await this.preview(pid, r, integrity),
      manifest = preview.manifest;
    const bytes = this.w.assets.read(manifest.raster.image.id);
    // Re-check full decode on this exact read, even if a stored descriptor/cache exists.
    await this.w.assets.inspect(manifest.raster.image);
    if (mode === "original")
      return {
        bytes,
        manifest,
        mime: manifest.raster.mime,
        filename:
          "raster-" +
          manifest.raster.image.checksum +
          "." +
          manifest.raster.extension,
      };
    const description = Buffer.from(canonical(manifest) + "\n");
    if (description.length > 65536)
      throw new InputError("Raster manifest exceeds 64 KiB", 413);
    return {
      bytes: tar(
        new Map([
          ["manifest.json", description],
          [manifest.raster.path, bytes],
        ]),
        "raster",
      ),
      manifest,
      mime: "application/x-tar",
      filename: "raster-" + manifest.raster.image.checksum + ".tar",
    };
  }
}
