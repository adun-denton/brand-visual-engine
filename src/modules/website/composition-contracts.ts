import {
  record,
  string,
  ref,
  list,
  choice,
  id,
  InputError,
} from '../../service/validation.ts';
import { parseImageInfo } from './workspace-contracts.ts';
import { sectionIds, effectiveStyle } from './composition.ts';
import type {
  PageStyle,
  PageBlock,
  PageSection,
  CompositionContent,
  CompositionState,
} from './composition.ts';
import { canonical } from '../../kernel/packets.ts';
const styleKeys = [
  'background',
  'foreground',
  'accent',
  'actionText',
  'font',
  'bodySize',
  'headingSize',
  'spacing',
  'radius',
  'maxWidth',
];
const ranges: Record<string, [number, number]> = {
  bodySize: [16, 24],
  headingSize: [32, 80],
  spacing: [24, 120],
  radius: [0, 32],
  maxWidth: [960, 1280],
};
export function parseStyle(x: unknown, partial = false): Partial<PageStyle> {
  const r = record(x, styleKeys),
    out: Record<string, unknown> = {};
  for (const k of styleKeys) {
    if (partial && r[k] === undefined) continue;
    if (k === 'font') out[k] = choice(r[k], ['system', 'serif', 'rounded']);
    else if (ranges[k]) {
      const n = r[k],
        [min, max] = ranges[k]!;
      if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max)
        throw new InputError(`Invalid ${k} (${min}–${max})`);
      out[k] = n;
    } else {
      const c = string(r[k], 7);
      if (!/^#[a-f0-9]{6}$/i.test(c))
        throw new InputError('Use six-digit hex colors');
      out[k] = c.toLowerCase();
    }
  }
  return out as Partial<PageStyle>;
}
export function contrast(a: string, b: string): number {
  const l = (c: string) => {
    const v = [1, 3, 5]
      .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
      .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
    return 0.2126 * v[0]! + 0.7152 * v[1]! + 0.0722 * v[2]!;
  };
  const x = l(a),
    y = l(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
export function parseBlock(x: unknown): PageBlock {
  const r = record(x, [
    'id',
    'kind',
    'text',
    'href',
    'items',
    'asset',
    'image',
    'alt',
    'unresolved',
  ]);
  const b: PageBlock = {
    id: id(r['id']),
    kind: choice(r['kind'], [
      'heading',
      'paragraph',
      'button',
      'image',
      'list',
    ]),
    text: string(r['text'], 2000, true),
    href: string(r['href'], 500, true),
    items: list(r['items'], (x) => string(x, 300), 12),
    asset: r['asset'] === null ? null : ref(r['asset']),
    image: r['image'] === null ? null : parseImageInfo(r['image']),
    alt: string(r['alt'], 500, true),
    unresolved: string(r['unresolved'], 500, true),
  };
  if (b.asset?.freshness === 'current')
    throw new InputError('Placed images require pinned versions');
  if (
    b.kind === 'button' &&
    (!b.text ||
      !/^(#[a-zA-Z0-9_-]+|https:\/\/[^\s<>"'\\]+|mailto:[a-zA-Z0-9._+@-]+|tel:[+0-9()-]+)$/.test(
        b.href,
      ))
  )
    throw new InputError(
      'Use a section anchor, HTTPS, mailto or telephone link',
    );
  if (b.kind !== 'button' && b.href)
    throw new InputError('Links belong to button blocks');
  if (['heading', 'paragraph'].includes(b.kind) && !b.text)
    throw new InputError(
      'Text block cannot be empty; record unresolved content explicitly',
    );
  if (b.kind === 'list' && !b.items.length)
    throw new InputError('List needs content');
  if (b.kind !== 'image' && (b.asset || b.image || b.alt || b.unresolved))
    throw new InputError('Image fields belong to image blocks');
  if (
    b.kind === 'image' &&
    ((!b.alt && !b.unresolved) ||
      (!b.asset && !b.unresolved) ||
      !!b.image !== !!b.asset)
  )
    throw new InputError(
      'Image needs an exact asset and alt text, or an explicit unresolved note',
    );
  return b;
}
export function parseContent(x: unknown): CompositionContent {
  const r = record(x, [
    'title',
    'description',
    'style',
    'sections',
    'unresolved',
  ]);
  const content: CompositionContent = {
    title: string(r['title'], 100),
    description: string(r['description'], 500),
    style: parseStyle(r['style']) as PageStyle,
    unresolved: list(r['unresolved'], (x) => string(x, 500)),
    sections: list(
      r['sections'],
      (x) => {
        const s = record(x, [
          'id',
          'recipe',
          'align',
          'fit',
          'overrides',
          'blocks',
        ]);
        return {
          id: choice(s['id'], sectionIds),
          recipe: choice(s['recipe'], ['stack', 'split', 'cards', 'band']),
          align: choice(s['align'], ['left', 'center']),
          fit: choice(s['fit'], ['cover', 'contain']),
          overrides: parseStyle(s['overrides'], true),
          blocks: list(s['blocks'], parseBlock, 15),
        };
      },
      4,
    ),
  };
  if (
    content.sections.length !== 4 ||
    new Set(content.sections.map((s) => s.id)).size !== 4
  )
    throw new InputError(
      'Exactly one hero, services, proof and contact section is required',
    );
  const ids = new Set<string>(['main', ...sectionIds]);
  if (contrast(content.style.background, content.style.foreground) < 4.5)
    throw new InputError('Global page text contrast must be at least 4.5:1');
  for (const s of content.sections) {
    if (s.blocks.filter((b) => b.kind === 'heading').length !== 1)
      throw new InputError('Each section needs exactly one heading');
    for (const b of s.blocks) {
      if (ids.has(b.id)) throw new InputError('Duplicate block identity');
      ids.add(b.id);
      if (
        b.href.startsWith('#') &&
        !['#main', ...sectionIds.map((i) => '#' + i)].includes(b.href)
      )
        throw new InputError('Unknown section anchor');
    }
    const st = effectiveStyle(content.style, s);
    if (
      contrast(st.background, st.foreground) < 4.5 ||
      contrast(st.accent, st.actionText) < 4.5
    )
      throw new InputError('Text and action contrast must be at least 4.5:1');
  }
  return content;
}
export function validateCompositionArtifact(
  p: Record<string, unknown>,
): boolean {
  if (
    !['website-composition', 'website-composition-comparison'].includes(
      String(p['kind']),
    )
  )
    return false;
  if (
    p['scope'] !== 'landing-page' ||
    Object.keys(record(p['lockedValues'], [])).length
  )
    throw new InputError('Invalid composition scope');
  if (p['kind'] === 'website-composition-comparison') {
    const r = record(p['state'], ['compared', 'selected', 'reason']);
    const refs = list(r['compared'], ref, 3);
    if (
      refs.length < 2 ||
      new Set(refs.map((x) => x.id + '@' + x.version)).size !== refs.length
    )
      throw new InputError('Compare two or three exact revisions');
    if (
      r['selected'] !== null &&
      !refs.some((x) => canonical(x) === canonical(ref(r['selected'])))
    )
      throw new InputError('Selected revision must be compared');
    string(r['reason'], 500);
    return true;
  }
  const s = record(p['state'], [
    'contractVersion',
    'project',
    'direction',
    'directionState',
    'lockedValues',
    'context',
    'content',
    'reviews',
  ]);
  if (s['contractVersion'] !== 1)
    throw new InputError('Unsupported composition version');
  ref(s['project']);
  ref(s['direction']);
  record(s['directionState'], [
    'scope',
    'intent',
    'thesis',
    'sectionOrder',
    'parameters',
    'metrics',
    'unresolved',
  ]);
  // Exact snapshot relationships are additionally checked against kernel packets on every read.
  record(s['lockedValues'], Object.keys(s['lockedValues'] as object));
  record(s['context'], ['mode', 'fields']);
  parseContent(s['content']);
  const reviews = record(s['reviews'], [...sectionIds]);
  for (const v of Object.values(reviews)) {
    const r = record(v, ['signature', 'reason']);
    if (!/^[a-f0-9]{64}$/.test(string(r['signature'], 64)))
      throw new InputError('Invalid review signature');
    string(r['reason'], 500);
  }
  return true;
}
