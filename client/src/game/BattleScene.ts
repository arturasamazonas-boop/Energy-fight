import Phaser from "phaser";
import type { Room } from "@colyseus/sdk";
import {
  LINEAGE_SPECS,
  MAP,
  OVERDRIVE,
  PLAYER,
  WORLD,
  normalizeInput,
  stepMovement,
  type ActionKind,
  type FxEvent,
  type LineageId,
} from "@ef/shared";
import manifest from "../../../ASSET_MANIFEST.json";
import { t } from "../i18n.ts";
import { settings } from "../settings.ts";
import { ENEMY_FRAME, FEET, FRAME, LINEAGE_COLORS, drawEnemy, drawLineage, drawPickup, drawShadow, enemyFeet, newCanvas } from "./art.ts";
import { sfx } from "./audio.ts";
import type { Controls } from "./controls.ts";
import type { Hud } from "./hud.ts";

const DS = WORLD.depthScale;
const sx = (x: number) => x;
const sy = (y: number) => y * DS;

interface PlayerView {
  body: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  dx: number;
  dy: number;
  texKey: string;
  lunge: number;
  hitFlash: number;
  aura: number;
}
interface EnemyView {
  body: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  dx: number;
  dy: number;
  flash: number;
  kind: string;
}

export interface BattleOptions {
  room: Room;
  hud: Hud;
  controls: Controls;
}

type ManifestEntry = { id: string; file: string; status: string; frameWidth?: number; frameHeight?: number; anchor?: { x: number; y: number } };

export class BattleScene extends Phaser.Scene {
  private room!: Room;
  private hud!: Hud;
  private controls!: Controls;
  private players = new Map<string, PlayerView>();
  private enemies = new Map<string, EnemyView>();
  private pickups = new Map<string, Phaser.GameObjects.Image>();
  private tele!: Phaser.GameObjects.Graphics;
  private overlay!: Phaser.GameObjects.Graphics;
  private gates!: Phaser.GameObjects.Graphics;
  private markers!: Phaser.GameObjects.Graphics;
  private fxLayer!: Phaser.GameObjects.Graphics;
  private transient: { g: Phaser.GameObjects.Graphics; life: number; max: number; draw: (g: Phaser.GameObjects.Graphics, k: number) => void }[] = [];
  private numbers: { txt: Phaser.GameObjects.Text; life: number; vy: number }[] = [];
  private numberPool: Phaser.GameObjects.Text[] = [];
  private seq = 1;
  private lastSent = { mx: 0, my: 0, atk: false, at: 0 };
  private pred = { x: 0, y: 0, init: false, dash: null as null | { dx: number; dy: number; t: number; dur: number; dist: number } };
  private history: { seq: number; x: number; y: number }[] = [];
  private corr = { x: 0, y: 0 };
  private localSwing = { timer: 0, step: 0, idle: 0 };
  private facing = { x: 1, y: 0 };
  private shakeCooldown = 0;
  private hitStop = 0;
  private time0 = 0;
  private lastStage = "";
  private provided = new Set<string>();
  private offFns: (() => void)[] = [];

  constructor() {
    super({ key: "battle" });
  }

  init(opts: BattleOptions) {
    this.room = opts.room;
    this.hud = opts.hud;
    this.controls = opts.controls;
  }

  preload() {
    for (const e of (manifest as any).assets as ManifestEntry[]) {
      if (e.status !== "provided") continue;
      this.provided.add(e.id);
      if (e.frameWidth) this.load.spritesheet(e.id, `assets/${e.file}`, { frameWidth: e.frameWidth, frameHeight: e.frameHeight ?? e.frameWidth });
      else this.load.image(e.id, `assets/${e.file}`);
    }
    this.load.on("loaderror", (f: any) => {
      // Missing replacement art falls back to procedural placeholders.
      this.provided.delete(f.key);
    });
  }

  create() {
    this.time0 = performance.now();
    this.cameras.main.setBackgroundColor("#07090c");
    this.makeTextures();
    this.drawEnvironment();
    this.tele = this.add.graphics().setDepth(-500);
    this.gates = this.add.graphics().setDepth(-400);
    this.overlay = this.add.graphics().setDepth(100000);
    this.fxLayer = this.add.graphics().setDepth(90000);
    this.markers = this.add.graphics().setDepth(200000);
    this.resize();
    this.scale.on("resize", () => this.resize());

    const st = this.room.state as any;
    const me = st.players?.get(this.room.sessionId);
    if (me) {
      this.pred = { x: me.x, y: me.y, init: true, dash: null };
      this.cameras.main.centerOn(sx(me.x), sy(me.y) - 30);
    }
    this.controls.onAction = (a) => this.sendAction(a);
    this.offFns.push(this.room.onMessage("fx", (list: FxEvent[]) => list.forEach((f) => this.onFx(f))) as any);
    this.offFns.push(this.room.onMessage("deny", () => {}) as any);
    this.events.once("shutdown", () => this.cleanup());
  }

  private cleanup() {
    for (const f of this.offFns) if (typeof f === "function") f();
    this.offFns = [];
  }

  resize() {
    const dpr = this.game.registry.get("dpr") ?? 1;
    const h = this.scale.height / dpr;
    const zoom = (h / 400) * dpr;
    this.cameras.main.setZoom(Math.max(0.5 * dpr, zoom));
  }

