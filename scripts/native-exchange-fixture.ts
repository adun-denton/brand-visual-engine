/** Authored fixtures exercise portable request/result bytes; no image/account tool exists here. */
import sharp from 'sharp';
import { decode } from '../src/service/assets.ts';
import { canonical } from '../src/kernel/packets.ts';
import { sourcePath, type NativePackage, type NativeResult } from '../src/modules/website/native-exchange-contracts.ts';
export async function nativeOriginal(width=64,height=48,index=0,format:'png'|'jpeg'|'webp'='png'){
  return sharp({create:{width,height,channels:3,background:['#146442','#874429','#254889'][index%3]!}}).toFormat(format).toBuffer();
}
export async function nativeReturn(p:NativePackage,bytes?:Buffer,receiptId='authored-native-return'){
  bytes??=await nativeOriginal(p.request.width,p.request.height);
  const image=await decode(bytes);
  const result:NativeResult={version:1,kind:'bve-native-result',binding:p.binding,packetDigest:p.packetDigest,receiptId,origin:'imported',outcome:'returned',output:{path:sourcePath(image),image},rights:'Authored synthetic raster fixture; testing only',attestation:{kind:'synthetic-fixture',verification:'operator-attestation-only',hostInvocationId:null,model:null,seed:null,usage:null,cost:null,providerId:null,statement:'Hand-authored synthetic fixture. No host, model or native image invocation.'},message:'Synthetic native-envelope return; not generated'};
  return {result,manifest:Buffer.from(canonical(result)+'\n'),files:new Map([[result.output!.path,bytes]])};
}
/** Test-only ustar reader: authored outbox only. Production importer never accepts/extracts archives. */
export function fixtureTar(bytes:Buffer){const files=new Map<string,Buffer>();for(let pos=0;pos+512<bytes.length;){const h=bytes.subarray(pos,pos+512);if(h.every(x=>x===0))break;const name=h.toString('ascii',0,100).split('\0')[0]!,size=parseInt(h.toString('ascii',124,136).replaceAll('\0','').trim(),8);if(h[156]!==48||!Number.isFinite(size)||files.has(name))throw Error('Invalid authored fixture archive');files.set(name,bytes.subarray(pos+512,pos+512+size));pos+=512+Math.ceil(size/512)*512;}return files;}
