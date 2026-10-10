// Mechanical regression data only. No AI/provider call or designer acceptance.
import type { Page } from '../src/modules/website/page.ts';
import { reference } from '../src/kernel/packets.ts';
import type { Pages } from '../src/service/pages.ts';
export const repairPage = (title = 'Current mechanical page'): Page => ({
  version: 1, title, language: 'en',
  root: { id: 'root', kind: 'container', style: { padding: 24 }, children: [
    { id: 'heading', kind: 'heading', level: 1, text: title },
  ] }, media: {}, responsive: [], unresolved: [],
});
export function repairResult(q: {id: string; integrity: string}, title = 'Current mechanical page') {
  return { schema: 'bve.inference-result', version: 1, requestId: q.id, requestHash: q.integrity,
    candidates: [{ label: title, rationale: 'Mechanical boundary regression; no inference quality claim',
      page: repairPage(title), mediaRequirements: [], proposedActions: [] }], findings: [] };
}
export async function seedRepairPage(pages: Pages, pid: string) {
  pages.prepare(pid, { expectedProject: reference(pages.workspace.project(pid)), base: null,
    operation: 'create', instruction: 'Mechanical fixture', resources: [], locks: [] });
  const q = pages.state(pid).requests.at(-1)!;
  await pages.apply(pid, { request: reference(q), response: repairResult(q),
    source: 'Mechanical fixture; no AI call', model: null, aiAuthorship: true });
  return pages.state(pid).pages.at(-1)!;
}
