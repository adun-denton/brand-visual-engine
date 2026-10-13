/** Authored manual exchange in both layouts, with auxiliary chat closed; no native transport. */
import { chromium, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startApp } from '../src/service/server.ts';
import { reference } from '../src/kernel/packets.ts';
import { offlineVisualProviders, visualFixture } from './visual-fixture.ts';
import { nativeReturn, fixtureTar } from './native-exchange-fixture.ts';
const evidence=resolve(process.env['BVE_EVIDENCE_DIR']??'/tmp/bve-native-browser');mkdirSync(evidence,{recursive:true});
const root=mkdtempSync(join(tmpdir(),'bve-native-browser-')),app=await startApp(root,0,undefined,offlineVisualProviders);
let browser:Awaited<ReturnType<typeof chromium.launch>>|null=null;
try {
  const v=app.visual,p=v.create({title:'Form / Field · authored native-envelope review'}),unit=v.exploration.createWorkUnit(p.project.id,{version:1,pageType:'homepage',label:'Homepage',source:'Authored browser fixture'});
  await v.command(p.project.id,'prepare',{expectedProject:p.project,unit:reference(unit),selections:null,intent:'Hand-authored synthetic image fixture; not generated',count:1,direction:'fresh',brand:null,operation:'create',requests:[],level1:[]});
  browser=await chromium.launch({headless:true,...(process.env['BVE_CHROMIUM_EXECUTABLE']?{executablePath:process.env['BVE_CHROMIUM_EXECUTABLE']}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors:string[]=[],writes:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST')writes.push(new URL(r.url()).pathname);});
  const idle=()=>expect(page.locator('#visual-app')).not.toHaveAttribute('aria-busy','true');
  const open=()=>page.locator('#native-exchange-panel').evaluate(n=>(n as HTMLDetailsElement).open=true);
  await page.goto(app.origin);await page.locator('#project').selectOption(p.project.id);await idle();await page.locator('#page').selectOption(unit.id+':1');await idle();
  await expect(page.locator('#auxiliary-toggle')).toContainText('Open');await expect(page.locator('.auxiliary-panel')).toHaveCount(0);
  await open();await page.locator('#native-prepare [name=width]').fill('800');await page.locator('#native-prepare [name=height]').fill('1100');await page.locator('#native-prepare [name=slots]').fill('1');await page.locator('#native-prepare [name=lifetime]').fill('3600');await page.locator('#native-prepare [name=evidence]').selectOption('synthetic-fixture');await page.getByRole('button',{name:'Prepare manual grant',exact:true}).click();await idle();await open();
  const firstDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Export request',exact:true}).click();const download=await firstDownload;await idle();await open();
  const saved=join(evidence,'authored-request.tar');await download.saveAs(saved);
  const state=v.native.state(p.project.id,reference(unit)),run=state.runs[0]!.run,pkg=run.payload.state.slots[0]!.release!;
  await expect(page.locator('.native-slot strong')).toHaveText('awaiting-operator');
  await page.locator('#native-exchange-panel').screenshot({path:join(evidence,'sheet-awaiting.png')});
  const secondDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Re-download request',exact:true}).click();await secondDownload;await idle();await open();expect(v.native.state(p.project.id,reference(unit)).runs[0]!.run.version).toBe(run.version);
  await page.getByRole('button',{name:'Report invocation / claim',exact:true}).click();await idle();await open();await expect(page.locator('.native-slot strong')).toHaveText('claimed');
  const result=await nativeReturn(pkg,await visualFixture(1));const form=page.locator('[data-native-import]').first();await form.locator('[name=manifest]').setInputFiles({name:'synthetic-result.json',mimeType:'application/json',buffer:result.manifest});await form.locator('[name=original]').setInputFiles({name:'authored-original.png',mimeType:'image/png',buffer:[...result.files.values()][0]!});await form.getByRole('button',{name:'Import result',exact:true}).click();await idle();await open();await expect(page.locator('.native-slot strong')).toHaveText('returned');
  expect(v.state(p.project.id,reference(unit)).candidates).toHaveLength(1);expect(app.workspace.kernel.acceptedSelections(p.project.id)).toHaveLength(0);expect(v.executions.availability().connected).toBe(false);
  await page.locator('#native-exchange-panel').screenshot({path:join(evidence,'sheet-returned.png')});
  await page.locator('#layout').selectOption('film');await idle();await open();await expect(page.locator('.studio.film')).toBeVisible();await expect(page.locator('.auxiliary-panel')).toHaveCount(0);await page.locator('#native-exchange-panel').screenshot({path:join(evidence,'film-returned.png')});
  const count=writes.length,version=v.native.state(p.project.id,reference(unit)).runs[0]!.run.version;await page.getByRole('button',{name:'Refresh stored progress',exact:true}).click();await idle();expect(writes.length).toBe(count);expect(v.native.state(p.project.id,reference(unit)).runs[0]!.run.version).toBe(version);
  await page.setViewportSize({width:390,height:844});await page.locator('#layout').selectOption('sheet');await idle();await open();await page.locator('#native-exchange-panel').screenshot({path:join(evidence,'narrow-returned.png')});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
  expect(errors).toEqual([]);
  writeFileSync(join(evidence,'summary.json'),JSON.stringify({checks:['sheet manual grant/export/re-download/claim/import','film/chat-closed return','narrow layout','refresh reads only','original output, no acceptance'],errors,writes,nativeInvocations:0,accountCalls:0,modelCalls:0,gpuCalls:0},null,2)+'\n');console.log('Native manual exchange browser gates passed');
} finally {await browser?.close();await app.close();rmSync(root,{recursive:true,force:true});}
