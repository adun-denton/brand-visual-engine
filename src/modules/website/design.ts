import type { BundleTemplate, DesignArtifact, Dimension, IterationBundle, ModuleManifest, ModuleProject, NodePacket, Value } from '../../kernel/contracts.ts';
import { effectiveValues } from '../../kernel/context.ts';
import { object, text } from '../../kernel/gate.ts';
import { validateWorkspaceArtifact } from './workspace-contracts.ts';
import { canonical, packet, reference } from '../../kernel/packets.ts';
import { parseSpec, validateAILocks } from './ai-contracts.ts';
import { validatePageRecord } from './page.ts';
import { validateInferenceRecord } from './inference-contracts.ts';
export interface WebsiteDesignState {
  scope: 'site' | 'page' | 'landing-page' | 'section' | 'component' | 'media';
  intent: string; thesis: string; sectionOrder: string[];
  parameters: Record<string, Value>; metrics: Dimension[]; unresolved: string[];
}
export const websiteManifest: ModuleManifest = { id: 'website', version: 1, implementation: 'implemented',
  inputType: 'module-project', outputType: 'design-artifact',
  capabilities: [{ capabilityId: 'design.explore', inputType: 'module-project', outputType: 'design-artifact' }] };
export const explorationTemplate: BundleTemplate = { name: 'Landing page broad exploration', scope: 'landing-page',
  requiredContext: ['intent'], preservedPaths: ['intent', 'content'], candidateCount: 9,
  dimensions: [{ family: 'Structural', key: 'hierarchy', relative: 0.5 }, { family: 'Spatial', key: 'whitespace', relative: 0.5 },
    { family: 'Styling', key: 'edge-expression', relative: 0.5 }, { family: 'Dynamics', key: 'motion-intent', relative: 0.5 }],
  capabilityIds: ['design.explore'], variationStrategy: 'coherent-grid' };
export function validateWebsiteArtifact(payload: Record<string, unknown>): void {
  if (validatePageRecord(payload) || validateInferenceRecord(payload)) return;
  if (validateWorkspaceArtifact(payload)) return;
  if (payload['kind'] === 'legacy-snapshot') { object(payload['state']); return; }
  if (payload['kind'] !== 'website-design') throw new Error('unsupported Website artifact');
  const state = object(payload['state']); text(state['intent']); text(state['thesis']);
  if (!['site', 'page', 'landing-page', 'section', 'component', 'media'].includes(text(state['scope'])) || state['scope'] !== payload['scope']) throw new Error('invalid Website design scope');
  if (!Array.isArray(state['sectionOrder']) || !state['sectionOrder'].every(s => typeof s === 'string')) throw new Error('invalid section structure');
  if (!Array.isArray(state['unresolved']) || !state['unresolved'].every(s => typeof s === 'string')) throw new Error('invalid unresolved state');
  const parameters = object(state['parameters']);
  if (parameters['ai']) { const spec = parseSpec(parameters['ai']); validateAILocks(spec.page, payload['lockedValues'] as Record<string, Value>); }
  for (const [key, value] of Object.entries(object(payload['lockedValues']))) if (canonical(parameters[key]) !== canonical(value)) throw new Error('Website lock changed');
  const metrics = state['metrics'];
  if (!Array.isArray(metrics) || !metrics.length) throw new Error('missing exploration dimensions');
  for (const m of metrics) { const d = object(m); text(d['family']); text(d['key']);
    if (typeof d['relative'] !== 'number' || d['relative'] < 0 || d['relative'] > 1) throw new Error('invalid relative dimension'); }
}

/** Deterministic synthetic proposals, not an AI/provider adapter or objective quality evaluator. */
export function exploreWebsite(project: NodePacket<ModuleProject>, bundleId: string,
    base: NodePacket<DesignArtifact<WebsiteDesignState>> | null = null, count = 9, amplitude = 0.6): {
      candidates: NodePacket<DesignArtifact<WebsiteDesignState>>[]; bundle: NodePacket<IterationBundle> } {
  if (project.payload.moduleId !== 'website') throw new Error('wrong module');
  if (!Number.isInteger(count) || count < 1 || count > 9 || amplitude < 0 || amplitude > 1) throw new Error('invalid bounded exploration');
  const parameters = effectiveValues(project.payload.resolvedContext);
  if (typeof parameters['intent'] !== 'string' || !parameters['intent'].trim()) throw new Error('intent is required; remaining context can be sparse');
  const placeholders = Object.values(project.payload.resolvedContext.fields).filter(f => f.placeholder !== null).map(f => f.placeholder!);
  const inherited = Object.fromEntries(Object.entries(project.payload.resolvedContext.fields)
    .filter(([, f]) => f.inherited !== null).map(([key, f]) => [key, f.inherited!.value]));
  const locked = Object.fromEntries(Object.entries(parameters).filter(([key]) => ['intent', 'content', 'palette'].includes(key)));
  if (base && (base.projectId !== project.id || base.payload.kind !== 'website-design')) throw new Error('refinement base scope mismatch');
  const center = base?.payload.state.metrics ?? explorationTemplate.dimensions;
  const candidates = Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / 3), column = index % 3;
    const offsets = [row % 3, column, (row + column) % 3, (2 * row + column) % 3];
    const metrics = center.map((dimension, familyIndex) => ({ ...dimension,
      relative: Math.max(0, Math.min(1, dimension.relative + ((offsets[familyIndex % 4]! - 1) * amplitude / 2))) }));
    const state: WebsiteDesignState = { scope: 'landing-page', intent: parameters['intent'] as string,
      thesis: `Synthetic direction ${index + 1}: coherent hierarchy, space, finish and interaction treatment`,
      sectionOrder: ['hero', 'services', 'proof', 'contact'], parameters, metrics,
      unresolved: placeholders.map(p => p.key) };
    return packet<DesignArtifact<WebsiteDesignState>>({ type: 'design-artifact', id: bundleId + '-candidate-' + (index + 1),
      projectId: project.id, dependencies: [reference(project), ...(base ? [reference(base)] : [])], placeholders,
      constraints: Object.entries(locked).map(([key, value]) => ({ path: 'state.parameters.' + key, value })),
      payload: { moduleId: 'website', kind: 'website-design', scope: 'landing-page', lockedValues: locked, state } });
  });
  const bundle = packet<IterationBundle>({ type: 'iteration-bundle', id: bundleId, projectId: project.id,
    contextRefs: project.contextRefs, payload: { projectRef: reference(project), baseState: base ? reference(base) : null, scope: 'landing-page',
      inherited, locked, exploring: center, placeholders,
      variationPlan: { strategy: 'coherent-grid', amplitude }, candidateCount: count,
      candidates: candidates.map(p => reference(p)), selection: null, status: 'candidates-ready',
      capabilities: websiteManifest.capabilities, executionRefs: [] } });
  return { candidates, bundle };
}
