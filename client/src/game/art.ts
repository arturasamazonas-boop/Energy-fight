// Shared palette and illustrated portraits. Original imagegen PNGs are loaded
// and normalized by artwork.ts; the game no longer draws placeholder creatures.
import type { LineageId } from "@ef/shared";
import { ART_FEET, ART_FRAME, artworkMetrics, canvasOf, characterArtworkKey, loadArtwork } from "./artwork.ts";

export const FRAME = ART_FRAME;
export const FEET = ART_FEET;
export const LINEAGE_COLORS: Record<LineageId, { body: string; plate: string; glow: string; glowHex: number; dark: string }> = {
  pyra: { body: "#2b2320", plate: "#74543d", glow: "#ffb06a", glowHex: 0xffb06a, dark: "#140f0d" },
  krios: { body: "#1e2a33", plate: "#9cc6d8", glow: "#a3eff8", glowHex: 0xa3eff8, dark: "#0d151b" },
  vektor: { body: "#1c2622", plate: "#9fd9b6", glow: "#bef3cc", glowHex: 0xbef3cc, dark: "#0c1310" },
  litos: { body: "#2a2a2e", plate: "#777065", glow: "#e6c67b", glowHex: 0xe6c67b, dark: "#121215" },
};

export const ENEMY_FRAME: Record<string, number> = { pursuer: FRAME, ranged: FRAME, armored: FRAME, support: FRAME, boss: FRAME };
export const newCanvas = (w = FRAME, h = w) => canvasOf(w, h);
export const enemyFeet = (_kind: string) => FEET;

type Ctx = CanvasRenderingContext2D;

/** Explicit missing-art marker, never an alternate procedural character. */
export function drawMissingArtwork(ctx: Ctx, color = "#b8a583") {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.65;
  ctx.beginPath();
  ctx.moveTo(128, 180); ctx.lineTo(148, 208); ctx.lineTo(128, 234); ctx.lineTo(108, 208); ctx.closePath(); ctx.stroke();
  ctx.font = "bold 19px system-ui";
  ctx.textAlign = "center";
  ctx.fillStyle = color;
  ctx.fillText("…", 128, 211);
  ctx.restore();
}

export function drawLineage(ctx: Ctx, lineage: LineageId, evo: string, _mastery = false) {
  const art = artworkMetrics(characterArtworkKey(lineage, evo));
  if (art) ctx.drawImage(art.canvas, 0, 0);
  else drawMissingArtwork(ctx, LINEAGE_COLORS[lineage]?.glow);
}

export function drawEnemy(ctx: Ctx, kind: string) {
  const art = artworkMetrics(`enemy.${kind}.provided`);
  if (art) ctx.drawImage(art.canvas, 0, 0);
  else drawMissingArtwork(ctx, "#d7a1ac");
}

export function drawPickup(ctx: Ctx) {
  const gradient = ctx.createRadialGradient(24, 24, 1, 24, 24, 22);
  gradient.addColorStop(0, "#f0ffe6"); gradient.addColorStop(0.2, "#9ee9af"); gradient.addColorStop(1, "#86dba000");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 48, 48);
}

