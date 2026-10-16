import {runningInstallation} from '../src/service/project-bootstrap.ts';
/** Authored local originals only. Does not invoke a model, provider or synthetic-registration. */
import {join} from 'node:path';
import {writeFileSync,mkdirSync} from 'node:fs';
import sharp from 'sharp';
import {inspectRaster} from '../src/service/assets.ts';
import {bytesHash,type ProductionWork} from '../src/service/production-intake.ts';
import type {Job,Delivery} from '../src/modules/website/production-contracts.ts';
import type {ProjectConfig} from '../src/service/project-bootstrap.ts';
import type {Workspace} from '../src/service/workspace.ts';
import {reference} from '../src/kernel/packets.ts';
export const fixtureInstallation=runningInstallation();
export const fixtureOutput={preferredWidth:960,preferredHeight:640,formats:['png','jpeg','webp'],maxBytes:8*1024*1024,maxPixels:16_000_000,maxDimension:8192};
export function fixturePreparation(w:Workspace,c:ProjectConfig,count=3){return {specification:{version:1,compiler:'raster-input-v1',project:reference(w.project(c.projectId)),workUnit:c.initialWorkUnit,medium:'website-raster',operation:'create',selections:null,selectionSnapshot:null,rawIntent:'Three authored website composition studies; fixture only',count,resources:[],direction:'fresh',brand:{enabled:false},sourceScopes:[],facts:[],constraints:[],metricRequests:[],provenance:'Authored BVE-VOS-01 integration fixture',executionAuthorization:null},output:fixtureOutput,worker:{kind:'native-generator',configuration:null,imageModel:null}};}
export async function authoredOriginal(index=0){
 const colors=['#146970','#9c552f','#403d73'],accent=colors[index%3]!;
 const svg=`<svg width="960" height="640" xmlns="http://www.w3.org/2000/svg"><rect width="960" height="640" fill="#f4f0e7"/><rect x="0" y="0" width="960" height="56" fill="${accent}"/><rect x="58" y="104" width="${index===1?840:400}" height="252" rx="20" fill="${accent}"/><rect x="510" y="104" width="390" height="252" rx="20" fill="#d4c7b4"/><rect x="58" y="405" width="250" height="165" rx="12" fill="#ded8ce"/><rect x="350" y="405" width="250" height="165" rx="12" fill="#ded8ce"/><rect x="645" y="405" width="250" height="165" rx="12" fill="${accent}"/></svg>`;
 return sharp(Buffer.from(svg)).png().toBuffer();
}
export async function stageDelivery(root:string,job:ProductionWork<Job>,bytes:Buffer|null,outcome:Delivery['outcome']='ready',changes:Partial<Delivery>={}){
 const s=job.payload.state,dir=join(root,s.staging);mkdirSync(dir,{recursive:true});
 const image=bytes?(await inspectRaster(bytes)).image:null;
 const d:Delivery={version:1,projectId:job.projectId!,workUnit:s.workUnit,iteration:s.iteration,jobId:job.id,spec:s.spec,specHash:s.specHash,sources:s.sources,outcome,error:outcome==='ready'?null:'Authored '+outcome+' evidence',output:image?{filename:'original.png',image}:null,evidence:{actualPrompt:null,worker:'authored-fixture-script',imageModel:null,tool:'sharp; authored SVG rasterization'},provenance:'authored-fixture',...changes};
 if(bytes)writeFileSync(join(dir,'original.png'),bytes);
 const manifest=Buffer.from(JSON.stringify(d,null,2)+'\n');writeFileSync(join(dir,'delivery.json'),manifest);
 // Completion marker is deliberately last.
 writeFileSync(join(dir,'complete.json'),JSON.stringify({version:1,jobId:job.id,deliveryHash:bytesHash(manifest)})+'\n');return d;
}
