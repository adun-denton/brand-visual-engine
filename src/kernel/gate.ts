import type { LocalField, NodePacket, PacketType, PortContract, VersionRef, VisualOS } from './contracts.ts';
import { atPath, canonical, digest } from './packets.ts';
import { resolveContext } from './context.ts';
import { validateMetadata } from './metadata.ts';
export interface GateEnvironment {
  lookup(ref: VersionRef): NodePacket<unknown> | null;
  currentVersion(id: string): number | null;
  assetExists(id: string, checksum: string): boolean;
  moduleExists(id: string): boolean;
  validateArtifact(moduleId: string, payload: Record<string, unknown>): void;
  grantedPermissions: string[];
}
export const writePort = (type: PacketType): PortContract => ({ packetType: type, schemaVersion: 1,
  requiredFields: [], requiredPermissions: ['write'], preserve: [], reviewOnChange: [] });
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error('expected object');
  return value as Record<string, unknown>;
}
export function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('required string'); return value;
}
export function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('expected array'); return Array.from(value);
}
function strings(value: unknown): string[] { return list(value).map(text); }
function positive(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error('invalid version/count'); return Number(value);
}
function boolean(value: unknown): void { if (typeof value !== 'boolean') throw new Error('expected boolean'); }
function member(value: unknown, options: string[]): string {
  if (!options.includes(text(value))) throw new Error('unsupported enum'); return value as string;
}
export function versionRef(value: unknown): VersionRef {
  const r = object(value); return { id: text(r['id']), version: positive(r['version']),
    freshness: member(r['freshness'], ['pinned', 'current']) as VersionRef['freshness'] };
}
function placeholders(value: unknown): void {
  for (const item of list(value)) {
    const p = object(item); text(p['key']); text(p['expected']); text(p['reason']);
    for (const key of ['dependsOn', 'mayProceed', 'blocks', 'prohibitedAssumptions', 'resolutionRoutes']) strings(p[key]);
    if (!list(p['resolutionRoutes']).length || !list(p['prohibitedAssumptions']).length) throw new Error('placeholder lacks resolution/assumption boundary');
  }
}
function dimensions(value: unknown): void {
  for (const item of list(value)) {
    const d = object(item); text(d['key']); text(d['family']);
    if (typeof d['relative'] !== 'number' || d['relative'] < 0 || d['relative'] > 1) throw new Error('relative dimension out of range');
  }
}
function capability(value: unknown): void {
  const r = object(value); text(r['capabilityId']); text(r['inputType']); text(r['outputType']);
}
function resolved(value: unknown): void {
  const context = object(value); const mode = member(context['mode'], ['branded', 'freeroam']);
  for (const item of Object.values(object(context['fields']))) {
    const f = object(item); boolean(f['reviewRequired']);
    for (const key of ['inherited', 'localOverride', 'derived']) if (f[key] !== null) {
      const v = object(f[key]); canonical(v['value']); if (key === 'inherited') versionRef(v['source']);
    }
    if (mode === 'freeroam' && f['inherited'] !== null) throw new Error('Freeroam inheritance is forbidden');
    if (f['placeholder'] !== null) placeholders([f['placeholder']]);
    const expectedOrigin = f['localOverride'] !== null ? 'local-override' : f['derived'] !== null ? 'derived' : f['inherited'] !== null ? 'inherited' : null;
    if (expectedOrigin === null) {
      if (f['effective'] !== null || f['placeholder'] === null) throw new Error('unresolved field must retain Placeholder');
    } else {
      const effective = object(f['effective']);
      const source = object(f[expectedOrigin === 'local-override' ? 'localOverride' : expectedOrigin]);
      if (effective['origin'] !== expectedOrigin || canonical(effective['value']) !== canonical(source['value'])) throw new Error('invalid effective context');
    }
  }
}
function payloadSchema(type: PacketType, payload: unknown, env: GateEnvironment): VersionRef[] {
  const p = object(payload); const refs: VersionRef[] = [];
  const ref = (v: unknown) => { const r = versionRef(v); refs.push(r); return r; };
  switch (type) {
    case 'visual-os':
      for (const v of Object.values(object(p['values']))) { const x = object(v); canonical(x['value']); boolean(x['approved']); }
      placeholders(Object.values(object(p['placeholders']))); break;
    case 'module-project': {
      if (!env.moduleExists(text(p['moduleId']))) throw new Error('module is not implemented');
      const mode = member(p['mode'], ['branded', 'freeroam']);
      if (p['visualOSRef'] !== null) {
        if (mode === 'freeroam') throw new Error('Freeroam cannot mount context');
        if (env.lookup(ref(p['visualOSRef']))?.type !== 'visual-os') throw new Error('invalid mounted context');
      }
      for (const v of Object.values(object(p['localContext']))) {
        const f = object(v); boolean(f['hasOverride']); boolean(f['hasDerived']); boolean(f['reviewRequired']);
        canonical(f['override']); canonical(f['derived']); if (f['placeholder'] !== null) placeholders([f['placeholder']]);
      }
      resolved(p['resolvedContext']);
      const mounted = p['visualOSRef'] === null ? null : env.lookup(versionRef(p['visualOSRef'])) as NodePacket<VisualOS>;
      const expected = resolveContext(mode as 'branded' | 'freeroam', mounted,
        p['localContext'] as Record<string, LocalField>, Object.keys(object(object(p['resolvedContext'])['fields'])));
      if (canonical(expected) !== canonical(p['resolvedContext'])) throw new Error('context provenance mismatch');
      if (object(p['resolvedContext'])['mode'] !== mode) throw new Error('mode/context mismatch');
      for (const r of list(p['artifactRefs'])) ref(r); break;
    }
    case 'design-artifact':
      if (!env.moduleExists(text(p['moduleId']))) throw new Error('module is not implemented');
      text(p['kind']); text(p['scope']); object(p['lockedValues']); canonical(p['state']);
      env.validateArtifact(p['moduleId'] as string, p); break;
    case 'iteration-bundle': {
      ref(p['projectRef']); if (p['baseState'] !== null) ref(p['baseState']); text(p['scope']);
      object(p['inherited']); const locked = object(p['locked']); dimensions(p['exploring']); placeholders(p['placeholders']);
      const plan = object(p['variationPlan']); member(plan['strategy'], ['coherent-grid']);
      if (typeof plan['amplitude'] !== 'number' || plan['amplitude'] < 0 || plan['amplitude'] > 1) throw new Error('invalid variation amplitude');
      const count = positive(p['candidateCount']); if (count > 16) throw new Error('candidate bound exceeded');
      const candidates = list(p['candidates']).map(ref); const status = member(p['status'], ['draft', 'awaiting-capability', 'candidates-ready', 'selected']);
      if ((status === 'candidates-ready' || status === 'selected') && candidates.length !== count) throw new Error('incomplete candidate set');
      if (new Set(candidates.map(r => r.id + ':' + r.version)).size !== candidates.length) throw new Error('duplicate candidate');
      for (const candidate of candidates) {
        const packet = env.lookup(candidate);
        if (!packet || packet.type !== 'design-artifact') throw new Error('candidate is not an artifact');
        const artifact = object(packet.payload);
        if (artifact['scope'] !== p['scope']) throw new Error('candidate scope mismatch');
        for (const [key, value] of Object.entries(locked)) {
          if (canonical(object(artifact['lockedValues'])[key]) !== canonical(value)) throw new Error('candidate violated shared lock');
        }
      }
      if (p['selection'] !== null) {
        const selected = ref(p['selection']);
        if (!candidates.some(r => r.id === selected.id && r.version === selected.version) || status !== 'selected') throw new Error('invalid candidate selection');
      } else if (status === 'selected') throw new Error('selected bundle lacks selection');
      list(p['capabilities']).forEach(capability); list(p['executionRefs']).forEach(ref); break;
    }
    case 'bundle-template': {
      const allowed = ['name', 'scope', 'requiredContext', 'preservedPaths', 'dimensions', 'candidateCount', 'capabilityIds', 'variationStrategy'];
      if (Object.keys(p).some(k => !allowed.includes(k))) throw new Error('unsupported template field');
      text(p['name']); text(p['scope']); strings(p['requiredContext']); strings(p['preservedPaths']); dimensions(p['dimensions']);
      if (positive(p['candidateCount']) > 16) throw new Error('candidate bound exceeded');
      strings(p['capabilityIds']); member(p['variationStrategy'], ['coherent-grid']); break;
    }
    case 'capability-registry': {
      const capabilities = list(p['capabilities']).map(v => { const c = object(v); text(c['inputType']); text(c['outputType']); positive(c['version']); return text(c['id']); });
      const executors = list(p['executors']).map(v => { const e = object(v); member(e['kind'], ['cloud', 'local', 'chinvat', 'deterministic', 'human']); boolean(e['available']);
        if (strings(e['capabilities']).some(c => !capabilities.includes(c))) throw new Error('unknown executor capability');
        if (e['observedSettings'] !== null) object(e['observedSettings']); return text(e['id']); });
      if (new Set(capabilities).size !== capabilities.length || new Set(executors).size !== executors.length) throw new Error('duplicate registry identity'); break;
    }
    case 'artifact-metadata':
      // Portable pointers may be unavailable locally. Reconnection reports them without mounting.
      validateMetadata(p, env.lookup); break;
    case 'execution-record':
      capability(p['request']);
      if (env.lookup(ref(p['bundleRef']))?.type !== 'iteration-bundle') throw new Error('execution bundle mismatch');
      member(p['state'], ['awaiting', 'succeeded', 'failed', 'cancelled', 'outcome-unknown']);
      if (p['executorId'] !== null) text(p['executorId']); if (p['externalId'] !== null) text(p['externalId']);
      if (p['observedSettings'] !== null) object(p['observedSettings']); break;
  }
  return refs;
}

