import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { LINEAGE_SPECS } from "../shared/src/index.ts";
import { ART_ALPHA_CUTOFF, ART_FEET, ART_FRAME, ILLUSTRATED_ASSETS } from "../client/src/game/artwork.ts";

const root = path.resolve(import.meta.dirname, "..");
type Rect = { x0: number; y0: number; x1: number; y1: number };

function sprite(file: string, rect: Rect, width = 128, height = 128, alpha = 255) {
  const png = new PNG({ width, height, colorType: 6 });
  for (let y = rect.y0; y < rect.y1; y++) {
    for (let x = rect.x0; x < rect.x1; x++) {
      const offset = (y * width + x) * 4;
      png.data[offset] = 128;
      png.data[offset + 1] = 64;
      png.data[offset + 2] = 255;
      png.data[offset + 3] = alpha;
    }
  }
  fs.writeFileSync(file, PNG.sync.write(png, { colorType: 6 }));
  return png;
}

function withTemp(run: (dir: string) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-assets-"));
  try { run(dir); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const validate = (file: string, args: string[] = ["--frame", "128"]) => {
  try {
    execFileSync(process.execPath, ["--import", "tsx", "scripts/validate-assets.ts", file, ...args], { cwd: root, stdio: "pipe" });
    return "";
  } catch (error: unknown) {
    return String((error as { stderr?: unknown }).stderr ?? error);
  }
};

test("legacy asset validator accepts an aligned sprite and rejects bad padding/anchor", () => {
  withTemp((dir) => {
    const good = path.join(dir, "good.png");
    sprite(good, { x0: 40, y0: 30, x1: 88, y1: 119 });
    assert.equal(validate(good), "");
    const cropped = path.join(dir, "cropped.png");
    sprite(cropped, { x0: 0, y0: 30, x1: 88, y1: 119 });
    assert.match(validate(cropped), /padding/);
    const floating = path.join(dir, "floating.png");
    sprite(floating, { x0: 40, y0: 10, x1: 88, y1: 60 });
    assert.match(validate(floating), /anchor/);
  });
});

test("illustration validator accepts native non-frame dimensions without editing source bytes", () => {
  withTemp((dir) => {
    const file = path.join(dir, "native-cutout.png");
    // Deliberately neither square nor a multiple of the runtime 256px frame.
    // Source feet are far from y=236: runtime normalization must align them.
    sprite(file, { x0: 123, y0: 90, x1: 744, y1: 1267 }, 1000, 1500);
    const before = fs.readFileSync(file);
    assert.equal(validate(file, ["--illustration"]), "");
    assert.deepEqual(fs.readFileSync(file), before);
    assert.match(validate(file), /whole number/);
  });
});

test("illustration validator rejects empty, cropped, translucent-only and opaque-background sources", () => {
  withTemp((dir) => {
    const empty = path.join(dir, "empty.png");
    sprite(empty, { x0: 0, y0: 0, x1: 0, y1: 0 });
    assert.match(validate(empty, ["--illustration"]), /empty illustration/);
    const cropped = path.join(dir, "cropped.png");
    sprite(cropped, { x0: 0, y0: 20, x1: 80, y1: 110 });
    assert.match(validate(cropped, ["--illustration"]), /source padding/);
    const ghost = path.join(dir, "ghost.png");
    sprite(ghost, { x0: 20, y0: 20, x1: 110, y1: 110 }, 128, 128, 32);
    assert.match(validate(ghost, ["--illustration"]), /solid subject/);
    const opaque = path.join(dir, "opaque.png");
    sprite(opaque, { x0: 0, y0: 0, x1: 128, y1: 128 });
    assert.match(validate(opaque, ["--illustration"]), /source padding/);
  });
});

test("illustration validator uses the runtime visible-alpha cutoff for source padding", () => {
  withTemp((dir) => {
    const file = path.join(dir, "glow.png");
    const png = sprite(file, { x0: 20, y0: 20, x1: 110, y1: 110 });
    png.data[3] = 16;
    fs.writeFileSync(file, PNG.sync.write(png, { colorType: 6 }));
    assert.equal(validate(file, ["--illustration"]), "");
    png.data[3] = 17;
    fs.writeFileSync(file, PNG.sync.write(png, { colorType: 6 }));
    assert.match(validate(file, ["--illustration"]), /source padding/);
  });
});

test("asset validator reports truncated PNGs and checks the decoded-image budget before decoding", () => {
  withTemp((dir) => {
    const truncated = path.join(dir, "truncated.png");
    fs.writeFileSync(truncated, Buffer.from([137, 80, 78, 71]));
    assert.match(validate(truncated, ["--illustration"]), /complete PNG/);
    const huge = path.join(dir, "huge.png");
    sprite(huge, { x0: 20, y0: 20, x1: 110, y1: 110 });
    const bytes = fs.readFileSync(huge);
    bytes.writeUInt32BE(8192, 16);
    bytes.writeUInt32BE(8192, 20);
    fs.writeFileSync(huge, bytes);
    assert.match(validate(huge, ["--illustration"]), /decoded-image budget/);
  });
});

test("illustrated manifest supplies every playable form, enemy and used environment source", () => {
  const m = JSON.parse(fs.readFileSync(path.join(root, "ASSET_MANIFEST.json"), "utf8"));
  assert.equal(m.version, 2);
  assert.equal(m.spriteContract.frameWidth, ART_FRAME);
  assert.equal(m.spriteContract.frameHeight, ART_FRAME);
  assert.deepEqual(m.spriteContract.feetAnchor, ART_FEET);
  assert.equal(m.spriteContract.visibleAlphaCutoff, ART_ALPHA_CUTOFF);
  const ids = new Set<string>();
  const files = new Set<string>();
  for (const a of m.assets) {
    assert.ok(a.id && a.file && a.role, JSON.stringify(a));
    assert.equal(a.status, "provided", `${a.id} must reference delivered artwork`);
    assert.ok(!ids.has(a.id), `duplicate ${a.id}`);
    assert.ok(!files.has(a.file), `duplicate ${a.file}`);
    assert.ok(a.file.startsWith("illustrated/"), `${a.id}: illustrated asset path`);
    assert.ok(Array.isArray(a.usedBy) && a.usedBy.length > 0, `${a.id}: document its runtime consumer`);
    ids.add(a.id);
    files.add(a.file);
    if (a.role === "runtime-illustration") {
      assert.equal(a.sourceLayout, "single-image");
      assert.equal(a.frameCount, 1);
      assert.equal(a.renderStrategy, "runtime-normalized");
      assert.deepEqual([a.frameWidth, a.frameHeight], [ART_FRAME, ART_FRAME]);
      assert.deepEqual(a.anchor, ART_FEET);
      assert.equal(a.transparent, true);
    }
  }
  const expected = new Set<string>();
  for (const [lineage, spec] of Object.entries(LINEAGE_SPECS)) {
    for (const form of ["base", ...spec.evolutions.map((e) => e.id)]) expected.add(`char.${lineage}.${form}`);
  }
  for (const kind of ["pursuer", "ranged", "armored", "support", "boss"]) expected.add(`enemy.${kind}.provided`);
  for (const id of ["env.lobby", "env.station_nexus", "env.floor", "prop.stabilizer", "prop.gateway", "pickup.biocell"]) expected.add(id);
  assert.deepEqual(ids, expected, "delivered inventory must match the game's full illustrated asset set");
  assert.deepEqual(new Set(ILLUSTRATED_ASSETS.map((a) => a.key)), new Set([...expected].filter((id) => id !== "env.lobby")), "battlefield/portrait loader must consume the declared art set");
  for (const runtime of ILLUSTRATED_ASSETS) {
    const declared = m.assets.find((a: { id: string }) => a.id === runtime.key);
    assert.equal(declared.file, `illustrated/${runtime.file}`, `${runtime.key}: actual runtime source path`);
    assert.equal(declared.role === "runtime-illustration", runtime.normalize, `${runtime.key}: correct loading strategy`);
  }
  const onDisk = fs.readdirSync(path.join(root, "client/public/assets/illustrated"))
    .filter((file) => file.endsWith(".png"))
    .map((file) => `illustrated/${file}`);
  assert.deepEqual(new Set(onDisk), files, "no missing or unlisted illustrated PNGs");
  execFileSync(process.execPath, ["--import", "tsx", "scripts/validate-assets.ts"], { cwd: root, stdio: "pipe" });
});
