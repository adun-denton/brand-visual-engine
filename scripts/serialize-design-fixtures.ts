import { writeFileSync } from 'node:fs';
import { syntheticCapabilities, syntheticProject, syntheticVisualOS } from '../src/fixtures-design-os.ts';
import { exploreWebsite, explorationTemplate } from '../src/modules/website/design.ts';
import { artifactMetadata } from '../src/kernel/metadata.ts';
import { packet, reference } from '../src/kernel/packets.ts';
const visualOS = syntheticVisualOS();
const modes = (['branded', 'freeroam'] as const).map(mode => {
  const project = syntheticProject(mode, mode === 'branded' ? visualOS : null);
  const round = exploreWebsite(project, mode + '-round');
  return { project, ...round, metadata: artifactMetadata(round.candidates[4]!, project, project.payload.visualOSRef, reference(round.bundle)) };
});
writeFileSync(new URL('../fixtures/design-os.json', import.meta.url), JSON.stringify({ fixtureOnly: true, visualOS, modes,
  template: packet({ type: 'bundle-template', id: 'website-exploration-template', payload: explorationTemplate }),
  capabilities: syntheticCapabilities() }, null, 2) + '\n');