  // ---- textures -----------------------------------------------------------------
  private makeTextures() {
    const add = (key: string, c: HTMLCanvasElement) => {
      if (!this.textures.exists(key)) this.textures.addCanvas(key, c);
    };
    for (const kind of Object.keys(ENEMY_FRAME)) {
      const f = ENEMY_FRAME[kind];
      const c = newCanvas(f, f);
      drawEnemy(c.getContext("2d")!, kind);
      add(`enemy.${kind}`, c);
    }
    const sh = newCanvas(64, 24);
    drawShadow(sh.getContext("2d")!, 64, 24);
    add("shadow", sh);
    const pk = newCanvas(48, 48);
    drawPickup(pk.getContext("2d")!);
    add("pickup", pk);
  }

  private charTexture(lineage: LineageId, evo: string, mastery: boolean) {
    const provided = `char.${lineage}.${evo || "base"}`;
    if (this.provided.has(provided) && this.textures.exists(provided)) return provided;
    const key = `proc.${lineage}.${evo}.${mastery ? 1 : 0}`;
    if (!this.textures.exists(key)) {
      const c = newCanvas();
      drawLineage(c.getContext("2d")!, lineage, evo, mastery);
      this.textures.addCanvas(key, c);
    }
    return key;
  }

  private drawEnvironment() {
    const bgId = "env.station_nexus";
    if (this.provided.has(bgId) && this.textures.exists(bgId)) {
      this.add.image(0, sy(0) - 110, bgId).setOrigin(0, 0).setDepth(-2000);
      return;
    }
    const g = this.add.graphics().setDepth(-1000);
    const wallH = 110;
    // Back walls (drawn first), floors, then edge trims.
    for (const r of MAP.walkable) {
      g.fillStyle(0x10151b, 1);
      g.fillRect(sx(r.x), sy(r.y) - wallH, r.w, wallH);
      g.fillStyle(0x161d25, 1);
      for (let x = r.x + 30; x < r.x + r.w - 20; x += 120) g.fillRect(sx(x), sy(r.y) - wallH + 14, 46, wallH - 34);
      g.lineStyle(3, 0x22303b, 1);
      g.lineBetween(sx(r.x), sy(r.y) - wallH + 40, sx(r.x + r.w), sy(r.y) - wallH + 40);
      g.lineStyle(2, 0x2a1830, 0.8);
      g.lineBetween(sx(r.x), sy(r.y) - 18, sx(r.x + r.w), sy(r.y) - 22); // biomass vein
    }
    for (const r of MAP.walkable) {
      g.fillStyle(0x1a2028, 1);
      g.fillRect(sx(r.x), sy(r.y), r.w, r.h * DS);
    }
    g.lineStyle(1, 0x232c36, 1);
    for (const r of MAP.walkable) {
      for (let x = Math.ceil(r.x / 80) * 80; x < r.x + r.w; x += 80) g.lineBetween(sx(x), sy(r.y), sx(x), sy(r.y + r.h));
      for (let y = Math.ceil(r.y / 80) * 80; y < r.y + r.h; y += 80) g.lineBetween(sx(r.x), sy(y), sx(r.x + r.w), sy(y));
    }
    // biomass stains
    const rnd = mulberry(7);
    for (let i = 0; i < 70; i++) {
      const r = MAP.walkable[Math.floor(rnd() * MAP.walkable.length)];
      const x = r.x + rnd() * r.w;
      const y = r.y + rnd() * r.h;
      g.fillStyle(0x2d1630, 0.35 + rnd() * 0.2);
      g.fillEllipse(sx(x), sy(y), 30 + rnd() * 60, (12 + rnd() * 26) * DS * 1.4);
    }
    // stabilizer and extraction pad
    const st = MAP.stabilizer;
    g.fillStyle(0x0f2a2a, 1);
    g.fillEllipse(sx(st.x), sy(st.y), st.activateRadius * 2, st.activateRadius * 2 * DS);
    g.lineStyle(2, 0x2b6f6a, 1);
    g.strokeEllipse(sx(st.x), sy(st.y), st.radius * 2, st.radius * 2 * DS);
    const ex = MAP.extraction;
    g.fillStyle(0x1c2a18, 1);
    g.fillEllipse(sx(ex.x), sy(ex.y), ex.radius * 2, ex.radius * 2 * DS);
    g.lineStyle(2, 0x6a8a3a, 1);
    g.strokeEllipse(sx(ex.x), sy(ex.y), ex.radius * 2, ex.radius * 2 * DS);
    // Stabilizer column (sorted with characters by its base).
    const col = this.add.graphics().setDepth(sy(st.y));
    col.fillStyle(0x24343a, 1);
    col.fillRect(sx(st.x) - 18, sy(st.y) - 70, 36, 70);
    col.fillStyle(0x3fd0c0, 0.9);
    col.fillRect(sx(st.x) - 6, sy(st.y) - 64, 12, 52);
    // Foreground railings (front edge, partially transparent occluders).
    const fg = this.add.graphics().setDepth(50000);
    for (const r of MAP.walkable) {
      if (r.h < 300) continue;
      fg.fillStyle(0x0b0f14, 0.85);
      fg.fillRect(sx(r.x), sy(r.y + r.h), r.w, 26);
      fg.lineStyle(3, 0x27323d, 0.9);
      fg.lineBetween(sx(r.x), sy(r.y + r.h) - 8, sx(r.x + r.w), sy(r.y + r.h) - 8);
      for (let x = r.x + 40; x < r.x + r.w; x += 160) {
        fg.fillStyle(0x151c24, 0.55);
        fg.fillRect(sx(x), sy(r.y + r.h) - 40, 14, 50);
      }
    }
  }

