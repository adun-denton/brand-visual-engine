// Test-only fixture entry; never selected by production dev or environment.
import { startApp } from '../src/service/server.ts';
const app = await startApp(
  process.env['BVE_RUNTIME_ROOT']!,
  Number(process.env['BVE_PORT']),
  undefined,
  undefined,
  { directionFixture: true },
);
console.log(
  'Local workspace: ' + app.origin + ' (test fixture; no AI direction call)',
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
