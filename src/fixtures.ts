import { readFileSync } from 'node:fs';
import type { Project, Raster } from './contracts.ts';
import type { Store } from './store.ts';
const load = <T>(file: string): T => JSON.parse(readFileSync(new URL('../fixtures/' + file, import.meta.url), 'utf8')) as T;
export const website = (): Project => load('website.json');
export const sourceRaster = (): Raster => load('source.rgb.json');
export const candidateRaster = (): Raster => load('candidate.rgb.json');
export const regionFixture = (): { width: number; height: number; coordinateSystem: 'pixel-top-left'; mask: number[] } => load('region.json');
export const providerFixture = (): { recipeVersion: string; instruction: string; referenceIds: string[];
  outcomes: ('success' | 'failure' | 'unknown' | 'cancelled')[]; settings: Record<string, number> } => load('provider-outcomes.json');

/** Controlled completion, deliberately without network/timers; caller chooses fixture outcome. */
export function completeFixture(store: Store, jobId: string, outcome: 'success' | 'failure' | 'unknown' | 'cancelled'): string | null {
  if (store.job(jobId).provider !== 'fixture') throw new Error('fixture provider required');
  const job = store.transition(jobId, 'running');
  if (outcome !== 'success') {
    store.transition(job.id, outcome === 'failure' ? 'failed' : outcome === 'unknown' ? 'outcome_unknown' : 'cancelled');
    return null;
  }
  return store.finishJob(job.id, candidateRaster()).id;
}
