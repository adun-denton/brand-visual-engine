import type { CapabilityRegistry, CapabilityRequest, ExecutorKind, Placeholder, SemanticVerifier } from './contracts.ts';
import { placeholder } from './packets.ts';
export function resolveCapability(registry: CapabilityRegistry, request: CapabilityRequest,
    policy: 'auto' | ExecutorKind = 'auto'): { status: 'available'; executorId: string }
      | { status: 'unavailable'; placeholder: Placeholder } {
  const capability = registry.capabilities.find(c => c.id === request.capabilityId
    && c.inputType === request.inputType && c.outputType === request.outputType);
  const executor = capability && registry.executors.find(e => e.available
    && e.capabilities.includes(capability.id) && (policy === 'auto' || e.kind === policy));
  return executor ? { status: 'available', executorId: executor.id }
    : { status: 'unavailable', placeholder: placeholder(request.capabilityId, 'No compatible authorized executor is available') };
}
export const semanticVerifierStub: SemanticVerifier = {
  async verify() { return { status: 'not-run', findings: [] }; },
};
