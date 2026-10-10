// Isolated child process: a crashing response handler must fail the parent regression.
import { startApp } from '../src/service/server.ts';
import { seedRepairPage } from './inference-repair-fixture.ts';
import { reference, digest, packet } from '../src/kernel/packets.ts';
import { pageSignature } from '../src/modules/website/page.ts';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
const root = process.argv[2]!;
const app = await startApp(root, 0, undefined, undefined, { aiResponseFixture: true });
const project = () => app.workspace.create({ title: 'HTTP boundary fixture', mode: 'freeroam', visualOS: null, palette: null }).project!;
const p = project(), foreign = project();
const page = await seedRepairPage(app.pages, p.id);
app.pages.accept(p.id, { artifact: reference(page), expected: null, reviewedHash: pageSignature(page.payload.state),
  reason: 'Mechanical exact acceptance', acknowledgeFindings: true });
const foreignPage = await seedRepairPage(app.pages, foreign.id);
app.pages.prepare(p.id, { expectedProject: reference(p), base: reference(page), operation: 'revise',
  instruction: 'Valid HTTP download control', resources: [], locks: [] });
const request = app.pages.state(p.id).requests.at(-1)!;
const corrupt = await seedRepairPage(app.pages, p.id);
const db = new DatabaseSync(join(root, 'kernel.sqlite'));
const {integrity: _, ...body} = corrupt;
const broken = process.argv[3] === 'JSON state augmentation'
  ? packet({...body,payload:{...corrupt.payload,state:{...corrupt.payload.state,
      page:{...corrupt.payload.state.page,root:{...corrupt.payload.state.page.root,id:''}}}}})
  : {...corrupt,integrity:'0'.repeat(64)};
db.prepare('UPDATE kernel_packets SET body=? WHERE id=? AND version=?')
  .run(JSON.stringify(broken), corrupt.id, corrupt.version);
const snapshot = () => digest(JSON.parse(JSON.stringify(['kernel_packets','kernel_events','kernel_selections'].map(table =>
  db.prepare('SELECT * FROM ' + table + ' ORDER BY 1,2').all()))));
process.on('message', m => { if (m === 'snapshot') process.send?.({ snapshot: snapshot() }); });
process.send?.({ origin: app.origin, project: p.id, page: reference(page), foreign: reference(foreignPage),
  corrupt: reference(corrupt), request: reference(request), snapshot: snapshot() });
process.on('SIGTERM', () => { db.close(); void app.close().then(() => process.exit(0)); });
