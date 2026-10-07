import type { LocalField, NodePacket, ResolvedContext, ResolvedField, Value, VisualOS } from './contracts.ts';
import { placeholder, reference } from './packets.ts';
export const localField = (changes: Partial<LocalField> = {}): LocalField =>
  ({ override: null, hasOverride: false, derived: null, hasDerived: false,
    placeholder: null, reviewRequired: false, ...changes });

/** Both modes use this resolver; Freeroam never mounts context from artifact metadata. */
export function resolveContext(mode: ResolvedContext['mode'], visualOS: NodePacket<VisualOS> | null,
    local: Record<string, LocalField>, expected: string[]): ResolvedContext {
  if (mode === 'freeroam' && visualOS !== null) throw new Error('Freeroam cannot silently mount VisualOS');
  const fields: Record<string, ResolvedField> = {};
  const keys = new Set([...expected, ...Object.keys(local), ...Object.keys(visualOS?.payload.values ?? {}),
    ...Object.keys(visualOS?.payload.placeholders ?? {})]);
  for (const key of keys) {
    const input = local[key] ?? localField();
    const upstream = visualOS?.payload.values[key];
    const inherited = upstream?.approved && visualOS?.approval === 'accepted'
      ? { value: upstream.value, source: reference(visualOS) } : null;
    const localOverride = input.hasOverride ? { value: input.override } : null;
    const derived = input.hasDerived ? { value: input.derived } : null;
    const effective = localOverride ? { value: localOverride.value, origin: 'local-override' as const }
      : derived ? { value: derived.value, origin: 'derived' as const }
      : inherited ? { value: inherited.value, origin: 'inherited' as const } : null;
    fields[key] = { inherited, localOverride, derived, effective, reviewRequired: input.reviewRequired,
      placeholder: input.placeholder ?? visualOS?.payload.placeholders[key] ?? (effective ? null : placeholder(key)) };
  }
  return { mode, fields };
}
export function effectiveValues(context: ResolvedContext): Record<string, Value> {
  return Object.fromEntries(Object.entries(context.fields).filter(([, f]) => f.effective !== null)
    .map(([key, f]) => [key, f.effective!.value]));
}
