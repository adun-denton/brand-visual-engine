import type {
  NodePacket,
  DesignArtifact,
  ModuleProject,
  IterationBundle,
  VersionRef,
} from '../kernel/contracts.ts';
import type {
  DirectionRequest,
  ProjectAsset,
  DirectionEvidence,
} from '../modules/website/ai-contracts.ts';
import type { AISpec } from '../modules/website/ai-contracts.ts';
import type { WebsiteDesignState } from '../modules/website/design.ts';
import { escapeHtml as e, sectionIds } from '../modules/website/composition.ts';
import type { Providers } from '../service/providers.ts';
const ptr = (a: NodePacket<unknown>): VersionRef => ({
  id: a.id,
  version: a.version,
  freshness: 'pinned',
});
const enc = (a: unknown) => e(JSON.stringify(a));
interface Context {
  project: NodePacket<ModuleProject>;
  artifacts: NodePacket<DesignArtifact<unknown>>[];
  bundles: NodePacket<IterationBundle>[];
  providers?: ReturnType<Providers['status']> | undefined;
}
const url = (c: Context, r: VersionRef, action: string) =>
  `/api/v1/${action}?project=${c.project.id}&id=${r.id}&version=${r.version}`;
export function requestView(c: Context): string {
  const jobs = c.artifacts.filter(
    (a) => a.payload.kind === 'website-ai-request',
  ) as NodePacket<DesignArtifact<DirectionRequest>>[];
  return `<section class="panel"><h2>AI direction handoffs</h2><p>AI-authored page decisions, not preset variation. Export the pinned request to an authorized AI, then import its structured response. AI authorship attestation is not human/brand approval. Missing executors keep requests pending; no synthetic fallback.</p>${
    jobs
      .map((a) => {
        const s = a.payload.state;
        const current =
          s.project.version === c.project.version && s.status === 'awaiting';
        return `<article class="ai-request" data-request="${enc(ptr(a))}"><h3>Direction request ${e(a.id.slice(-8))} · v${a.version}</h3><p>${s.count} candidates · ${e(s.status)} · brief v${s.project.version}</p><p>${e(s.instructions)}</p><a download="ai-request-${a.id}.json" href="${url(c, ptr(a), 'direction/request')}">Export AI direction request</a><form class="ai-import" data-request="${enc(ptr(a))}"><label>AI response JSON<input name="file" type="file" accept="application/json,.json" required></label><label>AI source / evidence reference<input name="source" required maxlength="500"></label><label>Reported native model (blank means unknown)<input name="model" maxlength="200"></label><label class="check"><input name="authorship" type="checkbox" required> I attest this response was authored by AI; it remains a proposal</label><button ${current ? '' : 'disabled'}>Apply native AI candidates</button></form><form class="ai-api-prepare" data-request="${enc(ptr(a))}" ${current ? '' : 'disabled'}><button ${current ? '' : 'disabled'}>Prepare API directions</button></form><p class="hint">Preparation sends nothing. Submission requires a separately approved direction-generation policy; existing live approval does not fund this path.</p></article>`;
      })
      .join('') ||
    '<p>No pending AI request. Use Explore directions above to prepare one.</p>'
  }</section>`;
}
export function evidenceView(
  a: NodePacket<DesignArtifact<DirectionEvidence>>,
): string {
  const s = a.payload.state;
  return `<article class="ai-result"><h3>AI direction response · ${e(s.outcome)}</h3><p>${s.response.candidates.length} structured candidates · ${e(s.source)}. Requested ${e(s.requestedModel ?? 'unknown')}; reported ${e(s.reportedModel ?? 'unknown')}.</p><form class="ai-api-apply" data-request="${enc(s.request)}" data-evidence="${enc(ptr(a))}" ${s.outcome === 'candidate' ? '' : 'disabled'}><button ${s.outcome === 'candidate' ? '' : 'disabled'}>Apply API candidates as directions</button></form><p>Applying creates renderable drafts; selection/acceptance stays separate.</p></article>`;
}
export function needsView(
  a: NodePacket<DesignArtifact<WebsiteDesignState>>,
): string {
  if (!a.payload.state.parameters['ai']) return '';
  const s = a.payload.state.parameters['ai'] as unknown as AISpec;
  return `<details class="direction-needs"><summary>AI rationale, uncertainty and image needs</summary><p>${e(s.rationale)}</p><p>Uncertainty: ${e(s.uncertainty)}</p>${s.imageNeeds.map((n) => `<article><h4>${e(n.section)} · ${e(n.role)} · ${e(n.size)}</h4><p>${e(n.prompt)}</p><p>Preserve: ${e(n.preservation.join('; '))}</p><small>${n.references.length} pinned reference hints; inclusion remains deliberate.</small></article>`).join('')}</details>`;
}
export function assetsView(c: Context): string {
  const assets = c.artifacts.filter(
    (a) => a.payload.kind === 'website-asset',
  ) as NodePacket<DesignArtifact<ProjectAsset>>[];
  const originals = c.artifacts.filter((a) =>
    [
      'website-reference',
      'website-image',
      'website-api-image',
      'website-region-image',
    ].includes(a.payload.kind),
  );
  const candidates = c.bundles
    .flatMap((b) => b.payload.candidates.map((r) => ({ r, b })))
    .filter(({ r }) =>
      c.artifacts.some(
        (a) =>
          a.id === r.id &&
          a.version === r.version &&
          a.payload.kind === 'website-design' &&
          (a.payload.state as WebsiteDesignState).parameters['ai'],
      ),
    );
  const origins = `<option value="null">Upload a supplied image</option>${originals.map((a) => `<option value="${enc(ptr(a))}">${e(a.payload.kind)} · ${e(a.payload.scope)} · ${e(a.id.slice(-8))} v${a.version}</option>`).join('')}`;
  return `<section class="panel"><h2>Project assets</h2><p>Reusable supplied/generated PNG, JPEG and WebP originals. Generation direction is provenance, not a reuse restriction. Exact versions/roles remain inspectable. Assets are not automatically sent to providers or added to an export.</p><form id="asset-add"><label>Original or upload<select name="origin">${origins}</select></label><label>Supplied image file<input type="file" name="file" accept="image/png,image/jpeg,image/webp"></label><label>Asset label<input name="label" required maxlength="100"></label><label>Deliberate role<select name="role"><option value="reference">Reference only — excluded from placement</option><option value="placeable">Placeable — permitted for design/export</option></select></label><label>Permission / provenance reason<input name="permission" required maxlength="500"></label><button>Add exact asset version</button></form></section><div class="asset-grid">${assets
    .map((a) => {
      const s = a.payload.state;
      return `<article class="panel project-asset" data-asset="${enc(ptr(a))}"><h3>${e(s.label)} · v${a.version}</h3><img alt="${e(s.label)}" src="${url(c, ptr(a), 'image')}"><p>${e(s.role)} · ${s.image.width} × ${s.image.height}</p><small>SHA256 ${e(s.image.checksum)}</small><p>Origin: ${e(s.origin ? JSON.stringify(s.origin) : 'supplied original; no generation claim')}</p><p>${e(s.permission)}</p><a href="${url(c, ptr(a), 'asset')}">Download exact original</a><form class="asset-role" data-asset="${enc(ptr(a))}"><label>Label<input name="label" required value="${e(s.label)}"></label><label>Role<select name="role"><option value="reference" ${s.role === 'reference' ? 'selected' : ''}>Reference only</option><option value="placeable" ${s.role === 'placeable' ? 'selected' : ''}>Placeable</option></select></label><label>Permission reason<input name="permission" required value="${e(s.permission)}"></label><button>Save immutable asset revision</button></form><form class="direction-place" data-asset="${enc(ptr(a))}"><label>Direction context<select name="target">${candidates.map(({ r, b }) => `<option value="${enc({ direction: r, bundle: ptr(b) })}">${e((c.artifacts.find((x) => x.id === r.id)!.payload.state as WebsiteDesignState).thesis)} · v${r.version}</option>`).join('')}</select></label><label>Section<select name="section">${sectionIds.map((i) => `<option>${i}</option>`).join('')}</select></label><label>Alt text<input name="alt"></label><label>Unresolved accessibility note<input name="unresolved"></label><label>Placement reason<input name="reason" required></label><button ${s.role === 'placeable' && candidates.length ? '' : 'disabled'}>Place exact asset in direction</button><p>Creates a new direction revision; previous acceptance and other directions remain pinned. Reuse the same asset in another direction to compare in context.</p></form><details><summary>Version history</summary><form class="asset-history" data-asset="${enc(ptr(a))}"><label>Exact historical version<input name="version" type="number" min="1" max="${a.version}" value="1" required></label><button>Inspect historical asset version</button></form><div class="asset-history-result"></div></details></article>`;
    })
    .join('')}</div>`;
}
interface BindContext extends Context {
  onForm: (
    selector: string,
    f: (form: HTMLFormElement) => Promise<void>,
  ) => void;
  mutate: (path: string, input: unknown, message: string) => Promise<void>;
}
export function bindAI(c: BindContext): void {
  const data = (f: HTMLFormElement) => new FormData(f);
  c.onForm('.ai-import', async (f) => {
    const v = data(f),
      file = v.get('file') as File;
    if (file.size > 160000) throw Error('AI response exceeds 160KB');
    await c.mutate(
      'direction/apply',
      {
        request: JSON.parse(f.dataset['request']!),
        response: JSON.parse(await file.text()),
        source: v.get('source'),
        model: v.get('model') || null,
        aiAuthorship: v.get('authorship') === 'on',
      },
      'AI candidates applied; acceptance unchanged.',
    );
  });
  c.onForm('.ai-api-prepare', async (f) => {
    const r = JSON.parse(f.dataset['request']!);
    const a = c.artifacts.find((a) => a.id === r.id) as NodePacket<
      DesignArtifact<DirectionRequest>
    >;
    await c.mutate(
      'provider/prepare',
      {
        expectedProject: ptr(c.project),
        artifact: null,
        scope: 'landing-page',
        operation: 'directions',
        instructions: a.payload.state.instructions,
        directionRequest: r,
        references: a.payload.state.references,
        size: '1024x1024',
        quality: 'low',
      },
      'API direction request saved; no submission.',
    );
  });
  c.onForm('.ai-api-apply', async (f) => {
    await c.mutate(
      'direction/apply',
      {
        request: JSON.parse(f.dataset['request']!),
        evidence: JSON.parse(f.dataset['evidence']!),
      },
      'API AI candidates applied; review and acceptance separate.',
    );
  });
  c.onForm('.asset-history', async (f) => {
    const r = JSON.parse(f.dataset['asset']!),
      version = Number(data(f).get('version'));
    const response = await fetch(url(c, { ...r, version }, 'artifact'));
    if (!response.ok) throw Error('Asset history unavailable');
    const a = (await response.json()) as NodePacket<
      DesignArtifact<ProjectAsset>
    >;
    f.parentElement!.querySelector('.asset-history-result')!.innerHTML =
      `<p>Exact v${a.version} · ${e(a.payload.state.role)} · ${e(a.payload.state.permission)}</p><img alt="${e(a.payload.state.label)} historical original" src="${url(c, ptr(a), 'image')}"><a href="${url(c, ptr(a), 'asset')}">Download exact historical bytes</a><pre>${e(JSON.stringify(a.payload.state, null, 2))}</pre>`;
  });
  c.onForm('#asset-add', async (f) => {
    const v = data(f),
      origin = JSON.parse(String(v.get('origin'))),
      file = v.get('file') as File;
    let image: string | undefined;
    if (origin === null) {
      if (!file.size || file.size > 8 * 1024 * 1024)
        throw Error('Supply a PNG/JPEG/WebP up to8MiB');
      const bytes = new Uint8Array(await file.arrayBuffer());
      let s = '';
      for (const b of bytes) s += String.fromCharCode(b);
      image = btoa(s);
    }
    await c.mutate(
      'assets/add',
      {
        expectedProject: ptr(c.project),
        origin,
        label: v.get('label'),
        role: v.get('role'),
        permission: v.get('permission'),
        ...(image ? { file: image } : {}),
      },
      'Exact asset added; provider/export inclusion remains deliberate.',
    );
  });
  c.onForm('.asset-role', async (f) => {
    const v = data(f);
    await c.mutate(
      'assets/revise',
      {
        expectedProject: ptr(c.project),
        expected: JSON.parse(f.dataset['asset']!),
        label: v.get('label'),
        role: v.get('role'),
        permission: v.get('permission'),
      },
      'New asset role revision saved; existing placements unchanged.',
    );
  });
  c.onForm('.direction-place', async (f) => {
    const v = data(f);
    await c.mutate(
      'direction/place',
      {
        expectedProject: ptr(c.project),
        ...JSON.parse(String(v.get('target'))),
        asset: JSON.parse(f.dataset['asset']!),
        section: v.get('section'),
        alt: v.get('alt'),
        unresolved: v.get('unresolved'),
        reason: v.get('reason'),
      },
      'New direction placement revision saved; earlier acceptance unchanged.',
    );
  });
}
