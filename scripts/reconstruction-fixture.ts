/** Authored semantic fixture injection only. No OCR, inference, transport or generation. */
import type { OfflineReconstructionDriver } from "../src/service/reconstruction.ts";
import { reference } from "../src/kernel/packets.ts";
import {
  same,
  type ReconstructionSubmission,
} from "../src/modules/website/reconstruction-contracts.ts";
export class ReconstructionFixture implements OfflineReconstructionDriver {
  kind = "authored-test-fixture" as const;
  calls = 0;
  async run({
    request: q,
    signal,
  }: Parameters<
    OfflineReconstructionDriver["run"]
  >[0]): Promise<ReconstructionSubmission> {
    if (signal.aborted) throw Error("Authored fixture stopped");
    this.calls++;
    const s = q.payload.state;
    return {
      schema: "bve.reconstruction-result",
      version: 1,
      request: reference(q),
      requestHash: q.integrity,
      project: s.project,
      source: { candidate: s.source.candidate, integrity: s.source.integrity },
      baseSignature: s.base?.signature ?? null,
      receiptId: "authored-" + q.id,
      slots: s.slots.map((slot) => {
        const place = s.resources.find((r) => r.role === "placeable"),
          page: any = s.base
            ? structuredClone(s.base.page)
            : {
                version: 1,
                title: "Authored implementation " + slot,
                language: "en",
                root: {
                  id: "root",
                  kind: "container",
                  style: {
                    padding: 32,
                    background: "#edf0e5",
                    color: "#244b38",
                  },
                  children: [
                    {
                      id: "heading",
                      kind: "heading",
                      level: 1,
                      text: "Everyday, reimagined.",
                    },
                    {
                      id: "description",
                      kind: "text",
                      text: "Authored semantic fixture for offline workflow review.",
                    },
                    {
                      id: "hero",
                      kind: "media",
                      slot: "hero",
                      alt: "Explicitly supplied fixture media",
                      decorative: false,
                    },
                    {
                      id: "details",
                      kind: "section",
                      style: { padding: 24 },
                      children: [
                        {
                          id: "unresolved",
                          kind: "text",
                          text: "Visual fidelity, interaction and factual intent remain unresolved.",
                        },
                      ],
                    },
                  ],
                },
                media: { hero: place?.handle ?? null },
                responsive: [
                  { maxWidth: 600, nodeId: "root", style: { padding: 16 } },
                ],
                unresolved: [
                  "Authored fixture only; no inference or visual-fidelity claim.",
                  "Missing media is a deliberate placeholder.",
                ],
              };
        if (s.base)
          page.media = Object.fromEntries(
            Object.entries(s.base.page.media).map(([key, b]) => [
              key,
              b
                ? s.resources.find((r) => same(r.media, b.asset))!.handle
                : null,
            ]),
          );
        return {
          slot,
          candidate: {
            label: "Authored semantic proposal " + slot,
            rationale:
              "Hand-authored offline fixture; inferred differences require human review.",
            page,
            mediaRequirements: Object.keys(page.media)
              .filter((k) => page.media[k] === null)
              .map((k) => ({
                slot: k,
                instruction: "Supply appropriate placeable media explicitly.",
              })),
            proposedActions: [],
          },
        };
      }),
      findings: [
        "No OCR or inference was performed. Layout and responsive intent are authored proposals.",
      ],
      provenance: { kind: "authored-test-fixture", generation: false },
    };
  }
}
