import type { ModuleManifest } from '../kernel/contracts.ts';
import { websiteManifest, validateWebsiteArtifact } from './website/design.ts';
export const moduleRegistry: readonly ModuleManifest[] = [websiteManifest];
export const moduleExists = (id: string): boolean => moduleRegistry.some(m => m.id === id && m.implementation === 'implemented');
export function validateArtifact(moduleId: string, payload: Record<string, unknown>): void {
  if (moduleId !== 'website') throw new Error('unimplemented module');
  validateWebsiteArtifact(payload);
}
