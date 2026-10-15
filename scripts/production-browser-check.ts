/** Desktop/narrow production-boundary evidence. Every raster is authored, never generated. */
import {chromium,expect} from '@playwright/test';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {initializeProject} from '../src/service/project-bootstrap.ts';
import {startApp} from '../src/service/server.ts';
import {fixtureInstallation,fixturePreparation,authoredOriginal,stageDelivery} from './production-fixture.ts';
import {offlineVisualProviders} from './visual-fixture.ts';
import {bytesHash} from '../src/service/production-intake.ts';
import type {Job} from '../src/modules/website/production-contracts.ts';
import type {ProductionWork} from '../src/service/production-intake.ts';
const evidence=resolve(process.env['BVE_EVIDENCE_DIR']??'/tmp/bve-production-browser');mkdirSync(evidence,{recursive:true});
const root=mkdtempSync(join(tmpdir(),'bve-production-browser-')),c=initializeProject(root,fixtureInstallation,'Visual OS · authored production proposals');
let app=await startApp(join(root,'runtime'),0,undefined,offlineVisualProviders,{projectRoot:root}),browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
try{
 const token=(await fetch(app.origin+'/api/v1/visual/session').then(r=>r.json()) as {token:string}).token;
 const post=async(path:string,input:unknown)=>{const r=await fetch(app.origin+path,{method:'POST',headers:{origin:app.origin,'content-type':'application/json','x-bve-token':token},body:JSON.stringify(input)});expect(r.status).toBe(200);return r.json();};
 const prepared=await post('/api/v1/production/prepare',fixturePreparation(app.workspace,c)) as {jobs:ProductionWork<Job>[]};
 const originals=[];
 for(let i=0;i<3;i++){const bytes=await authoredOriginal(i),job=prepared.jobs[i]!;await stageDelivery(root,job,bytes);const receipt=await post('/api/v1/production/intake',{jobId:job.id});expect(receipt.payload.state.disposition).toBe('ready');expect(app.workspace.assets.read(bytesHash(bytes)).equals(bytes)).toBe(true);originals.push({jobId:job.id,sha256:bytesHash(bytes),candidate:receipt.payload.state.candidate,provenance:'authored-fixture'});}
 // Origin/token protections remain in force for new service operations.
 const wrong=await fetch(app.origin+'/api/v1/production/intake',{method:'POST',headers:{origin:app.origin,'content-type':'application/json'},body:JSON.stringify({jobId:prepared.jobs[0]!.id})});expect(wrong.status).toBe(403);
 browser=await chromium.launch({headless:true,...(process.env['BVE_CHROMIUM_EXECUTABLE']?{executablePath:process.env['BVE_CHROMIUM_EXECUTABLE']}:{})});
 const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors:string[]=[],requests:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST')requests.push(new URL(r.url()).pathname);});
 const idle=()=>expect(page.locator('#visual-app')).not.toHaveAttribute('aria-busy','true');
 const navigate=async()=>{await page.goto(app.origin);await page.locator('#project').selectOption(c.projectId);await idle();await page.locator('#page').selectOption(c.initialWorkUnit.id+':1');await idle();await expect(page.locator('.candidate')).toHaveCount(3);await expect(page.locator('.candidate .origin')).toHaveText(Array(3).fill('Authored delivery · verified bytes'));};
 await navigate();
 for(const layout of ['sheet','film']){
  await page.setViewportSize({width:1440,height:1050});await page.locator('#layout').selectOption(layout);await idle();await expect(page.locator('.candidate')).toHaveCount(3);
  for(const original of originals)await expect(page.locator(`[data-candidate="${original.candidate.id}:1"] img`)).toBeVisible();
  await expect(page.locator('#native-exchange-panel')).not.toHaveAttribute('open','');
  await page.screenshot({path:join(evidence,layout+'-desktop.png'),fullPage:true});
  await page.locator('[data-compare]').nth(0).click();await page.locator('[data-compare]').nth(1).click();await expect(page.locator('.comparison.multiple .canvas')).toHaveCount(2);
  await page.screenshot({path:join(evidence,layout+'-comparison.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:join(evidence,layout+'-narrow.png'),fullPage:true});
  await page.locator('#clear-compare').click();
 }
 const state=JSON.stringify(app.production!.jobs());await app.close();app=await startApp(join(root,'runtime'),0,undefined,offlineVisualProviders,{projectRoot:root});await navigate();expect(JSON.stringify(app.production!.jobs())).toBe(state);expect(app.production!.receipts()).toHaveLength(3);
 expect(requests).toEqual([]);expect(errors).toEqual([]);expect(app.workspace.kernel.acceptedSelections(c.projectId)).toHaveLength(0);
 writeFileSync(join(evidence,'summary.json'),JSON.stringify({packet:'BVE-VOS-01',fixture:'authored SVG originals rasterized locally with sharp',viewports:[{width:1440,height:1050},{width:390,height:844}],layouts:['sheet','film'],originals,proposalsVisible:3,comparison:true,reopen:true,errors,browserWrites:requests,hostTokenGuard:true,generationCalls:0,acceptances:0},null,2)+'\n');console.log('Production browser gates passed: three authored proposals, both layouts, desktop/narrow, compare, cold reopen, zero browser mutations.');
}finally{await browser?.close();await app.close();rmSync(root,{recursive:true,force:true});}
