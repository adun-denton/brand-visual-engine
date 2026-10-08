import type {
  ProviderJob,
  ApiImage,
  AssistantProposal,
  AssistantReview,
} from '../modules/website/provider-contracts.ts';
import type { Providers } from '../service/providers.ts';
import type {
  CapabilityRegistry,
  DesignArtifact,
  IterationBundle,
  ModuleProject,
  NodePacket,
  ProjectLedger,
  VersionRef,
  VisualOS,
} from '../kernel/contracts.ts';
import type { WebsiteDesignState } from '../modules/website/design.ts';
import type {
  ReferenceInput,
  NativeJob,
  ImageState,
  DirectionProposal,
} from '../modules/website/workspace-contracts.ts';
interface State {
  providers?: ReturnType<Providers['status']>;
  projects: NodePacket<ModuleProject>[];
  visualOS: NodePacket<VisualOS>[];
  capabilities: CapabilityRegistry;
  project?: NodePacket<ModuleProject>;
  artifacts?: NodePacket<DesignArtifact<unknown>>[];
  bundles?: NodePacket<IterationBundle>[];
  ledger?: ProjectLedger;
  accepted?: Record<string, VersionRef | null>;
  references?: ReferenceInput[];
}
const root = document.querySelector<HTMLDivElement>('#app')!,
  notice = document.querySelector<HTMLDivElement>('#notice')!;
let state: State,
  token = '',
  view = 'brief',
  round = '',
  compared: VersionRef[] = [],
  busy = false;
const e = (v: unknown) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
const ptr = (p: NodePacket<unknown>): VersionRef => ({
  id: p.id,
  version: p.version,
  freshness: 'pinned',
});
const match = (a: VersionRef | null | undefined, b: VersionRef) =>
  a?.id === b.id && a?.version === b.version;
const encoded = (r: VersionRef) => e(JSON.stringify(r));
const button = (text: string, action: string, extra = '', kind = '') =>
  `<button type="button" class="${kind}" data-action="${action}" ${extra}>${e(text)}</button>`;
const option = (value: string, label: string, selected = false) =>
  `<option value="${e(value)}" ${selected ? 'selected' : ''}>${e(label)}</option>`;
const jsonRef = (v: string) => JSON.parse(v) as VersionRef;
const field = (key: string) =>
  state.project?.payload.localContext[key]?.override;
const arrayText = (key: string) =>
  Array.isArray(field(key))
    ? (field(key) as string[]).join('\n')
    : String(field(key) ?? '');
