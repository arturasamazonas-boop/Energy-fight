// Builds web-sized runtime copies of the illustrated art.
// Originals live in art-source/illustrated/ (kept unchanged in the repository);
// the game serves client/public/assets/illustrated/ (same file names, smaller).
// The renderer normalizes every illustration to a target display size, so a
// smaller source only affects sharpness, never layout or gameplay.
// Usage: npm run art:optimize
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

const root = path.resolve(import.meta.dirname, "..");
const srcDir = path.join(root, "art-source/illustrated");
const outDir = path.join(root, "client/public/assets/illustrated");

// Longest side in pixels for each kind of asset.
function maxSide(file: string) {
  if (file.endsWith("_background.png")) return 1280;
  if (file === "floor_texture.png") return 768;
  if (file === "enemy_boss.png") return 640;
  return 512; // characters, regular enemies, props, pickup
}

/** Area-average downscale with premultiplied alpha (no dark fringes). */
function downscale(src: PNG, w: number, h: number): PNG {
  const out = new PNG({ width: w, height: h, colorType: 6 });
  const sx = src.width / w;
  const sy = src.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = y * sy;
    const y1 = y0 + sy;
    for (let x = 0; x < w; x++) {
      const x0 = x * sx;
      const x1 = x0 + sx;
      let r = 0, g = 0, b = 0, a = 0, wsum = 0;
      for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) {
        const wy = Math.min(y1, yy + 1) - Math.max(y0, yy);
        for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
          const wx = Math.min(x1, xx + 1) - Math.max(x0, xx);
          const k = wx * wy;
          const i = (yy * src.width + xx) * 4;
          const al = src.data[i + 3] / 255;
          r += src.data[i] * al * k;
          g += src.data[i + 1] * al * k;
          b += src.data[i + 2] * al * k;
          a += al * k;
          wsum += k;
        }
      }
      const o = (y * w + x) * 4;
      const alpha = a / wsum;
      out.data[o] = alpha > 0 ? Math.round(r / a) : 0;
      out.data[o + 1] = alpha > 0 ? Math.round(g / a) : 0;
      out.data[o + 2] = alpha > 0 ? Math.round(b / a) : 0;
      out.data[o + 3] = Math.round(alpha * 255);
    }
  }
  return out;
}

let before = 0;
let after = 0;
for (const file of fs.readdirSync(srcDir).filter((f) => f.endsWith(".png")).sort()) {
  const buf = fs.readFileSync(path.join(srcDir, file));
  const src = PNG.sync.read(buf);
  const opaque = buf[25] !== 6; // RGB source (backgrounds, floor)
  const m = maxSide(file);
  const scale = Math.min(1, m / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const img = scale < 1 ? downscale(src, w, h) : src;
  const data = PNG.sync.write(img, { colorType: opaque ? 2 : 6, deflateLevel: 9 });
  fs.writeFileSync(path.join(outDir, file), data);
  before += buf.length;
  after += data.length;
  console.log(`${file}: ${src.width}×${src.height} → ${w}×${h}, ${(buf.length / 1024).toFixed(0)} kB → ${(data.length / 1024).toFixed(0)} kB`);
}
console.log(`total ${(before / 1048576).toFixed(1)} MB → ${(after / 1048576).toFixed(1)} MB`);
