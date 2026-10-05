// Boss loot crates dropping onto the battlefield, one per eligible player.
// Platinum, divine and ULTRA crates pulse, flicker and throw light rays.
import Phaser from "phaser";
import { WORLD, type BoxTier, type LootMsg } from "@ef/shared";
import { t } from "../i18n.ts";
import { settings } from "../settings.ts";
import { CRATE_PALETTE, CRATE_SIZE, TIER_RANK, crateCanvas } from "./crate.ts";

interface Drop {
  tier: BoxTier;
  mine: boolean;
  x: number;
  y: number; // projected ground y
  fall: number; // 0..1 landing progress
  img: Phaser.GameObjects.Image;
  fx: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
  seed: number;
}

export class LootDrops {
  private drops: Drop[] = [];
  private time = 0;

  constructor(private scene: Phaser.Scene, private myId: string) {}

  spawn(msg: LootMsg) {
    const n = msg.drops.length;
    msg.drops.forEach((d, i) => {
      const tier = d.tier as BoxTier;
      const key = `crate.${tier}`;
      if (!this.scene.textures.exists(key)) this.scene.textures.addCanvas(key, crateCanvas(tier));
      const ang = (i / Math.max(1, n)) * Math.PI * 2 + 0.4;
      const r = n === 1 ? 0 : 70 + (i % 2) * 30;
      const gx = msg.x + Math.cos(ang) * r;
      const gy = (msg.y + Math.sin(ang) * r * 0.8) * WORLD.depthScale;
      const mine = d.id === this.myId;
      const scale = (mine ? 0.62 : 0.46) * (1 + TIER_RANK[tier] * 0.06);
      const img = this.scene.add.image(gx, gy - 300, key).setOrigin(64 / CRATE_SIZE, 116 / CRATE_SIZE).setScale(scale).setDepth(gy + 2);
      const fx = this.scene.add.graphics().setDepth(gy + 1);
      const label = this.scene.add
        .text(gx, gy + 14, `${d.name}\n${t("box_" + tier)}`, {
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
      this.drops.push({ tier, mine, x: gx, y: gy, fall: 0, img, fx, label, seed: i * 1.7 });
    });
  }

  update(dt: number) {
    this.time += dt;
    const reduced = settings.reducedEffects;
    for (const d of this.drops) {
      const P = CRATE_PALETTE[d.tier];
      const rank = TIER_RANK[d.tier];
      if (d.fall < 1) {
        d.fall = Math.min(1, d.fall + dt * 1.6);
        const k = d.fall;
        // Fall with a small bounce at the end.
        const bounce = k < 0.8 ? 1 - (k / 0.8) ** 2 : Math.sin(((k - 0.8) / 0.2) * Math.PI) * 0.08;
        d.img.setY(d.y - bounce * 300);
        if (k >= 1) d.label.setAlpha(1);
      }
      const t = this.time + d.seed;
      const g = d.fx;
      g.clear();
      const landed = d.fall >= 1;
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

  destroy() {
    for (const d of this.drops) {
      d.img.destroy();
      d.fx.destroy();
      d.label.destroy();
    }
    this.drops = [];
  }
}
