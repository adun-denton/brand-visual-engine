import { aiOutputSchema } from '../modules/website/ai-schema.ts';
import { randomUUID } from 'node:crypto';
import type {
  DesignArtifact,
  NodePacket,
  ModuleProject,
  IterationBundle,
  VersionRef,
  Value,
} from '../kernel/contracts.ts';
import { packet, reference, revise, canonical } from '../kernel/packets.ts';
import { effectiveValues } from '../kernel/context.ts';
import type { WebsiteDesignState } from '../modules/website/design.ts';
import type {
  DirectionRequest,
  DirectionEvidence,
  ProjectAsset,
  AISpec,
} from '../modules/website/ai-contracts.ts';
import {
  parseResponse,
  parseSpec,
  validateAILocks,
} from '../modules/website/ai-contracts.ts';
import type {
  CompositionState,
  SectionId,
} from '../modules/website/composition.ts';
import {
  renderComposition,
  sectionIds,
} from '../modules/website/composition.ts';
import { parseContent } from '../modules/website/composition-contracts.ts';
import type { Workspace } from './workspace.ts';
import type { KernelStore } from '../kernel/store.ts';
import type { ImageInfo, Assets } from './assets.ts';
import { decode } from './assets.ts';
import {
  record,
  string,
  list,
  ref,
  integer,
  choice,
  InputError,
} from './validation.ts';
import type { ImageState } from '../modules/website/workspace-contracts.ts';
import type { ProviderJob } from '../modules/website/provider-contracts.ts';

const same = (a: VersionRef, b: VersionRef) =>
  a.id === b.id && a.version === b.version;
