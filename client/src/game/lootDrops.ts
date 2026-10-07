// Boss loot crates dropping onto the battlefield, one per eligible player.
// Platinum, divine and ULTRA crates pulse, flicker and throw light rays.
import Phaser from "phaser";
import { WORLD, clampToWalkable, type BoxTier, type LootMsg } from "@ef/shared";
import { t } from "../i18n.ts";
import { settings } from "../settings.ts";
import { CRATE_PALETTE, CRATE_SIZE, TIER_RANK, crateCanvas } from "./crate.ts";

interface Spark { x: number; y: number; life: number; color: number; size: number }

interface Drop {
  tier: BoxTier;
  mine: boolean;
  x: number; // landing point (screen x)
  y: number; // landing point (projected ground y)
  sx: number; // launch point
  sy: number;
  delay: number; // seconds before launch
  flight: number; // 0..1 arc progress
  flightTime: number;
  peak: number; // arc height in px
  bounce: number; // 0..1 after landing
  fall: number; // 1 once fully landed (kept for update logic)
  img: Phaser.GameObjects.Image;
  fx: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
  seed: number;
  landedFlash: number;
}

/** Ground position lookup for a player (session id) → world x/y. */
export type PlayerPos = (id: string) => { x: number; y: number } | null;

export class LootDrops {
  private drops: Drop[] = [];
  private sparks: Spark[] = [];
  private time = 0;
  /** Called once per crate when it touches down (sound/shake hooks). */
  onLand: (mine: boolean, rank: number) => void = () => {};

  constructor(private scene: Phaser.Scene, private myId: string, private playerPos: PlayerPos = () => null) {}

  /**
   * Boss is down: every crate is launched out of the boss in a high spinning arc
   * with a sparkle trail and lands next to its owner (BOTS-style "SECTOR CLEAR").
   */
  spawn(msg: LootMsg) {
    const n = msg.drops.length;
    // Lower tiers fly first; the rarest crate is the finale.
    const order = msg.drops.map((d, i) => ({ d, i })).sort((a, b) => TIER_RANK[a.d.tier as BoxTier] - TIER_RANK[b.d.tier as BoxTier]);
    order.forEach(({ d, i }, k) => {
      const tier = d.tier as BoxTier;
      const key = `crate.${tier}`;
      if (!this.scene.textures.exists(key)) this.scene.textures.addCanvas(key, crateCanvas(tier));
      const owner = this.playerPos(d.id);
      // Land a short step in front of the owner, or around the boss if the owner is unknown.
      // Spread landing spots on a ring so crates never stack on each other.
      const ringA = -Math.PI / 2 + (i / Math.max(1, n)) * Math.PI * 2 + 0.6;
      const ringR = n === 1 ? 60 : 70 + n * 8;
      const cx = owner ? owner.x : msg.x, cy = owner ? owner.y : msg.y;
      const spot = clampToWalkable(cx + Math.cos(ringA) * ringR, cy + Math.sin(ringA) * ringR * 0.9, 1e9);
      const lx = spot.x;
      const ly = spot.y;
      const gx = lx;
      const gy = ly * WORLD.depthScale;
      const mine = d.id === this.myId;
      const rank = TIER_RANK[tier];
      const scale = (mine ? 0.62 : 0.46) * (1 + rank * 0.06);
      const sx = msg.x, sy = msg.y * WORLD.depthScale - 60;
      const img = this.scene.add.image(sx, sy, key).setOrigin(64 / CRATE_SIZE, 116 / CRATE_SIZE).setScale(scale).setDepth(150000).setVisible(false);
      const fx = this.scene.add.graphics().setDepth(gy + 1);
      const label = this.scene.add
        .text(gx, gy + 12 + (mine ? 0 : (i % 2) * 12), mine ? `${d.name}\n${t("box_" + tier)}` : t("box_" + tier), {
          fontFamily: "system-ui, sans-serif",
          fontSize: mine ? "14px" : "11px",
          fontStyle: "bold",
          align: "center",
          color: CRATE_PALETTE[tier].glow,
          stroke: "#000",
          strokeThickness: 3,
        })
        .setOrigin(0.5, 0)
        .setDepth(150001)
        .setAlpha(0);
      const dist = Math.hypot(gx - sx, gy - sy);
      this.drops.push({
        tier, mine, x: gx, y: gy, sx, sy,
        delay: 0.35 + k * 0.28,
        flight: 0,
        flightTime: 1.05 + Math.min(0.6, dist / 900) + rank * 0.08,
        peak: 240 + rank * 40 + Math.min(160, dist * 0.25),
        bounce: 0, fall: 0, img, fx, label, seed: i * 1.7, landedFlash: 0,
      });
    });
  }

