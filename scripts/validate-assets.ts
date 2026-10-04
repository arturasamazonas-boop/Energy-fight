// Validates replacement art listed in ASSET_MANIFEST.json before it is used.
// Checks: file exists, PNG RGBA, dimensions are whole frames, frame count,
// transparent padding around every frame, and that the feet anchor row has
// opaque pixels near the anchor (consistent alignment).
// Usage: npm run assets:validate            (validates entries with status "provided")
//        npm run assets:validate -- file.png --frame 128   (checks one file)
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

const root = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "ASSET_MANIFEST.json"), "utf8"));
const assetDir = path.join(root, "client/public/assets");
const pad = manifest.spriteContract.minTransparentPadding as number;

interface Entry {
  id: string;
  file: string;
  role: string;
  status: string;
  transparent?: boolean;
  frameWidth?: number;
  frameHeight?: number;
  anchor?: { x: number; y: number };
  width?: number;
  height?: number;
}

function checkSprite(file: string, e: Entry): string[] {
  const errs: string[] = [];
  const buf = fs.readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504e47) return [`${e.id}: not a PNG`];
  const colorType = buf[25];
  if (e.transparent && colorType !== 6) errs.push(`${e.id}: must be RGBA (PNG color type 6), got ${colorType}`);
  const png = PNG.sync.read(buf);
  const fw = e.frameWidth ?? png.width;
  const fh = e.frameHeight ?? png.height;
  if (png.width % fw || png.height % fh) errs.push(`${e.id}: ${png.width}×${png.height} is not a whole number of ${fw}×${fh} frames`);
  const cols = Math.floor(png.width / fw);
  const rows = Math.floor(png.height / fh);
  const expectedCols = Object.values(manifest.animations as Record<string, { frames: number }>).reduce((a, b) => a + b.frames, 0);
  if (!(cols === 1 && rows === 1) && cols !== expectedCols) errs.push(`${e.id}: expected 1 frame (interim) or ${expectedCols} columns per row, got ${cols}`);
  if (rows > 4) errs.push(`${e.id}: at most 4 facing rows, got ${rows}`);
  const alpha = (x: number, y: number) => png.data[(y * png.width + x) * 4 + 3];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ox = c * fw;
      const oy = r * fh;
      let opaque = 0;
      let edge = 0;
      let anchorHit = false;
      for (let y = 0; y < fh; y++) {
        for (let x = 0; x < fw; x++) {
          const a = alpha(ox + x, oy + y);
          if (a > 16) {
            opaque++;
            if (x < pad || y < pad || x >= fw - pad || y >= fh - pad) edge++;
            if (e.anchor && Math.abs(y - e.anchor.y) <= 4 && Math.abs(x - e.anchor.x) <= fw * 0.3) anchorHit = true;
          }
        }
      }
      const tag = `${e.id} frame r${r}c${c}`;
      if (opaque === 0) errs.push(`${tag}: empty frame`);
      if (edge > 0) errs.push(`${tag}: ${edge} opaque pixels inside the ${pad}px padding (cropped or bleeding into neighbours)`);
      if (e.anchor && opaque > 0 && !anchorHit) errs.push(`${tag}: no opaque pixels near the feet anchor (${e.anchor.x}, ${e.anchor.y}) – check alignment`);
    }
  }
  return errs;
}

function checkBackground(file: string, e: Entry): string[] {
  const png = PNG.sync.read(fs.readFileSync(file));
  if (e.width && e.height && (png.width !== e.width || png.height !== e.height)) return [`${e.id}: expected ${e.width}×${e.height}, got ${png.width}×${png.height}`];
  return [];
}

const args = process.argv.slice(2);
let errors: string[] = [];
let checked = 0;
if (args[0] && args[0].endsWith(".png")) {
  const frame = Number(args[args.indexOf("--frame") + 1]) || 128;
  errors = checkSprite(path.resolve(args[0]), { id: path.basename(args[0]), file: args[0], role: "runtime-sprite", status: "provided", transparent: true, frameWidth: frame, frameHeight: frame, anchor: { x: frame / 2, y: Math.round(frame * 0.92) } });
  checked = 1;
} else {
  for (const e of manifest.assets as Entry[]) {
    if (e.status !== "provided") continue;
    checked++;
    const file = path.join(assetDir, e.file);
    if (!fs.existsSync(file)) {
      errors.push(`${e.id}: missing file client/public/assets/${e.file}`);
      continue;
    }
    errors.push(...(e.role === "background" ? checkBackground(file, e) : checkSprite(file, e)));
  }
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`assets OK (${checked} checked; placeholders are drawn procedurally)`);
