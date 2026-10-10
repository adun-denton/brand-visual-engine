// Replays session-authored synthetic text designs. Does not invoke an AI or certify designer approval.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Workspace } from "../src/service/workspace.ts";
import { Pages } from "../src/service/pages.ts";
import { reference } from "../src/kernel/packets.ts";
const stage = process.argv[2],
  evidence = resolve(process.argv[3] ?? "/tmp/bve-session-trial");
mkdirSync(evidence, { recursive: true });
const w = new Workspace(join(evidence, "runtime"));
const pages = new Pages(w);
try {
  let project = w.state().projects[0];
  if (stage === "prepare") {
    if (project) throw Error("Use a fresh trial directory");
    project = w.create({
      title: "Fictional Fieldwork Repair",
      mode: "freeroam",
      visualOS: null,
      palette: null,
    }).project!;
    w.reviseProject(project.id, {
      expectedProject: reference(project),
      brief: {
        intent:
          "A fictional repair cooperative makes routine home maintenance feel calm, clear and easy to arrange.",
        audience: "Fictional busy households",
        offer:
          "Routine maintenance and small repairs by a fictional local cooperative",
        response:
          "Invite the reader to book a planning visit; no real booking endpoint.",
        content: ["Routine care", "Small repairs", "Plan a visit"],
        exclusions: [
          "No invented testimonials, accreditations, guarantees or price claims",
        ],
        unresolved: [
          "No approved photography, actual booking address or designer selection.",
        ],
      },
      reason: "Synthetic session design rehearsal",
    });
    project = w.project(project.id);
    pages.prepare(project.id, {
      expectedProject: reference(project),
      base: null,
      operation: "create",
      instruction:
        "Author three visibly distinct responsive page proposals for this fictional repair cooperative. Use different internal structure and typography, not just color swaps. Keep the copy truthful to the synthetic brief. You have no media resources, so prefer text, space and declared CSS; make missing media optional rather than inventing resource handles. Choose your own section count. Explain the design rationale, unresolved needs, and any proposed follow-up actions as data.",
      resources: [],
      locks: [],
    });
  } else if (stage === "apply-round1" || stage === "apply-round2") {
    if (!project) throw Error("Prepare the synthetic trial first");
    const q = pages
      .state(project.id)
      .requests.find((q) => q.payload.state.status === "awaiting")!;
    await pages.apply(project.id, {
      request: reference(q),
      response: JSON.parse(
        readFileSync(
          join(
            evidence,
            stage === "apply-round1"
              ? "round1-result.json"
              : "round2-result.json",
          ),
          "utf8",
        ),
      ),
      source:
        "Primary ChatGPT session authored these synthetic text design proposals after reading the exact scoped request. No API transport or independent designer acceptance.",
      model: null,
      aiAuthorship: true,
    });
    if (stage === "apply-round1") {
      const base = pages.state(project.id).pages[0]!;
      pages.prepare(project.id, {
        expectedProject: reference(w.project(project.id)),
        base: reference(base),
        operation: "revise",
        instruction:
          "Critique and refine the editorial proposal for narrow-screen reading and stronger action hierarchy. Preserve the exact main heading. Make the action visible earlier, shorten body copy, and explain what changed. Keep optional photography unresolved. Return one complete revised snapshot.",
        locks: [
          {
            nodeId: "main-title",
            field: "text",
            value: base.payload.state.page.root
              .children!.find((n) => n.id === "intro")!
              .children!.find((n) => n.id === "main-title")!.text!,
          },
        ],
        resources: [],
      });
    }
  } else throw Error("Expected prepare, apply-round1 or apply-round2");
  const state = pages.state(project!.id);
  const q = state.requests.find((q) => q.payload.state.status === "awaiting");
  if (q) {
    const exported = pages.exportRequest(project!.id, reference(q));
    writeFileSync(
      join(
        evidence,
        stage === "prepare" ? "round1-request.json" : "round2-request.json",
      ),
      JSON.stringify(exported, null, 2) + "\n",
    );
    console.log(JSON.stringify(exported, null, 2));
  }
  writeFileSync(
    join(evidence, "trial-state.json"),
    JSON.stringify(state, null, 2) + "\n",
  );
  if (stage === "apply-round2")
    console.log(
      JSON.stringify(
        {
          pages: state.pages.map((p) => ({
            id: p.id,
            version: p.version,
            title: p.payload.state.page.title,
          })),
          results: state.results.map((r) => ({
            outcome: r.payload.state.outcome,
            source: r.payload.state.source,
            executor: r.payload.state.executor,
          })),
          accepted: state.accepted,
        },
        null,
        2,
      ),
    );
} finally {
  w.close();
}
