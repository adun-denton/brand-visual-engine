import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.ts';
import { completeFixture, sourceRaster, website, regionFixture, providerFixture } from '../src/fixtures.ts';
import { outsideDifference } from '../src/raster.ts';

const root = mkdtempSync(join(tmpdir(), 'bve-smoke-'));
try {
  let store = new Store(root);
  const project = website(); store.createProject(project);
  const source = store.addAsset(project.id, 'hero', sourceRaster());
  store.accept(project.id, 'hero', source.id, null, 'fixture-reviewer', 'initial fixture');
  const region = store.createRegion(source.id, regionFixture().mask);
  const fixture = providerFixture();
  const job = store.createJob({ projectId: project.id, sectionId: 'hero', sourceVersionId: source.id,
    regionId: region.id, provider: 'fixture', recipeVersion: fixture.recipeVersion,
    instruction: fixture.instruction, referenceIds: fixture.referenceIds, settings: fixture.settings });
  const outputId = completeFixture(store, job.id, 'success')!;
  const changedOutside = outsideDifference(store.readRaster(source.id), store.readRaster(outputId), region);
  if (changedOutside !== 0) throw new Error('outside-region invariant failed');
  store.accept(project.id, 'hero', outputId, source.id, 'fixture-reviewer', 'selected material fixture');
  store.close(); store = new Store(root);
  const handoff = store.handoff(project.id);
  if (handoff.sections[0]!.asset!.id !== outputId) throw new Error('restart invariant failed');
  console.log(JSON.stringify({ fixtureOnly: true, sections: handoff.sections.map(s => s.id),
    changedOutsideChannels: changedOutside, acceptedSurvivesReopen: true,
    candidateParentMatchesSource: store.asset(outputId).parentId === source.id,
    unresolved: handoff.unresolved }, null, 2));
  store.close();
} finally { rmSync(root, { recursive: true, force: true }); }
