import type { KernelServices } from './kernel/store.ts';
import { moduleExists, validateArtifact } from './modules/registry.ts';
/** Offline-only services: the default fixture has no binary asset references or live authorization. */
export const fixtureServices: KernelServices = { moduleExists, validateArtifact,
  assetExists: () => false, grantedPermissions: ['read', 'write', 'accept'] };
