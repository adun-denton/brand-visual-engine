import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = mkdtempSync(join(tmpdir(), 'design os smoke '));
try {
  for (const action of ['seed', 'inspect']) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./design-os-fixture.ts', import.meta.url)), action, root], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr);
    console.log(result.stdout.trim());
  }
} finally { rmSync(root, { recursive: true, force: true }); }
