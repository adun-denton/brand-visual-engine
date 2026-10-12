import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApp } from '../src/service/server.ts';
import { ensurePrivateDirectory, writePrivateJson } from '../src/service/private-storage.ts';
import type { ChatDriver } from '../src/service/chat-contracts.ts';

test('initial workspace reports stored/expired sign-in locally without claiming account health or exposing credentials', async () => {
  for (const state of ['missing', 'stored', 'expired'] as const) {
    const root = mkdtempSync(join(tmpdir(), 'bve-status-'));
    if (state !== 'missing') {
      const dir = join(root, 'chat-account-private'); ensurePrivateDirectory(dir);
      writePrivateJson(join(dir, 'credentials.json'), {access_token: 'synthetic-never-sent', subject: 'synthetic-subject', expiresAt: Date.now() + (state === 'stored' ? 3600000 : -3600000)});
    }
    const app = await startApp(root, 0);
    try {
      const response = await fetch(app.origin + '/api/v1/chat/status');
      assert.equal(response.status, 200);
      const status = await response.json();
      assert.deepEqual(status, {connection: state === 'missing' ? 'Sign-in required' : state === 'stored' ? 'Sign-in saved · connection unverified' : 'Sign-in saved · renewal required'});
      assert.ok(!JSON.stringify(status).includes('synthetic'));
      assert.equal(app.chat.driver, null);
    } finally { await app.close(); }
  }
});

test('a configured account driver does not imply healthy sign-in; completed text does not imply candidates', async () => {
  const driver: ChatDriver = {kind: 'account', close: async () => {}, run: async () => ({status: 'completed', model: 'configured-alias', usage: null})};
  const app = await startApp(mkdtempSync(join(tmpdir(), 'bve-text-only-')), 0, undefined, undefined, {chatDriver: driver});
  try {
    assert.equal(app.chat.connection(), 'Sign-in required');
    const result = app.chat.send({projectId: null, text: 'Synthetic text-only reply', clientId: 'text-only', focus: {view: 'studio', page: null, resources: [], target: null}});
    await Promise.all([...app.chat.pending]);
    const turn = app.chat.state(result.projectId).session.turns[0]!;
    assert.equal(turn.status, 'completed');
    assert.equal(turn.detail, 'Protocol completed. No design candidates were created.');
    assert.deepEqual(turn.candidates, []);
  } finally { await app.close(); }
});
