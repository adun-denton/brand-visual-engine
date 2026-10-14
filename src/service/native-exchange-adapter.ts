import { canonical } from '../kernel/packets.ts';
import { checksum } from '../kernel/raster.ts';
import { parseNativePackage, parseNativeResult, validateNativeReturn, type NativePackage, type NativeResult } from '../modules/website/native-exchange-contracts.ts';
import { decode, MAX_IMAGE_BYTES } from './assets.ts';
import { InputError } from './validation.ts';
import { tar } from './handoff.ts';
/** Portable file-map boundary. No archive extraction, URLs, file paths, provider calls or rewriting. */
export class NativeExchangeAdapter {
  private json(bytes:Buffer):unknown {
    if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>262144)throw new InputError('Native manifest exceeds 256 KiB',413);
    try{return JSON.parse(bytes.toString('utf8'));}catch{throw new InputError('Invalid native manifest JSON');}
  }
  private files(files:Map<string,Buffer>,expected:Set<string>) {
    if(!(files instanceof Map)||files.size!==expected.size||files.size>32)throw new InputError('Missing or excessive native files');
    let size=0;
    for(const [path,bytes] of files){if(!expected.has(path)||!/^assets\/[a-f0-9]{64}\.(png|jpg|webp)$/.test(path)||!Buffer.isBuffer(bytes)||bytes.length>MAX_IMAGE_BYTES)throw new InputError('Unsafe/substituted native file');size+=bytes.length;}
    if(size>39*1024*1024)throw new InputError('Native originals exceed package bound',413);
  }
  async readRequest(manifest:Buffer,files:Map<string,Buffer>):Promise<NativePackage> {
    const p=parseNativePackage(this.json(manifest));this.files(files,new Set(p.sources.map(s=>s.path)));
    for(const [i,s] of p.sources.entries())if(canonical(await decode(files.get(s.path)!))!==canonical(p.request.sources[i]!.image))throw new InputError('Native source hash/descriptor mismatch');
    return p;
  }
  async request(p:NativePackage,files:Map<string,Buffer>) {
    const manifest=Buffer.from(canonical(p)+'\n');await this.readRequest(manifest,files);
    return {manifest,files,bytes:tar(new Map([['manifest.json',manifest],...files])),mime:'application/x-tar',filename:'native-request-'+p.binding.exchangeJobId+'.tar'};
  }
  resultManifest(manifest:Buffer):NativeResult {return parseNativeResult(this.json(manifest));}
  async readResult(manifest:Buffer,files:Map<string,Buffer>,request?:NativePackage):Promise<{result:NativeResult;bytes:Buffer|null}> {
    const result=this.resultManifest(manifest);if(request)validateNativeReturn(request,result);this.files(files,new Set(result.output?[result.output.path]:[]));
    const bytes=result.output?files.get(result.output.path)!:null;
    if(bytes&&canonical(await decode(bytes))!==canonical(result.output!.image))throw new InputError('Native original hash/descriptor/full decode mismatch');
    return {result,bytes};
  }
  /** UTF-8 manifest + original upload bytes transported by the local HTTP client, never a model transcription. */
  fileInput(files:{path:string;bytes:Buffer}[]):Map<string,Buffer> {
    const map=new Map<string,Buffer>();if(files.length>32)throw new InputError('Excessive native entries');
    for(const f of files){if(map.has(f.path))throw new InputError('Duplicate native file entry');map.set(f.path,f.bytes);}
    return map;
  }
  hash(bytes:Buffer){return checksum(bytes);}
}
