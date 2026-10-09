import { randomUUID, createHash } from 'node:crypto';
import type {
  NodePacket,
  DesignArtifact,
  ModuleProject,
  VersionRef,
} from '../kernel/contracts.ts';
import type { KernelStore } from '../kernel/store.ts';
import {
  canonical,
  digest,
  packet,
  reference,
  revise,
} from '../kernel/packets.ts';
import type { WebsiteDesignState } from '../modules/website/design.ts';
import type {
  CompositionState,
  CompositionContent,
  CompositionComparison,
  PageBlock,
  SectionId,
} from '../modules/website/composition.ts';
import {
  effectiveStyle,
  sectionIds,
  renderComposition,
  imagePath,
} from '../modules/website/composition.ts';
import { parseContent } from '../modules/website/composition-contracts.ts';
import type { ImageState } from '../modules/website/workspace-contracts.ts';
import type { Assets } from './assets.ts';
import type { Workspace } from './workspace.ts';
import { record, ref, string, list, InputError } from './validation.ts';
import { tar } from './handoff.ts';
import {
  rendererDefaults,
  reconstructionInstructions,
} from '../modules/website/composition-layout.ts';
const same = (a: VersionRef | null, b: VersionRef | null) =>
  a?.id === b?.id && a?.version === b?.version;
export function reviewSignature(s: CompositionState, id: SectionId): string {
  const section = s.content.sections.find((x) => x.id === id)!;
  return digest({
    project: s.project,
    direction: s.direction,
    context: s.context,
    order: s.content.sections.map((x) => x.id),
    title: s.content.title,
    description: s.content.description,
    unresolved: s.content.unresolved,
    section,
    effectiveStyle: effectiveStyle(s.content.style, section),
  });
}
export const reviewNeeded = (s: CompositionState) =>
  sectionIds.filter(
    (id) => s.reviews[id]?.signature !== reviewSignature(s, id),
  );
