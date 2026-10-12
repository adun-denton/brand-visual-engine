import sharp from 'sharp';
import { createHash, randomUUID } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  openSync,
  fsyncSync,
  closeSync,
  lstatSync,
} from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { InputError } from './validation.ts';
import { canonical } from '../kernel/packets.ts';
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_PIXELS = 16_000_000;
export interface ImageInfo {
  id: string;
  checksum: string;
  width: number;
  height: number;
  format: 'png' | 'jpeg' | 'webp';
  bytes: number;
}
export interface RasterOrientation { coordinates:'encoded-top-left'; exif:number|null; displayWidth:number; displayHeight:number; }
export interface RasterFacts { image:ImageInfo; orientation:RasterOrientation; }
export async function inspectRaster(bytes:Buffer):Promise<RasterFacts> {
  const image=await decode(bytes), meta=await sharp(bytes).metadata(), exif=meta.orientation??null;
  if(exif!==null&&(!Number.isInteger(exif)||exif<1||exif>8))throw new InputError('Invalid raster orientation');
  const swapped=exif!==null&&exif>=5;
  return {image,orientation:{coordinates:'encoded-top-left',exif,displayWidth:swapped?image.height:image.width,displayHeight:swapped?image.width:image.height}};
}
const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
export async function decode(bytes: Buffer): Promise<ImageInfo> {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES)
    throw new InputError('Image exceeds the 8 MiB limit or is empty', 413);
  // Reject vector/other formats before invoking a decoder. No URL or path is ever an input.
  const format = bytes
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ? 'png'
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      ? 'jpeg'
      : bytes.toString('ascii', 0, 4) === 'RIFF' &&
          bytes.toString('ascii', 8, 12) === 'WEBP'
        ? 'webp'
        : null;
  if (!format) throw new InputError('Use a decoded PNG, JPEG or WebP image');
  try {
    const image = sharp(bytes, {
      failOn: 'warning',
      limitInputPixels: MAX_PIXELS,
      animated: true,
    });
    const meta = await image.metadata();
    if (
      meta.format !== format ||
      !meta.width ||
      !meta.height ||
      (meta.pages ?? 1) !== 1 ||
      meta.width > 8192 ||
      meta.height > 8192 ||
      meta.width * meta.height > MAX_PIXELS
    )
      throw new Error('limits');
    await image.raw().toBuffer(); // Metadata alone cannot detect truncated/corrupt pixel data.
    const checksum = hash(bytes);
    return {
      id: checksum,
      checksum,
      width: meta.width,
      height: meta.height,
      format,
      bytes: bytes.length,
    };
  } catch {
    throw new InputError(
      'Image cannot be fully decoded or exceeds dimensions (8192px / 16 MP)',
    );
  }
}
export class Assets {
  root: string;
  private decoded=new Map<string,RasterFacts>();
  constructor(root: string) {
    this.root = join(root, 'native-assets');
    mkdirSync(this.root, { recursive: true });
    mkdirSync(join(root, 'quarantine'), { recursive: true });
  }
  exists(id: string, checksum: string): boolean {
    try {
      return id === checksum && hash(this.read(id)) === checksum;
    } catch {
      return false;
    }
  }
  read(id: string): Buffer {
    if (!/^[a-f0-9]{64}$/.test(id))
      throw new InputError('Invalid asset identity');
    const path = join(this.root, id);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_IMAGE_BYTES)
      throw new InputError('Unsafe asset file');
    const bytes = readFileSync(path);
    if (hash(bytes) !== id) throw new InputError('Asset checksum mismatch');
    return bytes;
  }
  /** Cache only fully decoded facts under content hash; each use still verifies exact stored bytes. */
  async inspect(image:ImageInfo):Promise<RasterFacts> {
    const facts=await inspectRaster(this.read(image.id));
    if(canonical(facts.image)!==canonical(image))throw new InputError('Raster descriptor mismatch');
    this.remember(facts);return facts;
  }
  private remember(facts:RasterFacts) {
    if(this.decoded.size>=128)this.decoded.delete(this.decoded.keys().next().value!);
    this.decoded.set(facts.image.checksum,facts);
  }
  facts(image:ImageInfo):RasterFacts|null {
    try {
      const bytes=this.read(image.id);
      let facts=this.decoded.get(image.checksum);
      if(!facts){
        const r=spawnSync(process.execPath,[join(import.meta.dirname,'raster-inspect-worker.ts')],{input:bytes,maxBuffer:1024*1024,timeout:10000,windowsHide:true});
        if(r.status!==0)return null;
        facts=JSON.parse(r.stdout.toString()) as RasterFacts;
        this.remember(facts);
      }
      return canonical(facts.image)===canonical(image)?structuredClone(facts):null;
    }catch{return null;}
  }
  save(bytes: Buffer, info: Pick<ImageInfo, 'id' | 'checksum'>): void {
    if (
      bytes.length > MAX_IMAGE_BYTES ||
      hash(bytes) !== info.checksum ||
      info.id !== info.checksum
    )
      throw new InputError('Asset checksum mismatch');
    const path = join(this.root, info.id);
    if (existsSync(path)) {
      this.read(info.id);
      return;
    }
    this.write(path, bytes);
  }
  quarantine(bytes: Buffer): void {
    if (bytes.length <= MAX_IMAGE_BYTES)
      this.write(join(this.root, '..', 'quarantine', randomUUID()), bytes);
  }
  private write(path: string, bytes: Buffer): void {
    const temp = path + '.' + randomUUID() + '.tmp';
    writeFileSync(temp, bytes, { flag: 'wx', mode: 0o600 });
    const fd = openSync(temp, 'r+');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, path);
    if (process.platform !== 'win32') {
      const directory = openSync(join(path, '..'), 'r');
      try {
        fsyncSync(directory);
      } finally {
        closeSync(directory);
      }
    }
  }
  async preview(id: string): Promise<Buffer> {
    const bytes = this.read(id);
    await decode(bytes);
    return sharp(bytes).rotate().png().toBuffer();
  }
}
