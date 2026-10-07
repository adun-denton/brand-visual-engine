/** Compatibility imports for the original S0 fixtures. New domain contracts live in kernel/. */
export type { Project, Handoff, Role } from './modules/website/legacy-contracts.ts';
export type { Raster, AssetVersion, Region, Decision, JobState } from './kernel/primitives.ts';
export type { Provider, Job } from './executors/legacy-contracts.ts';
