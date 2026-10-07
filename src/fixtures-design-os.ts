import type { CapabilityRegistry, ModuleProject, NodePacket, VisualOS } from './kernel/contracts.ts';
import { localField, resolveContext } from './kernel/context.ts';
import { packet, placeholder, reference } from './kernel/packets.ts';
export function syntheticVisualOS(): NodePacket<VisualOS> {
  return packet({ type: 'visual-os', id: 'visual-os-synthetic', approval: 'accepted', payload: {
    values: { palette: { value: ['#173f45', '#f3ede0', '#de8159'], approved: true },
      typeface: { value: 'system-ui', approved: true }, unreviewedClaim: { value: 'best quality', approved: false } },
    placeholders: { motion: placeholder('motion') } } });
}
export function syntheticProject(mode: 'branded' | 'freeroam', visualOS: NodePacket<VisualOS> | null): NodePacket<ModuleProject> {
  const local = { intent: localField({ hasOverride: true, override: 'Request a fictional home-care appointment' }),
    content: localField({ hasOverride: true, override: ['Routine care', 'Seasonal checks', 'Small repairs'] }),
    density: localField({ hasDerived: true, derived: 'calm', reviewRequired: true }) };
  const context = resolveContext(mode, visualOS, local, ['intent', 'content', 'palette', 'typeface', 'motion']);
  const id = 'website-' + mode;
  return packet({ type: 'module-project', id, projectId: id,
    contextRefs: visualOS ? [reference(visualOS)] : [],
    payload: { moduleId: 'website', mode, visualOSRef: visualOS ? reference(visualOS) : null,
      localContext: local, resolvedContext: context, artifactRefs: [] } });
}
export function syntheticCapabilities(): NodePacket<CapabilityRegistry> {
  return packet({ type: 'capability-registry', id: 'capabilities-synthetic', payload: {
    capabilities: [{ id: 'design.explore', version: 1, inputType: 'module-project', outputType: 'design-artifact' },
      { id: 'image.edit', version: 1, inputType: 'design-artifact', outputType: 'design-artifact' }],
    executors: [{ id: 'fixture-design', kind: 'deterministic', capabilities: ['design.explore'], available: true, observedSettings: null },
      { id: 'manual-import', kind: 'human', capabilities: ['image.edit'], available: true, observedSettings: null },
      { id: 'cloud-unconfigured', kind: 'cloud', capabilities: ['image.edit'], available: false, observedSettings: null },
      { id: 'local-unconfigured', kind: 'local', capabilities: ['image.edit'], available: false, observedSettings: null },
      { id: 'chinvat-unconfigured', kind: 'chinvat', capabilities: ['image.edit'], available: false, observedSettings: null }] } });
}
