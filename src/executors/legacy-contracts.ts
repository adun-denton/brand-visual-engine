/** Historical fixture/adapter records; new Website domain code requests capabilities instead. */
import type { JobState } from '../kernel/primitives.ts';
export type Provider = 'fixture' | 'native' | 'openai' | 'comfyui';
export interface Job {
  id: string; projectId: string; sectionId: string; sourceVersionId: string | null; regionId: string | null;
  briefRevisionId: string; sourceProjectRevision: number;
  provider: Provider; recipeVersion: string; instruction: string; referenceIds: string[];
  settings: Record<string, string | number | boolean> | null;
  providerId: string | null; usage: Record<string, number> | null;
  state: JobState; outputVersionIds: string[]; error: string | null;
}