  update(dt: number) {
    this.time += dt;
    const reduced = settings.reducedEffects;
    // Sparkle trail particles.
    for (const sp of this.sparks) sp.life -= dt;
    this.sparks = this.sparks.filter((sp) => sp.life > 0);
    for (const d of this.drops) {
      const P = CRATE_PALETTE[d.tier];
      const rank = TIER_RANK[d.tier];
      if (d.delay > 0) {
        d.delay -= dt;
        if (d.delay <= 0) d.img.setVisible(true);
        continue;
      }
      if (d.flight < 1) {
        d.flight = Math.min(1, d.flight + dt / d.flightTime);
        const k = d.flight;
        const x = d.sx + (d.x - d.sx) * k;
        const y = d.sy + (d.y - d.sy) * k - Math.sin(k * Math.PI) * d.peak;
        d.img.setPosition(x, y).setRotation(k * Math.PI * (3 + rank * 0.5)).setDepth(150000);
        if (!reduced || Math.random() < 0.4) {
          for (let j = 0; j < (rank >= 3 ? 3 : 2); j++) {
            const color = d.tier === "ultra" ? Phaser.Display.Color.HSVToRGB((this.time * 0.8 + j * 0.2) % 1, 0.5, 1).color : j === 0 ? 0xffffff : P.glowHex;
            this.sparks.push({ x: x + (Math.random() - 0.5) * 18, y: y - 30 + (Math.random() - 0.5) * 18, life: 0.5 + Math.random() * 0.4, color, size: 2 + Math.random() * (2 + rank * 0.6) });
          }
        }
        if (d.flight >= 1) {
          d.img.setRotation(0).setDepth(d.y + 2);
          d.landedFlash = 1;
          this.onLand(d.mine, rank);
        }
        continue;
      }
      if (d.bounce < 1) {
        d.bounce = Math.min(1, d.bounce + dt / 0.35);
        const hop = Math.sin(d.bounce * Math.PI) * (26 + rank * 4);
        const squash = d.bounce < 0.15 ? 1 - (0.15 - d.bounce) * 2 : 1;
        d.img.setY(d.y - hop).setScale(d.img.scaleX, d.img.scaleX * squash);
        if (d.bounce >= 1) {
          d.fall = 1;
          d.label.setAlpha(1);
        }
      }
      d.landedFlash = Math.max(0, d.landedFlash - dt * 2.2);
      const t = this.time + d.seed;
      const g = d.fx;
      g.clear();
      const landed = d.fall >= 1;
      if (d.landedFlash > 0) {
        // Touch-down: expanding light ring and an upward burst.
        const f = 1 - d.landedFlash;
        g.lineStyle(4 * d.landedFlash, P.glowHex, d.landedFlash);
        g.strokeEllipse(d.x, d.y, 40 + f * (160 + rank * 30), (40 + f * (160 + rank * 30)) * 0.4);
        g.fillStyle(0xffffff, d.landedFlash * 0.5);
        g.fillTriangle(d.x - 14 * d.landedFlash, d.y, d.x + 14 * d.landedFlash, d.y, d.x, d.y - 180 * f - 40);
      }
      const pulse = 0.5 + 0.5 * Math.sin(t * (rank >= 3 ? 6 : 3));
      // Ground glow.
      g.fillStyle(P.glowHex, (0.12 + 0.08 * rank) * (landed ? 1 : d.fall) * (0.7 + 0.3 * pulse));
      g.fillEllipse(d.x, d.y, 90 + rank * 22, (90 + rank * 22) * 0.4);
      if (landed && rank >= 3 && !reduced) {
        // Rotating light rays; stronger and flickering for divine/ULTRA.
        const rays = rank >= 4 ? 10 : 6;
        const len = 90 + rank * 30;
        const flicker = rank >= 4 ? 0.6 + 0.4 * Math.abs(Math.sin(t * 17 + d.seed)) : 1;
        for (let i = 0; i < rays; i++) {
          const a = t * (rank === 5 ? 1.4 : 0.8) + (i / rays) * Math.PI * 2;
          const color = d.tier === "ultra" ? Phaser.Display.Color.HSVToRGB(((t * 0.25 + i / rays) % 1), 0.6, 1).color : P.glowHex;
          g.fillStyle(color, 0.18 * flicker);
          const cx = d.x;
          const cy = d.y - 30;
          g.fillTriangle(cx, cy, cx + Math.cos(a - 0.08) * len, cy + Math.sin(a - 0.08) * len * 0.75, cx + Math.cos(a + 0.08) * len, cy + Math.sin(a + 0.08) * len * 0.75);
        }
        // Sparkles.
        for (let i = 0; i < (rank === 5 ? 14 : rank === 4 ? 10 : 6); i++) {
          const a = i * 2.39 + t * 0.7;
          const rr = 30 + ((t * 40 + i * 17) % 70);
          const sx = d.x + Math.cos(a) * rr;
          const sy = d.y - 40 - ((t * 50 + i * 23) % 80);
          g.fillStyle(0xffffff, 0.5 + 0.5 * Math.sin(t * 9 + i));
          g.fillCircle(sx, sy, rank >= 4 ? 2.4 : 1.8);
        }
      }
      if (landed) {
        d.img.setY(d.y - Math.abs(Math.sin(t * 2.4)) * (d.mine ? 6 : 3));
        if (d.tier === "ultra" && !reduced) d.img.setTint(Phaser.Display.Color.HSVToRGB((t * 0.3) % 1, 0.25, 1).color);
        else if (rank >= 4) d.img.setAlpha(0.85 + 0.15 * Math.abs(Math.sin(t * 13)));
        if (d.mine) {
          // Bouncing marker above your own crate.
          const my = d.y - 110 - Math.abs(Math.sin(t * 4)) * 10;
          g.fillStyle(0xffffff, 0.95);
          g.fillTriangle(d.x - 9, my, d.x + 9, my, d.x, my + 13);
        }
      }
    }
  }

