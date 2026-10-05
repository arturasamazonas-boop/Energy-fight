// Validate provided source artwork without changing the image files.
// Runtime illustrations are single RGBA cutouts at their native resolution;
// frameWidth/frameHeight/anchor describe the canvas produced by the renderer.
// Legacy, already aligned sprite sheets retain their stricter frame checks.
// Usage: npm run assets:validate
//        npm run assets:validate -- file.png --illustration
//        npm run assets:validate -- sheet.png --frame 128
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

const root = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "ASSET_MANIFEST.json"), "utf8"));
const assetDir = path.join(root, "client/public/assets");
const pad = Number(manifest.spriteContract?.minTransparentPadding ?? 4);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_DECODED_PIXELS = 16 * 1024 * 1024;
const MAX_SOURCE_DIMENSION = 4096;
const VISIBLE_ALPHA = 16;
const BODY_ALPHA = 128;

interface Entry {
  id: string;
  file: string;
  role: string;
  status: string;
  transparent?: boolean;
  sourceLayout?: string;
  frameCount?: number;
  renderStrategy?: string;
  frameWidth?: number;
  frameHeight?: number;
  anchor?: { x: number; y: number };
  width?: number;
  height?: number;
}

type ImageData = ReturnType<typeof PNG.sync.read>;

function readPng(file: string) {
  if (fs.statSync(file).size > MAX_FILE_BYTES) throw new Error("exceeds the 16 MiB source-file budget");
  const buf = fs.readFileSync(file);
  if (buf.length < 33 || !buf.subarray(0, 8).equals(PNG_SIGNATURE) || buf.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("not a complete PNG with an IHDR header");
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (!width || !height || width * height > MAX_DECODED_PIXELS) throw new Error("exceeds the 16-megapixel decoded-image budget or has an empty dimension");
  return { png: PNG.sync.read(buf), colorType: buf[25] };
}

function validFrame(e: Entry): string[] {
  const fw = e.frameWidth;
  const fh = e.frameHeight;
  if (!Number.isInteger(fw) || !Number.isInteger(fh) || fw! <= pad * 2 || fh! <= pad * 2) {
    return [`${e.id}: frameWidth and frameHeight must be positive integer runtime dimensions with padding`];
  }
  if (!e.anchor || !Number.isFinite(e.anchor.x) || !Number.isFinite(e.anchor.y)
      || e.anchor.x < pad || e.anchor.x >= fw! - pad || e.anchor.y < pad || e.anchor.y >= fh! - pad) {
    return [`${e.id}: feet anchor must be inside the padded runtime frame`];
  }
  return [];
}

function checkIllustration(png: ImageData, e: Entry): string[] {
  const errs = validFrame(e);
  if (e.sourceLayout !== "single-image" || e.renderStrategy !== "runtime-normalized") {
    errs.push(`${e.id}: illustrations require sourceLayout=single-image and renderStrategy=runtime-normalized`);
  }
  if (e.frameCount !== 1) errs.push(`${e.id}: a single-image illustration must declare exactly one frame`);
  if (e.transparent !== true) errs.push(`${e.id}: runtime illustrations must declare a transparent background`);
  if (png.width < 64 || png.height < 64 || png.width > MAX_SOURCE_DIMENSION || png.height > MAX_SOURCE_DIMENSION) {
    errs.push(`${e.id}: native illustration dimensions must be between 64 and ${MAX_SOURCE_DIMENSION}px; got ${png.width}×${png.height}`);
  }
  let visible = 0;
  let body = 0;
  let edge = 0;
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const alpha = png.data[(y * png.width + x) * 4 + 3];
      if (alpha >= BODY_ALPHA) body++;
      if (alpha > VISIBLE_ALPHA) {
        visible++;
        if (x < pad || y < pad || x >= png.width - pad || y >= png.height - pad) edge++;
      }
    }
  }
  if (!visible) errs.push(`${e.id}: empty illustration; no visible subject`);
  else if (!body) errs.push(`${e.id}: no solid subject pixels (alpha >= ${BODY_ALPHA}) for body/feet normalization`);
  if (edge) errs.push(`${e.id}: ${edge} visible pixels inside the ${pad}px source padding; keep the full cutout clear of the image border`);
  // Source pixels do not have to touch the runtime feet anchor, and are never
  // split into frame-sized tiles. The renderer normalizes the image at load.
  return errs;
}

