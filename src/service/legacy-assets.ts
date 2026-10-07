import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { checksum, validateRaster } from '../kernel/raster.ts';
import type { AssetVersion, Raster } from '../kernel/primitives.ts';
/** Read-only compatibility check, not a raw legacy HTTP API or a second approval owner. */
export class LegacyAssets {
  private db: DatabaseSync | null;
  private root: string;
  constructor(root: string) {
    this.root = root;
    const path = join(root, 'workspace.sqlite');
    this.db = existsSync(path)
      ? new DatabaseSync(path, { readOnly: true })
      : null;
    if (
      this.db &&
      this.db.prepare('PRAGMA user_version').get()!['user_version'] !== 1
    ) {
      this.db.close();
      throw new Error('Unsupported legacy schema; restore with matching code');
    }
  }
  close() {
    this.db?.close();
  }
  exists(id: string, hash: string): boolean {
    try {
      if (!this.db) return false;
      const row = this.db.prepare('SELECT body FROM assets WHERE id=?').get(id);
      if (!row) return false;
      const a = JSON.parse(row['body'] as string) as AssetVersion;
      if (
        a.id !== id ||
        a.checksum !== hash ||
        !/^[a-f0-9]{64}$/.test(hash) ||
        a.path !== `assets/${hash}.rgb.json`
      )
        return false;
      const path = join(this.root, 'assets', hash + '.rgb.json'),
        stat = lstatSync(path);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.size > 12 * 1024 * 1024
      )
        return false;
      const bytes = readFileSync(path);
      if (checksum(bytes) !== hash) return false;
      const raster = JSON.parse(bytes.toString()) as Raster;
      validateRaster(raster);
      return raster.width === a.width && raster.height === a.height;
    } catch {
      return false;
    }
  }
}
