// Procedural art for the second boss (Crystal Warden) and its shield pylons.
// 256×256 frames with feet at (128, 236), matching the illustrated contract.
import { canvasOf } from "./artwork.ts";

type Ctx = CanvasRenderingContext2D;

function shard(ctx: Ctx, x: number, y: number, w: number, h: number, tilt: number, light: string, dark: string, glow: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);
  const g = ctx.createLinearGradient(-w / 2, 0, w / 2, -h);
  g.addColorStop(0, dark);
  g.addColorStop(0.55, light);
  g.addColorStop(1, "#ffffff");
  ctx.shadowColor = glow;
  ctx.shadowBlur = 16;
  ctx.beginPath();
  ctx.moveTo(-w / 2, 0);
  ctx.lineTo(-w * 0.18, -h);
  ctx.lineTo(w * 0.22, -h * 0.86);
  ctx.lineTo(w / 2, 0);
  ctx.closePath();
  ctx.fillStyle = g;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#0b1a26";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-w * 0.1, -h * 0.1);
  ctx.lineTo(-w * 0.14, -h * 0.85);
  ctx.stroke();
  ctx.restore();
}

function slab(ctx: Ctx, pts: [number, number][], top: string, bottom: string) {
  const ys = pts.map((p) => p[1]);
  const g = ctx.createLinearGradient(0, Math.min(...ys), 0, Math.max(...ys));
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
  ctx.closePath();
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = "#070d14";
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.stroke();
}

export function wardenCanvas() {
  const c = canvasOf(256, 256);
  const ctx = c.getContext("2d")!;
  // Floating crystal halo behind the head.
  ctx.save();
  ctx.globalAlpha = 0.85;
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI + (i / 6) * Math.PI;
    shard(ctx, 128 + Math.cos(a) * 70, 70 + Math.sin(a) * 34, 12, 30 + (i % 2) * 12, a + Math.PI / 2, "#9ff3ff", "#2a6f8f", "#7de8ff");
  }
  ctx.restore();
  // Legs.
  slab(ctx, [[86, 236], [74, 186], [106, 172], [114, 236]], "#3a4655", "#141b24");
  slab(ctx, [[142, 236], [148, 172], [182, 186], [172, 236]], "#3a4655", "#141b24");
  // Torso: broad basalt mass.
  slab(ctx, [[60, 190], [50, 120], [86, 82], [170, 82], [206, 120], [196, 190], [128, 204]], "#4a5a6c", "#18212c");
  // Chest crystals and core.
  shard(ctx, 104, 150, 22, 52, -0.25, "#b8f7ff", "#2f7896", "#8ef0ff");
  shard(ctx, 152, 150, 22, 52, 0.25, "#b8f7ff", "#2f7896", "#8ef0ff");
  const core = ctx.createRadialGradient(128, 132, 2, 128, 132, 26);
  core.addColorStop(0, "#ffffff");
  core.addColorStop(0.35, "#c9a8ff");
  core.addColorStop(1, "rgba(120,80,255,0)");
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(128, 132, 26, 0, Math.PI * 2);
  ctx.fill();
  // Shoulders: huge crystal spikes.
  shard(ctx, 58, 112, 30, 70, -0.6, "#a6f1ff", "#245e78", "#7de8ff");
  shard(ctx, 198, 112, 30, 70, 0.6, "#a6f1ff", "#245e78", "#7de8ff");
  // Arms ending in crystal blades.
  slab(ctx, [[48, 124], [30, 160], [40, 196], [62, 170]], "#435264", "#151c26");
  slab(ctx, [[208, 124], [226, 160], [216, 196], [194, 170]], "#435264", "#151c26");
  shard(ctx, 38, 200, 16, 46, Math.PI - 0.15, "#d4fbff", "#3b88a8", "#9ff3ff");
  shard(ctx, 218, 200, 16, 46, Math.PI + 0.15, "#d4fbff", "#3b88a8", "#9ff3ff");
  // Head: crystal crown with glowing eyes.
  slab(ctx, [[108, 84], [104, 60], [128, 46], [152, 60], [148, 84]], "#56677a", "#1b2430");
  shard(ctx, 128, 50, 16, 40, 0, "#e6fdff", "#4aa0c2", "#bdf6ff");
  ctx.fillStyle = "#c9a8ff";
  ctx.shadowColor = "#b48cff";
  ctx.shadowBlur = 12;
  ctx.fillRect(114, 66, 10, 4);
  ctx.fillRect(132, 66, 10, 4);
  return c;
}

export function pylonCanvas() {
  const c = canvasOf(256, 256);
  const ctx = c.getContext("2d")!;
  // Stone base.
  slab(ctx, [[86, 236], [92, 210], [164, 210], [170, 236]], "#55606c", "#1b222b");
  slab(ctx, [[100, 212], [106, 196], [150, 196], [156, 212]], "#68737f", "#2a323c");
  // Main obelisk crystal and side shards.
  shard(ctx, 128, 200, 46, 150, 0, "#d9fbff", "#3b8db0", "#9ff3ff");
  shard(ctx, 104, 204, 22, 70, -0.3, "#b3f2ff", "#2c6f8e", "#8ef0ff");
  shard(ctx, 152, 204, 22, 70, 0.3, "#b3f2ff", "#2c6f8e", "#8ef0ff");
  // Energy rune.
  const g = ctx.createRadialGradient(128, 130, 1, 128, 130, 18);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(1, "rgba(160,120,255,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(128, 130, 18, 0, Math.PI * 2);
  ctx.fill();
  return c;
}
