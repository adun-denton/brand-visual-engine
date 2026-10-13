import { randomUUID } from "node:crypto";
import type {
  VersionRef,
  DesignArtifact,
  NodePacket,
  VisualOS,
  Value,
} from "../kernel/contracts.ts";
import {
  packet,
  reference,
  revise,
  canonical,
  digest,
} from "../kernel/packets.ts";
import { revalidatePacket, writePort } from "../kernel/gate.ts";
import { librarySource } from "../kernel/library-gate.ts";
import {
  reconstructionHeadsCurrent,
  reconstructionDependencies,
} from "../kernel/reconstruction-gate.ts";
import {
  pageSignature,
  pageFindings,
  preservation,
  type PageState,
  type MediaState,
} from "../modules/website/page.ts";
import { parseLocks } from "../modules/website/inference-contracts.ts";
import { parseSemanticCandidates } from "../modules/website/semantic-candidates.ts";
import {
  reconstructionRoles,
  explicitContext,
  parseReconstructionRequest,
  parseControl,
  parseSubmission,
  parseReconstructionResult,
  parseReview,
  controlId,
  resultId,
  same,
  type ReconstructionRequest,
  type ReconstructionControl,
  type ReconstructionSubmission,
  type ReconstructionResult,
  type ReconstructionKind,
  type Work,
} from "../modules/website/reconstruction-contracts.ts";
import {
  record,
  list,
  string,
  id,
  choice,
  integer,
  InputError,
} from "./validation.ts";
import { exactRef, hash } from "../modules/website/exploration-contracts.ts";
import type { Workspace } from "./workspace.ts";
import type { Pages } from "./pages.ts";
import type { VisualWorkspace } from "./visual-workspace.ts";
export interface OfflineReconstructionDriver {
  kind: "authored-test-fixture";
  run(input: {
    request: Work<ReconstructionRequest>;
    source: Buffer;
    resources: { handle: string; bytes: Buffer }[];
    signal: AbortSignal;
  }): Promise<ReconstructionSubmission>;
}
export interface OfflineReconstructionInjection {
  testOnly: true;
  driver: OfflineReconstructionDriver;
}
export class Reconstruction {
  readonly w: Workspace;
  readonly pages: Pages;
  readonly visual: VisualWorkspace;
  readonly injection: OfflineReconstructionInjection | undefined;
  private attempted = new Map<string, Promise<unknown>>();
  private controllers = new Set<AbortController>();
  private closing = false;
  constructor(
    w: Workspace,
    pages: Pages,
    visual: VisualWorkspace,
    injection?: OfflineReconstructionInjection,
  ) {
    this.w = w;
    this.pages = pages;
    this.visual = visual;
    if (
      injection &&
      (injection.testOnly !== true ||
        injection.driver.kind !== "authored-test-fixture")
    )
      throw new Error(
        "Only explicitly injected authored reconstruction fixtures are available",
      );
    this.injection = injection;
  }
  private make<T>(
    pid: string,
    kind: ReconstructionKind,
    state: T,
    deps: VersionRef[] = [],
  ): Work<T> {
    return packet({
      type: "work-record",
      id: kind + "-" + randomUUID(),
      projectId: pid,
      dependencies: deps,
      payload: {
        moduleId: "website",
        kind,
        scope: "reconstruction",
        lockedValues: {},
        state,
      },
      provenance: {
        actor: "local-operator",
        source:
          "Explicit offline reconstruction; no generation or acceptance inferred",
        previous: null,
      },
    });
  }
  private read<T>(
    pid: string,
    r: VersionRef,
    kind: ReconstructionKind,
  ): Work<T> {
    exactRef(r);
    this.w.project(pid);
    const p = this.w.kernel.get<DesignArtifact<T>>(r);
    if (
      p.projectId !== pid ||
      p.type !== "work-record" ||
      p.payload.kind !== kind
    )
      throw new InputError("Reconstruction ownership/type mismatch");
    revalidatePacket(p, writePort(p.type), this.w.kernel.environment());
    return p;
  }
  request(pid: string, r: VersionRef) {
    return this.read<ReconstructionRequest>(pid, r, "reconstruction-request");
  }
  result(pid: string, r: VersionRef) {
    return this.read<ReconstructionResult>(pid, r, "reconstruction-result");
  }
  private control(pid: string, u: VersionRef) {
    const v = this.w.kernel.currentVersion(controlId(u));
    const recorded = this.w.kernel
      .projectRefs(pid, 4096, false)
      .filter((r) => r.id === controlId(u))
      .reduce((n, r) => Math.max(n, r.version), 0);
    if (recorded !== (v ?? 0))
      throw new InputError(
        "Reconstruction control history unavailable; current state cannot be inferred",
        409,
      );
    return v === null
      ? null
      : this.read<ReconstructionControl>(
          pid,
          { id: controlId(u), version: v, freshness: "pinned" },
          "reconstruction-control",
        );
  }
  private records(pid: string) {
    return this.w.kernel
      .latestPackets()
      .filter(
        (p) =>
          p.projectId === pid &&
          p.type === "work-record" &&
          Object.hasOwn(
            reconstructionRoles,
            (p.payload as DesignArtifact<unknown>).kind,
          ),
      );
  }
  availability() {
    return {
      connected: !!this.injection,
      mode: this.injection ? "authored-test-fixture" : "unavailable",
      label: this.injection
        ? "Authored semantic test fixtures · no AI generation"
        : "Reconstruction execution unavailable",
    };
  }
  async prepare(pid: string, input: unknown) {
    const r = record(input, [
      "expectedProject",
      "workUnit",
      "source",
      "integrity",
      "expectedControl",
      "instruction",
      "count",
      "viewports",
      "brand",
      "base",
      "baseSignature",
      "locks",
      "resources",
      "evidence",
    ]);
    const project = this.w.project(pid, r["expectedProject"]),
      u = exactRef(r["workUnit"]),
      source = exactRef(r["source"]),
      integrity = hash(r["integrity"]);
    const control = this.control(pid, u),
      expected =
        r["expectedControl"] === null ? null : exactRef(r["expectedControl"]);
    if (!same(control ? reference(control) : null, expected))
      throw new InputError(
        "Reconstruction operation changed; reopen preparation",
        409,
      );
    const members = this.visual
      .state(pid, u)
      .records.filter(
        (p) =>
          (p.payload as DesignArtifact<unknown>).kind === "raster-membership",
      )
      .map(
        (p) =>
          p as Work<
            import("../modules/website/exploration-contracts.ts").Membership
          >,
      )
      .filter((m) => same(m.payload.state.candidate, source));
    const member = members[0];
    if (!member)
      throw new InputError("Choose an eligible whole raster on this page");
    // Fully decode original bytes before the transactional canonical source derivation.
    await this.visual.exploration.raster(pid, source);
    const facts = librarySource(
      this.w.kernel.environment(),
      pid,
      source,
      integrity,
      reference(member),
    );
    const b =
      r["base"] === null ? null : this.pages.page(pid, exactRef(r["base"]));
    if (b && r["baseSignature"] !== pageSignature(b.payload.state))
      throw new InputError("Review the exact semantic base signature");
    if (!b && r["baseSignature"] !== null)
      throw new InputError("Unexpected base signature");
    const locks =
      r["locks"] === undefined
        ? (b?.payload.state.locks ?? [])
        : parseLocks(r["locks"]);
    if (b) preservation(b.payload.state.page, locks);
    const resources = list(
      r["resources"],
      (v) => {
        const a = record(v, ["media", "label", "role"]);
        const media = exactRef(a["media"]),
          m = this.pages.media(pid, media);
        return {
          handle: "",
          label: string(a["label"], 200),
          role: choice(a["role"], ["reference", "placeable"]),
          media,
          integrity: m.integrity,
          state: m.payload.state,
        };
      },
      32,
    ).map((a, i) => ({ ...a, handle: "media-" + (i + 1) }));
    for (const m of resources) await this.pages.mediaBytes(pid, m.media);
    const evidence = list(
      r["evidence"],
      (v) => {
        const a = record(v, ["ref", "integrity"]),
          ref = exactRef(a["ref"]),
          n = this.w.kernel.get<DesignArtifact<{ text: string }>>(ref);
        if (
          n.projectId !== pid ||
          n.payload.kind !== "project-handoff-note" ||
          n.integrity !== hash(a["integrity"])
        )
          throw new InputError("Choose exact owned human handoff evidence");
        return { ref, integrity: n.integrity, text: n.payload.state.text };
      },
      16,
    );
    let brand: ReconstructionRequest["brand"] = { enabled: false };
    if (r["brand"] !== null) {
      const ref = exactRef(r["brand"]),
        p = this.w.kernel.get<VisualOS>(ref);
      if (p.type !== "visual-os" || p.approval !== "accepted")
        throw new InputError("Choose an approved Brand");
      brand = {
        enabled: true,
        source: ref,
        integrity: p.integrity,
        values: Object.fromEntries(
          Object.entries(p.payload.values)
            .filter(([, v]) => v.approved)
            .map(([k, v]) => [k, v.value]),
        ),
      };
    }
    const count = integer(r["count"], 6),
      state = parseReconstructionRequest({
        version: 1,
        project: reference(project),
        workUnit: u,
        source: {
          candidate: source,
          integrity,
          membership: reference(member),
          membershipIntegrity: member.integrity,
          media: facts.media,
          mediaIntegrity: this.w.kernel.get(facts.media).integrity,
          image: facts.image,
          rights: facts.rights,
        },
        instruction: string(r["instruction"], 12000),
        count,
        slots: Array.from({ length: count }, (_, i) => i + 1),
        viewports: r["viewports"],
        brand,
        base: b
          ? {
              ref: reference(b),
              signature: pageSignature(b.payload.state),
              page: b.payload.state.page,
            }
          : null,
        locks,
        resources,
        evidence,
        context: explicitContext({ brand, evidence }),
        grammar: { name: "bve.page", version: 1 },
        previousControl: expected,
        epoch: (control?.version ?? 0) + 1,
        heads: {
          project: project.version,
          workUnit: this.w.kernel.currentVersion(u.id),
          source: this.w.kernel.currentVersion(source.id),
          base: b ? this.w.kernel.currentVersion(b.id) : null,
          brand: brand.enabled
            ? this.w.kernel.currentVersion(brand.source.id)
            : null,
        },
        limits: { maxReceipts: 1, maxCandidates: count, automaticRetry: false },
      });
    const q = this.make(
        pid,
        "reconstruction-request",
        state,
        reconstructionDependencies(state),
      ),
      c: ReconstructionControl = {
        version: 1,
        workUnit: u,
        request: reference(q),
        requestHash: q.integrity,
        status: "pending",
        result: null,
        reason:
          "Explicit whole-raster preparation; execution remains unavailable in production",
      };
    const next = control
      ? revise(
          control,
          { ...control.payload, state: c },
          "local-operator",
          c.reason,
        )
      : this.make(pid, "reconstruction-control", c);
    const { integrity: _, ...body } = next;
    const bound = packet({
      ...body,
      id: controlId(u),
      dependencies: [u, reference(q)],
    });
    this.w.kernel.putMany([q, bound], () => {
      if (
        !reconstructionHeadsCurrent(this.w.kernel.environment(), state) ||
        !same(
          this.control(pid, u) ? reference(this.control(pid, u)!) : null,
          expected,
        )
      )
        throw new InputError(
          "Reconstruction inputs changed while freezing; retry explicitly",
          409,
        );
    });
    return { request: q, control: bound, availability: this.availability() };
  }
  async apply(pid: string, input: unknown) {
    if (!this.injection)
      throw new InputError(
        "Reconstruction execution unavailable; no production intake transport",
        403,
      );
    const r = record(input, ["request", "response"]),
      q = this.request(pid, exactRef(r["request"])),
      s = q.payload.state,
      response = parseSubmission(r["response"]);
    if (
      !same(response.request, reference(q)) ||
      response.requestHash !== q.integrity ||
      !same(response.project, s.project) ||
      !same(response.source.candidate, s.source.candidate) ||
      response.source.integrity !== s.source.integrity ||
      response.baseSignature !== (s.base?.signature ?? null)
    )
      throw new InputError(
        "Reconstruction exact operation/source/hash/base mismatch",
      );
    if (canonical(response.slots.map((x) => x.slot)) !== canonical(s.slots))
      throw new InputError("Reconstruction slot/count mismatch");
    const responseHash = digest(response),
      prior = this.w.kernel.lookup({
        id: resultId(reference(q)),
        version: 1,
        freshness: "pinned",
      });
    if (prior) {
      const old = parseReconstructionResult(
        (prior.payload as DesignArtifact<unknown>).state,
      );
      if (
        old.responseHash !== responseHash ||
        old.receiptId !== response.receiptId
      )
        throw new InputError("Conflicting reconstruction receipt reuse", 409);
      return { result: prior as Work<ReconstructionResult>, duplicate: true };
    }
    for (const p of this.records(pid))
      if (
        (p.payload as DesignArtifact<unknown>).kind ===
          "reconstruction-result" &&
        parseReconstructionResult((p.payload as DesignArtifact<unknown>).state)
          .receiptId === response.receiptId
      )
        throw new InputError(
          "Receipt identity already belongs to another operation",
          409,
        );
    const candidates = parseSemanticCandidates(
      response.slots.map((x) => x.candidate),
      s.context,
      s.locks,
      (handle) => {
        const x = s.resources.find((x) => x.handle === handle);
        if (!x || x.role !== "placeable" || same(x.media, s.source.media))
          throw new InputError(
            "Unknown or reference-only reconstruction media handle",
          );
        const m = this.pages.media(pid, x.media);
        if (m.payload.state.role !== "placeable")
          throw new InputError("Reference-only resource cannot be placed");
        return { asset: x.media, image: m.payload.state.image };
      },
    );
    const control = this.control(pid, s.workUnit),
      usable =
        !!control &&
        same(control.payload.state.request, reference(q)) &&
        control.payload.state.status === "pending" &&
        reconstructionHeadsCurrent(this.w.kernel.environment(), s);
    const proposals = candidates.map((c) =>
      this.pages.proposal(
        pid,
        {
          page: c.page,
          context: c.context,
          locks: c.locks,
          rationale: c.rationale,
        },
        null,
        "authored-test-fixture",
      ),
    );
    const resultState: ReconstructionResult = {
      version: 1,
      workUnit: s.workUnit,
      request: reference(q),
      requestHash: q.integrity,
      responseHash,
      receiptId: response.receiptId,
      outcome: usable ? "current" : "historical",
      proposals: proposals.map((p, i) => ({
        slot: s.slots[i]!,
        ref: reference(p),
        signature: pageSignature(p.payload.state),
      })),
      findings: [...response.findings, ...candidates.flatMap((c) => c.notes)],
      response,
    };
    const raw = this.make(pid, "reconstruction-result", resultState, [
        s.workUnit,
        reference(q),
        ...proposals.map((p) => reference(p)),
      ]),
      { integrity: _, ...rb } = raw,
      result = packet({ ...rb, id: resultId(reference(q)) });
    const writes: NodePacket<unknown>[] = [...proposals, result];
    if (usable)
      writes.push(
        revise(
          control!,
          {
            ...control!.payload,
            state: {
              ...control!.payload.state,
              status: "returned" as const,
              result: reference(result),
              reason:
                "Authored semantic fixture proposals recorded; explicit review required",
            },
          },
          "authored-test-fixture",
          "Offline reconstruction receipt recorded",
        ),
      );
    // Update dependencies of revised controls as part of the same transaction.
    if (usable) {
      const last = writes.pop()!,
        { integrity: _, ...body } = last;
      writes.push(
        packet({
          ...body,
          dependencies: [s.workUnit, reference(q), reference(result)],
        }),
      );
    }
    this.w.kernel.putMany(writes, () => {
      const now = this.control(pid, s.workUnit);
      if (
        !same(
          now ? reference(now) : null,
          control ? reference(control) : null,
        ) ||
        (usable && !reconstructionHeadsCurrent(this.w.kernel.environment(), s))
      )
        throw new InputError(
          "Reconstruction final gate changed; no proposals stored",
          409,
        );
    });
    return { result, duplicate: false };
  }
  async execute(pid: string, input: unknown) {
    if (this.closing)
      throw new InputError("Reconstruction service is stopping", 409);
    if (!this.injection)
      throw new InputError("Reconstruction execution unavailable", 409);
    const r = record(input, ["request"]),
      q = this.request(pid, exactRef(r["request"])),
      c = this.control(pid, q.payload.state.workUnit);
    if (
      !c ||
      !same(c.payload.state.request, reference(q)) ||
      c.payload.state.status !== "pending" ||
      !reconstructionHeadsCurrent(this.w.kernel.environment(), q.payload.state)
    )
      throw new InputError(
        "Reconstruction request is not current; prepare a new explicit operation",
        409,
      );
    if (this.attempted.has(q.id)) return this.attempted.get(q.id)!;
    const abort = new AbortController();
    this.controllers.add(abort);
    const job = (async () => {
      const source = (
          await this.visual.exploration.raster(
            pid,
            q.payload.state.source.candidate,
          )
        ).bytes,
        resources = await Promise.all(
          q.payload.state.resources.map(async (r) => ({
            handle: r.handle,
            bytes: (await this.pages.mediaBytes(pid, r.media)).bytes,
          })),
        );
      if (abort.signal.aborted)
        throw new InputError("Reconstruction fixture stopped", 409);
      const response = await Promise.race([
        this.injection!.driver.run({
          request: q,
          source,
          resources,
          signal: abort.signal,
        }),
        new Promise<never>((_, reject) =>
          abort.signal.addEventListener(
            "abort",
            () => reject(new InputError("Reconstruction fixture stopped", 409)),
            { once: true },
          ),
        ),
      ]);
      return this.apply(pid, { request: reference(q), response });
    })().finally(() => this.controllers.delete(abort));
    this.attempted.set(q.id, job);
    return job;
  }
  cancel(pid: string, input: unknown) {
    const r = record(input, ["request", "expectedControl", "reason"]),
      q = this.request(pid, exactRef(r["request"])),
      c = this.control(pid, q.payload.state.workUnit);
    if (
      !c ||
      !same(reference(c), exactRef(r["expectedControl"])) ||
      !same(c.payload.state.request, reference(q)) ||
      c.payload.state.status !== "pending"
    )
      throw new InputError("Reconstruction cancellation changed; reload", 409);
    const next = revise(
      c,
      {
        ...c.payload,
        state: {
          ...c.payload.state,
          status: "cancelled" as const,
          reason: string(r["reason"]),
        },
      },
      "local-operator",
      string(r["reason"]),
    );
    this.w.kernel.putMany([next], () => {
      if (
        !same(
          reference(this.control(pid, q.payload.state.workUnit)!),
          reference(c),
        )
      )
        throw new InputError("Stale cancellation", 409);
    });
    return next;
  }
  accept(pid: string, input: unknown) {
    const r = record(input, [
        "request",
        "result",
        "proposal",
        "reviewedHash",
        "expectedControl",
        "expectedAcceptance",
        "reason",
        "acknowledgeFindings",
      ]),
      q = this.request(pid, exactRef(r["request"])),
      result = this.result(pid, exactRef(r["result"])),
      proposal = this.pages.page(pid, exactRef(r["proposal"])),
      u = q.payload.state.workUnit,
      expectedControl = exactRef(r["expectedControl"]),
      expected =
        r["expectedAcceptance"] === null
          ? null
          : exactRef(r["expectedAcceptance"]),
      signature = hash(r["reviewedHash"]);
    const check = () => {
      const c = this.control(pid, u);
      if (
        !c ||
        !same(reference(c), expectedControl) ||
        !same(c.payload.state.request, reference(q)) ||
        !same(c.payload.state.result, reference(result)) ||
        c.payload.state.status !== "returned" ||
        !same(result.payload.state.request, reference(q)) ||
        result.payload.state.outcome !== "current" ||
        !reconstructionHeadsCurrent(
          this.w.kernel.environment(),
          q.payload.state,
        ) ||
        this.w.kernel.currentVersion(proposal.id) !== proposal.version ||
        !result.payload.state.proposals.some(
          (p) => same(p.ref, reference(proposal)) && p.signature === signature,
        ) ||
        pageSignature(proposal.payload.state) !== signature
      )
        throw new InputError(
          "Reconstruction review is stale or bound to another source/result; prepare a new operation",
          409,
        );
    };
    check();
    if (
      pageFindings(proposal.payload.state.page).length &&
      r["acknowledgeFindings"] !== true
    )
      throw new InputError(
        "Explicitly acknowledge unresolved semantic findings",
      );
    const reason = string(r["reason"]),
      review = this.make(
        pid,
        "reconstruction-review",
        {
          version: 1,
          workUnit: u,
          request: reference(q),
          result: reference(result),
          proposal: reference(proposal),
          signature,
          reason,
        },
        [u, reference(q), reference(result), reference(proposal)],
      );
    try {
      this.w.kernel.accept(
        pid,
        "reconstruction:" + u.id,
        reference(proposal),
        expected,
        "local-operator",
        reason,
        null,
        check,
        {
          mirror: {
            slot: "page:" + proposal.id,
            expected: this.w.kernel.selected(pid, "page:" + proposal.id),
          },
          records: [review],
        },
      );
    } catch (e) {
      if (
        e instanceof Error &&
        ["stale acceptance", "stale mirrored acceptance"].includes(e.message)
      )
        throw new InputError(
          "Reconstruction acceptance changed; reload and review again",
          409,
        );
      throw e;
    }
    return { review, accepted: reference(proposal) };
  }
  async export(pid: string, input: unknown) {
    const r = record(input, ["proposal"]);
    return this.pages.export(pid, exactRef(r["proposal"]));
  }
  async preview(
    pid: string,
    request: VersionRef,
    result: VersionRef,
    proposal: VersionRef,
  ) {
    const q = this.request(pid, request),
      r = this.result(pid, result);
    if (
      !same(r.payload.state.request, request) ||
      !r.payload.state.proposals.some((p) => same(p.ref, proposal))
    )
      throw new InputError("Exact reconstruction preview binding required");
    return this.pages.preview(pid, proposal);
  }
  state(pid: string, u: VersionRef) {
    this.visual.exploration.read(pid, u, "page-work-unit");
    const c = this.control(pid, u),
      requests = this.records(pid).filter(
        (p) =>
          (p.payload as DesignArtifact<unknown>).kind ===
            "reconstruction-request" &&
          same(
            parseReconstructionRequest(
              (p.payload as DesignArtifact<unknown>).state,
            ).workUnit,
            u,
          ),
      );
    const history = requests.map((p) => {
      const request = p as Work<ReconstructionRequest>,
        result = this.w.kernel.lookup({
          id: resultId(reference(p)),
          version: 1,
          freshness: "pinned",
        });
      return { request, result };
    });
    return {
      control: c,
      history,
      accepted: this.w.kernel.selected(pid, "reconstruction:" + u.id),
      availability: this.availability(),
      resources: this.pages.state(pid).media,
      notes: this.w.kernel
        .latestPackets()
        .filter(
          (p) =>
            p.projectId === pid &&
            (p.payload as DesignArtifact<unknown>).kind ===
              "project-handoff-note",
        ),
    };
  }
  async close() {
    this.closing = true;
    for (const c of this.controllers) c.abort();
    await Promise.allSettled(this.attempted.values());
  }
}
