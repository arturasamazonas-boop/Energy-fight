// Procedural energy coin (temporary until painted coin art arrives).
import { canvasOf } from "./artwork.ts";

export function coinCanvas() {
  const c = canvasOf(64, 64);
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(26, 24, 2, 32, 32, 28);
  g.addColorStop(0, "#fffbe0");
  g.addColorStop(0.45, "#ffd257");
  g.addColorStop(1, "#b07a10");
  ctx.shadowColor = "#ffe27a";
  ctx.shadowBlur = 10;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(32, 32, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#7a4e06";
  ctx.lineWidth = 3;
  ctx.stroke();
  // Energy crystal emblem.
  ctx.fillStyle = "#fff6c8";
  ctx.beginPath();
  ctx.moveTo(32, 18);
  ctx.lineTo(41, 32);
  ctx.lineTo(32, 46);
  ctx.lineTo(23, 32);
  ctx.closePath();
  ctx.fill();
  return c;
}
