import { createHash } from 'node:crypto';
import type { Raster, Region } from './primitives.ts';

export function validateRaster(value: Raster): void {
  if (!Number.isSafeInteger(value.width) || !Number.isSafeInteger(value.height)
      || value.width < 1 || value.height < 1 || value.width * value.height > 1_000_000
      || !Array.isArray(value.pixels) || value.pixels.length !== value.width * value.height * 3
      || !value.pixels.every(n => Number.isInteger(n) && n >= 0 && n <= 255)) {
    throw new Error('invalid RGB fixture');
  }
}
export function rasterBytes(value: Raster): Buffer {
  validateRaster(value);
  return Buffer.from(JSON.stringify(value));
}
export function checksum(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
export function validateRegion(region: Region, source: Raster): void {
  validateRaster(source);
  if (region.coordinateSystem !== 'pixel-top-left' || region.width !== source.width
      || region.height !== source.height || region.mask.length !== source.width * source.height
      || !region.mask.every(v => v === 0 || v === 1) || !region.mask.includes(1)) {
    throw new Error('invalid region geometry');
  }
}
/** Strict binary-mask compositing: no boundary blend; outside pixels are copied exactly. */
export function composite(source: Raster, candidate: Raster, region: Region): Raster {
  validateRegion(region, source);
  validateRaster(candidate);
  if (source.width !== candidate.width || source.height !== candidate.height) {
    throw new Error('candidate geometry changed');
  }
  return { width: source.width, height: source.height, pixels: source.pixels.map((v, i) =>
    region.mask[Math.floor(i / 3)] === 1 ? candidate.pixels[i]! : v) };
}
export function outsideDifference(source: Raster, result: Raster, region: Region): number {
  validateRegion(region, source);
  validateRaster(result);
  if (source.width !== result.width || source.height !== result.height) throw new Error('geometry mismatch');
  return source.pixels.reduce((count, v, i) => count
    + (region.mask[Math.floor(i / 3)] === 0 && v !== result.pixels[i] ? 1 : 0), 0);
}
