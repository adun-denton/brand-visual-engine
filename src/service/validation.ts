import { object, versionRef } from '../kernel/gate.ts';
import type { VersionRef } from '../kernel/contracts.ts';
export class InputError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
export function record(
  value: unknown,
  allowed: string[],
): Record<string, unknown> {
  let r: Record<string, unknown>;
  try {
    r = object(value);
  } catch {
    throw new InputError('Expected a JSON object');
  }
  if (Object.keys(r).some((k) => !allowed.includes(k)))
    throw new InputError('Unknown input field');
  return r;
}
export function string(value: unknown, max = 4000, empty = false): string {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (!empty && !value.trim())
  )
    throw new InputError('Text is missing or too long');
  return value.trim();
}
export function id(value: unknown): string {
  const s = string(value, 160);
  if (!/^[a-zA-Z0-9_-]+$/.test(s)) throw new InputError('Invalid identity');
  return s;
}
export function ref(value: unknown): VersionRef {
  record(value, ['id', 'version', 'freshness']);
  let r: VersionRef;
  try {
    r = versionRef(value);
  } catch {
    throw new InputError('Invalid version pointer');
  }
  id(r.id);
  return r;
}
export function list<T>(
  value: unknown,
  parse: (x: unknown) => T,
  max = 32,
): T[] {
  if (!Array.isArray(value) || value.length > max)
    throw new InputError('Invalid or excessive list');
  return value.map(parse);
}
export function choice<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T {
  if (!allowed.includes(value as T)) throw new InputError('Unsupported choice');
  return value as T;
}
export const roles = [
  'composition',
  'typography',
  'palette',
  'material',
  'imagery',
  'form',
  'avoid',
] as const;
export const scopes = [
  'landing-page',
  'hero',
  'services',
  'proof',
  'contact',
] as const;
export function integer(value: unknown, max: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > max)
    throw new InputError('Invalid count');
  return Number(value);
}
export function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new InputError('Expected a boolean');
  return value;
}
