/** Experimental shared v1 grammar. No Website payload or provider is imported here. */
export type Value = string | number | boolean | null | Value[] | { [key: string]: Value };
export interface VersionRef { id: string; version: number; freshness: 'pinned' | 'current' }
export interface Placeholder {
  key: string; expected: string; reason: string; dependsOn: string[];
  mayProceed: string[]; blocks: string[]; prohibitedAssumptions: string[]; resolutionRoutes: string[];
}
export type PacketType = 'visual-os' | 'module-project' | 'design-artifact' | 'iteration-bundle'
  | 'bundle-template' | 'capability-registry' | 'artifact-metadata' | 'execution-record';
export interface NodePacket<T> {
  schemaVersion: 1; type: PacketType; id: string; version: number; projectId: string | null;
  contextRefs: VersionRef[]; dependencies: VersionRef[]; assets: { id: string; checksum: string }[];
  constraints: { path: string; value: Value }[]; placeholders: Placeholder[];
  approval: 'proposal' | 'accepted' | 'rejected'; permissions: string[];
  provenance: { actor: string; source: string; previous: VersionRef | null };
  payload: T; integrity: string;
}
export interface VisualOS {
  values: Record<string, { value: Value; approved: boolean }>;
  placeholders: Record<string, Placeholder>;
}
export interface LocalField {
  override: Value | null; hasOverride: boolean; derived: Value | null; hasDerived: boolean;
  placeholder: Placeholder | null; reviewRequired: boolean;
}
export interface ResolvedField {
  inherited: { value: Value; source: VersionRef } | null;
  localOverride: { value: Value } | null; derived: { value: Value } | null;
  placeholder: Placeholder | null; reviewRequired: boolean;
  effective: { value: Value; origin: 'inherited' | 'local-override' | 'derived' } | null;
}
export interface ResolvedContext { mode: 'branded' | 'freeroam'; fields: Record<string, ResolvedField> }
export interface ModuleProject {
  moduleId: string; mode: 'branded' | 'freeroam'; visualOSRef: VersionRef | null;
  localContext: Record<string, LocalField>; resolvedContext: ResolvedContext; artifactRefs: VersionRef[];
}
export interface DesignArtifact<T = Value> {
  moduleId: string; kind: string; scope: string; lockedValues: Record<string, Value>; state: T;
}
export type MetricFamily = 'Structural' | 'Spatial' | 'Styling' | 'Dynamics';
export interface Dimension { family: MetricFamily | string; key: string; relative: number }
export interface CapabilityRequest { capabilityId: string; inputType: string; outputType: string }
export interface IterationBundle {
  projectRef: VersionRef; baseState: VersionRef | null; scope: string;
  inherited: Record<string, Value>; locked: Record<string, Value>; exploring: Dimension[];
  placeholders: Placeholder[]; variationPlan: { strategy: 'coherent-grid'; amplitude: number };
  candidateCount: number; candidates: VersionRef[]; selection: VersionRef | null;
  status: 'draft' | 'awaiting-capability' | 'candidates-ready' | 'selected';
  capabilities: CapabilityRequest[]; executionRefs: VersionRef[];
}
export interface BundleTemplate {
  name: string; scope: string; requiredContext: string[]; preservedPaths: string[];
  dimensions: Dimension[]; candidateCount: number; capabilityIds: string[];
  variationStrategy: 'coherent-grid';
}
export interface CapabilityDescriptor { id: string; inputType: string; outputType: string; version: number }
export type ExecutorKind = 'cloud' | 'local' | 'chinvat' | 'deterministic' | 'human';
export interface ExecutorDescriptor {
  id: string; kind: ExecutorKind; capabilities: string[]; available: boolean;
  observedSettings: Record<string, Value> | null;
}
export interface CapabilityRegistry { capabilities: CapabilityDescriptor[]; executors: ExecutorDescriptor[] }
export interface ExecutionRecord {
  request: CapabilityRequest; executorId: string | null; bundleRef: VersionRef;
  state: 'awaiting' | 'succeeded' | 'failed' | 'cancelled' | 'outcome-unknown';
  externalId: string | null; observedSettings: Record<string, Value> | null;
}
export interface LedgerEvent {
  id: string; projectId: string; sequence: number; subject: VersionRef;
  kind: 'revision' | 'selection' | 'acceptance' | 'legacy-import'; actor: string; reason: string;
  at: string; related: VersionRef[];
}
export interface ProjectLedger { projectId: string; events: LedgerEvent[] }
export interface ArtifactMetadata {
  schemaVersion: 1; artifact: VersionRef; project: VersionRef; visualOS: VersionRef | null;
  bundle: VersionRef | null; ledgerProjectId: string; artifactIntegrity: string;
}
export interface ModuleManifest {
  id: string; version: number; implementation: 'implemented' | 'placeholder';
  inputType: PacketType; outputType: PacketType; capabilities: CapabilityRequest[];
}
export interface PortContract {
  packetType: PacketType; schemaVersion: 1; requiredFields: string[]; requiredPermissions: string[];
  preserve: string[]; reviewOnChange: string[];
}
export interface SemanticVerifier {
  verify(input: NodePacket<unknown>, output: NodePacket<unknown>): Promise<{
    status: 'not-run' | 'findings'; findings: { message: string; reviewRequired: boolean }[];
  }>;
}
