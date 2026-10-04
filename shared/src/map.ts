// Mission map for BREACH AT STATION NEXUS, in ground coordinates.
// x runs left→right through the station, y is depth (0 = back wall, larger = closer to camera).
import { WORLD } from "./config.ts";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SectionDef {
  id: 1 | 2 | 3;
  // Players may not go beyond this x until the section is cleared.
  gateX: number;
  arena: Rect;
  checkpoint: { x: number; y: number };
  spawnPoints: { x: number; y: number }[];
}

export const MAP = {
  width: 4300,
  height: 600,
  walkable: [
    { x: 0, y: 200, w: 640, h: 200 }, // entry corridor
    { x: 600, y: 40, w: 920, h: 520 }, // arena A
    { x: 1500, y: 220, w: 320, h: 160 }, // passage A→B
    { x: 1800, y: 40, w: 1000, h: 520 }, // arena B (stabilizer)
    { x: 2780, y: 220, w: 340, h: 160 }, // passage B→C
    { x: 3100, y: 20, w: 1180, h: 560 }, // boss arena + extraction
  ] as Rect[],
  start: { x: 120, y: 300 },
  stabilizer: { x: 2300, y: 300, radius: 150, activateRadius: 80 },
  extraction: { x: 4180, y: 300, radius: 90 },
  bossSpawn: { x: 3800, y: 300 },
  sections: [
    {
      id: 1,
      gateX: 1500,
      arena: { x: 600, y: 40, w: 920, h: 520 },
      checkpoint: { x: 120, y: 300 },
      spawnPoints: [
        { x: 1450, y: 120 },
        { x: 1450, y: 480 },
        { x: 1000, y: 70 },
        { x: 1000, y: 530 },
      ],
    },
    {
      id: 2,
      gateX: 2780,
      arena: { x: 1800, y: 40, w: 1000, h: 520 },
      checkpoint: { x: 1620, y: 300 },
      spawnPoints: [
        { x: 2760, y: 120 },
        { x: 2760, y: 480 },
        { x: 2300, y: 60 },
        { x: 2300, y: 540 },
      ],
    },
    {
      id: 3,
      gateX: 4300,
      arena: { x: 3100, y: 20, w: 1180, h: 560 },
      checkpoint: { x: 2950, y: 300 },
      spawnPoints: [
        { x: 4100, y: 80 },
        { x: 4100, y: 520 },
        { x: 3500, y: 50 },
        { x: 3500, y: 550 },
      ],
    },
  ] as SectionDef[],
};

export function inRect(r: Rect, x: number, y: number, pad = 0): boolean {
  return x >= r.x + pad && x <= r.x + r.w - pad && y >= r.y + pad && y <= r.y + r.h - pad;
}

export function isWalkable(x: number, y: number, maxX: number, pad = WORLD.playerRadius): boolean {
  if (x > maxX - pad || x < pad) return false;
  for (const r of MAP.walkable) if (inRect(r, x, y, 0) && y >= r.y + pad * 0.5 && y <= r.y + r.h - pad * 0.5) return true;
  return false;
}

/** Moves from (x,y) by (dx,dy) staying on walkable ground; slides along walls. */
export function moveOnGround(x: number, y: number, dx: number, dy: number, maxX: number, pad = WORLD.playerRadius) {
  const nx = x + dx;
  const ny = y + dy;
  if (isWalkable(nx, ny, maxX, pad)) return { x: nx, y: ny };
  if (isWalkable(nx, y, maxX, pad)) return { x: nx, y };
  if (isWalkable(x, ny, maxX, pad)) return { x, y: ny };
  // Try a shorter step so fast dashes still reach the wall.
  if (Math.abs(dx) + Math.abs(dy) > 4) return moveOnGround(x, y, dx * 0.5, dy * 0.5, maxX, pad);
  return { x, y };
}

/** Nearest walkable point (used for respawns and for repairing bad positions). */
export function clampToWalkable(x: number, y: number, maxX: number) {
  if (isWalkable(x, y, maxX)) return { x, y };
  let best = { x: MAP.start.x, y: MAP.start.y };
  let bestD = Infinity;
  for (const r of MAP.walkable) {
    const cx = Math.min(Math.max(x, r.x + 20), Math.min(r.x + r.w - 20, maxX - 20));
    const cy = Math.min(Math.max(y, r.y + 20), r.y + r.h - 20);
    const d = (cx - x) ** 2 + (cy - y) ** 2;
    if (d < bestD && isWalkable(cx, cy, maxX)) {
      bestD = d;
      best = { x: cx, y: cy };
    }
  }
  return best;
}

// ---- Projection -------------------------------------------------------------
// World (ground x, ground y, elevation z) → screen. Inverse ignores elevation.
export function worldToScreen(x: number, y: number, z = 0) {
  return { sx: x, sy: y * WORLD.depthScale - z };
}
export function screenToWorld(sx: number, sy: number) {
  return { x: sx, y: sy / WORLD.depthScale };
}

// ---- Navigation ---------------------------------------------------------------
// The station is a linear chain of rectangles, so routing between regions only
// needs the doorway between neighbouring rectangles.
export function regionOf(x: number, y: number): number {
  let best = -1;
  let bestD = Infinity;
  MAP.walkable.forEach((r, i) => {
    const cx = Math.min(Math.max(x, r.x), r.x + r.w);
    const cy = Math.min(Math.max(y, r.y), r.y + r.h);
    const d = (cx - x) ** 2 + (cy - y) ** 2;
    // Prefer the narrower rect when inside an overlap so doorways are respected.
    const score = d + (d === 0 ? r.h * 0.001 : 0);
    if (score < bestD) {
      bestD = score;
      best = i;
    }
  });
  return best;
}

function doorway(i: number, j: number) {
  const a = MAP.walkable[i];
  const b = MAP.walkable[j];
  const x0 = Math.max(a.x, b.x);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y0 = Math.max(a.y, b.y);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}

/** Next point to steer toward when travelling from (x,y) to (tx,ty). */
export function navTarget(x: number, y: number, tx: number, ty: number) {
  const a = regionOf(x, y);
  const b = regionOf(tx, ty);
  if (a === b || a < 0 || b < 0) return { x: tx, y: ty };
  const next = b > a ? a + 1 : a - 1;
  const d = doorway(a, next);
  // Once aligned with the doorway, push through it.
  const r = MAP.walkable[next];
  if (Math.abs(y - d.y) < r.h / 2 - 20 || r.h > 400) return { x: b > a ? Math.max(d.x, x + 40) : Math.min(d.x, x - 40), y: d.y + (y - d.y) * 0.5 };
  return d;
}
