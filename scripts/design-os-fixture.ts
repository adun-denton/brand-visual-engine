import { KernelStore } from '../src/kernel/store.ts';
import { fixtureServices } from '../src/fixture-services.ts';
import { syntheticProject, syntheticVisualOS } from '../src/fixtures-design-os.ts';
import { exploreWebsite } from '../src/modules/website/design.ts';
import { reference } from '../src/kernel/packets.ts';
import { artifactMetadata, reconnect } from '../src/kernel/metadata.ts';
import type { IterationBundle, ModuleProject } from '../src/kernel/contracts.ts';

const [action, root] = process.argv.slice(2);
if (!root || !['seed', 'inspect'].includes(action!)) throw new Error('usage: seed|inspect ROOT');
const store = new KernelStore(root, fixtureServices);
try {
  if (action === 'seed') {
    const visual = store.put(syntheticVisualOS());
    for (const mode of ['branded', 'freeroam'] as const) {
      const project = store.put(syntheticProject(mode, mode === 'branded' ? visual : null));
      const round = exploreWebsite(project, mode + '-round');
      round.candidates.forEach(c => store.put(c)); store.put(round.bundle);
      const selected = store.select(reference(round.bundle), reference(round.candidates[4]!), 'fixture-human', 'choose synthetic direction');
      store.accept(project.id, 'landing-page', selected.payload.selection!, null, 'fixture-human', 'local synthetic acceptance', reference(selected));
    }
    console.log(JSON.stringify({ fixtureOnly: true, modes: 2, candidatesPerMode: 9 }));
  } else {
    const outcomes = ['branded', 'freeroam'].map(mode => {
      const project = store.get<ModuleProject>({ id: 'website-' + mode, version: 1, freshness: 'pinned' });
      const bundle = store.get<IterationBundle>({ id: mode + '-round', version: 2, freshness: 'pinned' });
      const artifact = store.get(bundle.payload.selection!);
      const metadata = artifactMetadata(artifact, project, project.payload.visualOSRef, reference(bundle), ref => store.lookup(ref));
      const links = reconnect(metadata, ref => store.lookup(ref));
      const events = store.ledger(project.id).events;
      return { mode: project.payload.mode, accepted: store.selected(project.id, 'landing-page')?.id === artifact.id,
        bundleVersion: bundle.version, candidates: bundle.payload.candidates.length,
        hasSelection: events.some(e => e.kind === 'selection'), hasAcceptance: events.some(e => e.kind === 'acceptance'),
        missingMetadataRefs: links.missing.length, unresolved: Object.entries(project.payload.resolvedContext.fields).filter(([, f]) => f.placeholder).map(([key]) => key) };
    });
    console.log(JSON.stringify({ outcomes, visualOSVersion: store.currentVersion('visual-os-synthetic') }));
  }
} finally { store.close(); }
