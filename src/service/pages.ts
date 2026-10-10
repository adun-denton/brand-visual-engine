import { randomUUID } from "node:crypto";
import { posix } from "node:path";
import type {
  NodePacket,
  DesignArtifact,
  VersionRef,
  Value,
  PacketType,
} from "../kernel/contracts.ts";
import {
  packet,
  reference,
  revise,
  digest,
  canonical,
} from "../kernel/packets.ts";
import { revalidatePacket, writePort } from "../kernel/gate.ts";
import { effectiveValues } from "../kernel/context.ts";
import type {
  Page,
  PageState,
  MediaState,
  MediaBinding,
  WebsiteState,
} from "../modules/website/page.ts";
import {
  parsePage,
  parseWebsite,
  nodes,
  preservation,
  pageFindings,
  pageSignature,
  renderPage,
  validatePageRecord,
} from "../modules/website/page.ts";
import type {
  InferenceRequest,
  InferenceResult,
  Resource,
} from "../modules/website/inference-contracts.ts";
import {
  parseLocks,
  inferenceOutputSchema,
} from "../modules/website/inference-contracts.ts";
import { escapeHtml, imagePath } from "../modules/website/composition.ts";
import { record, ref, string, list, choice, InputError } from "./validation.ts";
import { decode, MAX_IMAGE_BYTES } from "./assets.ts";
import type { Workspace } from "./workspace.ts";
import { Compositions } from "./compositions.ts";
import { tar } from "./handoff.ts";

type Stored<T> = NodePacket<DesignArtifact<T>>;
const same = (a: VersionRef, b: VersionRef) =>
  a.id === b.id && a.version === b.version;
