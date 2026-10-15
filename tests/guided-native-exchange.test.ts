/** Presentation helpers consume authored durable state; never change canonical evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startApp} from '../src/service/server.ts';
import {reference,canonical} from '../src/kernel/packets.ts';
import {offlineVisualProviders} from '../scripts/visual-fixture.ts';
import {nativeOriginal,nativeReturn} from '../scripts/native-exchange-fixture.ts';
import {nativeSlots,nativeHandoff,nativeGuidance,nativeView} from '../src/web/native-exchange.ts';
const escape=(s:unknown)=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
test('deliberate slots reject empty, repeated, fractional and out-of-range tokens',()=>{
 assert.deepEqual(nativeSlots(' 1, 3,6 '),[1,3,6]);
 for(const s of ['',',','1,','1,,2','0','7','1.0','1,1','1e0','1 2','-1'])assert.throws(()=>nativeSlots(s));
});
test('guided context retains frozen request/kit bytes; current and historical guidance stays distinct',async t=>{
 const root=mkdtempSync(join(tmpdir(),'bve-guided-unit-')),app=await startApp(root,0,undefined,offlineVisualProviders);t.after(async()=>{await app.close();rmSync(root,{recursive:true,force:true});});
 const v=app.visual,p=v.create({title:'Authored guided UI'}),pid=p.project.id,u=v.exploration.createWorkUnit(pid,{version:1,pageType:'homepage',label:'Homepage',source:'Authored fixture'});
 const prepared=await v.command(pid,'prepare',{expectedProject:p.project,unit:reference(u),selections:null,intent:'Authored plain text fixture',count:2,direction:'fresh',brand:null,operation:'create',requests:[],level1:[]}) as any;
 const q=await v.native.compile(pid,reference(prepared.specification),64,48,{version:1,mode:'native-resolution'}),g=v.native.grant(pid,{request:reference(q),slots:[1,2],maxSubmissions:2,maxStatusCalls:0,maxCancelCalls:0,timeoutMs:30000,expiresAt:new Date(Date.now()+3600000).toISOString(),evidence:'synthetic-fixture',reason:'Authored fixture'}),run=v.native.prepare(pid,reference(g));
 const out=await v.native.exportRequest(pid,reference(run),1),kit=await v.native.exportReturnKit(pid,reference(run),1),pkg=JSON.parse(out.manifest.toString());
 const state=v.native.state(pid,reference(u)),saved=canonical(state),entry=state.runs[0]!,slot=entry.slots[0]!;
 const text=nativeHandoff(entry,slot),html=nativeView(state,escape,[prepared.specification]);
 for(const value of [pid,run.id,pkg.packetDigest,'slot: 1','ordered original sources: 0','Native resolution · preferences','not invocation approval','Never automatically retry'])assert.ok(text.includes(value),value);
 assert.match(html,/Inspect the proposal/);assert.match(html,/name="dimensionMode"><option value="exact">Exact size required/);assert.ok(!nativeView(state,escape,[{...prepared.specification,id:'<script>'}]).includes('<script>'));assert.equal(canonical(state),saved);
 assert.deepEqual((await v.native.exportRequest(pid,reference(run),1)).bytes,out.bytes);assert.deepEqual((await v.native.exportReturnKit(pid,reference(run),1)).bytes,kit.bytes);
 v.native.claim(pid,reference(run),1,pkg.packetDigest);const r=await nativeReturn(pkg,await nativeOriginal(80,50));await v.native.importResult(pid,reference(run),r.manifest,r.files,false,1);
 const second=await v.native.exportRequest(pid,reference(run),2),sp=JSON.parse(second.manifest.toString());v.native.control(pid,reference(run),2,'uncertain');const late=await nativeReturn(sp,await nativeOriginal(80,50,1));await v.native.importResult(pid,reference(run),late.manifest,late.files,true,2);
 const received=v.native.state(pid,reference(u)).runs[0]!;assert.match(nativeGuidance(received.slots[0]!),/proposal/);assert.match(nativeGuidance(received.slots[1]!),/Historical evidence only/);
 const result=nativeView(v.native.state(pid,reference(u)),escape,[prepared.specification]);assert.match(result,/Historical only · no current candidate/);assert.match(result,/returned original 80×50/);assert.match(result,/Imported provenance · synthetic-fixture/);
 assert.equal(v.state(pid,reference(u)).candidates.length,1);assert.deepEqual(app.workspace.kernel.acceptedSelections(pid),[]);assert.equal(v.executions.availability().connected,false);
});
