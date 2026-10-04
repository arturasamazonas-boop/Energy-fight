// Procedural placeholder art drawn with Canvas 2D. Every character is drawn in
// a 128×128 frame facing right with feet anchored at (64, 118). Replacement
// sprites from ASSET_MANIFEST.json use the same frame contract.
import type { LineageId } from "@ef/shared";

export const FRAME = 128;
export const FEET = { x: 64, y: 118 };

export const LINEAGE_COLORS: Record<LineageId, { body: string; plate: string; glow: string; glowHex: number; dark: string }> = {
  pyra: { body: "#2b2320", plate: "#5a4336", glow: "#ffad4a", glowHex: 0xffad4a, dark: "#140f0d" },
  krios: { body: "#1e2a33", plate: "#9cc6d8", glow: "#8ff3ff", glowHex: 0x8ff3ff, dark: "#0d151b" },
  vektor: { body: "#1c2622", plate: "#9fd9b6", glow: "#d9ffe9", glowHex: 0xc8ffe0, dark: "#0c1310" },
  litos: { body: "#2a2a2e", plate: "#47464d", glow: "#e0b85a", glowHex: 0xe0b85a, dark: "#121215" },
};

type Ctx = CanvasRenderingContext2D;
type Pt = [number, number];

function poly(ctx: Ctx, pts: Pt[], fill: string, stroke?: string, lw = 2) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.lineJoin = "round";
    ctx.stroke();
  }
}

function glowLine(ctx: Ctx, pts: Pt[], color: string, width = 2.5, blur = 8) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
  ctx.restore();
}

function dot(ctx: Ctx, x: number, y: number, r: number, color: string, blur = 10) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function limb(ctx: Ctx, a: Pt, b: Pt, c: Pt, w: number, color: string, outline: string) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = outline;
  ctx.lineWidth = w + 3;
  ctx.beginPath();
  ctx.moveTo(...a);
  ctx.lineTo(...b);
  ctx.lineTo(...c);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.stroke();
  ctx.restore();
}

export function newCanvas(w = FRAME, h = FRAME) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

// ---- Lineages -----------------------------------------------------------------

export function drawLineage(ctx: Ctx, lineage: LineageId, evo: string, mastery: boolean) {
  const C = LINEAGE_COLORS[lineage];
  ctx.save();
  if (mastery) {
    ctx.save();
    ctx.globalAlpha = 0.55;
    glowLine(ctx, [[34, 30], [64, 14], [94, 30]], "#ffe28a", 2, 12);
    ctx.restore();
  }
  if (lineage === "pyra") drawPyra(ctx, C, evo);
  else if (lineage === "krios") drawKrios(ctx, C, evo);
  else if (lineage === "vektor") drawVektor(ctx, C, evo);
  else drawLitos(ctx, C, evo);
  ctx.restore();
}

type Pal = (typeof LINEAGE_COLORS)["pyra"];