const jsonValue = (x: unknown) => x as Value;
function make<T>(
  pid: string,
  kind: string,
  state: T,
  deps: VersionRef[],
  files: ImageInfo[] = [],
) {
  return packet<DesignArtifact<T>>({
    type: 'design-artifact',
    id: kind + '-' + randomUUID(),
    projectId: pid,
    dependencies: deps,
    assets: files.map((x) => ({ id: x.id, checksum: x.checksum })),
    payload: {
      moduleId: 'website',
      kind,
      scope: 'landing-page',
      lockedValues: {},
      state,
    },
    provenance: {
      actor: 'local-operator',
      source: 'Explicit AI/asset workflow; acceptance separate',
      previous: null,
    },
  });
}
export function validateAILinks(
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
      throw new InputError('AI/asset owner/type/version mismatch');
    return a;
  };
  if (p.payload.kind === 'website-ai-request') {
    const s = p.payload.state as DirectionRequest;
    const proj = known<ModuleProject>(s.project, null, 'module-project');
    const rs = (proj.payload.localContext['references']?.override ??
      []) as unknown as { artifact: VersionRef; selected: boolean }[];
    for (const r of s.references) {
      known(r, 'website-reference');
      if (!rs.some((x) => x.selected && same(x.artifact, r)))
        throw new InputError(
          'Direction request reference was not deliberately selected',
        );
    }
    if (s.base) known(s.base, 'website-design');
    if (s.output) known(s.output, 'website-ai-evidence');
    const deps = [
      s.project,
      ...(s.base ? [s.base] : []),
      ...s.references,
      ...(s.output ? [s.output] : []),
    ];
    if (canonical(p.dependencies) !== canonical(deps))
      throw new InputError('Direction request dependency mismatch');
  } else if (p.payload.kind === 'website-ai-evidence') {
    const s = p.payload.state as DirectionEvidence;
    const req = known<DesignArtifact<DirectionRequest>>(
      s.request,
      'website-ai-request',
    );
    if (s.response.candidates.length !== req.payload.state.count)
      throw new InputError('AI candidate count does not match request');
    for (const c of s.response.candidates)
      for (const n of c.imageNeeds)
        for (const r of n.references)
          if (!req.payload.state.references.some((x) => same(x, r)))
            throw new InputError('AI invented an included reference');
    if (s.providerJob) {
      const j = known<DesignArtifact<ProviderJob>>(
        s.providerJob,
        'website-provider-job',
      );
      if (
        !j.payload.state.request.directionRequest ||
        !same(j.payload.state.request.directionRequest, s.request) ||
        j.payload.state.request.operation !== 'directions'
      )
        throw new InputError('AI provider evidence request mismatch');
    }
    if (
      canonical(p.dependencies) !==
      canonical([s.request, ...(s.providerJob ? [s.providerJob] : [])])
    )
      throw new InputError('AI evidence dependencies mismatch');
  } else if (p.payload.kind === 'website-asset') {
    const s = p.payload.state as ProjectAsset;
    if (s.origin) {
      const a = known<DesignArtifact<ImageState>>(s.origin, null);
      if (
        ![
          'website-reference',
          'website-image',
          'website-api-image',
          'website-region-image',
        ].includes(a.payload.kind) ||
        canonical(a.payload.state.image) !== canonical(s.image)
      )
        throw new InputError('Asset original provenance mismatch');
    }
    if (
      canonical(p.dependencies) !== canonical(s.origin ? [s.origin] : []) ||
      canonical(p.assets) !==
        canonical([{ id: s.image.id, checksum: s.image.checksum }])
    )
      throw new InputError('Asset dependency/inventory mismatch');
    if (!assets.exists(s.image.id, s.image.checksum))
      throw new InputError('Asset unavailable or corrupt');
  } else if (
    p.payload.kind === 'website-design' &&
    (p.payload.state as WebsiteDesignState).parameters['ai']
  ) {
    const d = p.payload.state as WebsiteDesignState,
      s = parseSpec(d.parameters['ai']);
    known(s.request, 'website-ai-request');
    const evidence = known<DesignArtifact<DirectionEvidence>>(
      s.evidence,
      'website-ai-evidence',
    );
    if (
      !same(evidence.payload.state.request, s.request) ||
      !p.dependencies.some((x) => same(x, s.evidence)) ||
      !p.dependencies.some((x) => same(x, s.request))
    )
      throw new InputError('Direction evidence binding mismatch');
    const authored = evidence.payload.state.response.candidates.find(
      (c) =>
        c.title === d.thesis &&
        canonical(c.constraints) === canonical(s.constraints) &&
        c.rationale === s.rationale &&
        c.uncertainty === s.uncertainty &&
        canonical(c.imageNeeds) === canonical(s.imageNeeds),
    );
    const withoutPlacement = (page: typeof s.page) => ({
      ...page,
      sections: page.sections.map((sec) => ({
        ...sec,
        blocks: sec.blocks.map((b) =>
          b.kind === 'image'
            ? { ...b, asset: null, image: null, alt: '', unresolved: '' }
            : b,
        ),
      })),
    });
    if (
      !authored ||
      canonical(withoutPlacement(authored.page)) !==
        canonical(withoutPlacement(s.page))
    )
      throw new InputError('Direction decisions diverge from pinned AI output');
    validateAILocks(s.page, p.payload.lockedValues);
    if (
      canonical(d.sectionOrder) !== canonical(s.page.sections.map((x) => x.id))
    )
      throw new InputError('Direction section order mismatch');
    const images: ImageInfo[] = [];
    for (const sec of s.page.sections)
      for (const b of sec.blocks)
        if (b.asset) {
          const a = known<DesignArtifact<ProjectAsset>>(
            b.asset,
            'website-asset',
          );
          if (
            a.payload.state.role !== 'placeable' ||
            canonical(a.payload.state.image) !== canonical(b.image) ||
            !p.dependencies.some((x) => same(x, b.asset!))
          )
            throw new InputError(
              'Direction placed asset version/role mismatch',
            );
          if (!assets.exists(b.image!.id, b.image!.checksum))
            throw new InputError('Direction placed bytes missing or corrupt');
          images.push(b.image!);
        }
    if (
      canonical(p.assets) !==
      canonical(images.map((i) => ({ id: i.id, checksum: i.checksum })))
    )
      throw new InputError('Direction image inventory mismatch');
  }
}
export class AIDirections {
  readonly workspace: Workspace;
  constructor(workspace: Workspace) {
    this.workspace = workspace;
  }
  request(pid: string, input: unknown) {
    const r = record(input, [
      'expectedProject',
      'count',
      'base',
      'instructions',
      'references',
    ]);
    const p = this.workspace.project(pid, r['expectedProject']);
    const base = r['base'] === null ? null : this.design(pid, ref(r['base']));
    const refs = list(r['references'] ?? [], ref, 4);
    const selected = this.workspace.references(p);
    for (const x of refs)
      if (!selected.some((y) => y.selected && same(y.artifact, x)))
        throw new InputError('Choose an explicitly included project reference');
    if (new Set(refs.map((x) => x.id)).size !== refs.length)
      throw new InputError('Duplicate direction reference');
    const state: DirectionRequest = {
      version: 1,
      project: reference(p),
      base: base ? reference(base) : null,
      count: integer(r['count'], 9),
      instructions: string(
        r['instructions'] ??
          'Propose AI-authored, editable landing-page directions for the pinned brief; retain all unresolved choices.',
      ),
      references: refs,
      status: 'awaiting',
      output: null,
    };
    const a = make(pid, 'website-ai-request', state, [
      state.project,
      ...(state.base ? [state.base] : []),
      ...refs,
    ]);
    this.workspace.kernel.putMany([a], () =>
      this.workspace.project(pid, state.project),
    );
    return this.workspace.state(pid);
  }
  job(pid: string, r: VersionRef) {
    const a = this.workspace.read(pid, r) as NodePacket<
      DesignArtifact<DirectionRequest>
    >;
    if (a.payload.kind !== 'website-ai-request')
      throw new InputError('Choose an AI direction request');
    return a;
  }
  design(pid: string, r: VersionRef) {
    const a = this.workspace.read(pid, r) as NodePacket<
      DesignArtifact<WebsiteDesignState>
    >;
    if (a.payload.kind !== 'website-design')
      throw new InputError('Choose a Website direction');
    return a;
  }
  export(pid: string, r: VersionRef) {
    const a = this.job(pid, r),
      s = a.payload.state,
      p = this.workspace.kernel.get<ModuleProject>(s.project);
    return {
      schema: 'bve.ai-direction-request',
      version: 1,
      request: reference(a),
      project: s.project,
      brief: Object.fromEntries(
        Object.entries(effectiveValues(p.payload.resolvedContext)).filter(
          ([k]) => !['references', 'comparison'].includes(k),
        ),
      ),
      context: {
        ...p.payload.resolvedContext,
        fields: Object.fromEntries(
          Object.entries(p.payload.resolvedContext.fields).filter(
            ([k]) => !['references', 'comparison'].includes(k),
          ),
        ),
      },
      base: s.base ? this.design(pid, s.base).payload.state : null,
      count: s.count,
      instructions: s.instructions,
      references: s.references.map((x) => ({
        ...this.workspace.references(p).find((r) => same(r.artifact, x))!,
        artifact: x,
        ...(this.workspace.read(pid, x).payload.state as ImageState),
      })),
      outputSchema: aiOutputSchema,
      outputContract:
        'bve.ai-directions v1: candidates[{title,rationale,constraints,uncertainty,unresolved,page,imageNeeds}]. page is bounded CompositionContent: title,description,style,sections,unresolved. Exactly hero/services/proof/contact, editable order, recipes stack/split/cards/band. Style: background,foreground,accent,actionText,font(system/serif/rounded),bodySize,headingSize,spacing,radius,maxWidth. Each section: id,recipe,align(left/center),fit(cover/contain),overrides,blocks. Each block: id,kind(heading/paragraph/list/button/image),text,href,items,asset:null,image:null,alt,unresolved. ImageNeed: section,role,prompt,size(1024x1024/1536x1024/1024x1536),preservation,references(exact included refs). Supply one image need per section; missing images explicit. Preserve locked intent/content/palette; contrast>=4.5. No HTML/CSS/scripts, invented image IDs or human approval. Refine base when supplied.',
      metadata: {
        provider: 'manual-native',
        model: null,
        settings: null,
        usage: null,
      },
      privacy:
        'Only chosen references are listed. Attach their files deliberately; no project assets are automatically included.',
    };
  }
  private current(
    pid: string,
    a: NodePacket<DesignArtifact<DirectionRequest>>,
  ) {
    this.workspace.project(pid, a.payload.state.project);
    if (
      this.workspace.kernel.currentVersion(a.id) !== a.version ||
      a.payload.state.status !== 'awaiting'
    )
      throw new InputError(
        'Direction request changed or was applied; reload',
        409,
      );
  }
  apply(pid: string, input: unknown) {
    const r = record(input, [
      'request',
      'response',
      'source',
      'model',
      'aiAuthorship',
      'evidence',
    ]);
    const job = this.job(pid, ref(r['request']));
    this.current(pid, job);
    let output: NodePacket<DesignArtifact<DirectionEvidence>>;
    if (r['evidence'] !== undefined) {
      output = this.workspace.read(pid, ref(r['evidence'])) as NodePacket<
        DesignArtifact<DirectionEvidence>
      >;
      if (
        output.payload.kind !== 'website-ai-evidence' ||
        !(
          output.payload.state.executor === 'api-ai' ||
          (this.workspace.options.aiResponseFixture &&
            output.payload.state.executor === 'test-fixture' &&
            output.payload.state.providerJob)
        ) ||
        !same(output.payload.state.request, reference(job)) ||
        output.payload.state.outcome !== 'candidate'
      )
        throw new InputError('Choose a current, usable AI direction result');
      const provider = this.workspace.read(pid, {
        ...output.payload.state.providerJob!,
        version: this.workspace.kernel.currentVersion(
          output.payload.state.providerJob!.id,
        )!,
      }) as NodePacket<DesignArtifact<ProviderJob>>;
      if (
        provider.payload.state.status !== 'returned' ||
        !provider.payload.state.outputs.some((x) => same(x, reference(output)))
      )
        throw new InputError('AI attempt is not a returned usable result');
    } else {
      if (r['aiAuthorship'] !== true)
        throw new InputError(
          'Attest AI authorship explicitly; this is not human approval',
        );
      const evidence: DirectionEvidence = {
        request: reference(job),
        response: parseResponse(r['response']),
        executor: this.workspace.options.aiResponseFixture
          ? 'test-fixture'
          : 'native-ai-attested',
        source: string(r['source'], 500),
        requestedModel: null,
        reportedModel: r['model'] === null ? null : string(r['model'], 200),
        providerJob: null,
        outcome: 'candidate',
      };
      output = make(pid, 'website-ai-evidence', evidence, [reference(job)]);
    }
    const response = parseResponse(output.payload.state.response);
    if (response.candidates.length !== job.payload.state.count)
      throw new InputError('Return the requested candidate count');
    const project = this.workspace.project(pid, job.payload.state.project),
      parameters = effectiveValues(project.payload.resolvedContext),
      locked = Object.fromEntries(
        Object.entries(parameters).filter(([k]) =>
          ['intent', 'content', 'palette'].includes(k),
        ),
      );
    const refs = this.workspace.references(project);
    const candidates = response.candidates.map((c, i) => {
      for (const s of c.page.sections)
        for (const b of s.blocks)
          if (b.asset || b.image)
            throw new InputError(
              'AI may propose image needs, never fabricate owned asset placements',
            );
      validateAILocks(c.page, locked);
      for (const n of c.imageNeeds)
        for (const x of n.references)
          if (
            !job.payload.state.references.some((y) => same(y, x)) ||
            !refs.some(
              (y) =>
                same(y.artifact, x) &&
                (y.scope === 'landing-page' || y.scope === n.section),
            )
          )
            throw new InputError(
              'AI image need reference is unavailable or outside scope',
            );
      const spec: AISpec = {
        version: 1,
        request: reference(job),
        evidence: reference(output),
        rationale: c.rationale,
        constraints: c.constraints,
        uncertainty: c.uncertainty,
        imageNeeds: c.imageNeeds,
        page: c.page,
      };
      const state: WebsiteDesignState = {
        scope: 'landing-page',
        intent: String(parameters['intent']),
        thesis: c.title,
        sectionOrder: c.page.sections.map((x) => x.id),
        parameters: {
          ...Object.fromEntries(
            Object.entries(parameters).filter(
              ([k]) => !['references', 'comparison'].includes(k),
            ),
          ),
          ai: jsonValue(spec),
        },
        metrics: [
          {
            family: 'Structural',
            key: 'hierarchy',
            relative: c.page.style.headingSize / 128,
          },
          {
            family: 'Spatial',
            key: 'whitespace',
            relative: c.page.style.spacing / 160,
          },
          {
            family: 'Styling',
            key: 'edge-expression',
            relative: c.page.style.radius / 48,
          },
          { family: 'Dynamics', key: 'motion-intent', relative: 0 },
        ],
        unresolved: [...c.unresolved, c.uncertainty],
      };
      return packet<DesignArtifact<WebsiteDesignState>>({
        type: 'design-artifact',
        id: 'ai-design-' + randomUUID(),
        projectId: pid,
        dependencies: [
          reference(project, 'current'),
          reference(job),
          reference(output),
        ],
        placeholders: project.placeholders,
        payload: {
          moduleId: 'website',
          kind: 'website-design',
          scope: 'landing-page',
          lockedValues: locked,
          state,
        },
        provenance: {
          actor: output.payload.state.executor,
          source: output.payload.state.source,
          previous: null,
        },
      });
    });
    const bundle = packet<IterationBundle>({
      type: 'iteration-bundle',
      id: 'ai-bundle-' + randomUUID(),
      projectId: pid,
      contextRefs: project.contextRefs,
      payload: {
        projectRef: reference(project, 'current'),
        baseState: job.payload.state.base,
        scope: 'landing-page',
        inherited: Object.fromEntries(
          Object.entries(project.payload.resolvedContext.fields)
            .filter(([, f]) => f.inherited)
            .map(([k, f]) => [k, f.inherited!.value]),
        ),
        locked,
        exploring: [],
        placeholders: project.placeholders,
        variationPlan: { strategy: 'ai-authored', amplitude: 0 },
        candidateCount: candidates.length,
        candidates: candidates.map((x) => reference(x)),
        selection: null,
        status: 'candidates-ready',
        capabilities: [],
        executionRefs: [reference(job), reference(output)],
      },
    });
    const updated = revise(
      job,
      {
        ...job.payload,
        state: {
          ...job.payload.state,
          status: 'applied' as const,
          output: reference(output),
        },
      },
      'local-operator',
      'Apply AI-authored candidates; acceptance remains separate',
    );
    const { integrity: _, ...body } = updated;
    const next = packet({
      ...body,
      dependencies: [...job.dependencies, reference(output)],
    });
    this.workspace.kernel.putMany(
      [
        ...(r['evidence'] === undefined ? [output] : []),
        ...candidates,
        bundle,
        next,
      ],
      () => this.current(pid, job),
    );
    return this.workspace.state(pid);
  }
  async addAsset(pid: string, input: unknown, bytes?: Buffer) {
    const r = record(input, [
      'expectedProject',
      'origin',
      'label',
      'role',
      'permission',
    ]);
    const p = this.workspace.project(pid, r['expectedProject']);
    const role = choice(r['role'], ['reference', 'placeable']);
    let origin: VersionRef | null = null,
      info: ImageInfo;
    if (r['origin'] !== null) {
      origin = ref(r['origin']);
      const a = this.workspace.read(pid, origin);
      if (
        ![
          'website-reference',
          'website-image',
          'website-api-image',
          'website-region-image',
        ].includes(a.payload.kind)
      )
        throw new InputError('Choose an owned original image');
      info = (await this.workspace.originalImage(pid, origin)).info;
    } else {
      if (!bytes) throw new InputError('Supply an image file');
      info = await decode(bytes);
      this.workspace.assets.save(bytes, info);
    }
    const state: ProjectAsset = {
      version: 1,
      image: info,
      origin,
      label: string(r['label'], 100),
      role,
      permission: string(r['permission'], 500),
    };
    const a = make(pid, 'website-asset', state, origin ? [origin] : [], [info]);
    this.workspace.kernel.putMany([a], () =>
      this.workspace.project(pid, reference(p)),
    );
    return this.workspace.state(pid);
  }
  reviseAsset(pid: string, input: unknown) {
    const r = record(input, [
      'expectedProject',
      'expected',
      'label',
      'role',
      'permission',
    ]);
    const p = this.workspace.project(pid, r['expectedProject']);
    const old = this.workspace.read(pid, ref(r['expected'])) as NodePacket<
      DesignArtifact<ProjectAsset>
    >;
    if (old.payload.kind !== 'website-asset')
      throw new InputError('Choose a project asset');
    const next = revise(
      old,
      {
        ...old.payload,
        state: {
          ...old.payload.state,
          label: string(r['label'], 100),
          role: choice(r['role'], ['reference', 'placeable']),
          permission: string(r['permission'], 500),
        },
      },
      'local-operator',
      'Explicit asset role/label revision; old placements remain pinned',
    );
    this.workspace.kernel.putMany([next], () => {
      this.workspace.project(pid, reference(p));
      if (this.workspace.kernel.currentVersion(old.id) !== old.version)
        throw new InputError('Asset changed; reload', 409);
    });
    return this.workspace.state(pid);
  }
  async place(pid: string, input: unknown) {
    const r = record(input, [
      'expectedProject',
      'direction',
      'bundle',
      'asset',
      'section',
      'alt',
      'unresolved',
      'reason',
    ]);
    const p = this.workspace.project(pid, r['expectedProject']),
      d = this.design(pid, ref(r['direction']));
    const spec = parseSpec(d.payload.state.parameters['ai']),
      section = choice(r['section'], sectionIds),
      asset = this.workspace.read(pid, ref(r['asset'])) as NodePacket<
        DesignArtifact<ProjectAsset>
      >;
    if (
      asset.payload.kind !== 'website-asset' ||
      asset.payload.state.role !== 'placeable'
    )
      throw new InputError(
        'Explicitly mark the exact asset version as placeable first',
      );
    const image = (await this.workspace.originalImage(pid, reference(asset)))
      .info;
    const b = this.workspace.kernel.get<IterationBundle>(ref(r['bundle']));
    const guard = () => {
      this.workspace.project(pid, reference(p));
      if (
        b.projectId !== pid ||
        b.type !== 'iteration-bundle' ||
        this.workspace.kernel.currentVersion(b.id) !== b.version ||
        this.workspace.kernel.currentVersion(d.id) !== d.version ||
        !b.payload.candidates.some((x) => same(x, reference(d))) ||
        b.payload.projectRef.version !== p.version
      )
        throw new InputError(
          'Direction/bundle changed or is historical; reload',
          409,
        );
    };
    guard();
    const page = structuredClone(spec.page),
      sec = page.sections.find((x) => x.id === section)!,
      old = sec.blocks.find((x) => x.kind === 'image');
    if (!old)
      throw new InputError(
        'This direction has no image slot in that section; refine its AI request or add an image in composition.',
      );
    const binding = {
      id: old?.id ?? section + '-placed-image',
      kind: 'image' as const,
      text: '',
      href: '',
      items: [],
      asset: reference(asset),
      image,
      alt: string(r['alt'], 500, true),
      unresolved: string(r['unresolved'], 500, true),
    };
    if (old) Object.assign(old, binding);
    else sec.blocks.push(binding);
    const content = parseContent(page);
    validateAILocks(content, d.payload.lockedValues);
    const nextState = {
      ...d.payload.state,
      parameters: {
        ...d.payload.state.parameters,
        ai: jsonValue({ ...spec, page: content }),
      },
    };
    const revised = revise(
      d,
      { ...d.payload, state: nextState },
      'local-operator',
      string(r['reason'], 500),
    );
    const { integrity: _, ...body } = revised;
    const placed = content.sections
      .flatMap((s) => s.blocks)
      .filter((x) => x.asset);
    const next = packet({
      ...body,
      dependencies: [
        reference(p, 'current'),
        spec.request,
        spec.evidence,
        ...placed.map((x) => x.asset!),
      ],
      assets: placed.map((x) => ({
        id: x.image!.id,
        checksum: x.image!.checksum,
      })),
    });
    const bundle = revise(
      b,
      {
        ...b.payload,
        candidates: b.payload.candidates.map((x) =>
          same(x, reference(d)) ? reference(next) : x,
        ),
        selection:
          b.payload.selection && same(b.payload.selection, reference(d))
            ? reference(next)
            : b.payload.selection,
      },
      'local-operator',
      'Refresh candidate to exact placement revision; accepted design unchanged',
    );
    this.workspace.kernel.putMany([next, bundle], guard);
    return this.workspace.state(pid);
  }
  async preview(pid: string, r: VersionRef) {
    const d = this.design(pid, r),
      spec = parseSpec(d.payload.state.parameters['ai']);
    for (const s of spec.page.sections)
      for (const b of s.blocks)
        if (b.asset) await this.workspace.originalImage(pid, b.asset);
    const p = this.workspace.kernel.get<ModuleProject>(
      d.dependencies.find((x) => x.id === pid)!,
    );
    const s: CompositionState = {
      contractVersion: 1,
      project: reference(p),
      direction: reference(d),
      directionState: d.payload.state,
      lockedValues: d.payload.lockedValues,
      context: p.payload.resolvedContext,
      content: spec.page,
      reviews: {},
    };
    return renderComposition(
      s,
      (b) =>
        '/api/v1/asset?project=' +
        pid +
        '&id=' +
        b.asset!.id +
        '&version=' +
        b.asset!.version,
    );
  }
}
