import type { VersionRef, Value } from '../../kernel/contracts.ts';
import type { CompositionContent, SectionId } from './composition.ts';
import { sectionIds, effectiveStyle } from './composition.ts';
import { parseContent } from './composition-contracts.ts';
import { parseImageInfo } from './workspace-contracts.ts';
import type { ImageInfo } from '../../service/assets.ts';
import {
  record,
  string,
  list,
  ref,
  choice,
  integer,
  InputError,
} from '../../service/validation.ts';

export interface ImageNeed {
  section: SectionId;
  role: string;
  prompt: string;
  size: '1024x1024' | '1536x1024' | '1024x1536';
  preservation: string[];
  references: VersionRef[];
}
export interface AICandidate {
  title: string;
  rationale: string;
  constraints: string[];
  uncertainty: string;
  unresolved: string[];
  page: CompositionContent;
  imageNeeds: ImageNeed[];
}
export interface AIResponse {
  schema: 'bve.ai-directions';
  version: 1;
  candidates: AICandidate[];
}
export interface DirectionRequest {
  version: 1;
  project: VersionRef;
  base: VersionRef | null;
  count: number;
  instructions: string;
  references: VersionRef[];
  status: 'awaiting' | 'applied';
  output: VersionRef | null;
}
export interface DirectionEvidence {
  request: VersionRef;
  response: AIResponse;
  executor: 'native-ai-attested' | 'api-ai' | 'test-fixture';
  source: string;
  requestedModel: string | null;
  reportedModel: string | null;
  providerJob: VersionRef | null;
  outcome: 'candidate' | 'late' | 'late-cancelled';
}
export interface AISpec {
  version: 1;
  request: VersionRef;
  evidence: VersionRef;
  rationale: string;
  constraints: string[];
  uncertainty: string;
  imageNeeds: ImageNeed[];
  page: CompositionContent;
}
export interface ProjectAsset {
  version: 1;
  image: ImageInfo;
  origin: VersionRef | null;
  label: string;
  role: 'reference' | 'placeable';
  permission: string;
}
export function parseNeed(x: unknown): ImageNeed {
  const r = record(x, [
    'section',
    'role',
    'prompt',
    'size',
    'preservation',
    'references',
  ]);
  return {
    section: choice(r['section'], sectionIds),
    role: string(r['role'], 200),
    prompt: string(r['prompt']),
    size: choice(r['size'], ['1024x1024', '1536x1024', '1024x1536']),
    preservation: list(r['preservation'], (x) => string(x, 500)),
    references: list(r['references'], ref, 4),
  };
}
function parseAIPage(x: unknown) {
  const page = structuredClone(x) as CompositionContent;
  if (page && Array.isArray(page.sections))
    for (const s of page.sections)
      if (s && s.overrides && typeof s.overrides === 'object')
        s.overrides = Object.fromEntries(
          Object.entries(s.overrides).filter(([, v]) => v !== null),
        );
  return parseContent(page);
}
export function parseResponse(x: unknown): AIResponse {
  const r = record(x, ['schema', 'version', 'candidates']);
  if (r['schema'] !== 'bve.ai-directions' || r['version'] !== 1)
    throw new InputError('Unsupported AI direction response');
  const candidates = list(
    r['candidates'],
    (x) => {
      const c = record(x, [
        'title',
        'rationale',
        'constraints',
        'uncertainty',
        'unresolved',
        'page',
        'imageNeeds',
      ]);
      const imageNeeds = list(c['imageNeeds'], parseNeed, 4);
      if (
        imageNeeds.length !== 4 ||
        new Set(imageNeeds.map((n) => n.section)).size !== 4
      )
        throw new InputError('Declare an image need for each bounded section');
      return {
        title: string(c['title'], 160),
        rationale: string(c['rationale']),
        constraints: list(c['constraints'], (x) => string(x, 500)),
        uncertainty: string(c['uncertainty']),
        unresolved: list(c['unresolved'], (x) => string(x, 500)),
        page: parseAIPage(c['page']),
        imageNeeds,
      };
    },
    9,
  );
  if (!candidates.length)
    throw new InputError('An AI response needs candidates');
  return { schema: 'bve.ai-directions', version: 1, candidates };
}
export function parseSpec(x: unknown): AISpec {
  const r = record(x, [
    'version',
    'request',
    'evidence',
    'rationale',
    'constraints',
    'uncertainty',
    'imageNeeds',
    'page',
  ]);
  if (r['version'] !== 1) throw new InputError('Unsupported AI specification');
  const imageNeeds = list(r['imageNeeds'], parseNeed, 4);
  if (
    imageNeeds.length !== 4 ||
    new Set(imageNeeds.map((n) => n.section)).size !== 4
  )
    throw new InputError('Missing direction image needs');
  return {
    version: 1,
    request: ref(r['request']),
    evidence: ref(r['evidence']),
    rationale: string(r['rationale']),
    constraints: list(r['constraints'], (x) => string(x, 500)),
    uncertainty: string(r['uncertainty']),
    imageNeeds,
    page: parseContent(r['page']),
  };
}
export function validateAILocks(
  page: CompositionContent,
  locked: Record<string, Value>,
): void {
  const blocks = page.sections.flatMap((s) => s.blocks);
  if (
    typeof locked['intent'] === 'string' &&
    !blocks.some((b) => b.text === locked['intent'])
  )
    throw new InputError(
      'AI direction must retain locked intent as visible text',
    );
  if (
    Array.isArray(locked['content']) &&
    !locked['content'].every((x) =>
      blocks.some((b) => b.text === x || b.items.includes(String(x))),
    )
  )
    throw new InputError('AI direction must retain required content');
  if (Array.isArray(locked['palette'])) {
    const palette = locked['palette'].map((x) => String(x).toLowerCase());
    for (const s of page.sections) {
      const style = effectiveStyle(page.style, s);
      for (const k of [
        'background',
        'foreground',
        'accent',
        'actionText',
      ] as const)
        if (!palette.includes(style[k]))
          throw new InputError('AI cannot override locked palette');
    }
    for (const k of [
      'background',
      'foreground',
      'accent',
      'actionText',
    ] as const)
      if (!palette.includes(page.style[k]))
        throw new InputError('AI cannot override global locked palette');
  }
}
export function validateAIArtifact(p: Record<string, unknown>): boolean {
  if (
    !['website-ai-request', 'website-ai-evidence', 'website-asset'].includes(
      String(p['kind']),
    )
  )
    return false;
  record(p['lockedValues'], []);
  if (p['scope'] !== 'landing-page')
    throw new InputError('Invalid project AI/asset scope');
  if (p['kind'] === 'website-ai-request') {
    const s = record(p['state'], [
      'version',
      'project',
      'base',
      'count',
      'instructions',
      'references',
      'status',
      'output',
    ]);
    if (s['version'] !== 1)
      throw new InputError('Unsupported direction request');
    ref(s['project']);
    if (s['base'] !== null) ref(s['base']);
    integer(s['count'], 9);
    string(s['instructions']);
    list(s['references'], ref, 4);
    choice(s['status'], ['awaiting', 'applied']);
    if (s['output'] !== null) ref(s['output']);
    if ((s['status'] === 'applied') !== (s['output'] !== null))
      throw new InputError('Invalid direction request result');
  } else if (p['kind'] === 'website-ai-evidence') {
    const s = record(p['state'], [
      'request',
      'response',
      'executor',
      'source',
      'requestedModel',
      'reportedModel',
      'providerJob',
      'outcome',
    ]);
    ref(s['request']);
    parseResponse(s['response']);
    choice(s['executor'], ['native-ai-attested', 'api-ai', 'test-fixture']);
    string(s['source'], 500);
    for (const k of ['requestedModel', 'reportedModel'])
      if (s[k] !== null) string(s[k], 200);
    if (s['providerJob'] !== null) ref(s['providerJob']);
    choice(s['outcome'], ['candidate', 'late', 'late-cancelled']);
    if (
      (s['executor'] === 'api-ai' && s['providerJob'] === null) ||
      (s['executor'] === 'native-ai-attested' && s['providerJob'] !== null)
    )
      throw new InputError('AI evidence executor mismatch');
  } else {
    const s = record(p['state'], [
      'version',
      'image',
      'origin',
      'label',
      'role',
      'permission',
    ]);
    if (s['version'] !== 1) throw new InputError('Unsupported asset version');
    parseImageInfo(s['image']);
    if (s['origin'] !== null) ref(s['origin']);
    string(s['label'], 100);
    choice(s['role'], ['reference', 'placeable']);
    string(s['permission'], 500);
  }
  return true;
}
