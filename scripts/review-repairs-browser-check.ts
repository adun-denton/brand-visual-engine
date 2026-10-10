// Real controls using mechanical fixtures. Zero provider/native host calls.
import { chromium, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startApp } from '../src/service/server.ts';
import type { RunningApp } from '../src/service/server.ts';
import { reference } from '../src/kernel/packets.ts';
import { pageSignature } from '../src/modules/website/page.ts';
import { seedRepairPage, repairResult } from './inference-repair-fixture.ts';
import { AIDirections } from '../src/service/ai-directions.ts';
import { aiFixture } from './ai-direction-fixture.ts';
import { syntheticCompositionImage } from './composition-fixture.ts';
import type { NodePacket, IterationBundle, VersionRef } from '../src/kernel/contracts.ts';
const evidence=resolve(process.env['BVE_EVIDENCE_DIR']??'/tmp/bve-review-repairs'); mkdirSync(evidence,{recursive:true});
let root=mkdtempSync(join(tmpdir(),'bve-review-browser-'));
let app:RunningApp|null=await startApp(root,0,undefined,undefined,{aiResponseFixture:true});
const browser=await chromium.launch({headless:true,...(process.env['BVE_CHROMIUM_EXECUTABLE']?{executablePath:process.env['BVE_CHROMIUM_EXECUTABLE']}:{ }),args:['--no-sandbox','--disable-dev-shm-usage']});
const context=await browser.newContext({viewport:{width:1440,height:1000}}), page=await context.newPage();
const errors:string[]=[], receipts:unknown[]=[]; page.on('pageerror',e=>errors.push(e.message));
const submit=async(selector:string,text:string)=>{await page.locator(selector).locator('button').last().click();await expect(page.locator('#app')).not.toHaveAttribute('aria-busy','true');await expect(page.locator('#notice')).toContainText(text);};
const open=async(pid:string)=>{await page.goto(app!.origin);await page.locator(`[data-action=open][data-id="${pid}"]`).click();await expect(page.locator('#studio-prepare')).toBeVisible();};
const active=async()=>JSON.parse(await page.locator('#studio-active').inputValue()).id as string;
try {
 if(process.argv[2]!=='selection') for(const scenario of ['cancelled','base-stale','project-stale']) {
  const p=app!.workspace.create({title:'Historical '+scenario,mode:'freeroam',visualOS:null,palette:null}).project!;
  let current=await seedRepairPage(app!.pages,p.id);
  app!.pages.accept(p.id,{artifact:reference(current),expected:null,reviewedHash:pageSignature(current.payload.state),reason:'Mechanical reviewed control',acknowledgeFindings:true});
  const accepted=app!.pages.state(p.id).accepted[current.id], pkg=(await app!.pages.export(p.id,accepted!)).bytes;
  await open(p.id); expect(await active()).toBe(current.id);
  await page.locator('#studio-prepare [name=operation]').selectOption('revise');
  await page.locator('#studio-prepare [name=instruction]').fill('Mechanical delayed-response regression');
  await submit('#studio-prepare','Scoped AI request saved');
  const q=app!.pages.state(p.id).requests.at(-1)!;
  if(scenario==='cancelled')await submit('.studio-cancel','AI request cancelled');
  if(scenario==='base-stale') {
   app!.pages.save(p.id,{artifact:reference(current),page:{...current.payload.state.page,title:'Newer current version'},reason:'Mechanical newer work'});
   current=app!.pages.state(p.id).pages.find(x=>x.id===current.id)!;
  }
  if(scenario==='project-stale')app!.workspace.reviseProject(p.id,{expectedProject:reference(app!.workspace.project(p.id)),brief:{intent:'Changed synthetic intent'},reason:'Mechanical project change'});
  // Refresh data and reselect the owning project, as an operator would after reopening.
  await open(p.id);
  await page.locator('#studio-apply [name=request]').selectOption(JSON.stringify(reference(q)));
  await page.locator('#studio-apply [name=response]').fill(JSON.stringify(repairResult(q,'Historical '+scenario)));
  await page.locator('#studio-apply [name=source]').fill('Mechanical cancelled/stale result; zero AI calls');
  await page.locator('#studio-apply [name=authorship]').check();
  await submit('#studio-apply','AI proposals saved');
  const result=app!.pages.state(p.id).results.at(-1)!; expect(result.payload.state.outcome).toBe('historical');
  expect(await active()).toBe(current.id);
  await page.screenshot({path:join(evidence,scenario+'-before-reload.png'),fullPage:true});
  await open(p.id); expect(await active()).toBe(current.id);
  const historical=result.payload.state.proposals[0]!;
  await expect(page.locator('#studio-active')).toContainText('historical');
  expect(app!.pages.state(p.id).accepted[current.id]).toEqual(accepted);
  expect((await app!.pages.export(p.id,accepted!)).bytes).toEqual(pkg);
  // A fresh browser context has no remembered choice: it must still exclude historical fallback.
  const fresh=await browser.newContext(), freshPage=await fresh.newPage();
  await freshPage.goto(app!.origin);await freshPage.locator(`[data-action=open][data-id="${p.id}"]`).click();
  await expect(freshPage.locator('#studio-active')).toHaveValue(JSON.stringify(reference(current)));
  await fresh.close();
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(evidence,scenario+'-narrow.png'),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.setViewportSize({width:1440,height:1000});
  const port=Number(new URL(app!.origin).port);await page.goto('about:blank');await app!.close();app=null;
  const copy=root+'-closed-copy';cpSync(root,copy,{recursive:true});root=copy;
  app=await startApp(root,port,undefined,undefined,{aiResponseFixture:true});
  await open(p.id);expect(await active()).toBe(current.id);
  expect((await app!.pages.export(p.id,accepted!)).bytes).toEqual(pkg);
  // Historical proposals remain available by deliberate selection, including reload.
  await page.locator('#studio-active').selectOption(JSON.stringify(historical));expect(await active()).toBe(historical.id);
  await open(p.id);expect(await active()).toBe(historical.id);
  await page.locator('#studio-active').selectOption(JSON.stringify(reference(current)));
  await open(p.id);expect(await active()).toBe(current.id);
  receipts.push({scenario,current:reference(current),historical,accepted,preservedAfterReloadAndRestart:true,deliberateHistoricalSelection:true});
 }
 if(process.argv[2]!=='historical') {
  const p=app!.workspace.create({title:'Direction selection repair',mode:'freeroam',visualOS:null,palette:null}).project!, ai=new AIDirections(app!.workspace);
  const round=(name:string)=>{ai.request(p.id,{expectedProject:reference(p),base:null,count:2,instructions:'Mechanical multi-round '+name,references:[]});
   const q=app!.workspace.state(p.id).artifacts!.filter(x=>x.payload.kind==='website-ai-request').at(-1)!;
   const out=aiFixture(p,2);out.candidates.forEach((c,i)=>{c.title=name+i;c.imageNeeds[0]!.prompt=name+i+' exact prompt';});
   ai.apply(p.id,{request:reference(q),response:out,source:'Mechanical selection fixture',model:null,aiAuthorship:true});
   return app!.workspace.state(p.id).bundles!.at(-1)! as NodePacket<IterationBundle>;};
  const a=round('A'),b=round('B');await open(p.id);
  const select=async(candidate:VersionRef)=>{
   await page.getByRole('button',{name:'02  Explore & compare',exact:true}).click();
   const owner=app!.workspace.state(p.id).bundles!.find(x=>(x.payload as IterationBundle).candidates.some(r=>r.id===candidate.id))!;
   await page.locator('#round').selectOption(owner.id);
   await page.locator('.candidate [data-action=select]').evaluateAll((buttons,args)=>{
    const button=buttons.find(x=>JSON.parse((x as HTMLElement).dataset['candidate']!).id===args.id);if(!button)throw Error('Candidate control missing');(button as HTMLButtonElement).click();
   },candidate);
   await expect(page.locator('#app')).not.toHaveAttribute('aria-busy','true');await expect(page.locator('#notice')).toContainText('Direction selected');
  };
  await select(a.payload.candidates[0]!);await select(b.payload.candidates[0]!);
  await page.locator('#accept-design [name=reason]').fill('Mechanical exact review; no designer approval');
  await submit('#accept-design','accepted');
  const expected=b.payload.candidates[0]!, acceptanceBefore=app!.workspace.state(p.id).accepted;
  const check=async()=>{for(const [view,form]of [['03  Native handoff','#native'],['05  Images & assistant','#provider-prepare']]) {
   await page.getByRole('button',{name:view!,exact:true}).click();
   const value=JSON.parse(await page.locator(form+' [name=artifact]').inputValue());expect(value.id).toBe(expected.id);
   expect(value.version).toBe(app!.workspace.kernel.currentVersion(expected.id));
   await expect(page.locator(form+' [name=instructions]')).toHaveValue(/B0 exact prompt/);
  }};
  await check();
  await ai.addAsset(p.id,{expectedProject:reference(p),origin:null,label:'Mechanical reusable original',role:'placeable',permission:'Synthetic fixture use'},await syntheticCompositionImage());
  const asset=app!.workspace.state(p.id).artifacts!.filter(x=>x.payload.kind==='website-asset').at(-1)!;
  await page.getByRole('button',{name:'08  Project assets',exact:true}).click();
  // Refresh the project after the independent media addition and use actual placement controls.
  await open(p.id);await page.getByRole('button',{name:'08  Project assets',exact:true}).click();
  await page.locator('.direction-place [name=target]').selectOption(JSON.stringify({direction:a.payload.candidates[1]!,bundle:reference(app!.workspace.state(p.id).bundles!.find(x=>x.id===a.id)!)}));
  await page.locator('.direction-place [name=reason]').fill('Mechanical older unselected placement');
  await page.locator('.direction-place [name=alt]').fill('Synthetic fixture original');
  await submit('.direction-place','placement');await check();
  await page.getByRole('button',{name:'08  Project assets',exact:true}).click();
  await page.locator('.direction-place [name=target]').selectOption(JSON.stringify({direction:expected,bundle:reference(app!.workspace.state(p.id).bundles!.find(x=>x.id===b.id)!)}));
  await page.locator('.direction-place [name=alt]').fill('Selected direction exact fixture original');
  await page.locator('.direction-place [name=reason]').fill('Mechanical selected placement revision');
  await submit('.direction-place','placement');await check();
  await open(p.id);await check();
  expect(app!.workspace.state(p.id).accepted).toEqual(acceptanceBefore);
  const port=Number(new URL(app!.origin).port);await page.goto('about:blank');await app!.close();app=null;
  app=await startApp(root,port,undefined,undefined,{aiResponseFixture:true});await open(p.id);await check();
  receipts.push({scenario:'legacy-direction-selection',expected,placementTarget:a.payload.candidates[1],acceptanceUnchanged:true,nativeAndAPIDefaultsPreserved:true});
 }
 expect(errors).toEqual([]);writeFileSync(join(evidence,'review-repairs-browser.json'),JSON.stringify({receipts,pageErrors:errors,realProviderCalls:0,fixture:'mechanical'},null,2));
 console.log('Review repairs browser checks passed: '+receipts.length+' scenarios; zero real calls');
} finally {await browser.close();if(app)await app.close();}
