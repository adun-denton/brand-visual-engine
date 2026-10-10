import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VersionRef } from '../src/kernel/contracts.ts';
type Ready = {origin:string; project:string; page:VersionRef; foreign:VersionRef; corrupt:VersionRef; request:VersionRef; snapshot:string};
for (const scenario of ['missing request','foreign preview','corrupt preview','JSON state augmentation'] as const) {
  test('BVE-IW-R1 subprocess: ' + scenario + ' rejects without crash or writes', {timeout:20000}, async t => {
    const root = mkdtempSync(join(tmpdir(), 'bve-http-errors-'));
    const child = fork(new URL('../scripts/http-error-fixture.ts', import.meta.url), [root,scenario], {silent:true, execArgv:[]});
    let stderr = ''; child.stderr!.on('data', b => {stderr += String(b);});
    t.after(async () => { if(child.exitCode === null && child.signalCode === null) { const exited=once(child,'exit'); child.kill(); await exited; }
      rmSync(root,{recursive:true,force:true}); });
    const [ready] = await Promise.race([once(child,'message'), once(child,'exit').then(() => {throw Error('Child startup failed: '+stderr);})]) as [Ready];
    const pointer = scenario === 'missing request' ? {id:'missing',version:1} : scenario === 'foreign preview' ? ready.foreign : ready.corrupt;
    const path = scenario === 'missing request' ? 'page/request' : scenario === 'JSON state augmentation' ? 'workspace' : 'page/preview';
    const url = ready.origin + '/api/v1/' + path + '?project=' + ready.project + '&id=' + pointer.id + '&version=' + pointer.version;
    let response: Response;
    try { response = await fetch(url); } catch(e) { throw Error('Rejected read terminated child: ' + stderr, {cause:e}); }
    assert.equal(response.status,400); assert.match((await response.json()).error,
      scenario === 'JSON state augmentation' ? /Text is missing or too long/ : /unknown|ownership|integrity/);
    assert.equal(child.exitCode,null,stderr);
    const good = await fetch(ready.origin + '/api/v1/page/request?project=' + ready.project + '&id=' + ready.request.id + '&version=' + ready.request.version);
    assert.equal(good.status,200); assert.equal((await good.json()).requestId,ready.request.id);
    const pending=once(child,'message'); child.send('snapshot'); const [after]=await pending;
    assert.equal(after.snapshot,ready.snapshot); assert(!stderr.includes('ERR_HTTP_HEADERS_SENT'));
  });
}
