import type { VersionRef } from "../kernel/contracts.ts";
import type { Bounds } from "../modules/website/region-contracts.ts";
export const CHAT_PROTOCOL = "0.162.1";
export const chatTools = [
  "read_context",
  "update_draft",
  "prepare_design",
  "submit_candidates",
  "focus_candidate",
  "prepare_image",
] as const;
export type ChatTool = (typeof chatTools)[number];
export interface ImageTarget {
  page: VersionRef;
  slot: string;
  media: VersionRef;
  shape: "rectangle" | "ellipse";
  bounds: Bounds;
  preset?: "strict-region" | "preserve-form-change-finish" | "explore";
}
export interface ChatFocus {
  view: string;
  page: VersionRef | null;
  resources: VersionRef[];
  target: ImageTarget | null;
}
export interface ChatTurn {
  id: string;
  projectId: string;
  project: VersionRef;
  focus: ChatFocus;
  text: string;
  status:
    | "running"
    | "completed"
    | "cancelled"
    | "failed"
    | "uncertain"
    | "disconnected";
  reply: string;
  detail: string;
  threadId: string | null;
  protocolTurnId: string | null;
  requests: VersionRef[];
  candidates: VersionRef[];
  startedAt: string;
  model: string | null;
  usage: unknown | null;
  selectionRevision: number;
  suggested: VersionRef | null;
}
export interface ChatSession {
  projectId: string;
  threadId: string | null;
  active: VersionRef | null;
  compared: VersionRef[];
  selectionRevision: number;
  turns: ChatTurn[];
}
export interface ChatDriver {
  kind: "account" | "test-fixture";
  run(context: {
    turn: ChatTurn;
    history: { role: "user" | "assistant"; text: string }[];
    tool: (name: string, actionId: string, input: unknown) => Promise<unknown>;
    delta: (text: string) => void;
    thread: (id: string) => void;
    protocolTurn: (id: string) => void;
    signal: AbortSignal;
  }): Promise<{
    status: "completed" | "interrupted" | "failed";
    model: string | null;
    usage: unknown | null;
  }>;
  close(): Promise<void>;
}
export const toolDescriptions: Record<ChatTool, string> = {
  read_context:
    "Read only the frozen project brief, exact page and explicitly included media. No unrelated projects or private work records.",
  update_draft:
    "Revise the same brief using known user facts, unresolved questions and visible creative assumptions. Requires current project; no acceptance.",
  prepare_design:
    "Prepare create/revise/critique with frozen exact base, included resources and optional exact locks. Returns the complete request and output schema. BVE assigns IDs/hashes.",
  submit_candidates:
    "Submit full bve.inference-result JSON against a request prepared by this turn. Parser and preservation checks apply. Does not accept.",
  focus_candidate:
    "Focus a validated current candidate for reversible viewing/compare. Does not accept or adopt into a Website.",
  prepare_image:
    "Prepare meaningful image work against the frozen canvas image/mask. Engine capability is explicit; does not generate or accept.",
};

export interface ChatImageDriver {
  kind: "test-fixture";
  execute(input: {
    job: import("./chat-store.ts").ImageJob;
    source: Buffer;
    mask: Buffer;
    references: Buffer[];
  }): Promise<Buffer>;
}
