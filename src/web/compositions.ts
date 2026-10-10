import type {
  NodePacket,
  DesignArtifact,
  ModuleProject,
  VersionRef,
} from '../kernel/contracts.ts';
import type {
  CompositionState,
  CompositionContent,
  CompositionComparison,
  PageStyle,
  PageBlock,
} from '../modules/website/composition.ts';
import type { ImageState } from '../modules/website/workspace-contracts.ts';
import {
  sectionIds,
  escapeHtml as e,
  effectiveStyle,
} from '../modules/website/composition.ts';
interface Context {
  project: NodePacket<ModuleProject>;
  artifacts: NodePacket<DesignArtifact<unknown>>[];
  accepted: Record<string, VersionRef | null>;
  mutate: (path: string, input: unknown, message: string) => Promise<void>;
  act: (f: () => Promise<void>) => Promise<void>;
  render: () => void;
}
let latestSeen = '',
  identity = '',
  selected = '',
  loaded: NodePacket<DesignArtifact<CompositionState>> | null = null,
  edit: CompositionContent | null = null,
  narrow = false;
const ptr = (p: NodePacket<unknown>): VersionRef => ({
  id: p.id,
  version: p.version,
  freshness: 'pinned',
});
const opt = (v: string, t: string, on = false) =>
  `<option value="${e(v)}" ${on ? 'selected' : ''}>${e(t)}</option>`;
const input = (label: string, name: string, v: unknown, type = 'text') =>
  `<label>${e(label)}<input name="${e(name)}" type="${type}" value="${e(v)}" required></label>`;
const styleLabels: Record<keyof PageStyle, string> = {
  background: 'Background',
  foreground: 'Text color',
  accent: 'Button color',
  actionText: 'Button text',
  font: 'Font',
  bodySize: 'Body size',
  headingSize: 'Heading size',
  spacing: 'Section spacing',
  radius: 'Corner radius',
  maxWidth: 'Content width',
};
const styleFields = (
  style: Partial<PageStyle>,
  prefix: string,
  partial = false,
) =>
  Object.entries(styleLabels)
    .map(([key, label]) =>
      key === 'font'
        ? `<label>${label}<select name="${prefix}${key}">${partial ? opt('', 'Inherit global', !style.font) : ''}${['system', 'serif', 'rounded'].map((f) => opt(f, f, style.font === f)).join('')}</select></label>`
        : `<label>${label}${partial ? ' override' : ''}<input name="${prefix}${key}" ${partial ? '' : 'required'} value="${e(style[key as keyof PageStyle] ?? '')}" ${['bodySize', 'headingSize', 'spacing', 'radius', 'maxWidth'].includes(key) ? 'type="number"' : 'type="text"'} ${partial ? 'placeholder="Inherit global"' : ''}></label>`,
    )
    .join('');
function choose(c: Context) {
  if (identity !== c.project.id) {
    identity = c.project.id;
    selected = '';
    loaded = null;
    edit = null;
    latestSeen = '';
  }
  const comps = c.artifacts.filter(
    (a) => a.payload.kind === 'website-composition',
  );
  if (!selected && comps.length) selected = comps.at(-1)!.id;
  const latest = comps.find((a) => a.id === selected) as
    | NodePacket<DesignArtifact<CompositionState>>
    | undefined;
  if (
    latest &&
    (!loaded ||
      loaded.id !== latest.id ||
      latestSeen !== latest.id + '@' + latest.version)
  ) {
    loaded = latest;
    edit = structuredClone(latest.payload.state.content);
    latestSeen = latest.id + '@' + latest.version;
  }
  return comps;
}
const url = (c: Context, r: VersionRef, action = 'preview') =>
  `/api/v1/composition/${action}?project=${encodeURIComponent(c.project.id)}&id=${encodeURIComponent(r.id)}&version=${r.version}`;
