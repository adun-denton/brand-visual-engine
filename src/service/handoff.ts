import { InputError } from './validation.ts';
/** Bounded deterministic ustar: generated names only, no links, timestamps or source paths. */
export function tar(files: Map<string, Buffer>, mode: 'legacy' | 'page' | 'website' | 'request' = 'legacy'): Buffer {
  const chunks: Buffer[] = [];
  let size = 1024;
  for (const [name, data] of [...files].sort(([a], [b]) =>
    a.localeCompare(b, 'en'),
  )) {
    const safe = /^(manifest\.json|index\.html|RECONSTRUCT\.md|assets\/[a-f0-9]{64}\.(png|jpg|webp))$/.test(name)
      || (mode === 'website' && /^(?:[A-Za-z0-9_-]+\/)+index\.html$/.test(name))
      || (mode === 'request' && /^(request\.json|response-schema\.json)$/.test(name));
    if (!safe || Buffer.byteLength(name) > 100)
      throw new InputError('Unsafe handoff path');
    size += 512 + Math.ceil(data.length / 512) * 512;
    if (size > 40 * 1024 * 1024)
      throw new InputError('Handoff exceeds 40 MiB', 413);
    const h = Buffer.alloc(512),
      oct = (n: number, len: number) =>
        n.toString(8).padStart(len - 1, '0') + '\0';
    h.write(name, 0, 100, 'ascii');
    h.write('0000644\0', 100, 8);
    h.write(oct(0, 8), 108, 8);
    h.write(oct(0, 8), 116, 8);
    h.write(oct(data.length, 12), 124, 12);
    h.write(oct(0, 12), 136, 12);
    h.fill(32, 148, 156);
    h.write('0', 156);
    h.write('ustar\0', 257);
    h.write('00', 263);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
    chunks.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  return Buffer.concat([...chunks, Buffer.alloc(1024)]);
}
