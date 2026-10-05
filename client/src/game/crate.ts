// Mineral loot crate drawn procedurally (used in battle and in the reveal screen).
import type { BoxTier } from "@ef/shared";

export const CRATE_PALETTE: Record<BoxTier, { body: string; dark: string; band: string; crystal: string[]; glow: string; glowHex: number }> = {
  bronze: { body: "#6b4a2e", dark: "#3a2616", band: "#c98a52", crystal: ["#e8a868", "#b86a34"], glow: "#ffb070", glowHex: 0xffb070 },
  silver: { body: "#4c5866", dark: "#262d36", band: "#d8e2ea", crystal: ["#f2f8ff", "#9fb3c4"], glow: "#e6f2ff", glowHex: 0xe6f2ff },
  gold: { body: "#5e4612", dark: "#33250a", band: "#ffd257", crystal: ["#fff0a0", "#e0a820"], glow: "#ffd257", glowHex: 0xffd257 },
  platinum: { body: "#25424f", dark: "#122630", band: "#b5f4ff", crystal: ["#e8fdff", "#6fd8f0"], glow: "#9ff0ff", glowHex: 0x9ff0ff },
  divine: { body: "#55440f", dark: "#2c2206", band: "#fff4c0", crystal: ["#ffffff", "#ffe27a"], glow: "#fff6c8", glowHex: 0xfff6c8 },
  ultra: { body: "#3b1452", dark: "#1c0828", band: "#ff8af8", crystal: ["#ff7dfa", "#7dfff0", "#fff27d"], glow: "#ff9cff", glowHex: 0xff9cff },
};

export const CRATE_SIZE = 128;

/** Draws a crate into a 128×128 box; (64, 116) is the ground point. */
export function drawCrate(ctx: CanvasRenderingContext2D, tier: BoxTier, open = 0) {
  const P = CRATE_PALETTE[tier];
  const poly = (pts: [number, number][], fill: string | CanvasGradient, stroke = P.dark, lw = 2) => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineJoin = "round";
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.stroke();
  };
  ctx.save();
  // Body: front and side faces of a slightly isometric chest.
  const front = ctx.createLinearGradient(0, 60, 0, 116);
  front.addColorStop(0, P.body);
  front.addColorStop(1, P.dark);
  poly([[24, 66], [92, 66], [92, 112], [24, 112]], front);
  poly([[92, 66], [108, 56], [108, 100], [92, 112]], P.dark);
  // Metal bands.
  poly([[24, 80], [92, 80], [92, 87], [24, 87]], P.band, P.dark, 1.5);
  poly([[92, 80], [108, 70], [108, 77], [92, 87]], P.band, P.dark, 1.5);
  poly([[52, 66], [62, 66], [62, 112], [52, 112]], P.band, P.dark, 1.5);
  // Glowing seam / lock.
  ctx.shadowColor = P.glow;
  ctx.shadowBlur = 14;
  ctx.fillStyle = P.glow;
  ctx.beginPath();
  ctx.arc(57, 92, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  // Lid (lifts and tilts when opening).
  ctx.translate(0, -open * 26);
  const lid = ctx.createLinearGradient(0, 40, 0, 66);
  lid.addColorStop(0, P.band);
  lid.addColorStop(1, P.body);
  poly([[20, 66], [96, 66], [112, 54], [38, 54]], lid);
  poly([[20, 66], [96, 66], [96, 72], [20, 72]], P.dark);
  // Mineral crystals growing out of the lid.
  const crystals: [number, number, number, number][] = [
    [42, 56, 9, 26],
    [60, 54, 12, 38],
    [78, 55, 9, 28],
    [92, 55, 7, 18],
    [50, 57, 6, 14],
  ];
  crystals.forEach(([x, y, w, h], i) => {
    const c = ctx.createLinearGradient(x, y - h, x + w, y);
    c.addColorStop(0, P.crystal[i % P.crystal.length]);
    c.addColorStop(1, P.crystal[(i + 1) % P.crystal.length]);
    ctx.shadowColor = P.glow;
    ctx.shadowBlur = tier === "bronze" ? 4 : tier === "silver" ? 8 : 14;
    poly([[x - w / 2, y], [x - w * 0.15, y - h], [x + w * 0.35, y - h * 0.82], [x + w / 2, y]], c, P.dark, 1.2);
  });
  ctx.restore();
}

export function crateCanvas(tier: BoxTier, open = 0, size = CRATE_SIZE) {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.scale(size / CRATE_SIZE, size / CRATE_SIZE);
  drawCrate(ctx, tier, open);
  return c;
}

export const TIER_RANK: Record<BoxTier, number> = { bronze: 0, silver: 1, gold: 2, platinum: 3, divine: 4, ultra: 5 };
