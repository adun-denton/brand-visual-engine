// Test-only IPC. No fixture control or transport endpoints enter the production service.
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

export interface FixtureReceipt {
  type: 'bve-fixture-closed';
  id: string;
  offlineTransportCalls: number;
  realProviderCalls: 0;
}
export interface FixtureProcess {
  child: ChildProcess;
  origin: string;
  closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}
const timeoutMs = 15000;
// Bound authored-media/service startup separately from shutdown. Windows CI exceeded
// the original 15-second readiness deadline; shutdown still has the tighter bound.
const startupTimeoutMs = 60000;
async function bounded<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timer: NodeJS.Timeout;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
// Force termination is failure cleanup only, never passing evidence or a closed-copy boundary.
async function forceCleanup(fixture: Pick<FixtureProcess, 'child' | 'closed'>) {
  if (fixture.child.exitCode === null && fixture.child.signalCode === null)
    fixture.child.kill('SIGKILL');
  await bounded(
    fixture.closed,
    5000,
    'Fixture failed to terminate during cleanup',
  );
}
export async function startFixture(
  root: string,
  port: number,
  mode: string,
): Promise<FixtureProcess> {
  const child = spawn(
    process.execPath,
    ['scripts/provider-browser-service.ts', root, String(port), mode],
    {
      cwd: resolve(import.meta.dirname, '..'),
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  );
  let diagnostic = '';
  for (const stream of [child.stdout!, child.stderr!])
    stream.on('data', (b) => {
      diagnostic = (diagnostic + String(b)).slice(-8000);
    });
  const closed = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((r) => child.once('close', (code, signal) => r({ code, signal })));
  let ready!: (message: unknown) => void;
  let failed!: (error: Error) => void;
  try {
    const origin = await bounded(
      new Promise<string>((r, reject) => {
        ready = (message) => {
          const m = message as { type?: unknown; origin?: unknown } | null;
          if (
            m?.type === 'bve-fixture-ready' &&
            typeof m.origin === 'string' &&
            /^http:\/\/127\.0\.0\.1:\d+$/.test(m.origin)
          )
            r(m.origin);
          else reject(new Error('Invalid fixture startup acknowledgment'));
        };
        failed = reject;
        child.on('message', ready);
        child.once('error', failed);
        void closed.then(({ code }) =>
          reject(
            new Error(
              'Fixture exited before ready: ' + code + '\n' + diagnostic,
            ),
          ),
        );
      }),
      startupTimeoutMs,
      'Fixture service did not acknowledge startup',
    );
    return { child, origin, closed };
  } catch (e) {
    await forceCleanup({ child, closed });
    throw new Error(
      (e instanceof Error ? e.message : 'Fixture startup failed') +
        '\n' +
        diagnostic,
    );
  } finally {
    child.off('message', ready);
    child.off('error', failed);
  }
}
export async function stopFixture(
  fixture: FixtureProcess,
): Promise<FixtureReceipt> {
  const id = randomUUID();
  let receipt: FixtureReceipt | null = null;
  let invalid = false;
  const onMessage = (message: unknown) => {
    const m = message as Partial<FixtureReceipt> | null;
    if (
      receipt ||
      m?.type !== 'bve-fixture-closed' ||
      m.id !== id ||
      !Number.isSafeInteger(m.offlineTransportCalls) ||
      m.offlineTransportCalls! < 0 ||
      m.realProviderCalls !== 0
    )
      invalid = true;
    else receipt = m as FixtureReceipt;
  };
  fixture.child.on('message', onMessage);
  try {
    if (!fixture.child.connected)
      throw new Error('Fixture IPC disconnected before shutdown');
    await bounded(
      new Promise<void>((r, reject) =>
        fixture.child.send({ type: 'bve-fixture-shutdown', id }, (e) =>
          e ? reject(e) : r(),
        ),
      ),
      timeoutMs,
      'Fixture shutdown request did not send',
    );
    // close waits for exit AND stdout/stderr/IPC completion, rather than exit alone.
    const exit = await bounded(
      fixture.closed,
      timeoutMs,
      'Fixture did not close after shutdown',
    );
    if (exit.code !== 0 || exit.signal !== null || invalid || !receipt)
      throw new Error(
        'Fixture shutdown lacked a unique complete acknowledgment and clean close',
      );
    return receipt;
  } catch (e) {
    await forceCleanup(fixture);
    throw e;
  } finally {
    fixture.child.off('message', onMessage);
  }
}
