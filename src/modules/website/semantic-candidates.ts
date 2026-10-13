/** Shared strict candidate grammar; legacy diagnostics and normalization stay unchanged. */
import { pageLimits as limits } from "./page-contracts.ts";
import {
  parsePage,
  pageAt,
  preservation,
  type PageState,
  type MediaBinding,
  type Lock,
} from "./page.ts";
import type { Value } from "../../kernel/contracts.ts";
import { record, list, string, InputError } from "../../service/validation.ts";
export function parseSemanticCandidates(
  input: unknown,
  context: Record<string, Value>,
  locks: Lock[],
  resolve: (handle: string) => MediaBinding,
) {
  let candidateIndex = 0;
  return list(
    input,
    (v) => {
      const index = candidateIndex++;
      const field = <T>(path: string, expected: string, parse: () => T) =>
        pageAt(path, undefined, expected, parse);
      try {
        const c = field(
          "candidate",
          "label,rationale,page,mediaRequirements,proposedActions only",
          () =>
            record(v, [
              "label",
              "rationale",
              "page",
              "mediaRequirements",
              "proposedActions",
            ]),
        );
        field("candidate.label", "nonblank label; max200 UTF-16 units", () =>
          string(c["label"], limits.title),
        );
        const page = parsePage(c["page"], resolve);
        preservation(page, locks);
        let needIndex = 0;
        const needs = field(
          "candidate.mediaRequirements",
          "array of at most100 media needs",
          () =>
            list(
              c["mediaRequirements"],
              (v) => {
                const path = `candidate.mediaRequirements[${needIndex++}]`;
                const n = field(path, "slot,instruction only", () =>
                  record(v, ["slot", "instruction"]),
                );
                const slot = field(
                  path + ".slot",
                  "existing slot in this same page (own page.media property); max160 UTF-16 units",
                  () => {
                    const value = string(n["slot"], limits.identity);
                    if (!Object.hasOwn(page.media, value))
                      throw new InputError(
                        "Media need targets an unknown slot",
                      );
                    return value;
                  },
                );
                return (
                  slot +
                  ": " +
                  field(
                    path + ".instruction",
                    "nonblank instruction; max4000 UTF-16 units",
                    () => string(n["instruction"]),
                  )
                );
              },
              limits.entries,
            ),
        );
        let actionIndex = 0;
        const actions = field(
          "candidate.proposedActions",
          "array of at most32 proposed-only actions",
          () =>
            list(
              c["proposedActions"],
              (v) =>
                "Proposed only: " +
                field(
                  `candidate.proposedActions[${actionIndex++}]`,
                  "nonblank action; max4000 UTF-16 units",
                  () => string(v),
                ),
              limits.actions,
            ),
        );
        return {
          page,
          context: context,
          locks: locks,
          rationale: field(
            "candidate.rationale",
            "nonblank rationale; max4000 UTF-16 units",
            () => string(c["rationale"]),
          ),
          notes: [...needs, ...actions],
        };
      } catch (error) {
        if (error instanceof InputError)
          throw new InputError(
            `Candidate ${index + 1}: ${error.message}`,
            error.status,
          );
        throw error;
      }
    },
    limits.candidates,
  );
}
