import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import type { ChatSession, ChatTurn } from "./chat-contracts.ts";
export class ChatStore {
  db: DatabaseSync;
  constructor(root: string) {
    const dir = join(root, "chat-private");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    const path = join(dir, "sessions.sqlite");
    this.db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.db.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS sessions(pid TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS actions(tid TEXT, aid TEXT, hash TEXT, status TEXT, result TEXT, PRIMARY KEY(tid,aid)); CREATE TABLE IF NOT EXISTS image_jobs(id TEXT PRIMARY KEY,pid TEXT NOT NULL,body TEXT NOT NULL);",
    );
    for (const row of this.db.prepare("SELECT body FROM sessions").all()) {
      const s = JSON.parse(String(row["body"])) as ChatSession;
      for (const t of s.turns)
        if (t.status === "running") {
          t.status = "uncertain";
          t.detail =
            "Connection stopped before protocol completion. Saved receipts retained; no mutation replay.";
        }
      this.save(s);
    }
  }
  get(pid: string): ChatSession {
    const r = this.db.prepare("SELECT body FROM sessions WHERE pid=?").get(pid);
    return r
      ? JSON.parse(String(r["body"]))
      : {
          projectId: pid,
          threadId: null,
          active: null,
          compared: [],
          selectionRevision: 0,
          turns: [],
        };
  }
  owner(tid: string): string | null {
    for (const row of this.db.prepare("SELECT pid,body FROM sessions").all()) {
      const s = JSON.parse(String(row["body"])) as ChatSession;
      if (s.turns.some((t) => t.id === tid)) return String(row["pid"]);
    }
    return null;
  }
  save(s: ChatSession) {
    this.db
      .prepare(
        "INSERT INTO sessions VALUES(?,?) ON CONFLICT(pid) DO UPDATE SET body=excluded.body",
      )
      .run(s.projectId, JSON.stringify(s));
  }
  action(tid: string, aid: string) {
    return this.db
      .prepare("SELECT * FROM actions WHERE tid=? AND aid=?")
      .get(tid, aid);
  }
  reserve(tid: string, aid: string, hash: string) {
    this.db
      .prepare("INSERT INTO actions VALUES(?,?,?,'executing',NULL)")
      .run(tid, aid, hash);
  }
  finish(tid: string, aid: string, result: unknown) {
    this.db
      .prepare(
        "UPDATE actions SET status='completed',result=? WHERE tid=? AND aid=?",
      )
      .run(JSON.stringify(result), tid, aid);
  }
  jobs(pid: string) {
    return this.db
      .prepare("SELECT body FROM image_jobs WHERE pid=?")
      .all(pid)
      .map((r) => JSON.parse(String(r["body"])) as ImageJob);
  }
  putJob(j: ImageJob) {
    this.db
      .prepare(
        "INSERT INTO image_jobs VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      )
      .run(j.id, j.projectId, JSON.stringify(j));
  }
  close() {
    this.db.close();
  }
}
export interface ImageJob {
  id: string;
  projectId: string;
  target: import("./chat-contracts.ts").ImageTarget;
  instruction: string;
  preset: string;
  maskHash: string;
  dimensions: { width: number; height: number };
  references: import("../kernel/contracts.ts").VersionRef[];
  status: "unavailable" | "prepared" | "candidate";
  candidate: import("../kernel/contracts.ts").VersionRef | null;
  metadata: { model: null; settings: null; usage: null };
}