const all = () => state.artifacts ?? [];
const find = (r: VersionRef) => all().find((p) => match(r, ptr(p)));
function notify(message: string, error = false) {
  notice.textContent = message;
  notice.className = error ? 'notice error' : 'notice';
}
async function request(path: string, input?: unknown): Promise<State> {
  const response = await fetch('/api/v1/' + path, {
    method: input === undefined ? 'GET' : 'POST',
    headers:
      input === undefined
        ? {}
        : { 'Content-Type': 'application/json', 'X-BVE-Token': token },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  });
  const result = (await response.json()) as State & {
    token?: string;
    error?: string;
  };
  if (!response.ok) throw new Error(result.error ?? 'Request rejected');
  if (result.token) token = result.token;
  return result;
}
async function act(action: () => Promise<void>) {
  if (busy) return;
  busy = true;
  root.setAttribute('aria-busy', 'true');
  try {
    await action();
  } catch (error) {
    notify(error instanceof Error ? error.message : 'Operation failed', true);
  } finally {
    busy = false;
    root.removeAttribute('aria-busy');
  }
}
async function mutate(path: string, input: unknown, message: string) {
  const projectId = state.project!.id;
  try {
    state = await request(path, { projectId, input });
  } catch (error) {
    // A rejected mutation may still have recorded an outcome. Refresh only its owning
    // workspace; retain the original error and never retry the mutation automatically.
    try {
      const current = await request(
        'workspace?project=' + encodeURIComponent(projectId),
      );
      if (
        state.project?.id === projectId &&
        JSON.stringify(current) !== JSON.stringify(state)
      ) {
        state = current;
        render();
      }
    } catch {
      // Keep the original failure visible even if the read-back is unavailable.
    }
    throw error;
  }
  notify(message);
  render();
}
function activate(next: State) {
  state = next;
  round = '';
  const comparison = all()
    .filter((a) => a.payload.kind === 'website-comparison')
    .at(-1);
  compared = comparison
    ? [...(comparison.payload.state as { compared: VersionRef[] }).compared]
    : [];
}
async function open(id: string) {
  activate(await request('workspace?project=' + encodeURIComponent(id)));
  render();
}
function shell() {
  return `<div class="shell"><aside class="sidebar"><a class="brand" href="/" aria-label="AI Design OS home"><span class="mark">◈</span><span>Design OS<small>LOCAL STUDIO</small></span></a><p class="eyebrow">WORKSPACES</p><nav aria-label="Projects">${state.projects.map((p) => button(String(p.payload.localContext['title']?.override ?? 'Website'), 'open', `data-id="${e(p.id)}"`, state.project?.id === p.id ? 'project active' : 'project')).join('')}</nav>${button('+ New workspace', 'home', '', 'new-project')}<div class="sidebar-bottom"><span class="dot"></span> Local & private<br><small>Manual image handoff<br>API configuration shown in Images & assistant</small></div></aside><main id="main" tabindex="-1">${state.project ? workspace() : entry()}</main></div>`;
}
function entry() {
  return `<section class="entry"><p class="eyebrow">ONE MODULE. TWO STARTING POINTS.</p><h1>Make intent<br><em>inspectable.</em></h1><p class="intro">A place to explore a website, compare directions and keep the reasons behind your choices.</p><form id="create" class="panel"><h2>Open Website</h2><label>Workspace name<input name="title" required maxlength="100" value="Fictional Home Care"></label><div class="mode-choices"><label><input type="radio" name="mode" value="freeroam" checked> <strong>Freeroam</strong><small>Start with your brief. Brand inputs can stay unresolved.</small></label><label><input type="radio" name="mode" value="branded"> <strong>Branded</strong><small>Explicitly create or mount a minimal VisualOS.</small></label></div><label>VisualOS for Branded<select name="visualOS">${option('new', 'Create and approve this manual palette')}${state.visualOS.map((p) => option(JSON.stringify(ptr(p)), 'Saved VisualOS · ' + p.id.slice(-8))).join('')}</select></label><div class="palette-inputs"><label>Primary<input type="color" name="primary" value="#173f45"></label><label>Background<input type="color" name="background" value="#f3ede0"></label><label>Accent<input type="color" name="accent" value="#de8159"></label></div><p class="hint">Branded creation approves only these explicit palette values and system typography. Motion remains unresolved.</p><button class="primary" type="submit">Enter Website <span aria-hidden="true">↗</span></button></form><p class="hint">Website is the only available module. Synthetic proposals are deterministic, with no AI quality score.</p></section>`;
}
function workspace() {
  const p = state.project!;
  return `<header class="topbar"><span>Website <span class="separator">/</span> ${e(field('title'))}</span><span class="mode-badge">${e(p.payload.mode)} · revision ${p.version}</span></header><div class="workspace"><div class="workspace-title"><div><p class="eyebrow">WEBSITE WORKSPACE</p><h1>${e(field('title'))}</h1><p>Brief → alternatives → a reasoned choice.</p></div><span class="save-state">● Saved locally</span></div><nav class="tabs" aria-label="Workspace views">${[
    ['brief', '01', 'Brief & references'],
    ['explore', '02', 'Explore & compare'],
    ['native', '03', 'Native handoff'],
    ['history', '04', 'History'],
    ['providers', '05', 'Images & assistant'],
  ]
    .map(([key, n, label]) =>
      button(
        n + '  ' + label,
        'view',
        `data-view="${key}" aria-current="${view === key ? 'page' : 'false'}"`,
        view === key ? 'tab active' : 'tab',
      ),
    )
    .join(
      '',
    )}</nav>${view === 'brief' ? brief() : view === 'explore' ? explore() : view === 'native' ? native() : view === 'providers' ? providerView() : history()}</div>`;
}
function brief() {
  const p = state.project!;
  return `<div class="brief-grid"><section class="panel"><div class="section-heading"><p class="eyebrow">THE STARTING POINT</p><h2>A useful brief</h2><p>Keep claims and unresolved choices explicit. Saving makes a new revision.</p></div><form id="brief"><label>Design intent<textarea name="intent" required rows="2">${e(field('intent'))}</textarea></label><div class="two-col"><label>Audience<input name="audience" value="${e(field('audience'))}"></label><label>Offer<input name="offer" value="${e(field('offer'))}"></label></div><label>Intended response<input name="response" value="${e(field('response'))}"></label><label>Required content <small>One item per line</small><textarea name="content" rows="3">${e(arrayText('content'))}</textarea></label><label>Local palette override <small>Optional · three hex colors separated by commas</small><input name="palette" value="${e(Array.isArray(field('palette')) ? (field('palette') as string[]).join(', ') : '')}" placeholder="#173f45, #f3ede0, #de8159"></label><label class="check"><input type="checkbox" name="inheritPalette" ${state.project!.payload.localContext['palette']?.hasOverride ? '' : 'checked'}> Use mounted palette, or leave unresolved without one</label><div class="two-col"><label>Exclusions<textarea name="exclusions" rows="2">${e(arrayText('exclusions'))}</textarea></label><label>Brand commitments<textarea name="commitments" rows="2">${e(arrayText('commitments'))}</textarea></label></div><label>Unresolved choices<textarea name="unresolved" rows="2">${e(arrayText('unresolved'))}</textarea></label><label>Reason for revision<input name="reason" required value="Clarify the website brief"></label><button class="primary" type="submit">Save brief revision</button></form></section><aside class="panel context"><p class="eyebrow">DESIGN CONTEXT</p><h2>What we know</h2><p class="hint">Origins stay visible in both modes.</p>${[
    'palette',
    'typeface',
    'density',
    'motion',
    'unresolved',
  ]
    .map((key) => {
      const f = p.payload.resolvedContext.fields[key];
      return `<div class="context-field"><div><strong>${e(key)}</strong><span class="badge ${!f?.effective ? 'unresolved' : ''}">${e(f?.effective?.origin === 'local-override' ? 'Local override' : (f?.effective?.origin ?? 'Placeholder'))}</span></div><p>${e(f?.effective ? JSON.stringify(f.effective.value) : 'Awaiting an explicit design input')}</p>${f?.reviewRequired ? '<small class="review">Review required · local exploration</small>' : ''}${f?.inherited ? `<small>From VisualOS v${f.inherited.source.version}</small>` : ''}</div>`;
    })
    .join(
      '',
    )}${p.payload.mode === 'freeroam' && state.visualOS.length ? `<form id="mount"><label>Mount a saved VisualOS<select name="visualOS">${state.visualOS.map((v) => option(JSON.stringify(ptr(v)), v.id.slice(-8))).join('')}</select></label><button type="submit">Explicitly switch to Branded</button></form>` : ''}</aside></div><section class="panel references"><div class="section-heading"><p class="eyebrow">REFERENCE BOARD</p><h2>Give each reference a job</h2><p>Attach your permitted images. Choose the trait and section they should influence.</p></div>${state.references?.length ? `<form id="references"><div class="reference-grid">${state.references.map((r, i) => `<article class="reference-card"><img alt="${e(r.label)}" src="${imageUrl(r.artifact)}"><h3>${e(r.label)}</h3><label>Role<select name="role-${i}">${['composition', 'typography', 'palette', 'material', 'imagery', 'form', 'avoid'].map((x) => option(x, x, x === r.role)).join('')}</select></label><label>Scope<select name="scope-${i}">${['landing-page', 'hero', 'services', 'proof', 'contact'].map((x) => option(x, x, x === r.scope)).join('')}</select></label><label class="check"><input type="checkbox" name="selected-${i}" ${r.selected ? 'checked' : ''}> Include in requests</label><small>Image ${e(r.artifact.id.slice(-8))} · version ${r.artifact.version}</small><a class="text-link" href="${imageUrl(r.artifact).replace('/image?', '/asset?')}">Download reference image</a></article>`).join('')}</div><label>Revision reason<input name="reason" required value="Revise reference roles"></label><button type="submit">Save reference revision</button></form>` : '<div class="empty"><strong>No references yet</strong><p>You can explore the brief now, or attach an image below. Missing references do not become invented brand rules.</p></div>'}<form id="add-reference" class="upload-row"><label>Image <small>PNG / JPEG / WebP · up to 8 MiB</small><input type="file" name="file" accept="image/png,image/jpeg,image/webp" required></label><label>Label<input name="label" required maxlength="100" placeholder="e.g. calm composition"></label><label>Role<select name="role">${['composition', 'typography', 'palette', 'material', 'imagery', 'form', 'avoid'].map((x) => option(x, x)).join('')}</select></label><label>Scope<select name="scope">${['landing-page', 'hero', 'services', 'proof', 'contact'].map((x) => option(x, x)).join('')}</select></label><button type="submit">Attach reference</button></form></section><section class="panel"><h2>Portable context</h2><p class="hint">Inspect metadata from an artifact. Missing pointers stay unresolved; inspection never mounts context.</p><form id="metadata"><label>Artifact metadata JSON<textarea name="metadata" rows="3" required></textarea></label><button type="submit">Inspect pointers</button></form><pre id="metadata-result" class="json-result"></pre></section>`;
}
const imageUrl = (r: VersionRef) =>
  '/api/v1/image?project=' +
  encodeURIComponent(state.project!.id) +
  '&id=' +
  encodeURIComponent(r.id) +
  '&version=' +
  r.version;
