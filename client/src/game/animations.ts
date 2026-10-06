// Optional frame-animation strips (from client/public/assets/animations/).
// If animations/animations.json is absent the game keeps its single-pose
// illustrations with procedural motion. When strips exist, characters and
// enemies play them automatically; missing animations fall back gracefully.
import Phaser from "phaser";

export interface AnimEntry {
  file: string;
  id: string; // e.g. "pyra_base", "enemy_pursuer"
  animation: string; // e.g. "run"
  frames: number;
  frameWidth: number;
  frameHeight: number;
  fps: number;
  loop: boolean;
  anchorX: number;
  anchorY: number;
  /** Measured pixels from the top of the opaque body to the feet anchor (set at create). */
  bodyHeight?: number;
}

const INDEX_KEY = "anim.index";
const BASE = "assets/animations/";

export class AnimLibrary {
  private entries = new Map<string, AnimEntry>();

  /** Call from Scene.preload(). */
  preload(scene: Phaser.Scene) {
    scene.load.json(INDEX_KEY, `${BASE}animations.json`);
    scene.load.on(`filecomplete-json-${INDEX_KEY}`, () => {
      const list = scene.cache.json.get(INDEX_KEY);
      if (!Array.isArray(list)) return;
      for (const raw of list as AnimEntry[]) {
        if (!raw?.file || !raw.id || !raw.animation || !(raw.frameWidth > 0) || !(raw.frameHeight > 0)) continue;
        const e: AnimEntry = { ...raw, fps: raw.fps ?? 12, loop: raw.loop ?? false, anchorX: raw.anchorX ?? raw.frameWidth / 2, anchorY: raw.anchorY ?? raw.frameHeight * 0.92 };
        this.entries.set(`${e.id}.${e.animation}`, e);
        scene.load.spritesheet(sheetKey(e), BASE + e.file, { frameWidth: e.frameWidth, frameHeight: e.frameHeight });
      }
    });
    scene.load.on("loaderror", (file: Phaser.Loader.File) => {
      if (file.key.startsWith("anim.")) {
        for (const [k, e] of this.entries) if (sheetKey(e) === file.key) this.entries.delete(k);
      }
    });
  }

  /** Call from Scene.create(): registers Phaser animations for every loaded strip. */
  create(scene: Phaser.Scene) {
    for (const [k, e] of this.entries) {
      if (!scene.textures.exists(sheetKey(e))) {
        this.entries.delete(k);
        continue;
      }
      e.bodyHeight = measureBody(scene, e);
      if (!scene.anims.exists(k)) {
        scene.anims.create({ key: k, frames: scene.anims.generateFrameNumbers(sheetKey(e), { start: 0, end: e.frames - 1 }), frameRate: e.fps, repeat: e.loop ? -1 : 0 });
      }
    }
  }

  has(id: string, animation = "idle") {
    return this.entries.has(`${id}.${animation}`);
  }

  /**
   * One reference body height per character/enemy id (taken from idle when present),
   * so the sprite keeps a constant size when it switches between animations.
   */
  referenceHeight(id: string) {
    const e = this.pick(id, ["idle", "run"]);
    return e?.bodyHeight;
  }

  /** First available animation from a preference list. */
  pick(id: string, wanted: string[]): AnimEntry | null {
    for (const a of wanted) {
      const e = this.entries.get(`${id}.${a}`);
      if (e) return e;
    }
    return null;
  }

  /**
   * Plays the best matching animation on a sprite. One-shot animations are
   * not restarted while they are still running. Returns the entry used.
   */
  drive(sprite: Phaser.GameObjects.Sprite, id: string, wanted: string[]): AnimEntry | null {
    const e = this.pick(id, wanted);
    if (!e) return null;
    const key = `${e.id}.${e.animation}`;
    const cur = sprite.anims.currentAnim?.key;
    if (cur !== key) {
      const curEntry = cur ? this.entries.get(cur) : undefined;
      // Let a running one-shot (attack, skill, hurt) finish unless something more urgent is requested.
      const urgent = ["downed", "death", "dodge", "revive"].includes(e.animation);
      if (curEntry && !curEntry.loop && sprite.anims.isPlaying && !urgent && e.loop) return curEntry;
      sprite.setTexture(sheetKey(e));
      sprite.setOrigin(e.anchorX / e.frameWidth, e.anchorY / e.frameHeight);
      sprite.play(key);
    }
    return e;
  }

  get size() {
    return this.entries.size;
  }
}

function sheetKey(e: AnimEntry) {
  return `anim.${e.id}.${e.animation}`;
}

/**
 * Display scale for a strip so the body matches the target on-screen height.
 * Uses the measured body height (reference = idle frame) when available.
 */
export function stripScale(e: AnimEntry, displayHeight: number, referenceBody?: number) {
  const body = referenceBody ?? e.bodyHeight ?? e.anchorY * 0.8;
  return displayHeight / Math.max(16, body);
}

/** Highest opaque pixel of the first frame → body height above the feet anchor. */
function measureBody(scene: Phaser.Scene, e: AnimEntry): number | undefined {
  try {
    const src = scene.textures.get(sheetKey(e)).getSourceImage() as CanvasImageSource;
    const c = document.createElement("canvas");
    c.width = e.frameWidth;
    c.height = e.frameHeight;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return undefined;
    ctx.drawImage(src, 0, 0, e.frameWidth, e.frameHeight, 0, 0, e.frameWidth, e.frameHeight);
    const data = ctx.getImageData(0, 0, e.frameWidth, e.frameHeight).data;
    for (let y = 0; y < e.frameHeight; y++) {
      for (let x = 0; x < e.frameWidth; x++) {
        if (data[(y * e.frameWidth + x) * 4 + 3] > 40) return Math.max(16, e.anchorY - y);
      }
    }
  } catch {
    // Tainted or missing image: fall back to the frame estimate.
  }
  return undefined;
}
