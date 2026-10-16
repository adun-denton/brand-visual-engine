import {randomBytes,randomUUID} from 'node:crypto';
import {chromium,type Browser,type Page} from '@playwright/test';
import {canonical,digest} from '../kernel/packets.ts';
export type CaptureView={version:1;tabId:string;origin:string;mode:'visible-controlled-tab'|'headless-authored-test'|'visible-authored-test';documentId:string;visibility:'visible';surface:unknown;feedbackHash:string;images:unknown[];geometry:unknown;browser:{engine:'chromium';version:string};visualScale:number;project:string;targetPage:string;layout:string;viewport:{width:number;height:number;deviceScale:number};scroll:{x:number;y:number};zoom:number;focused:string|null;regionTool:string|null;activeElement:string;focus:string[];comparison:string[];displayed:string[];overlays:string;area:'visible-viewport'};
export interface CaptureAdapter {readonly tabId:string;readonly secret:string;readonly mode:CaptureView['mode'];measure():Promise<CaptureView>;screenshot(view:CaptureView,deadline?:number):Promise<Buffer>;close():Promise<void>}
/** Owns exactly one purpose-launched tab. No CDP endpoint or personal profile is exposed. */
export class ControlledReviewTab implements CaptureAdapter {
 readonly tabId=randomUUID();readonly secret=randomBytes(32).toString('hex');readonly mode:CaptureView['mode'];readonly page:Page;readonly browser:Browser;private origin:string;
 private constructor(browser:Browser,page:Page,origin:string,headless:boolean,authoredTest:boolean){this.browser=browser;this.page=page;this.origin=origin;this.mode=headless?'headless-authored-test':authoredTest?'visible-authored-test':'visible-controlled-tab';}
 static async launch(origin:string,options:{headless?:boolean;authoredTest?:boolean;executablePath?:string;viewport?:{width:number;height:number}}={}){
  if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))throw Error('Controlled browser requires the owning loopback service');
  const headless=options.headless??false,browser=await chromium.launch({headless,...(options.executablePath?{executablePath:options.executablePath}:{})});
  try{const viewport=options.viewport??(headless?{width:1440,height:1050}:null),context=await browser.newContext({viewport,...(viewport?{deviceScaleFactor:1}:{}),acceptDownloads:true,serviceWorkers:'block'}),page=await context.newPage(),adapter=new ControlledReviewTab(browser,page,origin,headless,options.authoredTest??false);
   // Secret stays in automation request headers, never URL, DOM, bundle or output.
   await page.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin!==origin){await route.abort('blockedbyclient');return;}await route.continue({headers:{...route.request().headers(),'x-bve-capture-tab':adapter.secret}});});
   await page.addInitScript(()=>{Object.defineProperty(window,'bveReviewDocument',{value:crypto.randomUUID(),writable:false});});
   context.on('page',extra=>{if(extra!==page)void extra.close();});page.on('popup',popup=>void popup.close());await page.goto(origin);return adapter;
  }catch(error){await browser.close();throw error;}
 }
 async measure():Promise<CaptureView>{
  const url=new URL(this.page.url());if(url.origin!==this.origin||!['/','/visual'].includes(url.pathname))throw Error('Capture interrupted: tab navigated away');
  await this.page.evaluate(async()=>{
   const deadline=performance.now()+4000;
   for(;;){
    // Renders may replace image elements while an operation settles. Observe the live surface,
    // rather than waiting indefinitely on decode promises from detached elements.
    const images=[...document.images].filter(i=>{const r=i.getBoundingClientRect();return i.getClientRects().length>0&&(i.matches('.original,.review-originals img')||r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight);});
    if(images.some(i=>i.complete&&!i.naturalWidth))throw Error('Original image unavailable');
    if(document.fonts.status==='loaded'&&images.every(i=>i.complete&&i.naturalWidth)){await new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())));break;}
    if(performance.now()>deadline)throw Error('Capture images/fonts timeout');await new Promise(r=>setTimeout(r,25));
   }
  });
  const raw=await this.page.evaluate(()=>{
   if(document.visibilityState!=='visible')throw Error('Capture interrupted: controlled tab is not visible');
   const surface=document.querySelector<HTMLElement>('#production-review')?.dataset['reviewView'];if(!surface)throw Error('Select an immutable submitted review in this controlled tab');
   const values=(selector:string,attr:string)=>[...document.querySelectorAll(selector)].map(e=>e.getAttribute(attr)!).filter(Boolean);
   const geometry=[...document.querySelectorAll('#production-review, .canvas, .review-originals img, #review-comment, [data-review-note]')].map(e=>{const r=e.getBoundingClientRect();return {tag:e.tagName,id:e.id,box:[r.x,r.y,r.width,r.height].map(n=>Math.round(n*100)/100)};});
   const feedback={comment:(document.querySelector('#review-comment') as HTMLTextAreaElement).value,entries:[...document.querySelectorAll<HTMLTextAreaElement>('[data-review-note]')].map(n=>({id:n.dataset['reviewNote'],comment:n.value,intent:document.querySelector<HTMLSelectElement>('[data-review-intent="'+n.dataset['reviewNote']+'"]')?.value}))};
   const images=[...document.images].flatMap(i=>{const candidate=i.dataset['reviewedSource']??i.closest<HTMLElement>('[data-canvas]')?.dataset['canvas']??i.closest<HTMLElement>('[data-candidate]')?.dataset['candidate'];if(!candidate)return [];const u=new URL(i.currentSrc||i.src,location.href);if(u.origin!==location.origin||!['/api/v1/visual/image','/api/v1/visual/review/original'].includes(u.pathname)||[...u.searchParams.keys()].some(k=>!['project','id','version','record','index'].includes(k)))throw Error('Displayed source URL is outside the bounded image routes');return [{candidate,kind:u.pathname.endsWith('/original')?'review-original':'candidate-preview',project:u.searchParams.get('project'),id:u.searchParams.get('id'),version:u.searchParams.get('version'),record:u.searchParams.get('record')?JSON.parse(u.searchParams.get('record')!):null,index:u.searchParams.get('index')===null?null:Number(u.searchParams.get('index')),width:i.naturalWidth,height:i.naturalHeight}];});
   return {focused:document.querySelector<HTMLElement>('.focus-view')?.dataset['focused']??null,regionTool:(document.querySelector('#region-tool') as HTMLSelectElement)?.value??null,activeElement:document.activeElement?.id||document.activeElement?.tagName||'',feedback,images,geometry,visualScale:visualViewport?.scale??1,project:(document.querySelector('#project') as HTMLSelectElement)?.value,targetPage:(document.querySelector('#page') as HTMLSelectElement)?.value,documentId:(window as unknown as {bveReviewDocument:string}).bveReviewDocument,surface:JSON.parse(surface),layout:(document.querySelector('#layout') as HTMLSelectElement)?.value,viewport:{width:innerWidth,height:innerHeight,deviceScale:devicePixelRatio},scroll:{x:scrollX,y:scrollY},zoom:Number((document.querySelector('#zoom') as HTMLSelectElement)?.value??1),focus:values('.canvas','data-canvas'),comparison:values('[data-compare][aria-pressed="true"]','data-compare'),displayed:[...new Set([...values('[data-candidate]','data-candidate'),...values('[data-canvas]','data-canvas'),...values('[data-reviewed-source]','data-reviewed-source')])],overlays:values('svg.anchors','data-unused').join('')||[...document.querySelectorAll('svg.anchors')].map(e=>e.innerHTML).join('')};
  });
  const {feedback,...data}=raw;const feedbackHash=digest(feedback);
  if(!data.documentId||!['sheet','film'].includes(data.layout)||![1,1.5,2].includes(data.zoom)||data.viewport.width<320||data.viewport.width>2560||data.viewport.height<320||data.viewport.height>1600||data.viewport.deviceScale<1||data.viewport.deviceScale>2||JSON.stringify(data).length>65536)throw Error('Capture view exceeds supported bounds');
  return {version:1,tabId:this.tabId,origin:this.origin,mode:this.mode,visibility:'visible',feedbackHash,browser:{engine:'chromium',version:this.browser.version()},...data,area:'visible-viewport'};
 }
 async screenshot(expected:CaptureView,deadline=Date.now()+15000){
  const remaining=()=>{const ms=deadline-Date.now();if(ms<=0)throw Error('Capture deadline exceeded');return ms;};remaining();
  const check=async()=>{remaining();if(canonical(await this.measure())!==canonical(expected))throw Error('Capture interrupted: view changed');};
  await check();const bytes=await this.page.screenshot({type:'png',fullPage:false,timeout:Math.min(10000,remaining()),animations:'allow',caret:'initial'});await check();return bytes;
 }
 async close(){await this.browser.close();}
}
