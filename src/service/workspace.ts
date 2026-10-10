import { validateCompositionLinks } from './compositions.ts';
import { AIDirections, validateAILinks } from './ai-directions.ts';
import type {
  ProviderJob,
  ApiImage,
  AssistantProposal,
  AssistantReview,
} from '../modules/website/provider-contracts.ts';
import { randomUUID } from 'node:crypto';
import type {
  ArtifactMetadata,
  DesignArtifact,
  IterationBundle,
  ModuleProject,
  NodePacket,
  Value,
  VersionRef,
  VisualOS,
} from '../kernel/contracts.ts';
import { KernelStore } from '../kernel/store.ts';
import { localField, resolveContext } from '../kernel/context.ts';
import {
  packet,
  placeholder,
  reference,
  revise,
  canonical,
} from '../kernel/packets.ts';
import { revalidatePacket, writePort } from '../kernel/gate.ts';
import { reconnect } from '../kernel/metadata.ts';
import { moduleExists, validateArtifact } from '../modules/registry.ts';
import { exploreWebsite } from '../modules/website/design.ts';
import type { WebsiteDesignState } from '../modules/website/design.ts';
import { syntheticCapabilities } from '../fixtures-design-os.ts';
import {
  parseReference,
  parseDirection,
  validateWorkspaceArtifact,
} from '../modules/website/workspace-contracts.ts';
import type {
  ReferenceInput,
  NativeJob,
  NativeManifest,
  ImageState,
  Outcome,
} from '../modules/website/workspace-contracts.ts';
import { LegacyAssets } from './legacy-assets.ts';
import { Assets, decode } from './assets.ts';
import { validateRegionLinks } from './regions.ts';
import {
  InputError,
  record,
  string,
  id,
  ref,
  list,
  choice,
  scopes,
  integer,
  bool,
} from './validation.ts';
const actor = 'local-operator';
const value = (x: unknown) => x as Value;
const same = (a: VersionRef | null, b: VersionRef | null) =>
  a?.id === b?.id && a?.version === b?.version;
