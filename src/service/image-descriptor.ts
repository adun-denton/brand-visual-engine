import type { ImageInfo } from "./assets.ts";
/** Synchronous geometry check for the kernel gate. Full decode remains mandatory on registration/read.
 * Coordinates refer to encoded pixels, never EXIF/display orientation. */
export function matchesImageHeader(bytes: Buffer, image: ImageInfo): boolean {
  try {
    if (bytes.length !== image.bytes) return false;
    let width = 0,
      height = 0;
    if (image.format === "png") {
      if (
        !bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
        bytes.toString("ascii", 12, 16) !== "IHDR"
      )
        return false;
      width = bytes.readUInt32BE(16);
      height = bytes.readUInt32BE(20);
    } else if (image.format === "jpeg") {
      if (bytes[0] !== 255 || bytes[1] !== 216) return false;
      let pos = 2;
      while (pos < bytes.length) {
        if (bytes[pos++] !== 255) return false;
        while (bytes[pos] === 255) pos++;
        const marker = bytes[pos++]!;
        if (marker === 0xda || marker === 0xd9) break;
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
        const length = bytes.readUInt16BE(pos);
        if (length < 2 || pos + length > bytes.length) return false;
        if (
          [
            0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
            0xce, 0xcf,
          ].includes(marker)
        ) {
          height = bytes.readUInt16BE(pos + 3);
          width = bytes.readUInt16BE(pos + 5);
          break;
        }
        pos += length;
      }
    } else {
      if (
        bytes.toString("ascii", 0, 4) !== "RIFF" ||
        bytes.toString("ascii", 8, 12) !== "WEBP"
      )
        return false;
      const kind = bytes.toString("ascii", 12, 16);
      if (kind === "VP8X") {
        width = 1 + bytes.readUIntLE(24, 3);
        height = 1 + bytes.readUIntLE(27, 3);
      } else if (kind === "VP8L" && bytes[20] === 0x2f) {
        const packed = bytes.readUInt32LE(21);
        width = 1 + (packed & 0x3fff);
        height = 1 + ((packed >>> 14) & 0x3fff);
      } else if (
        kind === "VP8 " &&
        bytes.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a]))
      ) {
        width = bytes.readUInt16LE(26) & 0x3fff;
        height = bytes.readUInt16LE(28) & 0x3fff;
      }
    }
    return (
      width === image.width &&
      height === image.height &&
      width > 0 &&
      height > 0
    );
  } catch {
    return false;
  }
}
