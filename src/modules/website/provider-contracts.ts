import type { VersionRef, Value } from '../../kernel/contracts.ts';
import type { ImageInfo } from '../../service/assets.ts';
import type {
  ReferenceInput,
  DirectionProposal,
} from './workspace-contracts.ts';
import { parseImageInfo } from './workspace-contracts.ts';
import {
  record,
  string,
  ref,
  list,
  choice,
  integer,
  bool,
} from '../../service/validation.ts';
export const operations = ['generate', 'edit', 'assistant'] as const;
export const statuses = [
  'queued',
  'submitting',
  'running',
  'returned',
  'failed',
  'cancelled-locally',
  'outcome-uncertain',
] as const;
export interface Proposal {
  title: string;
  rationale: string;
  constraints: string[];
  uncertainty: string;
  unresolved: string[];
}
export function parseProposal(x: unknown): Proposal {
  const p = record(x, [
    'title',
    'rationale',
    'constraints',
    'uncertainty',
    'unresolved',
  ]);
  return {
    title: string(p['title'], 160),
    rationale: string(p['rationale']),
    constraints: list(p['constraints'], (x) => string(x, 500)),
    uncertainty: string(p['uncertainty']),
    unresolved: list(p['unresolved'], (x) => string(x, 500)),
  };
}
export interface ProviderRequest {
  contractVersion: 1;
  attemptId: string;
  project: VersionRef;
  artifact: VersionRef | null;
  scope: 'hero' | 'services' | 'proof' | 'contact';
  operation: (typeof operations)[number];
  instructions: string;
  inputAsset: ImageInfo | null;
  references: (ReferenceInput & { image: ImageInfo })[];
  selection: VersionRef | null;
  executorId: string;
  model: string;
  recipe: string;
  settings: {
    n: 1;
    size: string;
    quality: string;
    outputFormat: 'png';
    background: 'opaque';
    maxOutputTokens: number;
  };
}
export interface Observation {
  at: string;
  kind: string;
  message: string;
  transportRequestId: string | null;
  resultId: string | null;
  reportedModel: string | null;
  usage: Value | null;
  reportedSettings: Value | null;
  actualCostUSD: number | null;
}
export interface ProviderJob {
  request: ProviderRequest;
  status: (typeof statuses)[number];
  outputs: VersionRef[];
  observations: Observation[];
}
export interface ApiImage {
  image: ImageInfo;
  job: VersionRef;
  originalArtifact: VersionRef;
  parentAsset: ImageInfo | null;
  outcome: 'candidate' | 'late' | 'late-cancelled';
  providerPath: 'api';
  requestedModel: string;
  reportedModel: string | null;
  settings: ProviderRequest['settings'];
  recipe: string;
  transportRequestId: string | null;
  resultId: string | null;
  usage: Value | null;
  seed: null;
  cfg: null;
  actualCostUSD: null;
}
export interface AssistantProposal {
  job: VersionRef;
  project: VersionRef;
  proposal: Proposal;
  sourceReferences: VersionRef[];
  reviewed: false;
}
export interface AssistantReview {
  originalProposal: VersionRef;
  proposal: DirectionProposal;
  actor: string;
  reason: string;
  at: string;
}
export interface RunPolicy {
  runId: string;
  approval: string;
  maxCalls: number;
  capUSD: number;
  reserveUSD: number;
  alternativeCallBoundApproved: true;
  models: string[];
}
export interface BudgetState {
  policy: RunPolicy;
  reservations: {
    attempt: VersionRef;
    amountUSD: number;
    disposition: 'reserved' | 'retained' | 'released';
    reason: string;
  }[];
}
export function parsePolicy(x: unknown): RunPolicy {
  const p = record(x, [
    'runId',
    'approval',
    'maxCalls',
    'capUSD',
    'reserveUSD',
    'alternativeCallBoundApproved',
    'models',
  ]);
  for (const k of ['capUSD', 'reserveUSD'])
    if (
      typeof p[k] !== 'number' ||
      !Number.isFinite(p[k]) ||
      Number(p[k]) <= 0 ||
      Number(p[k]) > 1000
    )
      throw new Error('Invalid bounded budget');
  if (p['alternativeCallBoundApproved'] !== true)
    throw new Error('Explicit alternative call bound approval required');
  return {
    runId: string(p['runId'], 100),
    approval: string(p['approval'], 500),
    maxCalls: integer(p['maxCalls'], 100),
    capUSD: Number(p['capUSD']),
    reserveUSD: Number(p['reserveUSD']),
    alternativeCallBoundApproved: true,
    models: list(p['models'], (x) => string(x, 100), 10),
  };
}
export function parseRequest(x: unknown): ProviderRequest {
  const p = record(x, [
    'contractVersion',
    'attemptId',
    'project',
    'artifact',
    'scope',
    'operation',
    'instructions',
    'inputAsset',
    'references',
    'selection',
    'executorId',
    'model',
    'recipe',
    'settings',
  ]);
  if (p['contractVersion'] !== 1)
    throw new Error('Unsupported request contract');
  const s = record(p['settings'], [
    'n',
    'size',
    'quality',
    'outputFormat',
    'background',
    'maxOutputTokens',
  ]);
  if (
    s['n'] !== 1 ||
    s['outputFormat'] !== 'png' ||
    s['background'] !== 'opaque'
  )
    throw new Error('Unsupported image controls');
  const refs = list(
    p['references'],
    (x) => {
      const r = record(x, [
        'artifact',
        'label',
        'role',
        'scope',
        'selected',
        'image',
      ]);
      return {
        artifact: ref(r['artifact']),
        label: string(r['label'], 100),
        role: choice(r['role'], [
          'composition',
          'typography',
          'palette',
          'material',
          'imagery',
          'form',
          'avoid',
        ]),
        scope: choice(r['scope'], [
          'landing-page',
          'hero',
          'services',
          'proof',
          'contact',
        ]),
        selected: bool(r['selected']),
        image: parseImageInfo(r['image']),
      };
    },
    4,
  );
  const operation = choice(p['operation'], operations),
    artifact = p['artifact'] === null ? null : ref(p['artifact']),
    inputAsset =
      p['inputAsset'] === null ? null : parseImageInfo(p['inputAsset']);
  if (
    (operation === 'assistant') !== (artifact === null) ||
    (operation === 'edit') !== (inputAsset !== null)
  )
    throw new Error('Operation input mismatch');
  return {
    contractVersion: 1,
    attemptId: string(p['attemptId'], 160),
    project: ref(p['project']),
    artifact,
    scope: choice(p['scope'], ['hero', 'services', 'proof', 'contact']),
    operation,
    instructions: string(p['instructions']),
    inputAsset,
    references: refs,
    selection: p['selection'] === null ? null : ref(p['selection']),
    executorId: string(p['executorId'], 100),
    model: string(p['model'], 100),
    recipe: string(p['recipe'], 100),
    settings: {
      n: 1,
      size: choice(s['size'], ['1024x1024', '1536x1024', '1024x1536']),
      quality: choice(s['quality'], ['low', 'medium', 'high']),
      outputFormat: 'png',
      background: 'opaque',
      maxOutputTokens: integer(s['maxOutputTokens'], 2000),
    },
  };
}
export function validateProviderArtifact(p: Record<string, unknown>): boolean {
  if (
    ![
      'website-provider-job',
      'website-api-image',
      'website-assistant-proposal',
      'website-assistant-review',
      'website-image-comparison',
      'website-provider-budget',
    ].includes(String(p['kind']))
  )
    return false;
  const kind = p['kind'];
  const s = p['state'];
  record(p['lockedValues'], []);
  choice(
    p['scope'],
    kind === 'website-provider-budget'
      ? ['landing-page']
      : ['hero', 'services', 'proof', 'contact'],
  );
  if (kind === 'website-provider-job') {
    const j = record(s, ['request', 'status', 'outputs', 'observations']);
    const m = parseRequest(j['request']);
    if (m.scope !== p['scope']) throw new Error('Request scope mismatch');
    choice(j['status'], statuses);
    list(j['outputs'], ref, 100);
    list(
      j['observations'],
      (x) => {
        const o = record(x, [
          'at',
          'kind',
          'message',
          'transportRequestId',
          'resultId',
          'reportedModel',
          'usage',
          'reportedSettings',
          'actualCostUSD',
        ]);
        string(o['at'], 50);
        string(o['kind'], 100);
        string(o['message'], 500);
        for (const k of ['transportRequestId', 'resultId', 'reportedModel'])
          if (o[k] !== null) string(o[k], 200);
        if (o['actualCostUSD'] !== null) throw new Error('Billing is unknown');
        return o;
      },
      100,
    );
  } else if (kind === 'website-api-image') {
    const i = record(s, [
      'image',
      'job',
      'originalArtifact',
      'parentAsset',
      'outcome',
      'providerPath',
      'requestedModel',
      'reportedModel',
      'settings',
      'recipe',
      'transportRequestId',
      'resultId',
      'usage',
      'seed',
      'cfg',
      'actualCostUSD',
    ]);
    parseImageInfo(i['image']);
    ref(i['job']);
    ref(i['originalArtifact']);
    if (i['parentAsset'] !== null) parseImageInfo(i['parentAsset']);
    choice(i['outcome'], ['candidate', 'late', 'late-cancelled']);
    if (i['providerPath'] !== 'api') throw new Error('Invalid API origin');
    string(i['requestedModel'], 100);
    string(i['recipe'], 100);
    for (const k of ['reportedModel', 'transportRequestId', 'resultId'])
      if (i[k] !== null) string(i[k], 200);
    for (const k of ['seed', 'cfg', 'actualCostUSD'])
      if (i[k] !== null) throw new Error('Unknown metadata required');
  } else if (kind === 'website-assistant-proposal') {
    const a = record(s, [
      'job',
      'project',
      'proposal',
      'sourceReferences',
      'reviewed',
    ]);
    ref(a['job']);
    ref(a['project']);
    parseProposal(a['proposal']);
    list(a['sourceReferences'], ref, 4);
    if (a['reviewed'] !== false) throw new Error('Model cannot review');
  } else if (kind === 'website-assistant-review') {
    const a = record(s, [
      'originalProposal',
      'proposal',
      'actor',
      'reason',
      'at',
    ]);
    ref(a['originalProposal']);
    const proposal = record(a['proposal'], [
      'title',
      'rationale',
      'constraints',
      'uncertainty',
      'unresolved',
      'sourceReferences',
      'reviewed',
      'source',
    ]);
    parseProposal(
      Object.fromEntries(
        Object.entries(proposal).filter(
          ([k]) => !['sourceReferences', 'reviewed', 'source'].includes(k),
        ),
      ),
    );
    if (proposal['reviewed'] !== true) throw new Error('Human review required');
    list(proposal['sourceReferences'], ref, 4);
    string(proposal['source'], 500);
    string(a['actor'], 100);
    string(a['reason'], 500);
    string(a['at'], 50);
  } else if (kind === 'website-image-comparison') {
    const c = record(s, ['compared', 'selected', 'reason']);
    const compared = list(c['compared'], ref, 2);
    if (compared.length !== 2) throw new Error('Compare two images');
    if (c['selected'] !== null) {
      const r = ref(c['selected']);
      if (!compared.some((x) => x.id === r.id && x.version === r.version))
        throw new Error('Selection outside comparison');
    }
    string(c['reason'], 500);
  } else {
    const b = record(s, ['policy', 'reservations']);
    parsePolicy(b['policy']);
    list(
      b['reservations'],
      (x) => {
        const r = record(x, ['attempt', 'amountUSD', 'disposition', 'reason']);
        ref(r['attempt']);
        if (
          typeof r['amountUSD'] !== 'number' ||
          !Number.isFinite(r['amountUSD']) ||
          r['amountUSD'] <= 0
        )
          throw new Error('Invalid reservation');
        choice(r['disposition'], ['reserved', 'retained', 'released']);
        string(r['reason'], 500);
        return r;
      },
      100,
    );
  }
  return true;
}