  // ---- input --------------------------------------------------------------------
  private sendAction(a: ActionKind) {
    const me = (this.room.state as any).players?.get(this.room.sessionId);
    if (!me || me.life !== "alive") return;
    let dx = this.controls.state.mx;
    let dy = this.controls.state.my;
    if (Math.hypot(dx, dy) < 0.3) {
      dx = this.facing.x;
      dy = this.facing.y;
    }
    this.room.send("action", { seq: this.seq++, a, dx: clamp1(dx), dy: clamp1(dy) });
    if (a === "dodge" && me.cdDodge <= 0) {
      const l = Math.hypot(dx, dy) || 1;
      this.pred.dash = { dx: dx / l, dy: dy / l, t: 0, dur: PLAYER.dodgeDuration, dist: PLAYER.dodgeDistance };
      sfx("dodge");
    } else if ((a === "skill1" && me.cdS1 <= 0) || (a === "skill2" && me.cdS2 <= 0 && me.hasSkill2)) {
      sfx("skill");
      const v = this.players.get(this.room.sessionId);
      if (v) v.lunge = 1;
    }
  }

  private sendInput(now: number) {
    const s = this.controls.state;
    const n = normalizeInput(s.mx, s.my);
    const changed = Math.abs(n.mx - this.lastSent.mx) > 0.05 || Math.abs(n.my - this.lastSent.my) > 0.05 || s.atk !== this.lastSent.atk;
    if (!changed && now - this.lastSent.at < 50) return;
    if (!changed && now - this.lastSent.at < 100 && n.mx === 0 && n.my === 0 && !s.atk) return;
    const seq = this.seq++;
    this.room.send("input", { seq, mx: round3(n.mx), my: round3(n.my), atk: s.atk, fx: round3(this.facing.x), fy: round3(this.facing.y) });
    this.history.push({ seq, x: this.pred.x, y: this.pred.y });
    if (this.history.length > 120) this.history.shift();
    this.lastSent = { mx: n.mx, my: n.my, atk: s.atk, at: now };
  }

  // ---- main loop --------------------------------------------------------------------
  update(_time: number, deltaMs: number) {
    const dt = Math.min(0.05, deltaMs / 1000);
    const now = performance.now();
    const st = this.room.state as any;
    if (!st?.players) return;
    const me = st.players.get(this.room.sessionId);
    if (this.hitStop > 0) this.hitStop -= dt;

    // Local prediction for our own movement.
    if (me) {
      const s = this.controls.state;
      if (Math.hypot(s.mx, s.my) > 0.2) {
        const l = Math.hypot(s.mx, s.my);
        this.facing = { x: s.mx / l, y: s.my / l };
      }
      if (me.life === "alive") {
        this.predict(me, dt);
        this.sendInput(now);
        this.localCombo(me, dt);
      } else {
        this.pred.x = me.x;
        this.pred.y = me.y;
        this.pred.dash = null;
        this.history = [];
        if (this.lastSent.atk || this.lastSent.mx || this.lastSent.my) this.sendInput(now);
      }
    }

    this.syncPlayers(st, dt);
    this.syncEnemies(st, dt);
    this.syncPickups(st, now);
    this.drawTelegraphs(st, now);
    this.drawOverlay(st);
    this.drawGates(st);
    this.updateTransients(dt);
    this.updateCamera(me, dt);
    this.drawMarkers(st, me);
    this.updateHud(st, me);
  }

  private predict(me: any, dt: number) {
    if (!this.pred.init) {
      this.pred = { x: me.x, y: me.y, init: true, dash: null };
    }
    const lin = LINEAGE_SPECS[me.lineage as LineageId] ?? LINEAGE_SPECS.pyra;
    let speed = PLAYER.moveSpeed * lin.speedMult * (me.odT > 0 ? lin.overdrive.speedMult : 1);
    if (me.act === "windup" || me.act === "brace") speed *= 0.35;
    else if (this.controls.state.atk) speed *= 0.6;
    const maxX = this.room.state.maxX || MAP.width;
    if (this.pred.dash) {
      const d = this.pred.dash;
      const step = Math.min(dt, d.dur - d.t);
      const v = d.dist / d.dur;
      const m = stepMovement(this.pred.x, this.pred.y, { mx: d.dx, my: d.dy }, v, step, maxX);
      this.pred.x = m.x;
      this.pred.y = m.y;
      d.t += dt;
      if (d.t >= d.dur) this.pred.dash = null;
    } else {
      const n = normalizeInput(this.controls.state.mx, this.controls.state.my);
      const m = stepMovement(this.pred.x, this.pred.y, n, speed, dt, maxX);
      this.pred.x = m.x;
      this.pred.y = m.y;
    }
    // Reconcile against the authoritative position for the acknowledged input.
    const ack = me.ack as number;
    while (this.history.length && this.history[0].seq <= ack) this.history.shift();
    const ref = this.history.length ? this.history[0] : { x: this.pred.x, y: this.pred.y };
    const ex = me.x - ref.x;
    const ey = me.y - ref.y;
    const err = Math.hypot(ex, ey);
    if (err > 220) {
      this.pred.x = me.x;
      this.pred.y = me.y;
      this.history = [];
      this.corr = { x: 0, y: 0 };
    } else if (err > 2) {
      this.corr.x = ex;
      this.corr.y = ey;
    }
    const k = Math.min(1, dt * 10);
    const cx = this.corr.x * k;
    const cy = this.corr.y * k;
    this.pred.x += cx;
    this.pred.y += cy;
    for (const h of this.history) {
      h.x += cx;
      h.y += cy;
    }
    this.corr.x -= cx;
    this.corr.y -= cy;
  }

