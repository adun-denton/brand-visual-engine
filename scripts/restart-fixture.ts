import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '../src/store.ts';
import { sourceRaster, website } from '../src/fixtures.ts';
const [mode, root] = process.argv.slice(2);
if (!root) throw new Error('fixture root required');
const store = new Store(root);
if (mode === 'seed') {
  const project = website(); store.createProject(project);
  const asset = store.addAsset(project.id, 'hero', sourceRaster());
  store.accept(project.id, 'hero', asset.id, null, 'restart-fixture', 'initial fixture');
  const job = store.createJob({ projectId: project.id, sectionId: 'hero', sourceVersionId: asset.id,
    regionId: null, provider: 'fixture', recipeVersion: 'fixture-v1', instruction: 'fixture', referenceIds: [], settings: null });
  store.transition(job.id, 'running');
  writeFileSync(join(root, 'restart-ids.json'), JSON.stringify({ assetId: asset.id, jobId: job.id }));
  process.exit(0); // Deliberately omit Store.close() to model process exit after committed writes.
} else if (mode === 'inspect') {
  const ids = JSON.parse(readFileSync(join(root, 'restart-ids.json'), 'utf8')) as { assetId: string; jobId: string };
  console.log(JSON.stringify({ accepted: store.project('fictional-service').sections[0]!.acceptedVersionId === ids.assetId,
    state: store.job(ids.jobId).state, outputs: store.job(ids.jobId).outputVersionIds, decisionCount: store.decisions().length }));
  store.close();
} else throw new Error('unknown fixture mode');
