/** Disposable, synthetic-only visual review. Never reads a user runtime or provider environment. */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp } from "../src/service/server.ts";
import { seedVisual, offlineVisualProviders } from "./visual-fixture.ts";
const root = mkdtempSync(join(tmpdir(), "bve-visual-review-"));
const app = await startApp(root, 0, undefined, offlineVisualProviders);
await seedVisual(app.workspace);
console.log("Synthetic visual review: " + app.origin + "/visual");
console.log("Disposable root (retained after graceful close): " + root);
console.log(
  "Choose the synthetic project, then compare review layouts A and B. No generator is connected.",
);
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    void app.close().then(() => { console.log("Synthetic review closed"); process.exit(0); });
  });
