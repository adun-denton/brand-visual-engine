/** Bounded offline decoder for the synchronous persistence gate. Input is bytes, never a path/URL. */
import { readFileSync } from "node:fs";
import { inspectRaster } from "./assets.ts";
try {
  process.stdout.write(JSON.stringify(await inspectRaster(readFileSync(0))));
} catch {
  process.exitCode = 1;
}