  /** Immediate local feedback for the held combo; the server confirms hits. */
  private localCombo(me: any, dt: number) {
    const lin = LINEAGE_SPECS[me.lineage as LineageId] ?? LINEAGE_SPECS.pyra;
    const L = this.localSwing;
    L.timer -= dt;
    if (this.controls.state.atk) {
      L.idle = 0;
      if (L.timer <= 0 && !this.pred.dash) {
        const spec = lin.combo.hits[L.step];
        this.swingFx(this.pred.x, this.pred.y, Math.atan2(this.facing.y, this.facing.x), spec.range, spec.arcDeg ?? 90, me.lineage, L.step);
        const v = this.players.get(this.room.sessionId);
        if (v) v.lunge = 1;
        sfx("swing");
        L.timer = lin.combo.interval[L.step];
        L.step = (L.step + 1) % 3;
      }
    } else {
      L.idle += dt;
      if (L.idle > lin.combo.resetAfter) L.step = 0;
    }
  }

  // ---- entity sync ----------------------------------------------------------------
  private syncPlayers(st: any, dt: number) {
    const seen = new Set<string>();
    const tnow = (performance.now() - this.time0) / 1000;
    st.players.forEach((p: any, id: string) => {
      seen.add(id);
      if (p.life === "departed") {
        this.removePlayer(id);
        return;
      }
      let v = this.players.get(id);
      const key = this.charTexture(p.lineage, p.evolution, p.mastery);
      if (!v) {
        const shadow = this.add.image(0, 0, "shadow").setDisplaySize(52, 18);
        const body = this.add.image(0, 0, key).setOrigin(FEET.x / FRAME, FEET.y / FRAME);
        body.setScale(0.62);
        const label = this.add.text(0, 0, p.name, { fontFamily: "system-ui, sans-serif", fontSize: "13px", color: LINEAGE_COLORS[p.lineage as LineageId]?.glow ?? "#fff", stroke: "#000", strokeThickness: 3 }).setOrigin(0.5, 1);
        v = { body, shadow, label, dx: p.x, dy: p.y, texKey: key, lunge: 0, hitFlash: 0, aura: 0 };
        this.players.set(id, v);
      }
      if (v.texKey !== key) {
        v.body.setTexture(key);
        v.texKey = key;
      }
      const isMe = id === this.room.sessionId;
      if (isMe && p.life === "alive") {
        v.dx = this.pred.x;
        v.dy = this.pred.y;
      } else {
        const k = Math.min(1, dt * 12);
        v.dx += (p.x - v.dx) * k;
        v.dy += (p.y - v.dy) * k;
        if (Math.hypot(p.x - v.dx, p.y - v.dy) > 300) {
          v.dx = p.x;
          v.dy = p.y;
        }
      }
      const fx = isMe ? this.facing.x : p.fx;
      const moving = isMe ? Math.hypot(this.controls.state.mx, this.controls.state.my) > 0.2 : false;
      v.lunge = Math.max(0, v.lunge - dt * 6);
      v.hitFlash = Math.max(0, v.hitFlash - dt * 6);
      const bob = p.life === "alive" ? Math.sin(tnow * (moving ? 12 : 3) + id.length) * (moving ? 0.04 : 0.02) : 0;
      const lungeX = (fx >= 0 ? 1 : -1) * v.lunge * 8;
      v.body.setPosition(sx(v.dx) + lungeX, sy(v.dy));
      v.body.setFlipX(fx < 0);
      v.body.setScale(0.62 * (1 - bob * 0.5), 0.62 * (1 + bob));
      v.body.setRotation(p.life === "downed" || p.life === "waiting" ? (fx < 0 ? -1.3 : 1.3) : (moving ? 0.06 * Math.sign(fx || 1) : 0));
      v.body.setAlpha(p.life === "waiting" ? 0.25 : p.connected ? (p.act === "dash" ? 0.6 : 1) : 0.5);
      if (v.hitFlash > 0) v.body.setTint(0xff8888);
      else if (p.odT > 0) v.body.setTint(LINEAGE_COLORS[p.lineage as LineageId]?.glowHex ?? 0xffffff);
      else v.body.clearTint();
      v.body.setDepth(sy(v.dy));
      v.shadow.setPosition(sx(v.dx), sy(v.dy) + 1).setDepth(sy(v.dy) - 1);
      v.label.setPosition(sx(v.dx), sy(v.dy) - 82).setDepth(sy(v.dy) + 1);
      v.label.setVisible(!isMe || p.life !== "alive");
    });
    for (const id of [...this.players.keys()]) if (!seen.has(id)) this.removePlayer(id);
  }

  private removePlayer(id: string) {
    const v = this.players.get(id);
    if (!v) return;
    v.body.destroy();
    v.shadow.destroy();
    v.label.destroy();
    this.players.delete(id);
  }

