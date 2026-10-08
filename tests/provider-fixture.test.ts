import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  startFixture,
  stopFixture,
} from '../scripts/provider-browser-lifecycle.ts';
import { Workspace } from '../src/service/workspace.ts';

test('test-only fixture acknowledges store closure and drains child/stdio before copying; failed startup cleans up', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bve-fixture-ipc-'));
  try {
    const fixture = await startFixture(join(root, 'source'), 0, 'unconfigured');
    const receipt = await stopFixture(fixture);
    assert.equal(receipt.type, 'bve-fixture-closed');
    assert.equal(receipt.offlineTransportCalls, 0);
    assert.equal(receipt.realProviderCalls, 0);
    assert.deepEqual(await fixture.closed, { code: 0, signal: null });
    assert.equal(fixture.child.stdout!.readableEnded, true);
    assert.equal(fixture.child.stderr!.readableEnded, true);
    cpSync(join(root, 'source'), join(root, 'copy'), { recursive: true });
    const restored = new Workspace(join(root, 'copy'));
    restored.close();
    const badRoot = join(root, 'not-a-directory');
    writeFileSync(badRoot, 'Synthetic invalid fixture root');
    await assert.rejects(
      startFixture(badRoot, 0, 'fixture'),
      /Fixture exited before ready/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
