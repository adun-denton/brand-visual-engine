import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { connect } from 'node:net';
import { request, get } from 'node:http';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDrainingServer } from '../src/service/http-drain.ts';
import { startApp } from '../src/service/server.ts';
import { reference } from '../src/kernel/packets.ts';
import { pageSignature } from '../src/modules/website/page.ts';
import { seedRepairPage } from '../scripts/inference-repair-fixture.ts';
import { syntheticCompositionImage } from '../scripts/composition-fixture.ts';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
};
async function within<T>(work: Promise<T>, ms = 2000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Error('Shutdown did not settle independently of the client')), ms);
    })]);
  } finally { clearTimeout(timer); }
}
async function listen(server: ReturnType<typeof createDrainingServer>['server']) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${(server.address() as {port: number}).port}`;
}
async function preconnect(server: ReturnType<typeof createDrainingServer>['server']) {
  const accepted = once(server, 'connection');
  const client = connect({ host: '127.0.0.1', port: (server.address() as {port: number}).port, allowHalfOpen: true });
  client.on('error', () => {});
  await Promise.all([accepted, once(client, 'connect')]);
  return client;
}

test('ordinary and repeated BVE shutdown releases accepted zero-byte TCP preconnections without client disconnect', {timeout: 8000}, async () => {
  const root = mkdtempSync(join(tmpdir(), 'bve-preconnect-'));
  const ordinary = await startApp(root, 0);
  await within(ordinary.close());
  for (let round = 0; round < 2; round++) {
    const app = await startApp(root, 0);
    assert.equal((await fetch(app.origin + '/api/v1/session')).status, 200);
    const client = await preconnect(app.server);
    try {
      const close = app.close();
      assert.equal(app.close(), close);
      await within(close);
      assert.equal(client.bytesRead, 0);
      assert.equal(client.bytesWritten, 0);
      assert.equal(app.server.listening, false);
    } finally { client.destroy(); await app.close(); }
  }
});

test('an admitted BVE upload completes during drain and survives closed-copy restart with accepted export unchanged', {timeout: 10000}, async () => {
  const root = mkdtempSync(join(tmpdir(), 'bve-upload-drain-'));
  const app = await startApp(root, 0, undefined, undefined, {aiResponseFixture: true});
  const project = app.workspace.create({title: 'Synthetic shutdown control', mode: 'freeroam', visualOS: null, palette: null}).project!;
  const page = await seedRepairPage(app.pages, project.id);
  app.pages.accept(project.id, {artifact: reference(page), expected: null, reviewedHash: pageSignature(page.payload.state), reason: 'Mechanical export preservation control', acknowledgeFindings: true});
  const accepted = app.pages.state(project.id).accepted[page.id]!;
  const before = (await app.pages.export(project.id, accepted)).bytes;
  const image = await syntheticCompositionImage();
  const session = await (await fetch(app.origin + '/api/v1/session')).json() as {token: string};
  const body = JSON.stringify({projectId: project.id, input: {expectedProject: reference(project), origin: null, file: image.toString('base64'), label: 'Synthetic in-flight original', role: 'reference', permission: 'Mechanical fixture'}});
  const admitted = once(app.server, 'request');
  const client = await preconnect(app.server);
  let req: ReturnType<typeof request> | undefined;
  try {
    const response = new Promise<{status: number | undefined; body: string}>((resolve, reject) => {
      req = request(app.origin + '/api/v1/page/add-media', {method: 'POST', agent: false, headers: {origin: app.origin, 'x-bve-token': session.token, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body)}}, res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve({status: res.statusCode, body: Buffer.concat(chunks).toString()}));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.write(body.slice(0, 40));
    });
    await admitted;
    const closing = app.close();
    let settled = false;
    void closing.then(() => { settled = true; });
    await new Promise(r => setTimeout(r, 50));
    assert.equal(settled, false);
    req!.end(body.slice(40));
    const result = await within(response);
    assert.equal(result.status, 200, result.body);
    await within(closing);
    assert.equal(client.bytesWritten, 0);
    const copy = root + '-closed-copy';
    cpSync(root, copy, {recursive: true});
    const restored = await startApp(copy, 0);
    try {
      assert.deepEqual(restored.pages.state(project.id).accepted[page.id], accepted);
      assert.deepEqual((await restored.pages.export(project.id, accepted)).bytes, before);
      const media = restored.pages.state(project.id).media;
      assert.equal(media.length, 1);
      assert.deepEqual(restored.workspace.assets.read(media[0]!.payload.state.image.id), image);
    } finally { await restored.close(); }
  } finally { req?.destroy(); client.destroy(); await app.close(); }
});

test('drain preserves the complete queued HTTP response before closing its connection', {timeout: 5000}, async () => {
  const release = deferred(), first = deferred();
  const bytes = Buffer.alloc(2 * 1024 * 1024, 83);
  const http = createDrainingServer(async (_req, res) => {
    res.writeHead(200, {'content-length': bytes.length});
    res.write(bytes.subarray(0, 1024));
    await release.promise;
    res.end(bytes.subarray(1024));
  });
  const origin = await listen(http.server);
  const received = new Promise<Buffer>((resolve, reject) => {
    get(origin, {agent: false}, res => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => { chunks.push(chunk); first.resolve(); });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
  try {
    await first.promise;
    const closing = http.close();
    release.resolve();
    assert.deepEqual(await within(received), bytes);
    await within(closing);
  } finally { release.resolve(); await http.close(); }
});

test('a stalled request body is disconnected at the transport deadline without closing over unfinished handler work', {timeout: 5000}, async () => {
  const admitted = deferred(), disconnected = deferred(), release = deferred();
  let handlerFinished = false;
  const http = createDrainingServer(async (req, _res) => {
    admitted.resolve();
    try { for await (const _chunk of req) { /* Deliberately incomplete client body. */ } } catch { disconnected.resolve(); }
    await release.promise;
    handlerFinished = true;
  }, 100);
  await listen(http.server);
  const client = await preconnect(http.server);
  client.write('POST / HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 100\r\n\r\n{');
  try {
    await admitted.promise;
    const closing = http.close();
    let settled = false;
    void closing.then(() => { settled = true; });
    await within(disconnected.promise);
    assert.equal(settled, false);
    assert.equal(handlerFinished, false);
    release.resolve();
    await within(closing);
    assert.equal(handlerFinished, true);
  } finally { release.resolve(); client.destroy(); await http.close(); }
});

test('response completion does not close stores over asynchronous handler work', {timeout: 5000}, async () => {
  const release = deferred();
  let finished = false;
  const http = createDrainingServer(async (_req, res) => {
    res.end('complete');
    await release.promise;
    finished = true;
  });
  const origin = await listen(http.server);
  try {
    assert.equal(await (await fetch(origin)).text(), 'complete');
    const closing = http.close();
    let settled = false;
    void closing.then(() => { settled = true; });
    await new Promise(r => setTimeout(r, 25));
    assert.equal(settled, false);
    release.resolve();
    await within(closing);
    assert.equal(finished, true);
  } finally { release.resolve(); await http.close(); }
});
