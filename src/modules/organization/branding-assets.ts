import { randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { inflateSync } from "node:zlib";
import { env } from "@/config/env";
import { AppError } from "@/utils/AppError";
import { logger } from "@/lib/logger";

export const BRANDING_MAX_BYTES = 256 * 1024;
const MAX_DIMENSION = 2048;
const assetPrefix = "/api/organization/branding-assets/";
const filenamePattern = /^[a-f0-9]{64}\.(png|jpg|webp)$/;
export type BrandingAssetKind = "logo" | "favicon";

function invalidImage(): never { throw new AppError(400, "Upload a valid PNG, JPEG or WebP image, up to 2048 pixels per side"); }
function dimensions(width: number, height: number) {
  if (!width || !height || width > MAX_DIMENSION || height > MAX_DIMENSION) invalidImage();
}

export function validateBrandingImage(data: Buffer, contentType: string, kind: BrandingAssetKind) {
  if (!data.length) throw new AppError(400, "Choose an image to upload");
  if (data.length > BRANDING_MAX_BYTES) throw new AppError(413, "Image must be 256 KB or smaller");
  const mime = contentType.split(";", 1)[0]?.trim().toLowerCase();
  if (kind === "favicon" && mime !== "image/png") throw new AppError(415, "Favicon must be a PNG image");
  if (mime === "image/png") {
    if (data.length < 45 || !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || data.toString("ascii", 12, 16) !== "IHDR" || data.readUInt32BE(8) !== 13) invalidImage();
    dimensions(data.readUInt32BE(16), data.readUInt32BE(20));
    const depth = data[24]!, color = data[25]!, interlace = data[28]!;
    const depths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
    if (!depths[color]?.includes(depth) || data[26] !== 0 || data[27] !== 0 || interlace > 1) invalidImage();
    const channels: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
    const width = data.readUInt32BE(16), height = data.readUInt32BE(20), bitsPerPixel = depth * channels[color]!;
    const passes = interlace ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]];
    const scanlines = passes.flatMap(([x, y, dx, dy]) => {
      const columns = Math.max(0, Math.ceil((width - x!) / dx!)), count = Math.max(0, Math.ceil((height - y!) / dy!));
      return columns && count ? [{ count, bytes: 1 + Math.ceil(columns * bitsPerPixel / 8) }] : [];
    });
    const expectedBytes = scanlines.reduce((total, line) => total + line.count * line.bytes, 0);
    const compressed: Buffer[] = [];
    let offset = 8, sawData = false, sawEnd = false;
    while (offset + 12 <= data.length) {
      const length = data.readUInt32BE(offset), type = data.toString("ascii", offset + 4, offset + 8);
      if (offset + 12 + length > data.length) invalidImage();
      if (type === "IHDR" && offset !== 8) invalidImage();
      if (type === "acTL") invalidImage(); // Animated branding can obscure application controls.
      if (type === "IDAT" && length > 0) { sawData = true; compressed.push(data.subarray(offset + 8, offset + 8 + length)); }
      offset += length + 12;
      if (type === "IEND") { if (length !== 0) invalidImage(); sawEnd = true; break; }
    }
    if (!sawData || !sawEnd || offset !== data.length) invalidImage();
    let decoded: Buffer;
    try { decoded = inflateSync(Buffer.concat(compressed), { maxOutputLength: expectedBytes }); } catch { invalidImage(); }
    if (decoded.length !== expectedBytes) invalidImage();
    let decodedOffset = 0;
    for (const line of scanlines) for (let row = 0; row < line.count; row++) {
      if (decoded[decodedOffset]! > 4) invalidImage();
      decodedOffset += line.bytes;
    }
    return { extension: "png", contentType: "image/png" } as const;
  }
  if (mime === "image/jpeg") {
    if (data.length < 4 || data.readUInt16BE(0) !== 0xffd8 || data.readUInt16BE(data.length - 2) !== 0xffd9) invalidImage();
    let offset = 2, sawFrame = false, sawScan = false;
    while (offset + 2 <= data.length) {
      if (data[offset] !== 0xff) invalidImage();
      while (data[offset] === 0xff) offset++;
      const marker = data[offset++]!;
      if (marker === 0xd9) {
        if (!sawFrame || !sawScan || offset !== data.length) invalidImage();
        return { extension: "jpg", contentType: "image/jpeg" } as const;
      }
      if (marker === 0x00 || marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) invalidImage();
      if (offset + 2 > data.length) invalidImage();
      const length = data.readUInt16BE(offset);
      if (length < 2 || offset + length > data.length) invalidImage();
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (length < 11 || sawFrame || data[offset + 2] !== 8) invalidImage();
        const components = data[offset + 7]!;
        if (components < 1 || components > 4 || length !== 8 + 3 * components) invalidImage();
        dimensions(data.readUInt16BE(offset + 5), data.readUInt16BE(offset + 3));
        sawFrame = true;
      }
      if (marker === 0xda) {
        if (!sawFrame || length < 8 || length !== 6 + 2 * data[offset + 2]!) invalidImage();
        sawScan = true;
        offset += length;
        let scanBytes = 0;
        while (offset < data.length) {
          if (data[offset] !== 0xff) { offset++; scanBytes++; continue; }
          let next = offset + 1;
          while (data[next] === 0xff) next++;
          if (next >= data.length) invalidImage();
          const code = data[next]!;
          if (code === 0 || (code >= 0xd0 && code <= 0xd7)) { offset = next + 1; if (code === 0) scanBytes++; }
          else break;
        }
        if (!scanBytes) invalidImage();
        continue;
      }
      offset += length;
    }
    invalidImage();
  }
  if (mime === "image/webp") {
    if (data.length < 30 || data.toString("ascii", 0, 4) !== "RIFF" || data.toString("ascii", 8, 12) !== "WEBP" || data.readUInt32LE(4) + 8 !== data.length) invalidImage();
    let offset = 12, sawImage = false;
    let canvas: { width: number; height: number } | undefined;
    while (offset + 8 <= data.length) {
      const format = data.toString("ascii", offset, offset + 4), size = data.readUInt32LE(offset + 4), body = offset + 8;
      if (!size || body + size + (size % 2) > data.length) invalidImage();
      if (format === "ANIM" || format === "ANMF") invalidImage();
      if (format === "VP8X") {
        if (offset !== 12 || size !== 10 || (data[body]! & 2) !== 0) invalidImage();
        canvas = { width: 1 + data.readUIntLE(body + 4, 3), height: 1 + data.readUIntLE(body + 7, 3) };
        dimensions(canvas.width, canvas.height);
      } else if (format === "VP8 " || format === "VP8L") {
        if (sawImage) invalidImage();
        let width: number, height: number;
        if (format === "VP8 " && size > 10 && (data[body]! & 1) === 0 && data.toString("hex", body + 3, body + 6) === "9d012a") {
          width = data.readUInt16LE(body + 6) & 0x3fff; height = data.readUInt16LE(body + 8) & 0x3fff;
        } else if (format === "VP8L" && size > 5 && data[body] === 0x2f) {
          const bits = data.readUInt32LE(body + 1);
          if ((bits >>> 29) !== 0) invalidImage();
          width = 1 + (bits & 0x3fff); height = 1 + ((bits >>> 14) & 0x3fff);
        } else invalidImage();
        dimensions(width, height);
        if (canvas && (width !== canvas.width || height !== canvas.height)) invalidImage();
        sawImage = true;
      } else if (!canvas) invalidImage();
      offset = body + size + (size % 2);
    }
    if (!sawImage || offset !== data.length) invalidImage();
    return { extension: "webp", contentType: "image/webp" } as const;
  }
  throw new AppError(415, "Upload a PNG, JPEG or WebP image");
}