  private syncEnemies(st: any, dt: number) {
    const seen = new Set<string>();
    st.enemies.forEach((e: any, id: string) => {
      seen.add(id);
      let v = this.enemies.get(id);
      if (!v) {
        const f = ENEMY_FRAME[e.kind] ?? 96;
        const feet = enemyFeet(e.kind);
        const provided = `enemy.${e.kind}.provided`;
        const key = this.provided.has(provided) ? provided : `enemy.${e.kind}`;
        const scale = e.kind === "boss" ? 0.75 : e.kind === "armored" ? 0.62 : 0.66;
        const shadow = this.add.image(0, 0, "shadow").setDisplaySize(f * scale * 0.7, f * scale * 0.22);
        const body = this.add.image(0, 0, key).setOrigin(feet.x / f, feet.y / f).setScale(scale);
        v = { body, shadow, dx: e.x, dy: e.y, flash: 0, kind: e.kind };
        this.enemies.set(id, v);
      }
      const k = Math.min(1, dt * 12);
      v.dx += (e.x - v.dx) * k;
      v.dy += (e.y - v.dy) * k;
      v.flash = Math.max(0, v.flash - dt * 8);
      const wobble = e.state === "windup" ? Math.sin(performance.now() / 40) * 2 : 0;
      v.body.setPosition(sx(v.dx) + wobble, sy(v.dy));
      v.body.setFlipX(e.fx < 0);
      v.body.setDepth(sy(v.dy));
      v.shadow.setPosition(sx(v.dx), sy(v.dy) + 1).setDepth(sy(v.dy) - 1);
      if (v.flash > 0) v.body.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
      else if (e.state === "windup" || e.state === "channel") v.body.setTint(0xffb0b0).setTintMode(Phaser.TintModes.MULTIPLY);
      else if (e.state === "stagger") v.body.setTint(0xaab4ff).setTintMode(Phaser.TintModes.MULTIPLY);
      else if (e.chill > 0) v.body.setTint(0xbfefff).setTintMode(Phaser.TintModes.MULTIPLY);
      else v.body.clearTint().setTintMode(Phaser.TintModes.MULTIPLY);
    });
    for (const [id, v] of this.enemies) {
      if (!seen.has(id)) {
        v.body.destroy();
        v.shadow.destroy();
        this.enemies.delete(id);
      }
    }
  }

  private syncPickups(st: any, now: number) {
    const seen = new Set<string>();
    st.pickups.forEach((k: any, id: string) => {
      seen.add(id);
      let img = this.pickups.get(id);
      if (!img) {
        img = this.add.image(sx(k.x), sy(k.y), "pickup").setScale(0.8);
        this.pickups.set(id, img);
      }
      img.setPosition(sx(k.x), sy(k.y) - 10 - Math.sin(now / 250) * 4).setDepth(sy(k.y));
    });
    for (const [id, img] of this.pickups) {
      if (!seen.has(id)) {
        img.destroy();
        this.pickups.delete(id);
      }
    }
  }

  // ---- drawing ------------------------------------------------------------------------
  private drawTelegraphs(st: any, now: number) {
    const g = this.tele;
    g.clear();
    const pulse = 0.5 + 0.5 * Math.sin(now / 90);
    st.hazards.forEach((h: any) => {
      const x = sx(h.x);
      const y = sy(h.y);
      if (h.kind === "shot") {
        g.fillStyle(0xd7ff6a, 1);
        g.fillCircle(x, y - 18, 6);
        g.fillStyle(0xd7ff6a, 0.3);
        g.fillEllipse(x, y, 16, 8);
        return;
      }
      const rx = h.r;
      const ry = h.r * DS;
      if (h.side === "enemy") {
        if (h.delay > 0) {
          g.lineStyle(2, 0xff4a4a, 0.9);
          g.strokeEllipse(x, y, rx * 2, ry * 2);
          const total = h.kind === "pool" ? 1.2 : 1.25;
          const fill = 1 - Math.min(1, h.delay / total);
          g.fillStyle(0xff3030, 0.15 + 0.25 * fill);
          g.fillEllipse(x, y, rx * 2 * fill, ry * 2 * fill);
        } else if (h.kind === "pool") {
          g.fillStyle(0x6a2a70, 0.55);
          g.fillEllipse(x, y, rx * 2, ry * 2);
          g.lineStyle(2, 0xc060ff, 0.5 + 0.3 * pulse);
          g.strokeEllipse(x, y, rx * 2, ry * 2);
        }
      } else {
        const color = h.kind === "frost" ? 0x8ff3ff : 0xffad4a;
        if (h.kind === "aftershock") {
          g.lineStyle(3, 0xe0b85a, 0.6 + 0.4 * pulse);
          g.strokeEllipse(x, y, rx * 2, ry * 2);
        } else {
          g.fillStyle(color, settings.reducedEffects ? 0.12 : 0.18);
          g.fillEllipse(x, y, rx * 2, ry * 2);
        }
      }
    });
    st.enemies.forEach((e: any) => {
      if (e.state === "channel") {
        g.lineStyle(3, 0xc8a2ff, 0.5 + 0.5 * pulse);
        g.strokeEllipse(sx(e.x), sy(e.y), 70, 70 * DS);
        return;
      }
      if (e.state !== "windup") return;
      const x = sx(e.x);
      const y = sy(e.y);
      g.fillStyle(0xff3a3a, 0.18 + 0.2 * pulse);
      g.lineStyle(2, 0xff5050, 0.8);
      if (e.atk === "shot") {
        const len = 320;
        const ex = e.x + Math.cos(e.ang) * len;
        const ey = e.y + Math.sin(e.ang) * len;
        g.lineStyle(3, 0xd7ff6a, 0.35 + 0.4 * pulse);
        g.lineBetween(x, y - 18, sx(ex), sy(ey) - 18);
      } else if (e.atk === "slam") {
        const cx = e.x + Math.cos(e.ang) * 45;
        const cy = e.y + Math.sin(e.ang) * 45;
        g.fillEllipse(sx(cx), sy(cy), 124, 124 * DS);
        g.strokeEllipse(sx(cx), sy(cy), 124, 124 * DS);
      } else if (e.atk === "melee" || e.atk === "sweep") {
        const r = e.atk === "sweep" ? 170 : 60;
        const arc = (e.atk === "sweep" ? 150 : 110) * (Math.PI / 180);
        wedge(g, e.x, e.y, r, e.ang, arc);
      }
    });
  }

