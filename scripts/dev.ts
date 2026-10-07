import { resolve, relative, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { startApp } from '../src/service/server.ts';
const root = resolve(
  process.env['BVE_RUNTIME_ROOT'] ?? resolve(homedir(), '.bve-workspace'),
);
const checkout = resolve(import.meta.dirname, '..'),
  fromCheckout = relative(checkout, root);
if (
  fromCheckout === '' ||
  (!fromCheckout.startsWith('..') && !isAbsolute(fromCheckout))
)
  throw new Error('BVE_RUNTIME_ROOT must be outside the source checkout');
const port = Number(process.env['BVE_PORT'] ?? 4173);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
  throw new Error('Invalid BVE_PORT');
const app = await startApp(root, port);
console.log('Local workspace: ' + app.origin + ' (manual providers only)');
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
