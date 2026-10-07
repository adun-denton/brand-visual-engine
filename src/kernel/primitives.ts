/** Shared immutable media primitives; sectionId is a legacy artifact-scope identifier. */
export type JobState = 'queued' | 'running' | 'awaiting_external_result' | 'succeeded'
  | 'failed' | 'cancelled' | 'outcome_unknown';
export interface Raster { width: number; height: number; pixels: number[] }
export interface AssetVersion {
  id: string; projectId: string; sectionId: string; parentId: string | null;
  checksum: string; width: number; height: number; path: string; provider: string;
}
export interface Region {
  id: string; sourceVersionId: string; width: number; height: number;
  coordinateSystem: 'pixel-top-left'; mask: number[];
}
export interface Decision {
  id: string; projectId: string; sectionId: string; previousVersionId: string | null;
  chosenVersionId: string; reviewer: string; reason: string; at: string;
}
