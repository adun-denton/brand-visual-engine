/** Cross-surface navigation and chat-closed V05 interaction; disposable authored data only. */
import {chromium,expect} from '@playwright/test';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';
import {startApp} from '../src/service/server.ts';
import {reference,canonical} from '../src/kernel/packets.ts';
import {visualFixture,offlineVisualProviders} from './visual-fixture.ts';
import {seedRepairPage} from './inference-repair-fixture.ts';
import {pageSignature} from '../src/modules/website/page.ts';
import {ChatFixture} from './chat-fixture.ts';
const evidence=resolve(process.env['BVE_EVIDENCE_DIR']??'/tmp/bve-combined-browser');mkdirSync(evidence,{recursive:true});
const root=mkdtempSync(join(tmpdir(),'bve-combined-browser-')),driver=new ChatFixture();
let app=await startApp(root,0,undefined,offlineVisualProviders,{chatDriver:driver,aiResponseFixture:true});
const project=app.visual.create({title:'Form / Field · combined foundation'}).project,pid=project.id;
const unit=app.visual.exploration.createWorkUnit(pid,{version:1,pageType:'homepage',label:'Homepage',source:'Authored cross-surface fixture'});
const candidate=await app.visual.exploration.importCandidate(pid,reference(unit),await visualFixture(0),'Authored interaction fixture');
const semantic=await seedRepairPage(app.pages,pid);app.pages.accept(pid,{artifact:reference(semantic),expected:null,reason:'Synthetic fixture review',reviewedHash:pageSignature(semantic.payload.state),acknowledgeFindings:true});
const semanticBefore=(await app.pages.export(pid,reference(semantic))).bytes;
const browser=await chromium.launch({headless:true,...(process.env['BVE_CHROMIUM_EXECUTABLE']?{executablePath:process.env['BVE_CHROMIUM_EXECUTABLE']}:{})});
const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors:string[]=[],requests:string[]=[],screens:string[]=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.method()+' '+new URL(r.url()).pathname));
const idle=async()=>expect(page.locator('#visual-app')).not.toHaveAttribute('aria-busy','true');
const open=async()=>{await page.locator('#project').selectOption(pid);await idle();await page.locator('#page').selectOption(unit.id+':1');await idle();};
const shot=async(name:string)=>{await page.screenshot({path:join(evidence,name+'.png')});screens.push(name+'.png');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);};
try{
 await page.goto(app.origin);await expect(page.locator('#visual-app')).toBeVisible();await expect(page.locator('#conversation')).toHaveCount(0);await open();
 await expect(page.locator('#prepare [name=count]')).toHaveValue('');await expect(page.locator('#prepare [name=direction]')).toHaveValue('');
 await expect(page.locator('#prepare [name=brand]')).toHaveValue('');
 await page.locator('#prepare [name=intent]').fill('Synthetic chat-closed variation');await page.locator('#prepare [name=count]').selectOption('1');await page.locator('#prepare [name=direction]').selectOption('fresh');await page.locator('#prepare button.primary').click();await idle();await expect(page.locator('.prepared')).toContainText('1 pending attempts prepared');
 await page.locator('#project-library>summary').click();await page.locator('#library-load').click();await expect(page.locator('#library-empty')).toBeVisible();
 // Library saves are explicit service operations, independent of legacy chat context.
 const item=(await app.library.save(pid,{expectedProject:project,unit:reference(unit),candidate:reference(candidate),integrity:candidate.integrity,extent:'whole'})).item;
 await page.locator('#library-load').click();await expect(page.locator('.library-card')).toHaveCount(1);
 const note=app.memory.saveNote(pid,{expected:null,note:{version:1,scope:reference(unit),text:'Synthetic combined memory',source:'human-authored',evidence:[]}}),capsule=app.memory.createCapsule(pid,{scope:reference(unit),previous:null});
 const capsuleBefore=app.memory.download(pid,reference(capsule)).output,libraryBefore=(await app.library.export(pid,'package',reference(item),item.integrity)).bytes;
 const stateBefore=canonical({packets:app.workspace.kernel.latestPackets(),ledger:app.workspace.kernel.ledger(pid),accepted:app.workspace.kernel.acceptedSelections(pid)});
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});if(!(await page.locator('#library-load').isVisible()))await page.locator('#project-library>summary').click();await page.locator('#project-library').scrollIntoViewIfNeeded();await shot('visual-library-'+width);await page.evaluate(()=>scrollTo(0,0));await shot('visual-entry-'+width);
  await page.getByRole('link',{name:'Legacy semantic workspace',exact:true}).click();await expect(page).toHaveURL(app.origin+'/legacy');await expect(page.locator('#conversation')).toHaveCount(1);await shot('legacy-'+width);
  await page.getByRole('link',{name:'Return to visual exploration',exact:true}).click();await expect(page).toHaveURL(app.origin+'/visual');await open();await expect(page.locator('#conversation')).toHaveCount(0);
 }
 expect(driver.calls).toBe(0);expect(app.chat.state(pid).session.turns).toHaveLength(0);expect(app.visual.executions.availability().connected).toBe(false);
 expect(requests.filter(r=>r.startsWith('POST ')&&!r.startsWith('POST /api/v1/visual/'))).toEqual([]);
 expect(requests.filter(r=>/auth|connect|chat\/send|execute|grant/.test(r))).toEqual([]);
 expect(canonical({packets:app.workspace.kernel.latestPackets(),ledger:app.workspace.kernel.ledger(pid),accepted:app.workspace.kernel.acceptedSelections(pid)})).toBe(stateBefore);
 await context.close();await app.close();app=await startApp(root,0,undefined,offlineVisualProviders,{chatDriver:driver});
 expect((await app.pages.export(pid,reference(semantic))).bytes).toEqual(semanticBefore);
 expect((await app.library.export(pid,'package',reference(item),item.integrity)).bytes).toEqual(libraryBefore);
 expect(app.memory.download(pid,reference(capsule)).output).toBe(capsuleBefore);
 expect(app.memory.index(pid,reference(unit)).entries.some(e=>e.ref.id===note.id)).toBe(true);
 expect(canonical({packets:app.workspace.kernel.latestPackets(),ledger:app.workspace.kernel.ledger(pid),accepted:app.workspace.kernel.acceptedSelections(pid)})).toBe(stateBefore);
 expect(errors).toEqual([]);writeFileSync(join(evidence,'result.json'),JSON.stringify({head:process.env['BVE_CANDIDATE_COMMIT']??null,screens,requests,errors,chatCalls:driver.calls,executorConnected:false,coldReopen:true,canonicalStatePreserved:true,accountCalls:0,modelCalls:0,imageProviderCalls:0,gpuCalls:0},null,2)+'\n');console.log('Combined default/legacy/return, chat-closed prepare/Library/memory and cold-reopen checks passed.');
}finally{await browser.close();await app.close();rmSync(root,{recursive:true,force:true});}