const referenceInput = ref;
const json = (v: unknown) => v as Value;
const mediaDependencies = (page: Page) => [
  ...new Map(
    Object.values(page.media)
      .filter((v): v is MediaBinding => !!v)
      .map((b) => [b.asset.id + "@" + b.asset.version, b.asset]),
  ).values(),
];
const inventory = (page: Page) => [
  ...new Map(
    Object.values(page.media)
      .filter((v): v is MediaBinding => !!v)
      .map((b) => [b.image.id, { id: b.image.id, checksum: b.image.checksum }]),
  ).values(),
];
export class Pages {
  readonly workspace: Workspace;
  constructor(workspace: Workspace) {
    this.workspace = workspace;
  }
  private make<T>(
    pid: string,
    type: PacketType,
    kind: string,
    state: T,
    dependencies: VersionRef[] = [],
  ): Stored<T> {
    return packet({
      type,
      id: kind + "-" + randomUUID(),
      projectId: pid,
      dependencies,
      payload: {
        moduleId: "website",
        kind,
        scope: "page",
        lockedValues: {},
        state,
      },
      provenance: {
        actor: "local-operator",
        source: "Explicit inference workspace operation; acceptance separate",
        previous: null,
      },
    });
  }
  read<T>(
    pid: string,
    pointer: VersionRef,
    type: PacketType,
    kind: string,
  ): Stored<T> {
    this.workspace.project(pid);
    const p = this.workspace.kernel.get<DesignArtifact<T>>(pointer);
    if (
      pointer.freshness !== "pinned" ||
      p.projectId !== pid ||
      p.type !== type ||
      p.payload.kind !== kind
    )
      throw new InputError("Page/work/media ownership or type mismatch");
    revalidatePacket(p, writePort(p.type), this.workspace.kernel.environment());
    return p;
  }
  page(pid: string, r: VersionRef) {
    return this.read<PageState>(pid, r, "design-artifact", "website-page");
  }
  media(pid: string, r: VersionRef) {
    return this.read<MediaState>(pid, r, "media-asset", "page-media");
  }
  request(pid: string, r: VersionRef) {
    return this.read<InferenceRequest>(
      pid,
      r,
      "work-record",
      "inference-request",
    );
  }
  private discovery(pid: string) {
    const sequence = new Map(
      this.workspace.kernel
        .ledger(pid)
        .events.filter((e) => e.kind === "revision")
        .map((e) => [e.subject.id, e.sequence]),
    );
    return this.workspace.kernel
      .latestPackets()
      .filter(
        (p) =>
          p.projectId === pid,
      )
      .sort((a, b) => (sequence.get(a.id) ?? 0) - (sequence.get(b.id) ?? 0));
  }
  private latest(pid: string, kind: string) {
    return this.discovery(pid).filter(p => (p.payload as DesignArtifact<unknown>).kind === kind);
  }
  state(pid: string) {
    const discovered = this.discovery(pid);
    const latest = (kind: string) => discovered.filter(p => (p.payload as DesignArtifact<unknown>).kind === kind);
    const pages = latest("website-page").map((p) =>
      this.page(pid, reference(p)),
    );
    return {
      pages,
      media: latest("page-media").map((p) =>
        this.media(pid, reference(p)),
      ),
      requests: latest("inference-request").map((p) =>
        this.request(pid, reference(p)),
      ),
      results: latest("inference-result").map((p) =>
        this.read<InferenceResult>(
          pid,
          reference(p),
          "work-record",
          "inference-result",
        ),
      ),
      websites: latest("website-assembly").map((p) =>
        this.website(pid, reference(p)),
      ),
      accepted: Object.fromEntries(
        pages.map((p) => [
          p.id,
          this.workspace.kernel.selected(pid, "page:" + p.id),
        ]),
      ),
      acceptedWebsite: this.workspace.kernel.selected(pid, "website"),
      signatures: Object.fromEntries([
        ...pages.map((p) => [p.id, pageSignature(p.payload.state)]),
        ...latest("website-assembly").map((p) => [
          p.id,
          digest((p.payload as DesignArtifact<WebsiteState>).state),
        ]),
      ]),
      execution: {
        session: "manual-request-result-exchange",
        local: "not-configured",
        paid: "disabled",
      },
    };
  }
  private current<T>(p: Stored<T>) {
    if (this.workspace.kernel.currentVersion(p.id) !== p.version)
      throw new InputError("Working revision changed; reload", 409);
  }
  private context(pid: string): Record<string, Value> {
    const p = this.workspace.project(pid);
    return Object.fromEntries(
      Object.entries(effectiveValues(p.payload.resolvedContext)).filter(
        ([k]) => !["references", "comparison"].includes(k),
      ),
    );
  }
  private pagePacket(
    pid: string,
    state: PageState,
    base: Stored<PageState> | null = null,
    actor = "session-ai-attested",
  ): Stored<PageState> {
    const p = base
      ? revise(
          base,
          { ...base.payload, state },
          actor,
          "Full snapshot proposal; prior acceptance remains pinned",
        )
      : this.make(pid, "design-artifact", "website-page", state);
    const { integrity: _, ...body } = p;
    return packet({
      ...body,
      provenance: {...body.provenance, actor},
      dependencies: mediaDependencies(state.page),
      contextRefs: [],
      assets: inventory(state.page),
      approval: "proposal",
    });
  }
  private decodeFile(input: unknown): Buffer {
    const s = string(input, Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4);
    if (s.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(s))
      throw new InputError("Invalid encoded media");
    const bytes = Buffer.from(s, "base64");
    if (bytes.toString("base64") !== s)
      throw new InputError("Non-canonical encoded media");
    return bytes;
  }
  async addMedia(pid: string, input: unknown) {
    const r = record(input, [
      "expectedProject",
      "file",
      "origin",
      "label",
      "role",
      "permission",
    ]);
    const project = this.workspace.project(pid, r["expectedProject"]);
    const origin = r["origin"] === null ? null : ref(r["origin"]);
    const original = origin
      ? await this.workspace.originalImage(pid, origin)
      : null;
    if ((original === null) === (r["file"] === undefined))
      throw new InputError("Choose one original or uploaded file");
    const bytes = original?.bytes ?? this.decodeFile(r["file"]);
    const image = await decode(bytes);
    const state: MediaState = {
      image,
      label: string(r["label"], 200),
      role: choice(r["role"], ["reference", "placeable"]),
      permission: string(r["permission"]),
    };
    const m = this.make(pid, "media-asset", "page-media", state);
    const { integrity: _, ...body } = m;
    const asset = packet({
      ...body,
      assets: [{ id: image.id, checksum: image.checksum }],
    });
    const writes: NodePacket<unknown>[] = [asset];
    if (origin) {
      const source = this.workspace.read(pid, origin);
      writes.push(
        this.make(
          pid,
          "work-record",
          "page-media-origin",
          {
            source: origin,
            target: reference(asset),
            sourceIntegrity: source.integrity,
            losses: [],
          },
          [origin, reference(asset)],
        ),
      );
    }
    this.workspace.assets.save(bytes, image);
    this.workspace.kernel.putMany(writes, () =>
      this.workspace.project(pid, reference(project)),
    );
    return this.workspace.state(pid);
  }
  prepare(pid: string, input: unknown) {
    const r = record(input, [
      "expectedProject",
      "base",
      "operation",
      "instruction",
      "locks",
      "resources",
    ]);
    const project = this.workspace.project(pid, r["expectedProject"]);
    const base = r["base"] === null ? null : this.page(pid, ref(r["base"]));
    const operation = choice(r["operation"], ["create", "revise", "critique"]);
    if (operation !== "create" && !base)
      throw new InputError("Revision/critique needs an exact base");
    const locks =
      r["locks"] === undefined
        ? (base?.payload.state.locks ?? [])
        : parseLocks(r["locks"]);
    if (base) preservation(base.payload.state.page, locks);
    else if (locks.length)
      throw new InputError("Locks require existing local elements");
    const selected = list(r["resources"], ref, 32);
    // Existing placed media travel with a deliberately selected base. Extra references remain explicit.
    const included = [
      ...new Map(
        [
          ...(base ? mediaDependencies(base.payload.state.page) : []),
          ...selected,
        ].map((x) => [x.id + "@" + x.version, x]),
      ).values(),
    ];
    if (included.length > 32)
      throw new InputError("Too many selected resources");
    const resources: Resource[] = included.map((x, i) => ({
      handle: "media-" + (i + 1),
      media: x,
      state: this.media(pid, x).payload.state,
    }));
    const state: InferenceRequest = {
      project: reference(project),
      base: base ? reference(base) : null,
      baseSignature: base ? pageSignature(base.payload.state) : null,
      baseState: base?.payload.state ?? null,
      operation,
      instruction: string(r["instruction"], 12000),
      context: base?.payload.state.context ?? this.context(pid),
      locks,
      resources,
      status: "awaiting",
    };
    const q = this.make(pid, "work-record", "inference-request", state, [
      state.project,
      ...(state.base ? [state.base] : []),
      ...resources.map((x) => x.media),
    ]);
    this.workspace.kernel.putMany([q], () => {
      this.workspace.project(pid, reference(project));
      if (base) this.current(base);
    });
    return this.workspace.state(pid);
  }
  exportRequest(pid: string, pointer: VersionRef) {
    const q = this.request(pid, pointer),
      s = q.payload.state;
    const basePage = s.baseState
      ? {
          ...s.baseState.page,
          media: Object.fromEntries(
            Object.entries(s.baseState.page.media).map(([slot, b]) => [
              slot,
              b
                ? s.resources.find((r) => same(r.media, b.asset))!.handle
                : null,
            ]),
          ),
        }
      : null;
    return {
      schema: "bve.inference-request",
      version: 1,
      requestId: q.id,
      requestHash: q.integrity,
      request: reference(q),
      operation: s.operation,
      instruction: s.instruction,
      context: s.context,
      base: basePage,
      preservation: s.locks,
      resources: s.resources.map((r) => ({
        handle: r.handle,
        label: r.state.label,
        role: r.state.role,
        permission: r.state.permission,
        image: r.state.image,
      })),
      outputSchema: inferenceOutputSchema,
      contract:
        "Return bve.inference-result v1, exact requestId/requestHash, candidates and findings. A candidate has label,rationale,page,mediaRequirements[{slot,instruction}],proposedActions[strings]. Page: version=1,title,language,root,media,responsive,unresolved. See schema. Containers/sections own children; heading/text/link own text; heading owns level 1–6; link owns href; list owns items; media owns slot/alt/decorative. Style is safe flow/flex/grid CSS properties. No fixed sections, image counts or breakpoint. Place only included placeable handles; new files use separately supplied upload handles. Critique can have no candidates. Keep exact preservation locks. Proposed actions are never executed. No IDs, acceptance, HTML/scripts or external resource URLs.",
      metadata: { model: null, settings: null, usage: null },
      policy: { paidExecution: false, humanAcceptance: false },
    };
  }
  async requestPackage(pid: string, r: VersionRef) {
    const q = this.request(pid, r);
    const files = new Map<string, Buffer>([
      [
        "request.json",
        Buffer.from(JSON.stringify(this.exportRequest(pid, r), null, 2) + "\n"),
      ],
      [
        "response-schema.json",
        Buffer.from(JSON.stringify(inferenceOutputSchema, null, 2) + "\n"),
      ],
    ]);
    for (const resource of q.payload.state.resources)
      files.set(
        imagePath(resource.state.image),
        this.workspace.assets.read(resource.state.image.id),
      );
    return { bytes: tar(files, "request"), files: [...files.keys()] };
  }
  cancel(pid: string, input: unknown) {
    const r = record(input, ["request", "reason"]);
    const q = this.request(pid, ref(r["request"]));
    this.current(q);
    if (q.payload.state.status !== "awaiting")
      throw new InputError("Request is already closed");
    const next = revise(
      q,
      {
        ...q.payload,
        state: { ...q.payload.state, status: "cancelled" as const },
      },
      "local-operator",
      string(r["reason"]),
    );
    this.workspace.kernel.putMany([next], () => this.current(q));
    return this.workspace.state(pid);
  }
  async apply(pid: string, input: unknown) {
    const r = record(input, [
      "request",
      "response",
      "source",
      "model",
      "aiAuthorship",
      "uploads",
    ]);
    const q = this.request(pid, ref(r["request"])),
      s = q.payload.state;
    if (r["aiAuthorship"] !== true)
      throw new InputError("Attest AI authorship; this is not acceptance");
    const response = record(r["response"], [
      "schema",
      "version",
      "requestId",
      "requestHash",
      "candidates",
      "findings",
    ]);
    if (
      response["schema"] !== "bve.inference-result" ||
      response["version"] !== 1 ||
      response["requestId"] !== q.id ||
      response["requestHash"] !== q.integrity
    )
      throw new InputError("Result must match the exact exported request/hash");
    const responseHash = digest(response);
    const duplicate = this.latest(pid, "inference-result").find((p) => {
      const x = (p.payload as DesignArtifact<InferenceResult>).state;
      return same(x.request, reference(q)) && x.responseHash === responseHash;
    });
    if (duplicate) return this.workspace.state(pid);
    const source = string(r["source"]);
    const model = r["model"] === null ? null : string(r["model"], 200);
    const uploads = await Promise.all(
      list(
        r["uploads"] ?? [],
        (v) => record(v, ["handle", "label", "permission", "file"]),
        16,
      ).map(async (u) => {
        const handle = string(u["handle"], 100);
        if (!/^upload-[A-Za-z0-9_-]+$/.test(handle))
          throw new InputError("Returned files need an upload- handle");
        const bytes = this.decodeFile(u["file"]),
          image = await decode(bytes);
        const state: MediaState = {
          image,
          label: string(u["label"], 200),
          role: "placeable",
          permission: string(u["permission"]),
        };
        const m = this.make(pid, "media-asset", "page-media", state);
        const { integrity: _, ...body } = m;
        return {
          handle,
          bytes,
          media: packet({
            ...body,
            assets: [{ id: image.id, checksum: image.checksum }],
          }),
        };
      }),
    );
    if (new Set(uploads.map((u) => u.handle)).size !== uploads.length)
      throw new InputError("Duplicate returned file handle");
    const resolve = (handle: string): MediaBinding => {
      const resource = s.resources.find((r) => r.handle === handle);
      if (resource) {
        if (resource.state.role !== "placeable")
          throw new InputError("Reference-only resource cannot be placed");
        const m = this.media(pid, resource.media);
        return { asset: resource.media, image: m.payload.state.image };
      }
      const upload = uploads.find((u) => u.handle === handle);
      if (upload)
        return {
          asset: reference(upload.media),
          image: upload.media.payload.state.image,
        };
      throw new InputError("Unknown or invented media handle");
    };
    const candidates = list(
      response["candidates"],
      (v) => {
        const c = record(v, [
          "label",
          "rationale",
          "page",
          "mediaRequirements",
          "proposedActions",
        ]);
        string(c["label"], 200);
        const page = parsePage(c["page"], resolve);
        preservation(page, s.locks);
        const needs = list(
          c["mediaRequirements"],
          (v) => {
            const n = record(v, ["slot", "instruction"]);
            const slot = string(n["slot"], 160);
            if (!(slot in page.media))
              throw new InputError("Media need targets an unknown slot");
            return slot + ": " + string(n["instruction"]);
          },
          100,
        );
        const actions = list(
          c["proposedActions"],
          (v) => "Proposed only: " + string(v),
          32,
        );
        return {
          page,
          context: s.context,
          locks: s.locks,
          rationale: string(c["rationale"]),
          notes: [...needs, ...actions],
        };
      },
      6,
    );
    if (s.operation !== "critique" && !candidates.length)
      throw new InputError("Create/revise needs a candidate");
    const findings = list(response["findings"], (v) => string(v), 100);
    const currentVersion = this.workspace.kernel.currentVersion(q.id)!;
    const currentRequest = this.request(pid, {
      ...reference(q),
      version: currentVersion,
    });
    const currentProject = this.workspace.project(pid);
    const usable =
      currentVersion === q.version &&
      s.status === "awaiting" &&
      currentProject.version === s.project.version &&
      (!s.base ||
        this.workspace.kernel.currentVersion(s.base.id) === s.base.version);
    const base =
      usable && s.base && candidates.length === 1
        ? this.page(pid, s.base)
        : null;
    const proposals = candidates.map((c) =>
      this.pagePacket(
        pid,
        {
          page: c.page,
          context: c.context,
          locks: c.locks,
          rationale: c.rationale,
        },
        base,
      ),
    );
    const resultState: InferenceResult = {
      request: reference(q),
      requestHash: q.integrity,
      responseHash,
      outcome: usable ? "applied" : "historical",
      proposals: proposals.map((p) => reference(p)),
      findings: [...findings, ...candidates.flatMap((c) => c.notes)],
      source,
      aiAuthorship: true,
      executor: {
        kind: this.workspace.options.aiResponseFixture
          ? "test-fixture"
          : "session-attested",
        model,
        settings: null,
        usage: null,
      },
      response: json(response),
    };
    const result = this.make(
      pid,
      "work-record",
      "inference-result",
      resultState,
      [reference(q), ...resultState.proposals],
    );
    const writes: NodePacket<unknown>[] = [
      ...uploads.map((u) => u.media),
      ...proposals,
      result,
    ];
    if (usable)
      writes.push(
        revise(
          q,
          { ...q.payload, state: { ...s, status: "applied" as const } },
          "local-operator",
          "Validated AI output registered; acceptance separate",
        ),
      );
    for (const u of uploads)
      this.workspace.assets.save(u.bytes, u.media.payload.state.image);
    this.workspace.kernel.putMany(writes, () => {
      if (
        this.workspace.kernel.currentVersion(q.id) !== currentRequest.version ||
        this.workspace.project(pid).version !== currentProject.version
      )
        throw new InputError("Exchange changed during import; reload", 409);
      if (usable && s.base) this.current(this.page(pid,s.base));
      if (
        this.latest(pid, "inference-result").some((p) => {
          const x = (p.payload as DesignArtifact<InferenceResult>).state;
          return (
            same(x.request, reference(q)) && x.responseHash === responseHash
          );
        })
      )
        throw new InputError("Result already registered", 409);
    });
    return this.workspace.state(pid);
  }
  async place(pid: string, input: unknown) {
    const r = record(input, ["artifact", "slot", "media", "reason"]);
    const page = this.page(pid, ref(r["artifact"]));
    const m = this.media(pid, ref(r["media"]));
    const slot = string(r["slot"], 160);
    if (
      !(slot in page.payload.state.page.media) ||
      m.payload.state.role !== "placeable"
    )
      throw new InputError("Choose a local media slot and placeable resource");
    const content = structuredClone(page.payload.state.page);
    content.media[slot] = { asset: reference(m), image: m.payload.state.image };
    preservation(content, page.payload.state.locks);
    const next = this.pagePacket(
      pid,
      { ...page.payload.state, page: content },
      page,
    );
    next.provenance.actor = "local-operator";
    next.provenance.source = string(r["reason"]);
    const { integrity: _, ...body } = next;
    this.workspace.kernel.putMany([packet(body)], () => this.current(page));
    return this.workspace.state(pid);
  }
  save(pid: string, input: unknown) {
    const r = record(input, ["artifact", "page", "reason"]);
    const base = this.page(pid, ref(r["artifact"]));
    const page = parsePage(r["page"]);
    preservation(page, base.payload.state.locks);
    const next = this.pagePacket(pid, { ...base.payload.state, page }, base);
    const { integrity: _, ...body } = next;
    this.workspace.kernel.putMany(
      [
        packet({
          ...body,
          provenance: {
            ...body.provenance,
            actor: "local-operator",
            source: string(r["reason"]),
          },
        }),
      ],
      () => this.current(base),
    );
    return this.workspace.state(pid);
  }
  history(pid: string, pointer: VersionRef) {
    const page = this.page(pid, pointer);
    return Array.from({ length: page.version }, (_, i) =>
      this.page(pid, { ...pointer, version: i + 1 }),
    );
  }
  accept(pid: string, input: unknown) {
    const r = record(input, [
      "artifact",
      "expected",
      "reason",
      "reviewedHash",
      "acknowledgeFindings",
    ]);
    const page = this.page(pid, ref(r["artifact"]));
    const signature = pageSignature(page.payload.state);
    if (r["reviewedHash"] !== signature)
      throw new InputError("Review the exact page state before acceptance");
    if (
      pageFindings(page.payload.state.page).length &&
      r["acknowledgeFindings"] !== true
    )
      throw new InputError("Resolve or explicitly acknowledge page findings");
    this.workspace.kernel.accept(
      pid,
      "page:" + page.id,
      reference(page),
      r["expected"] === null ? null : ref(r["expected"]),
      "local-operator",
      string(r["reason"]),
      null,
      () => this.current(page),
    );
    return this.workspace.state(pid);
  }
  private accepted(pid: string, r: VersionRef): boolean {
    return this.workspace.kernel
      .ledger(pid)
      .events.some((e) => e.kind === "acceptance" && same(e.subject, r));
  }
  async preview(pid: string, r: VersionRef) {
    const p = this.page(pid, r);
    return renderPage(
      p.payload.state.page,
      (b) =>
        `/api/v1/page/media?project=${encodeURIComponent(pid)}&id=${encodeURIComponent(b.asset.id)}&version=${b.asset.version}`,
    );
  }
  async mediaBytes(pid: string, r: VersionRef) {
    const m = this.media(pid, r);
    return {
      bytes: this.workspace.assets.read(m.payload.state.image.id),
      info: m.payload.state.image,
    };
  }
  async export(pid: string, r: VersionRef) {
    const p = this.page(pid, r);
    if (!this.accepted(pid, r))
      throw new InputError("Exact page acceptance required for handoff");
    const media = Object.values(p.payload.state.page.media)
      .filter((v): v is MediaBinding => !!v)
      .map((b) => {
        const m = this.media(pid, b.asset);
        return {
          slotBindings: Object.entries(p.payload.state.page.media)
            .filter(([, x]) => x && same(x.asset, b.asset))
            .map(([slot]) => slot),
          state: m.payload.state,
          asset: b.asset,
          path: imagePath(b.image),
        };
      });
    const manifest = {
      schema: "bve.page-handoff",
      version: 1,
      artifact: reference(p),
      integrity: p.integrity,
      state: p.payload.state,
      snapshot: p,
      media,
      acceptance: this.workspace.kernel
        .ledger(pid)
        .events.filter((e) => e.kind === "acceptance" && same(e.subject, r)),
      findings: pageFindings(p.payload.state.page),
      renderer: { grammar: "bve.page", version: 1 },
      approval:
        "Original workspace evidence only; import requires a new local decision",
    };
    const files = new Map<string, Buffer>([
      ["manifest.json", Buffer.from(JSON.stringify(manifest, null, 2) + "\n")],
      [
        "index.html",
        Buffer.from(
          renderPage(p.payload.state.page, (b) => imagePath(b.image)),
        ),
      ],
      [
        "RECONSTRUCT.md",
        Buffer.from(
          "Render the versioned semantic element tree and responsive rules in manifest.json. Styles are declared CSS properties; numeric dimensions use CSS pixels. Verify required media hashes. No original BVE project, other artifact, or ledger is needed. Imported acceptance is source evidence, not local approval.\n",
        ),
      ],
    ]);
    for (const m of media)
      files.set(m.path, this.workspace.assets.read(m.state.image.id));
    const bytes = tar(files, "page");
    return {
      bytes,
      checksum: Buffer.from(bytes).length ? await this.hashBytes(bytes) : "",
      manifest,
    };
  }
  private async hashBytes(bytes: Buffer) {
    const { createHash } = await import("node:crypto");
    return createHash("sha256").update(bytes).digest("hex");
  }
  async importPortable(pid: string, input: unknown) {
    const r = record(input, ["expectedProject", "manifest", "files", "reason"]);
    const project = this.workspace.project(pid, r["expectedProject"]);
    const manifest = record(r["manifest"], [
      "schema",
      "version",
      "artifact",
      "integrity",
      "state",
      "snapshot",
      "media",
      "acceptance",
      "findings",
      "renderer",
      "approval",
    ]);
    if (manifest["schema"] !== "bve.page-handoff" || manifest["version"] !== 1)
      throw new InputError("Unsupported portable page schema");
    const source = manifest["snapshot"] as Stored<PageState>;
    const { integrity, ...body } = source;
    if (
      digest(body) !== integrity ||
      integrity !== manifest["integrity"] ||
      canonical(manifest["artifact"]) !== canonical(reference(source)) ||
      canonical(manifest["state"]) !== canonical(source.payload.state) ||
      source.type !== "design-artifact" ||
      source.payload.kind !== "website-page"
    )
      throw new InputError("Portable snapshot integrity mismatch");
    validatePageRecord(source.payload as unknown as Record<string, unknown>);
    const state = structuredClone(source.payload.state);
    const files = record(r["files"], Object.keys((r["files"] ?? {}) as object));
    const required = mediaDependencies(state.page);
    const entries = list(
      manifest["media"],
      (v) => record(v, ["slotBindings", "state", "asset", "path"]),
      400,
    );
    const pending: Stored<MediaState>[] = [];
    const decoded: { bytes: Buffer; state: MediaState }[] = [];
    const remap = new Map<string, Stored<MediaState>>();
    for (const ref of required) {
      const entry = entries.find((x) => same(ref, referenceInput(x["asset"])));
      if (!entry)
        throw new InputError("Portable media inventory is incomplete");
      const path = string(entry["path"], 100);
      const info = record(entry["state"], [
        "image",
        "label",
        "role",
        "permission",
      ]) as unknown as MediaState;
      const bytes = this.decodeFile(files[path]),
        image = await decode(bytes);
      if (
        info.role !== "placeable" ||
        canonical(image) !== canonical(info.image) ||
        path !== imagePath(image)
      )
        throw new InputError("Portable media bytes or role mismatch");
      for (const binding of Object.values(state.page.media))
        if (
          binding &&
          same(binding.asset, ref) &&
          canonical(binding.image) !== canonical(image)
        )
          throw new InputError("Portable media binding mismatch");
      const m = this.make(pid, "media-asset", "page-media", { ...info, image });
      const { integrity: _, ...body } = m;
      const next = packet({
        ...body,
        assets: [{ id: image.id, checksum: image.checksum }],
      });
      pending.push(next);
      decoded.push({ bytes, state: next.payload.state });
      remap.set(ref.id + "@" + ref.version, next);
    }
    if (
      canonical(source.contextRefs) !== canonical([]) ||
      canonical(
        [...source.dependencies].sort((a, b) => a.id.localeCompare(b.id)),
      ) !== canonical([...required].sort((a, b) => a.id.localeCompare(b.id)))
    )
      throw new InputError("Portable source is not an independent page");
    if (
      Object.keys(files).some(
        (path) => !decoded.some((x) => imagePath(x.state.image) === path),
      )
    )
      throw new InputError("Portable import contains undeclared files");
    for (const binding of Object.values(state.page.media))
      if (binding)
        binding.asset = reference(
          remap.get(binding.asset.id + "@" + binding.asset.version)!,
        );
    state.rationale =
      "Imported portable source evidence; local review required. " +
      string(r["reason"]);
    const page = this.pagePacket(pid, state, null, "local-operator");
    const receipt = this.make(
      pid,
      "work-record",
      "page-import",
      {
        target: reference(page),
        sourceHash: digest(manifest),
        sourceEvidence: json(manifest),
      },
      [reference(page)],
    );
    for (const x of decoded) this.workspace.assets.save(x.bytes, x.state.image);
    this.workspace.kernel.putMany([...pending, page, receipt], () =>
      this.workspace.project(pid, reference(project)),
    );
    return this.workspace.state(pid);
  }
  async convert(pid: string, input: unknown) {
    const r = record(input, ["composition", "reason"]);
    const source = new Compositions(this.workspace).read(
      pid,
      ref(r["composition"]),
    );
    const s = source.payload.state;
    const pending: Stored<MediaState>[] = [];
    const media: Page["media"] = {};
    const sections = s.content.sections.map((sec) => ({
      id: sec.id,
      kind: "section" as const,
      style: {
        padding: sec.overrides.spacing ?? s.content.style.spacing,
        background: sec.overrides.background ?? s.content.style.background,
        color: sec.overrides.foreground ?? s.content.style.foreground,
      },
      children: sec.blocks.map((b) => {
        if (b.kind === "image") {
          if (b.asset && b.image) {
            const m = this.make(pid, "media-asset", "page-media", {
              image: b.image,
              label: "Converted " + b.id,
              role: "placeable" as const,
              permission:
                "Exact media placement copied from legacy composition; source evidence in migration record",
            });
            const { integrity: _, ...body } = m;
            const item = packet({
              ...body,
              assets: [{ id: b.image.id, checksum: b.image.checksum }],
            });
            pending.push(item);
            media[b.id] = { asset: reference(item), image: b.image };
          } else media[b.id] = null;
          return {
            id: b.id,
            kind: "media" as const,
            slot: b.id,
            alt: b.alt,
            decorative: false,
          };
        }
        if (b.kind === "heading")
          return {
            id: b.id,
            kind: "heading" as const,
            level: sec.id === "hero" ? 1 : 2,
            text: b.text,
          };
        if (b.kind === "paragraph")
          return { id: b.id, kind: "text" as const, text: b.text };
        if (b.kind === "button")
          return {
            id: b.id,
            kind: "link" as const,
            text: b.text,
            href: b.href,
          };
        return { id: b.id, kind: "list" as const, items: b.items };
      }),
    }));
    const content = parsePage({
      version: 1,
      title: s.content.title,
      language: "en",
      root: {
        id: "main",
        kind: "container",
        style: {
          fontFamily:
            s.content.style.font === "serif"
              ? "Georgia,serif"
              : "system-ui,sans-serif",
          fontSize: s.content.style.bodySize,
          background: s.content.style.background,
          color: s.content.style.foreground,
        },
        children: sections,
      },
      media,
      responsive: [],
      unresolved: [
        ...s.content.unresolved,
        "Conversion preserves content/media and basic styling; legacy recipe geometry/chrome/responsive behavior require design review.",
      ],
    });
    const context = Object.fromEntries(
      Object.entries(effectiveValues(s.context)).filter(
        ([k]) => !["references", "comparison"].includes(k),
      ),
    );
    const page = this.pagePacket(pid, {
      page: content,
      context,
      locks: [],
      rationale: string(r["reason"]),
    }, null, "local-operator");
    const work = this.make(
      pid,
      "work-record",
      "page-migration",
      {
        source: reference(source),
        target: reference(page),
        sourceIntegrity: source.integrity,
        losses: [
          "Legacy stack/split/cards/band geometry, generated header/footer and 760px responsive rules are not claimed equivalent. Original accepted export remains available unchanged.",
        ],
      },
      [reference(source), reference(page)],
    );
    this.workspace.kernel.putMany([...pending, page, work]);
    return this.workspace.state(pid);
  }
  website(pid: string, r: VersionRef) {
    return this.read<WebsiteState>(
      pid,
      r,
      "website-assembly",
      "website-assembly",
    );
  }
  assemble(pid: string, input: unknown) {
    const r = record(input, ["base", "title", "pages", "reason"]);
    const base = r["base"] === null ? null : this.website(pid, ref(r["base"]));
    const state = parseWebsite({
      title: r["title"],
      pages: list(
        r["pages"],
        (v) => {
          const x = record(v, ["route", "label", "artifact"]);
          const p = this.page(pid, ref(x["artifact"]));
          return { ...x, integrity: p.integrity };
        },
        32,
      ),
    });
    const validate = () => {
      if (base) this.current(base);
      for (const x of state.pages) {
        if (!this.accepted(pid, x.artifact))
          throw new InputError(
            "Website can adopt only explicitly accepted page revisions",
          );
        const p = this.page(pid, x.artifact);
        for (const n of nodes(p.payload.state.page))
          if (
            n.href?.startsWith("/") &&
            !state.pages.some(
              (x) =>
                x.route === (n.href!.endsWith("/") ? n.href : n.href + "/"),
            )
          )
            throw new InputError(
              "Unresolved internal Website route: " + n.href,
            );
      }
    };
    validate();
    const a = base
      ? revise(
          base,
          { ...base.payload, state },
          "local-operator",
          string(r["reason"]),
        )
      : this.make(
          pid,
          "website-assembly",
          "website-assembly",
          state,
          state.pages.map((x) => x.artifact),
        );
    const { integrity: _, ...body } = a;
    this.workspace.kernel.putMany(
      [packet({ ...body, dependencies: state.pages.map((x) => x.artifact) })],
      validate,
    );
    return this.workspace.state(pid);
  }
  acceptWebsite(pid: string, input: unknown) {
    const r = record(input, ["assembly", "expected", "reason", "reviewedHash"]);
    const a = this.website(pid, ref(r["assembly"]));
    if (r["reviewedHash"] !== digest(a.payload.state))
      throw new InputError("Review the exact Website before acceptance");
    this.workspace.kernel.accept(
      pid,
      "website",
      reference(a),
      r["expected"] === null ? null : ref(r["expected"]),
      "local-operator",
      string(r["reason"]),
      null,
      () => {
        this.current(a);
        for (const p of a.payload.state.pages)
          if (!this.accepted(pid, p.artifact))
            throw new InputError("Website page lacks acceptance");
      },
    );
    return this.workspace.state(pid);
  }
  async exportWebsite(pid: string, r: VersionRef) {
    const a = this.website(pid, r);
    if (!this.accepted(pid, r))
      throw new InputError("Exact Website acceptance required");
    const files = new Map<string, Buffer>();
    const pages = a.payload.state.pages.map((route) => ({
      ...route,
      state: this.page(pid, route.artifact).payload.state,
    }));
    for (const entry of pages) {
      if (!this.accepted(pid, entry.artifact))
        throw new InputError("Website page lacks acceptance");
      const dir = entry.route.slice(1);
      const href = (route: string) => {
        const target = route.startsWith("/")
          ? pages.find(
              (p) => p.route === (route.endsWith("/") ? route : route + "/"),
            )
          : null;
        return target
          ? posix.relative(dir || ".", target.route.slice(1) + "index.html")
          : route;
      };
      const nav =
        '<nav aria-label="Website">' +
        pages
          .map(
            (p) =>
              `<a href="${escapeHtml(href(p.route))}">${escapeHtml(p.label)}</a>`,
          )
          .join(" · ") +
        "</nav>";
      files.set(
        dir + "index.html",
        Buffer.from(
          renderPage(
            entry.state.page,
            (b) => posix.relative(dir || ".", imagePath(b.image)),
            nav,
            href,
          ),
        ),
      );
      for (const b of Object.values(entry.state.page.media))
        if (b) {
          this.media(pid, b.asset);
          files.set(imagePath(b.image), this.workspace.assets.read(b.image.id));
        }
    }
    const manifest = {
      schema: "bve.website-assembly-handoff",
      version: 1,
      assembly: reference(a),
      integrity: a.integrity,
      title: a.payload.state.title,
      pages,
      assets: [...files.keys()].filter((x) => x.startsWith("assets/")),
      acceptance: this.workspace.kernel
        .ledger(pid)
        .events.filter((e) => e.kind === "acceptance" && same(e.subject, r)),
    };
    files.set(
      "manifest.json",
      Buffer.from(JSON.stringify(manifest, null, 2) + "\n"),
    );
    files.set(
      "RECONSTRUCT.md",
      Buffer.from(
        "Each page owns its complete semantic design and exact media bindings. Navigation/routes belong to this Website assembly; no page depends on another page artifact. Files use relative links for standalone static inspection. Verify manifest and media hashes; source acceptance is evidence, not automatic local approval.\n",
      ),
    );
    const bytes = tar(files, "website");
    return { bytes, checksum: await this.hashBytes(bytes), manifest };
  }
}
