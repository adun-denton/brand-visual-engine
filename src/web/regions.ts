import type {
  DesignArtifact,
  ModuleProject,
  NodePacket,
  VersionRef,
} from '../kernel/contracts.ts';
import type {
  ReferenceInput,
  NativeJob,
} from '../modules/website/workspace-contracts.ts';
import type { ProviderJob } from '../modules/website/provider-contracts.ts';
import type {
  RegionSelection,
  RegionOperation,
  RegionImage,
  RegionComparison,
  Bounds,
} from '../modules/website/region-contracts.ts';
type Artifact = NodePacket<DesignArtifact<unknown>>;
interface Context {
  project: NodePacket<ModuleProject>;
  artifacts: Artifact[];
  references: ReferenceInput[];
  accepted: Record<string, VersionRef | null>;
  apiAvailable: boolean;
  offline: boolean;
  imageUrl: (r: VersionRef) => string;
  mutate: (path: string, input: unknown, message: string) => Promise<void>;
  act: (action: () => Promise<void>) => Promise<void>;
  render: () => void;
  fileBase64: (d: FormData) => Promise<string>;
}
const e = (v: unknown) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
const ptr = (a: NodePacket<unknown>): VersionRef => ({
  id: a.id,
  version: a.version,
  freshness: 'pinned',
});
const same = (
  a: VersionRef | null | undefined,
  b: VersionRef | null | undefined,
) => a?.id === b?.id && a?.version === b?.version;
const encoded = (a: NodePacket<unknown>) => e(JSON.stringify(ptr(a)));
const option = (a: Artifact, label: string, selected = false) =>
  `<option value="${encoded(a)}" ${selected ? 'selected' : ''}>${e(label)}</option>`;
let sourceId = '',
  projectId = '';
