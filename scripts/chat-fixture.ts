// Mechanical injected model responses. This is never wired into the production app.
import type { ChatDriver } from "../src/service/chat-contracts.ts";
import type { Page, Lock } from "../src/modules/website/page.ts";
import type { VersionRef } from "../src/kernel/contracts.ts";
export class ChatFixture implements ChatDriver {
  kind = "test-fixture" as const;
  calls = 0;
  async run(c: Parameters<ChatDriver["run"]>[0]) {
    this.calls++;
    c.thread("fixture-thread-" + c.turn.projectId);
    const wait = (ms: number) =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        c.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(Error("Stopped fixture"));
          },
          { once: true },
        );
      });
    c.delta("Mechanical test reply. ");
    await wait(c.turn.text.includes("slow") ? 1500 : 60);
    const context = (await c.tool("read_context", "context", {})) as {
      base: { page: Page } | null;
    };
    if (c.turn.focus.target) {
      await c.tool("prepare_image", "image", {
        instruction: c.turn.text,
        preset: "strict-region",
      });
      c.delta("Image work prepared; image engine unavailable.");
      return { status: "completed" as const, model: null, usage: null };
    }
    const refine = !!context.base;
    if (!refine)
      await c.tool("update_draft", "draft", {
        brief: {
          title: c.turn.text.includes("bicycle")
            ? "Bicycle repair"
            : "Night garden",
          intent: c.turn.text,
          audience: "",
          offer: "",
          response: "",
          content: [],
          unresolved: [
            "Opening hours, pricing and contact details are unknown.",
          ],
        },
        assumptions: [
          "Practical type and generous spacing are provisional creative choices.",
        ],
      });
    const locks: Lock[] = refine
      ? [
          {
            nodeId: "heading",
            field: "text",
            value: context.base!.page.root.children!.find(
              (n) => n.id === "heading",
            )!.text!,
          },
        ]
      : [];
    const q = (await c.tool("prepare_design", "prepare", {
      operation: c.turn.text.includes("critique")
        ? "critique"
        : refine
          ? "revise"
          : "create",
      instruction: c.turn.text,
      locks,
    })) as {
      request: VersionRef;
      requestId: string;
      requestHash: string;
      base: Page | null;
    };
    const heading = refine
      ? q.base!.root.children!.find((n) => n.id === "heading")!.text!
      : c.turn.text.includes("bicycle")
        ? "Repairs that keep you riding"
        : "A garden after dark";
    const page = (variant: number): Page => ({
      version: 1,
      title: refine
        ? "Calmer revision"
        : variant
          ? "Compact alternative"
          : "Editorial alternative",
      language: "en",
      root: {
        id: "root",
        kind: "container",
        style: {
          padding: 32,
          background: "#f6f4ef",
          color: "#153932",
          maxWidth: 960,
        },
        children: [
          {
            id: "heading",
            kind: "heading",
            level: 1,
            text: heading,
            style: { fontSize: variant ? 36 : 48 },
          },
          ...(variant
            ? []
            : [
                {
                  id: "story",
                  kind: "section" as const,
                  style: { padding: 24 },
                  children: [
                    {
                      id: "description",
                      kind: "text" as const,
                      text: refine
                        ? "A calmer rhythm, with the exact heading preserved."
                        : "Synthetic authored fixture; facts remain unresolved.",
                    },
                  ],
                },
              ]),
        ],
      },
      media: {},
      responsive: [{ maxWidth: 600, nodeId: "root", style: { padding: 16 } }],
      unresolved: ["Contact details unknown"],
    });
    const candidates = c.turn.text.includes("critique")
      ? []
      : (refine ? [page(0)] : [page(0), page(1)]).map((p) => ({
          label: p.title,
          rationale: "Mechanical fixture alternatives; zero GPT/image calls.",
          page: p,
          mediaRequirements: [],
          proposedActions: [],
        }));
    const response = {
      schema: "bve.inference-result",
      version: 1,
      requestId: q.requestId,
      requestHash: q.requestHash,
      candidates,
      findings: c.turn.text.includes("critique")
        ? ["Review the unknown contact details."]
        : [],
    };
    const result = (await c.tool("submit_candidates", "submit", {
      request: q.request,
      response,
    })) as { candidates: VersionRef[] };
    if (result.candidates[0])
      await c.tool("focus_candidate", "focus", {
        candidate: result.candidates[0],
      });
    c.delta(
      refine
        ? "Exact heading retained. Review the revision before acceptance."
        : "Two alternatives are ready for explicit review.",
    );
    return { status: "completed" as const, model: null, usage: null };
  }
  async close() {}
}
