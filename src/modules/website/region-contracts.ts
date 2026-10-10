import type { VersionRef } from '../../kernel/contracts.ts';
import type { ImageInfo } from '../../service/assets.ts';
import type { ReferenceInput } from './workspace-contracts.ts';
import { parseImageInfo, parseReference } from './workspace-contracts.ts';
import {
  record,
  ref,
  string,
  integer,
  choice,
  list,
} from '../../service/validation.ts';
import { canonical } from '../../kernel/packets.ts';
import { MAX_REGION_PIXELS } from '../../kernel/raster.ts';
export const REGION_DECODING = 'auto-orient-srgb-uchar-rgba-v1';
export const presets = [
  'explore',
  'preserve-form-change-finish',
  'selected-area',
] as const;
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface RegionSelection {
  source: VersionRef;
  image: ImageInfo;
  width: number;
  height: number;
  coordinateSystem: 'pixel-top-left';
  decoding: typeof REGION_DECODING;
  shape: 'rectangle' | 'ellipse';
  bounds: Bounds;
  mask: { id: string; checksum: string; bytes: number };
}
export interface RegionRecipe {
  preset: (typeof presets)[number];
  version: 'website-region-v1';
  path: 'native' | 'api';
  controls: { size: string; quality: string } | null;
  supported: string[];
  unavailable: string[];
  mask: 'guidance-only' | 'unsupported';
}
export interface RegionOperation {
  project: VersionRef;
  source: VersionRef;
  selection: VersionRef;
  execution: VersionRef;
  references: (ReferenceInput & { image: ImageInfo })[];
  instructions: string;
  preservation: 'review-raw' | 'strict-composite';
  recipe: RegionRecipe;
  selectedAtStart: VersionRef | null;
  outputs: VersionRef[];
}
export interface RegionImage {
  image: ImageInfo;
  source: VersionRef;
  operation: VersionRef;
  selection: VersionRef;
  raw: VersionRef;
  parentAsset: ImageInfo;
  variant: 'raw' | 'strict-composite';
  decoding: typeof REGION_DECODING;
  boundary: 'hard-edge-no-blend';
  outsideDifference: { rgb: number; alpha: number } | null;
}
export interface RegionComparison {
  operation: VersionRef;
  selection: VersionRef;
  source: VersionRef;
  compared: VersionRef[];
  selected: VersionRef | null;
  reason: string;
}
export function pinned(x: unknown): VersionRef {
  const r = ref(x);
  if (r.freshness !== 'pinned') throw new Error('Region input must be pinned');
  return r;
}
export function parseBounds(
  value: unknown,
  width: number,
  height: number,
): Bounds {
  const r = record(value, ['x', 'y', 'width', 'height']);
  const x = Number(r['x']),
    y = Number(r['y']);
  if (
    typeof r['x'] !== 'number' ||
    typeof r['y'] !== 'number' ||
    !Number.isSafeInteger(x) ||
    !Number.isSafeInteger(y) ||
    x < 0 ||
    y < 0
  )
    throw new Error('Invalid source-pixel origin');
  const w = integer(r['width'], width),
    h = integer(r['height'], height);
  if (x + w > width || y + h > height)
    throw new Error('Selection is outside the source');
  return { x, y, width: w, height: h };
}
export function resolveRecipe(
  preset: unknown,
  path: unknown,
  controls: unknown,
): RegionRecipe {
  const p = choice(preset, presets),
    route = choice(path, ['native', 'api']);
  if (route === 'native') {
    if (controls !== null)
      throw new Error('Native settings are unknown; controls unavailable');
    return {
      preset: p,
      path: route,
      version: 'website-region-v1',
      controls: null,
      mask: 'guidance-only',
      supported: ['instructions', 'references', 'manual-mask-guidance'],
      unavailable: [
        'seed',
        'cfg',
        'quality',
        'size',
        'remote-cancel',
        'provider-exact-preservation',
        'extend-canvas',
        'final-detail',
      ],
    };
  }
  const c = record(controls, ['size', 'quality']);
  return {
    preset: p,
    path: route,
    version: 'website-region-v1',
    controls: {
      size: choice(c['size'], ['1024x1024', '1536x1024', '1024x1536']),
      quality: choice(c['quality'], ['low', 'medium', 'high']),
    },
    mask: 'unsupported',
    supported: [
      'instructions',
      'references',
      'one-opaque-png',
      'size',
      'quality',
    ],
    unavailable: [
      'mask',
      'seed',
      'cfg',
      'remote-cancel',
      'provider-exact-preservation',
      'extend-canvas',
      'final-detail',
    ],
  };
}
export function parseSelection(value: unknown): RegionSelection {
  const r = record(value, [
    'source',
    'image',
    'width',
    'height',
    'coordinateSystem',
    'decoding',
    'shape',
    'bounds',
    'mask',
  ]);
  const width = integer(r['width'], 8192),
    height = integer(r['height'], 8192);
  if (
    width * height > MAX_REGION_PIXELS ||
    r['coordinateSystem'] !== 'pixel-top-left' ||
    r['decoding'] !== REGION_DECODING
  )
    throw new Error('Unsupported region dimensions or coordinates');
  const m = record(r['mask'], ['id', 'checksum', 'bytes']);
  const checksum = string(m['checksum'], 64);
  if (
    !/^[a-f0-9]{64}$/.test(checksum) ||
    m['id'] !== checksum ||
    m['bytes'] !== width * height
  )
    throw new Error('Mask descriptor mismatch');
  return {
    source: pinned(r['source']),
    image: parseImageInfo(r['image']),
    width,
    height,
    coordinateSystem: 'pixel-top-left',
    decoding: REGION_DECODING,
    shape: choice(r['shape'], ['rectangle', 'ellipse']),
    bounds: parseBounds(r['bounds'], width, height),
    mask: { id: checksum, checksum, bytes: width * height },
  };
}
export function parseOperation(value: unknown): RegionOperation {
  const r = record(value, [
    'project',
    'source',
    'selection',
    'execution',
    'references',
    'instructions',
    'preservation',
    'recipe',
    'selectedAtStart',
    'outputs',
  ]);
  const recipe = record(r['recipe'], [
    'preset',
    'version',
    'path',
    'controls',
    'supported',
    'unavailable',
    'mask',
  ]);
  const resolved = resolveRecipe(
    recipe['preset'],
    recipe['path'],
    recipe['controls'],
  );
  if (canonical(recipe) !== canonical(resolved))
    throw new Error('Region recipe mismatch');
  return {
    project: pinned(r['project']),
    source: pinned(r['source']),
    selection: pinned(r['selection']),
    execution: pinned(r['execution']),
    references: list(
      r['references'],
      (x) => {
        const v = record(x, [
          'artifact',
          'label',
          'role',
          'scope',
          'selected',
          'image',
        ]);
        return {
          ...parseReference(
            Object.fromEntries(
              Object.entries(v).filter(([k]) => k !== 'image'),
            ),
          ),
          image: parseImageInfo(v['image']),
        };
      },
      4,
    ),
    instructions: string(r['instructions']),
    preservation: choice(r['preservation'], ['review-raw', 'strict-composite']),
    recipe: resolved,
    selectedAtStart:
      r['selectedAtStart'] === null ? null : pinned(r['selectedAtStart']),
    outputs: list(r['outputs'], pinned, 1000),
  };
}
export function parseRegionImage(value: unknown): RegionImage {
  const r = record(value, [
    'image',
    'source',
    'operation',
    'selection',
    'raw',
    'parentAsset',
    'variant',
    'decoding',
    'boundary',
    'outsideDifference',
  ]);
  const variant = choice(r['variant'], ['raw', 'strict-composite']);
  if (
    r['decoding'] !== REGION_DECODING ||
    r['boundary'] !== 'hard-edge-no-blend'
  )
    throw new Error('Invalid raster policy');
  if (
    variant === 'raw'
      ? r['outsideDifference'] !== null
      : canonical(r['outsideDifference']) !== canonical({ rgb: 0, alpha: 0 })
  )
    throw new Error('Strict preservation evidence mismatch');
  return {
    image: parseImageInfo(r['image']),
    source: pinned(r['source']),
    operation: pinned(r['operation']),
    selection: pinned(r['selection']),
    raw: pinned(r['raw']),
    parentAsset: parseImageInfo(r['parentAsset']),
    variant,
    decoding: REGION_DECODING,
    boundary: 'hard-edge-no-blend',
    outsideDifference: variant === 'raw' ? null : { rgb: 0, alpha: 0 },
  };
}
export function parseRegionComparison(value: unknown): RegionComparison {
  const r = record(value, [
    'operation',
    'selection',
    'source',
    'compared',
    'selected',
    'reason',
  ]);
  const compared = list(r['compared'], pinned, 3);
  if (
    !compared.length ||
    new Set(compared.map((p) => p.id)).size !== compared.length
  )
    throw new Error('Choose distinct region candidates');
  const selected = r['selected'] === null ? null : pinned(r['selected']);
  if (selected && !compared.some((p) => canonical(p) === canonical(selected)))
    throw new Error('Selected candidate is not compared');
  return {
    operation: pinned(r['operation']),
    selection: pinned(r['selection']),
    source: pinned(r['source']),
    compared,
    selected,
    reason: string(r['reason'], 500),
  };
}
export function validateRegionArtifact(p: Record<string, unknown>): boolean {
  const parsers: Record<string, (x: unknown) => unknown> = {
    'website-region-selection': parseSelection,
    'website-region-operation': parseOperation,
    'website-region-image': parseRegionImage,
    'website-region-comparison': parseRegionComparison,
  };
  const parse = parsers[String(p['kind'])];
  if (!parse) return false;
  if (
    !['hero', 'services', 'proof', 'contact'].includes(String(p['scope'])) ||
    Object.keys(record(p['lockedValues'], [])).length
  )
    throw new Error('Invalid region artifact scope');
  parse(p['state']);
  return true;
}