function checkSprite(png: ImageData, e: Entry): string[] {
  const errs = validFrame(e);
  if (errs.length) return errs;
  const fw = e.frameWidth!;
  const fh = e.frameHeight!;
  if (png.width % fw || png.height % fh) return [`${e.id}: ${png.width}×${png.height} is not a whole number of ${fw}×${fh} frames`];
  const cols = png.width / fw;
  const rows = png.height / fh;
  const configuredCols = manifest.legacySpriteSheetContract?.columnsPerFacing
    ?? Object.values(manifest.animations as Record<string, { frames: number }> ?? {}).reduce((a, b) => a + b.frames, 0);
  const expectedCols = configuredCols || 40;
  if (!(cols === 1 && rows === 1) && cols !== expectedCols) errs.push(`${e.id}: expected 1 aligned frame or ${expectedCols} columns per row, got ${cols}`);
  if (rows > 4) errs.push(`${e.id}: at most 4 facing rows, got ${rows}`);
  if (errs.length) return errs;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let opaque = 0;
      let edge = 0;
      let anchorHit = false;
      for (let y = 0; y < fh; y++) {
        for (let x = 0; x < fw; x++) {
          const alpha = png.data[((r * fh + y) * png.width + c * fw + x) * 4 + 3];
          if (alpha > VISIBLE_ALPHA) {
            opaque++;
            if (x < pad || y < pad || x >= fw - pad || y >= fh - pad) edge++;
            if (Math.abs(y - e.anchor!.y) <= 4 && Math.abs(x - e.anchor!.x) <= fw * 0.3) anchorHit = true;
          }
        }
      }
      const tag = `${e.id} frame r${r}c${c}`;
      if (!opaque) errs.push(`${tag}: empty frame`);
      if (edge) errs.push(`${tag}: ${edge} opaque pixels inside the ${pad}px padding (cropped or bleeding into neighbours)`);
      if (opaque && !anchorHit) errs.push(`${tag}: no opaque pixels near the feet anchor (${e.anchor!.x}, ${e.anchor!.y}) – check alignment`);
    }
  }
  return errs;
}

function checkBackground(png: ImageData, e: Entry): string[] {
  const errs: string[] = [];
  if ((e.width !== undefined && png.width !== e.width) || (e.height !== undefined && png.height !== e.height)) {
    errs.push(`${e.id}: declared source dimensions do not match ${png.width}×${png.height}`);
  }
  if (e.transparent === false) {
    for (let i = 3; i < png.data.length; i += 4) {
      if (png.data[i] !== 255) {
        errs.push(`${e.id}: background/floor declares opaque artwork but contains transparent pixels`);
        break;
      }
    }
  }
  return errs;
}

function checkFile(file: string, e: Entry): string[] {
  try {
    const { png, colorType } = readPng(file);
    const errs: string[] = [];
    if (e.transparent && colorType !== 6) errs.push(`${e.id}: must be RGBA (PNG color type 6), got ${colorType}`);
    if (e.role === "runtime-illustration") errs.push(...checkIllustration(png, e));
    else if (e.role === "runtime-sprite") errs.push(...checkSprite(png, e));
    else if (e.role === "background" || e.role === "floor-texture") errs.push(...checkBackground(png, e));
    else errs.push(`${e.id}: unsupported provided runtime role ${e.role}`);
    return errs;
  } catch (error) {
    return [`${e.id}: ${error instanceof Error ? error.message : String(error)}`];
  }
}

const args = process.argv.slice(2);
const errors: string[] = [];
let checked = 0;
if (args[0] && !args[0].startsWith("--")) {
  const illustration = args.includes("--illustration");
  const frameArg = args.indexOf("--frame");
  const frame = frameArg >= 0 ? Number(args[frameArg + 1]) : illustration ? 256 : 128;
  errors.push(...checkFile(path.resolve(args[0]), {
    id: path.basename(args[0]), file: args[0], status: "provided", transparent: true,
    role: illustration ? "runtime-illustration" : "runtime-sprite",
    sourceLayout: illustration ? "single-image" : undefined,
    frameCount: illustration ? 1 : undefined,
    renderStrategy: illustration ? "runtime-normalized" : undefined,
    frameWidth: frame, frameHeight: frame,
    anchor: { x: frame / 2, y: Math.round(frame * 0.92) },
  }));
  checked = 1;
} else {
  const ids = new Set<string>();
  const files = new Set<string>();
  for (const e of manifest.assets as Entry[]) {
    if (ids.has(e.id)) errors.push(`duplicate asset ID ${e.id}`);
    ids.add(e.id);
    if (e.status !== "provided") continue;
    checked++;
    if (files.has(e.file)) errors.push(`${e.id}: duplicate provided source file ${e.file}`);
    files.add(e.file);
    const file = path.resolve(assetDir, e.file);
    const relative = path.relative(assetDir, file);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      errors.push(`${e.id}: source file must stay inside client/public/assets`);
      continue;
    }
    if (!fs.existsSync(file)) {
      errors.push(`${e.id}: missing file client/public/assets/${e.file}`);
      continue;
    }
    errors.push(...checkFile(file, e));
  }
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`assets OK (${checked} provided source files checked; source pixels unchanged)`);