export function compositionView(c: Context): string {
  const comps = choose(c),
    directions = c.artifacts.filter((a) => a.payload.kind === 'website-design'),
    images = c.artifacts.filter(
      (a) =>
        (a.payload.kind !== 'website-asset' ||
          (a.payload.state as { role: string }).role === 'placeable') &&
        [
          'website-asset',
          'website-image',
          'website-api-image',
          'website-region-image',
        ].includes(a.payload.kind),
    );
  const start = `<section class="panel"><h2>Compose a landing page</h2><p>Four bounded section recipes and five block types. Text, actions, order and responsive styles stay structured. Review is an AI technical assessment; designer review follows separately.</p><form id="composition-start"><label>Design direction<select name="direction" required>${directions.map((a) => opt(JSON.stringify(ptr(a)), `${a.id} · v${a.version}`, c.accepted['design']?.id === a.id)).join('')}</select></label>${input('Reason for choosing this direction', 'reason', 'Use this synthetic direction for an editable page.')}<button type="submit" ${directions.length ? '' : 'disabled'}>Start composition</button></form></section>`;
  if (!loaded || !edit) return start;
  const a = loaded,
    s = a.payload.state,
    current = comps.find((p) => p.id === a.id)?.version === a.version;
  const accepted = c.accepted['composition'];
  const versionBar = `<section class="panel"><div class="composition-controls"><label>Composition<select id="composition-family">${comps.map((x) => opt(x.id, x.id, x.id === selected)).join('')}</select></label><form id="composition-load"><label>Revision<input name="version" type="number" min="1" max="${comps.find((x) => x.id === selected)?.version}" value="${a.version}" required></label><button>Open exact revision</button></form><button type="button" id="composition-width">${narrow ? 'Show desktop' : 'Show narrow'}</button></div><p id="composition-status">${e(a.id)} · v${a.version} · ${current ? 'Saved draft' : 'Historical revision'} · ${accepted?.id === a.id && accepted.version === a.version ? 'Explicitly accepted' : 'Not the accepted composition'}</p><p>Context ${e(s.context.mode)} · brief v${s.project.version} · pinned direction ${e(s.direction.id)} v${s.direction.version}. ${s.project.version !== c.project.version ? 'Context changed: save with a direction from the current brief to rebase and review again.' : ''}</p><details><summary>Pinned direction, context origins and locked decisions</summary><pre>${e(JSON.stringify({ direction: s.directionState, context: s.context, lockedValues: s.lockedValues }, null, 2))}</pre></details><iframe title="Saved composition preview" id="composition-preview" sandbox="allow-same-origin" src="${url(c, ptr(a))}" class="composition-preview ${narrow ? 'narrow' : ''}"></iframe><p>Preview shows the saved revision. Save visible edits to refresh it. Narrow recipes switch at 760px; desktop and 390px evidence is captured from this same renderer.</p></section>`;
  const editor = `<form id="composition-editor" class="panel"><h2>Edit composition v${a.version}</h2><fieldset ${current ? '' : 'disabled'}>${input('Page title', 'title', edit.title)}${input('Description', 'description', edit.description)}<label>Direction for this revision<select name="direction">${!directions.some((d) => d.id === s.direction.id && d.version === s.direction.version) ? opt(JSON.stringify(s.direction), `${s.direction.id} · pinned v${s.direction.version}`, true) : ''}${directions.map((d) => opt(JSON.stringify(ptr(d)), `${d.id} · v${d.version}`, d.id === s.direction.id && d.version === s.direction.version)).join('')}</select></label><details open><summary>Global style</summary><div class="composition-fields">${styleFields(edit.style, 'global-')}</div></details><label>Unresolved content and exceptions<textarea name="unresolved" rows="3">${e(edit.unresolved.join('\n'))}</textarea></label>${edit.sections
    .map(
      (sec, i) =>
        `<section class="composition-section" data-section="${sec.id}"><h3>${sec.id} · ${s.reviews[sec.id] ? 'Reviewed' : 'Needs review'}</h3>${s.reviews[sec.id] ? `<p class="hint">${e(s.reviews[sec.id]!.reason)}</p>` : ''}<div class="composition-controls"><button type="button" data-section-move="${i}" data-offset="-1" ${i === 0 ? 'disabled' : ''}>Move section up</button><button type="button" data-section-move="${i}" data-offset="1" ${i === 3 ? 'disabled' : ''}>Move section down</button><label>Recipe<select name="s${i}-recipe">${['stack', 'split', 'cards', 'band'].map((v) => opt(v, v, sec.recipe === v)).join('')}</select></label><label>Alignment<select name="s${i}-align">${['left', 'center'].map((v) => opt(v, v, sec.align === v)).join('')}</select></label><label>Image fit<select name="s${i}-fit">${['cover', 'contain'].map((v) => opt(v, v, sec.fit === v)).join('')}</select></label></div><details><summary>Section overrides (blank inherits global)</summary><div class="composition-fields">${styleFields(sec.overrides, `s${i}-`, true)}</div><p class="hint">Effective values: ${e(JSON.stringify(effectiveStyle(edit!.style, sec)))}</p></details>${sec.blocks
          .map(
            (b, j) =>
              `<fieldset class="composition-block"><legend>${e(b.kind)} · ${e(b.id)}</legend>${b.kind === 'heading' || b.kind === 'paragraph' || b.kind === 'button' ? `<label>Text<textarea aria-label="Text" name="s${i}-b${j}-text" required>${e(b.text)}</textarea></label>` : ''}${b.kind === 'button' ? input('Link (section anchor, HTTPS, mailto or tel)', `s${i}-b${j}-href`, b.href) : ''}${b.kind === 'list' ? `<label>List items, one per line<textarea name="s${i}-b${j}-items" required>${e(b.items.join('\n'))}</textarea></label>` : ''}${
                b.kind === 'image'
                  ? `<label>Deliberate exact image<select name="s${i}-b${j}-asset">${opt('', 'Unresolved image', !b.asset)}${b.asset && !images.some((x) => x.id === b.asset!.id && x.version === b.asset!.version) ? opt(JSON.stringify(b.asset), `Pinned placement ${b.asset.id} v${b.asset.version}`, true) : ''}${images
                      .filter((x) =>
                        [sec.id, 'landing-page'].includes(x.payload.scope),
                      )
                      .map((x) =>
                        opt(
                          JSON.stringify(ptr(x)),
                          `${x.id} v${x.version} · ${(x.payload.state as ImageState).image.checksum.slice(0, 12)}`,
                          x.id === b.asset?.id && x.version === b.asset.version,
                        ),
                      )
                      .join(
                        '',
                      )}</select></label><label>Alt text<input name="s${i}-b${j}-alt" value="${e(b.alt)}"></label><label>Unresolved image/accessibility note<input name="s${i}-b${j}-unresolved" value="${e(b.unresolved)}"></label>${b.image ? `<small>Pinned ${e(b.image.checksum)} · ${b.image.width} × ${b.image.height}</small>` : ''}`
                  : ''
              }<div class="composition-controls"><button type="button" data-block-move="${i},${j}" data-offset="-1" ${j === 0 ? 'disabled' : ''}>Move block up</button><button type="button" data-block-move="${i},${j}" data-offset="1" ${j === sec.blocks.length - 1 ? 'disabled' : ''}>Move block down</button><button type="button" data-block-remove="${i},${j}" ${b.kind === 'heading' ? 'disabled' : ''}>Remove block</button></div></fieldset>`,
          )
          .join(
            '',
          )}<div class="composition-controls"><label>Add block<select id="composition-add-${i}">${['paragraph', 'button', 'list', 'image'].map((v) => opt(v, v)).join('')}</select></label><button type="button" data-block-add="${i}" ${sec.blocks.length >= 15 ? 'disabled' : ''}>Add block to ${sec.id}</button></div></section>`,
    )
    .join(
      '',
    )}${input('Edit reason', 'reason', 'Review this candidate composition change.')}<button class="primary" type="submit">Save immutable draft</button></fieldset></form>`;
  const reviews = `<section class="panel"><h2>Review, compare and explicitly accept</h2><p>Saving, reviewing or comparing does not accept the page. Global values invalidate the sections whose effective rendering changes; page metadata, section order or pinned context changes invalidate all. Geometry changes never reuse regional masks. Locked intent text, required content items and palette colors remain visible; changing them requires an explicit context/direction decision.</p><form id="composition-review"><div>${sectionIds.map((id) => `<label class="check"><input type="checkbox" name="section" value="${id}" checked>${id} · ${s.reviews[id] ? 'reviewed' : 'needs review'}</label>`).join('')}</div>${input('Technical review reason, including exceptions', 'reason', 'AI technical review of desktop/narrow structure; synthetic exceptions acknowledged.')}<button ${current ? '' : 'disabled'}>Record section review</button></form><form id="composition-compare"><label>First revision<input name="first" type="number" min="1" max="${comps.find((x) => x.id === a.id)?.version}" value="${Math.max(1, a.version - 1)}" required></label><label>Second revision<input name="second" type="number" min="1" max="${comps.find((x) => x.id === a.id)?.version}" value="${a.version}" required></label>${input('Comparison reason', 'reason', 'Compare these exact revisions; acceptance remains separate.')}<label class="check"><input name="selected" type="checkbox"> Select the second revision in this comparison</label><button>Save comparison</button></form><form id="composition-accept">${input('Whole-page acceptance reason and unresolved exceptions', 'reason', 'Accept this exact synthetic composition; unresolved exceptions retained.')}<button class="primary" ${current ? '' : 'disabled'}>Accept exact composition</button></form>${accepted ? `<a class="text-link" id="composition-export" href="${url(c, accepted, 'export')}">Download accepted handoff v${accepted.version}</a><button id="composition-open-accepted" type="button">Open accepted revision</button>` : ''}<div id="composition-comparisons">${c.artifacts
    .filter((x) => x.payload.kind === 'website-composition-comparison')
    .map((x) => {
      const st = x.payload.state as CompositionComparison;
      return `<article><h3>Saved comparison</h3><p>${e(st.reason)}</p><p>${st.compared.map((r) => `${e(r.id)} v${r.version}${st.selected?.id === r.id && st.selected.version === r.version ? ' · selected' : ''}`).join(' / ')}</p><div class="composition-comparison">${st.compared.map((r) => `<iframe sandbox="allow-same-origin" title="Compared revision ${r.version}" src="${url(c, r)}"></iframe>`).join('')}</div></article>`;
    })
    .join('')}</div></section>`;
  return start + versionBar + editor + reviews;
}
function capture(c: Context): CompositionContent {
  const f = document.querySelector<HTMLFormElement>('#composition-editor')!,
    d = new FormData(f),
    result = structuredClone(edit!);
  const txt = (name: string) => String(d.get(name) ?? '').trim();
  result.title = txt('title');
  result.description = txt('description');
  result.unresolved = txt('unresolved').split('\n').filter(Boolean);
  const style = (prefix: string, partial = false) =>
    Object.fromEntries(
      Object.keys(styleLabels).flatMap((k) => {
        const v = txt(prefix + k);
        return partial && !v
          ? []
          : [
              [
                k,
                [
                  'bodySize',
                  'headingSize',
                  'spacing',
                  'radius',
                  'maxWidth',
                ].includes(k)
                  ? Number(v)
                  : v,
              ],
            ];
      }),
    );
  result.style = style('global-') as unknown as PageStyle;
  result.sections.forEach((s, i) => {
    s.recipe = txt(`s${i}-recipe`) as typeof s.recipe;
    s.align = txt(`s${i}-align`) as typeof s.align;
    s.fit = txt(`s${i}-fit`) as typeof s.fit;
    s.overrides = style(`s${i}-`, true);
    s.blocks.forEach((b, j) => {
      const prefix = `s${i}-b${j}-`;
      if (['heading', 'paragraph', 'button'].includes(b.kind))
        b.text = txt(prefix + 'text');
      if (b.kind === 'button') b.href = txt(prefix + 'href');
      if (b.kind === 'list')
        b.items = txt(prefix + 'items')
          .split('\n')
          .filter(Boolean);
      if (b.kind === 'image') {
        const v = txt(prefix + 'asset');
        b.asset = v ? (JSON.parse(v) as VersionRef) : null;
        const a = c.artifacts.find(
          (x) => x.id === b.asset?.id && x.version === b.asset.version,
        );
        b.image = a ? (a.payload.state as ImageState).image : null;
        b.alt = txt(prefix + 'alt');
        b.unresolved = txt(prefix + 'unresolved');
      }
    });
  });
  return result;
}
export function bindCompositions(c: Context): void {
  const on = (
    id: string,
    fn: (f: HTMLFormElement, d: FormData) => Promise<void>,
  ) =>
    document
      .querySelector<HTMLFormElement>('#' + id)
      ?.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const f = ev.currentTarget as HTMLFormElement;
        void c.act(() => fn(f, new FormData(f)));
      });
  const saved = () => {
    if (
      JSON.stringify(capture(c)) !==
      JSON.stringify(loaded!.payload.state.content)
    )
      throw new Error(
        'Save visible edits before reviewing or accepting this revision.',
      );
  };
  const open = async (r: VersionRef) => {
    const res = await fetch(
        `/api/v1/artifact?project=${encodeURIComponent(c.project.id)}&id=${encodeURIComponent(r.id)}&version=${r.version}`,
      ),
      a = (await res.json()) as NodePacket<DesignArtifact<CompositionState>> & {
        error?: string;
      };
    if (!res.ok) throw new Error(a.error);
    selected = r.id;
    loaded = a;
    edit = structuredClone(a.payload.state.content);
    c.render();
  };
  on('composition-start', async (_f, d) => {
    selected = '';
    loaded = null;
    edit = null;
    await c.mutate(
      'composition/start',
      {
        expectedProject: ptr(c.project),
        direction: JSON.parse(String(d.get('direction'))),
        reason: d.get('reason'),
      },
      'New composition draft saved; review and acceptance are separate.',
    );
  });
  document
    .querySelector<HTMLSelectElement>('#composition-family')
    ?.addEventListener('change', (ev) => {
      selected = (ev.target as HTMLSelectElement).value;
      loaded = null;
      edit = null;
      c.render();
    });
  on('composition-load', async (_f, d) =>
    open({
      id: selected,
      version: Number(d.get('version')),
      freshness: 'pinned',
    }),
  );
  document
    .querySelector('#composition-open-accepted')
    ?.addEventListener(
      'click',
      () => void c.act(() => open(c.accepted['composition']!)),
    );
  document
    .querySelector('#composition-width')
    ?.addEventListener('click', () => {
      edit = capture(c);
      narrow = !narrow;
      c.render();
    });
  on('composition-editor', async (_f, d) =>
    c.mutate(
      'composition/save',
      {
        expectedProject: ptr(c.project),
        expected: ptr(loaded!),
        direction: JSON.parse(String(d.get('direction'))),
        content: capture(c),
        reason: d.get('reason'),
      },
      'Immutable draft saved. Affected sections need review; acceptance unchanged.',
    ),
  );
  on('composition-review', async (_f, d) => {
    saved();
    return c.mutate(
      'composition/review',
      {
        expectedProject: ptr(c.project),
        expected: ptr(loaded!),
        sections: d.getAll('section'),
        reason: d.get('reason'),
      },
      'Technical section review saved; acceptance unchanged.',
    );
  });
  on('composition-compare', async (_f, d) => {
    const first = {
        id: loaded!.id,
        version: Number(d.get('first')),
        freshness: 'pinned',
      },
      second = { ...first, version: Number(d.get('second')) };
    await c.mutate(
      'composition/compare',
      {
        compared: [first, second],
        selected: d.has('selected') ? second : null,
        reason: d.get('reason'),
      },
      'Comparison saved separately from acceptance.',
    );
  });
  on('composition-accept', async (_f, d) => {
    saved();
    return c.mutate(
      'composition/accept',
      {
        expectedProject: ptr(c.project),
        artifact: ptr(loaded!),
        expected: c.accepted['composition'] ?? null,
        reason: d.get('reason'),
      },
      'Exact composition explicitly accepted; handoff is ready.',
    );
  });
  const editClick = (selector: string, fn: (b: HTMLButtonElement) => void) =>
    document.querySelectorAll<HTMLButtonElement>(selector).forEach((b) =>
      b.addEventListener('click', () => {
        edit = capture(c);
        fn(b);
        c.render();
      }),
    );
  editClick('[data-section-move]', (b) => {
    const i = Number(b.dataset['sectionMove']),
      j = i + Number(b.dataset['offset']);
    [edit!.sections[i], edit!.sections[j]] = [
      edit!.sections[j]!,
      edit!.sections[i]!,
    ];
  });
  editClick('[data-block-move]', (b) => {
    const [i, j] = b.dataset['blockMove']!.split(',').map(Number) as [
        number,
        number,
      ],
      k = j + Number(b.dataset['offset']),
      blocks = edit!.sections[i]!.blocks;
    [blocks[j], blocks[k]] = [blocks[k]!, blocks[j]!];
  });
  editClick('[data-block-remove]', (b) => {
    const [i, j] = b.dataset['blockRemove']!.split(',').map(Number) as [
      number,
      number,
    ];
    edit!.sections[i]!.blocks.splice(j, 1);
  });
  editClick('[data-block-add]', (b) => {
    const i = Number(b.dataset['blockAdd']),
      kind = document.querySelector<HTMLSelectElement>(`#composition-add-${i}`)!
        .value as PageBlock['kind'];
    edit!.sections[i]!.blocks.push({
      id: 'block-' + crypto.randomUUID(),
      kind,
      text:
        kind === 'paragraph'
          ? 'New content'
          : kind === 'button'
            ? 'Learn more'
            : '',
      href: kind === 'button' ? '#contact' : '',
      items: kind === 'list' ? ['New item'] : [],
      asset: null,
      image: null,
      alt: '',
      unresolved: kind === 'image' ? 'Choose an image deliberately.' : '',
    });
  });
}
