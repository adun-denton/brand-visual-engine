import type { ArtifactMetadata, NodePacket, VersionRef } from './contracts.ts';
import { reference } from './packets.ts';
export function artifactMetadata(artifact: NodePacket<unknown>, project: NodePacket<unknown>,
    visualOS: VersionRef | null, bundle: VersionRef | null): ArtifactMetadata {
  return { schemaVersion: 1, artifact: reference(artifact), project: reference(project), visualOS, bundle,
    ledgerProjectId: project.id, artifactIntegrity: artifact.integrity };
}
/** Returns suggestions/pointers only. No hydration or mode transition happens here. */
export function reconnect(metadata: ArtifactMetadata, lookup: (ref: VersionRef) => NodePacket<unknown> | null) {
  const refs = [metadata.artifact, metadata.project, metadata.visualOS, metadata.bundle].filter((r): r is VersionRef => r !== null);
  const available: VersionRef[] = [], missing: VersionRef[] = [];
  for (const ref of refs) (lookup(ref) ? available : missing).push(ref);
  const artifact = lookup(metadata.artifact);
  if (artifact && artifact.integrity !== metadata.artifactIntegrity) throw new Error('metadata integrity mismatch');
  return { available, missing, suggestedVisualOS: metadata.visualOS, requiresExplicitMount: true as const };
}