export function contractGate(input: unknown, port: PortContract, env: GateEnvironment, previous: NodePacket<unknown> | null = null): NodePacket<unknown> {
  const p = object(input); const types: PacketType[] = ['visual-os', 'module-project', 'design-artifact', 'iteration-bundle', 'bundle-template', 'capability-registry', 'artifact-metadata', 'execution-record'];
  const type = member(p['type'], types) as PacketType;
  if (type !== port.packetType || p['schemaVersion'] !== port.schemaVersion) throw new Error('port type/schema mismatch');
  text(p['id']); positive(p['version']); if (p['projectId'] !== null) text(p['projectId']);
  member(p['approval'], ['proposal', 'accepted', 'rejected']);
  const permissions = strings(p['permissions']);
  if (permissions.some(permission => !env.grantedPermissions.includes(permission)) || port.requiredPermissions.some(permission => !permissions.includes(permission))) throw new Error('permission denied');
  if (p['approval'] === 'accepted' && !env.grantedPermissions.includes('accept')) throw new Error('approval permission denied');
  const provenance = object(p['provenance']); text(provenance['actor']); text(provenance['source']);
  if (previous) {
    const parent = versionRef(provenance['previous']);
    if (p['id'] !== previous.id || p['type'] !== previous.type || p['projectId'] !== previous.projectId
        || p['version'] !== previous.version + 1 || parent.id !== previous.id || parent.version !== previous.version) throw new Error('invalid revision lineage');
  } else if (p['version'] !== 1 || provenance['previous'] !== null) throw new Error('invalid initial version');
  const { integrity, ...body } = p;
  if (digest(body) !== integrity) throw new Error('packet integrity mismatch');
  placeholders(p['placeholders']);
  for (const field of port.requiredFields) if (atPath(p['payload'], field) === undefined || atPath(p['payload'], field) === null) throw new Error('required input missing: ' + field);
  for (const constraint of list(p['constraints'])) {
    const c = object(constraint); const value = atPath(p['payload'], text(c['path']));
    if (value === undefined || canonical(value) !== canonical(c['value'])) throw new Error('locked value changed');
  }
  if (previous) for (const path of port.preserve) {
    const before = atPath(previous.payload, path), after = atPath(p['payload'], path);
    if (before === undefined || after === undefined || canonical(before) !== canonical(after)) throw new Error('preservation contract failed');
  }
  const refs = [...list(p['contextRefs']).map(versionRef), ...list(p['dependencies']).map(versionRef), ...payloadSchema(type, p['payload'], env)];
  const payload = object(p['payload']);
  if (type === 'artifact-metadata' && p['projectId'] !== null && p['projectId'] !== object(payload['project'])['id']) throw new Error('metadata envelope project mismatch');
  if (type === 'module-project' && p['projectId'] !== p['id']) throw new Error('project identity mismatch');
  if (type === 'design-artifact') {
    const ownerVersion = env.currentVersion(text(p['projectId']));
    const owner = ownerVersion === null ? null : env.lookup({ id: p['projectId'] as string, version: ownerVersion, freshness: 'pinned' });
    if (owner?.type !== 'module-project' || object(owner.payload)['moduleId'] !== payload['moduleId']) throw new Error('artifact owner mismatch');
  }
  if (type === 'iteration-bundle') {
    const project = env.lookup(versionRef(payload['projectRef']));
    if (project?.type !== 'module-project' || project.id !== p['projectId']) throw new Error('bundle project mismatch');
    if (payload['baseState'] !== null && env.lookup(versionRef(payload['baseState']))?.type !== 'design-artifact') throw new Error('bundle base is not an artifact');
  }
  for (const ref of refs) {
    const target = env.lookup(ref);
    if (!target) throw new Error('referenced version unavailable');
    if (ref.freshness === 'current' && env.currentVersion(ref.id) !== ref.version) throw new Error('stale dependency');
    if (p['projectId'] !== null && target.projectId !== null && target.projectId !== p['projectId']) throw new Error('reference project scope mismatch');
  }
  for (const asset of list(p['assets'])) {
    const a = object(asset); const hash = text(a['checksum']);
    if (!/^[a-f0-9]{64}$/.test(hash) || !env.assetExists(text(a['id']), hash)) throw new Error('referenced asset unavailable or corrupt');
  }
  return input as NodePacket<unknown>;
}

/** Recheck a stored immutable version at consumption, against its own predecessor, not the head. */
export function revalidatePacket(input: NodePacket<unknown>, port: PortContract, env: GateEnvironment): NodePacket<unknown> {
  const previous = input.version === 1 ? null : env.lookup({ id: input.id, version: input.version - 1, freshness: 'pinned' });
  if (input.version > 1 && previous === null) throw new Error('stored revision predecessor unavailable');
  return contractGate(input, port, env, previous);
}

/** Invalidation findings require human review; they are not semantic approval or a quality score. */
export function reviewChanges(previous: NodePacket<unknown>, next: NodePacket<unknown>, port: PortContract): string[] {
  return port.reviewOnChange.filter(path => {
    const before = atPath(previous.payload, path), after = atPath(next.payload, path);
    return before === undefined || after === undefined ? before !== after : canonical(before) !== canonical(after);
  });
}