function drawPyra(ctx: Ctx, C: Pal, evo: string) {
  // Forward-leaning predator: low head, digitigrade legs, vented back, tail.
  limb(ctx, [56, 82], [48, 100], [56, 118], 7, C.body, C.dark); // back leg
  limb(ctx, [70, 82], [80, 98], [74, 118], 8, C.plate, C.dark); // front leg
  poly(ctx, [[40, 74], [18, 70], [8, 78], [30, 82]], C.body, C.dark); // tail
  glowLine(ctx, [[12, 76], [28, 78]], C.glow, 1.5);
  poly(ctx, [[38, 70], [56, 52], [84, 54], [96, 66], [86, 86], [52, 88]], C.body, C.dark, 2.5); // torso, leaning forward
  poly(ctx, [[44, 62], [58, 48], [70, 50], [62, 66]], C.plate, C.dark); // back plate 1
  poly(ctx, [[60, 52], [74, 44], [84, 50], [76, 62]], C.plate, C.dark); // back plate 2
  glowLine(ctx, [[50, 66], [58, 58]], C.glow);
  glowLine(ctx, [[66, 60], [76, 52]], C.glow);
  glowLine(ctx, [[60, 80], [80, 76]], C.glow, 2);
  poly(ctx, [[86, 58], [104, 56], [114, 64], [104, 72], [88, 72]], C.plate, C.dark, 2.5); // head forward
  poly(ctx, [[96, 56], [100, 46], [106, 56]], C.body, C.dark); // crest
  dot(ctx, 106, 63, 2.6, C.glow);
  limb(ctx, [84, 68], [96, 80], [108, 78], 6, C.plate, C.dark); // claw arm
  poly(ctx, [[106, 74], [116, 76], [108, 82]], C.glow, C.dark, 1);
  if (evo === "flare") {
    poly(ctx, [[90, 56], [94, 36], [100, 54]], C.glow, C.dark, 1);
    poly(ctx, [[78, 50], [80, 32], [88, 50]], C.glow, C.dark, 1);
    poly(ctx, [[66, 48], [66, 30], [74, 46]], "#ff7a2a", C.dark, 1);
  }
  if (evo === "furnace") {
    poly(ctx, [[54, 70], [62, 60], [88, 62], [90, 82], [60, 86]], "#6e4e3c", C.dark, 2.5);
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = C.glow;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(74, 73, 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    dot(ctx, 74, 73, 4, C.glow, 14);
  }
}

function drawKrios(ctx: Ctx, C: Pal, evo: string) {
  // Upright, angular crystalline plates, precise stance.
  limb(ctx, [58, 84], [54, 100], [52, 118], 6, C.body, C.dark);
  limb(ctx, [70, 84], [76, 100], [78, 118], 6, C.body, C.dark);
  poly(ctx, [[50, 86], [54, 50], [64, 40], [76, 50], [80, 86], [64, 92]], C.body, C.dark, 2.5); // torso tall
  poly(ctx, [[54, 54], [64, 44], [74, 54], [64, 74]], C.plate, C.dark, 2); // chest crystal
  glowLine(ctx, [[64, 50], [64, 70]], C.glow, 2);
  poly(ctx, [[46, 56], [38, 40], [52, 50]], C.plate, C.dark, 1.5); // shoulder spike L
  poly(ctx, [[80, 54], [92, 38], [84, 58]], C.plate, C.dark, 1.5); // shoulder spike R
  poly(ctx, [[58, 40], [62, 18], [70, 18], [72, 40], [64, 44]], C.plate, C.dark, 2); // tall head
  poly(ctx, [[62, 18], [66, 8], [70, 18]], C.glow, C.dark, 1);
  dot(ctx, 69, 30, 2.4, C.glow);
  limb(ctx, [78, 58], [90, 70], [102, 64], 5, C.body, C.dark); // arm extended
  poly(ctx, [[100, 58], [116, 62], [100, 70]], C.plate, C.dark, 1.5); // blade shard
  glowLine(ctx, [[102, 63], [114, 62]], C.glow, 1.5);
  limb(ctx, [52, 58], [46, 74], [50, 86], 5, C.body, C.dark);
  if (evo === "prism") {
    for (const [x, y] of [[40, 30], [90, 28], [34, 70], [96, 84]] as Pt[]) poly(ctx, [[x, y - 8], [x + 5, y], [x, y + 8], [x - 5, y]], C.glow, C.dark, 1);
  }
  if (evo === "glacier") {
    poly(ctx, [[40, 60], [44, 40], [62, 36], [58, 62]], "#cfeefa", C.dark, 2);
    poly(ctx, [[70, 36], [88, 40], [92, 62], [74, 60]], "#cfeefa", C.dark, 2);
    poly(ctx, [[48, 92], [52, 82], [76, 82], [80, 92]], "#cfeefa", C.dark, 1.5);
  }
}

function drawVektor(ctx: Ctx, C: Pal, evo: string) {
  // Narrow, swept-back silhouette with flexible fins.
  limb(ctx, [60, 82], [50, 98], [46, 118], 5, C.body, C.dark);
  limb(ctx, [66, 82], [78, 98], [84, 118], 5, C.body, C.dark);
  poly(ctx, [[56, 84], [60, 54], [72, 46], [80, 56], [72, 86]], C.body, C.dark, 2.5); // slim torso
  poly(ctx, [[60, 56], [30, 40], [20, 46], [56, 66]], C.plate, C.dark, 2); // swept fin back
  poly(ctx, [[62, 70], [34, 66], [28, 74], [60, 78]], C.plate, C.dark, 1.5); // lower fin
  glowLine(ctx, [[24, 44], [56, 60]], C.glow, 1.5);
  poly(ctx, [[70, 46], [80, 30], [94, 30], [90, 42], [78, 50]], C.plate, C.dark, 2); // swept head
  poly(ctx, [[80, 32], [56, 18], [62, 30]], C.plate, C.dark, 1.5); // head fin
  dot(ctx, 90, 36, 2.2, C.glow);
  limb(ctx, [76, 58], [90, 66], [104, 58], 4, C.body, C.dark);
  poly(ctx, [[100, 56], [120, 50], [104, 62]], C.glow, C.dark, 1); // edge
  if (evo === "tempest") {
    ctx.save();
    ctx.globalAlpha = 0.65;
    glowLine(ctx, [[30, 96], [46, 88], [62, 94], [50, 104], [38, 98]], C.glow, 2, 10);
    ctx.restore();
    poly(ctx, [[58, 80], [36, 92], [30, 88], [56, 76]], C.plate, C.dark, 1.5);
  }
  if (evo === "raptor") {
    poly(ctx, [[96, 60], [118, 66], [98, 70]], "#ffffff", C.dark, 1);
    poly(ctx, [[44, 116], [36, 120], [48, 120]], C.glow, C.dark, 1);
    poly(ctx, [[84, 116], [94, 120], [82, 120]], C.glow, C.dark, 1);
  }
}

function drawLitos(ctx: Ctx, C: Pal, evo: string) {
  // Broad, dense body, mineral forearms.
  limb(ctx, [54, 92], [50, 106], [48, 118], 11, C.body, C.dark);
  limb(ctx, [76, 92], [80, 106], [82, 118], 11, C.body, C.dark);
  poly(ctx, [[36, 92], [32, 60], [48, 44], [82, 44], [98, 60], [94, 92], [64, 98]], C.body, C.dark, 3); // wide torso
  poly(ctx, [[44, 62], [52, 50], [78, 50], [86, 62], [78, 74], [52, 74]], C.plate, C.dark, 2);
  glowLine(ctx, [[52, 66], [64, 60], [78, 66]], C.glow, 1.6, 6);
  poly(ctx, [[56, 46], [58, 34], [72, 34], [74, 46]], C.plate, C.dark, 2); // small head
  dot(ctx, 70, 40, 2, C.glow, 6);
  // mineral forearms
  limb(ctx, [90, 56], [100, 70], [100, 82], 9, C.body, C.dark);
  poly(ctx, [[92, 76], [110, 72], [114, 90], [96, 96]], "#3b3a40", C.dark, 2.5);
  glowLine(ctx, [[100, 80], [108, 86]], C.glow, 1.4, 5);
  limb(ctx, [40, 56], [30, 70], [30, 82], 9, C.body, C.dark);
  poly(ctx, [[20, 76], [38, 74], [40, 94], [22, 94]], "#3b3a40", C.dark, 2.5);
  if (evo === "monolith") {
    poly(ctx, [[30, 50], [40, 26], [88, 26], [100, 50], [86, 44], [42, 44]], "#55545c", C.dark, 2.5);
    glowLine(ctx, [[44, 34], [84, 34]], C.glow, 1.2, 4);
  }
  if (evo === "seismic") {
    glowLine(ctx, [[96, 78], [104, 84], [100, 90], [110, 92]], C.glow, 2, 10);
    glowLine(ctx, [[24, 80], [32, 86], [26, 92]], C.glow, 2, 10);
    glowLine(ctx, [[46, 100], [56, 96], [74, 100], [84, 96]], C.glow, 1.4, 8);
  }
}

// ---- Enemies --------------------------------------------------------------------

export const ENEMY_FRAME: Record<string, number> = { pursuer: 96, ranged: 96, armored: 128, support: 96, boss: 256 };

export function drawEnemy(ctx: Ctx, kind: string) {
  const flesh = "#5b2d4a";
  const fleshD = "#2a1222";
  const sick = "#b9ff6a";
  if (kind === "pursuer") {
    // low crawler with tendrils; frame 96, feet at (48, 88)
    limb(ctx, [36, 70], [24, 80], [20, 88], 4, flesh, fleshD);
    limb(ctx, [44, 72], [40, 84], [36, 88], 4, flesh, fleshD);
    limb(ctx, [56, 72], [64, 82], [70, 88], 4, flesh, fleshD);
    poly(ctx, [[24, 70], [30, 52], [52, 44], [74, 54], [78, 70], [52, 78]], flesh, fleshD, 2.5);
    poly(ctx, [[62, 54], [82, 50], [88, 62], [72, 66]], "#7a3a60", fleshD, 2);
    dot(ctx, 80, 57, 2.6, sick, 8);
    dot(ctx, 40, 58, 3, sick, 6);
  } else if (kind === "ranged") {
    limb(ctx, [44, 66], [40, 80], [36, 88], 5, flesh, fleshD);
    limb(ctx, [52, 66], [58, 80], [62, 88], 5, flesh, fleshD);
    limb(ctx, [48, 66], [46, 46], [52, 30], 6, flesh, fleshD); // stalk
    poly(ctx, [[36, 30], [48, 16], [66, 20], [70, 34], [56, 42], [40, 40]], "#6b3355", fleshD, 2.5); // bulb
    ctx.save();
    ctx.fillStyle = "#1a0a12";
    ctx.beginPath();
    ctx.ellipse(66, 30, 6, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    dot(ctx, 66, 30, 3, sick, 10);
  } else if (kind === "armored") {
    // frame 128, feet (64,118)
    limb(ctx, [48, 96], [42, 108], [40, 118], 10, flesh, fleshD);
    limb(ctx, [76, 96], [84, 108], [86, 118], 10, flesh, fleshD);
    poly(ctx, [[30, 98], [28, 66], [50, 46], [84, 46], [104, 68], [100, 98], [64, 104]], flesh, fleshD, 3);
    poly(ctx, [[34, 70], [48, 48], [86, 48], [100, 70], [92, 64], [42, 64]], "#6f6a72", "#1f1d22", 3); // carapace
    poly(ctx, [[60, 60], [70, 60], [74, 80], [56, 80]], "#6f6a72", "#1f1d22", 2);
    limb(ctx, [96, 70], [110, 84], [108, 98], 10, flesh, fleshD);
    poly(ctx, [[100, 92], [120, 94], [112, 106], [98, 104]], "#6f6a72", "#1f1d22", 2.5);
    dot(ctx, 92, 60, 2.4, sick, 8);
  } else if (kind === "support") {
    // floating sac with pulsing nodes
    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = "#000";
    ctx.restore();
    poly(ctx, [[30, 50], [36, 28], [60, 20], [72, 36], [70, 60], [48, 66]], "#4a3a66", "#1a1226", 2.5);
    for (const [x, y] of [[44, 36], [58, 30], [52, 50], [64, 46]] as Pt[]) dot(ctx, x, y, 3.2, "#c8a2ff", 10);
    limb(ctx, [42, 64], [38, 76], [42, 86], 3, "#4a3a66", "#1a1226");
    limb(ctx, [56, 64], [60, 76], [56, 86], 3, "#4a3a66", "#1a1226");
  } else if (kind === "boss") {
    // frame 256, feet (128, 236)
    limb(ctx, [70, 200], [50, 220], [44, 236], 18, flesh, fleshD);
    limb(ctx, [180, 200], [204, 220], [212, 236], 18, flesh, fleshD);
    poly(ctx, [[40, 210], [30, 140], [70, 80], [128, 60], [190, 82], [228, 140], [216, 210], [128, 228]], flesh, fleshD, 4);
    poly(ctx, [[70, 120], [96, 86], [160, 86], [188, 120], [160, 112], [96, 112]], "#6f6a72", "#1f1d22", 3);
    poly(ctx, [[60, 150], [90, 130], [100, 170], [66, 186]], "#7a3a60", fleshD, 2);
    poly(ctx, [[196, 150], [166, 130], [156, 170], [190, 186]], "#7a3a60", fleshD, 2);
    ctx.save();
    ctx.fillStyle = "#14060e";
    ctx.beginPath();
    ctx.ellipse(128, 150, 26, 22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    dot(ctx, 128, 150, 14, sick, 24);
    dot(ctx, 128, 150, 6, "#ffffff", 8);
    limb(ctx, [200, 120], [240, 150], [236, 196], 16, flesh, fleshD);
    limb(ctx, [56, 120], [18, 150], [22, 196], 16, flesh, fleshD);
    for (const [x, y] of [[100, 100], [150, 96], [176, 170], [84, 176]] as Pt[]) dot(ctx, x, y, 4, sick, 10);
  }
}

export function enemyFeet(kind: string) {
  const f = ENEMY_FRAME[kind] ?? 96;
  return { x: f / 2, y: f - (kind === "boss" ? 20 : kind === "armored" ? 10 : 8) };
}

// ---- Misc -------------------------------------------------------------------------

export function drawPickup(ctx: Ctx) {
  // 48×48 bio-cell
  dot(ctx, 24, 24, 9, "#7dffb0", 16);
  ctx.save();
  ctx.strokeStyle = "#e6fff0";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(24, 17);
  ctx.lineTo(24, 31);
  ctx.moveTo(17, 24);
  ctx.lineTo(31, 24);
  ctx.stroke();
  ctx.restore();
}

export function drawShadow(ctx: Ctx, w: number, h: number) {
  const g = ctx.createRadialGradient(w / 2, h / 2, 1, w / 2, h / 2, w / 2);
  g.addColorStop(0, "rgba(0,0,0,0.55)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** Small portrait canvas for the lab (before/after evolution silhouettes). */
export function lineagePortrait(lineage: LineageId, evo: string, mastery = false, size = 128, silhouette = false) {
  const c = newCanvas(size, size);
  const ctx = c.getContext("2d")!;
  ctx.scale(size / FRAME, size / FRAME);
  drawLineage(ctx, lineage, evo, mastery);
  if (silhouette) {
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = "rgba(230,240,255,0.92)";
    ctx.fillRect(0, 0, FRAME, FRAME);
  }
  return c;
}