const fields = [
  'title',
  'intent',
  'audience',
  'offer',
  'response',
  'content',
  'exclusions',
  'commitments',
  'unresolved',
  'references',
  'comparison',
  'palette',
  'typeface',
  'motion',
  'density',
];
export class Workspace {
  kernel: KernelStore;
  assets: Assets;
  legacy: LegacyAssets;
  // Test-only explicit dependency injection; never a browser/environment option.
  readonly options: { directionFixture?: boolean; aiResponseFixture?: boolean };
  constructor(
    root: string,
    options: { directionFixture?: boolean; aiResponseFixture?: boolean } = {},
  ) {
    this.options = options;
    this.assets = new Assets(root);
    this.legacy = new LegacyAssets(root);
    this.kernel = new KernelStore(root, {
      moduleExists,
      validateArtifact,
      assetExists: (a, h) =>
        this.assets.exists(a, h) || this.legacy.exists(a, h),
      grantedPermissions: ['read', 'write', 'accept'],
    });
  }
  close(): void {
    this.kernel.close();
    this.legacy.close();
  }
  private owned<T>(
    pointer: VersionRef,
    projectId: string,
    type = 'design-artifact',
  ): NodePacket<T> {
    const p = this.kernel.get<T>(pointer);
    if (p.projectId !== projectId || p.type !== type)
      throw new InputError('Object belongs to a different project or type');
    if (p.type === 'design-artifact') {
      validateArtifact(
        (p.payload as DesignArtifact<unknown>).moduleId,
        p.payload as unknown as Record<string, unknown>,
      );
      this.validateLinks(p as NodePacket<DesignArtifact<unknown>>);
      for (const a of p.assets)
        if (
          !this.assets.exists(a.id, a.checksum) &&
          !this.legacy.exists(a.id, a.checksum)
        )
          throw new InputError('Asset unavailable or corrupt');
    } else revalidatePacket(p, writePort(p.type), this.kernel.environment());
    return p;
  }
  private validateLinks(p: NodePacket<DesignArtifact<unknown>>) {
    validateAILinks(p, this.kernel, this.assets);
    validateRegionLinks(p, this.kernel, this.assets);
    validateCompositionLinks(p, this.kernel, this.assets);
    const known = (pointer: VersionRef, type: string, kind?: string) => {
      const a = this.kernel.get<DesignArtifact<unknown>>(pointer);
      if (
        a.projectId !== p.projectId ||
        a.type !== type ||
        (kind && a.payload.kind !== kind)
      )
        throw new InputError('Workspace link owner/type mismatch');
      return a;
    };
    if (p.payload.kind === 'website-provider-budget') {
      const state = p.payload
        .state as import('../modules/website/provider-contracts.ts').BudgetState;
      const seen = new Set<string>();
      for (const reservation of state.reservations) {
        const job = this.kernel.get<DesignArtifact<ProviderJob>>(
          reservation.attempt,
        );
        if (
          job.type !== 'design-artifact' ||
          job.payload.kind !== 'website-provider-job' ||
          job.id !== job.payload.state.request.attemptId ||
          reservation.attempt.version !== 1 ||
          !state.policy.models.includes(job.payload.state.request.model) ||
          reservation.amountUSD !== state.policy.reserveUSD ||
          seen.has(job.id)
        )
          throw new InputError('Run reservation binding mismatch');
        seen.add(job.id);
      }
    }
    if (p.payload.kind === 'website-provider-job') {
      const s = p.payload.state as ProviderJob,
        m = s.request;
      const original = this.kernel.lookup({
        id: p.id,
        version: 1,
        freshness: 'pinned',
      }) as NodePacket<DesignArtifact<ProviderJob>> | null;
      if (
        m.attemptId !== p.id ||
        m.project.id !== p.projectId ||
        (original && canonical(original.payload.state.request) !== canonical(m))
      )
        throw new InputError('API request identity/immutability mismatch');
      const sourceProject = known(
        m.project,
        'module-project',
      ) as unknown as NodePacket<ModuleProject>;
      if (m.directionRequest) {
        const q = known(
          m.directionRequest,
          'design-artifact',
          'website-ai-request',
        ).payload.state as { project: VersionRef; references: VersionRef[] };
        if (
          m.operation !== 'directions' ||
          !same(q.project, m.project) ||
          canonical(q.references) !==
            canonical(m.references.map((x) => x.artifact))
        )
          throw new InputError('API direction request binding mismatch');
      }
      const sourceRefs =
        sourceProject.payload.localContext['references']?.override ?? [];
      for (const r of m.references)
        if (
          !r.selected ||
          (m.operation !== 'directions' &&
            ![m.scope, 'landing-page'].includes(r.scope)) ||
          !Array.isArray(sourceRefs) ||
          !sourceRefs.some(
            (x) =>
              canonical(x) ===
              canonical(
                Object.fromEntries(
                  Object.entries(r).filter(([k]) => k !== 'image'),
                ),
              ),
          )
        )
          throw new InputError('API reference role/version mismatch');
      if (m.artifact) {
        const a = known(m.artifact, 'design-artifact');
        if (
          m.operation === 'generate'
            ? a.payload.kind !== 'website-design'
            : ![
                'website-image',
                'website-api-image',
                'website-region-image',
              ].includes(a.payload.kind) || a.payload.scope !== m.scope
        )
          throw new InputError('API input type/scope mismatch');
        if (
          canonical(m.inputAsset) !==
          canonical(
            m.operation === 'edit'
              ? (a.payload.state as ImageState).image
              : null,
          )
        )
          throw new InputError('API input checksum mismatch');
      }
      for (const r of m.references) {
        const a = known(r.artifact, 'design-artifact', 'website-reference');
        if (
          canonical(r.image) !==
          canonical((a.payload.state as ImageState).image)
        )
          throw new InputError('API reference binding mismatch');
      }
      for (const o of s.outputs) {
        const a = known(
          o,
          'design-artifact',
          m.operation === 'directions'
            ? 'website-ai-evidence'
            : m.operation === 'assistant'
              ? 'website-assistant-proposal'
              : 'website-api-image',
        );
        if (
          (m.operation === 'directions'
            ? (a.payload.state as { providerJob: VersionRef }).providerJob
            : (a.payload.state as ApiImage | AssistantProposal).job
          ).id !== p.id
        )
          throw new InputError('API output job mismatch');
      }
    }
    if (
      p.payload.kind === 'website-api-image' ||
      p.payload.kind === 'website-assistant-proposal'
    ) {
      const s = p.payload.state as ApiImage | AssistantProposal;
      const job = known(s.job, 'design-artifact', 'website-provider-job');
      const m = (job.payload.state as ProviderJob).request;
      if (p.payload.scope !== m.scope)
        throw new InputError('API output scope mismatch');
      if (p.payload.kind === 'website-api-image') {
        const i = s as ApiImage;
        if (
          m.operation === 'assistant' ||
          !same(i.originalArtifact, m.artifact) ||
          canonical(i.parentAsset) !== canonical(m.inputAsset) ||
          i.requestedModel !== m.model ||
          i.recipe !== m.recipe ||
          canonical(i.settings) !== canonical(m.settings)
        )
          throw new InputError('API result binding mismatch');
      } else {
        const a = s as AssistantProposal;
        if (
          m.operation !== 'assistant' ||
          !same(a.project, m.project) ||
          canonical(a.sourceReferences) !==
            canonical(m.references.map((r) => r.artifact))
        )
          throw new InputError('Assistant source binding mismatch');
      }
    }
    if (p.payload.kind === 'website-assistant-review') {
      const s = p.payload.state as AssistantReview;
      const raw = known(
        s.originalProposal,
        'design-artifact',
        'website-assistant-proposal',
      ).payload.state as AssistantProposal;
      if (
        canonical(s.proposal.sourceReferences) !==
        canonical(raw.sourceReferences)
      )
        throw new InputError('Human review source mismatch');
    }
    if (p.payload.kind === 'website-image-comparison') {
      const s = p.payload.state as { compared: VersionRef[] };
      for (const r of s.compared) {
        const a = known(r, 'design-artifact');
        if (
          ![
            'website-image',
            'website-api-image',
            'website-region-image',
          ].includes(a.payload.kind) ||
          a.payload.scope !== p.payload.scope
        )
          throw new InputError('Image comparison scope/type mismatch');
      }
    }
    if (p.payload.kind === 'website-native-job') {
      const m = (p.payload.state as NativeJob).manifest;
      if (m.jobId !== p.id || m.project.id !== p.projectId)
        throw new InputError('Native manifest identity mismatch');
      known(m.project, 'module-project');
      const a = known(m.artifact, 'design-artifact');
      if (
        ![
          'website-design',
          'website-image',
          'website-api-image',
          'website-region-image',
          'website-asset',
        ].includes(a.payload.kind)
      )
        throw new InputError('Wrong native input type');
      const input = [
        'website-image',
        'website-api-image',
        'website-region-image',
        'website-asset',
      ].includes(a.payload.kind)
        ? (a.payload.state as ImageState).image
        : null;
      if (canonical(input) !== canonical(m.inputAsset))
        throw new InputError('Native original asset mismatch');
      for (const r of m.references) {
        const source = known(
          r.artifact,
          'design-artifact',
          'website-reference',
        );
        if (
          canonical((source.payload.state as ImageState).image) !==
          canonical(r.image)
        )
          throw new InputError('Native reference checksum mismatch');
      }
      if (m.selection) known(m.selection, 'design-artifact');
      for (const o of (p.payload.state as NativeJob).outputs) {
        const a = known(o, 'design-artifact', 'website-image'),
          image = a.payload.state as ImageState;
        if (image.job?.id !== p.id || !same(image.originalArtifact, m.artifact))
          throw new InputError('Native output binding mismatch');
      }
    }
    if (p.payload.kind === 'website-image') {
      const image = p.payload.state as ImageState;
      const j = known(image.job!, 'design-artifact', 'website-native-job'),
        m = (j.payload.state as NativeJob).manifest;
      if (
        p.payload.scope !== m.scope ||
        !same(image.originalArtifact, m.artifact) ||
        canonical(image.parentAsset) !== canonical(m.inputAsset)
      )
        throw new InputError('Returned image original binding mismatch');
    }
    if (
      ['website-image', 'website-api-image', 'website-reference'].includes(
        p.payload.kind,
      )
    ) {
      const image = (p.payload.state as ImageState).image;
      if (
        p.assets.length !== 1 ||
        p.assets[0]!.id !== image.id ||
        p.assets[0]!.checksum !== image.checksum
      )
        throw new InputError('Image asset link mismatch');
    }
    if (p.payload.kind === 'website-direction')
      for (const r of (p.payload.state as { sourceReferences: VersionRef[] })
        .sourceReferences)
        known(r, 'design-artifact', 'website-reference');
    if (p.payload.kind === 'website-comparison')
      for (const r of (p.payload.state as { compared: VersionRef[] }).compared)
        known(r, 'design-artifact');
  }
  project(projectId: string, expected?: unknown): NodePacket<ModuleProject> {
    id(projectId);
    const version = this.kernel.currentVersion(projectId);
    if (version === null) throw new InputError('Unknown project', 404);
    const p = this.owned<ModuleProject>(
      { id: projectId, version, freshness: 'pinned' },
      projectId,
      'module-project',
    );
    if (expected !== undefined && !same(ref(expected), reference(p)))
      throw new InputError('Project changed; reload before saving', 409);
    return p;
  }
  references(project: NodePacket<ModuleProject>): ReferenceInput[] {
    const refs = list(
      project.payload.localContext['references']?.override ?? [],
      parseReference,
    );
    for (const r of refs) {
      const a = this.owned<DesignArtifact<ImageState>>(r.artifact, project.id);
      if (a.payload.kind !== 'website-reference')
        throw new InputError('Reference must identify a reference image');
    }
    return refs;
  }
  state(projectId?: string) {
    let packets = this.kernel.latestPackets();
    if (projectId) {
      const order = new Map(
        this.kernel
          .ledger(projectId)
          .events.map((e) => [e.subject.id, e.sequence]),
      );
      packets = packets.sort(
        (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
      );
    }
    const projects = packets.filter(
      (p) =>
        p.type === 'module-project' &&
        (p.payload as ModuleProject).moduleId === 'website',
    );
    const visualOS = packets.filter((p) => p.type === 'visual-os');
    if (!projectId)
      return {
        directionFixture: this.options.directionFixture === true,
        projects,
        visualOS,
        capabilities: syntheticCapabilities().payload,
      };
    const project = this.project(projectId);
    this.references(project);
    const artifacts = packets.filter(
      (p) => p.projectId === projectId && p.type === 'design-artifact',
    ) as NodePacket<DesignArtifact<unknown>>[];
    for (const p of artifacts) {
      const payload = p.payload as DesignArtifact<unknown>;
      if (
        validateWorkspaceArtifact(
          payload as unknown as Record<string, unknown>,
        ) ||
        payload.kind === 'website-design'
      )
        this.owned(reference(p), projectId);
    }
    return {
      directionFixture: this.options.directionFixture === true,
      projects,
      visualOS,
      capabilities: syntheticCapabilities().payload,
      project,
      artifacts,
      bundles: packets.filter(
        (p) => p.projectId === projectId && p.type === 'iteration-bundle',
      ),
      ledger: this.kernel.ledger(projectId),
      accepted: {
        composition: this.kernel.selected(projectId, 'composition'),
        design: this.kernel.selected(projectId, 'design'),
        hero: this.kernel.selected(projectId, 'hero'),
        services: this.kernel.selected(projectId, 'services'),
        proof: this.kernel.selected(projectId, 'proof'),
        contact: this.kernel.selected(projectId, 'contact'),
      },
      references: this.references(project),
    };
  }
  create(input: unknown) {
    const r = record(input, ['title', 'mode', 'visualOS', 'palette', 'intake']);
    const title = string(r['title'], 100),
      mode = choice(r['mode'], ['branded', 'freeroam']);
    const projectId = 'website-' + randomUUID();
    let mounted: NodePacket<VisualOS> | null = null;
    const writes: NodePacket<unknown>[] = [];
    if (
      mode === 'freeroam' &&
      (r['visualOS'] !== null || r['palette'] !== null)
    )
      throw new InputError('Freeroam starts without mounted context');
    if (mode === 'branded') {
      if (r['visualOS'] !== null) {
        const pointer = ref(r['visualOS']);
        mounted = this.kernel.get<VisualOS>(pointer);
        if (
          mounted.type !== 'visual-os' ||
          mounted.projectId !== null ||
          mounted.approval !== 'accepted'
        )
          throw new InputError('Choose an approved shared VisualOS');
      } else {
        const palette = list(
          r['palette'],
          (x) => {
            const c = string(x, 7);
            if (!/^#[a-f0-9]{6}$/i.test(c))
              throw new InputError('Use hex palette colors');
            return c;
          },
          3,
        );
        if (palette.length !== 3)
          throw new InputError('Choose three palette colors');
        mounted = packet({
          type: 'visual-os',
          id: 'visual-os-' + randomUUID(),
          approval: 'accepted',
          payload: {
            values: {
              palette: { value: palette, approved: true },
              typeface: { value: 'system-ui', approved: true },
            },
            placeholders: { motion: placeholder('motion') },
          },
          provenance: {
            actor,
            source: 'Explicit manual VisualOS creation and mount',
            previous: null,
          },
        });
        writes.push(mounted);
      }
    }
    const local = {
      title: localField({ hasOverride: true, override: title }),
      intent: localField({
        hasOverride: true,
        override: 'Request a fictional home-care appointment',
      }),
      audience: localField({ hasOverride: true, override: 'Busy homeowners' }),
      offer: localField({
        hasOverride: true,
        override: 'Routine care, seasonal checks and small repairs',
      }),
      response: localField({ hasOverride: true, override: 'Book a visit' }),
      content: localField({
        hasOverride: true,
        override: ['Routine care', 'Seasonal checks', 'Small repairs'],
      }),
      density: localField({
        hasDerived: true,
        derived: 'calm',
        reviewRequired: true,
      }),
      references: localField({ hasOverride: true, override: [] }),
      comparison: localField({ hasOverride: true, override: [] }),
    };
    if (r['intake'] !== undefined) {
      const intake = string(r['intake'], 12000);
      Object.assign(local, {intent: localField({hasOverride:true,override:intake}),
        audience:localField({hasOverride:true,override:''}),offer:localField({hasOverride:true,override:''}),
        response:localField({hasOverride:true,override:''}),content:localField({hasOverride:true,override:[]}),
        density:localField({}),unresolved:localField({hasOverride:true,override:['Audience, offer details and desired action remain unknown until clarified.']})});
    }
    const p = packet<ModuleProject>({
      type: 'module-project',
      id: projectId,
      projectId,
      contextRefs: mounted ? [reference(mounted)] : [],
      payload: {
        moduleId: 'website',
        mode,
        visualOSRef: mounted ? reference(mounted) : null,
        localContext: local,
        resolvedContext: resolveContext(mode, mounted, local, fields),
        artifactRefs: [],
      },
      provenance: { actor, source: 'Open Website workspace', previous: null },
    });
    writes.push(p);
    this.kernel.putMany(writes);
    return this.state(projectId);
  }
  reviseProject(projectId: string, input: unknown) {
    const r = record(input, [
      'expectedProject',
      'brief',
      'references',
      'comparison',
      'reason',
    ]);
    const p = this.project(projectId, r['expectedProject']),
      local = { ...p.payload.localContext };
    const reason = string(r['reason'], 500);
    if (r['brief'] !== undefined) {
      const b = record(r['brief'], [
        'title',
        'intent',
        'audience',
        'offer',
        'response',
        'content',
        'exclusions',
        'commitments',
        'unresolved',
        'palette',
      ]);
      for (const [k, v] of Object.entries(b)) {
        const parsed =
          k === 'content' ||
          k === 'exclusions' ||
          k === 'commitments' ||
          k === 'unresolved'
            ? list(v, (s) => string(s, 500), 16)
            : k === 'palette'
              ? v === null
                ? null
                : list(
                    v,
                    (c) => {
                      const color = string(c, 7);
                      if (!/^#[a-f0-9]{6}$/i.test(color))
                        throw new InputError('Invalid palette');
                      return color;
                    },
                    3,
                  )
              : string(v, k === 'title' ? 100 : 4000, true);
        if (
          k === 'palette' &&
          parsed !== null &&
          (parsed as unknown[]).length !== 3
        )
          throw new InputError('Choose three local palette colors');
        local[k] = localField({
          hasOverride: parsed !== null,
          override: value(parsed),
        });
      }
    }
    if (r['references'] !== undefined) {
      const references = list(r['references'], parseReference);
      for (const item of references) {
        const a = this.owned<DesignArtifact<ImageState>>(
          item.artifact,
          projectId,
        );
        if (a.payload.kind !== 'website-reference')
          throw new InputError('Wrong reference type');
      }
      local['references'] = localField({
        hasOverride: true,
        override: value(references),
      });
    }
    if (r['comparison'] !== undefined) {
      if (r['brief'] !== undefined || r['references'] !== undefined)
        throw new InputError('Save comparison separately');
      const compared = list(r['comparison'], ref, 2);
      for (const pointer of compared) {
        const a = this.owned<DesignArtifact<unknown>>(pointer, projectId);
        if (
          !['website-design', 'website-image', 'website-direction'].includes(
            a.payload.kind,
          )
        )
          throw new InputError('Cannot compare this record');
      }
      this.kernel.put(
        this.artifact(
          projectId,
          'website-comparison',
          'landing-page',
          { compared, reason },
          compared,
        ),
      );
      return this.state(projectId);
    }
    const mounted = p.payload.visualOSRef
      ? this.kernel.get<VisualOS>(p.payload.visualOSRef)
      : null;
    this.kernel.put(
      revise(
        p,
        {
          ...p.payload,
          localContext: local,
          resolvedContext: resolveContext(
            p.payload.mode,
            mounted,
            local,
            fields,
          ),
        },
        actor,
        reason,
      ),
    );
    return this.state(projectId);
  }
  mount(projectId: string, input: unknown) {
    const r = record(input, ['expectedProject', 'visualOS', 'reason']);
    const p = this.project(projectId, r['expectedProject']);
    const v = this.kernel.get<VisualOS>(ref(r['visualOS']));
    if (
      v.type !== 'visual-os' ||
      v.projectId !== null ||
      v.approval !== 'accepted'
    )
      throw new InputError('Unavailable approved shared VisualOS');
    const next = revise(
      p,
      {
        ...p.payload,
        mode: 'branded',
        visualOSRef: reference(v),
        resolvedContext: resolveContext(
          'branded',
          v,
          p.payload.localContext,
          fields,
        ),
      },
      actor,
      string(r['reason'], 500),
    );
    const { integrity: _, ...body } = next;
    this.kernel.put(packet({ ...body, contextRefs: [reference(v)] }));
    return this.state(projectId);
  }
  explore(projectId: string, input: unknown) {
    if (!this.options.directionFixture)
      return new AIDirections(this).request(projectId, input);
    const r = record(input, ['expectedProject', 'count', 'base']);
    const p = this.project(projectId, r['expectedProject']);
    const base =
      r['base'] === null
        ? null
        : this.owned<DesignArtifact<WebsiteDesignState>>(
            ref(r['base']),
            projectId,
          );
    const round = exploreWebsite(
      p,
      'bundle-' + randomUUID(),
      base,
      integer(r['count'], 9),
      base ? 0.2 : 0.6,
    );
    const candidates = round.candidates.map((c) => {
      const { integrity: _, ...body } = c;
      return packet({
        ...body,
        dependencies: [
          reference(p, 'current'),
          ...(base ? [reference(base)] : []),
        ],
        provenance: {
          actor,
          source: 'Deterministic coherent proposal',
          previous: null,
        },
      });
    });
    const { integrity: _, ...body } = round.bundle;
    const bundle = packet({
      ...body,
      payload: { ...round.bundle.payload, projectRef: reference(p, 'current') },
      provenance: {
        actor,
        source: 'Deterministic exploration round',
        previous: null,
      },
    });
    this.kernel.putMany([...candidates, bundle]);
    return this.state(projectId);
  }
  select(projectId: string, input: unknown) {
    const r = record(input, ['bundle', 'candidate', 'reason']);
    this.project(projectId);
    const b = this.owned<IterationBundle>(
      ref(r['bundle']),
      projectId,
      'iteration-bundle',
    );
    this.owned(ref(r['candidate']), projectId);
    this.kernel.select(
      reference(b),
      ref(r['candidate']),
      actor,
      string(r['reason'], 500),
    );
    return this.state(projectId);
  }
  accept(projectId: string, input: unknown) {
    const r = record(input, [
      'artifact',
      'bundle',
      'expected',
      'reason',
      'slot',
      'allowHistorical',
    ]);
    this.project(projectId);
    const a = this.owned<DesignArtifact<unknown>>(
      ref(r['artifact']),
      projectId,
    );
    const resultJob = (a.payload.state as ImageState).job;
    if (
      ['website-image', 'website-api-image'].includes(a.payload.kind) &&
      resultJob &&
      this.kernel
        .latestPackets()
        .some(
          (p) =>
            p.projectId === projectId &&
            p.type === 'design-artifact' &&
            (p.payload as DesignArtifact<{ execution?: VersionRef }>).kind ===
              'website-region-operation' &&
            (p.payload as DesignArtifact<{ execution?: VersionRef }>).state
              .execution?.id === resultJob.id,
        )
    )
      throw new InputError(
        'Use regional acceptance to review its bound mask and preservation policy',
      );
    const slot = choice(r['slot'], [
      'design',
      'hero',
      'services',
      'proof',
      'contact',
    ]);
    if (a.payload.kind === 'website-design') {
      if (slot !== 'design' || r['bundle'] === null)
        throw new InputError('Select a design in its bundle first');
    } else if (a.payload.kind === 'website-api-image') {
      const s = a.payload.state as ApiImage;
      if (slot !== a.payload.scope || slot === 'design' || r['bundle'] !== null)
        throw new InputError('API image acceptance scope mismatch');
      const job = this.owned<DesignArtifact<ProviderJob>>(
        { ...s.job, version: this.kernel.currentVersion(s.job.id)! },
        projectId,
      );
      if (
        job.payload.kind !== 'website-provider-job' ||
        job.payload.state.status !== 'returned' ||
        !job.payload.state.outputs.some((o) => same(o, reference(a)))
      )
        throw new InputError('API image is not an eligible recorded result');
      if (
        (s.outcome === 'late' ||
          job.payload.state.request.project.version !==
            this.project(projectId).version) &&
        !bool(r['allowHistorical'])
      )
        throw new InputError(
          'Historical API input: explicitly acknowledge review before acceptance',
          409,
        );
    } else if (a.payload.kind === 'website-image') {
      const s = a.payload.state as ImageState;
      if (slot !== a.payload.scope || slot === 'design')
        throw new InputError('Image acceptance scope mismatch');
      const job = this.owned<DesignArtifact<NativeJob>>(
        { ...s.job!, version: this.kernel.currentVersion(s.job!.id)! },
        projectId,
      );
      if (
        job.payload.kind !== 'website-native-job' ||
        !job.payload.state.outputs.some((o) => same(o, reference(a)))
      )
        throw new InputError('Image is not a recorded job candidate');
      if (['cancelled', 'abandoned'].includes(job.payload.state.status))
        throw new InputError(
          'Cancelled/abandoned job results are retained only',
        );
      if (
        (s.outcome === 'late' ||
          job.payload.state.manifest.project.version !==
            this.project(projectId).version) &&
        !bool(r['allowHistorical'])
      )
        throw new InputError(
          'Historical input: explicitly acknowledge review before acceptance',
          409,
        );
      if (r['bundle'] !== null)
        throw new InputError('Image acceptance does not use a design bundle');
    } else
      throw new InputError(
        'This record cannot be accepted as design or section imagery',
      );
    this.kernel.accept(
      projectId,
      slot,
      reference(a),
      r['expected'] === null ? null : ref(r['expected']),
      actor,
      string(r['reason'], 500),
      r['bundle'] === null ? null : ref(r['bundle']),
    );
    return this.state(projectId);
  }
  async addReference(
    projectId: string,
    expected: unknown,
    bytes: Buffer,
    label: string,
    role: unknown,
    scope: unknown,
  ) {
    const p = this.project(projectId, expected);
    let info: Awaited<ReturnType<typeof decode>>;
    try {
      info = await decode(bytes);
    } catch (error) {
      this.assets.quarantine(bytes);
      throw error;
    }
    this.project(projectId, expected);
    const state: ImageState = {
      image: info,
      job: null,
      originalArtifact: null,
      parentAsset: null,
      outcome: 'reference',
      providerPath: 'manual-reference',
      model: null,
      settings: null,
      seed: null,
      usage: null,
      providerId: null,
    };
    const item = this.artifact(
      projectId,
      'website-reference',
      choice(scope, scopes),
      state,
      [],
      [info],
    );
    const entry = parseReference({
      artifact: reference(item),
      label,
      role,
      scope,
      selected: true,
    });
    this.assets.save(bytes, info);
    const refs = [...this.references(p), entry];
    if (refs.length > 32) throw new InputError('Reference limit reached');
    const local = {
      ...p.payload.localContext,
      references: localField({ hasOverride: true, override: value(refs) }),
    };
    const mounted = p.payload.visualOSRef
      ? this.kernel.get<VisualOS>(p.payload.visualOSRef)
      : null;
    this.kernel.putMany([
      item,
      revise(
        p,
        {
          ...p.payload,
          localContext: local,
          resolvedContext: resolveContext(
            p.payload.mode,
            mounted,
            local,
            fields,
          ),
        },
        actor,
        'Add scoped reference',
      ),
    ]);
    return this.state(projectId);
  }
  private artifact<T>(
    projectId: string,
    kind: string,
    scope: string,
    state: T,
    deps: VersionRef[] = [],
    assets: { id: string; checksum: string }[] = [],
  ): NodePacket<DesignArtifact<T>> {
    return packet({
      type: 'design-artifact',
      id: kind + '-' + randomUUID(),
      projectId,
      dependencies: deps,
      assets,
      payload: { moduleId: 'website', kind, scope, lockedValues: {}, state },
      provenance: {
        actor,
        source:
          kind === 'website-native-job'
            ? 'Manual native request'
            : 'Explicit manual import',
        previous: null,
      },
    });
  }
  native(
    projectId: string,
    input: unknown,
    companions?: (
      job: NodePacket<DesignArtifact<NativeJob>>,
    ) => NodePacket<unknown>[],
  ) {
    const r = record(input, [
      'expectedProject',
      'artifact',
      'scope',
      'instructions',
      'preservation',
      'references',
    ]);
    const p = this.project(projectId, r['expectedProject']);
    const a = this.owned<DesignArtifact<WebsiteDesignState | ImageState>>(
      ref(r['artifact']),
      projectId,
    );
    if (
      ![
        'website-asset',
        'website-design',
        'website-image',
        'website-api-image',
        'website-region-image',
      ].includes(a.payload.kind)
    )
      throw new InputError('Choose a design or image as the native input');
    const scope = choice(r['scope'], scopes);
    const refs = this.references(p)
      .filter(
        (x) => x.selected && (x.scope === scope || x.scope === 'landing-page'),
      )
      .map((x) => ({
        ...x,
        image: this.owned<DesignArtifact<ImageState>>(x.artifact, projectId)
          .payload.state.image,
      }));
    const chosen =
      r['references'] === undefined
        ? refs
        : list(r['references'], ref, 4).map((pointer) => {
            const entry = refs.find((x) => same(x.artifact, pointer));
            if (!entry)
              throw new InputError('Choose a selected reference in this scope');
            return entry;
          });
    if (new Set(chosen.map((x) => x.artifact.id)).size !== chosen.length)
      throw new InputError('Duplicate reference');
    const jobId = 'native-job-' + randomUUID();
    const manifest: NativeManifest = {
      contractVersion: 1,
      jobId,
      project: reference(p),
      moduleId: 'website',
      scope,
      artifact: reference(a),
      inputAsset: [
        'website-image',
        'website-api-image',
        'website-region-image',
        'website-asset',
      ].includes(a.payload.kind)
        ? (a.payload.state as ImageState).image
        : null,
      instructions: string(r['instructions']),
      references: chosen,
      selection: this.kernel.selected(
        projectId,
        scope === 'landing-page' ? 'design' : scope,
      ),
      preservation: list(r['preservation'], (s) => string(s, 500)),
      providerPath: 'manual-native-export',
      model: null,
      settings: null,
      seed: null,
      usage: null,
      providerId: null,
    };
    const job = this.artifact(
      projectId,
      'website-native-job',
      scope,
      { manifest, status: 'awaiting', outcomes: [], outputs: [] } as NativeJob,
      [reference(p), reference(a), ...chosen.map((x) => x.artifact)],
      chosen.map((x) => x.image),
    );
    const { integrity: _, ...body } = job;
    const prepared = packet<DesignArtifact<NativeJob>>({ ...body, id: jobId });
    this.kernel.putMany([prepared, ...(companions?.(prepared) ?? [])]);
    return this.state(projectId);
  }
  manifest(projectId: string, pointer: VersionRef) {
    const job = this.owned<DesignArtifact<NativeJob>>(pointer, projectId);
    if (job.payload.kind !== 'website-native-job')
      throw new InputError('Not a native job');
    return {
      job: reference(job),
      manifest: job.payload.state.manifest,
      input: {
        project: this.kernel.get<ModuleProject>(
          job.payload.state.manifest.project,
        ),
        artifact: this.owned(job.payload.state.manifest.artifact, projectId),
      },
      instructions:
        'Use this explicit manual request in an operator-authorized native host. Attach the referenced images from this workspace by checksum. Return image files to the original jobId; no settings or provider IDs should be invented. Preserve: ' +
        job.payload.state.manifest.preservation.join('; '),
    };
  }
  private outcome(
    job: NodePacket<DesignArtifact<NativeJob>>,
    kind: Outcome['kind'],
    message: string,
    artifact: VersionRef | null = null,
    checksum: string | null = null,
    status = job.payload.state.status,
  ) {
    const state = {
      ...job.payload.state,
      status,
      outcomes: [
        ...job.payload.state.outcomes,
        { kind, message, at: new Date().toISOString(), artifact, checksum },
      ],
      outputs: artifact
        ? [...job.payload.state.outputs, artifact]
        : job.payload.state.outputs,
    };
    return revise(job, { ...job.payload, state }, actor, message);
  }
  cancel(projectId: string, input: unknown) {
    const r = record(input, ['job', 'status', 'reason']);
    const job = this.owned<DesignArtifact<NativeJob>>(ref(r['job']), projectId);
    if (
      job.payload.kind !== 'website-native-job' ||
      job.version !== this.kernel.currentVersion(job.id)
    )
      throw new InputError('Stale native job', 409);
    const status = choice(r['status'], ['cancelled', 'abandoned']);
    if (['cancelled', 'abandoned'].includes(job.payload.state.status))
      throw new InputError('Already closed');
    this.kernel.put(
      this.outcome(job, status, string(r['reason'], 500), null, null, status),
    );
    return this.state(projectId);
  }
  async importNative(projectId: string, input: unknown, bytes: Buffer) {
    const r = record(input, ['job', 'manifestProject', 'originalArtifact']);
    const pointer = ref(r['job']);
    let job = this.owned<DesignArtifact<NativeJob>>(pointer, projectId);
    if (job.payload.kind !== 'website-native-job')
      throw new InputError('Not a native job');
    if (job.version !== this.kernel.currentVersion(job.id))
      throw new InputError(
        'Job changed; reload original job before importing',
        409,
      );
    try {
      const m = job.payload.state.manifest;
      if (
        !same(ref(r['manifestProject']), m.project) ||
        !same(ref(r['originalArtifact']), m.artifact)
      )
        throw new InputError('Original request/input binding mismatch');
      const info = await decode(bytes);
      if (job.version !== this.kernel.currentVersion(job.id))
        throw new InputError('Job changed while decoding; reload', 409);
      if (
        job.payload.state.outputs.some(
          (o) =>
            this.owned<DesignArtifact<ImageState>>(o, projectId).payload.state
              .image.checksum === info.checksum,
        )
      ) {
        this.kernel.put(
          this.outcome(
            job,
            'duplicate',
            'Duplicate image retained once',
            null,
            info.checksum,
          ),
        );
        return this.state(projectId);
      }
      const closed = ['cancelled', 'abandoned'].includes(
        job.payload.state.status,
      );
      const late =
        m.project.version !== this.project(projectId).version ||
        !same(
          m.selection,
          this.kernel.selected(
            projectId,
            m.scope === 'landing-page' ? 'design' : m.scope,
          ),
        );
      const kind = closed ? 'late-cancelled' : late ? 'late' : 'candidate';
      const state: ImageState = {
        image: info,
        job: reference(job),
        originalArtifact: m.artifact,
        parentAsset: m.inputAsset,
        outcome: kind,
        providerPath: 'manual-native-import',
        model: null,
        settings: null,
        seed: null,
        usage: null,
        providerId: null,
      };
      const candidate = this.artifact(
        projectId,
        'website-image',
        m.scope,
        state,
        [reference(job), m.project, m.artifact],
        [info],
      );
      this.assets.save(bytes, info);
      this.kernel.putMany([
        candidate,
        this.outcome(
          job,
          kind,
          closed
            ? 'Late result retained for a closed original request'
            : late
              ? 'Late result needs explicit historical review'
              : 'Returned image remains a candidate',
          reference(candidate),
          info.checksum,
          closed ? job.payload.state.status : 'returned',
        ),
      ]);
      return this.state(projectId);
    } catch (error) {
      // Persist invalid attempts only on the still-current original job. Never write acceptance.
      if (this.kernel.currentVersion(job.id) === job.version) {
        this.assets.quarantine(bytes);
        this.kernel.put(
          this.outcome(
            job,
            'invalid',
            error instanceof InputError
              ? error.message
              : 'Import failed; review original request',
          ),
        );
      }
      throw error;
    }
  }
  direction(projectId: string, input: unknown) {
    const r = record(input, ['expectedProject', 'proposal']);
    const p = this.project(projectId, r['expectedProject']);
    const proposal = parseDirection(r['proposal']);
    const refs = this.references(p);
    for (const source of proposal.sourceReferences)
      if (!refs.some((x) => same(x.artifact, source)))
        throw new InputError('Proposal source must be a project reference');
    const a = this.artifact(
      projectId,
      'website-direction',
      'landing-page',
      proposal,
      [reference(p), ...proposal.sourceReferences],
    );
    this.kernel.put(a);
    return this.state(projectId);
  }
  inspectMetadata(input: unknown) {
    return reconnect(input as ArtifactMetadata, (p) => this.kernel.lookup(p));
  }
  read(projectId: string, pointer: VersionRef) {
    const p = this.owned<DesignArtifact<unknown>>(pointer, projectId);
    return p;
  }
  async originalImage(projectId: string, pointer: VersionRef) {
    const p = this.owned<DesignArtifact<ImageState>>(pointer, projectId);
    if (
      ![
        'website-asset',
        'website-image',
        'website-api-image',
        'website-region-image',
        'website-reference',
      ].includes(p.payload.kind)
    )
      throw new InputError('Not an image');
    const bytes = this.assets.read(p.payload.state.image.id);
    const info = await decode(bytes);
    if (canonical(info) !== canonical(p.payload.state.image))
      throw new InputError('Image descriptor mismatch');
    return { bytes, info };
  }
  async image(projectId: string, pointer: VersionRef) {
    const { info } = await this.originalImage(projectId, pointer);
    return this.assets.preview(info.id);
  }
}