export const brandingAssets = {
  async save(data: Buffer, contentType: string, kind: BrandingAssetKind) {
    const image = validateBrandingImage(data, contentType, kind);
    const filename = `${randomBytes(32).toString("hex")}.${image.extension}`;
    const directory = resolve(env.BRANDING_UPLOAD_DIR);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(resolve(directory, filename), data, { flag: "wx", mode: 0o600 });
    return `${assetPrefix}${filename}`;
  },
  async remove(url: string | null) {
    if (!url?.startsWith(assetPrefix)) return;
    const filename = url.slice(assetPrefix.length);
    if (!filenamePattern.test(filename)) return;
    try { await unlink(resolve(env.BRANDING_UPLOAD_DIR, filename)); }
    catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) logger.warn("Unable to remove an unused branding asset");
    }
  },
  async read(filename: string) {
    if (!filenamePattern.test(filename)) throw new AppError(404, "Branding image not found");
    try {
      const data = await readFile(resolve(env.BRANDING_UPLOAD_DIR, filename));
      const contentType = filename.endsWith(".png") ? "image/png" : filename.endsWith(".jpg") ? "image/jpeg" : "image/webp";
      validateBrandingImage(data, contentType, "logo");
      return { data, contentType };
    } catch {
      throw new AppError(404, "Branding image not found");
    }
  },
  url(filename: string) { return `${assetPrefix}${filename}`; },
};
