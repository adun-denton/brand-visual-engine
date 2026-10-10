import { randomUUID } from "node:crypto";
import { reference, digest } from "../kernel/packets.ts";
import {
  nodes,
  pageSignature,
  pageFindings as importedPageFindings,
} from "../modules/website/page.ts";
import { parseBounds } from "../modules/website/region-contracts.ts";
import { drawMask, canonicalPixels } from "./regions.ts";
import { outsidePixelDifference } from "../kernel/raster.ts";
import { decode } from "./assets.ts";
import { ChatStore } from "./chat-store.ts";
import type { ImageJob } from "./chat-store.ts";
import type { Workspace } from "./workspace.ts";
import type { Pages } from "./pages.ts";
import { chatTools } from "./chat-contracts.ts";
import type {
  ChatDriver,
  ChatImageDriver,
  ChatFocus,
  ChatTurn,
} from "./chat-contracts.ts";
import type { VersionRef } from "../kernel/contracts.ts";
import {
  record,
  string,
  ref,
  id,
  list,
  choice,
  InputError,
} from "./validation.ts";
const same = (a: VersionRef | null, b: VersionRef | null) =>
  a?.id === b?.id && a?.version === b?.version;
export class Chat {
  store: ChatStore;
  workspace: Workspace;
  pages: Pages;
  driver: ChatDriver | null;
  imageDriver: ChatImageDriver | null;
  controllers = new Map<string, AbortController>();
  pending = new Set<Promise<void>>();
  queues = new Map<string, Promise<unknown>>();
  constructor(
    root: string,
    w: Workspace,
    p: Pages,
    driver?: ChatDriver,
    imageDriver?: ChatImageDriver,
  ) {
    this.store = new ChatStore(root);
    this.workspace = w;
    this.pages = p;
    this.driver = driver ?? null;
    this.imageDriver = imageDriver ?? null;
  }
  state(pid: string) {
    this.workspace.project(pid);
    const session = this.store.get(pid);
    return {
      session,
      activePage: session.active ? this.pages.page(pid, session.active) : null,
      activeFindings: session.active
        ? importedPageFindings(
            this.pages.page(pid, session.active).payload.state.page,
          )
        : [],
      jobs: this.store.jobs(pid),
      connection: this.driver
        ? this.driver.kind === "test-fixture"
          ? "test fixture · no GPT call"
          : "account adapter"
        : "disconnected",
      capabilities: {
        images: this.imageDriver
          ? "injected test image transport"
          : "unavailable",
        paid: false,
      },
    };
  }
  private turn(pid: string, tid: string) {
    const t = this.store.get(pid).turns.find((t) => t.id === tid);
    if (!t) throw new InputError("Foreign or missing turn binding");
    return t;
  }
  private persist(t: ChatTurn) {
    const s = this.store.get(t.projectId),
      i = s.turns.findIndex((x) => x.id === t.id);
    if (i < 0) throw new InputError("Missing turn");
    s.turns[i] = t;
    this.store.save(s);
  }
  private current(t: ChatTurn) {
    if (t.status !== "running" || this.controllers.get(t.id)?.signal.aborted)
      throw new InputError("Turn is no longer active", 409);
    this.workspace.project(t.projectId, t.project);
    if (
      t.focus.page &&
      this.workspace.kernel.currentVersion(t.focus.page.id) !==
        t.focus.page.version &&
      !t.candidates.some(
        (p) =>
          p.id === t.focus.page!.id &&
          p.version === this.workspace.kernel.currentVersion(p.id),
      )
    )
      throw new InputError("Canvas base changed during this turn", 409);
  }
  private focus(pid: string, input: unknown): ChatFocus {
    const r = record(input, ["view", "page", "resources", "target"]);
    const page = r["page"] === null ? null : ref(r["page"]);
    if (page) this.pages.page(pid, page);
    const resources = list(r["resources"] ?? [], ref, 32);
    resources.forEach((x) => this.pages.media(pid, x));
    let target: ChatFocus["target"] = null;
    if (r["target"] !== null && r["target"] !== undefined) {
      const v = record(r["target"], [
        "page",
        "slot",
        "media",
        "shape",
        "bounds",
        "preset",
      ]);
      const pr = ref(v["page"]),
        m = ref(v["media"]),
        p = this.pages.page(pid, pr),
        media = this.pages.media(pid, m),
        slot = string(v["slot"], 160);
      if (
        !same(page, pr) ||
        !same(p.payload.state.page.media[slot]?.asset ?? null, m)
      )
        throw new InputError(
          "Image target is not the exact selected placement",
        );
      target = {
        ...(v["preset"] !== undefined
          ? {
              preset: choice(v["preset"], [
                "strict-region",
                "preserve-form-change-finish",
                "explore",
              ]),
            }
          : {}),
        page: pr,
        media: m,
        slot,
        shape: choice(v["shape"], ["rectangle", "ellipse"]),
        bounds: parseBounds(
          v["bounds"],
          media.payload.state.image.width,
          media.payload.state.image.height,
        ),
      };
    }
    return { view: string(r["view"], 100), page, resources, target };
  }
  send(input: unknown) {
    const r = record(input, ["projectId", "text", "focus", "clientId"]);
    const text = string(r["text"], 12000),
      clientId = id(r["clientId"]);
    const priorOwner = this.store.owner(clientId);
    if (priorOwner && r["projectId"] !== null && r["projectId"] !== priorOwner)
      throw new InputError("Turn identity belongs to another project", 409);
    let pid: string;
    if (r["projectId"] === null) {
      const existing = this.workspace
        .state()
        .projects.find((p) =>
          this.store.get(p.id).turns.some((t) => t.id === clientId),
        );
      pid =
        existing?.id ??
        this.workspace.create({
          title: "Design conversation",
          mode: "freeroam",
          visualOS: null,
          palette: null,
          intake: text,
        }).project!.id;
    } else pid = id(r["projectId"]);
    const s = this.store.get(pid);
    if (s.turns.some((x) => x.id === clientId)) {
      const previous = s.turns.find((x) => x.id === clientId)!;
      if (previous.text !== text)
        throw new InputError(
          "Turn identity reused with different message",
          409,
        );
      return { projectId: pid, ...this.state(pid) };
    }
    if (s.turns.some((x) => x.status === "running"))
      throw new InputError("Stop or finish the current turn first", 409);
    const project = this.workspace.project(pid);
    const focus = this.focus(pid, r["focus"]);
    const t: ChatTurn = {
      id: clientId,
      projectId: pid,
      project: reference(project),
      focus,
      text,
      status: this.driver ? "running" : "disconnected",
      reply: "",
      detail: this.driver
        ? ""
        : "ChatGPT connection is unavailable. Your conversation and draft are saved; no candidates were generated.",
      threadId: s.threadId,
      protocolTurnId: null,
      requests: [],
      candidates: [],
      startedAt: new Date().toISOString(),
      model: null,
      usage: null,
      selectionRevision: s.selectionRevision ?? 0,
      suggested: null,
    };
    s.turns.push(t);
    this.store.save(s);
    if (this.driver) {
      const controller = new AbortController();
      this.controllers.set(t.id, controller);
      const task = this.run(t, controller);
      this.pending.add(task);
      void task.finally(() => this.pending.delete(task));
    }
    return { projectId: pid, ...this.state(pid) };
  }
  private async run(t: ChatTurn, c: AbortController) {
    try {
      const history = this.store
        .get(t.projectId)
        .turns.filter((x) => x.id !== t.id && x.status === "completed")
        .flatMap((x) => [
          { role: "user" as const, text: x.text },
          { role: "assistant" as const, text: x.reply },
        ]);
      const result = await this.driver!.run({
        turn: t,
        history,
        signal: c.signal,
        tool: (n, a, i) => this.dispatch(t.projectId, t.id, n, a, i),
        delta: (part) => {
          const now = this.turn(t.projectId, t.id);
          if (now.status === "running") {
            now.reply = (now.reply + part).slice(0, 30000);
            this.persist(now);
          }
        },
        thread: (tid) => {
          const s = this.store.get(t.projectId);
          s.threadId = tid;
          this.store.save(s);
          const now = this.turn(t.projectId, t.id);
          now.threadId = tid;
          this.persist(now);
        },
        protocolTurn: (tid) => {
          const now = this.turn(t.projectId, t.id);
          now.protocolTurnId = tid;
          this.persist(now);
        },
      });
      const now = this.turn(t.projectId, t.id);
      if (now.status === "running") {
        now.status =
          result.status === "completed"
            ? "completed"
            : result.status === "interrupted"
              ? "cancelled"
              : "failed";
        now.model = result.model;
        now.usage = result.usage;
        if (now.status === "completed" && now.suggested) {
          const s = this.store.get(t.projectId);
          if (
            (s.selectionRevision ?? 0) === now.selectionRevision &&
            this.workspace.kernel.currentVersion(now.project.id) ===
              now.project.version &&
            this.workspace.kernel.currentVersion(now.suggested.id) ===
              now.suggested.version
          ) {
            s.active = now.suggested;
            this.store.save(s);
          }
        }
        now.detail =
          now.status === "completed"
            ? "Protocol completed. Candidates remain unaccepted."
            : "Turn did not complete; receipts retained.";
        this.persist(now);
      }
    } catch (error) {
      const now = this.turn(t.projectId, t.id);
      if (now.status === "running") {
        now.status = "failed";
        now.detail =
          error instanceof InputError
            ? error.message
            : "Connection interrupted or authentication/quota unavailable. Saved work is retained; no automatic retry.";
        this.persist(now);
      }
    } finally {
      this.controllers.delete(t.id);
    }
  }
  async dispatch(
    pid: string,
    tid: string,
    name: string,
    aid: string,
    input: unknown,
  ): Promise<unknown> {
    const previous = this.queues.get(tid) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(() => this.execute(pid, tid, name, aid, input));
    this.queues.set(tid, next);
    try {
      return await next;
    } finally {
      if (this.queues.get(tid) === next) this.queues.delete(tid);
    }
  }
  private async execute(
    pid: string,
    tid: string,
    name: string,
    aid: string,
    input: unknown,
  ) {
    const tool = choice(name, chatTools),
      actionId = id(aid),
      hash = digest({ tool, input });
    const t = this.turn(pid, tid),
      prior = this.store.action(tid, actionId);
    if (prior) {
      if (prior["hash"] !== hash)
        throw new InputError(
          "Action identity reused with different input",
          409,
        );
      if (prior["status"] !== "completed")
        throw new InputError(
          "Action completion uncertain; inspect saved work, do not replay",
          409,
        );
      return JSON.parse(String(prior["result"]));
    }
    this.current(t);
    this.store.reserve(tid, actionId, hash);
    let result: unknown;
    try {
      switch (tool) {
        case "read_context": {
          record(input, []);
          const p = this.workspace.project(pid);
          result = {
            project: t.project,
            view: t.focus.view,
            brief: Object.fromEntries(
              Object.entries(p.payload.localContext)
                .filter(([k]) => !["references", "comparison"].includes(k))
                .map(([k, v]) => [k, v.override ?? null]),
            ),
            base: t.focus.page
              ? this.pages.page(pid, t.focus.page).payload.state
              : null,
            resources: t.focus.resources.map((x) => ({
              ref: x,
              state: this.pages.media(pid, x).payload.state,
            })),
            target: t.focus.target,
          };
          break;
        }
        case "update_draft": {
          const r = record(input, ["brief", "assumptions"]);
          const assumptions = list(
            r["assumptions"] ?? [],
            (x) => string(x, 500),
            16,
          );
          const b = record(r["brief"], [
            "title",
            "intent",
            "audience",
            "offer",
            "response",
            "content",
            "exclusions",
            "commitments",
            "unresolved",
            "palette",
          ]);
          if (assumptions.length)
            b["unresolved"] = [
              ...list(b["unresolved"] ?? [], (x) => string(x, 500), 16),
              ...assumptions.map((x) => "Creative assumption: " + x),
            ];
          this.workspace.reviseProject(pid, {
            expectedProject: t.project,
            brief: b,
            reason:
              "Conversation draft update; creative assumptions remain provisional",
          });
          t.project = reference(this.workspace.project(pid));
          this.persist(t);
          result = { project: t.project, brief: b };
          break;
        }
        case "prepare_design": {
          const r = record(input, ["operation", "instruction", "locks"]);
          const before = new Set(
            this.pages.state(pid).requests.map((x) => x.id),
          );
          this.pages.prepare(pid, {
            expectedProject: t.project,
            base: t.focus.page,
            operation: choice(r["operation"], ["create", "revise", "critique"]),
            instruction: string(r["instruction"], 12000),
            resources: t.focus.resources,
            ...(r["locks"] === undefined ? {} : { locks: r["locks"] }),
          });
          const q = this.pages
            .state(pid)
            .requests.find((x) => !before.has(x.id))!;
          t.requests.push(reference(q));
          this.persist(t);
          result = this.pages.exportRequest(pid, reference(q));
          break;
        }
        case "submit_candidates": {
          const r = record(input, ["request", "response"]);
          const q = ref(r["request"]);
          if (!t.requests.some((x) => same(x, q)))
            throw new InputError("Request does not originate in this turn");
          await this.pages.apply(pid, {
            request: q,
            response: r["response"],
            source:
              this.driver?.kind === "test-fixture"
                ? "Mechanical chat fixture; no GPT call"
                : "Owned app-server conversation " + tid,
            model: t.model,
            aiAuthorship: true,
            uploads: [],
          });
          const resultRecord = this.pages
            .state(pid)
            .results.find((x) => same(x.payload.state.request, q));
          if (!resultRecord) throw new InputError("No validated result");
          const live = this.turn(pid, tid);
          if (
            live.status !== "running" ||
            this.controllers.get(tid)?.signal.aborted
          )
            throw new InputError("Turn is no longer active", 409);
          this.workspace.project(pid, t.project);
          if (resultRecord.payload.state.outcome !== "applied")
            throw new InputError(
              "Result is historical; current work was preserved",
              409,
            );
          t.reply = live.reply;
          t.status = live.status;
          t.candidates.push(...resultRecord.payload.state.proposals);
          this.persist(t);
          result = {
            outcome: resultRecord.payload.state.outcome,
            candidates: resultRecord.payload.state.proposals,
            findings: resultRecord.payload.state.findings,
          };
          break;
        }
        case "focus_candidate": {
          const r = record(input, ["candidate"]);
          const p = ref(r["candidate"]);
          if (!t.candidates.some((x) => same(x, p)))
            throw new InputError(
              "Focus must identify a candidate from this turn",
            );
          this.pages.page(pid, p);
          t.suggested = p;
          this.persist(t);
          result = {
            suggested: p,
            activation: "after completed turn if local selection is unchanged",
          };
          break;
        }
        case "prepare_image": {
          const r = record(input, ["instruction", "preset"]);
          if (!t.focus.target)
            throw new InputError(
              "Select an exact canvas image and region first",
            );
          const target = t.focus.target,
            m = this.pages.media(pid, target.media).payload.state.image;
          const mask = drawMask(m.width, m.height, target.shape, target.bounds);
          const job: ImageJob = {
            id: "image-work-" + randomUUID(),
            projectId: pid,
            target,
            instruction: string(r["instruction"], 12000),
            preset:
              target.preset ??
              choice(r["preset"], [
                "strict-region",
                "preserve-form-change-finish",
                "explore",
              ]),
            maskHash: digest([...mask]),
            dimensions: { width: m.width, height: m.height },
            references: t.focus.resources,
            status: this.imageDriver ? "prepared" : "unavailable",
            candidate: null,
            metadata: { model: null, settings: null, usage: null },
          };
          this.store.putJob(job);
          result = {
            ...job,
            message: this.imageDriver
              ? "injected test image transport ready"
              : "image engine unavailable",
            externalInstruction:
              job.instruction +
              "\nKeep pixels outside the selected mask unchanged. Review the returned original before placement.",
          };
          break;
        }
      }
    } catch (error) {
      const rejected = {
        error:
          error instanceof InputError
            ? error.message
            : "Scoped action rejected",
      };
      this.store.finish(tid, actionId, rejected);
      throw error;
    }
    this.store.finish(tid, actionId, result);
    return result;
  }
  cancel(pid: string, input: unknown) {
    const r = record(input, ["turn"]);
    const t = this.turn(pid, id(r["turn"]));
    if (t.status === "running") {
      t.status = "cancelled";
      t.detail =
        "Stopped deliberately. Late replies cannot activate or accept candidates.";
      this.persist(t);
      this.controllers.get(t.id)?.abort();
      for (const q of t.requests) {
        const latest = this.pages.request(pid, {
          ...q,
          version: this.workspace.kernel.currentVersion(q.id)!,
        });
        if (latest.payload.state.status === "awaiting")
          this.pages.cancel(pid, {
            request: reference(latest),
            reason: "Conversation stopped",
          });
      }
    }
    return this.state(pid);
  }
  select(pid: string, input: unknown) {
    const r = record(input, ["candidate", "compare"]);
    const p = ref(r["candidate"]);
    this.pages.page(pid, p);
    if (this.workspace.kernel.currentVersion(p.id) !== p.version)
      throw new InputError("Choose a current candidate", 409);
    const s = this.store.get(pid);
    s.active = p;
    s.selectionRevision = (s.selectionRevision ?? 0) + 1;
    if (r["compare"] === true)
      s.compared = [...s.compared.filter((x) => !same(x, p)), p].slice(-2);
    this.store.save(s);
    return this.state(pid);
  }
  accept(pid: string, input: unknown) {
    const r = record(input, [
      "candidate",
      "reviewedHash",
      "acknowledgeFindings",
    ]);
    const p = ref(r["candidate"]);
    this.pages.accept(pid, {
      artifact: p,
      reviewedHash: r["reviewedHash"],
      acknowledgeFindings: r["acknowledgeFindings"],
      expected: this.pages.state(pid).accepted[p.id] ?? null,
      reason:
        "Operator explicitly reviewed and accepted this exact conversation candidate",
    });
    return this.state(pid);
  }
  async attach(pid: string, input: unknown) {
    const r = record(input, ["file", "job", "permission"]);
    const permission =
      r["permission"] === undefined
        ? "Pending conversational usage permission; reference only"
        : string(r["permission"], 1000);
    let job: ImageJob | undefined;
    if (r["job"] !== null) {
      job = this.store.jobs(pid).find((j) => j.id === id(r["job"]));
      if (!job) throw new InputError("Foreign image work");
      this.pages.page(pid, job.target.page);
      await this.validateImageReturn(
        pid,
        job,
        Buffer.from(string(r["file"], 12 * 1024 * 1024), "base64"),
      );
    }
    const before = new Set(this.pages.state(pid).media.map((x) => x.id));
    await this.pages.addMedia(pid, {
      expectedProject: reference(this.workspace.project(pid)),
      file: r["file"],
      origin: null,
      label: job
        ? "Returned image candidate"
        : "Deliberately attached reference",
      role: r["permission"] === undefined ? "reference" : "placeable",
      permission,
    });
    const media = this.pages.state(pid).media.find((x) => !before.has(x.id))!;
    if (job) {
      job.candidate = reference(media);
      job.status = "candidate";
      this.store.putJob(job);
    }
    return { media: reference(media), ...this.state(pid) };
  }
  private async validateImageReturn(pid: string, job: ImageJob, bytes: Buffer) {
    const m = this.pages.media(pid, job.target.media),
      info = await decode(bytes);
    if (
      info.width !== job.dimensions.width ||
      info.height !== job.dimensions.height
    )
      throw new InputError(
        "Returned image must match exact original dimensions",
      );
    if (job.preset === "strict-region") {
      const source = await canonicalPixels(
          this.workspace.assets.read(m.payload.state.image.id),
        ),
        candidate = await canonicalPixels(bytes);
      if (
        source.width !== job.dimensions.width ||
        source.height !== job.dimensions.height
      )
        throw new InputError(
          "Oriented original needs an explicit canonical asset before regional editing",
        );
      const mask = drawMask(
          source.width,
          source.height,
          job.target.shape,
          job.target.bounds,
        ),
        difference = outsidePixelDifference(source, candidate, mask);
      if (difference.rgb || difference.alpha)
        throw new InputError(
          "Strict region return changed pixels outside the selected mask",
        );
    }
  }
  async executeImage(pid: string, input: unknown) {
    const r = record(input, ["job"]);
    const job = this.store.jobs(pid).find((j) => j.id === id(r["job"]));
    if (!job || !this.imageDriver)
      throw new InputError("image engine unavailable");
    if (job.candidate) return this.state(pid);
    const source = (await this.pages.mediaBytes(pid, job.target.media)).bytes;
    const mask = drawMask(
      job.dimensions.width,
      job.dimensions.height,
      job.target.shape,
      job.target.bounds,
    );
    const bytes = await this.imageDriver.execute({
      job,
      source,
      mask,
      references: await Promise.all(
        job.references.map(
          async (x) => (await this.pages.mediaBytes(pid, x)).bytes,
        ),
      ),
    });
    await this.validateImageReturn(pid, job, bytes);
    return this.attach(pid, { file: bytes.toString("base64"), job: job.id });
  }
  async permit(pid: string, input: unknown) {
    const r = record(input, ["job", "confirmed"]);
    if (r["confirmed"] !== true)
      throw new InputError("Explicit usage permission confirmation required");
    const job = this.store.jobs(pid).find((j) => j.id === id(r["job"]));
    if (!job?.candidate) throw new InputError("No returned original");
    const origin = this.pages.media(pid, job.candidate);
    if (origin.payload.state.role === "placeable") return this.state(pid);
    const bytes = this.workspace.assets.read(origin.payload.state.image.id);
    const before = new Set(this.pages.state(pid).media.map((x) => x.id));
    await this.pages.addMedia(pid, {
      expectedProject: reference(this.workspace.project(pid)),
      file: bytes.toString("base64"),
      origin: null,
      label: origin.payload.state.label,
      role: "placeable",
      permission:
        "Operator explicitly confirmed usage permission for this exact returned original " +
        origin.integrity,
    });
    const media = this.pages.state(pid).media.find((x) => !before.has(x.id))!;
    job.candidate = reference(media);
    this.store.putJob(job);
    return this.state(pid);
  }
  async place(pid: string, input: unknown) {
    const r = record(input, ["job"]);
    const job = this.store.jobs(pid).find((x) => x.id === id(r["job"]));
    if (!job?.candidate) throw new InputError("Choose a returned candidate");
    await this.pages.place(pid, {
      artifact: job.target.page,
      slot: job.target.slot,
      media: job.candidate,
      reason: "Operator chose exact returned image candidate",
    });
    const s = this.store.get(pid);
    s.active = {
      ...job.target.page,
      version: this.workspace.kernel.currentVersion(job.target.page.id)!,
    };
    s.selectionRevision = (s.selectionRevision ?? 0) + 1;
    this.store.save(s);
    return this.state(pid);
  }
  async close() {
    for (const c of this.controllers.values()) c.abort();
    await this.driver?.close();
    await Promise.allSettled(this.pending);
    this.store.close();
  }
}