export function drawShadow(ctx: Ctx, w: number, h: number) {
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(w / 2, h / 2);
  const gradient = ctx.createRadialGradient(0, 0, 0.08, 0, 0, 1);
  gradient.addColorStop(0, "rgba(4,8,12,.65)");
  gradient.addColorStop(0.45, "rgba(4,8,12,.4)");
  gradient.addColorStop(1, "rgba(4,8,12,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
}

/** Existing synchronous DOM API; the cached illustration fills the canvas on load. */
export function lineagePortrait(lineage: LineageId, evo: string, mastery = false, size = 128, silhouette = false) {
  const pixels = Math.ceil(size * Math.min(window.devicePixelRatio || 1, 2));
  const canvas = newCanvas(pixels);
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  canvas.classList.add("illustrated-portrait");
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", `${lineage}${evo ? ` · ${evo}` : ""}`);
  const ctx = canvas.getContext("2d")!;
  const paint = (art: HTMLCanvasElement) => {
    ctx.clearRect(0, 0, pixels, pixels);
    if (mastery) {
      const halo = ctx.createRadialGradient(pixels / 2, pixels * 0.58, 0, pixels / 2, pixels * 0.58, pixels * 0.48);
      halo.addColorStop(0, "#e6c67b24"); halo.addColorStop(1, "#e6c67b00");
      ctx.fillStyle = halo; ctx.fillRect(0, 0, pixels, pixels);
    }
    ctx.drawImage(art, 0, 0, pixels, pixels);
    if (silhouette) {
      ctx.globalCompositeOperation = "source-atop";
      ctx.fillStyle = "rgba(220,233,242,.42)";
      ctx.fillRect(0, 0, pixels, pixels);
      ctx.globalCompositeOperation = "source-over";
    }
  };
  const key = characterArtworkKey(lineage, evo);
  const cached = artworkMetrics(key);
  if (cached) paint(cached.canvas);
  else {
    canvas.dataset.loading = "true";
    loadArtwork(key).then((art) => { paint(art.canvas); delete canvas.dataset.loading; }).catch(() => {
      canvas.dataset.missing = "true";
      ctx.save(); ctx.scale(pixels / FRAME, pixels / FRAME); drawMissingArtwork(ctx, LINEAGE_COLORS[lineage]?.glow); ctx.restore();
    });
  }
  return canvas;
}

/** Small bespoke line icons stay sharp at every HUD/button size. */
export function actionGlyph(action: string, lineage: LineageId = "pyra") {
  const shape: Record<string, string> = {
    attack: '<path d="m10 35 19-24 9-3-2 9-21 23-7 2 2-7Z"/><path d="m12 32 8 7M26 15l7 6M8 42l7-7"/>',
    dodge: '<path d="M8 30c5-12 11-16 26-15M27 8l10 7-8 9M6 37h13M10 42h8"/>',
    overdrive: '<path d="m27 5-15 22h11l-2 16 15-23H25l2-15Z"/><path d="M10 15 7 20M37 29l-3 5"/>',
    pyra: '<path d="M26 5c3 12 13 14 11 26-1 9-7 12-13 12S11 38 11 30c0-6 5-11 6-15 1 6 4 7 5 9 4-6 5-12 4-19Z"/><path d="M25 27c0 4-5 6-5 10s6 6 8 1c2-4-2-6-3-11Z"/>',
    krios: '<path d="m24 5 13 19-13 19L11 24 24 5Zm0 0v38M11 24h26M16 12l8 12 8-12M16 36l8-12 8 12"/>',
    vektor: '<path d="M7 16h23c10 0 10-11 3-11-4 0-6 3-6 5M5 24h31c10 0 9 13 1 13-4 0-6-3-6-5M12 32h10c9 0 8 11 1 11M6 10h12"/>',
    litos: '<path d="m13 10 18-2 9 16-6 17-23-1-5-16 7-14Z"/><path d="m13 10 6 13-8 17M19 23l21 1M19 23l15 18M24 10l-5 13"/>',
    skill2: '<path d="m24 5 4 11 11-4-4 12 9 5-13 3-2 12-8-10-12 5 5-13-10-6 14-2 6-13Z"/><circle cx="24" cy="25" r="4"/>',
    "skill2.pyra": '<path d="M5 20h17l-6-9 25 13-25 13 6-9H5M7 14h6M7 34h6"/><path d="m31 20 7 4-7 4"/>',
    "skill2.krios": '<path d="M24 5v38M8 14l32 20M8 34l32-20M19 8l5 5 5-5M19 40l5-5 5 5M9 20l6-1-1-6M34 35l-1-6 6-1M9 28l6 1-1 6M34 13l-1 6 6 1"/>',
    "skill2.vektor": '<path d="M13 15c12-13 28-5 27 7-1 11-19 16-23 6-3-7 9-11 12-5 3 6-6 8-8 4M35 33c-12 14-30 4-26-9M12 35l-4-8-6 6"/>',
    "skill2.litos": '<path d="m25 6-5 12 8 6-12 18M7 20l8 4-10 6M36 14l-3 12 9 7M14 13l-3-5M32 37l3 5M5 40c8 5 31 5 38-1"/>',
    menu: '<path d="M10 13h28M10 24h28M10 35h28"/>',
  };
  const drawing = shape[action === "skill1" ? lineage : action === "skill2" ? `skill2.${lineage}` : action] ?? shape.attack;
  return `<svg class="action-glyph" viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${drawing}</svg>`;
}
