import { randomUUID } from "node:crypto";
import type {
  DesignArtifact,
  NodePacket,
  VersionRef,
} from "../kernel/contracts.ts";
import {
  packet,
  reference,
  revise,
  canonical,
  digest,
} from "../kernel/packets.ts";
import { revalidatePacket, writePort } from "../kernel/gate.ts";
import type { Workspace } from "./workspace.ts";
import { checksum } from "../kernel/raster.ts";
import { validateExplorationRecord } from "../modules/website/exploration-contracts.ts";
import {
  validatePageRecord,
  type MediaState,
} from "../modules/website/page.ts";
import { decode } from "./assets.ts";
import {
  InputError,
  record,
  id,
  integer,
  choice,
  list,
  string,
} from "./validation.ts";
import {
  explorationRoles,
  parseWorkUnit,
  parseSelections,
  parseSpecification,
  parseMetrics,
  exactRef,
  hash,
  type ExplorationKind,
  type WorkUnit,
  type RasterConcept,
  type Selections,
  type Specification,
  type Batch,
  type Receipt,
  type Membership,
  type Metrics,
} from "../modules/website/exploration-contracts.ts";
type Work<T> = NodePacket<DesignArtifact<T>>;
const envelope = <T>(p: NodePacket<T>, deps: VersionRef[]): NodePacket<T> => {
  const { integrity: _, ...body } = p;
  return packet({ ...body, dependencies: unique(deps) });
};
const unique = (refs: VersionRef[]) => [
  ...new Map(refs.map((r) => [r.id + ":" + r.version, r])).values(),
];

