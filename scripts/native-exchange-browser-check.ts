/** Authored manual exchange in both layouts, with auxiliary chat closed; no native transport. */
import { chromium, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startApp } from '../src/service/server.ts';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync } from 'node:fs';
import { reference } from '../src/kernel/packets.ts';
import { offlineVisualProviders, visualFixture } from './visual-fixture.ts';
import { nativeReturn, fixtureTar } from './native-exchange-fixture.ts';
const evidence=resolve(process.env['BVE_EVIDENCE_DIR']??'/tmp/bve-native-browser');mkdirSync(evidence,{recursive:true});
const root=mkdtempSync(join(tmpdir(),'bve-native-browser-')),app=await startApp(root,0,undefined,offlineVisualProviders);
let browser:Awaited<ReturnType<typeof chromium.launch>>|null=null;
try {
  const v=app.visual,p=v.create({title:'Form / Field · authored native-envelope review'}),unit=v.exploration.createWorkUnit(p.project.id,{version:1,pageType:'homepage',label:'Homepage',source:'Authored browser fixture'});
  const prepared=await v.command(p.project.id,'prepare',{expectedProject:p.project,unit:reference(unit),selections:null,intent:'Hand-authored synthetic image fixture; not generated',count:2,direction:'fresh',brand:null,operation:'create',requests:[],level1:[]}) as any;
  browser=await chromium.launch({headless:true,...(process.env['BVE_CHROMIUM_EXECUTABLE']?{executablePath:process.env['BVE_CHROMIUM_EXECUTABLE']}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors:string[]=[],writes:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST')writes.push(new URL(r.url()).pathname);});
  const idle=()=>expect(page.locator('#visual-app')).not.toHaveAttribute('aria-busy','true');
  const open=()=>page.locator('#native-exchange-panel').evaluate(n=>(n as HTMLDetailsElement).open=true);
  await page.goto(app.origin);await page.locator('#project').selectOption(p.project.id);await idle();await page.locator('#page').selectOption(unit.id+':1');await idle();
  await expect(page.locator('#auxiliary-toggle')).toContainText('Open');await expect(page.locator('.auxiliary-panel')).toHaveCount(0);
  await open();await page.locator('#native-prepare [name=width]').fill('800');await page.locator('#native-prepare [name=height]').fill('1100');await page.locator('#native-prepare [name=slots]').fill('1');await page.locator('#native-prepare [name=lifetime]').fill('3600');await page.locator('#native-prepare [name=evidence]').selectOption('synthetic-fixture');await page.getByRole('button',{name:'Prepare manual grant',exact:true}).click();await idle();await open();
  await expect(page.getByRole('button',{name:'Export request',exact:true})).toBeVisible();
  const firstDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Export request',exact:true}).click();const download=await firstDownload;await idle();await open();
  const saved=join(evidence,'authored-request.tar');await download.saveAs(saved);
  const state=v.native.state(p.project.id,reference(unit)),run=state.runs[0]!.run,pkg=run.payload.state.slots[0]!.release!;
  await expect(page.locator('.native-slot strong')).toHaveText('awaiting-operator');
  await expect(page.locator('#native-exchange-panel')).toContainText('Authored synthetic fixture · no native invocation');
  await page.locator('#native-exchange-panel').screenshot({path:join(evidence,'sheet-awaiting.png')});
  const secondDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Re-download request',exact:true}).click();await secondDownload;await idle();await open();expect(v.native.state(p.project.id,reference(unit)).runs[0]!.run.version).toBe(run.version);
  await page.getByRole('button',{name:'Report invocation / claim',exact:true}).click();await idle();await open();await expect(page.locator('.native-slot strong')).toHaveText('claimed');
  const result=await nativeReturn(pkg,await visualFixture(1));const form=page.locator('[data-native-import]').first();await form.locator('[name=manifest]').setInputFiles({name:'synthetic-result.json',mimeType:'application/json',buffer:result.manifest});await form.locator('[name=original]').setInputFiles({name:'authored-original.png',mimeType:'image/png',buffer:[...result.files.values()][0]!});await form.getByRole('button',{name:'Import result',exact:true}).click();await idle();await open();await expect(page.locator('.native-slot strong')).toHaveText('returned');
  expect(v.state(p.project.id,reference(unit)).candidates).toHaveLength(1);expect(app.workspace.kernel.acceptedSelections(p.project.id)).toHaveLength(0);expect(v.executions.availability().connected).toBe(false);
  await page.locator('#native-exchange-panel').screenshot({path:join(evidence,'sheet-returned.png')});
  await page.locator('#layout').selectOption('film');await idle();await open();await expect(page.locator('.studio.film')).toBeVisible();await expect(page.locator('.auxiliary-panel')).toHaveCount(0);await page.locator('#native-exchange-panel').screenshot({path:join(evidence,'film-returned.png')});
  const count=writes.length,version=v.native.state(p.project.id,reference(unit)).runs[0]!.run.version;await page.getByRole('button',{name:'Refresh stored progress',exact:true}).click();await idle();expect(writes.length).toBe(count);expect(v.native.state(p.project.id,reference(unit)).runs[0]!.run.version).toBe(version);
  await page.setViewportSize({width:390,height:844});await page.locator('#layout').selectOption('sheet');await idle();await open();await page.locator('#native-exchange-panel').screenshot({path:join(evidence,'narrow-returned.png')});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
  await page.locator('#native-prepare [name=width]').fill('800');await page.locator('#native-prepare [name=height]').fill('1100');await page.locator('#native-prepare [name=slots]').fill('1');await page.locator('#native-prepare [name=lifetime]').fill('3600');await page.locator('#native-prepare [name=evidence]').selectOption('synthetic-fixture');await page.getByRole('button',{name:'Prepare manual grant',exact:true}).click();await idle();await open();
  const parent=v.native.state(p.project.id,reference(unit)).runs.find(e=>e.run.id!==run.id)!.run;
  await page.locator('[data-native-action=cancel][data-native-run="'+parent.id+'"]').click();await idle();await open();
  await page.locator('#native-prepare [name=lifetime]').fill('3600');await page.locator('[data-native-retry="'+parent.id+'"][data-slot="1"]').click();await idle();await open();
  const retry=v.native.state(p.project.id,reference(unit)).runs.find(e=>e.run.payload.state.retryOf?.execution.id===parent.id)!.run;expect(retry.payload.state.retryOf?.execution.id).toBe(parent.id);expect(retry.payload.state.retryOf?.slot).toBe(1);expect(retry.payload.state.slots[0]!.release).toBeNull();
  // Reproduce the original two actual forms in the same run, independently in both layouts.
  const raw=()=>{const db=new DatabaseSync(join(root,'kernel.sqlite'));try{return JSON.stringify({rows:['kernel_packets','kernel_events','kernel_selections'].map(n=>db.prepare('SELECT * FROM '+n+' ORDER BY 1,2').all()),files:readdirSync(join(root,'native-assets')).sort()});}finally{db.close();}};
  for(const layout of ['sheet','film']){
    await page.setViewportSize({width:1440,height:1050});await page.locator('#layout').selectOption(layout);await idle();
    const spec=prepared.specification;
    const q=await v.native.compile(p.project.id,reference(spec),800,1100),g=v.native.grant(p.project.id,{request:reference(q),slots:[1,2],maxSubmissions:2,maxStatusCalls:0,maxCancelCalls:0,timeoutMs:30000,expiresAt:new Date(Date.now()+3600000).toISOString(),evidence:'synthetic-fixture',reason:'Two-form synthetic browser regression'}),two=v.native.prepare(p.project.id,reference(g));
    const one=await v.native.exportRequest(p.project.id,reference(two),1);v.native.control(p.project.id,reference(two),1,'cancel');
    const twoOut=await v.native.exportRequest(p.project.id,reference(two),2),twoPkg=JSON.parse(twoOut.manifest.toString());v.native.claim(p.project.id,reference(two),2,twoPkg.packetDigest);
    await page.getByRole('button',{name:'Refresh stored progress',exact:true}).click();await idle();await open();
    const formFor=(slot:number)=>page.locator('[data-native-import="'+two.id+'"][data-slot="'+slot+'"]');
    await expect(formFor(1)).toBeVisible();await expect(formFor(2)).toBeVisible();await expect(page.locator('.auxiliary-panel')).toHaveCount(0);
    const returned=await nativeReturn(twoPkg,await visualFixture(2)),before=raw();
    const upload=async(slot:number,result:Awaited<ReturnType<typeof nativeReturn>>,history=false)=>{const f=formFor(slot);await f.locator('[name=manifest]').setInputFiles({name:'result.json',mimeType:'application/json',buffer:result.manifest});await f.locator('[name=original]').setInputFiles({name:'original.png',mimeType:'image/png',buffer:[...result.files.values()][0]!});if(history)await f.locator('[name=historical]').check();await f.getByRole('button',{name:'Import result',exact:true}).click();await idle();await open();};
    await upload(1,returned);await expect(page.locator('#visual-notice')).toContainText('does not match selected run/slot');expect(raw()).toBe(before);
    await page.locator('#native-exchange-panel').screenshot({path:join(evidence,layout+'-wrong-slot.png')});
    const candidates=v.state(p.project.id,reference(unit)).candidates.length;await upload(2,returned);expect(v.state(p.project.id,reference(unit)).candidates.length).toBe(candidates+1);
    const old=await nativeReturn(JSON.parse(one.manifest.toString()),await visualFixture(1));await upload(1,old);await expect(page.locator('#visual-notice')).toContainText('historical intake required');await upload(1,old,true);
    const saved=v.native.state(p.project.id,reference(unit)).runs.find(e=>e.run.id===two.id)!;expect(saved.slots[0]!.receipt!.payload.state.outcome).toBe('historical');expect(saved.slots[0]!.receipt!.payload.state.candidate).toBeNull();expect(saved.slots[1]!.status).toBe('returned');expect(v.state(p.project.id,reference(unit)).candidates.length).toBe(candidates+1);
    // Additive kit comes through the real user download workflow, including historical slots.
    const kitDownload=page.waitForEvent('download');await page.locator('[data-native-action="return-kit"][data-native-run="'+two.id+'"][data-slot="1"]').click();const downloadedKit=await kitDownload;await downloadedKit.saveAs(join(evidence,layout+'-return-kit.tar'));await idle();await open();
    await page.locator('#native-exchange-panel').screenshot({path:join(evidence,layout+'-scoped-success.png')});
    await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);await page.locator('#native-exchange-panel').screenshot({path:join(evidence,layout+'-narrow-scoped.png')});
  }
  expect(errors).toEqual([]);
  writeFileSync(join(evidence,'summary.json'),JSON.stringify({checks:['sheet manual grant/export/re-download/claim/import','film/chat-closed return','narrow layout','refresh reads only','original output, no acceptance','explicit per-slot retry with new grant and no dispatch','both layouts: two actual same-run forms, wrong-slot no mutation, correct current/historical originals, return-kit download, narrow geometry'],errors,writes,nativeInvocations:0,accountCalls:0,modelCalls:0,gpuCalls:0},null,2)+'\n');console.log('Native manual exchange browser gates passed');
} finally {await browser?.close();await app.close();rmSync(root,{recursive:true,force:true});}
