/** Actual UI handlers and authored originals; no generation or model transport. */
import {chromium,expect} from '@playwright/test';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {startApp} from '../src/service/server.ts';
import {reference} from '../src/kernel/packets.ts';
import {offlineVisualProviders} from './visual-fixture.ts';
import {nativeOriginal,nativeReturn} from './native-exchange-fixture.ts';
const evidence=resolve(process.env['BVE_EVIDENCE_DIR']??'/tmp/bve-native-resolution-browser');mkdirSync(evidence,{recursive:true});
const root=mkdtempSync(join(tmpdir(),'bve-native-resolution-browser-')),app=await startApp(root,0,undefined,offlineVisualProviders);
let browser:Awaited<ReturnType<typeof chromium.launch>>|null=null;
const snapshot=()=>{const db=new DatabaseSync(join(root,'kernel.sqlite'),{readOnly:true});try{return JSON.stringify({rows:['kernel_packets','kernel_events','kernel_selections'].map(n=>db.prepare('SELECT * FROM '+n+' ORDER BY 1,2').all()),files:readdirSync(join(root,'native-assets')).sort()});}finally{db.close();}};
try{
 const v=app.visual,p=v.create({title:'Authored native-resolution controls'}),pid=p.project.id,u=v.exploration.createWorkUnit(pid,{version:1,pageType:'homepage',label:'Homepage',source:'Authored browser fixture'});
 await v.command(pid,'prepare',{expectedProject:p.project,unit:reference(u),selections:null,intent:'Authored size policy UI fixture, no native generation',count:1,direction:'fresh',brand:null,operation:'create',requests:[],level1:[]});
 browser=await chromium.launch({headless:true,...(process.env['BVE_CHROMIUM_EXECUTABLE']?{executablePath:process.env['BVE_CHROMIUM_EXECUTABLE']}:{})});const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors:string[]=[],checks:any[]=[];page.on('pageerror',e=>errors.push(e.message));
 const idle=()=>expect(page.locator('#visual-app')).not.toHaveAttribute('aria-busy','true'),open=()=>page.locator('#native-exchange-panel').evaluate(n=>(n as HTMLDetailsElement).open=true);
 await page.goto(app.origin);await page.locator('#project').selectOption(pid);await idle();await page.locator('#page').selectOption(u.id+':1');await idle();
 for(const layout of ['sheet','film']){
  await page.setViewportSize({width:1440,height:1050});await page.locator('#layout').selectOption(layout);await idle();await open();await expect(page.locator('.auxiliary-panel')).toHaveCount(0);
  await expect(page.locator('[name=dimensionMode]')).toHaveValue('exact');
  const prepare=async(mode:string)=>{await open();await page.locator('[name=dimensionMode]').selectOption(mode);for(const [name,value]of [['width','1024'],['height','1024'],['slots','1'],['lifetime','3600']])await page.locator('#native-prepare [name='+name+']').fill(value!);await page.locator('[name=evidence]').selectOption('synthetic-fixture');const known=new Set(v.native.state(pid,reference(u)).runs.map(x=>x.run.id));await page.getByRole('button',{name:'Prepare manual grant',exact:true}).click();await idle();await open();return v.native.state(pid,reference(u)).runs.find(x=>!known.has(x.run.id))!.run;};
  const exportClaim=async(run:any)=>{const download=page.waitForEvent('download');await page.locator('[data-native-action=export][data-native-run="'+run.id+'"]').click();await(await download).saveAs(join(evidence,layout+'-'+run.id+'.tar'));await idle();await open();await page.locator('[data-native-action=claim][data-native-run="'+run.id+'"]').click();await idle();await open();return v.native.state(pid,reference(u)).runs.find(x=>x.run.id===run.id)!.slots[0]!.release!;};
  const upload=async(run:any,result:Awaited<ReturnType<typeof nativeReturn>>)=>{const f=page.locator('[data-native-import="'+run.id+'"]');await f.locator('[name=manifest]').setInputFiles({name:'authored.json',mimeType:'application/json',buffer:result.manifest});await f.locator('[name=original]').setInputFiles({name:'authored.png',mimeType:'image/png',buffer:[...result.files.values()][0]!});await f.getByRole('button',{name:'Import result',exact:true}).click();await idle();await open();};
  const run=await prepare('native-resolution'),pkg=await exportClaim(run),r=await nativeReturn(pkg,await nativeOriginal(1254,900));expect(pkg.request.version).toBe(2);expect(pkg.request.version===2&&pkg.request.dimensionPolicy.mode).toBe('native-resolution');
  await upload(run,r);const card=page.locator('.execution-run').filter({has:page.locator('[data-native-run="'+run.id+'"]')});await expect(card.locator('.native-dimensions')).toContainText('preferences: 1024×1024');await expect(card.locator('.native-dimensions')).toContainText('returned original 1254×900');await expect(card.locator('.native-dimensions')).toContainText('Exact size or ratio compliance is not claimed');await card.screenshot({path:join(evidence,layout+'-native-size.png')});
  const exact=await prepare('exact'),exactPkg=await exportClaim(exact),wrong=await nativeReturn(exactPkg,await nativeOriginal(1254,1254)),before=snapshot();await upload(exact,wrong);await expect(page.locator('#visual-notice')).toContainText('dimensions mismatch');expect(snapshot()).toBe(before);await page.locator('#native-exchange-panel').screenshot({path:join(evidence,layout+'-exact-rejected.png')});
  const count=v.state(pid,reference(u)).candidates.length;expect(app.workspace.kernel.acceptedSelections(pid)).toHaveLength(0);expect(v.executions.availability().connected).toBe(false);
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.locator('#native-exchange-panel').screenshot({path:join(evidence,layout+'-narrow.png')});checks.push({layout,explicitChoice:true,default:'exact',requested:[1024,1024],actual:[1254,900],ratioNotClaimed:true,exactWrongSizeRejectedAtomically:true,candidates:count,accepted:0});
 }
 expect(errors).toEqual([]);writeFileSync(join(evidence,'summary.json'),JSON.stringify({checks,errors,nativeCalls:0,accountCalls:0,modelCalls:0,gpuCalls:0},null,2)+'\n');console.log('Native-resolution browser controls passed');
}finally{await browser?.close();await app.close();rmSync(root,{recursive:true,force:true});}
