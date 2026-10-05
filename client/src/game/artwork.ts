import { LINEAGE_SPECS, type LineageId } from "@ef/shared";

/** Original illustrations remain untouched. These are display-frame coordinates. */
export const ART_FRAME = 256;
export const ART_FEET = { x: 128, y: 236 } as const;
export const ART_ALPHA_CUTOFF = 16;

export const ILLUSTRATED_ASSETS = [
  ...Object.values(LINEAGE_SPECS).flatMap((lineage) =>
    ["base", ...lineage.evolutions.map((e) => e.id)].map((evolution) => ({
      key: `char.${lineage.id}.${evolution}`,
      file: `char_${lineage.id}_${evolution}.png`,
      normalize: true,
    })),
  ),
  ...["pursuer", "ranged", "armored", "support", "boss"].map((kind) => ({
    key: `enemy.${kind}.provided`, file: `enemy_${kind}.png`, normalize: true,
  })),
  { key: "env.station_nexus", file: "arena_background.png", normalize: false },
  { key: "env.floor", file: "floor_texture.png", normalize: false },
  { key: "prop.stabilizer", file: "prop_stabilizer.png", normalize: true },
  { key: "prop.gateway", file: "prop_gateway.png", normalize: true },
  { key: "pickup.biocell", file: "pickup_biocell.png", normalize: true },
] as const;

const assetFiles = new Map(ILLUSTRATED_ASSETS.map((asset) => [asset.key, asset.file]));
const sourcePromises = new Map<string, Promise<HTMLImageElement>>();
const normalized = new Map<string, NormalizedArtwork>();

export interface NormalizedArtwork {
  canvas: HTMLCanvasElement;
  sourceWidth: number;
  sourceHeight: number;
  sourceBounds: { x: number; y: number; width: number; height: number };
  sourceFeet: { x: number; y: number };
  /** Visible height above the foot contact; used instead of guessed PNG dimensions. */
  bodyHeight: number;
  bodyWidth: number;
}

export function artworkUrl(key: string) {
  const file = assetFiles.get(key);
  return file ? `/assets/illustrated/${file}` : "";
}

export function characterArtworkKey(lineage: LineageId, evolution = "") {
  const known = LINEAGE_SPECS[lineage]?.evolutions.some((e) => e.id === evolution);
  return `char.${lineage}.${known ? evolution : "base"}`;
}

export function rawArtworkKey(key: string) {
  return `illustration.source.${key}`;
}

export function canvasOf(width: number, height = width) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Cache sharing also prevents every lobby/HUD portrait from decoding another PNG. */
export function loadArtwork(key: string): Promise<NormalizedArtwork> {
  const existing = normalized.get(key);
  if (existing) return Promise.resolve(existing);
  let source = sourcePromises.get(key);
  if (!source) {
    source = new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => {
        sourcePromises.delete(key);
        reject(new Error(`Illustration did not load: ${key}`));
      };
      image.src = artworkUrl(key);
    });
    sourcePromises.set(key, source);
  }
  return source.then((image) => {
    const art = normalizeArtwork(key, image);
    sourcePromises.delete(key);
    return art;
  });
}

/**
 * A single painted pose, normalized once for runtime display. The alpha scan is
 * bounded to 512px; transparent padding and soft glow never define the foot pivot.
 * Animation is subsequently pose motion / squash / VFX, not invented sprite frames.
 */
export function normalizeArtwork(key: string, image: HTMLImageElement): NormalizedArtwork {
  const cached = normalized.get(key);
  if (cached) return cached;
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const sampleScale = Math.min(1, 512 / Math.max(sourceWidth, sourceHeight));
  const sample = canvasOf(Math.max(1, Math.round(sourceWidth * sampleScale)), Math.max(1, Math.round(sourceHeight * sampleScale)));
  const scan = sample.getContext("2d", { willReadFrequently: true })!;
  scan.drawImage(image, 0, 0, sample.width, sample.height);
  const pixels = scan.getImageData(0, 0, sample.width, sample.height).data;
  let left = sample.width, top = sample.height, right = 0, bottom = 0;
  let bodyBottom = 0, bodyTop = sample.height;
  for (let y = 0; y < sample.height; y++) {
    for (let x = 0; x < sample.width; x++) {
      const alpha = pixels[(y * sample.width + x) * 4 + 3];
      if (alpha <= ART_ALPHA_CUTOFF) continue;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
      if (alpha >= 128) { bodyBottom = Math.max(bodyBottom, y); bodyTop = Math.min(bodyTop, y); }
    }
  }
  if (left > right || top > bottom) { left = 0; top = 0; right = sample.width - 1; bottom = sample.height - 1; }
  if (bodyTop > bodyBottom) { bodyTop = top; bodyBottom = bottom; }
  // Foot placement uses the structural lower 7%, excluding wisps and outer glow.
  const footBand = Math.max(2, Math.round((bodyBottom - bodyTop) * 0.07));
  let weightedX = 0, weight = 0;
  for (let y = bodyBottom - footBand; y <= bodyBottom; y++) {
    for (let x = left; x <= right; x++) {
      const alpha = pixels[(Math.max(0, y) * sample.width + x) * 4 + 3];
      if (alpha < 128) continue;
      const w = alpha * (1 + (y - (bodyBottom - footBand)) / footBand);
      weightedX += x * w; weight += w;
    }
  }
  const contactX = key.startsWith("prop.") ? (left + right) / 2 : weight ? weightedX / weight : (left + right) / 2;
  const contactY = bodyBottom + 1;
  const sourceBounds = {
    x: left / sampleScale, y: top / sampleScale,
    width: (right - left + 1) / sampleScale, height: (bottom - top + 1) / sampleScale,
  };
  const sourceFeet = { x: contactX / sampleScale, y: contactY / sampleScale };
  const margin = 9;
  const fit = Math.min(
    (ART_FEET.x - margin) / Math.max(1, contactX - left),
    (ART_FRAME - margin - ART_FEET.x) / Math.max(1, right + 1 - contactX),
    (ART_FEET.y - margin) / Math.max(1, contactY - top),
    (ART_FRAME - margin - ART_FEET.y) / Math.max(1, bottom + 1 - contactY),
  );
  const canvas = canvasOf(ART_FRAME);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const sourceToFrame = fit * sampleScale;
  ctx.drawImage(image, ART_FEET.x - sourceFeet.x * sourceToFrame, ART_FEET.y - sourceFeet.y * sourceToFrame, sourceWidth * sourceToFrame, sourceHeight * sourceToFrame);
  const result = {
    canvas, sourceWidth, sourceHeight, sourceBounds, sourceFeet,
    bodyHeight: Math.max(1, (contactY - top) * fit),
    bodyWidth: (right - left + 1) * fit,
  };
  normalized.set(key, result);
  return result;
}

export function artworkMetrics(key: string) { return normalized.get(key); }

/** This is visual progression only: collision, reach, movement and stats are unchanged. */
export function characterDisplayHeight(lineage: LineageId, level: number, evolution = "") {
  const base = { pyra: 44, krios: 49, vektor: 45, litos: 48 }[lineage] ?? 46;
  const growth = 1 + 0.96 * ((Math.max(1, Math.min(20, level)) - 1) / 19);
  return base * growth * (evolution ? 1.08 : 1);
}

export const ENEMY_DISPLAY_HEIGHT: Record<string, number> = { pursuer: 43, ranged: 61, armored: 77, support: 60, boss: 158, pylon: 96 };
