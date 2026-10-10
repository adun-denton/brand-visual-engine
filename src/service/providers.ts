import { AIDirections } from './ai-directions.ts';
import type { DirectionEvidence } from '../modules/website/ai-contracts.ts';
import { resolveCapability } from '../kernel/capabilities.ts';
import { syntheticCapabilities } from '../fixtures-design-os.ts';
import type {
  CapabilityRegistry,
  CapabilityRequest,
} from '../kernel/contracts.ts';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type {
  DesignArtifact,
  NodePacket,
  ModuleProject,
  VersionRef,
} from '../kernel/contracts.ts';
import { packet, reference, revise, canonical } from '../kernel/packets.ts';
import type { Workspace } from './workspace.ts';
import { InputError, record, string, ref, list, choice } from './validation.ts';
import { decode } from './assets.ts';
import type {
  ImageState,
  ReferenceInput,
} from '../modules/website/workspace-contracts.ts';
import type {
  ProviderJob,
  ProviderRequest,
  ApiImage,
  AssistantProposal,
  AssistantReview,
  BudgetState,
  RunPolicy,
  Observation,
} from '../modules/website/provider-contracts.ts';
import {
  parsePolicy,
  parseProposal,
  operations,
} from '../modules/website/provider-contracts.ts';
import {
  IMAGE_MODELS,
  ASSISTANT_MODELS,
  RECIPE,
  executeOpenAI,
  ProviderFailure,
} from './openai.ts';
import type { Transport } from './openai.ts';
export interface ProviderConfig {
  apiKey: string | null;
  imageModel: string;
  assistantModel: string;
  policy: RunPolicy | null;
  timeoutMs: number;
  transport?: Transport;
}
export function environmentConfig(): ProviderConfig {
  let policy: RunPolicy | null = null;
  if (process.env['BVE_PROVIDER_POLICY_FILE']) {
    try {
      policy = parsePolicy(
        JSON.parse(
          readFileSync(process.env['BVE_PROVIDER_POLICY_FILE'], 'utf8'),
        ),
      );
    } catch {
      throw new InputError(
        'Private provider run policy is invalid or unavailable',
      );
    }
  }
  return {
    apiKey: process.env['OPENAI_API_KEY'] || null,
    imageModel: process.env['BVE_IMAGE_MODEL'] || IMAGE_MODELS[0],
    assistantModel: process.env['BVE_ASSISTANT_MODEL'] || ASSISTANT_MODELS[0],
    policy,
    timeoutMs: 180000,
  };
}
const same = (a: VersionRef | null, b: VersionRef | null) =>
  a?.id === b?.id && a?.version === b?.version;