/** Offline record controller. No HTTP routes, provider, scheduler or automatic retry. */
export class Exploration {
  readonly w: Workspace;
  constructor(w: Workspace) {
    this.w = w;
  }
  private own<T>(
    projectId: string,
    r: VersionRef,
    kind: ExplorationKind,
  ): Work<T> {
    exactRef(r);
    this.w.project(projectId);
    const p = this.w.kernel.get<DesignArtifact<T>>(r);
    if (
      p.projectId !== projectId ||
      p.type !== explorationRoles[kind] ||
      p.payload.kind !== kind
    )
      throw new InputError("Foreign exploration reference");
    revalidatePacket(p, writePort(p.type), this.w.kernel.environment());
    return p;
  }
  private current<T>(
    projectId: string,
    r: VersionRef,
    kind: ExplorationKind,
  ): Work<T> {
    const p = this.own<T>(projectId, r, kind);
    if (this.w.kernel.currentVersion(p.id) !== p.version)
      throw new InputError("Stale exploration revision", 409);
    return p;
  }
  private make<T>(
    projectId: string,
    kind: ExplorationKind,
    state: T,
    deps: VersionRef[] = [],
    assets: { id: string; checksum: string }[] = [],
  ): Work<T> {
    return packet({
      type: explorationRoles[kind],
      id: kind + "-" + randomUUID(),
      projectId,
      dependencies: unique(deps),
      assets,
      payload: {
        moduleId: "website",
        kind,
        scope: "page-exploration",
        lockedValues: {},
        state,
      },
      provenance: {
        actor: "local-operator",
        source: "Explicit offline exploration record",
        previous: null,
      },
    });
  }
  createWorkUnit(projectId: string, input: unknown): Work<WorkUnit> {
    this.w.project(projectId);
    const p = this.make(projectId, "page-work-unit", parseWorkUnit(input));
    this.w.kernel.put(p);
    return p;
  }
  read<T>(projectId: string, r: VersionRef, kind: ExplorationKind): Work<T> {
    return this.own(projectId, r, kind);
  }
  private membership(
    projectId: string,
    unit: VersionRef,
    c: Work<RasterConcept>,
    derivation: VersionRef[] = [],
  ): Work<Membership> {
    return this.make(
      projectId,
      "raster-membership",
      {
        version: 1,
        workUnit: unit,
        candidate: reference(c),
        integrity: c.integrity,
        derivation,
      },
      [unit, reference(c), ...derivation],
    );
  }
  async importCandidate(
    projectId: string,
    unit: VersionRef,
    bytes: Buffer,
    permission: string,
    origin: RasterConcept["origin"] = "imported",
    previous: VersionRef | null = null,
    expectedProject?: VersionRef,
  ): Promise<Work<RasterConcept>> {
    this.current(projectId, unit, "page-work-unit");
    choice(origin, ["synthetic", "imported", "semantic-screenshot"]);
    const old = previous
      ? this.current<RasterConcept>(projectId, previous, "raster-concept")
      : null;
    if (
      old &&
      !this.state(projectId, unit).some(
        (p) =>
          p.payload &&
          (p.payload as DesignArtifact<unknown>).kind === "raster-membership" &&
          canonical(
            (p.payload as DesignArtifact<Membership>).state.candidate,
          ) === canonical(previous),
      )
    )
      throw new InputError("Candidate revision belongs to another work unit");
    const image = await decode(bytes);
    this.w.project(projectId, expectedProject);
    this.current(projectId, unit, "page-work-unit");
    if (old) this.current(projectId, previous!, "raster-concept");
    string(permission);
    const m = packet({
      type: "media-asset",
      id: "page-media-" + randomUUID(),
      projectId,
      assets: [{ id: image.id, checksum: image.checksum }],
      payload: {
        moduleId: "website",
        kind: "page-media",
        scope: "media",
        lockedValues: {},
        state: {
          image,
          label: "Raster concept media",
          role: "placeable",
          permission,
        },
      },
    });
    const initial = this.make<RasterConcept>(
      projectId,
      "raster-concept",
      {
        version: 1,
        representation: "raster-v1",
        media: reference(m),
        image,
        orientation: "encoded-top-left",
        origin,
      },
      [reference(m)],
      [{ id: image.id, checksum: image.checksum }],
    );
    const c = old
      ? envelope(
          revise(
            old,
            { ...old.payload, state: initial.payload.state },
            "local-operator",
            "New exact raster revision",
          ),
          [reference(m)],
        )
      : initial;
    const { integrity: _, ...body } = c;
    const bound = packet({ ...body, assets: initial.assets });
    this.w.assets.save(bytes, image);
    this.w.kernel.putMany([m, bound, this.membership(projectId, unit, bound)]);
    return bound;
  }
  async raster(
    projectId: string,
    r: VersionRef,
  ): Promise<{ bytes: Buffer; state: RasterConcept }> {
    const c = this.own<RasterConcept>(projectId, r, "raster-concept");
    const media = this.w.kernel.get<DesignArtifact<MediaState>>(
      c.payload.state.media,
    );
    const bytes = this.w.assets.read(c.payload.state.image.id);
    return {
      bytes: await reconstructRaster(c, media, bytes),
      state: c.payload.state,
    };
  }
  selections(
    projectId: string,
    input: unknown,
    previous: VersionRef | null = null,
  ): Work<Selections> {
    const s = parseSelections(input);
    this.current(projectId, s.workUnit, "page-work-unit");
    const deps = [s.workUnit];
    for (const e of s.entries) {
      const c = this.own<RasterConcept>(
        projectId,
        e.candidate,
        "raster-concept",
      );
      deps.push(e.candidate, c.payload.state.media);
    }
    const old = previous
      ? this.current<Selections>(projectId, previous, "raster-selections")
      : null;
    const p = old
      ? revise(
          old,
          { ...old.payload, state: s },
          "local-operator",
          "Revise exact selections/notes",
        )
      : this.make(projectId, "raster-selections", s);
    const next = envelope(p, deps);
    this.w.kernel.put(next);
    return next;
  }
  private specificationPacket(
    projectId: string,
    input: unknown,
  ): Work<Specification> {
    const s = parseSpecification(input);
    this.w.project(projectId, s.project);
    this.current(projectId, s.workUnit, "page-work-unit");
    const deps = [s.project, s.workUnit];
    if (s.selections) {
      const sel = this.current<Selections>(
        projectId,
        s.selections,
        "raster-selections",
      );
      deps.push(s.selections);
      for (const e of sel.payload.state.entries) {
        const c = this.own<RasterConcept>(
          projectId,
          e.candidate,
          "raster-concept",
        );
        deps.push(e.candidate, c.payload.state.media);
      }
    }
    deps.push(...s.resources.map((r) => r.media));
    if (s.brand.enabled) deps.push(s.brand.source);
    const q = this.make(projectId, "raster-specification", s, deps);
    return q;
  }
  freeze(projectId: string, input: unknown): Work<Specification> {
    const q = this.specificationPacket(projectId, input);
    this.w.kernel.put(q);
    return q;
  }
  /** One transaction: a rejected preparation never leaves a frozen orphan specification. */
  prepareOperation(
    projectId: string,
    input: unknown,
  ): { specification: Work<Specification>; batch: Work<Batch> } {
    const q = this.specificationPacket(projectId, input);
    const b = this.batchPacket(projectId, q, null);
    this.w.kernel.putMany([q, b]);
    return { specification: q, batch: b };
  }
  metrics(
    projectId: string,
    input: unknown,
    previous: VersionRef | null = null,
  ): Work<Metrics> {
    const s = parseMetrics(input);
    const old = previous
      ? this.current<Metrics>(projectId, previous, "raster-metrics")
      : null;
    const p = old
      ? revise(
          old,
          { ...old.payload, state: s },
          "local-operator",
          "Revise version-bound metadata",
        )
      : this.make(projectId, "raster-metrics", s, [s.candidate]);
    this.w.kernel.put(p);
    return p;
  }
  private batchDeps(s: Batch): VersionRef[] {
    return unique([
      s.spec,
      ...(s.retryOf ? [s.retryOf.batch] : []),
      ...s.attempts.flatMap((a) => [
        ...(a.result ? [a.result] : []),
        ...(a.receipt ? [a.receipt] : []),
      ]),
    ]);
  }
  prepareBatch(
    projectId: string,
    spec: VersionRef,
    retryOf: Batch["retryOf"] = null,
  ): Work<Batch> {
    const q = this.own<Specification>(projectId, spec, "raster-specification");
    if (retryOf) this.own(projectId, retryOf.batch, "raster-batch");
    const b = this.batchPacket(projectId, q, retryOf);
    this.w.kernel.put(b);
    return b;
  }
  private batchPacket(
    projectId: string,
    q: Work<Specification>,
    retryOf: Batch["retryOf"],
  ): Work<Batch> {
    const s: Batch = {
      version: 1,
      spec: reference(q),
      specHash: q.integrity,
      workUnit: q.payload.state.workUnit,
      attempts: Array.from({ length: q.payload.state.count }, (_, i) => ({
        slot: i + 1,
        status: "pending",
        result: null,
        receipt: null,
      })),
      retryOf,
      executionAuthorization: null,
      harness: "synthetic-registration",
    };
    return this.make(projectId, "raster-batch", s, this.batchDeps(s));
  }
  private updateBatch(b: Work<Batch>, s: Batch): Work<Batch> {
    const p = revise(
      b,
      { ...b.payload, state: s },
      "local-operator",
      "Record offline synthetic attempt transition",
    );
    return envelope(p, this.batchDeps(s));
  }
  markRunning(projectId: string, batch: VersionRef, slot: number): Work<Batch> {
    const b = this.current<Batch>(projectId, batch, "raster-batch"),
      s = structuredClone(b.payload.state),
      a = s.attempts[integer(slot, 6) - 1];
    if (!a || a.status !== "pending")
      throw new InputError("Attempt not pending");
    a.status = "running";
    const next = this.updateBatch(b, s);
    this.w.kernel.put(next);
    return next;
  }
  cancel(projectId: string, batch: VersionRef): Work<Batch> {
    const b = this.current<Batch>(projectId, batch, "raster-batch"),
      s = structuredClone(b.payload.state);
    for (const a of s.attempts) {
      if (a.status === "pending") a.status = "cancelled";
      else if (a.status === "running") a.status = "uncertain";
    }
    if (canonical(s) === canonical(b.payload.state)) return b;
    const next = this.updateBatch(b, s);
    this.w.kernel.put(next);
    return next;
  }
  /** Explicit recovery of synthetic running records; opening a store never schedules/replays. */
  recoverSyntheticRunning(projectId: string, batch: VersionRef): Work<Batch> {
    const b = this.current<Batch>(projectId, batch, "raster-batch"),
      s = structuredClone(b.payload.state);
    for (const a of s.attempts)
      if (a.status === "running") a.status = "uncertain";
    if (canonical(s) === canonical(b.payload.state)) return b;
    const next = this.updateBatch(b, s);
    this.w.kernel.put(next);
    return next;
  }
  /** Trusted synthetic envelope is checked before any per-slot salvage. A result is registered only
   * after a complete decode; candidate + receipt + batch transition are one kernel transaction. */
  async registerSynthetic(
    projectId: string,
    input: unknown,
    bytes: Buffer | null = null,
  ): Promise<Work<Receipt>> {
    const r = record(input, [
      "batch",
      "specHash",
      "slot",
      "receiptId",
      "outcome",
      "message",
      "derivation",
    ]);
    const batch = exactRef(r["batch"]),
      specHash = hash(r["specHash"]),
      slot = integer(r["slot"], 6),
      receiptId = id(r["receiptId"]),
      outcome = choice(r["outcome"], ["succeeded", "failed", "uncertain"]),
      message = string(r["message"]),
      derivation = list(r["derivation"], exactRef);
    if (outcome !== "succeeded" && bytes !== null)
      throw new InputError(
        "Non-success envelope cannot contain candidate bytes",
      );
    const submissionHash = digest({
      input: r,
      bytes: bytes ? { checksum: checksum(bytes), length: bytes.length } : null,
    });
    const receiptPacketId = "raster-receipt-" + digest(receiptId);
    const duplicate = (): Work<Receipt> | null => {
      const prior = this.w.kernel.lookup({
        id: receiptPacketId,
        version: 1,
        freshness: "pinned",
      }) as Work<Receipt> | null;
      if (!prior) return null;
      if (
        prior.projectId !== projectId ||
        prior.payload.state.submissionHash !== submissionHash
      )
        throw new InputError("Receipt identity conflict", 409);
      return this.own(projectId, reference(prior), "raster-receipt");
    };
    const prior = duplicate();
    if (prior) return prior;
    const b = this.current<Batch>(projectId, batch, "raster-batch");
    if (b.payload.state.specHash !== specHash)
      throw new InputError("Untrusted spec hash envelope");
    const a = b.payload.state.attempts[slot - 1];
    if (
      !a ||
      a.receipt ||
      !["pending", "running", "cancelled", "uncertain"].includes(a.status)
    )
      throw new InputError("Attempt consumed or invalid slot");
    derivation.forEach((d) => this.own(projectId, d, "raster-concept"));
    let actual: Receipt["outcome"] = outcome,
      result: Work<RasterConcept> | null = null;
    const writes: NodePacket<unknown>[] = [];
    let evidence: Receipt["evidence"] = null;
    const closed = ["cancelled", "uncertain"].includes(a.status);
    if (closed) actual = "uncertain";
    if (outcome === "succeeded") {
      let image: Awaited<ReturnType<typeof decode>> | null = null;
      // Only submission validation can consume a slot as invalid output.
      try {
        if (!bytes) throw new InputError("Missing synthetic raster");
        image = await decode(bytes);
      } catch (error) {
        if (!(error instanceof InputError)) throw error;
        actual = closed ? "uncertain" : "invalid";
      }
      // Storage/integrity failures propagate without committing attempt records.
      if (image) {
        const m = packet({
          type: "media-asset",
          id: "page-media-" + randomUUID(),
          projectId,
          assets: [{ id: image.id, checksum: image.checksum }],
          payload: {
            moduleId: "website",
            kind: "page-media",
            scope: "media",
            lockedValues: {},
            state: {
              image,
              label: "Synthetic attempt output",
              role: closed ? "reference" : "placeable",
              permission: "Synthetic fixture; testing only",
            },
          },
        });
        if (closed) {
          evidence = { media: reference(m), image };
        } else
          result = this.make<RasterConcept>(
            projectId,
            "raster-concept",
            {
              version: 1,
              representation: "raster-v1",
              media: reference(m),
              image,
              orientation: "encoded-top-left",
              origin: "synthetic",
            },
            [reference(m)],
            [{ id: image.id, checksum: image.checksum }],
          );
        this.w.assets.save(bytes!, image);
        if (closed) writes.push(m);
        else
          writes.push(
            m,
            result!,
            this.membership(
              projectId,
              b.payload.state.workUnit,
              result!,
              derivation,
            ),
          );
      }
    }
    // A concurrent identical submission returns the already committed receipt.
    const concurrent = duplicate();
    if (concurrent) return concurrent;
    // Async decoding never grants stale input permission; no historical adoption.
    this.current(projectId, batch, "raster-batch");
    const state: Receipt = {
      version: 1,
      receiptId,
      batch,
      slot,
      specHash,
      submissionHash,
      outcome: actual,
      result: result ? reference(result) : null,
      evidence,
      usage: null,
      message:
        actual === "invalid"
          ? "Synthetic image rejected during full validation"
          : message,
      derivation,
    };
    const proposedReceipt = this.make(projectId, "raster-receipt", state, [
      batch,
      ...(result ? [reference(result)] : []),
      ...(evidence ? [evidence.media] : []),
      ...derivation,
    ]);
    const { integrity: _, ...receiptBody } = proposedReceipt;
    const receipt = packet({ ...receiptBody, id: receiptPacketId });
    const s = structuredClone(b.payload.state);
    s.attempts[slot - 1] = {
      slot,
      status: ["cancelled", "uncertain"].includes(a.status) ? a.status : actual,
      result: state.result,
      receipt: reference(receipt),
    };
    this.w.kernel.putMany([...writes, receipt, this.updateBatch(b, s)]);
    return receipt;
  }
  state(projectId: string, workUnit: VersionRef) {
    this.own(projectId, workUnit, "page-work-unit");
    return this.w.kernel
      .latestPackets()
      .filter(
        (p) =>
          p.projectId === projectId &&
          Object.hasOwn(
            explorationRoles,
            (p.payload as DesignArtifact<unknown>).kind,
          ),
      )
      .filter((p) => {
        const a = p.payload as DesignArtifact<unknown>;
        this.own(projectId, reference(p), a.kind as ExplorationKind);
        return (
          canonical((a.state as { workUnit?: VersionRef }).workUnit ?? null) ===
          canonical(workUnit)
        );
      });
  }
}

