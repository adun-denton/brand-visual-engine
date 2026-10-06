/** Experimental v1 contracts. Runtime import validation belongs at the S1 boundary. */
export type Provider = 'fixture' | 'native' | 'openai' | 'comfyui';
export type Role = 'composition' | 'typography' | 'palette' | 'material' | 'imagery' | 'avoid';
export type JobState = 'queued' | 'running' | 'awaiting_external_result' | 'succeeded'
  | 'failed' | 'cancelled' | 'outcome_unknown';
export interface Project {
  schemaVersion: 1;
  id: string;
  revision: number;
  brief: { id: string; audience: string; offer: string; response: string; requiredContent: string[];
    exclusions: string[]; commitments: string[]; unresolved: string[]; source: 'synthetic' };
  references: { id: string; path: string; role: Role; scope: string[]; permittedUse: 'synthetic-test'; source: string }[];
  directions: { id: string; status: 'proposal' | 'provisional' | 'approved'; referenceIds: string[];
    rationale: string; unresolved: string[] }[];
  style: { palette: string[]; font: string; spacing: number };
  sections: { id: string; kind: 'hero' | 'services' | 'proof' | 'contact'; text: string;
    acceptedVersionId: string | null; overrides: Record<string, string | number> }[];
}
export interface Raster { width: number; height: number; pixels: number[] }
export interface AssetVersion {
  id: string; projectId: string; sectionId: string; parentId: string | null;
  checksum: string; width: number; height: number; path: string; provider: Provider;
}
export interface Region {
  id: string; sourceVersionId: string; width: number; height: number;
  coordinateSystem: 'pixel-top-left'; mask: number[];
}
export interface Job {
  id: string; projectId: string; sectionId: string; sourceVersionId: string | null; regionId: string | null;
  briefRevisionId: string; sourceProjectRevision: number;
  provider: Provider; recipeVersion: string; instruction: string; referenceIds: string[];
  settings: Record<string, string | number | boolean> | null;
  providerId: string | null; usage: Record<string, number> | null;
  state: JobState; outputVersionIds: string[]; error: string | null;
}
export interface Decision {
  id: string; projectId: string; sectionId: string; previousVersionId: string | null;
  chosenVersionId: string; reviewer: string; reason: string; at: string;
}
export interface Handoff {
  schemaVersion: 1; projectId: string; projectRevision: number; briefRevisionId: string;
  style: Project['style']; sections: { id: string; kind: string; text: string;
    overrides: Record<string, string | number>; asset: AssetVersion | null }[];
  unresolved: string[];
}
