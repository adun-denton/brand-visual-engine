/** Authored offline tool/protocol exercise. No inference/generation claim. */
import type { OfflineAuxiliaryDriver } from "../src/service/auxiliary.ts";
import { ReconstructionFixture } from "./reconstruction-fixture.ts";
export class AuxiliaryFixture implements OfflineAuxiliaryDriver {
  kind = "authored-test-fixture" as const;
  calls = 0;
  inputs: any[] = [];
  handler:
    | ((
        input: Parameters<OfflineAuxiliaryDriver["run"]>[0],
      ) => Promise<Awaited<ReturnType<OfflineAuxiliaryDriver["run"]>>>)
    | null = null;
  async run(input: Parameters<OfflineAuxiliaryDriver["run"]>[0]) {
    this.calls++;
    this.inputs.push({
      mode: input.mode,
      context: structuredClone(input.context),
      contextDigest: input.contextDigest,
      thread: input.thread,
      images: structuredClone(input.images),
      history: structuredClone(input.history),
      tools: [...input.tools],
      toolSchemas: structuredClone(input.toolSchemas),
    });
    if (this.handler) return this.handler(input);
    await input.tool("read_scope", "read-scope", {});
    if (input.mode === "reconstruction") {
      const q = input.request!;
      const fixture = new ReconstructionFixture();
      const response = await fixture.run({
        request: q,
        source: Buffer.from(
          input.images[0]!.input.url.split(",")[1]!,
          "base64",
        ),
        resources: [],
        signal: input.signal,
      });
      await input.tool("submit_reconstruction", "submit-authored", {
        response,
      });
      return {
        reply: "Authored semantic fixture submitted for independent review.",
        provenance: { kind: this.kind, generation: false as const },
      };
    }
    const draft = input.draft!,
      field =
        draft.editable.find((f) => ["intent", "instruction"].includes(f)) ??
        draft.editable[0]!;
    const after =
      field === "count"
        ? 2
        : field === "viewports"
          ? [
              { width: 1440, height: 1000 },
              { width: 390, height: 844 },
            ]
          : field.startsWith("level")
            ? 6
            : "Make the hierarchy clearer; keep unknown factual content unresolved.";
    await input.tool("propose_edit", "edit-authored", {
      edits: [{ field, after }],
      rationale: "Authored bounded draft suggestion; explicit Apply required.",
    });
    await input.tool("recommend_prepare", "recommend-authored", {
      text: "Inspect the proposed draft, Apply deliberately, then use the existing Prepare button.",
    });
    return {
      reply:
        "A draft suggestion is ready. No draft, selection, Brand or operation changed.",
      provenance: { kind: this.kind, generation: false as const },
    };
  }
  async close() {}
}