const historicalSelections = new Map<string, RegionSelection>();
const loadingSelections = new Set<string>();
export function regionView(c: Context): string {
  if (projectId !== c.project.id) {
    projectId = c.project.id;
    sourceId = '';
  }
  const images = c.artifacts.filter((a) =>
    ['website-image', 'website-api-image', 'website-region-image'].includes(
      a.payload.kind,
    ),
  );
  const source = images.find((a) => a.id === sourceId) ?? images.at(-1);
  sourceId = source?.id ?? '';
  const selection = c.artifacts
    .filter(
      (a) =>
        a.payload.kind === 'website-region-selection' &&
        same(
          (a.payload.state as RegionSelection).source,
          source && ptr(source),
        ),
    )
    .at(-1);
  const activeSelection =
    source &&
    c.artifacts
      .filter(
        (a) =>
          a.payload.kind === 'website-region-selection' &&
          a.payload.scope === source.payload.scope,
      )
      .at(-1);
  const s = selection?.payload.state as RegionSelection | undefined;
  const operations = c.artifacts
    .filter((a) => a.payload.kind === 'website-region-operation')
    .reverse();
  const bounds = s?.bounds ?? { x: 0, y: 0, width: 1, height: 1 };
  return `<section class="panel"><p class="eyebrow">REGIONAL ITERATION · ${e(c.project.payload.mode)}</p><h2>Choose the area. Keep the original.</h2>${c.offline ? '<p class="badge unresolved">OFFLINE TRANSPORT FIXTURE · no provider called</p>' : ''}<p>Draw a circle or rectangle, then inspect its source-pixel bounds. The annotation is a separate mask; it never changes your source image.</p>${
    !source
      ? '<p class="hint">Import or generate a section image first.</p>'
      : `<label>Source image<select id="region-source">${images.map((a) => option(a, `${a.payload.scope} · ${a.payload.kind === 'website-region-image' ? (a.payload.state as RegionImage).variant : 'original candidate'} · ${a.id.slice(-8)} v${a.version}`, a.id === source.id)).join('')}</select></label>
  <form id="region-select" data-source="${encoded(source)}" data-previous="${selection ? encoded(selection) : 'null'}" data-current="${activeSelection ? encoded(activeSelection) : 'null'}"><label>Selection shape<select name="shape"><option value="ellipse" ${s?.shape !== 'rectangle' ? 'selected' : ''}>Circle / ellipse</option><option value="rectangle" ${s?.shape === 'rectangle' ? 'selected' : ''}>Rectangle</option></select></label><div class="region-draw"><img id="region-source-image" alt="Original source; draw the selected area on its separate overlay" src="${c.imageUrl(ptr(source))}"><svg id="region-overlay" tabindex="0" role="group" aria-label="Region annotation. Drag to select; arrow keys move the selection. Numeric bounds are available below." xmlns="http://www.w3.org/2000/svg"><ellipse id="region-ellipse"/><rect id="region-rect"/></svg></div><p id="region-dimensions" class="hint">Decoding oriented source dimensions…</p><div class="region-coordinates">${['x', 'y', 'width', 'height'].map((k) => `<label>${k}<input name="${k}" type="number" min="${k === 'x' || k === 'y' ? 0 : 1}" step="1" required value="${bounds[k as keyof Bounds]}"></label>`).join('')}</div><button type="submit" class="primary" disabled>Save bound selection</button></form>${s ? `<p class="hint">Saved selection v${selection!.version} · ${s.width} × ${s.height} · pixel-top-left · mask ${s.mask.checksum.slice(0, 16)}. Change source, crop or orientation: create a new binding.</p>` : ''}`
  }</section>
  ${
    selection
      ? `<section class="panel"><h2>Prepare a regional request</h2><form id="region-prepare" data-selection="${encoded(selection)}"><div class="two-col"><label>Intent preset<select name="preset"><option value="preserve-form-change-finish">Preserve form / change finish</option><option value="selected-area">Edit selected area</option><option value="explore">Explore</option></select></label><label>Execution path<select name="path"><option value="native">Manual native handoff</option><option value="api">Configured image API</option></select></label></div><label>Instructions<textarea name="instructions" rows="3" required placeholder="Change the finish in this area; keep the corner and composition."></textarea></label><label>Preservation policy<select name="preservation"><option value="strict-composite">Strict outside preservation · separate local composite</option><option value="review-raw">Review provider raw image</option></select></label><fieldset><legend>Choose scoped reference images (at most four)</legend>${
          c.references
            .filter(
              (r) =>
                r.selected &&
                [source!.payload.scope, 'landing-page'].includes(r.scope),
            )
            .map(
              (r) =>
                `<label class="check"><input type="checkbox" name="reference" value="${e(JSON.stringify(r.artifact))}">${e(r.label)} · ${e(r.role)} · v${r.artifact.version}</label>`,
            )
            .join('') ||
          '<p class="hint">No selected references for this section.</p>'
        }</fieldset><div class="two-col region-api-controls"><label>API size<select name="size" disabled><option>1024x1024</option><option>1536x1024</option><option>1024x1536</option></select></label><label>API quality<select name="quality" disabled><option>low</option><option>medium</option><option>high</option></select></label></div><p id="region-capability" class="hint">Native model/settings/seed/usage are unknown. Exported mask is host guidance only.</p><p class="hint">API mask, seed, CFG and exact provider preservation are unavailable. Extend canvas and Final detail are unavailable. Strict composition requires identical oriented dimensions; it is hard-edge with no blend.</p><button type="submit">Save regional request</button></form></section>`
      : ''
  }
  <div class="region-operations">${operations.map((p) => operationView(c, p)).join('') || '<section class="panel empty"><p>No regional attempts yet.</p></section>'}</div>`;
}
function operationView(c: Context, p: Artifact): string {
  const o = p.payload.state as RegionOperation;
  const get = (r: VersionRef) => c.artifacts.find((a) => same(ptr(a), r));
  const selection = get(o.selection),
    currentMask = c.artifacts.find((a) => a.id === o.selection.id);
  // Historical selections remain embedded in the operation; request the original source crop below.
  const key = c.project.id + ':' + o.selection.id + ':' + o.selection.version;
  const s =
    (selection?.payload.state as RegionSelection | undefined) ??
    historicalSelections.get(key);
  const execution = c.artifacts.find((a) => a.id === o.execution.id)!;
  const job = execution.payload.state as NativeJob | ProviderJob;
  const collected = o.outputs
    .map((r) => get(r))
    .filter((a): a is Artifact => !!a);
  // Operation revisions append outputs; comparisons keep their original snapshot binding.
  // Workspace artifacts are ordered by ledger sequence, so the last matching record wins.
  const comparison = c.artifacts
    .filter((a) => {
      if (
        a.payload.kind !== 'website-region-comparison' ||
        a.projectId !== c.project.id ||
        a.projectId !== p.projectId ||
        a.payload.scope !== p.payload.scope
      )
        return false;
      const saved = a.payload.state as RegionComparison;
      return (
        saved.operation.id === p.id &&
        saved.operation.version <= p.version &&
        same(saved.source, o.source) &&
        same(saved.selection, o.selection)
      );
    })
    .at(-1)?.payload.state as RegionComparison | undefined;
  const pending = job.outputs.filter(
    (r) =>
      !collected.some((a) => same((a.payload.state as RegionImage).raw, r)),
  );
  const activeSelection = c.artifacts
    .filter(
      (a) =>
        a.payload.kind === 'website-region-selection' &&
        a.payload.scope === p.payload.scope,
    )
    .at(-1);
  const stale =
    !same(activeSelection && ptr(activeSelection), o.selection) ||
    currentMask?.version !== o.selection.version ||
    o.project.version !== c.project.version ||
    !same(c.accepted[p.payload.scope] ?? null, o.selectedAtStart);
  const native = o.recipe.path === 'native',
    n = native ? (job as NativeJob) : null;
  return `<section class="panel region-operation" data-operation="${encoded(p)}"><div class="job-heading"><div><p class="eyebrow">${e(p.payload.scope)} · ${e(o.recipe.path)} · MASK V${o.selection.version}</p><h2>${e(o.recipe.preset)} <small>${e(p.id.slice(-8))}</small></h2></div><span class="badge ${stale ? 'unresolved' : ''}">${e(job.status)}${stale ? ' · original inputs changed' : ''}</span></div><p>${e(o.instructions)}</p><p class="hint">Recipe ${e(o.recipe.version)} · ${o.references.map((r) => `${e(r.role)} v${r.artifact.version}`).join(', ') || 'no chosen reference'} · ${e(o.preservation)}. ${native ? 'Native settings remain unknown.' : `${e(o.recipe.controls!.size)} / ${e(o.recipe.controls!.quality)} · no mask sent.`}</p>${native ? `<button type="button" data-region-action="bundle" data-operation="${encoded(p)}">Export source / mask / references bundle</button><form class="region-import" data-job="${encoded(execution)}" data-project="${e(JSON.stringify(n!.manifest.project))}" data-source="${e(JSON.stringify(n!.manifest.artifact))}"><label>Returned native image<input type="file" name="file" accept="image/png,image/jpeg,image/webp" required></label><button type="submit">Import regional raw candidate</button></form>` : `<div class="button-row"><button type="button" data-action="provider-submit" data-job="${encoded(execution)}" ${job.status !== 'queued' || !c.apiAvailable ? 'disabled' : ''}>Submit this regional API attempt once</button><button type="button" data-action="provider-refresh">Refresh regional outcomes</button></div>`}
  ${pending.map((r) => `<button type="button" data-region-action="collect" data-operation="${encoded(p)}" data-raw="${e(JSON.stringify(r))}">Retain result in regional comparison</button>`).join('')}
  ${
    collected.length
      ? `<div class="region-compare-grid"><article><h3>Original source</h3>${imagePanels(c, o.source, s)}</article>${collected
          .map((a) => {
            const i = a.payload.state as RegionImage;
            return `<article class="region-candidate" data-candidate="${encoded(a)}"><h3>${i.variant === 'raw' ? 'Raw result' : 'Strict local composite'}</h3>${imagePanels(c, ptr(a), s)}${same(comparison?.selected, ptr(a)) ? '<p class="badge">Selected in saved comparison</p>' : ''}${same(c.accepted[p.payload.scope], ptr(a)) ? '<p class="badge">Accepted section image</p>' : ''}<p class="hint">${i.image.width} × ${i.image.height} · ${i.variant === 'strict-composite' ? 'Outside RGB 0 / alpha 0 · hard edge' : 'Outside preservation unverified'}</p><small>SHA-256 ${i.image.checksum}</small><a class="text-link" href="${c.imageUrl(ptr(a)).replace('/image?', '/asset?')}">Download ${i.variant}</a>${i.variant === 'raw' && o.preservation === 'strict-composite' && !collected.some((b) => (b.payload.state as RegionImage).variant === 'strict-composite' && same((b.payload.state as RegionImage).raw, i.raw)) ? `<button type="button" data-region-action="compose" data-candidate="${encoded(a)}">Create strict local composite</button>` : ''}<form class="region-accept" data-candidate="${encoded(a)}" data-scope="${e(p.payload.scope)}"><label>Acceptance reason<input name="reason" required></label><button type="submit" ${stale || job.status !== 'returned' || (o.preservation === 'strict-composite' && i.variant !== 'strict-composite') ? 'disabled' : ''}>Accept this exact regional candidate</button></form></article>`;
          })
          .join(
            '',
          )}</div><form class="region-comparison" data-operation="${encoded(p)}"><p class="hint">${comparison ? (comparison.selected ? 'Saved comparison selection restored.' : 'Saved comparison is unresolved.') : 'No saved comparison yet.'} Comparison selection does not accept an image; acceptance is a separate action.</p><fieldset><legend>Compare one to three candidates</legend>${collected.map((a, index) => `<label class="check"><input name="compared" type="checkbox" value="${encoded(a)}" ${(comparison ? comparison.compared.some((r) => same(r, ptr(a))) : index >= collected.length - 3) ? 'checked' : ''}>${e((a.payload.state as RegionImage).variant)} · ${e(a.id.slice(-8))}</label>`).join('')}</fieldset><label>Comparison selection<select name="selected"><option value="null" ${!comparison?.selected ? 'selected' : ''}>Keep unresolved</option>${collected.map((a) => option(a, (a.payload.state as RegionImage).variant + ' · ' + a.id.slice(-8), same(comparison?.selected, ptr(a)))).join('')}</select></label><label>Comparison reason<input name="reason" required value="${e(comparison?.reason ?? '')}"></label><button type="submit">Save regional comparison / selection</button></form>`
      : ''
  }${stale ? '<p class="hint">Historical attempt retained. Prepare a new attempt against current inputs before acceptance.</p>' : ''}</section>`;
}
function imagePanels(c: Context, r: VersionRef, s?: RegionSelection): string {
  const url = c.imageUrl(r);
  return `<figure class="region-whole"><img src="${url}" alt="Section scale comparison"><figcaption>Section scale · matched display</figcaption></figure>${s ? `<figure class="region-crop"><canvas data-region-crop="${e(JSON.stringify(s.bounds))}" data-source-url="${url}" role="img" aria-label="Selected region at matched scale"></canvas><figcaption>Region scale · same source-pixel bounds</figcaption></figure>` : '<p class="hint">Historical mask geometry is available in the exported original operation.</p>'}`;
}
export function bindRegions(c: Context): void {
  for (const canvas of document.querySelectorAll<HTMLCanvasElement>(
    '[data-region-crop]',
  )) {
    const b = JSON.parse(canvas.dataset['regionCrop']!) as Bounds,
      scale = Math.min(1, 512 / Math.max(b.width, b.height));
    canvas.width = Math.max(1, Math.round(b.width * scale));
    canvas.height = Math.max(1, Math.round(b.height * scale));
    const img = new Image();
    img.addEventListener(
      'load',
      () => {
        canvas
          .getContext('2d')!
          .drawImage(
            img,
            b.x,
            b.y,
            b.width,
            b.height,
            0,
            0,
            canvas.width,
            canvas.height,
          );
        canvas.dataset['loaded'] = 'true';
      },
      { once: true },
    );
    img.src = canvas.dataset['sourceUrl']!;
  }

  for (const a of c.artifacts.filter(
    (a) => a.payload.kind === 'website-region-operation',
  )) {
    const r = (a.payload.state as RegionOperation).selection,
      key = c.project.id + ':' + r.id + ':' + r.version;
    if (
      c.artifacts.some((a) => same(ptr(a), r)) ||
      historicalSelections.has(key) ||
      loadingSelections.has(key)
    )
      continue;
    loadingSelections.add(key);
    void fetch(
      `/api/v1/artifact?project=${c.project.id}&id=${r.id}&version=${r.version}`,
    )
      .then(async (response) => {
        if (!response.ok) return;
        const historical = (await response.json()) as NodePacket<
          DesignArtifact<RegionSelection>
        >;
        historicalSelections.set(key, historical.payload.state);
        if (projectId === c.project.id) c.render();
      })
      .catch(() => {
        /* Read failure leaves the original geometry explicitly unresolved. */
      });
  }
  document
    .querySelector<HTMLSelectElement>('#region-source')
    ?.addEventListener('change', (ev) => {
      sourceId = (ev.target as HTMLSelectElement).value
        ? JSON.parse((ev.target as HTMLSelectElement).value).id
        : '';
      c.render();
    });
  const form = document.querySelector<HTMLFormElement>('#region-select'),
    image = document.querySelector<HTMLImageElement>('#region-source-image'),
    overlay = document.querySelector<SVGSVGElement>('#region-overlay');
  if (form && image && overlay) {
    const values = () =>
      Object.fromEntries(
        ['x', 'y', 'width', 'height'].map((k) => [
          k,
          Number((form.elements.namedItem(k) as HTMLInputElement).value),
        ]),
      ) as unknown as Bounds;
    const assign = (b: Bounds) => {
      for (const k of ['x', 'y', 'width', 'height'] as const)
        (form.elements.namedItem(k) as HTMLInputElement).value = String(b[k]);
      draw();
    };
    const draw = () => {
      if (!form.isConnected || !image.isConnected || !overlay.isConnected) return;
      const b = values(),
        ellipse =
          form.querySelector<HTMLSelectElement>('[name=shape]')!.value ===
          'ellipse';
      const rect = overlay.querySelector('#region-rect')!,
        circle = overlay.querySelector('#region-ellipse')!;
      for (const k of ['x', 'y', 'width', 'height'] as const)
        rect.setAttribute(k, String(b[k]));
      for (const [k, v] of Object.entries({
        cx: b.x + b.width / 2,
        cy: b.y + b.height / 2,
        rx: b.width / 2,
        ry: b.height / 2,
      }))
        circle.setAttribute(k, String(v));
      rect.setAttribute('visibility', ellipse ? 'hidden' : 'visible');
      circle.setAttribute('visibility', ellipse ? 'visible' : 'hidden');
    };
    const ready = () => {
      // An image can finish loading after navigation/re-render detached this view.
      if (!form.isConnected || !image.isConnected || !overlay.isConnected) return;
      overlay.setAttribute(
        'viewBox',
        `0 0 ${image.naturalWidth} ${image.naturalHeight}`,
      );
      document.querySelector('#region-dimensions')!.textContent =
        `${image.naturalWidth} × ${image.naturalHeight} oriented pixels · use drag, arrow keys or numeric bounds`;
      for (const k of ['x', 'width'])
        (form.elements.namedItem(k) as HTMLInputElement).max = String(
          image.naturalWidth,
        );
      for (const k of ['y', 'height'])
        (form.elements.namedItem(k) as HTMLInputElement).max = String(
          image.naturalHeight,
        );
      form.querySelector<HTMLButtonElement>('button')!.disabled = false;
      draw();
    };
    if (image.complete && image.naturalWidth) ready();
    else image.addEventListener('load', ready, { once: true });
    form.addEventListener('input', draw);
    const point = (ev: PointerEvent) => {
      const b = overlay.getBoundingClientRect();
      return {
        x: Math.max(
          0,
          Math.min(
            image.naturalWidth - 1,
            Math.floor(((ev.clientX - b.left) / b.width) * image.naturalWidth),
          ),
        ),
        y: Math.max(
          0,
          Math.min(
            image.naturalHeight - 1,
            Math.floor(((ev.clientY - b.top) / b.height) * image.naturalHeight),
          ),
        ),
      };
    };
    let start: { x: number; y: number } | null = null;
    overlay.addEventListener('pointerdown', (ev) => {
      if (!image.naturalWidth) return;
      start = point(ev);
      overlay.setPointerCapture(ev.pointerId);
      overlay.focus({ preventScroll: true });
      assign({ ...start, width: 1, height: 1 });
    });
    overlay.addEventListener('pointermove', (ev) => {
      if (!start) return;
      const end = point(ev);
      assign({
        x: Math.min(start.x, end.x),
        y: Math.min(start.y, end.y),
        width: Math.abs(end.x - start.x) + 1,
        height: Math.abs(end.y - start.y) + 1,
      });
    });
    overlay.addEventListener('pointerup', () => {
      start = null;
    });
    overlay.addEventListener('pointercancel', () => {
      start = null;
    });
    overlay.addEventListener('keydown', (ev) => {
      const d = (
        {
          ArrowLeft: [-1, 0],
          ArrowRight: [1, 0],
          ArrowUp: [0, -1],
          ArrowDown: [0, 1],
        } as Record<string, number[]>
      )[ev.key];
      if (!d) return;
      ev.preventDefault();
      const b = values();
      assign({
        ...b,
        x: Math.max(0, Math.min(image.naturalWidth - b.width, b.x + d[0]!)),
        y: Math.max(0, Math.min(image.naturalHeight - b.height, b.y + d[1]!)),
      });
    });
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      void c.act(() =>
        c.mutate(
          'region/select',
          {
            expectedProject: ptr(c.project),
            source: JSON.parse(form.dataset['source']!),
            previous: JSON.parse(form.dataset['previous']!),
            expectedSelection: JSON.parse(form.dataset['current']!),
            width: image.naturalWidth,
            height: image.naturalHeight,
            coordinateSystem: 'pixel-top-left',
            shape: new FormData(form).get('shape'),
            bounds: values(),
          },
          'Selection saved against the original source pixels.',
        ),
      );
    });
  }
  const prepare = document.querySelector<HTMLFormElement>('#region-prepare');
  prepare
    ?.querySelector<HTMLSelectElement>('[name=path]')
    ?.addEventListener('change', (ev) => {
      const api = (ev.target as HTMLSelectElement).value === 'api';
      for (const control of prepare.querySelectorAll<HTMLSelectElement>(
        '.region-api-controls select',
      ))
        control.disabled = !api;
      document.querySelector('#region-capability')!.textContent = api
        ? 'API sends the source and chosen references, with instruction guidance only; no mask is sent.'
        : 'Native model/settings/seed/usage are unknown. Exported mask is host guidance only.';
    });
  const onForm = (
    selector: string,
    action: (f: HTMLFormElement, d: FormData) => Promise<void>,
  ) => {
    for (const f of document.querySelectorAll<HTMLFormElement>(selector))
      f.addEventListener('submit', (ev) => {
        ev.preventDefault();
        void c.act(() => action(f, new FormData(f)));
      });
  };
  onForm('#region-prepare', (f, d) =>
    c.mutate(
      'region/prepare',
      {
        expectedProject: ptr(c.project),
        selection: JSON.parse(f.dataset['selection']!),
        instructions: d.get('instructions'),
        preservation: d.get('preservation'),
        preset: d.get('preset'),
        path: d.get('path'),
        controls:
          d.get('path') === 'api'
            ? { size: d.get('size'), quality: d.get('quality') }
            : null,
        references: d.getAll('reference').map((x) => JSON.parse(String(x))),
      },
      'Regional attempt saved. Execution and acceptance stay explicit.',
    ),
  );
  onForm('.region-import', async (f, d) =>
    c.mutate(
      'import',
      {
        job: JSON.parse(f.dataset['job']!),
        manifestProject: JSON.parse(f.dataset['project']!),
        originalArtifact: JSON.parse(f.dataset['source']!),
        file: await c.fileBase64(d),
      },
      'Raw native result retained; collect it into the original regional attempt.',
    ),
  );
  onForm('.region-comparison', (f, d) => {
    const op = c.artifacts.find((a) =>
      same(ptr(a), JSON.parse(f.dataset['operation']!)),
    )!;
    return c.mutate(
      'region/compare',
      {
        operation: ptr(op),
        compared: d.getAll('compared').map((x) => JSON.parse(String(x))),
        selected: JSON.parse(String(d.get('selected'))),
        reason: d.get('reason'),
      },
      'Comparison and selection saved; acceptance stays separate.',
    );
  });
  onForm('.region-accept', (f, d) =>
    c.mutate(
      'region/accept',
      {
        candidate: JSON.parse(f.dataset['candidate']!),
        expected: c.accepted[f.dataset['scope']!] ?? null,
        reason: d.get('reason'),
      },
      'Exact regional candidate accepted; previous versions remain in history.',
    ),
  );
  for (const b of document.querySelectorAll<HTMLButtonElement>(
    '[data-region-action]',
  ))
    b.addEventListener('click', () => {
      void c.act(async () => {
        const operation = b.dataset['operation']
          ? JSON.parse(b.dataset['operation'])
          : undefined;
        if (b.dataset['regionAction'] === 'collect')
          await c.mutate(
            'region/collect',
            { operation, raw: JSON.parse(b.dataset['raw']!) },
            'Raw result bound to its original region.',
          );
        if (b.dataset['regionAction'] === 'compose')
          await c.mutate(
            'region/compose',
            { candidate: JSON.parse(b.dataset['candidate']!) },
            'Separate hard-edge composite saved after checking RGB and alpha outside.',
          );
        if (b.dataset['regionAction'] === 'bundle') {
          const response = await fetch(
            `/api/v1/region/bundle?project=${c.project.id}&id=${operation.id}&version=${operation.version}`,
          );
          const result = await response.json();
          if (!response.ok)
            throw new Error(result.error ?? 'Regional bundle export failed');
          const url = URL.createObjectURL(
              new Blob([JSON.stringify(result, null, 2)], {
                type: 'application/json',
              }),
            ),
            a = document.createElement('a');
          a.href = url;
          a.download = 'regional-request-' + operation.id + '.json';
          a.click();
          URL.revokeObjectURL(url);
        }
      });
    });
}
