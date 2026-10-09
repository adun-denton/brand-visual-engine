import { createHash } from 'node:crypto';
import type { Raster, Region } from './primitives.ts';

export function validateRaster(value: Raster): void {
  if (
    !Number.isSafeInteger(value.width) ||
    !Number.isSafeInteger(value.height) ||
    value.width < 1 ||
    value.height < 1 ||
    value.width * value.height > 1_000_000 ||
    !Array.isArray(value.pixels) ||
    value.pixels.length !== value.width * value.height * 3 ||
    !value.pixels.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
  ) {
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
  if (
    region.coordinateSystem !== 'pixel-top-left' ||
    region.width !== source.width ||
    region.height !== source.height ||
    region.mask.length !== source.width * source.height ||
    !region.mask.every((v) => v === 0 || v === 1) ||
    !region.mask.includes(1)
  ) {
    throw new Error('invalid region geometry');
  }
}
/** Strict binary-mask compositing: no boundary blend; outside pixels are copied exactly. */
export function composite(
  source: Raster,
  candidate: Raster,
  region: Region,
): Raster {
  validateRegion(region, source);
  validateRaster(candidate);
  if (source.width !== candidate.width || source.height !== candidate.height) {
    throw new Error('candidate geometry changed');
  }
  const result = compositePixels(
    { ...source, channels: 3, pixels: Uint8Array.from(source.pixels) },
    { ...candidate, channels: 3, pixels: Uint8Array.from(candidate.pixels) },
    Uint8Array.from(region.mask),
  );
  return {
    width: result.width,
    height: result.height,
    pixels: Array.from(result.pixels),
  };
}
export function outsideDifference(
  source: Raster,
  result: Raster,
  region: Region,
): number {
  validateRegion(region, source);
  validateRaster(result);
  if (source.width !== result.width || source.height !== result.height)
    throw new Error('geometry mismatch');
  return outsidePixelDifference(
    { ...source, channels: 3, pixels: Uint8Array.from(source.pixels) },
    { ...result, channels: 3, pixels: Uint8Array.from(result.pixels) },
    Uint8Array.from(region.mask),
  ).rgb;
}

/** Bounded production raster; identical binary/no-blend semantics without fixture JSON arrays. */
export interface PixelRaster {
  width: number;
  height: number;
  channels: 3 | 4;
  pixels: Uint8Array;
}
export const MAX_REGION_PIXELS = 4_000_000;
export function validatePixels(r: PixelRaster): void {
  if (
    !Number.isSafeInteger(r.width) ||
    !Number.isSafeInteger(r.height) ||
    r.width < 1 ||
    r.height < 1 ||
    r.width * r.height > MAX_REGION_PIXELS ||
    ![3, 4].includes(r.channels) ||
    !(r.pixels instanceof Uint8Array) ||
    r.pixels.length !== r.width * r.height * r.channels
  )
    throw new Error('Invalid bounded pixel raster');
}
export function validateBinaryMask(
  mask: Uint8Array,
  width: number,
  height: number,
): void {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > MAX_REGION_PIXELS ||
    !(mask instanceof Uint8Array) ||
    mask.length !== width * height ||
    !mask.every((v) => v === 0 || v === 1) ||
    !mask.includes(1)
  )
    throw new Error('Invalid binary mask geometry');
}
function compatible(
  source: PixelRaster,
  candidate: PixelRaster,
  mask: Uint8Array,
): void {
  validatePixels(source);
  validatePixels(candidate);
  validateBinaryMask(mask, source.width, source.height);
  if (
    candidate.width !== source.width ||
    candidate.height !== source.height ||
    candidate.channels !== source.channels
  )
    throw new Error(
      'Candidate geometry changed; align explicitly and reselect',
    );
}
export function compositePixels(
  source: PixelRaster,
  candidate: PixelRaster,
  mask: Uint8Array,
): PixelRaster {
  compatible(source, candidate, mask);
  const pixels = new Uint8Array(source.pixels);
  for (let p = 0; p < mask.length; p++)
    if (mask[p] === 1)
      for (let c = 0; c < source.channels; c++)
        pixels[p * source.channels + c] =
          candidate.pixels[p * source.channels + c]!;
  return {
    width: source.width,
    height: source.height,
    channels: source.channels,
    pixels,
  };
}
export function outsidePixelDifference(
  source: PixelRaster,
  candidate: PixelRaster,
  mask: Uint8Array,
): { rgb: number; alpha: number } {
  compatible(source, candidate, mask);
  let rgb = 0,
    alpha = 0;
  for (let p = 0; p < mask.length; p++)
    if (mask[p] === 0)
      for (let c = 0; c < source.channels; c++)
        if (
          source.pixels[p * source.channels + c] !==
          candidate.pixels[p * source.channels + c]
        ) {
          if (c === 3) alpha++;
          else rgb++;
        }
  return { rgb, alpha };
}