  private drawOverlay(st: any) {
    const g = this.overlay;
    g.clear();
    st.enemies.forEach((e: any, id: string) => {
      const v = this.enemies.get(id);
      if (!v || e.kind === "boss") return;
      const x = sx(v.dx);
      const top = sy(v.dy) - (e.kind === "armored" ? 78 : e.kind === "ranged" ? 62 : 50);
      const w = e.kind === "armored" ? 44 : 32;
      if (e.hp < e.maxHp) {
        g.fillStyle(0x000000, 0.6);
        g.fillRect(x - w / 2 - 1, top - 1, w + 2, 6);
        g.fillStyle(0xd94a4a, 1);
        g.fillRect(x - w / 2, top, (w * e.hp) / e.maxHp, 4);
      }
      for (let i = 0; i < e.heat; i++) {
        g.fillStyle(0xffad4a, 1);
        g.fillTriangle(x - 10 + i * 10, top - 4, x - 14 + i * 10, top - 12, x - 6 + i * 10, top - 12);
      }
      for (let i = 0; i < e.chill; i++) {
        g.fillStyle(0x8ff3ff, 1);
        g.fillRect(x - 12 + i * 6, top - 10, 4, 4);
      }
      if (e.broken) {
        g.lineStyle(2, 0xe0b85a, 1);
        g.strokeRect(x + w / 2 + 3, top - 3, 7, 7);
      }
    });
    st.players.forEach((p: any, id: string) => {
      const v = this.players.get(id);
      if (!v || p.life === "departed") return;
      const x = sx(v.dx);
      const y = sy(v.dy);
      const isMe = id === this.room.sessionId;
      if (!isMe && p.life === "alive") {
        g.fillStyle(0x000000, 0.6);
        g.fillRect(x - 18, y - 76, 36, 5);
        g.fillStyle(0x6ee06e, 1);
        g.fillRect(x - 17, y - 75, (34 * Math.max(0, p.hp)) / Math.max(1, p.maxHp), 3);
      }
      if (p.shield > 0) {
        g.lineStyle(2, 0xbfe6ff, 0.7);
        g.strokeEllipse(x, y - 30, 56, 70);
      }
      if (p.odT > 0) {
        g.lineStyle(3, LINEAGE_COLORS[p.lineage as LineageId]?.glowHex ?? 0xffffff, 0.5 + 0.3 * Math.sin(performance.now() / 80));
        g.strokeEllipse(x, y, 70, 70 * DS);
      }
      if (p.act === "brace") {
        g.lineStyle(4, 0xe0b85a, 0.9);
        g.strokeEllipse(x, y - 30, 64, 80);
      }
      if (p.empower > 0) {
        g.fillStyle(0xd9ffe9, 0.9);
        g.fillCircle(x, y - 88, 4);
      }
      if (p.life === "downed") {
        g.lineStyle(3, 0x333333, 0.8);
        g.strokeCircle(x, y - 40, 16);
        g.lineStyle(3, 0x6ee06e, 1);
        g.beginPath();
        g.arc(x, y - 40, 16, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p.revive, false);
        g.strokePath();
        g.fillStyle(0x6ee06e, 1);
        g.fillRect(x - 2, y - 47, 4, 14);
        g.fillRect(x - 7, y - 42, 14, 4);
      }
    });
  }

  private drawGates(st: any) {
    const g = this.gates;
    g.clear();
    const maxX = st.maxX;
    if (!maxX || maxX >= MAP.width - 10) return;
    const a = 0.5 + 0.3 * Math.sin(performance.now() / 150);
    g.lineStyle(3, 0x5ad1ff, a);
    for (let i = 0; i < 4; i++) {
      const x = sx(maxX) - 6 + i * 4;
      g.lineBetween(x, sy(200) - 60, x, sy(400));
    }
  }

  private drawMarkers(st: any, me: any) {
    const g = this.markers;
    g.clear();
    if (!me) return;
    const cam = this.cameras.main;
    const view = cam.worldView;
    const pad = 14 / cam.zoom * (this.game.registry.get("dpr") ?? 1);
    const cx = view.centerX;
    const cy = view.centerY;
    st.players.forEach((p: any, id: string) => {
      if (id === this.room.sessionId || p.life === "departed") return;
      const v = this.players.get(id);
      if (!v) return;
      const x = sx(v.dx);
      const y = sy(v.dy) - 30;
      if (view.contains(x, y)) return;
      const mx = Math.max(view.x + pad, Math.min(view.right - pad, x));
      const my = Math.max(view.y + pad * 4, Math.min(view.bottom - pad, y));
      const ang = Math.atan2(y - cy, x - cx);
      const color = LINEAGE_COLORS[p.lineage as LineageId]?.glowHex ?? 0xffffff;
      g.fillStyle(color, p.life === "downed" ? 1 : 0.7);
      const s = pad * 0.8;
      g.fillTriangle(mx + Math.cos(ang) * s, my + Math.sin(ang) * s, mx + Math.cos(ang + 2.4) * s, my + Math.sin(ang + 2.4) * s, mx + Math.cos(ang - 2.4) * s, my + Math.sin(ang - 2.4) * s);
    });
  }