  /** Sparkle trail, drawn on its own layer above everything. */
  private trail?: Phaser.GameObjects.Graphics;
  drawTrail() {
    if (!this.trail) this.trail = this.scene.add.graphics().setDepth(150002).setBlendMode(Phaser.BlendModes.ADD);
    const g = this.trail;
    g.clear();
    for (const sp of this.sparks) {
      const a = Math.min(1, sp.life * 2);
      const r = sp.size * (0.6 + a * 0.6);
      g.fillStyle(sp.color, a);
      // 4-point star
      g.fillTriangle(sp.x - r * 2.2, sp.y, sp.x + r * 2.2, sp.y, sp.x, sp.y - r * 0.5);
      g.fillTriangle(sp.x - r * 2.2, sp.y, sp.x + r * 2.2, sp.y, sp.x, sp.y + r * 0.5);
      g.fillTriangle(sp.x, sp.y - r * 2.2, sp.x, sp.y + r * 2.2, sp.x - r * 0.5, sp.y);
      g.fillTriangle(sp.x, sp.y - r * 2.2, sp.x, sp.y + r * 2.2, sp.x + r * 0.5, sp.y);
    }
  }

  destroy() {
    this.trail?.destroy();
    for (const d of this.drops) {
      d.img.destroy();
      d.fx.destroy();
      d.label.destroy();
    }
    this.drops = [];
  }
}
