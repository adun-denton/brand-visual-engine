import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Workspace } from './workspace.ts';
import { InputError, record, string, id, ref, choice } from './validation.ts';
import { MAX_IMAGE_BYTES } from './assets.ts';
export interface RunningApp {
  server: Server;
  workspace: Workspace;
  origin: string;
  close: () => Promise<void>;
}
export async function startApp(
  root: string,
  port = 0,
  webRoot = join(import.meta.dirname, '../../dist'),
): Promise<RunningApp> {
  const workspace = new Workspace(root),
    token = randomBytes(32).toString('hex');
  let origin = '';
  const server = createServer(async (req, res) => {
    const json = (status: number, body: unknown) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
      });
      res.end(JSON.stringify(body));
    };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    try {
      if (
        req.headers.host !== new URL(origin).host ||
        (req.headers.origin !== undefined && req.headers.origin !== origin) ||
        req.headers['sec-fetch-site'] === 'cross-site'
      )
        throw new InputError('Local host/origin required', 403);
      const url = new URL(req.url ?? '/', origin);
      const path = url.pathname;
      if (req.method === 'GET') {
        if (path === '/api/v1/session') {
          json(200, { token, ...workspace.state() });
          return;
        }
        const projectId = url.searchParams.get('project');
        if (path === '/api/v1/workspace') {
          json(200, workspace.state(id(projectId)));
          return;
        }
        if (
          path === '/api/v1/manifest' ||
          path === '/api/v1/artifact' ||
          path === '/api/v1/image' ||
          path === '/api/v1/asset'
        ) {
          const pointer = ref({
            id: url.searchParams.get('id'),
            version: Number(url.searchParams.get('version')),
            freshness: 'pinned',
          });
          const pid = id(projectId);
          if (path === '/api/v1/image' || path === '/api/v1/asset') {
            const image = await workspace.image(pid, pointer);
            res.writeHead(200, { 'Content-Type': 'image/png' });
            res.end(image);
            return;
          }
          json(
            200,
            path === '/api/v1/manifest'
              ? workspace.manifest(pid, pointer)
              : workspace.read(pid, pointer),
          );
          return;
        }
        const files: Record<string, { file: string; type: string }> = {
          '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
          '/app.js': { file: 'app.js', type: 'text/javascript' },
          '/app.css': { file: 'app.css', type: 'text/css' },
        };
        const file = files[path];
        if (!file) throw new InputError('Not found', 404);
        res.writeHead(200, { 'Content-Type': file.type });
        res.end(readFileSync(join(webRoot, file.file)));
        return;
      }
      if (req.method !== 'POST') throw new InputError('Use GET or POST', 405);
      if (
        req.headers.origin !== origin ||
        req.headers['x-bve-token'] !== token ||
        req.headers['content-type'] !== 'application/json'
      )
        throw new InputError(
          'Reload the local app before sending changes',
          403,
        );
      if (Number(req.headers['content-length'] ?? 0) > 12 * 1024 * 1024) {
        req.resume();
        throw new InputError('Request exceeds 12 MiB', 413);
      }
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 12 * 1024 * 1024)
          throw new InputError('Request exceeds 12 MiB', 413);
        chunks.push(chunk);
      }
      let input: unknown;
      try {
        input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        throw new InputError('Invalid JSON');
      }
      let result: unknown;
      if (path === '/api/v1/projects') result = workspace.create(input);
      else if (path === '/api/v1/metadata')
        result = workspace.inspectMetadata(input);
      else {
        const outer = record(input, ['projectId', 'input']);
        const pid = id(outer['projectId']);
        const v = outer['input'];
        switch (path) {
          case '/api/v1/revise':
            result = workspace.reviseProject(pid, v);
            break;
          case '/api/v1/mount':
            result = workspace.mount(pid, v);
            break;
          case '/api/v1/explore':
            result = workspace.explore(pid, v);
            break;
          case '/api/v1/select':
            result = workspace.select(pid, v);
            break;
          case '/api/v1/accept':
            result = workspace.accept(pid, v);
            break;
          case '/api/v1/native':
            result = workspace.native(pid, v);
            break;
          case '/api/v1/cancel':
            result = workspace.cancel(pid, v);
            break;
          case '/api/v1/direction':
            result = workspace.direction(pid, v);
            break;
          case '/api/v1/reference':
          case '/api/v1/import': {
            const f = record(
              v,
              path.endsWith('reference')
                ? ['expectedProject', 'file', 'label', 'role', 'scope']
                : ['job', 'manifestProject', 'originalArtifact', 'file'],
            );
            const encoded = string(
              f['file'],
              Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4,
            );
            if (
              encoded.length % 4 !== 0 ||
              !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
            )
              throw new InputError('Invalid file encoding');
            const bytes = Buffer.from(encoded, 'base64');
            if (bytes.toString('base64') !== encoded)
              throw new InputError('Non-canonical file encoding');
            if (path.endsWith('reference'))
              result = await workspace.addReference(
                pid,
                f['expectedProject'],
                bytes,
                string(f['label'], 100),
                choice(f['role'], [
                  'composition',
                  'typography',
                  'palette',
                  'material',
                  'imagery',
                  'form',
                  'avoid',
                ]),
                choice(f['scope'], [
                  'landing-page',
                  'hero',
                  'services',
                  'proof',
                  'contact',
                ]),
              );
            else
              result = await workspace.importNative(
                pid,
                {
                  job: f['job'],
                  manifestProject: f['manifestProject'],
                  originalArtifact: f['originalArtifact'],
                },
                bytes,
              );
            break;
          }
          default:
            throw new InputError('Not found', 404);
        }
      }
      json(200, result);
    } catch (error) {
      const status = error instanceof InputError ? error.status : 400;
      json(status, {
        error:
          error instanceof InputError
            ? error.message
            : error instanceof Error && !('code' in error)
              ? 'Operation rejected: ' + error.message
              : 'Operation rejected: stored data unavailable; inspect the private runtime root',
      });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('No local address');
  origin = 'http://127.0.0.1:' + address.port;
  return {
    server,
    workspace,
    origin,
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
      workspace.close();
    },
  };
}
