import type { DesignArtifact, ModuleProject, Value } from '../../kernel/contracts.ts';
import type { KernelStore } from '../../kernel/store.ts';
import type { Store } from './legacy-store.ts';
import { localField, resolveContext } from '../../kernel/context.ts';
import { packet, reference } from '../../kernel/packets.ts';

/** Explicit additive snapshot. Legacy decisions remain historical evidence, never new approval. */
export function importLegacyWebsite(legacy: Store, kernel: KernelStore, legacyId: string, actor: string, reason: string) {
  const snapshot = legacy.snapshot(legacyId); // Verifies every asset without mutating the source.
  const id = 'legacy-website-' + legacyId;
  if (kernel.currentVersion(id) !== null) throw new Error('legacy snapshot already imported');
  const local = { intent: localField({ hasOverride: true, override: snapshot.project.brief.response }),
    content: localField({ hasOverride: true, override: snapshot.project.sections.map(s => s.text) }),
    palette: localField({ hasOverride: true, override: snapshot.project.style.palette, reviewRequired: true }) };
  const project = packet<ModuleProject>({ type: 'module-project', id, projectId: id,
    provenance: { actor, source: reason, previous: null }, payload: { moduleId: 'website', mode: 'freeroam',
      visualOSRef: null, localContext: local, resolvedContext: resolveContext('freeroam', null, local, ['typeface', 'motion']), artifactRefs: [] } });
  const artifact = packet<DesignArtifact>({ type: 'design-artifact', id: id + '-snapshot', projectId: id,
    provenance: { actor, source: reason, previous: null }, dependencies: [reference(project)],
    assets: snapshot.assets.map(a => ({ id: a.id, checksum: a.checksum })),
    payload: { moduleId: 'website', kind: 'legacy-snapshot', scope: 'site', lockedValues: {},
      state: JSON.parse(JSON.stringify(snapshot)) as Value } });
  kernel.importSnapshot(id, [project, artifact], actor, reason);
  return { project, artifact };
}
