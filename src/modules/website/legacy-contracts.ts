import type { AssetVersion } from '../../kernel/primitives.ts';
export type Role = 'composition' | 'typography' | 'palette' | 'material' | 'imagery' | 'avoid';
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
export interface Handoff {
  schemaVersion: 1; projectId: string; projectRevision: number; briefRevisionId: string;
  style: Project['style']; sections: { id: string; kind: string; text: string;
    overrides: Record<string, string | number>; asset: AssetVersion | null }[];
  unresolved: string[];
}