  private updateCamera(me: any, dt: number) {
    const cam = this.cameras.main;
    const v = me ? this.players.get(this.room.sessionId) : null;
    if (!v) return;
    const tx = sx(v.dx);
    const ty = sy(v.dy) - 40;
    const cur = { x: cam.midPoint.x, y: cam.midPoint.y };
    const k = Math.min(1, dt * 6);
    let nx = cur.x + (tx - cur.x) * k;
    let ny = cur.y + (ty - cur.y) * k;
    const halfW = cam.width / cam.zoom / 2;
    const halfH = cam.height / cam.zoom / 2;
    nx = Math.max(halfW - 40, Math.min(MAP.width + 40 - halfW, nx));
    ny = Math.max(sy(0) - 130 + halfH, Math.min(sy(MAP.height) + 40 - halfH, ny));
    if (halfH * 2 > sy(MAP.height) + 170) ny = sy(MAP.height) / 2 - 40;
    cam.centerOn(nx, ny);
    this.shakeCooldown = Math.max(0, this.shakeCooldown - dt);
  }

  private updateHud(st: any, me: any) {
    if (me) {
      this.hud.updateSelf({ name: me.name, lineage: me.lineage, level: me.level, hp: me.hp, maxHp: me.maxHp, shield: me.shield, od: me.od, odT: me.odT, hasOverdrive: me.hasOverdrive, mastery: me.mastery });
      this.hud.downed(me.life === "alive" ? null : { life: me.life, downT: me.downT, revive: me.revive });
      const alive = me.life === "alive";
      this.controls.setButton("dodge", { ratio: me.cdDodge / PLAYER.dodgeCooldown, enabled: alive });
      this.controls.setButton("skill1", { ratio: me.cdS1 / Math.max(0.1, me.maxS1), enabled: alive });
      this.controls.setButton("skill2", { ratio: me.cdS2 / Math.max(0.1, me.maxS2), enabled: alive && me.hasSkill2, visible: me.hasSkill2 });
      this.controls.setButton("overdrive", { ratio: 1 - me.od / OVERDRIVE.max, enabled: alive && me.od >= OVERDRIVE.max, ready: me.od >= OVERDRIVE.max || me.odT > 0, visible: me.hasOverdrive });
      this.controls.setTheme(LINEAGE_COLORS[me.lineage as LineageId]?.glow ?? "#fff");
    }
    const boss = st.bossId ? st.enemies.get(st.bossId) : null;
    this.hud.updateObjective(st.stage, st.objective, boss ? { hp: boss.hp, maxHp: boss.maxHp, stagger: boss.stagger } : null);
    const team: any[] = [];
    st.players.forEach((p: any, id: string) => {
      if (id !== this.room.sessionId) team.push({ id, name: p.name, lineage: p.lineage, hp: p.hp, maxHp: p.maxHp, life: p.life, connected: p.connected });
    });
    this.hud.updateTeam(team);
    if (st.stage !== this.lastStage) {
      this.lastStage = st.stage;
    }
  }

  // ---- effects ------------------------------------------------------------------------
  private addTransient(life: number, draw: (g: Phaser.GameObjects.Graphics, k: number) => void, depth = 80000) {
    if (settings.reducedEffects && this.transient.length > 40) return;
    const g = this.add.graphics().setDepth(depth);
    this.transient.push({ g, life, max: life, draw });
  }

