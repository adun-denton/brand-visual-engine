/** Shared primitive validation, independent of module-specific gates. */
import type { VersionRef } from "./contracts.ts";
export function object(value: unknown): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    throw new Error("expected object");
  return value as Record<string, unknown>;
}
export function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error("required string");
  return value;
}
export function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("expected array");
  return Array.from(value);
}
export function versionRef(value: unknown): VersionRef {
  const r = object(value);
  return {
    id: text(r["id"]),
    version: positive(r["version"]),
    freshness: member(r["freshness"], [
      "pinned",
      "current",
    ]) as VersionRef["freshness"],
  };
}
function positive(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1)
    throw new Error("invalid version/count");
  return Number(value);
}
function member(value: unknown, options: string[]): string {
  if (!options.includes(text(value))) throw new Error("unsupported enum");
  return value as string;
}
