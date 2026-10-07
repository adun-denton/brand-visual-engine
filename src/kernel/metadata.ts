import type { ArtifactMetadata, NodePacket, PacketType, VersionRef } from './contracts.ts';
import { digest, reference } from './packets.ts';
export type MetadataLookup = (ref: VersionRef) => NodePacket<unknown> | null;

// Kept independent of ContractGate: the gate and portable consumers share this boundary.
function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) throw new Error('metadata object invalid');
  return input as Record<string, unknown>;
}
function ref(input: unknown): VersionRef {
  const r = record(input);
  if (typeof r['id'] !== 'string' || !r['id'].trim() || !Number.isSafeInteger(r['version']) || Number(r['version']) < 1
    || (r['freshness'] !== 'pinned' && r['freshness'] !== 'current')) throw new Error('metadata reference invalid');
  return { id: r['id'], version: Number(r['version']), freshness: r['freshness'] as VersionRef['freshness'] };
}
const sameVersion = (a: VersionRef, b: VersionRef) => a.id === b.id && a.version === b.version;

/** Missing objects are portable unresolved pointers; known objects must agree on type and ownership. */
export function validateMetadata(input: unknown, lookup: MetadataLookup): ArtifactMetadata {
  const p = record(input);
  if (p['schemaVersion'] !== 1) throw new Error('metadata schema mismatch');
  if (typeof p['ledgerProjectId'] !== 'string' || !p['ledgerProjectId'].trim() || typeof p['artifactIntegrity'] !== 'string') throw new Error('metadata fields invalid');
  const metadata: ArtifactMetadata = { schemaVersion: 1, artifact: ref(p['artifact']), project: ref(p['project']),
    visualOS: p['visualOS'] === null ? null : ref(p['visualOS']), bundle: p['bundle'] === null ? null : ref(p['bundle']),
    ledgerProjectId: p['ledgerProjectId'], artifactIntegrity: p['artifactIntegrity'] };
  if (metadata.ledgerProjectId !== metadata.project.id) throw new Error('metadata ledger project mismatch');
  if (!/^[a-f0-9]{64}$/.test(metadata.artifactIntegrity)) throw new Error('metadata integrity invalid');
  const known = (pointer: VersionRef | null, type: PacketType): NodePacket<unknown> | null => {
    const packet = pointer === null ? null : lookup(pointer);
    if (packet) {
      if (!sameVersion(reference(packet), pointer!)) throw new Error('metadata reference identity mismatch');
      if (packet.type !== type) throw new Error('metadata reference type mismatch');
      const { integrity, ...body } = packet;
      if (packet.schemaVersion !== 1 || digest(body) !== integrity) throw new Error('metadata referenced packet integrity mismatch');
    }
    return packet;
  };
  const artifact = known(metadata.artifact, 'design-artifact');
  const project = known(metadata.project, 'module-project');
  const visualOS = known(metadata.visualOS, 'visual-os');
  const bundle = known(metadata.bundle, 'iteration-bundle');
  if (artifact) {
    if (artifact.projectId !== metadata.project.id) throw new Error('metadata artifact owner project mismatch');
    if (artifact.integrity !== metadata.artifactIntegrity) throw new Error('metadata integrity mismatch');
  }
  if (project && project.projectId !== project.id) throw new Error('metadata project owner mismatch');
  if (artifact && project && record(artifact.payload)['moduleId'] !== record(project.payload)['moduleId']) throw new Error('metadata module owner mismatch');
  if (visualOS && visualOS.projectId !== null && visualOS.projectId !== metadata.project.id) throw new Error('metadata VisualOS owner mismatch');
  if (bundle) {
    const payload = record(bundle.payload), owner = ref(payload['projectRef']);
    if (bundle.projectId !== metadata.project.id || owner.id !== metadata.project.id) throw new Error('metadata bundle owner project mismatch');
    known(owner, 'module-project');
    if (!Array.isArray(payload['candidates'])) throw new Error('metadata bundle candidates invalid');
    const related = payload['candidates'].map(ref);
    if (payload['baseState'] !== null) related.push(ref(payload['baseState']));
    if (payload['selection'] !== null && !payload['candidates'].map(ref).some(pointer => sameVersion(pointer, ref(payload['selection'])))) throw new Error('metadata bundle selection mismatch');
    if (!related.some(pointer => sameVersion(pointer, metadata.artifact))) throw new Error('metadata bundle does not reference artifact');
  }
  return metadata;
}

export function artifactMetadata(artifact: NodePacket<unknown>, project: NodePacket<unknown>,
    visualOS: VersionRef | null, bundle: VersionRef | null, lookup: MetadataLookup = () => null): ArtifactMetadata {
  const metadata: ArtifactMetadata = { schemaVersion: 1, artifact: reference(artifact), project: reference(project), visualOS, bundle,
    ledgerProjectId: project.id, artifactIntegrity: artifact.integrity };
  return validateMetadata(metadata, pointer => sameVersion(pointer, reference(artifact)) ? artifact
    : sameVersion(pointer, reference(project)) ? project : lookup(pointer));
}
/** Returns suggestions/pointers only. No hydration or mode transition happens here. */
export function reconnect(input: ArtifactMetadata, lookup: MetadataLookup) {
  const metadata = validateMetadata(input, lookup);
  const refs = [metadata.artifact, metadata.project, metadata.visualOS, metadata.bundle].filter((r): r is VersionRef => r !== null);
  const available: VersionRef[] = [], missing: VersionRef[] = [];
  for (const ref of refs) (lookup(ref) ? available : missing).push(ref);
  return { available, missing, suggestedVisualOS: metadata.visualOS, requiresExplicitMount: true as const };
}
