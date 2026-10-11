import type { Workspace } from "./workspace.ts";
import { Exploration } from "./exploration.ts";
import {
  InputError,
  record,
  string,
  ref,
  choice,
  list,
  integer,
} from "./validation.ts";
import { canonical, reference } from "../kernel/packets.ts";
import type {
  DesignArtifact,
  NodePacket,
  VersionRef,
  VisualOS,
} from "../kernel/contracts.ts";
import type {
  WorkUnit,
  Selections,
  RasterConcept,
  Membership,
  Specification,
  Metric,
} from "../modules/website/exploration-contracts.ts";
import { ExplorationConflict } from "../modules/website/exploration-contracts.ts";
import { requestControls } from "../modules/website/visual-controls.ts";
import { MAX_IMAGE_BYTES } from "./assets.ts";
export type Work<T> = NodePacket<DesignArtifact<T>>;
export function plainText(x: unknown, max = 4000): string {
  const text = string(x, max);
  if (/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text))
    throw new InputError("Use plain text without markup or control characters");
  return text;
}
export class VisualWorkspace {
  readonly w: Workspace;
  readonly exploration: Exploration;
  constructor(w: Workspace) {
    this.w = w;
    this.exploration = new Exploration(w);
  }
  catalog() {
    return {
      projects: this.w.kernel
        .latestPackets()
        .filter((p) => p.type === "module-project")
        .map((p) => ({
          ref: reference(p),
          title: String(
            (p.payload as import("../kernel/contracts.ts").ModuleProject)
              .localContext["title"]?.override ?? "Website",
          ),
        })),
      brands: this.w.kernel
        .latestPackets()
        .filter((p) => p.type === "visual-os" && p.approval === "accepted")
        .map((p) => ({
          ref: reference(p),
          label: "Approved Brand " + p.version,
        })),
    };
  }
  project(pid: string) {
    const project = this.w.project(pid);
    const order = this.order(pid);
    const units = this.w.kernel
      .latestPackets()
      .filter(
        (p) =>
          p.projectId === pid &&
          (p.payload as DesignArtifact<unknown>).kind === "page-work-unit",
      )
      .map((p) =>
        this.exploration.read<WorkUnit>(pid, reference(p), "page-work-unit"),
      )
      .sort((a, b) => order(a) - order(b));
    return {
      project: reference(project),
      title: String(
        project.payload.localContext["title"]?.override ?? "Website",
      ),
      units,
    };
  }
  state(pid: string, unit: VersionRef) {
    const u = this.exploration.read<WorkUnit>(pid, unit, "page-work-unit");
    const order = this.order(pid);
    const records = this.exploration
      .state(pid, unit)
      .sort((a, b) => order(a) - order(b));
    const memberships = records.filter(
      (p) =>
        (p.payload as DesignArtifact<unknown>).kind === "raster-membership",
    ) as Work<Membership>[];
    const candidates = [
      ...new Map(
        memberships.map((m) => {
          const c = this.exploration.read<RasterConcept>(
            pid,
            m.payload.state.candidate,
            "raster-concept",
          );
          return [c.id + ":" + c.version, c] as const;
        }),
      ).values(),
    ];
    return { ...this.project(pid), unit: u, records, candidates };
  }
  private order(pid: string) {
    const sequence = new Map<string, number>();
    for (const e of this.w.kernel.ledger(pid).events)
      if (!sequence.has(e.subject.id)) sequence.set(e.subject.id, e.sequence);
    return (p: NodePacket<unknown>) =>
      sequence.get(p.id) ?? Number.MAX_SAFE_INTEGER;
  }
  private unit(pid: string, input: unknown) {
    const r = ref(input);
    const u = this.exploration.read<WorkUnit>(pid, r, "page-work-unit");
    if (this.w.kernel.currentVersion(u.id) !== u.version)
      throw new InputError("Page changed; reload", 409);
    return r;
  }
  private selection(pid: string, unit: VersionRef, expected: unknown) {
    const current = this.exploration
      .state(pid, unit)
      .filter(
        (p) =>
          (p.payload as DesignArtifact<unknown>).kind === "raster-selections",
      ) as Work<Selections>[];
    const expectedRef = expected === null ? null : ref(expected);
    const s = expectedRef
      ? (current.find((p) => p.id === expectedRef.id) ?? null)
      : null;
    if (
      (expectedRef === null && current.length > 0) ||
      (expectedRef !== null &&
        (!s || canonical(reference(s)) !== canonical(expectedRef)))
    )
      throw new InputError(
        "Selections changed or a saved set must be chosen; reload before saving",
        409,
      );
    return s;
  }
  private member(pid: string, unit: VersionRef, candidate: VersionRef) {
    if (
      !this.state(pid, unit).candidates.some(
        (c) => canonical(reference(c)) === canonical(candidate),
      )
    )
      throw new InputError("Candidate does not belong to this page");
  }
  create(input: unknown) {
    const r = record(input, ["title"]);
    const result = this.w.create({
      title: plainText(r["title"], 100),
      mode: "freeroam",
      visualOS: null,
      palette: null,
    });
    return this.project(result.project!.id);
  }
  async command(pid: string, action: string, input: unknown): Promise<unknown> {
    try {
      return await this.perform(pid, action, input);
    } catch (error) {
      if (error instanceof ExplorationConflict)
        throw new InputError(error.message, 409);
      throw error;
    }
  }
  private async perform(
    pid: string,
    action: string,
    input: unknown,
  ): Promise<unknown> {
    const allowed: Record<string, string[]> = {
      page: ["expectedProject", "pageType", "label"],
      import: ["expectedProject", "unit", "file", "permission", "previous"],
      selections: ["expectedProject", "unit", "previous", "entries"],
      prepare: [
        "expectedProject",
        "unit",
        "selections",
        "intent",
        "count",
        "direction",
        "brand",
        "operation",
        "requests",
        "level1",
      ],
      cancel: ["expectedProject", "unit", "batch"],
      retry: ["expectedProject", "unit", "batch", "slot"],
    };
    if (!allowed[action]) throw new InputError("Not found", 404);
    const r = record(input, allowed[action]);
    this.w.project(pid, ref(r["expectedProject"]));
    if (action === "page")
      return this.exploration.createWorkUnit(pid, {
        version: 1,
        pageType: choice(r["pageType"], ["homepage", "about", "custom"]),
        label: plainText(r["label"], 100),
        source: "Explicit visual workspace page entry",
      });
    const unit = this.unit(pid, r["unit"]);
    if (action === "import") {
      const encoded = string(r["file"], Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4);
      if (encoded.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))
        throw new InputError("Invalid encoded raster");
      const bytes = Buffer.from(encoded, "base64");
      if (bytes.toString("base64") !== encoded)
        throw new InputError("Non-canonical encoded raster");
      const previous = r["previous"] === null ? null : ref(r["previous"]);
      if (previous) this.member(pid, unit, previous);
      return this.exploration.importCandidate(
        pid,
        unit,
        bytes,
        plainText(r["permission"]),
        "imported",
        previous,
        ref(r["expectedProject"]),
      );
    }
    if (action === "selections") {
      const old = this.selection(pid, unit, r["previous"]);
      const entries = list(r["entries"], (v) => {
        const e = record(v, [
          "id",
          "candidate",
          "anchor",
          "intent",
          "notes",
          "target",
        ]);
        const candidate = ref(e["candidate"]);
        this.member(pid, unit, candidate);
        const c = this.exploration.read<RasterConcept>(
          pid,
          candidate,
          "raster-concept",
        );
        const intent = choice(e["intent"], ["inspiration", "include", "exact"]);
        const notes = list(e["notes"], (n) => {
          const x = record(n, ["id", "text"]);
          const text = plainText(x["text"]);
          const previousEntry = old?.payload.state.entries.find(
            (entry) =>
              entry.id === e["id"] &&
              canonical(entry.candidate) === canonical(candidate),
          );
          const previousNote = previousEntry?.notes.find(
            (note) => note.id === x["id"] && note.text === text,
          );
          return {
            id: x["id"],
            text,
            source: previousNote?.source ?? "User annotation",
          };
        });
        return {
          id: e["id"],
          candidate,
          integrity: c.integrity,
          image: c.payload.state.image,
          orientation: "encoded-top-left",
          coordinates: "normalized-original",
          anchor: e["anchor"],
          intent,
          notes,
          preservation:
            intent === "exact"
              ? { predicate: "retained-bytes", target: e["target"] }
              : null,
        };
      });
      return this.exploration.selections(
        pid,
        { version: 1, workUnit: unit, entries },
        old ? reference(old) : null,
      );
    }
    if (action === "prepare") {
      const sel = this.selection(pid, unit, r["selections"]);
      const direction = choice(r["direction"], ["fresh", "follow"]);
      let brand: Specification["brand"] = { enabled: false };
      if (r["brand"] !== null) {
        const source = ref(r["brand"]);
        const b = this.w.kernel.get<VisualOS>(source);
        if (
          b.type !== "visual-os" ||
          b.approval !== "accepted" ||
          b.projectId !== null
        )
          throw new InputError("Choose an approved Brand source");
        brand = {
          enabled: true,
          source,
          integrity: b.integrity,
          values: Object.fromEntries(
            Object.entries(b.payload.values)
              .filter(([, v]) => v.approved)
              .map(([k, v]) => [k, v.value]),
          ),
        };
      }
      const requests = list(r["requests"], (v) => this.request(v, 2, sel));
      const level1 = list(r["level1"], (v) => this.request(v, 1, sel));
      if (
        new Set([...requests, ...level1].map((x) => x.key)).size !==
        requests.length + level1.length
      )
        throw new InputError("Duplicate request");
      const specification: Specification = {
        version: 1,
        compiler: "raster-input-v1",
        project: reference(this.w.project(pid)),
        workUnit: unit,
        medium: "website-raster",
        operation: choice(r["operation"], [
          "create",
          "refine",
          "refresh",
          "branch",
        ]),
        selections: sel ? reference(sel) : null,
        selectionSnapshot: sel?.payload.state ?? null,
        rawIntent: plainText(r["intent"], 12000),
        count: integer(r["count"], 6),
        resources: [],
        direction,
        brand,
        sourceScopes: (sel?.payload.state.entries ?? []).map((e) => ({
          entryId: e.id,
          style: direction === "follow" ? "included" : "excluded",
          content: e.intent === "inspiration" ? "excluded" : "included",
        })),
        facts: [],
        constraints: level1.map((m) => ({
          path: "request." + m.key,
          value: m.value,
        })),
        metricRequests: requests,
        provenance:
          "Explicit visual workspace preparation; requests are not measured state",
        executionAuthorization: null,
      };
      return this.exploration.prepareOperation(pid, specification);
    }
    const batch = ref(r["batch"]);
    const b = this.exploration.read<
      import("../modules/website/exploration-contracts.ts").Batch
    >(pid, batch, "raster-batch");
    if (
      canonical(b.payload.state.workUnit) !== canonical(unit) ||
      this.w.kernel.currentVersion(b.id) !== b.version
    )
      throw new InputError("Stale or foreign page batch", 409);
    if (action === "cancel") return this.exploration.cancel(pid, batch);
    return this.exploration.prepareBatch(pid, b.payload.state.spec, {
      batch,
      slot: integer(r["slot"], 6),
    });
  }
  private request(
    input: unknown,
    level: 1 | 2,
    sel: Work<Selections> | null,
  ): Metric {
    const r = record(input, ["key", "value", "entryId"]);
    const key = string(r["key"], 80);
    const control = requestControls.find(
      (c) => c.key === key && c.level === level,
    );
    if (!control || control.unavailable)
      throw new InputError("Request unavailable for static raster");
    const scope = r["entryId"] === null ? "page" : string(r["entryId"], 160);
    if (
      scope !== "page" &&
      !sel?.payload.state.entries.some((e) => e.id === scope)
    )
      throw new InputError("Request scope is not a selection");
    let value = r["value"] as Metric["value"];
    let scale: Metric["scale"];
    if (["scale", "count", "px"].includes(control.type)) {
      const max =
        control.type === "scale" ? 10 : control.type === "count" ? 100 : 8192;
      const min =
        control.type === "scale"
          ? 1
          : control.key === "corner-rounding"
            ? 0
            : 1;
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < min ||
        value > max ||
        (control.type !== "scale" && !Number.isInteger(value))
      )
        throw new InputError("Request value is outside its declared scale");
      scale = {
        kind: "continuous",
        min,
        max,
        unit:
          control.type === "scale"
            ? "semantic-1-to-10"
            : control.type === "px"
              ? "px"
              : "count",
      };
    } else {
      value = plainText(value, 100);
      if (control.type === "color" && !/^#[0-9a-fA-F]{6}$/.test(value))
        throw new InputError("Use a six-digit hex color");
      if (control.options && !control.options.includes(value))
        throw new InputError("Unsupported request category");
      scale = { kind: "category", options: control.options ?? [value] };
    }
    return {
      key: scope + "--" + key,
      status: "requested",
      value,
      scale,
      provenance:
        "User request for " +
        scope +
        "; does not measure or alter raster pixels",
    };
  }
}