function preview(p: NodePacket<DesignArtifact<unknown>>) {
  if (
    ![
      'website-design',
      'website-image',
      'website-api-image',
      'website-reference',
      'website-direction',
    ].includes(p.payload.kind)
  )
    return `<pre>${e(JSON.stringify(p.payload.state, null, 2))}</pre>`;
  if (
    p.payload.kind === 'website-image' ||
    p.payload.kind === 'website-api-image' ||
    p.payload.kind === 'website-reference'
  )
    return `<div class="image-preview"><img alt="Returned image candidate" src="${imageUrl(ptr(p))}"></div>`;
  if (p.payload.kind === 'website-direction') {
    const s = p.payload.state as DirectionProposal;
    return `<div class="proposal-preview"><h3>${e(s.title)}</h3><p>${e(s.rationale)}</p><p><strong>Uncertainty</strong> ${e(s.uncertainty)}</p><ul>${s.unresolved.map((x) => `<li>${e(x)}</li>`).join('')}</ul><span class="badge unresolved">Reviewed proposal · no brand approval</span></div>`;
  }
  const s = p.payload.state as WebsiteDesignState;
  const space = s.metrics.find((x) => x.family === 'Spatial')?.relative ?? 0.5,
    style = s.metrics.find((x) => x.family === 'Styling')?.relative ?? 0.5,
    structure =
      s.metrics.find((x) => x.family === 'Structural')?.relative ?? 0.5;
  return `<div data-preview-palette="${e(JSON.stringify(s.parameters['palette'] ?? null))}" class="page-preview ${space > 0.65 ? 'airy' : space < 0.35 ? 'compact' : 'balanced'} ${style > 0.65 ? 'rounded' : style < 0.35 ? 'square' : 'soft'} ${structure > 0.5 ? 'strong' : 'quiet'}"><div class="preview-nav"><strong>Fieldwork</strong><span>Care for your home</span></div><section class="preview-hero"><span class="eyebrow">FICTIONAL HOME CARE</span><h3>Small tasks.<br>A calmer home.</h3><p>${e(s.intent)}</p><span class="preview-cta">Book a visit ↗</span><div class="preview-art" aria-hidden="true"><div class="shape one"></div><div class="shape two"></div><div class="shape three"></div></div></section><section class="preview-services"><small>01 / SERVICES</small><h4>Care that fits your day.</h4><div>${(Array.isArray(s.parameters['content']) ? s.parameters['content'] : ['Routine care', 'Seasonal checks', 'Small repairs']).map((x, i) => `<span><b>0${i + 1}</b>${e(x)}</span>`).join('')}</div></section><section class="preview-proof"><small>02 / PROOF</small><p>“A little care goes a long way.”</p><span>Synthetic testimonial · example only</span></section><section class="preview-contact"><small>03 / CONTACT</small><strong>Let's make room for better.</strong><span>Start a conversation ↗</span></section></div>`;
}
function explore() {
  const bundles = state.bundles ?? [];
  const b = bundles.find((x) => x.id === round) ?? bundles.at(-1);
  if (b) round = b.id;
  const candidates = b
    ? b.payload.candidates
        .map(find)
        .filter((x): x is NodePacket<DesignArtifact<unknown>> => !!x)
    : [];
  const selected = b?.payload.selection ? find(b.payload.selection) : undefined;
  return `<section class="explore-intro"><div><p class="eyebrow">BOUNDED EXPLORATION</p><h2>Find a direction worth pursuing.</h2><p>Nine coherent treatments of structure, space, styling and interaction intent.<br>Deterministic proposals, judged by you.</p></div><form id="explore"><label>Candidate count<select name="count">${[3, 6, 9].map((n) => option(String(n), String(n) + ' directions', n === 9)).join('')}</select></label><label>Starting point<select name="base">${option('none', 'Broad exploration')}${all()
    .filter((a) => a.payload.kind === 'website-design')
    .map((a) =>
      option(
        JSON.stringify(ptr(a)),
        a.payload.state
          ? (a.payload.state as WebsiteDesignState).thesis
          : 'Design',
      ),
    )
    .join(
      '',
    )}</select></label><button class="primary" type="submit">Explore directions</button></form></section>${!b ? '<div class="panel empty"><strong>Your design space is open.</strong><p>Explore a first round. Sparse context is welcome; unresolved inputs stay visible.</p></div>' : `<div class="round-bar"><label>Exploration round<select id="round">${bundles.map((x, i) => option(x.id, 'Round ' + (i + 1) + ' · input revision ' + x.payload.projectRef.version, x.id === b.id)).join('')}</select></label><span class="badge">${b.payload.projectRef.version === state.project!.version ? 'Current brief' : 'Historical brief · acceptance requires a new round'}</span><span>${candidates.length} proposals · ${b.payload.status}</span></div><div class="candidate-grid">${candidates.map((p, i) => `<article class="candidate ${match(b.payload.selection, ptr(p)) ? 'chosen' : ''}"><div class="candidate-head"><h3>Direction ${i + 1}</h3><label class="check"><input type="checkbox" data-compare="${encoded(ptr(p))}" ${compared.some((r) => match(r, ptr(p))) ? 'checked' : ''}> Compare</label></div>${preview(p)}<div class="candidate-foot"><div class="dimension-list">${(p.payload.state as WebsiteDesignState).metrics.map((m) => `<span>${e(m.family)}<b>${Math.round(m.relative * 100)}%</b></span>`).join('')}</div><small>Relative exploration controls · colors provisional without a palette</small>${button(match(b.payload.selection, ptr(p)) ? 'Selected direction' : 'Select direction', 'select', `data-bundle="${encoded(ptr(b))}" data-candidate="${encoded(ptr(p))}"`)}<span class="badge">Proposal · v${p.version}</span></div></article>`).join('')}</div>`}<section class="panel comparison"><div class="section-heading"><p class="eyebrow">SIDE BY SIDE</p><h2>Compare before committing</h2><p>Select up to two proposals. Saved comparisons remain in history.</p></div><div class="comparison-grid">${
    compared.length
      ? compared
          .map((r) => find(r))
          .filter((x): x is NodePacket<DesignArtifact<unknown>> => !!x)
          .map(
            (p) =>
              `<article><h3>${e(p.payload.kind === 'website-design' ? (p.payload.state as WebsiteDesignState).thesis : 'Image candidate')}</h3>${preview(p)}</article>`,
          )
          .join('')
      : '<div class="empty">Choose two candidates above to compare at the same scale.</div>'
  }</div><form id="comparison"><label>Comparison reason<input name="reason" required placeholder="What fits the brief, and what is still uncertain?"></label><button type="submit" ${!compared.length ? 'disabled' : ''}>Save comparison</button></form></section>${selected && b ? `<section class="accept-panel panel"><div><p class="eyebrow">EXPLICIT DECISION</p><h2>Selection is a starting point.</h2><p>Accept this exact design version with a reason. Earlier accepted work stays in history.</p></div><form id="accept-design" data-artifact="${encoded(ptr(selected))}" data-bundle="${encoded(ptr(b))}"><label>Acceptance reason<input name="reason" required placeholder="Why this direction fits the brief"></label><button class="primary" type="submit">Accept selected design</button></form></section>` : ''}<section class="panel"><h2>Reviewed native direction</h2><p class="hint">Import a reviewed JSON proposal containing title, rationale, constraints, uncertainty, unresolved, sourceReferences, reviewed: true and source. It stays a proposal.</p><form id="direction"><label>Proposal JSON<input type="file" name="file" accept="application/json,.json" required></label><button type="submit">Import reviewed proposal</button></form>${all()
    .filter((p) => p.payload.kind === 'website-direction')
    .map(preview)
    .join('')}</section>`;
}
function native() {
  const jobs = all().filter(
    (p) => p.payload.kind === 'website-native-job',
  ) as NodePacket<DesignArtifact<NativeJob>>[];
  const inputs = all().filter((p) =>
    ['website-design', 'website-image', 'website-api-image'].includes(
      p.payload.kind,
    ),
  );
  return `<section class="panel native-intro"><p class="eyebrow">MANUAL NATIVE HANDOFF</p><h2>Take the request. Bring back the result.</h2><p>Export a job-bound manifest, use your authorized ChatGPT or Codex host, then return an image to that original job. The native path is a manual handoff; this app does not call your host tool.</p><form id="native"><div class="two-col"><label>Original design or image<select name="artifact" required>${inputs.map((p) => option(JSON.stringify(ptr(p)), p.payload.kind === 'website-design' ? (p.payload.state as WebsiteDesignState).thesis : 'Image ' + p.id.slice(-8))).join('')}</select></label><label>Section scope<select name="scope">${['hero', 'services', 'proof', 'contact'].map((x) => option(x, x)).join('')}</select></label></div><label>Instructions<textarea name="instructions" required rows="3" placeholder="Describe the image to generate or the change to make."></textarea></label><label>Preserve <small>One requirement per line</small><textarea name="preservation" rows="2" placeholder="Keep the reference palette\nLeave space for the hero heading"></textarea></label><button class="primary" type="submit" ${!inputs.length ? 'disabled' : ''}>Create native request</button></form>${!inputs.length ? '<p class="hint">Explore a design first to give this request an original input.</p>' : ''}</section><div class="job-list">${
    jobs.length
      ? jobs
          .map((p) => {
            const j = p.payload.state;
            return `<section class="panel job"><div class="job-heading"><div><p class="eyebrow">${e(j.manifest.scope)} · ORIGINAL INPUT REVISION ${j.manifest.project.version}</p><h2>Request ${e(p.id.slice(-8))}</h2></div><span class="badge">${e(j.status)}</span></div><p>${e(j.manifest.instructions)}</p><p class="hint">Model, settings, seed, usage and provider ID: unknown. App job IDs are not provider IDs.</p><p class="hint">${j.manifest.references.length} scoped references · source ${e(j.manifest.artifact.id.slice(-8))} v${j.manifest.artifact.version}</p><div class="button-row">${button('Export request JSON', 'export', `data-job="${encoded(ptr(p))}"`)}${button('Abandon handoff', 'cancel', `data-job="${encoded(ptr(p))}" data-status="abandoned" ${['cancelled', 'abandoned'].includes(j.status) ? 'disabled' : ''}`)}${button('Cancel locally', 'cancel', `data-job="${encoded(ptr(p))}" data-status="cancelled" ${['cancelled', 'abandoned'].includes(j.status) ? 'disabled' : ''}`)}</div><form class="native-import" data-job="${encoded(ptr(p))}" data-project="${encoded(j.manifest.project)}" data-artifact="${encoded(j.manifest.artifact)}"><label>Returned image for this original request<input type="file" name="file" accept="image/png,image/jpeg,image/webp" required></label><button type="submit">Import as candidate</button></form><div class="outcomes">${j.outcomes.map((o) => `<p><span class="badge ${o.kind.includes('late') || o.kind === 'invalid' ? 'unresolved' : ''}">${e(o.kind)}</span> ${e(o.message)}</p>`).join('')}</div><div class="result-grid">${j.outputs
              .map(find)
              .filter((x): x is NodePacket<DesignArtifact<unknown>> => !!x)
              .map((a) => {
                const s = a.payload.state as ImageState;
                return `<article class="image-result">${preview(a)}<p>${s.image.width} × ${s.image.height} · ${e(s.outcome)}</p><small>SHA-256 ${e(s.image.checksum)}</small><a class="text-link" href="${imageUrl(ptr(a)).replace('/image?', '/asset?')}">Download original result</a><form class="accept-image" data-artifact="${encoded(ptr(a))}" data-scope="${e(a.payload.scope)}"><label>Acceptance reason<input name="reason" required></label><label class="check"><input type="checkbox" name="historical"> I reviewed the original, possibly historical inputs</label><button type="submit" ${['cancelled', 'abandoned'].includes(j.status) ? 'disabled' : ''}>Accept section image</button></form></article>`;
              })
              .join('')}</div></section>`;
          })
          .join('')
      : '<section class="panel empty"><strong>No native requests yet.</strong><p>Requests and returned images will keep their original inputs across restart.</p></section>'
  }</div>`;
}
function providerView() {
  const config = state.providers;
  const inputs = all().filter((a) =>
    ['website-design', 'website-image', 'website-api-image'].includes(
      a.payload.kind,
    ),
  );
  const images = inputs.filter((a) => a.payload.kind !== 'website-design');
  const jobs = all().filter(
    (a) => a.payload.kind === 'website-provider-job',
  ) as NodePacket<DesignArtifact<ProviderJob>>[];
  const comparison = all()
    .filter((a) => a.payload.kind === 'website-image-comparison')
    .at(-1);
  const c = comparison?.payload.state as
    | { compared: VersionRef[]; selected: VersionRef | null; reason: string }
    | undefined;
  const refs = state.references?.filter((r) => r.selected) ?? [];
  return `<section class="panel provider-config"><p class="eyebrow">OPTIONAL CLOUD CAPABILITIES</p><h2>Images & design assistant</h2>${config?.verificationMode === 'offline-transport-fixture' ? '<p class="badge unresolved">OFFLINE TRANSPORT FIXTURE · no provider called</p>' : ''}<p>Prepare a request, inspect its inputs, then explicitly submit. Manual native handoff stays available.</p><div class="two-col"><p><strong>Image model</strong><br>${e(config?.imageModel ?? 'Unconfigured')}</p><p><strong>Text / vision model</strong><br>${e(config?.assistantModel ?? 'Unconfigured')}</p></div><p class="badge ${config?.available ? '' : 'unresolved'}">${config?.configured ? 'Credential configured on server' : 'API credentials unconfigured'} · ${config?.authorized ? 'Run policy configured' : 'No approved run budget'} · account access unverified</p><p class="hint">${config?.budget ? `Run ${e(config.budget.runId)} · ${config.budget.callsUsed}/${config.budget.maxCalls} calls claimed · $${config.budget.reservedUSD.toFixed(2)} reserved of $${config.budget.capUSD.toFixed(2)} reservation cap. $${config.budget.reserveUSD.toFixed(2)} reserved per call. This approved call bound is an alternative to a guaranteed dollar maximum; actual billing is unknown.` : 'No chargeable submission is available until you configure credentials and an explicitly approved private run policy.'}</p>${config?.persistenceFailed ? '<p class="notice error">Provider history could not be committed. Stop and inspect the copied private runtime.</p>' : ''}<p class="hint">One PNG per image request. Editing uses the original image plus up to four chosen references. Generation uses text; choose no image references. Seed, CFG, masks and exact pixel preservation are unavailable in this recipe.</p>${button('Refresh provider outcomes', 'provider-refresh')}</section>
  <section class="panel"><h2>Prepare without sending</h2><form id="provider-prepare"><div class="two-col"><label>Operation<select name="operation">${option('generate', 'Generate section image')}${option('edit', 'Edit / refine section image')}${option('assistant', 'Text / vision direction proposal')}</select></label><label>Section<select name="scope">${['hero', 'services', 'proof', 'contact'].map((x) => option(x, x)).join('')}</select></label></div><label>Original design / image <small>Assistant uses the current brief instead</small><select name="artifact">${inputs.map((a) => option(JSON.stringify(ptr(a)), a.payload.kind + ' · ' + a.payload.scope + ' · ' + a.id.slice(-8))).join('')}</select></label><label>Instructions<textarea name="instructions" required rows="3" placeholder="Describe a section image, a refinement, or a direction to explore."></textarea></label><div class="two-col"><label>Image size<select name="size">${['1024x1024', '1536x1024', '1024x1536'].map((x) => option(x, x)).join('')}</select></label><label>Image quality<select name="quality">${['low', 'medium', 'high'].map((x) => option(x, x)).join('')}</select></label></div><p class="hint">Assistant: no tools, maximum 2,000 output tokens. These image controls apply only to image requests.</p><fieldset><legend>Chosen image references <small>Up to four; editing or assistant only</small></legend>${refs.map((r) => `<label class="check"><input type="checkbox" name="reference" value="${encoded(r.artifact)}">${e(r.label)} · ${e(r.role)} · ${e(r.scope)}</label>`).join('') || '<p class="hint">No selected references. Add them in Brief & references.</p>'}</fieldset><button type="submit">Save immutable request</button></form></section>
  <div class="job-list">${jobs
    .map((a) => {
      const j = a.payload.state,
        m = j.request;
      return `<section class="panel api-job" data-attempt="${e(a.id)}"><div class="job-heading"><h2>${e(m.operation)} · ${e(m.scope)}</h2><span class="badge ${j.status === 'outcome-uncertain' ? 'unresolved' : ''}">${e(j.status)}</span></div><p>${e(m.instructions)}</p><p class="hint">OpenAI API · requested ${e(m.model)} · recipe ${e(m.recipe)}<br>Brief v${m.project.version} · ${m.references.length} selected image references · input ${e(m.artifact?.id.slice(-8) ?? 'brief only')}<br>${m.operation === 'assistant' ? 'No tools; 2,000 output tokens maximum' : `${e(m.settings.size)} · ${e(m.settings.quality)} · one opaque PNG`}<br>App attempt ${e(a.id)} is separate from transport/result IDs.</p><details><summary>Inspect immutable request</summary><pre class="json-result">${e(JSON.stringify(m, null, 2))}</pre></details><div class="button-row">${button('Submit this API attempt', 'provider-submit', `data-job="${encoded(ptr(a))}" ${j.status !== 'queued' || !config?.available ? 'disabled' : ''}`, 'primary')}${button('Cancel API attempt locally', 'provider-cancel', `data-job="${encoded(ptr(a))}" ${!['queued', 'submitting', 'running', 'outcome-uncertain'].includes(j.status) ? 'disabled' : ''}`)}</div><p class="hint">Submission uses one reserved call. Local cancellation cannot promise remote cancellation or zero charge. No automatic retry.</p>${j.observations.map((o) => `<div class="outcome"><strong>${e(o.kind)}</strong><p>${e(o.message)}</p><small>Transport ${e(o.transportRequestId ?? 'unknown')} · result ${e(o.resultId ?? 'unknown')} · reported model ${e(o.reportedModel ?? 'unknown')} · actual cost unknown</small><pre class="json-result">${e(JSON.stringify({ usage: o.usage, reportedSettings: o.reportedSettings }, null, 2))}</pre></div>`).join('')}${j.outputs
        .map(find)
        .filter((a): a is NodePacket<DesignArtifact<unknown>> => !!a)
        .map((a) => {
          if (a.payload.kind === 'website-api-image') {
            const i = a.payload.state as ApiImage;
            return `<article class="image-result">${preview(a)}<p>API candidate · ${e(i.outcome)} · ${i.image.width} × ${i.image.height}</p><small>SHA-256 ${e(i.image.checksum)}</small><a class="text-link" href="${imageUrl(ptr(a)).replace('/image?', '/asset?')}">Download API original</a><form class="accept-image" data-artifact="${encoded(ptr(a))}" data-scope="${e(a.payload.scope)}"><label>Acceptance reason<input name="reason" required></label><label class="check"><input type="checkbox" name="historical"> I reviewed the original, possibly historical inputs</label><button type="submit" ${j.status !== 'returned' ? 'disabled' : ''}>Accept API section image</button></form></article>`;
          }
          const raw = a.payload.state as AssistantProposal,
            p = raw.proposal;
          return `<article class="assistant-proposal"><h3>${e(p.title)}</h3><span class="badge unresolved">Unreviewed assistant proposal · no brand approval</span><p class="hint">Brief v${raw.project.version} · ${raw.sourceReferences.length} pinned reference sources</p><form class="assistant-review" data-proposal="${encoded(ptr(a))}"><label>Proposal title<input name="title" required value="${e(p.title)}"></label><label>Rationale<textarea name="rationale" required rows="3">${e(p.rationale)}</textarea></label><label>Constraints<textarea name="constraints" rows="2">${e(p.constraints.join('\n'))}</textarea></label><label>Uncertainty<textarea name="uncertainty" required rows="2">${e(p.uncertainty)}</textarea></label><label>Unresolved choices<textarea name="unresolved" rows="2">${e(p.unresolved.join('\n'))}</textarea></label><label>Human review reason<input name="reason" required></label><button type="submit" ${j.status !== 'returned' ? 'disabled' : ''}>Record my edited review</button></form></article>`;
        })
        .join(
          '',
        )}<form class="provider-reconcile" data-job="${encoded(ptr(a))}"><label>Reconciliation evidence <small>Remote retrieval is unavailable here; check provider records independently</small><input name="reason" required placeholder="Evidence reference, time and conclusion"></label><label>Reservation decision<select name="disposition">${option('retain', 'Keep reservation; acknowledge reviewed outcome')}${option('release', 'Release only with verified no-charge evidence')}</select></label><label class="check"><input type="checkbox" name="verified"> I verified that this attempt incurred no charge</label><button type="submit" ${!['outcome-uncertain', 'cancelled-locally', 'failed', 'returned'].includes(j.status) ? 'disabled' : ''}>Record reconciliation</button></form></section>`;
    })
    .join('')}</div>
  <section class="panel comparison"><h2>Compare section images</h2><p>Choose native and API alternatives for the same section. Save a selection with a reason; acceptance stays separate.</p><form id="image-comparison"><div class="two-col">${['first', 'second'].map((k) => `<label>${k === 'first' ? 'First image' : 'Second image'}<select name="${k}" required>${images.map((a) => option(JSON.stringify(ptr(a)), (a.payload.kind === 'website-api-image' ? 'API' : 'Native') + ' · ' + a.payload.scope + ' · ' + a.id.slice(-8), match(c?.compared[k === 'first' ? 0 : 1], ptr(a)) || (!c && images[k === 'first' ? 0 : 1]?.id === a.id))).join('')}</select></label>`).join('')}</div><label>Selection<select name="selected">${option('none', 'Keep selection unresolved', !c?.selected)}${option('first', 'Select first image', !!c?.selected && match(c.selected, c.compared[0]!))}${option('second', 'Select second image', !!c?.selected && match(c.selected, c.compared[1]!))}</select></label><label>Comparison reason<input name="reason" required value="${e(c?.reason ?? '')}"></label><button type="submit" ${images.length < 2 ? 'disabled' : ''}>Save image comparison / selection</button></form>${
    c
      ? `<p>${e(c.reason)}</p><div class="comparison-grid">${c.compared
          .map(find)
          .filter((a): a is NodePacket<DesignArtifact<unknown>> => !!a)
          .map(
            (a) =>
              `<article><h3>${a.payload.kind === 'website-api-image' ? 'API' : 'Native'} · ${e(a.payload.scope)}</h3>${preview(a)}<span class="badge">${match(c.selected, ptr(a)) ? 'Selected · acceptance separate' : 'Alternative'}</span></article>`,
          )
          .join('')}</div>`
      : ''
  }</section>
  ${all()
    .filter((a) => a.payload.kind === 'website-assistant-review')
    .map((a) => {
      const r = a.payload.state as AssistantReview;
      return `<section class="panel"><h2>Human reviewed: ${e(r.proposal.title)}</h2><p>${e(r.proposal.rationale)}</p><p>Uncertainty: ${e(r.proposal.uncertainty)}</p><p class="hint">${e(r.reason)} · ${e(r.actor)}. Website proposal; VisualOS approval unchanged.</p></section>`;
    })
    .join('')}`;
}
function history() {
  const events = state.ledger?.events ?? [];
  return `<section class="panel"><p class="eyebrow">APPEND-ORIENTED HISTORY</p><h2>Every choice has a trail.</h2><p>Accepted pointers are separate from proposals and selections. Editing never erases an earlier decision.</p><div class="accepted-grid">${Object.entries(
    state.accepted ?? {},
  )
    .map(
      ([slot, r]) =>
        `<article><span class="eyebrow">${e(slot)}</span><strong>${r ? 'Accepted v' + r.version : 'No accepted work'}</strong>${r ? button('Inspect accepted version', 'inspect', `data-artifact="${encoded(r)}"`) : ''}</article>`,
    )
    .join('')}</div><div id="inspected"></div><ol class="timeline">${events
    .slice()
    .reverse()
    .map(
      (ev) =>
        `<li><span class="timeline-dot"></span><div><span class="badge">${e(ev.kind)}</span><strong>${e(ev.reason)}</strong><small>${e(new Date(ev.at).toLocaleString())} · ${e(ev.actor)}</small><small>${e(ev.subject.id)} · v${ev.subject.version} · #${ev.sequence}</small>${ev.kind === 'acceptance' ? button('View this accepted version', 'inspect', `data-artifact="${encoded(ev.subject)}"`) : ''}</div></li>`,
    )
    .join('')}</ol></section>`;
}
function render() {
  const active = document.activeElement as HTMLElement | null;
  const name = active?.getAttribute('name'),
    action = active?.dataset['action'],
    compare = active?.dataset['compare'];
  root.innerHTML = shell();
  bind();
  if (name)
    document
      .querySelector<HTMLElement>(`[name="${CSS.escape(name)}"]`)
      ?.focus();
  else if (compare)
    Array.from(document.querySelectorAll<HTMLInputElement>('[data-compare]'))
      .find((c) => c.dataset['compare'] === compare)
      ?.focus();
  else if (action)
    document
      .querySelector<HTMLElement>(`[data-action="${CSS.escape(action)}"]`)
      ?.focus();
}
function formData(f: HTMLFormElement) {
  const d = new FormData(f);
  return {
    d,
    s: (k: string) => String(d.get(k) ?? ''),
    lines: (k: string) =>
      String(d.get(k) ?? '')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
  };
}
async function fileBase64(d: FormData) {
  const f = d.get('file');
  if (!(f instanceof File) || f.size === 0) throw new Error('Choose a file');
  if (f.size > 8 * 1024 * 1024) throw new Error('File exceeds 8 MiB');
  const b = new Uint8Array(await f.arrayBuffer());
  let s = '';
  for (let i = 0; i < b.length; i += 8192)
    s += String.fromCharCode(...b.subarray(i, i + 8192));
  return btoa(s);
}
function onForm(
  selector: string,
  action: (f: HTMLFormElement) => Promise<void>,
) {
  for (const f of document.querySelectorAll<HTMLFormElement>(selector))
    f.addEventListener('submit', (ev) => {
      ev.preventDefault();
      void act(() => action(f));
    });
}
function bind() {
  for (const tab of document.querySelectorAll<HTMLButtonElement>('.tab'))
    tab.addEventListener('focus', () =>
      tab.scrollIntoView({ block: 'nearest', inline: 'nearest' }),
    );
  for (const preview of document.querySelectorAll<HTMLElement>(
    '[data-preview-palette]',
  )) {
    const palette = JSON.parse(preview.dataset['previewPalette']!);
    if (
      Array.isArray(palette) &&
      palette.length === 3 &&
      palette.every((c) => typeof c === 'string' && /^#[a-f0-9]{6}$/i.test(c))
    )
      ['--preview-primary', '--preview-background', '--preview-accent'].forEach(
        (k, i) => preview.style.setProperty(k, palette[i]),
      );
  }

  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-action]'))
    b.addEventListener('click', () => {
      void act(async () => {
        const a = b.dataset['action'];
        if (a === 'provider-refresh') await open(state.project!.id);
        if (a === 'provider-submit')
          await mutate(
            'provider/submit',
            { job: jsonRef(b.dataset['job']!) },
            'Attempt claimed. Refresh to inspect its outcome; no automatic retry.',
          );
        if (a === 'provider-cancel')
          await mutate(
            'provider/cancel',
            {
              job: jsonRef(b.dataset['job']!),
              reason: 'Operator cancelled locally',
            },
            'Local cancellation recorded; remote outcome/cost unknown.',
          );
        if (a === 'open') await open(b.dataset['id']!);
        if (a === 'home') {
          activate(await request('session'));
          render();
        }
        if (a === 'view') {
          view = b.dataset['view']!;
          render();
          document.querySelector<HTMLButtonElement>('.tab.active')?.focus();
        }
        if (a === 'select')
          await mutate(
            'select',
            {
              bundle: jsonRef(b.dataset['bundle']!),
              candidate: jsonRef(b.dataset['candidate']!),
              reason: 'Select closest deterministic direction',
            },
            'Direction selected; acceptance remains separate.',
          );
        if (a === 'cancel')
          await mutate(
            'cancel',
            {
              job: jsonRef(b.dataset['job']!),
              status: b.dataset['status'],
              reason:
                'Operator ' + b.dataset['status'] + ' original native handoff',
            },
            'Local closure recorded. Remote cancellation is unknown.',
          );
        if (a === 'export') {
          const r = jsonRef(b.dataset['job']!);
          const response = await fetch(
            '/api/v1/manifest?project=' +
              state.project!.id +
              '&id=' +
              r.id +
              '&version=' +
              r.version,
          );
          if (!response.ok) throw new Error('Request export failed');
          const manifest = await response.json();
          const blob = new Blob([JSON.stringify(manifest, null, 2)], {
              type: 'application/json',
            }),
            url = URL.createObjectURL(blob),
            anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = 'native-request-' + r.id + '.json';
          anchor.click();
          URL.revokeObjectURL(url);
          notify('Manifest exported. Attach the referenced images separately.');
        }
        if (a === 'inspect') {
          const r = jsonRef(b.dataset['artifact']!);
          const response = await fetch(
            '/api/v1/artifact?project=' +
              state.project!.id +
              '&id=' +
              r.id +
              '&version=' +
              r.version,
          );
          const result = (await response.json()) as NodePacket<
            DesignArtifact<unknown>
          > & { error?: string };
          if (!response.ok) throw new Error(result.error);
          document.querySelector('#inspected')!.innerHTML =
            `<article class="historical-preview"><h3>Immutable accepted version ${r.version}</h3>${preview(result)}<pre>${e(JSON.stringify(result.payload, null, 2))}</pre></article>`;
        }
      });
    });
  document
    .querySelector<HTMLSelectElement>('#round')
    ?.addEventListener('change', (ev) => {
      round = (ev.target as HTMLSelectElement).value;
      render();
    });
  for (const c of document.querySelectorAll<HTMLInputElement>('[data-compare]'))
    c.addEventListener('change', () => {
      const r = jsonRef(c.dataset['compare']!);
      if (c.checked) {
        if (compared.length === 2) {
          c.checked = false;
          notify('Compare at most two directions.', true);
          return;
        }
        compared.push(r);
      } else compared = compared.filter((x) => !match(x, r));
      render();
    });
  onForm('#create', async (f) => {
    const { s } = formData(f),
      mode = s('mode');
    activate(
      await request('projects', {
        title: s('title'),
        mode,
        visualOS:
          mode === 'branded' && s('visualOS') !== 'new'
            ? jsonRef(s('visualOS'))
            : null,
        palette:
          mode === 'branded' && s('visualOS') === 'new'
            ? [s('primary'), s('background'), s('accent')]
            : null,
      }),
    );
    view = 'brief';
    render();
    notify('Website workspace opened.');
  });
  onForm('#brief', async (f) => {
    const { d, s, lines } = formData(f);
    await mutate(
      'revise',
      {
        expectedProject: ptr(state.project!),
        brief: {
          intent: s('intent'),
          audience: s('audience'),
          offer: s('offer'),
          response: s('response'),
          content: lines('content'),
          exclusions: lines('exclusions'),
          commitments: lines('commitments'),
          unresolved: lines('unresolved'),
          palette: d.has('inheritPalette')
            ? null
            : s('palette')
                .split(',')
                .map((x) => x.trim()),
        },
        reason: s('reason'),
      },
      'New brief revision saved. Prior accepted work is retained.',
    );
  });
  onForm('#mount', async (f) => {
    const { s } = formData(f);
    await mutate(
      'mount',
      {
        expectedProject: ptr(state.project!),
        visualOS: jsonRef(s('visualOS')),
        reason: 'Explicitly mount saved VisualOS',
      },
      'VisualOS explicitly mounted.',
    );
  });
  onForm('#add-reference', async (f) => {
    const { d, s } = formData(f);
    await mutate(
      'reference',
      {
        expectedProject: ptr(state.project!),
        file: await fileBase64(d),
        label: s('label'),
        role: s('role'),
        scope: s('scope'),
      },
      'Scoped reference attached.',
    );
  });
  onForm('#references', async (f) => {
    const { d, s } = formData(f);
    await mutate(
      'revise',
      {
        expectedProject: ptr(state.project!),
        references: state.references!.map((r, i) => ({
          ...r,
          role: s('role-' + i),
          scope: s('scope-' + i),
          selected: d.has('selected-' + i),
        })),
        reason: s('reason'),
      },
      'Reference revision saved. Earlier comparisons and acceptance remain.',
    );
  });
  onForm('#metadata', async (f) => {
    const { s } = formData(f);
    const r = await request('metadata', JSON.parse(s('metadata')));
    document.querySelector('#metadata-result')!.textContent = JSON.stringify(
      r,
      null,
      2,
    );
    notify('Pointers inspected; no context mounted.');
  });
  onForm('#explore', async (f) => {
    const { s } = formData(f);
    await mutate(
      'explore',
      {
        expectedProject: ptr(state.project!),
        count: Number(s('count')),
        base: s('base') === 'none' ? null : jsonRef(s('base')),
      },
      'Deterministic proposals saved.',
    );
    round = state.bundles?.at(-1)?.id ?? '';
    render();
  });
  onForm('#comparison', async (f) => {
    const { s } = formData(f);
    await mutate(
      'revise',
      {
        expectedProject: ptr(state.project!),
        comparison: compared,
        reason: s('reason'),
      },
      'Comparison saved with its original versions.',
    );
  });
  onForm('#accept-design', async (f) => {
    const { s } = formData(f);
    await mutate(
      'accept',
      {
        artifact: jsonRef(f.dataset['artifact']!),
        bundle: jsonRef(f.dataset['bundle']!),
        expected: state.accepted?.['design'] ?? null,
        reason: s('reason'),
        slot: 'design',
        allowHistorical: false,
      },
      'Exact design version accepted locally.',
    );
  });
  onForm('#provider-prepare', async (f) => {
    const { s, d } = formData(f);
    await mutate(
      'provider/prepare',
      {
        expectedProject: ptr(state.project!),
        artifact:
          s('operation') === 'assistant' ? null : jsonRef(s('artifact')),
        scope: s('scope'),
        operation: s('operation'),
        instructions: s('instructions'),
        size: s('size'),
        quality: s('quality'),
        references: d.getAll('reference').map((x) => jsonRef(String(x))),
      },
      'Request saved. Inspect it before an explicit API submission.',
    );
  });
  onForm('.assistant-review', async (f) => {
    const { s, lines } = formData(f);
    await mutate(
      'provider/review',
      {
        expectedProject: ptr(state.project!),
        proposal: jsonRef(f.dataset['proposal']!),
        edited: {
          title: s('title'),
          rationale: s('rationale'),
          constraints: lines('constraints'),
          uncertainty: s('uncertainty'),
          unresolved: lines('unresolved'),
        },
        reason: s('reason'),
      },
      'Human edited review recorded; no brand approval or acceptance changed.',
    );
  });
  onForm('#image-comparison', async (f) => {
    const { s } = formData(f),
      first = jsonRef(s('first')),
      second = jsonRef(s('second'));
    await mutate(
      'provider/compare',
      {
        compared: [first, second],
        selected:
          s('selected') === 'none'
            ? null
            : s('selected') === 'first'
              ? first
              : second,
        reason: s('reason'),
      },
      'Image comparison and selection saved; acceptance remains separate.',
    );
  });
  onForm('.provider-reconcile', async (f) => {
    const { s, d } = formData(f);
    await mutate(
      'provider/reconcile',
      {
        job: jsonRef(f.dataset['job']!),
        reason: s('reason'),
        verifiedNoCharge: s('disposition') === 'release' && d.has('verified'),
        acknowledgeUncertain: s('disposition') === 'retain',
      },
      'Operator reconciliation recorded. Reservation and original history remain inspectable.',
    );
  });
  onForm('#native', async (f) => {
    const { s, lines } = formData(f);
    await mutate(
      'native',
      {
        expectedProject: ptr(state.project!),
        artifact: jsonRef(s('artifact')),
        scope: s('scope'),
        instructions: s('instructions'),
        preservation: lines('preservation'),
      },
      'Original request and input binding saved.',
    );
  });
  onForm('.native-import', async (f) => {
    const { d } = formData(f);
    await mutate(
      'import',
      {
        job: jsonRef(f.dataset['job']!),
        manifestProject: jsonRef(f.dataset['project']!),
        originalArtifact: jsonRef(f.dataset['artifact']!),
        file: await fileBase64(d),
      },
      'Return retained as a candidate; no acceptance changed.',
    );
  });
  onForm('.accept-image', async (f) => {
    const { d, s } = formData(f);
    await mutate(
      'accept',
      {
        artifact: jsonRef(f.dataset['artifact']!),
        bundle: null,
        expected: state.accepted?.[f.dataset['scope']!] ?? null,
        reason: s('reason'),
        slot: f.dataset['scope'],
        allowHistorical: d.has('historical'),
      },
      'Section image explicitly accepted.',
    );
  });
  onForm('#direction', async (f) => {
    const { d } = formData(f),
      file = d.get('file');
    if (!(file instanceof File) || file.size > 64 * 1024)
      throw new Error('Choose a JSON proposal under 64 KiB');
    await mutate(
      'direction',
      {
        expectedProject: ptr(state.project!),
        proposal: JSON.parse(await file.text()),
      },
      'Reviewed direction retained as a proposal.',
    );
  });
}
void act(async () => {
  activate(await request('session'));
  render();
});
