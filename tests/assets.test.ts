import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PNG } from "pngjs";

function sprite(file: string, rect: { x0: number; y0: number; x1: number; y1: number }) {
  const png = new PNG({ width: 128, height: 128, colorType: 6 });
  for (let y = rect.y0; y < rect.y1; y++) for (let x = rect.x0; x < rect.x1; x++) png.data.writeUInt32BE(0x8040ffff, (y * 128 + x) * 4);
  fs.writeFileSync(file, PNG.sync.write(png, { colorType: 6 }));
}

const run = (file: string) => {
  try {
    execFileSync(process.execPath, ["--import", "tsx", "scripts/validate-assets.ts", file, "--frame", "128"], { cwd: path.resolve(import.meta.dirname, ".."), stdio: "pipe" });
    return "";
  } catch (e: any) {
    return String(e.stderr);
  }
};

test("asset validator accepts an aligned sprite and rejects bad padding/anchor", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-assets-"));
  const good = path.join(dir, "good.png");
  sprite(good, { x0: 40, y0: 30, x1: 88, y1: 119 });
  assert.equal(run(good), "");
  const cropped = path.join(dir, "cropped.png");
  sprite(cropped, { x0: 0, y0: 30, x1: 88, y1: 119 });
  assert.match(run(cropped), /padding/);
  const floating = path.join(dir, "floating.png");
  sprite(floating, { x0: 40, y0: 10, x1: 88, y1: 60 });
  assert.match(run(floating), /anchor/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("manifest entries are well formed and provided runtime files validate", () => {
  const m = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../ASSET_MANIFEST.json"), "utf8"));
  const ids = new Set<string>();
  for (const a of m.assets) {
    assert.ok(a.id && a.file && a.role && a.status, JSON.stringify(a));
    assert.ok(!ids.has(a.id), `duplicate ${a.id}`);
    ids.add(a.id);
    if (a.role === "runtime-sprite") assert.ok(a.frameWidth && a.anchor && a.transparent === true);
  }
  for (const l of ["pyra", "krios", "vektor", "litos"]) assert.ok(ids.has(`char.${l}.base`));
  execFileSync(process.execPath, ["--import", "tsx", "scripts/validate-assets.ts"], { cwd: path.resolve(import.meta.dirname, "..") });
});
