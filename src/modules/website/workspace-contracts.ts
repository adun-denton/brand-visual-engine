import { validateProviderArtifact } from './provider-contracts.ts';
import { validateRegionArtifact } from './region-contracts.ts';
import type { VersionRef } from '../../kernel/contracts.ts';
import type { ImageInfo } from '../../service/assets.ts';
import {
  record,
  string,
  ref,
  list,
  choice,
  roles,
  scopes,
  integer,
  bool,
} from '../../service/validation.ts';
export interface ReferenceInput {
  artifact: VersionRef;
  label: string;
  role: (typeof roles)[number];
  scope: (typeof scopes)[number];
  selected: boolean;
}
export function parseReference(x: unknown): ReferenceInput {
  const r = record(x, ['artifact', 'label', 'role', 'scope', 'selected']);
  return {
    artifact: ref(r['artifact']),
    label: string(r['label'], 100),
    role: choice(r['role'], roles),
    scope: choice(r['scope'], scopes),
    selected: bool(r['selected']),
  };
}
export interface DirectionProposal {
  title: string;
  rationale: string;
  constraints: string[];
  uncertainty: string;
  unresolved: string[];
  sourceReferences: VersionRef[];
  reviewed: true;
  source: string;
}
export function parseDirection(x: unknown): DirectionProposal {
  const p = record(x, [
    'title',
    'rationale',
    'constraints',
    'uncertainty',
    'unresolved',
    'sourceReferences',
    'reviewed',
    'source',
  ]);
  if (p['reviewed'] !== true)
    throw new Error('Explicit reviewed proposal required');
  return {
    title: string(p['title'], 160),
    rationale: string(p['rationale']),
    constraints: list(p['constraints'], (s) => string(s, 500)),
    uncertainty: string(p['uncertainty']),
    unresolved: list(p['unresolved'], (s) => string(s, 500)),
    sourceReferences: list(p['sourceReferences'], ref),
    reviewed: true,
    source: string(p['source'], 500),
  };
}
export interface NativeManifest {
  contractVersion: 1;
  jobId: string;
  project: VersionRef;
  moduleId: 'website';
  scope: (typeof scopes)[number];
  artifact: VersionRef;
  inputAsset: ImageInfo | null;
  instructions: string;
  references: (ReferenceInput & { image: ImageInfo })[];
  selection: VersionRef | null;
  preservation: string[];
  providerPath: 'manual-native-export';
  model: null;
  settings: null;
  seed: null;
  usage: null;
  providerId: null;
}
export interface Outcome {
  kind:
    | 'candidate'
    | 'late'
    | 'late-cancelled'
    | 'duplicate'
    | 'invalid'
    | 'cancelled'
    | 'abandoned';
  message: string;
  at: string;
  artifact: VersionRef | null;
  checksum: string | null;
}
export interface NativeJob {
  manifest: NativeManifest;
  status: 'awaiting' | 'returned' | 'cancelled' | 'abandoned';
  outcomes: Outcome[];
  outputs: VersionRef[];
}
export interface ImageState {
  image: ImageInfo;
  job: VersionRef | null;
  originalArtifact: VersionRef | null;
  parentAsset: ImageInfo | null;
  outcome: 'reference' | 'candidate' | 'late' | 'late-cancelled';
  providerPath: 'manual-native-import' | 'manual-reference';
  model: null;
  settings: null;
  seed: null;
  usage: null;
  providerId: null;
}
export function parseImageInfo(value: unknown): ImageInfo {
  const p = record(value, [
    'id',
    'checksum',
    'width',
    'height',
    'format',
    'bytes',
  ]);
  const hash = string(p['checksum'], 64);
  if (!/^[a-f0-9]{64}$/.test(hash) || p['id'] !== hash)
    throw new Error('Invalid image checksum');
  return {
    id: hash,
    checksum: hash,
    width: integer(p['width'], 8192),
    height: integer(p['height'], 8192),
    format: choice(p['format'], ['png', 'jpeg', 'webp']),
    bytes: integer(p['bytes'], 8 * 1024 * 1024),
  };
}
export function validateWorkspaceArtifact(p: Record<string, unknown>): boolean {
  if (validateRegionArtifact(p)) return true;
  if (validateProviderArtifact(p)) return true;
  const kind = p['kind'];
  if (
    ![
      'website-image',
      'website-reference',
      'website-native-job',
      'website-direction',
      'website-comparison',
    ].includes(String(kind))
  )
    return false;
  if (
    Object.keys(record(p['lockedValues'], [])).length ||
    !['landing-page', 'hero', 'services', 'proof', 'contact'].includes(
      String(p['scope']),
    )
  )
    throw new Error('Invalid workspace artifact scope');
  if (kind === 'website-comparison') {
    const c = record(p['state'], ['compared', 'reason']);
    list(c['compared'], ref, 2);
    string(c['reason'], 500);
    return true;
  }
  const s = record(
    p['state'],
    kind === 'website-native-job'
      ? ['manifest', 'status', 'outcomes', 'outputs']
      : kind === 'website-direction'
        ? [
            'title',
            'rationale',
            'constraints',
            'uncertainty',
            'unresolved',
            'sourceReferences',
            'reviewed',
            'source',
          ]
        : [
            'image',
            'job',
            'originalArtifact',
            'parentAsset',
            'outcome',
            'providerPath',
            'model',
            'settings',
            'seed',
            'usage',
            'providerId',
          ],
  );
  if (kind === 'website-direction') {
    parseDirection(s);
    return true;
  }
  if (kind === 'website-native-job') {
    const m = record(s['manifest'], [
      'contractVersion',
      'jobId',
      'project',
      'moduleId',
      'scope',
      'artifact',
      'inputAsset',
      'instructions',
      'references',
      'selection',
      'preservation',
      'providerPath',
      'model',
      'settings',
      'seed',
      'usage',
      'providerId',
    ]);
    if (
      m['contractVersion'] !== 1 ||
      m['moduleId'] !== 'website' ||
      m['scope'] !== p['scope'] ||
      m['providerPath'] !== 'manual-native-export'
    )
      throw new Error('Invalid native manifest');
    string(m['jobId'], 160);
    ref(m['project']);
    ref(m['artifact']);
    if (m['inputAsset'] !== null) parseImageInfo(m['inputAsset']);
    string(m['instructions']);
    list(m['references'], (x) => {
      const r = record(x, [
        'artifact',
        'label',
        'role',
        'scope',
        'selected',
        'image',
      ]);
      parseReference(
        Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'image')),
      );
      return parseImageInfo(r['image']);
    });
    if (m['selection'] !== null) ref(m['selection']);
    list(m['preservation'], (x) => string(x, 500));
    for (const k of ['model', 'settings', 'seed', 'usage', 'providerId'])
      if (m[k] !== null) throw new Error('Native settings must remain unknown');
    choice(s['status'], ['awaiting', 'returned', 'cancelled', 'abandoned']);
    list(s['outputs'], ref, 1000);
    list(
      s['outcomes'],
      (x) => {
        const o = record(x, ['kind', 'message', 'at', 'artifact', 'checksum']);
        choice(o['kind'], [
          'candidate',
          'late',
          'late-cancelled',
          'duplicate',
          'invalid',
          'cancelled',
          'abandoned',
        ]);
        string(o['message']);
        string(o['at'], 50);
        if (o['artifact'] !== null) ref(o['artifact']);
        if (
          o['checksum'] !== null &&
          !/^[a-f0-9]{64}$/.test(string(o['checksum'], 64))
        )
          throw new Error('Invalid outcome hash');
        return o;
      },
      1000,
    );
    return true;
  }
  const image = parseImageInfo(s['image']);
  if (image.width * image.height > 16_000_000)
    throw new Error('Image dimensions too large');
  if (s['job'] !== null) ref(s['job']);
  if (s['originalArtifact'] !== null) ref(s['originalArtifact']);
  if (s['parentAsset'] !== null) parseImageInfo(s['parentAsset']);
  choice(s['outcome'], ['reference', 'candidate', 'late', 'late-cancelled']);
  choice(s['providerPath'], ['manual-native-import', 'manual-reference']);
  if (
    kind === 'website-reference' &&
    (s['job'] !== null || s['outcome'] !== 'reference')
  )
    throw new Error('Invalid reference state');
  if (
    kind === 'website-image' &&
    (s['job'] === null ||
      s['originalArtifact'] === null ||
      s['outcome'] === 'reference')
  )
    throw new Error('Image needs original native job');
  for (const k of ['model', 'settings', 'seed', 'usage', 'providerId'])
    if (s[k] !== null) throw new Error('Native metadata must remain unknown');
  return true;
}