/** Relational validation is also used by ordinary workspace reads, not only composition commands. */
export function validateCompositionLinks(
  p: NodePacket<DesignArtifact<unknown>>,
  kernel: KernelStore,
  assets: Assets,
): void {
  const known = <T>(
    r: VersionRef,
    kind: string | null,
    type = 'design-artifact',
  ) => {
    const a = kernel.get<T>(r);
    if (
      r.freshness !== 'pinned' ||
      a.projectId !== p.projectId ||
      a.type !== type ||
      (kind && (a.payload as DesignArtifact<unknown>).kind !== kind)
    )
      throw new InputError('Composition owner/type/version mismatch');
    return a;
  };
  if (p.payload.kind === 'website-composition-comparison') {
    const s = p.payload.state as CompositionComparison;
    for (const r of s.compared) known(r, 'website-composition');
    if (canonical(p.dependencies) !== canonical(s.compared))
      throw new InputError('Comparison dependency mismatch');
    return;
  }
  if (p.payload.kind !== 'website-composition') return;
  const s = p.payload.state as CompositionState;
  const project = known<ModuleProject>(s.project, null, 'module-project');
  const direction = known<DesignArtifact<WebsiteDesignState>>(
    s.direction,
    'website-design',
  );
  if (
    canonical(s.context) !== canonical(project.payload.resolvedContext) ||
    canonical(s.directionState) !== canonical(direction.payload.state) ||
    canonical(s.lockedValues) !== canonical(direction.payload.lockedValues)
  )
    throw new InputError('Composition pinned context/direction mismatch');
  const links: VersionRef[] = [s.project, s.direction],
    files: { id: string; checksum: string }[] = [];
  for (const section of s.content.sections)
    for (const b of section.blocks)
      if (b.asset) {
        const a = known<DesignArtifact<ImageState>>(b.asset, null);
        if (
          ![
            'website-image',
            'website-api-image',
            'website-region-image',
          ].includes(a.payload.kind) ||
          !['landing-page', section.id].includes(a.payload.scope) ||
          canonical(a.payload.state.image) !== canonical(b.image)
        )
          throw new InputError(
            'Placed image ownership/scope/descriptor mismatch',
          );
        if (!assets.exists(b.image!.id, b.image!.checksum))
          throw new InputError('Placed image unavailable or corrupt');
        links.push(b.asset);
        files.push({ id: b.image!.id, checksum: b.image!.checksum });
      }
  if (
    canonical(p.dependencies) !== canonical(links) ||
    canonical(p.assets) !== canonical(files)
  )
    throw new InputError('Composition asset/dependency inventory mismatch');
  const blocks = s.content.sections.flatMap((section) => section.blocks);
  const intent = direction.payload.lockedValues['intent'];
  const requiredContent = direction.payload.lockedValues['content'];
  if (typeof intent === 'string' && !blocks.some((b) => b.text === intent))
    throw new InputError(
      'Locked intent must remain an explicit text block; change context/direction first',
    );
  if (
    Array.isArray(requiredContent) &&
    !requiredContent.every(
      (item) =>
        typeof item === 'string' &&
        blocks.some((b) => b.text === item || b.items.includes(item)),
    )
  )
    throw new InputError(
      'Locked content items must remain visible; change context/direction first',
    );
  const palette = direction.payload.lockedValues['palette'];
  if (Array.isArray(palette))
    for (const section of s.content.sections) {
      const st = effectiveStyle(s.content.style, section);
      for (const key of [
        'background',
        'foreground',
        'accent',
        'actionText',
      ] as const)
        if (
          !palette.some(
            (x) => typeof x === 'string' && x.toLowerCase() === st[key],
          )
        )
          throw new InputError(
            'Locked palette requires a new explicit direction/context decision',
          );
    }
  for (const [key, v] of Object.entries(s.reviews))
    if (v.signature !== reviewSignature(s, key as SectionId))
      throw new InputError('Invalid or stale section review');
}
export class Compositions {
  workspace: Workspace;
  constructor(workspace: Workspace) {
    this.workspace = workspace;
  }
  read(
    pid: string,
    r: VersionRef,
  ): NodePacket<DesignArtifact<CompositionState>> {
    const a = this.workspace.read(pid, r) as NodePacket<
      DesignArtifact<CompositionState>
    >;
    if (a.payload.kind !== 'website-composition')
      throw new InputError('Choose a composition revision');
    return a;
  }
  private current(pid: string, r: VersionRef, project: VersionRef) {
    this.workspace.project(pid, project);
    if (this.workspace.kernel.currentVersion(r.id) !== r.version)
      throw new InputError(
        'Composition changed; reload before saving or accepting',
        409,
      );
  }
  private direction(pid: string, r: VersionRef, p: NodePacket<ModuleProject>) {
    const a = this.workspace.read(pid, r) as NodePacket<
      DesignArtifact<WebsiteDesignState>
    >;
    if (
      a.payload.kind !== 'website-design' ||
      a.payload.scope !== 'landing-page' ||
      !a.dependencies.some((x) => same(x, reference(p)))
    )
      throw new InputError(
        'Choose a Website direction from the current brief',
        409,
      );
    return a;
  }
  private build(
    old: NodePacket<DesignArtifact<CompositionState>> | null,
    pid: string,
    s: CompositionState,
    reason: string,
  ) {
    const deps = [s.project, s.direction],
      assets: { id: string; checksum: string }[] = [];
    for (const section of s.content.sections)
      for (const b of section.blocks)
        if (b.asset) {
          deps.push(b.asset);
          assets.push({ id: b.image!.id, checksum: b.image!.checksum });
        }
    const payload: DesignArtifact<CompositionState> = {
      moduleId: 'website',
      kind: 'website-composition',
      scope: 'landing-page',
      lockedValues: {},
      state: s,
    };
    const initial = old
      ? revise(old, payload, 'local-operator', reason)
      : packet({
          type: 'design-artifact',
          id: 'composition-' + randomUUID(),
          projectId: pid,
          payload,
          provenance: {
            actor: 'local-operator',
            source: reason,
            previous: null,
          },
        });
    const { integrity: _, ...body } = initial;
    const next = packet({ ...body, dependencies: deps, assets });
    validateCompositionLinks(
      next as NodePacket<DesignArtifact<unknown>>,
      this.workspace.kernel,
      this.workspace.assets,
    );
    return next;
  }
  start(pid: string, input: unknown) {
    const r = record(input, ['expectedProject', 'direction', 'reason']);
    const p = this.workspace.project(pid, r['expectedProject']),
      d = this.direction(pid, ref(r['direction']), p);
    const metric = (key: string) =>
      d.payload.state.metrics.find((x) => x.key === key)?.relative ?? 0.5;
    const palette = d.payload.state.parameters['palette'];
    const colors =
      Array.isArray(palette) && palette.every((x) => typeof x === 'string')
        ? (palette as string[])
        : ['#173f45', '#f3ede0', '#de8159'];
    // Pick a readable pair from the locked palette; no invented approved brand values.
    const base = {
      background: colors[1]!,
      foreground: colors[0]!,
      accent: colors[0]!,
      actionText: colors[1]!,
      font: 'system' as const,
      bodySize: 18,
      headingSize: metric('hierarchy') > 0.5 ? 64 : 48,
      spacing:
        metric('whitespace') > 0.65
          ? 96
          : metric('whitespace') < 0.35
            ? 40
            : 64,
      radius:
        metric('edge-expression') > 0.65
          ? 24
          : metric('edge-expression') < 0.35
            ? 0
            : 8,
      maxWidth: 1120,
    };
    const block = (
      id: string,
      kind: PageBlock['kind'],
      text: string,
      extra: Partial<PageBlock> = {},
    ): PageBlock => ({
      id,
      kind,
      text,
      href: '',
      items: [],
      asset: null,
      image: null,
      alt: '',
      unresolved: '',
      ...extra,
    });
    const content: CompositionContent = {
      title: 'Fieldwork',
      description: 'Fictional home-care service landing page.',
      style: base,
      unresolved: [
        'Synthetic example content; no real service, testimonial or contact approval.',
      ],
      sections: [
        {
          id: 'hero',
          recipe: 'split',
          align: 'left',
          fit: 'cover',
          overrides: {},
          blocks: [
            block('hero-heading', 'heading', 'Small tasks. A calmer home.'),
            block('hero-copy', 'paragraph', d.payload.state.intent),
            block('hero-action', 'button', 'Book a visit', {
              href: '#contact',
            }),
            block('hero-image', 'image', '', {
              unresolved: 'Choose an existing owned image deliberately.',
            }),
          ],
        },
        {
          id: 'services',
          recipe: 'cards',
          align: 'left',
          fit: 'cover',
          overrides: {},
          blocks: [
            block('services-heading', 'heading', 'Care that fits your day.'),
            block('services-list', 'list', '', {
              items: Array.isArray(d.payload.state.parameters['content'])
                ? d.payload.state.parameters['content'].map(String)
                : ['Routine care', 'Seasonal checks', 'Small repairs'],
            }),
          ],
        },
        {
          id: 'proof',
          recipe: 'band',
          align: 'left',
          fit: 'cover',
          overrides: {},
          blocks: [
            block('proof-heading', 'heading', 'A little care goes a long way.'),
            block(
              'proof-copy',
              'paragraph',
              'Synthetic testimonial · example only',
            ),
          ],
        },
        {
          id: 'contact',
          recipe: 'stack',
          align: 'left',
          fit: 'cover',
          overrides: {
            background: colors[0]!,
            foreground: colors[1]!,
            accent: colors[1]!,
            actionText: colors[0]!,
          },
          blocks: [
            block('contact-heading', 'heading', 'Let’s make room for better.'),
            block(
              'contact-copy',
              'paragraph',
              'Contact details unresolved. This example has no live booking service.',
            ),
            block('contact-action', 'button', 'Back to our services', {
              href: '#services',
            }),
          ],
        },
      ],
    };
    const s: CompositionState = {
      contractVersion: 1,
      project: reference(p),
      direction: reference(d),
      directionState: d.payload.state,
      lockedValues: d.payload.lockedValues,
      context: p.payload.resolvedContext,
      content: parseContent(content),
      reviews: {},
    };
    this.workspace.kernel.putMany(
      [this.build(null, pid, s, string(r['reason'], 500))],
      () => this.workspace.project(pid, reference(p)),
    );
    return this.workspace.state(pid);
  }
  async save(pid: string, input: unknown) {
    const r = record(input, [
      'expectedProject',
      'expected',
      'direction',
      'content',
      'reason',
    ]);
    const expected = ref(r['expected']),
      project = ref(r['expectedProject']);
    this.current(pid, expected, project);
    const old = this.read(pid, expected),
      p = this.workspace.project(pid, project),
      d = this.direction(pid, ref(r['direction']), p),
      content = parseContent(r['content']);
    for (const section of content.sections)
      for (const b of section.blocks)
        if (b.asset) {
          const a = this.workspace.read(pid, b.asset) as NodePacket<
            DesignArtifact<ImageState>
          >;
          if (
            ![
              'website-image',
              'website-api-image',
              'website-region-image',
            ].includes(a.payload.kind) ||
            !['landing-page', section.id].includes(a.payload.scope)
          )
            throw new InputError('Choose an owned image in this section scope');
          const { info } = await this.workspace.originalImage(pid, b.asset);
          if (canonical(info) !== canonical(b.image))
            throw new InputError('Pinned image descriptor mismatch');
        }
    const s: CompositionState = {
      ...old.payload.state,
      project: reference(p),
      direction: reference(d),
      directionState: d.payload.state,
      lockedValues: d.payload.lockedValues,
      context: p.payload.resolvedContext,
      content,
      reviews: {},
    };
    for (const id of sectionIds) {
      const review = old.payload.state.reviews[id];
      if (review?.signature === reviewSignature(s, id)) s.reviews[id] = review;
    }
    const next = this.build(old, pid, s, string(r['reason'], 500));
    this.workspace.kernel.putMany([next], () =>
      this.current(pid, expected, project),
    );
    return this.workspace.state(pid);
  }
  async review(pid: string, input: unknown) {
    const r = record(input, [
      'expectedProject',
      'expected',
      'sections',
      'reason',
    ]);
    const expected = ref(r['expected']),
      project = ref(r['expectedProject']);
    this.current(pid, expected, project);
    const old = this.read(pid, expected);
    if (!same(project, old.payload.state.project))
      throw new InputError(
        'Rebase the draft to current context before review',
        409,
      );
    // Decode all placed files before recording technical review; metadata alone is insufficient.
    for (const sec of old.payload.state.content.sections)
      for (const b of sec.blocks)
        if (b.asset) await this.workspace.originalImage(pid, b.asset);
    const reason = string(r['reason'], 500),
      s = structuredClone(old.payload.state);
    const sections = list(
      r['sections'],
      (x) => {
        if (!sectionIds.includes(x as SectionId))
          throw new InputError('Unknown section');
        return x as SectionId;
      },
      4,
    );
    if (!sections.length) throw new InputError('Choose sections to review');
    for (const id of sections)
      s.reviews[id] = { signature: reviewSignature(s, id), reason };
    const next = this.build(old, pid, s, reason);
    this.workspace.kernel.putMany([next], () =>
      this.current(pid, expected, project),
    );
    return this.workspace.state(pid);
  }
  compare(pid: string, input: unknown) {
    const r = record(input, ['compared', 'selected', 'reason']);
    this.workspace.project(pid);
    const compared = list(r['compared'], ref, 3);
    for (const a of compared) this.read(pid, a);
    const state: CompositionComparison = {
      compared,
      selected: r['selected'] === null ? null : ref(r['selected']),
      reason: string(r['reason'], 500),
    };
    const next = packet({
      type: 'design-artifact',
      id: 'composition-comparison-' + randomUUID(),
      projectId: pid,
      dependencies: compared,
      payload: {
        moduleId: 'website',
        kind: 'website-composition-comparison',
        scope: 'landing-page',
        lockedValues: {},
        state,
      },
      provenance: {
        actor: 'local-operator',
        source: state.reason,
        previous: null,
      },
    });
    validateCompositionLinks(
      next as NodePacket<DesignArtifact<unknown>>,
      this.workspace.kernel,
      this.workspace.assets,
    );
    this.workspace.kernel.put(next);
    return this.workspace.state(pid);
  }
  async accept(pid: string, input: unknown) {
    const r = record(input, [
      'expectedProject',
      'artifact',
      'expected',
      'reason',
    ]);
    const ptr = ref(r['artifact']),
      project = ref(r['expectedProject']);
    this.current(pid, ptr, project);
    const a = this.read(pid, ptr),
      s = a.payload.state;
    this.direction(pid, s.direction, this.workspace.project(pid, project));
    if (!same(s.project, project) || reviewNeeded(s).length)
      throw new InputError(
        'Review all affected sections in the current context before acceptance',
        409,
      );
    for (const sec of s.content.sections)
      for (const b of sec.blocks)
        if (b.asset) await this.workspace.originalImage(pid, b.asset);
    const expected = r['expected'] === null ? null : ref(r['expected']);
    if (!same(this.workspace.kernel.selected(pid, 'composition'), expected))
      throw new InputError('Accepted composition changed; reload', 409);
    this.workspace.kernel.accept(
      pid,
      'composition',
      ptr,
      expected,
      'local-operator',
      string(r['reason'], 500),
      null,
      () => {
        this.current(pid, ptr, project);
        if (!same(this.workspace.kernel.selected(pid, 'composition'), expected))
          throw new InputError('Accepted composition changed', 409);
        this.read(pid, ptr);
      },
    );
    return this.workspace.state(pid);
  }
  async preview(pid: string, r: VersionRef) {
    const a = this.read(pid, r);
    for (const s of a.payload.state.content.sections)
      for (const b of s.blocks)
        if (b.asset) await this.workspace.originalImage(pid, b.asset);
    return renderComposition(
      a.payload.state,
      (b) =>
        `/api/v1/asset?project=${encodeURIComponent(pid)}&id=${encodeURIComponent(b.asset!.id)}&version=${b.asset!.version}`,
    );
  }
  async export(pid: string, r: VersionRef) {
    const a = this.read(pid, r),
      s = a.payload.state;
    const acceptance = this.workspace.kernel
      .ledger(pid)
      .events.find((e) => e.kind === 'acceptance' && same(e.subject, r));
    if (!acceptance)
      throw new InputError(
        'Export requires explicit acceptance of this exact composition',
      );
    const files = new Map<string, Buffer>(),
      inventory: unknown[] = [];
    for (const sec of s.content.sections)
      for (const b of sec.blocks)
        if (b.asset) {
          const { bytes, info } = await this.workspace.originalImage(
            pid,
            b.asset,
          );
          files.set(imagePath(info), bytes);
          inventory.push({
            section: sec.id,
            block: b.id,
            artifact: b.asset,
            path: imagePath(info),
            ...info,
            alt: b.alt,
            unresolved: b.unresolved,
            approval:
              'placed in explicitly accepted composition; no brand approval implied',
          });
        }
    const unresolved = [
      ...s.content.unresolved,
      ...s.directionState.unresolved,
      ...Object.entries(s.context.fields)
        .filter(([, f]) => !f.effective || f.reviewRequired)
        .map(([key]) => 'Context review/unresolved: ' + key),
      ...s.content.sections.flatMap((sec) =>
        sec.blocks
          .filter((b) => b.unresolved)
          .map((b) => `${sec.id}/${b.id}: ${b.unresolved}`),
      ),
    ];
    // Deliberate context projection: retain design values/origins, omit private reference labels/pointers and comparison bookkeeping.
    const context = {
      ...s.context,
      fields: Object.fromEntries(
        Object.entries(s.context.fields).filter(
          ([key]) => !['references', 'comparison'].includes(key),
        ),
      ),
    };
    const direction = {
      ...s.directionState,
      parameters: Object.fromEntries(
        Object.entries(s.directionState.parameters).filter(
          ([key]) => !['references', 'comparison'].includes(key),
        ),
      ),
    };
    const manifest = {
      schema: 'bve.website-handoff',
      version: 1,
      rendererDefaults,
      composition: r,
      compositionIntegrity: a.integrity,
      project: s.project,
      direction: s.direction,
      directionState: direction,
      lockedValues: s.lockedValues,
      context,
      content: s.content,
      reviews: s.reviews,
      acceptance: {
        actor: acceptance.actor,
        reason: acceptance.reason,
        at: acceptance.at,
        sequence: acceptance.sequence,
      },
      provenance: {
        actor: a.provenance.actor,
        reason: a.provenance.source,
        previous: a.provenance.previous,
      },
      assets: inventory,
      unresolved,
      assessment: 'AI technical assessment; no designer approval',
      recipes: {
        breakpoint: 760,
        narrowColumns: 1,
        sectionOrder: s.content.sections.map((x) => x.id),
        limits:
          'Four bounded sections; heading/paragraph/button/list/image blocks. No canvas, CMS, publishing or booking backend.',
      },
    };
    files.set(
      'manifest.json',
      Buffer.from(JSON.stringify(manifest, null, 2) + '\n'),
    );
    files.set(
      'index.html',
      Buffer.from(renderComposition(s, (b) => imagePath(b.image!))),
    );
    files.set('RECONSTRUCT.md', Buffer.from(reconstructionInstructions));
    const bytes = tar(files);
    return {
      bytes,
      checksum: createHash('sha256').update(bytes).digest('hex'),
      manifest,
    };
  }
}