/** Standalone reconstruction uses only this raster and its media closure, without a project,
 * source design, ledger, brand context, provider or display-size interpretation. */
export async function reconstructRaster(
  candidate: Work<RasterConcept>,
  media: Work<MediaState>,
  bytes: Buffer,
): Promise<Buffer> {
  for (const p of [candidate, media]) {
    const { integrity, ...body } = p;
    if (digest(body) !== integrity)
      throw new InputError("Raster closure packet integrity mismatch");
  }
  validateExplorationRecord(
    candidate.payload as unknown as Record<string, unknown>,
  );
  if (
    candidate.type !== "design-artifact" ||
    candidate.payload.kind !== "raster-concept" ||
    media.type !== "media-asset" ||
    media.payload.kind !== "page-media" ||
    media.payload.moduleId !== "website" ||
    candidate.projectId !== media.projectId ||
    !validatePageRecord(media.payload as unknown as Record<string, unknown>)
  )
    throw new InputError("Raster closure role/owner mismatch");
  const state = candidate.payload.state,
    inventory = [{ id: state.image.id, checksum: state.image.checksum }];
  if (
    canonical(state.media) !== canonical(reference(media)) ||
    canonical(candidate.dependencies) !== canonical([reference(media)]) ||
    candidate.contextRefs.length ||
    media.dependencies.length ||
    media.contextRefs.length ||
    canonical(candidate.assets) !== canonical(inventory) ||
    canonical(media.assets) !== canonical(inventory) ||
    canonical(state.image) !== canonical(media.payload.state.image) ||
    canonical(await decode(bytes)) !== canonical(state.image)
  )
    throw new InputError("Raster closure media/descriptor mismatch");
  return bytes;
}
