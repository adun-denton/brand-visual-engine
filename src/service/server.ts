import { Chat } from './chat.ts';
import { ChatAuth } from './chat-auth.ts';
import { AccountChatDriver } from './chat-process.ts';
import type { ChatDriver,ChatImageDriver } from './chat-contracts.ts';
import { Compositions } from './compositions.ts';
import { Pages } from './pages.ts';
import { AIDirections } from './ai-directions.ts';
import { Providers } from './providers.ts';
import { Regions } from './regions.ts';
import type { ProviderConfig } from './providers.ts';
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
  providers: Providers;
  regions: Regions;
  compositions: Compositions;
  pages: Pages;
  chat: Chat;
  origin: string;
  close: () => Promise<void>;
}
export async function startApp(
  root: string,
  port = 0,
  webRoot = join(import.meta.dirname, '../../dist'),
  providerConfig?: ProviderConfig,
  workspaceOptions?: {
    directionFixture?: boolean;
    aiResponseFixture?: boolean;
    chatDriver?: ChatDriver;
    chatImageDriver?: ChatImageDriver;
  },
): Promise<RunningApp> {
  const workspace = new Workspace(root, workspaceOptions),
    token = randomBytes(32).toString('hex');
  const providers = new Providers(workspace, providerConfig);
  const regions = new Regions(workspace, providers);
  const compositions = new Compositions(workspace);
  const pages = new Pages(workspace);
  const directions = new AIDirections(workspace);
  let origin = '';
  let closing = false;
  let closePromise: Promise<void> | undefined;
  const auth = new ChatAuth(root);
  const grants = new Map<string,{pid:string;tid:string}>();
  const account = new AccountChatDriver(root,auth,()=>origin,(pid,tid)=>{const token=randomBytes(32).toString('hex');grants.set(token,{pid,tid});return {token,release:()=>{grants.delete(token);}};},async(pid,refs)=>Promise.all(refs.map(async r=>{const m=await pages.mediaBytes(pid,r);return {type:'image' as const,url:'data:image/'+m.info.format+';base64,'+m.bytes.toString('base64')};})));
  const chat = new Chat(root,workspace,pages,workspaceOptions?.chatDriver ?? (process.env['BVE_CHAT_POLICY_FILE'] ? account : undefined),workspaceOptions?.chatImageDriver);
  const server = createServer(async (req, res) => {
    if (closing) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', Connection: 'close' });
      res.end('Local workspace is stopping. Saved work is retained.');
      return;
    }
    const json = (status: number, body: unknown, augment = true) => {
      // Projection and serialization can fail. Commit success only after both finish.
      const output = JSON.stringify(
          body && typeof body === 'object'
            && augment
            ? {
                ...body,
                ...('capabilities' in body
                  ? { capabilities: providers.registry() }
                  : {}),
                providers: providers.status(),
                ...('project' in body && body.project ? { inference: pages.state((body.project as {id:string}).id) } : {}),
              }
            : body,
        );
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(output);
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
        if (path === '/auth/callback') {
          try { await auth.callback(url.searchParams); res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8'});res.end('ChatGPT connected. Return to the BVE tab.'); }
          catch {res.writeHead(400,{'Content-Type':'text/plain; charset=utf-8'});res.end('Sign-in could not complete. Return to BVE; saved drafts are retained.');} return;
        }
        if(path==='/api/v1/chat/state'){json(200,chat.state(id(url.searchParams.get('project'))),false);return;}
        if (path === '/api/v1/session') {
          json(200, { token, ...workspace.state() });
          return;
        }
        const projectId = url.searchParams.get('project');
        if (path.startsWith('/api/v1/page/') || path.startsWith('/api/v1/website/')) {
          const pid = id(projectId), pointer = ref({id:url.searchParams.get('id'),version:Number(url.searchParams.get('version')),freshness:'pinned'});
          if (path === '/api/v1/page/history') { json(200,{history:pages.history(pid,pointer)}); return; }
          if (path === '/api/v1/page/request') {
            const output=JSON.stringify(pages.exportRequest(pid,pointer),null,2)+'\n';
            res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="request.json"'});
            res.end(output); return;
          }
          if (path === '/api/v1/page/preview') {
            const html=await pages.preview(pid,pointer);
            res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'");
            res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);return;
          }
          if (path === '/api/v1/page/media') {
            const m=await pages.mediaBytes(pid,pointer);res.writeHead(200,{'Content-Type':'image/'+m.info.format});res.end(m.bytes);return;
          }
          if (['/api/v1/page/package','/api/v1/page/export','/api/v1/website/export'].includes(path)) {
            const output=path.endsWith('/package')?await pages.requestPackage(pid,pointer):path.startsWith('/api/v1/website/')?await pages.exportWebsite(pid,pointer):await pages.export(pid,pointer);
            res.writeHead(200,{'Content-Type':'application/x-tar','Content-Disposition':'attachment; filename="'+(path.endsWith('/package')?'request':'handoff')+'.tar"'});res.end(output.bytes);return;
          }
          throw new InputError('Not found',404);
        }
        if (path === '/api/v1/workspace') {
          json(200, workspace.state(id(projectId)));
          return;
        }
        if (
          path === '/api/v1/composition/preview' ||
          path === '/api/v1/direction/preview' ||
          path === '/api/v1/direction/request' ||
          path === '/api/v1/composition/export' ||
          path === '/api/v1/manifest' ||
          path === '/api/v1/artifact' ||
          path === '/api/v1/image' ||
          path === '/api/v1/asset' ||
          path === '/api/v1/region/bundle'
        ) {
          const pointer = ref({
            id: url.searchParams.get('id'),
            version: Number(url.searchParams.get('version')),
            freshness: 'pinned',
          });
          const pid = id(projectId);
          if (path === '/api/v1/direction/request') {
            const exported = directions.export(pid, pointer);
            res.writeHead(200, {
              'Content-Type': 'application/json; charset=utf-8',
              'Content-Disposition': `attachment; filename="ai-direction-request-${pointer.id}.json"`,
            });
            res.end(JSON.stringify(exported, null, 2) + '\n');
            return;
          }
          if (path === '/api/v1/direction/preview') {
            const html = await directions.preview(pid, pointer);
            res.setHeader(
              'Content-Security-Policy',
              "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
            );
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
            return;
          }
          if (path === '/api/v1/composition/preview') {
            const html = await compositions.preview(pid, pointer);
            res.setHeader(
              'Content-Security-Policy',
              "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
            );
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
            return;
          }
          if (path === '/api/v1/composition/export') {
            const result = await compositions.export(pid, pointer);
            res.writeHead(200, {
              'Content-Type': 'application/x-tar',
              'Content-Disposition': `attachment; filename="handoff-${pointer.id}-v${pointer.version}.tar"`,
              'X-BVE-Package-SHA256': result.checksum,
            });
            res.end(result.bytes);
            return;
          }
          if (path === '/api/v1/region/bundle') {
            json(200, await regions.bundle(pid, pointer));
            return;
          }
          if (path === '/api/v1/asset') {
            const { bytes, info } = await workspace.originalImage(pid, pointer);
            const extension = info.format === 'jpeg' ? 'jpg' : info.format;
            res.writeHead(200, {
              'Content-Type': 'image/' + info.format,
              'Content-Length': bytes.length,
              'Content-Disposition': `attachment; filename="asset-${info.id}.${extension}"`,
            });
            res.end(bytes);
            return;
          }
          if (path === '/api/v1/image') {
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
        const output = readFileSync(join(webRoot, file.file));
        res.writeHead(200, { 'Content-Type': file.type });
        res.end(output);
        return;
      }
      if (req.method !== 'POST') throw new InputError('Use GET or POST', 405);
      if (
        req.headers.origin !== origin ||
        (req.headers['x-bve-token'] !== token && !(path==='/api/v1/chat/tool' && grants.has(String(req.headers['x-bve-chat-grant']??'')))) ||
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
      if(path==='/api/v1/chat/send')result=chat.send(input);
      else if(path==='/api/v1/chat/connect')result=auth.begin(origin);
      else if(path==='/api/v1/chat/tool'){const grant=grants.get(String(req.headers['x-bve-chat-grant']));if(!grant)throw new InputError('Expired scoped tool binding',403);const r=record(input,['name','actionId','input']);result=await chat.dispatch(grant.pid,grant.tid,string(r['name']),id(r['actionId']),r['input']);}
      else if (path === '/api/v1/projects') result = workspace.create(input);
      else if (path === '/api/v1/metadata')
        result = workspace.inspectMetadata(input);
      else {
        const outer = record(input, ['projectId', 'input']);
        const pid = id(outer['projectId']);
        const v = outer['input'];
        switch (path) {
          case '/api/v1/chat/cancel':result=chat.cancel(pid,v);break;
          case '/api/v1/chat/select':result=chat.select(pid,v);break;
          case '/api/v1/chat/accept':result=chat.accept(pid,v);break;
          case '/api/v1/chat/attach':result=await chat.attach(pid,v);break;
          case '/api/v1/chat/image-run':result=await chat.executeImage(pid,v);break;
          case '/api/v1/chat/permit':result=await chat.permit(pid,v);break;
          case '/api/v1/chat/place':result=await chat.place(pid,v);break;
          case '/api/v1/page/prepare': result=pages.prepare(pid,v);break;
          case '/api/v1/page/apply': result=await pages.apply(pid,v);break;
          case '/api/v1/page/cancel': result=pages.cancel(pid,v);break;
          case '/api/v1/page/add-media': result=await pages.addMedia(pid,v);break;
          case '/api/v1/page/place': result=await pages.place(pid,v);break;
          case '/api/v1/page/save': result=pages.save(pid,v);break;
          case '/api/v1/page/accept': result=pages.accept(pid,v);break;
          case '/api/v1/page/import': result=await pages.importPortable(pid,v);break;
          case '/api/v1/page/convert': result=await pages.convert(pid,v);break;
          case '/api/v1/website/assemble': result=pages.assemble(pid,v);break;
          case '/api/v1/website/accept': result=pages.acceptWebsite(pid,v);break;
          case '/api/v1/direction/apply':
            result = directions.apply(pid, v);
            break;
          case '/api/v1/direction/place':
            result = await directions.place(pid, v);
            break;
          case '/api/v1/assets/revise':
            result = directions.reviseAsset(pid, v);
            break;
          case '/api/v1/assets/add': {
            const r = record(v, [
              'expectedProject',
              'origin',
              'label',
              'role',
              'permission',
              'file',
            ]);
            let bytes: Buffer | undefined;
            if (r['file'] !== undefined) {
              const s = string(
                r['file'],
                Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4,
              );
              if (s.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(s))
                throw new InputError('Invalid encoded image');
              bytes = Buffer.from(s, 'base64');
            }
            const { file: _, ...input } = r;
            result = await directions.addAsset(pid, input, bytes);
            break;
          }
          case '/api/v1/composition/start':
            result = compositions.start(pid, v);
            break;
          case '/api/v1/composition/save':
            result = await compositions.save(pid, v);
            break;
          case '/api/v1/composition/review':
            result = await compositions.review(pid, v);
            break;
          case '/api/v1/composition/compare':
            result = compositions.compare(pid, v);
            break;
          case '/api/v1/composition/accept':
            result = await compositions.accept(pid, v);
            break;
          case '/api/v1/region/select':
            result = await regions.select(pid, v);
            break;
          case '/api/v1/region/prepare':
            result = regions.prepare(pid, v);
            break;
          case '/api/v1/region/collect':
            result = regions.collect(pid, v);
            break;
          case '/api/v1/region/compose':
            result = await regions.compose(pid, v);
            break;
          case '/api/v1/region/compare':
            result = regions.compare(pid, v);
            break;
          case '/api/v1/region/accept':
            result = await regions.accept(pid, v);
            break;
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
          case '/api/v1/provider/prepare':
            result = providers.prepare(pid, v);
            break;
          case '/api/v1/provider/submit':
            result = providers.submit(pid, v);
            break;
          case '/api/v1/provider/cancel':
            result = providers.cancel(pid, v);
            break;
          case '/api/v1/provider/reconcile':
            result = providers.reconcile(pid, v);
            break;
          case '/api/v1/provider/review':
            result = providers.review(pid, v);
            break;
          case '/api/v1/provider/compare':
            result = providers.compare(pid, v);
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
      if (res.headersSent || res.writableEnded || res.destroyed) {
        if (!res.writableEnded && !res.destroyed) res.destroy();
        return;
      }
      const status = error instanceof InputError ? error.status : 400;
      json(status, {
        error:
          error instanceof InputError
            ? error.message
            : error instanceof Error && !('code' in error)
              ? 'Operation rejected: ' + error.message
              : 'Operation rejected: stored data unavailable; inspect the private runtime root',
      }, false); // Error responses never repeat fallible workspace/provider projection.
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
    providers,
    regions,
    compositions,
    pages,
    chat,
    origin,
    close: () => {
      if (closePromise) return closePromise;
      closing = true;
      // Stop HTTP admission/drain readers before closing private chat persistence.
      const drained = new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
      server.closeIdleConnections();
      closePromise = (async () => {
        await providers.close();
        await drained;
        await chat.close();
        workspace.close();
      })();
      return closePromise;
    },
  };
}
