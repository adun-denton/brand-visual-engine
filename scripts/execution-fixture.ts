import sharp from "sharp";
import type {
  ExecutionTransport,
  ExecutionCapabilities,
  OwnedJob,
  RasterResult,
} from "../src/service/execution.ts";
export class OfflineRasterTransport implements ExecutionTransport {
  capabilities: ExecutionCapabilities = {
    version: 1,
    adapter: {
      id: "offline-raster-fixture",
      version: "1",
      mode: "offline-test",
    },
    operations: ["create", "refine", "refresh", "branch"],
    maxWidth: 2048,
    maxHeight: 2048,
    maxPixels: 4194304,
    sourceInfluence: ["style", "content", "region"],
    preservation: [],
  };
  submissions: Parameters<ExecutionTransport["submit"]>[0][] = [];
  polls: OwnedJob[] = [];
  cancellations: OwnedJob[] = [];
  jobs = new Map<
    string,
    { jobId: string; result: RasterResult; cancelled: boolean }
  >();
  mode: "immediate" | "running" | "ambiguous" | "mixed" = "immediate";
  async submit(input: Parameters<ExecutionTransport["submit"]>[0]) {
    this.submissions.push(structuredClone(input));
    const jobId = "offline-job-" + input.submissionId;
    const bytes =
      this.mode === "mixed" && input.slot % 2 === 0
        ? Buffer.from("not a raster")
        : await sharp({
            create: {
              width: input.request.width,
              height: input.request.height,
              channels: 4,
              background: { r: 40 + input.slot * 20, g: 120, b: 140, alpha: 1 },
            },
          })
            .png()
            .toBuffer();
    const result: RasterResult = {
      receiptId: "offline-receipt-" + input.submissionId,
      requestHash: input.requestHash,
      specHash: input.request.specHash,
      slot: input.slot,
      submissionId: input.submissionId,
      jobId,
      outcome: "succeeded",
      bytes,
      observed: { source: "authored fixture", generation: false },
      message: "Offline fixture bytes; no model or provider generation",
    };
    this.jobs.set(input.submissionId, { jobId, result, cancelled: false });
    if (this.mode === "ambiguous") throw new Error("Simulated ambiguous send");
    return { jobId, ...(this.mode === "running" ? {} : { result }) };
  }
  async status(job: OwnedJob) {
    this.polls.push({ ...job });
    const j = this.jobs.get(job.submissionId);
    if (!j) return { state: "unknown" as const, jobId: job.jobId };
    if (job.jobId && job.jobId !== j.jobId) throw new Error("Wrong owned job");
    return { state: "returned" as const, jobId: j.jobId, result: j.result };
  }
  async cancel(job: OwnedJob & { jobId: string }) {
    this.cancellations.push({ ...job });
    const j = this.jobs.get(job.submissionId);
    if (!j || j.jobId !== job.jobId) throw new Error("Unowned fixture job");
    j.cancelled = true;
    return { confirmed: true };
  }
}