  private updateTransients(dt: number) {
    for (let i = this.transient.length - 1; i >= 0; i--) {
      const tr = this.transient[i];
      tr.life -= dt;
      if (tr.life <= 0) {
        tr.g.destroy();
        this.transient.splice(i, 1);
        continue;
      }
      tr.g.clear();
      tr.draw(tr.g, 1 - tr.life / tr.max);
    }
    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const n = this.numbers[i];
      n.life -= dt;
      n.txt.y -= n.vy * dt;
      n.txt.setAlpha(Math.min(1, n.life * 2));
      if (n.life <= 0) {
        n.txt.setVisible(false);
        this.numberPool.push(n.txt);
        this.numbers.splice(i, 1);
      }
    }
  }

  private damageNumber(x: number, y: number, value: number, color: string) {
    if (settings.reducedEffects && this.numbers.length > 12) return;
    let txt = this.numberPool.pop();
    if (!txt) txt = this.add.text(0, 0, "", { fontFamily: "system-ui, sans-serif", fontSize: "16px", fontStyle: "bold", stroke: "#000", strokeThickness: 3 }).setOrigin(0.5);
    txt.setText(String(value)).setColor(color).setPosition(sx(x) + (Math.random() - 0.5) * 16, sy(y) - 60).setVisible(true).setAlpha(1).setDepth(150000);
    this.numbers.push({ txt, life: 0.7, vy: 50 });
  }

  private swingFx(x: number, y: number, ang: number, range: number, arcDeg: number, lineage: string, step: number) {
    const color = LINEAGE_COLORS[lineage as LineageId]?.glowHex ?? 0xffffff;
    const arc = (arcDeg * Math.PI) / 180;
    this.addTransient(0.18, (g, k) => {
      g.setBlendMode(Phaser.BlendModes.ADD);
      g.lineStyle(step === 2 ? 7 : 5, color, 1 - k * 0.8);
      const r = range * (0.7 + 0.3 * k);
      const a0 = ang - arc / 2 + (step % 2 ? arc * 0.1 : -arc * 0.1);
      g.beginPath();
      for (let i = 0; i <= 10; i++) {
        const a = a0 + (arc * i) / 10;
        const px = sx(x + Math.cos(a) * r);
        const py = sy(y + Math.sin(a) * r) - 30;
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.strokePath();
    });
  }

  private onFx(f: FxEvent) {
    const myId = this.room.sessionId;
    switch (f.t) {
      case "swing":
        if (f.id !== myId) {
          this.swingFx(f.x, f.y, f.ang, f.range, f.arc, f.lin, f.step);
          const v = this.players.get(f.id);
          if (v) v.lunge = 1;
        }
        break;
      case "hit": {
        const v = this.enemies.get(f.target);
        if (v) v.flash = 1;
        const mine = f.src === myId;
        this.damageNumber(f.x, f.y, f.dmg, mine ? "#ffffff" : "#b9c4d0");
        if (mine) {
          sfx("hit");
          this.hitStop = 0.05;
        }
        if (!settings.reducedEffects) {
          this.addTransient(0.18, (g, k) => {
            g.fillStyle(0xffffff, 1 - k);
            g.fillCircle(sx(f.x), sy(f.y) - 26, 4 + 10 * k);
          });
        }
        break;
      }
      case "skill":
        this.skillFx(f);
        break;
      case "pdmg":
        if (f.id === myId) {
          this.hud.hurt();
          sfx("hurt");
          if (!settings.reducedMotion && this.shakeCooldown <= 0) {
            this.cameras.main.shake(90, 0.004);
            this.shakeCooldown = 0.25;
          }
        }
        {
          const v = this.players.get(f.id);
          if (v) v.hitFlash = 1;
        }
        break;
      case "down":
        sfx("down");
        if (f.id === myId) this.controls.releaseAll();
        break;
      case "revive":
        sfx("revive");
        break;
      case "death":
        sfx("death");
        this.addTransient(0.45, (g, k) => {
          g.fillStyle(0x7a3a60, 0.6 * (1 - k));
          g.fillEllipse(sx(f.x), sy(f.y), 40 + 50 * k, (40 + 50 * k) * DS);
          g.fillStyle(0xb9ff6a, 0.8 * (1 - k));
          for (let i = 0; i < (settings.reducedEffects ? 3 : 7); i++) {
            const a = i * 0.9;
            g.fillCircle(sx(f.x + Math.cos(a) * 40 * k), sy(f.y + Math.sin(a) * 40 * k) - 20 - 20 * k, 3);
          }
        });
        break;
      case "shield":
        break;
      case "perfect":
        if (f.id === myId) {
          sfx("perfect");
          this.hud.banner("✦", 500);
        }
        break;
      case "od":
        sfx("overdrive");
        break;
      case "section":
        sfx("section");
        this.hud.banner(t("section_done", { n: f.id }), 2600);
        break;
      case "msg":
        if (f.key.startsWith("pickup:")) {
          sfx("pickup");
          break;
        }
        this.hud.banner(t(`msg_${f.key}`), 2400);
        break;
    }
  }

  private skillFx(f: Extract<FxEvent, { t: "skill" }>) {
    const color = LINEAGE_COLORS[f.lin as LineageId]?.glowHex ?? 0xffffff;
    if (f.id !== this.room.sessionId) sfx("skill");
    const x = f.x;
    const y = f.y;
    const ang = f.ang;
    switch (f.skill) {
      case "detonate":
      case "frost_pulse":
      case "shockwave":
        this.addTransient(0.35, (g, k) => {
          g.lineStyle(4, color, 1 - k);
          g.strokeEllipse(sx(x), sy(y), f.range * 2 * k, f.range * 2 * k * DS);
          g.fillStyle(color, 0.15 * (1 - k));
          g.fillEllipse(sx(x), sy(y), f.range * 2 * k, f.range * 2 * k * DS);
        });
        break;
      case "plasma_burst":
      case "dash_cut":
        this.addTransient(0.3, (g, k) => {
          const w = f.skill === "dash_cut" ? 3 : 10;
          g.lineStyle(w * (1 - k) + 1, color, 1 - k);
          g.lineBetween(sx(x), sy(y) - 30, sx(x + Math.cos(ang) * f.range), sy(y + Math.sin(ang) * f.range) - 30);
        });
        break;
      case "shard_cone":
        this.addTransient(0.3, (g, k) => {
          g.fillStyle(color, 0.35 * (1 - k));
          wedge(g, x, y, f.range * (0.6 + 0.4 * k), ang, (50 * Math.PI) / 180, true);
        });
        break;
      case "vortex":
        this.addTransient(0.6, (g, k) => {
          const cx = x + Math.cos(ang) * 60;
          const cy = y + Math.sin(ang) * 60;
          g.lineStyle(3, color, 0.8 * (1 - k));
          for (let i = 0; i < 3; i++) {
            const r = f.range * (1 - k) * (1 - i * 0.25);
            g.strokeEllipse(sx(cx), sy(cy), r * 2, r * 2 * DS);
          }
        });
        break;
      case "brace_counter":
        this.addTransient(0.25, (g, k) => {
          g.fillStyle(color, 0.3 * (1 - k));
          wedge(g, x, y, f.range, ang, (160 * Math.PI) / 180, true);
        });
        break;
    }
  }
}

function wedge(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, ang: number, arc: number, fillOnly = false) {
  g.beginPath();
  g.moveTo(sx(x), sy(y));
  for (let i = 0; i <= 14; i++) {
    const a = ang - arc / 2 + (arc * i) / 14;
    g.lineTo(sx(x + Math.cos(a) * r), sy(y + Math.sin(a) * r));
  }
  g.closePath();
  g.fillPath();
  if (!fillOnly) g.strokePath();
}

function clamp1(v: number) {
  return Math.max(-1, Math.min(1, v));
}
function round3(v: number) {
  return Math.round(v * 1000) / 1000;
}
function mulberry(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
