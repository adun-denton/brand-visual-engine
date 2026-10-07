import { createHash } from 'node:crypto';
import type { NodePacket, Placeholder, Value, VersionRef } from './contracts.ts';

/** Stable checksum over JSON data; rejects undefined, non-finite numbers and non-JSON objects. */
export function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + Array.from(value, canonical).join(',') + ']';
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const record = value as Record<string, unknown>;
    return '{' + Object.keys(record).sort().map(key => JSON.stringify(key) + ':' + canonical(record[key])).join(',') + '}';
  }
  throw new Error('non-JSON state');
}
export function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
export const reference = (packet: Pick<NodePacket<unknown>, 'id' | 'version'>, freshness: VersionRef['freshness'] = 'pinned'): VersionRef =>
  ({ id: packet.id, version: packet.version, freshness });
export function packet<T>(input: Pick<NodePacket<T>, 'type' | 'id' | 'payload'> & Partial<Omit<NodePacket<T>, 'integrity' | 'payload' | 'type' | 'id'>>): NodePacket<T> {
  const body = { schemaVersion: 1 as const, version: 1, projectId: null, contextRefs: [], dependencies: [],
    assets: [], constraints: [], placeholders: [], approval: 'proposal' as const, permissions: ['read', 'write'],
    provenance: { actor: 'synthetic-fixture', source: 'authored fixture', previous: null }, ...input };
  return { ...body, integrity: digest(body) };
}
export function revise<T>(previous: NodePacket<T>, payload: T, actor: string, source: string): NodePacket<T> {
  const { integrity: _, ...body } = previous;
  return packet({ ...body, version: previous.version + 1, payload,
    provenance: { actor, source, previous: reference(previous) } });
}
export function placeholder(key: string, reason = 'No authoritative value supplied'): Placeholder {
  return { key, expected: key + ' design input', reason, dependsOn: [],
    mayProceed: ['design.explore'], blocks: ['approved-brand-export'],
    prohibitedAssumptions: ['Do not infer an approved ' + key],
    resolutionRoutes: ['explicit human input', 'reviewed local exploration'] };
}
export function atPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) =>
    typeof current === 'object' && current !== null && Object.hasOwn(current, key)
      ? (current as Record<string, unknown>)[key] : undefined, value);
}
export function valuesEqual(a: Value, b: Value): boolean { return canonical(a) === canonical(b); }