export function artifact<T>(
  pid: string,
  kind: string,
  scope: string,
  state: T,
  deps: VersionRef[] = [],
  assets: { id: string; checksum: string }[] = [],
) {
  return packet<DesignArtifact<T>>({
    type: 'design-artifact',
    id: kind + '-' + randomUUID(),
    projectId: pid,
    dependencies: deps,
    assets,
    payload: { moduleId: 'website', kind, scope, lockedValues: {}, state },
    provenance: {
      actor: 'local-operator',
      source: 'Explicit capability workflow',
      previous: null,
    },
  });
}
export class Providers {
  workspace: Workspace;
  private config: ProviderConfig;
  private persistenceFailed = false;
  private active = new Map<
    string,
    { controller: AbortController; promise: Promise<void> }
  >();
  constructor(
    workspace: Workspace,
    config: ProviderConfig = environmentConfig(),
  ) {
    this.workspace = workspace;
    this.config = config;
    for (const a of workspace.kernel.latestPackets()) {
      if (
        a.type !== 'design-artifact' ||
        (a.payload as DesignArtifact<unknown>).kind !== 'website-provider-job'
      )
        continue;
      const j = a as NodePacket<DesignArtifact<ProviderJob>>;
      if (['submitting', 'running'].includes(j.payload.state.status))
        this.change(
          j,
          'outcome-uncertain',
          'restart-uncertain',
          'Process interrupted after reservation. Remote retrieval is unsupported here; reconcile provider records before a new attempt.',
        );
    }
  }
  registry(): CapabilityRegistry {
    const base = syntheticCapabilities().payload,
      status = this.status();
    return {
      capabilities: [
        ...base.capabilities,
        {
          id: 'image.generate',
          version: 1,
          inputType: 'design-artifact',
          outputType: 'design-artifact',
        },
        {
          id: 'design.reasoning',
          version: 1,
          inputType: 'module-project',
          outputType: 'design-artifact',
        },
      ],
      executors: [
        ...base.executors.filter((e) => e.id !== 'cloud-unconfigured'),
        {
          id: this.config.transport ? 'api-transport-fixture' : 'openai-api',
          kind: 'cloud',
          capabilities: [
            ...(status.imageSupported ? ['image.generate', 'image.edit'] : []),
            ...(status.assistantSupported ? ['design.reasoning'] : []),
          ],
          available: status.available,
          observedSettings: null,
        },
      ],
    };
  }
  status() {
    const p = this.config.policy,
      b = p ? this.budget(p.runId) : null;
    return {
      persistenceFailed: this.persistenceFailed,
      verificationMode: this.config.transport
        ? 'offline-transport-fixture'
        : 'live-unverified',
      configured: !!this.config.apiKey,
      imageModel: this.config.imageModel,
      assistantModel: this.config.assistantModel,
      imageSupported: IMAGE_MODELS.includes(
        this.config.imageModel as (typeof IMAGE_MODELS)[number],
      ),
      assistantSupported: ASSISTANT_MODELS.includes(
        this.config.assistantModel as (typeof ASSISTANT_MODELS)[number],
      ),
      authorized: !!p,
      directionGenerationApproved: p?.directionGenerationApproved === true,
      available: !!this.config.transport && !!this.config.apiKey && !!p && !this.persistenceFailed,
      paidExecutionDisabled: !this.config.transport,
      accountAccess: 'unverified',
      recipe: RECIPE,
      budget: p
        ? {
            runId: p.runId,
            capUSD: p.capUSD,
            reserveUSD: p.reserveUSD,
            maxCalls: p.maxCalls,
            callsUsed: b?.payload.state.reservations.length ?? 0,
            reservedUSD:
              b?.payload.state.reservations
                .filter((r) => r.disposition !== 'released')
                .reduce((n, r) => n + r.amountUSD, 0) ?? 0,
            alternativeCallBoundApproved: true,
          }
        : null,
    };
  }
  private budget(runId: string) {
    const id =
      'provider-budget-' + createHash('sha256').update(runId).digest('hex');
    const version = this.workspace.kernel.currentVersion(id);
    return version
      ? this.workspace.kernel.get<DesignArtifact<BudgetState>>({
          id,
          version,
          freshness: 'pinned',
        })
      : null;
  }
  private job(
    pid: string,
    pointer: VersionRef,
  ): NodePacket<DesignArtifact<ProviderJob>> {
    const j = this.workspace.read(pid, pointer);
    if (j.payload.kind !== 'website-provider-job')
      throw new InputError('Not an API attempt');
    return j as NodePacket<DesignArtifact<ProviderJob>>;
  }
  private latest(pid: string, id: string) {
    return this.job(pid, {
      id,
      version: this.workspace.kernel.currentVersion(id)!,
      freshness: 'pinned',
    });
  }
  prepare(
    pid: string,
    input: unknown,
    companions?: (
      job: NodePacket<DesignArtifact<ProviderJob>>,
    ) => NodePacket<unknown>[],
  ) {
    const r = record(input, [
      'expectedProject',
      'artifact',
      'scope',
      'operation',
      'instructions',
      'size',
      'quality',
      'references',
      'directionRequest',
    ]);
    const p = this.workspace.project(pid, r['expectedProject']),
      operation = choice(r['operation'], operations),
      scope = choice(
        r['scope'],
        operation === 'directions'
          ? ['landing-page']
          : ['hero', 'services', 'proof', 'contact'],
      );
    const direction =
      operation === 'directions'
        ? new AIDirections(this.workspace).job(pid, ref(r['directionRequest']))
        : null;
    if (
      direction &&
      (direction.payload.state.status !== 'awaiting' ||
        direction.payload.state.project.version !== p.version ||
        direction.version !==
          this.workspace.kernel.currentVersion(direction.id))
    )
      throw new InputError('AI direction request is stale', 409);
    if (operation !== 'directions' && r['directionRequest'] !== undefined)
      throw new InputError('Direction request belongs to directions operation');
    const a = ['assistant', 'directions'].includes(operation)
      ? null
      : this.workspace.read(pid, ref(r['artifact']));
    if (operation === 'generate' && a?.payload.kind !== 'website-design')
      throw new InputError('Generation starts from a website design');
    if (
      operation === 'edit' &&
      (!a ||
        ![
          'website-image',
          'website-api-image',
          'website-region-image',
        ].includes(a.payload.kind) ||
        a.payload.scope !== scope)
    )
      throw new InputError('Edit starts from an image in this section');
    const selected = list(
      p.payload.localContext['references']?.override ?? [],
      (x) => x as unknown as ReferenceInput,
    );
    const refs = list(r['references'], ref, 4).map((pointer) => {
      const entry = selected.find(
        (x) =>
          same(x.artifact, pointer) &&
          x.selected &&
          (operation === 'directions' ||
            x.scope === scope ||
            x.scope === 'landing-page'),
      );
      if (!entry)
        throw new InputError(
          'Choose a current selected reference in this scope',
        );
      const image = this.workspace.read(pid, pointer);
      if (image.payload.kind !== 'website-reference')
        throw new InputError('Not a reference image');
      return { ...entry, image: (image.payload.state as ImageState).image };
    });
    if (new Set(refs.map((r) => r.artifact.id)).size !== refs.length)
      throw new InputError('Duplicate reference');
    if (operation === 'generate' && refs.length)
      throw new InputError(
        'Generation accepts text only. Use image editing to include image references.',
      );
    if (
      direction &&
      canonical(refs.map((x) => x.artifact)) !==
        canonical(direction.payload.state.references)
    )
      throw new InputError(
        'Use the exact explicitly included direction references',
      );
    const model = ['assistant', 'directions'].includes(operation)
      ? this.config.assistantModel
      : this.config.imageModel;
    if (
      !(
        ['assistant', 'directions'].includes(operation)
          ? ASSISTANT_MODELS
          : IMAGE_MODELS
      ).includes(model as never)
    )
      throw new InputError('Configured model is unsupported by this recipe');
    const m: ProviderRequest = {
      contractVersion: 1,
      ...(direction ? { directionRequest: reference(direction) } : {}),
      attemptId: 'api-attempt-' + randomUUID(),
      project: reference(p),
      artifact: a ? reference(a) : null,
      scope,
      operation,
      instructions: string(r['instructions']),
      inputAsset:
        operation === 'edit'
          ? (a!.payload.state as ImageState | ApiImage).image
          : null,
      references: refs,
      selection: this.workspace.kernel.selected(pid, scope),
      executorId: this.config.transport
        ? 'api-transport-fixture'
        : 'openai-api',
      model,
      recipe: RECIPE,
      settings: {
        n: 1,
        size: choice(r['size'], ['1024x1024', '1536x1024', '1024x1536']),
        quality: choice(r['quality'], ['low', 'medium', 'high']),
        outputFormat: 'png',
        background: 'opaque',
        maxOutputTokens: operation === 'directions' ? 12000 : 2000,
      },
    };
    const j = artifact(
      pid,
      'website-provider-job',
      scope,
      {
        request: m,
        status: 'queued',
        outputs: [],
        observations: [],
      } as ProviderJob,
      [
        reference(p),
        ...(a ? [reference(a)] : []),
        ...(direction ? [reference(direction)] : []),
        ...refs.map((r) => r.artifact),
      ],
      refs.map((r) => r.image),
    );
    const { integrity: _, ...body } = j;
    const prepared = packet<DesignArtifact<ProviderJob>>({
      ...body,
      id: m.attemptId,
    });
    this.workspace.kernel.putMany([
      prepared,
      ...(companions?.(prepared) ?? []),
    ]);
    return this.workspace.state(pid);
  }
  private change(
    j: NodePacket<DesignArtifact<ProviderJob>>,
    status: ProviderJob['status'],
    kind: string,
    message: string,
    evidence: Partial<Observation> = {},
    output: NodePacket<DesignArtifact<unknown>> | null = null,
  ) {
    const observation: Observation = {
      at: new Date().toISOString(),
      kind,
      message,
      transportRequestId: null,
      resultId: null,
      reportedModel: null,
      usage: null,
      reportedSettings: null,
      actualCostUSD: null,
      ...evidence,
    };
    const next = revise(
      j,
      {
        ...j.payload,
        state: {
          ...j.payload.state,
          status,
          outputs: output
            ? [...j.payload.state.outputs, reference(output)]
            : j.payload.state.outputs,
          observations: [...j.payload.state.observations, observation],
        },
      },
      'local-operator',
      message,
    );
    this.workspace.kernel.putMany([...(output ? [output] : []), next]);
    return next;
  }
  submit(pid: string, input: unknown) {
    const r = record(input, ['job']);
    if (this.persistenceFailed)
      throw new InputError(
        'Provider history could not be committed. Stop and inspect the copied private runtime before further submission.',
      );
    const j = this.job(pid, ref(r['job']));
    const m = j.payload.state.request;
    if (
      j.version !== this.workspace.kernel.currentVersion(j.id) ||
      j.payload.state.status !== 'queued'
    )
      throw new InputError(
        'This attempt was already submitted or changed. Reload; no retry occurred.',
        409,
      );
    this.workspace.project(pid, m.project);
    if (!this.config.apiKey)
      throw new InputError(
        'API credentials are unconfigured. Native handoff remains available.',
      );
    const policy = this.config.policy;
    if (!policy)
      throw new InputError('No approved run budget. No API request was sent.');
    if (
      m.operation === 'directions' &&
      policy.directionGenerationApproved !== true
    )
      throw new InputError(
        'Separate direction-generation approval required; no API request was sent.',
      );
    if (m.directionRequest) {
      const q = new AIDirections(this.workspace).job(pid, m.directionRequest);
      if (
        q.version !== this.workspace.kernel.currentVersion(q.id) ||
        q.payload.state.status !== 'awaiting'
      )
        throw new InputError('AI direction request is no longer awaiting', 409);
    }
    if (
      !policy.models.includes(m.model) ||
      m.model !==
        (['assistant', 'directions'].includes(m.operation)
          ? this.config.assistantModel
          : this.config.imageModel) ||
      m.recipe !== RECIPE
    )
      throw new InputError('Model/recipe changed or not approved');
    if (!this.config.transport) throw new InputError('Paid API execution is disabled in this build. Use the scoped session handoff.');
    const capability: CapabilityRequest = {
      capabilityId: ['assistant', 'directions'].includes(m.operation)
        ? 'design.reasoning'
        : m.operation === 'edit'
          ? 'image.edit'
          : 'image.generate',
      inputType: ['assistant', 'directions'].includes(m.operation)
        ? 'module-project'
        : 'design-artifact',
      outputType: 'design-artifact',
    };
    const resolution = resolveCapability(this.registry(), capability, 'cloud');
    if (
      resolution.status !== 'available' ||
      resolution.executorId !== m.executorId
    )
      throw new InputError(
        'Compatible authorized executor is unavailable or changed',
      );
    const old = this.budget(policy.runId);
    if (old && canonical(old.payload.state.policy) !== canonical(policy))
      throw new InputError(
        'Run identity already has a different policy; use the original policy',
      );
    const reservations = old?.payload.state.reservations ?? [];
    for (const reservation of reservations.filter(
      (r) => r.disposition === 'reserved',
    )) {
      const version = this.workspace.kernel.currentVersion(
        reservation.attempt.id,
      );
      if (!version)
        throw new InputError(
          'Reserved attempt is unavailable; inspect stored history',
        );
      const previous = this.workspace.kernel.get<DesignArtifact<ProviderJob>>({
        ...reservation.attempt,
        version,
      });
      if (
        ['outcome-uncertain', 'cancelled-locally'].includes(
          previous.payload.state.status,
        )
      )
        throw new InputError(
          'Reconcile the uncertain or locally cancelled attempt before a new submission. Its reservation remains held.',
        );
    }
    if (
      reservations.length >= policy.maxCalls ||
      reservations
        .filter((r) => r.disposition !== 'released')
        .reduce((n, r) => n + r.amountUSD, 0) +
        policy.reserveUSD >
        policy.capUSD + 1e-9
    )
      throw new InputError(
        'Run call limit or reservation cap exhausted. No request sent.',
      );
    // Both append-only revisions are one SQLite transaction. Competing claims use the same
    // versions and only one can commit. Reservations precede all asynchronous transport work.
    const budgetState: BudgetState = {
      policy,
      reservations: [
        ...reservations,
        {
          attempt: reference(j),
          amountUSD: policy.reserveUSD,
          disposition: 'reserved',
          reason:
            'Alternative call bound and reservation approved; billing unknown',
        },
      ],
    };
    let budget: NodePacket<DesignArtifact<BudgetState>>;
    if (old)
      budget = revise(
        old,
        { ...old.payload, state: budgetState },
        'local-operator',
        'Reserve explicit API attempt',
      );
    else {
      const b = artifact(
        pid,
        'website-provider-budget',
        'landing-page',
        budgetState,
      );
      const { integrity: _, ...body } = b;
      budget = packet({
        ...body,
        id:
          'provider-budget-' +
          createHash('sha256').update(policy.runId).digest('hex'),
      });
    }
    const next = revise(
      j,
      {
        ...j.payload,
        state: { ...j.payload.state, status: 'submitting' as const },
      },
      'local-operator',
      'Claim explicit API submission',
    );
    this.workspace.kernel.putMany([budget, next]);
    const controller = new AbortController();
    const promise = this.run(pid, next, controller);
    this.active.set(j.id, { controller, promise });
    void promise
      .finally(() => this.active.delete(j.id))
      .catch(() => {
        this.persistenceFailed = true;
      });
    return this.workspace.state(pid);
  }
  private async run(
    pid: string,
    j: NodePacket<DesignArtifact<ProviderJob>>,
    controller: AbortController,
  ) {
    const m = j.payload.state.request;
    let sent = false,
      evidence: Partial<Observation> = {};
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const inputs: Buffer[] = [];
      if (m.inputAsset)
        inputs.push(
          (await this.workspace.originalImage(pid, m.artifact!)).bytes,
        );
      for (const r of m.references)
        inputs.push(
          (await this.workspace.originalImage(pid, r.artifact)).bytes,
        );
      // Recheck after decoding; changes before the send boundary fail without charge.
      this.workspace.project(pid, m.project);
      j = this.latest(pid, j.id);
      if (j.payload.state.status !== 'submitting') return;
      j = this.change(
        j,
        'running',
        'sending',
        'Sending one explicit API request; remote outcome and cost may become uncertain.',
      );
      sent = true;
      const p = this.workspace.kernel.get<ModuleProject>(m.project);
      const result = await executeOpenAI(
        m,
        this.config.apiKey!,
        {
          brief: Object.fromEntries(
            [
              'title',
              'intent',
              'audience',
              'offer',
              'response',
              'content',
              'exclusions',
              'commitments',
              'unresolved',
            ].map((k) => [k, p.payload.localContext[k]?.override ?? null]),
          ),
          context: Object.fromEntries(
            ['palette', 'typeface', 'motion', 'density'].map((k) => [
              k,
              p.payload.resolvedContext.fields[k]?.effective?.value ?? null,
            ]),
          ),
          ...(m.directionRequest
            ? {
                directionRequest: new AIDirections(this.workspace).export(
                  pid,
                  m.directionRequest,
                ),
              }
            : {}),
          originalArtifact: m.artifact
            ? this.workspace.read(pid, m.artifact).payload
            : null,
        },
        inputs,
        controller.signal,
        this.config.transport,
      );
      evidence = result.evidence;
      j = this.latest(pid, j.id);
      const cancelled = j.payload.state.status === 'cancelled-locally';
      const late =
        cancelled ||
        (m.operation === 'directions' &&
          j.payload.state.status === 'outcome-uncertain') ||
        m.project.version !== this.workspace.project(pid).version ||
        !same(m.selection, this.workspace.kernel.selected(pid, m.scope)) ||
        !!(
          m.directionRequest &&
          this.workspace.kernel.currentVersion(m.directionRequest.id) !==
            m.directionRequest.version
        );
      let output: NodePacket<DesignArtifact<unknown>>;
      if (result.bytes) {
        let info;
        try {
          info = await decode(result.bytes);
        } catch {
          throw new ProviderFailure(
            'invalid-image',
            'Returned image cannot be decoded within local limits. No usable candidate stored.',
            false,
            evidence,
          );
        }
        if (info.format !== 'png')
          throw new ProviderFailure(
            'invalid-image',
            'Returned image format does not match the PNG recipe.',
            false,
            evidence,
          );
        j = this.latest(pid, j.id);
        const cancelledNow = j.payload.state.status === 'cancelled-locally';
        const image: ApiImage = {
          image: info,
          job: reference(j),
          originalArtifact: m.artifact!,
          parentAsset: m.inputAsset,
          outcome: cancelledNow
            ? 'late-cancelled'
            : m.project.version !== this.workspace.project(pid).version ||
                !same(m.selection, this.workspace.kernel.selected(pid, m.scope))
              ? 'late'
              : 'candidate',
          providerPath: 'api',
          requestedModel: m.model,
          reportedModel: evidence.reportedModel ?? null,
          settings: m.settings,
          recipe: m.recipe,
          transportRequestId: evidence.transportRequestId ?? null,
          resultId: evidence.resultId ?? null,
          usage: evidence.usage ?? null,
          seed: null,
          cfg: null,
          actualCostUSD: null,
        };
        output = artifact(
          pid,
          'website-api-image',
          m.scope,
          image,
          [reference(j), m.project, m.artifact!],
          [info],
        );
        try {
          this.workspace.assets.save(result.bytes, info);
        } catch {
          throw new ProviderFailure(
            'storage-failure',
            'Returned bytes could not be stored. Cost remains unknown; inspect private storage.',
            false,
            evidence,
          );
        }
      } else if (m.operation === 'directions') {
        const ai: DirectionEvidence = {
          request: m.directionRequest!,
          response: result.directions!,
          executor: this.config.transport ? 'test-fixture' : 'api-ai',
          source: this.config.transport
            ? 'Offline transport fixture only; no AI/provider generation claim'
            : 'Explicit API direction generation; operator review pending',
          requestedModel: m.model,
          reportedModel: evidence.reportedModel ?? null,
          providerJob: reference(j),
          outcome: cancelled ? 'late-cancelled' : late ? 'late' : 'candidate',
        };
        output = artifact(pid, 'website-ai-evidence', 'landing-page', ai, [
          m.directionRequest!,
          reference(j),
        ]);
      } else {
        const proposal: AssistantProposal = {
          job: reference(j),
          project: m.project,
          proposal: result.proposal!,
          sourceReferences: m.references.map((r) => r.artifact),
          reviewed: false,
        };
        output = artifact(
          pid,
          'website-assistant-proposal',
          m.scope,
          proposal,
          [reference(j), m.project, ...proposal.sourceReferences],
        );
      }
      this.change(
        j,
        j.payload.state.status === 'cancelled-locally'
          ? 'cancelled-locally'
          : m.operation === 'directions' &&
              j.payload.state.status === 'outcome-uncertain'
            ? 'outcome-uncertain'
            : 'returned',
        late ? 'late-result' : 'result',
        'Returned result retained as a proposal/candidate; acceptance unchanged.',
        evidence,
        output,
      );
    } catch (error) {
      const current = this.latest(pid, j.id),
        failure =
          error instanceof ProviderFailure
            ? error
            : new ProviderFailure(
                sent ? 'storage-or-binding-failure' : 'input-rejected',
                sent
                  ? 'Result could not be committed. Inspect storage and provider records.'
                  : 'Inputs changed or are unavailable; transport was not called.',
                sent,
                evidence,
              );
      this.change(
        current,
        current.payload.state.status === 'cancelled-locally'
          ? 'cancelled-locally'
          : failure.uncertain
            ? 'outcome-uncertain'
            : 'failed',
        failure.kind,
        failure.message,
        failure.evidence,
      );
      if (!sent) this.release(pid, j.id, 'Verified before-send failure');
    } finally {
      clearTimeout(timer);
    }
  }
  private release(
    pid: string,
    attemptId: string,
    reason: string,
    retain = false,
  ) {
    const policy = this.config.policy;
    if (!policy) return;
    const b = this.budget(policy.runId);
    if (!b) return;
    this.workspace.kernel.put(
      revise(
        b,
        {
          ...b.payload,
          state: {
            ...b.payload.state,
            reservations: b.payload.state.reservations.map((r) =>
              r.attempt.id === attemptId
                ? {
                    ...r,
                    disposition: retain
                      ? ('retained' as const)
                      : ('released' as const),
                    reason,
                  }
                : r,
            ),
          },
        },
        'local-operator',
        reason,
      ),
    );
  }
  cancel(pid: string, input: unknown) {
    const r = record(input, ['job', 'reason']);
    const j = this.job(pid, ref(r['job']));
    if (
      j.version !== this.workspace.kernel.currentVersion(j.id) ||
      !['queued', 'submitting', 'running', 'outcome-uncertain'].includes(
        j.payload.state.status,
      )
    )
      throw new InputError('Attempt changed or already finished');
    this.change(
      j,
      'cancelled-locally',
      'local-cancel',
      string(r['reason'], 500) + '. Remote cancellation and cost are unknown.',
    );
    this.active.get(j.id)?.controller.abort();
    return this.workspace.state(pid);
  }
  reconcile(pid: string, input: unknown) {
    const r = record(input, [
      'job',
      'reason',
      'verifiedNoCharge',
      'acknowledgeUncertain',
    ]);
    const j = this.job(pid, ref(r['job']));
    if (
      j.version !== this.workspace.kernel.currentVersion(j.id) ||
      ![
        'outcome-uncertain',
        'cancelled-locally',
        'failed',
        'returned',
      ].includes(j.payload.state.status)
    )
      throw new InputError('Cannot reconcile this state');
    if (this.active.has(j.id))
      throw new InputError(
        'Wait for the active transport to finish before reconciling',
      );
    const reason = string(r['reason'], 500);
    const retain = r['verifiedNoCharge'] !== true;
    if (retain && r['acknowledgeUncertain'] !== true)
      throw new InputError(
        'Explicit provider no-charge evidence is required to release a reservation',
      );
    this.change(
      j,
      j.payload.state.status,
      'human-reconciliation',
      (retain
        ? 'Operator reviewed uncertain/charged outcome; reservation retained: '
        : 'Operator reported provider no-charge evidence: ') + reason,
    );
    this.release(pid, j.id, reason, retain);
    return this.workspace.state(pid);
  }
  review(pid: string, input: unknown) {
    const r = record(input, [
      'expectedProject',
      'proposal',
      'edited',
      'reason',
    ]);
    const p = this.workspace.project(pid, r['expectedProject']);
    const a = this.workspace.read(pid, ref(r['proposal']));
    if (a.payload.kind !== 'website-assistant-proposal')
      throw new InputError('Choose an assistant proposal');
    const s = a.payload.state as AssistantProposal;
    const j = this.latest(pid, s.job.id);
    if (
      j.payload.state.status !== 'returned' ||
      !j.payload.state.outputs.some((o) => same(o, reference(a))) ||
      s.project.version !== p.version
    )
      throw new InputError(
        'Proposal is cancelled, stale or not a recorded result; create a current proposal',
      );
    const edited = parseProposal(r['edited']);
    const review: AssistantReview = {
      originalProposal: reference(a),
      proposal: {
        ...edited,
        sourceReferences: s.sourceReferences,
        reviewed: true,
        source: 'Human reviewed API assistant proposal ' + a.id,
      },
      actor: 'local-operator',
      reason: string(r['reason'], 500),
      at: new Date().toISOString(),
    };
    this.workspace.kernel.put(
      artifact(pid, 'website-assistant-review', a.payload.scope, review, [
        reference(p),
        reference(a),
        ...s.sourceReferences,
      ]),
    );
    return this.workspace.state(pid);
  }
  compare(pid: string, input: unknown) {
    const r = record(input, ['compared', 'selected', 'reason']);
    this.workspace.project(pid);
    const refs = list(r['compared'], ref, 2);
    if (refs.length !== 2 || same(refs[0]!, refs[1]!))
      throw new InputError('Choose two distinct image candidates');
    const images = refs.map((r) => this.workspace.read(pid, r));
    if (
      images.some(
        (a) =>
          ![
            'website-image',
            'website-api-image',
            'website-region-image',
          ].includes(a.payload.kind),
      ) ||
      images[0]!.payload.scope !== images[1]!.payload.scope
    )
      throw new InputError('Images must belong to the same section');
    const selected = r['selected'] === null ? null : ref(r['selected']);
    if (selected && !refs.some((r) => same(r, selected)))
      throw new InputError('Select an image in this comparison');
    this.workspace.kernel.put(
      artifact(
        pid,
        'website-image-comparison',
        images[0]!.payload.scope,
        { compared: refs, selected, reason: string(r['reason'], 500) },
        refs,
      ),
    );
    return this.workspace.state(pid);
  }
  async wait(id?: string) {
    await Promise.all(
      [...this.active.entries()]
        .filter(([k]) => !id || id === k)
        .map(([, v]) => v.promise),
    );
  }
  async close() {
    for (const v of this.active.values()) v.controller.abort();
    await this.wait();
  }
}
