import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { InputError } from './validation.ts';

const unavailable = () => new InputError('Private account storage is unprotected or unavailable; use a fresh protected local runtime');
export function assertOutsideGit(path: string): void {
  let current = dirname(resolve(path));
  for (;;) {
    if (existsSync(join(current, '.git'))) throw new InputError('Account policy must be outside Git');
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
// Fixed bundled helper; path/data travel through stdin, never shell interpolation or argv.
function windows(operation: string, path: string, data?: string): string {
  try {
    const binary = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const output = execFileSync(binary, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(import.meta.dirname, 'private-storage.ps1')], {
      input: JSON.stringify({ operation, path, data }), encoding: 'utf8', windowsHide: true,
      timeout: 15000, maxBuffer: 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const result = JSON.parse(output) as { ok: boolean; data?: string };
    if (!result.ok) throw unavailable();
    return result.data ?? '';
  } catch { throw unavailable(); } // Never repeat command input, credential contents or helper stderr.
}
function noLinks(path: string) {
  let current = resolve(path);
  for (;;) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw unavailable();
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
function posixProtected(path: string, directory: boolean) {
  noLinks(path);
  const stat = lstatSync(path);
  if ((directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)
    || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid!()) throw unavailable();
}
export function ensurePrivateDirectory(path: string): void {
  if (!isAbsolute(path)) throw unavailable();
  try {
    if (process.platform === 'win32') { windows('directory', resolve(path)); return; }
    noLinks(path);
    if (!existsSync(path)) {
      const parent = dirname(path);
      if (!existsSync(parent)) ensurePrivateDirectory(parent);
      mkdirSync(path, { mode: 0o700 });
    }
    posixProtected(path, true);
  } catch { throw unavailable(); }
}
export function readPrivateJson(path: string): unknown {
  if (!isAbsolute(path)) throw unavailable();
  try {
    // Reject hard-linked files too; ACLs/mode are shared by every hard link.
    if (lstatSync(path).nlink !== 1) throw unavailable();
    if (process.platform === 'win32') return JSON.parse(windows('read', resolve(path)));
    posixProtected(dirname(path), true);
    posixProtected(path, false);
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch { throw unavailable(); }
}
export function writePrivateJson(path: string, data: unknown): void {
  if (!isAbsolute(path) || parse(path).base === '') throw unavailable();
  const content = JSON.stringify(data) + '\n';
  try {
    if (existsSync(path) && lstatSync(path).nlink !== 1) throw unavailable();
    if (process.platform === 'win32') { windows('write', resolve(path), content); return; }
    posixProtected(dirname(path), true);
    if (existsSync(path)) posixProtected(path, false);
    noLinks(path);
    const tmp = join(dirname(path), '.' + randomUUID() + '.tmp');
    let fd: number | undefined;
    try {
      fd = openSync(tmp, 'wx', 0o600);
      writeFileSync(fd, content); fsyncSync(fd); closeSync(fd); fd = undefined;
      renameSync(tmp, path);
      posixProtected(path, false);
    } finally {
      if (fd !== undefined) closeSync(fd);
      if (existsSync(tmp)) unlinkSync(tmp);
    }
  } catch { throw unavailable(); }
}
