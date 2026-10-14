// Offline original-file builder. Never invokes a host, provider or BVE service.
import { readFileSync, writeFileSync, mkdirSync, lstatSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import Ajv from 'ajv';
const kit = import.meta.dirname;
const [configName, destination, original] = process.argv.slice(2);
if (!configName || !destination) throw Error('Usage: node build-return.mjs filled-template.json output-directory [original-file]');
const readJson = name => {
  const s = lstatSync(name);
  if (!s.isFile() || s.isSymbolicLink() || s.size > 262144) throw Error('Unsafe or excessive JSON');
  return JSON.parse(readFileSync(name, 'utf8'));
};
const schema = readJson(join(kit, 'result-schema-v2.json'));
const result = readJson(resolve(configName));
const canonical = x => x === null || typeof x !== 'object' ? JSON.stringify(x) : Array.isArray(x) ? '['+x.map(canonical).join(',')+']' : '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';
const request = readJson(join(kit, 'manifest.json'));
const {packetDigest,...body}=request;
const policy=request.request?.dimensionPolicy;
if(request.version!==2||request.request.version!==2||request.request.compiler!=='native-raster-execution-v2'||!policy||policy.version!==1||!['exact','native-resolution'].includes(policy.mode)||canonical(Object.keys(policy).sort())!==canonical(['mode','version'])||createHash('sha256').update(canonical(body)).digest('hex')!==packetDigest)throw Error('Unsupported or changed native request/policy/digest');
if(result.version!==2||canonical(result.dimensionPolicy)!==canonical(policy)||result.packetDigest!==packetDigest||canonical(result.binding)!==canonical(request.binding))throw Error('Return policy/binding/digest mismatch');
let bytes;
if (result.outcome === 'returned') {
  if (!original) throw Error('Returned outcome requires an original file');
  const stat = lstatSync(original);
  if (!stat.isFile() || stat.isSymbolicLink() || !stat.size || stat.size > 8 * 1024 * 1024) throw Error('Original must be a bounded regular file');
  bytes = readFileSync(original);
  const format = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'png'
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'jpeg'
    : bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP' ? 'webp' : null;
  if (!format) throw Error('Original must be PNG/JPEG/WebP');
  const decoder = sharp(bytes, { failOn:'warning', limitInputPixels:16000000, animated:true });
  const meta = await decoder.metadata();
  if (meta.format !== format || !meta.width || !meta.height || (meta.pages ?? 1) !== 1 || meta.width > 8192 || meta.height > 8192 || meta.width * meta.height > 16000000) throw Error('Original dimensions/format exceed limits');
  await decoder.raw().toBuffer(); // Full decode; bytes written below stay original.
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const image = { id:checksum, checksum, width:meta.width, height:meta.height, format, bytes:bytes.length };
  if (policy.mode === 'exact' && (image.width !== request.request.width || image.height !== request.request.height)) throw Error('Exact requested dimensions required; do not resize');
  if (request.sources.some(s => s.checksum === checksum)) throw Error('Output cannot substitute a source');
  result.output = { path:'assets/'+checksum+'.'+(format === 'jpeg' ? 'jpg' : format), image };
} else if (original) throw Error('Failed outcome takes no image');
const validate = new Ajv({strict:true}).compile(schema);
if (!validate(result)) throw Error('Incomplete or invalid return: '+JSON.stringify(validate.errors));
if (canonical(result.attestation.usage).length > 12000) throw Error('Usage exceeds 12000 canonical characters');
const serialized = canonical(result)+'\n';
if (Buffer.byteLength(serialized) > 262144) throw Error('Result exceeds manifest limit');
mkdirSync(resolve(destination), {recursive:true});
if (bytes) { mkdirSync(join(destination,'assets'), {recursive:true}); writeFileSync(join(destination,result.output.path),bytes); }
writeFileSync(join(destination,'result.json'),serialized);
console.log(JSON.stringify({manifest:'result.json',original:result.output?.path??null,origin:'imported',verification:'operator-attestation-only'}));
