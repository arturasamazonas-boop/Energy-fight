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
import { t } from "../i18n.ts";
import { settings } from "../settings.ts";
import { ENEMY_FRAME, FEET, FRAME, LINEAGE_COLORS, drawMissingArtwork, drawPickup, drawShadow, newCanvas } from "./art.ts";
import { ILLUSTRATED_ASSETS, ENEMY_DISPLAY_HEIGHT, artworkMetrics, artworkUrl, characterArtworkKey, characterDisplayHeight, normalizeArtwork, rawArtworkKey } from "./artwork.ts";
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
  height: number;
  gait: number;
  motion: number;
}
interface EnemyView {
  body: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  dx: number;
  dy: number;
  flash: number;
  kind: string;
  height: number;
  gait: number;
  motion: number;
}

export interface BattleOptions {
  room: Room;
  hud: Hud;
  controls: Controls;
}

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
  private gatewayViews = new Map<number, Phaser.GameObjects.Image>();
  private hudAccumulator = 0;
  private afterimages: { image: Phaser.GameObjects.Image; life: number }[] = [];
  private partyArtwork = new Set<string>();

  constructor() {
    super({ key: "battle" });
  }

  init(opts: BattleOptions) {
    this.room = opts.room;
    this.hud = opts.hud;
    this.controls = opts.controls;
  }

  preload() {
    // A mission has a fixed roster. Do not download eight unused evolution
    // paintings for a new character's first run on a mobile connection.
    const party = (this.room.state as any).players;
    party?.forEach((player: any) => {
      if (!LINEAGE_SPECS[player.lineage as LineageId]) return;
      this.partyArtwork.add(characterArtworkKey(player.lineage, player.evolution));
      this.partyArtwork.add(characterArtworkKey(player.lineage));
    });
    // Every generated single-pose illustration is loaded as an image, never a
    // spritesheet inferred from the legacy logical frame dimensions.
    for (const asset of ILLUSTRATED_ASSETS) {
      if (asset.key.startsWith("char.") && this.partyArtwork.size && !this.partyArtwork.has(asset.key)) continue;
      if (this.textures.exists(asset.key) || (asset.normalize && artworkMetrics(asset.key))) continue;
      if (asset.normalize) {
        const file = new Phaser.Loader.FileTypes.ImageFile(this.load, { key: rawArtworkKey(asset.key), url: artworkUrl(asset.key) });
        file.addToCache = () => {
          // ImageFile normally uploads the full original into GPU memory here.
          // Upload only the shared 256px display frame, even during loading.
          const art = normalizeArtwork(asset.key, file.data as HTMLImageElement);
          if (!this.textures.exists(asset.key)) this.textures.addCanvas(asset.key, art.canvas);
          file.data = art.canvas;
          this.provided.add(asset.key);
        };
        this.load.addFile(file);
      } else this.load.image(asset.key, artworkUrl(asset.key));
    }
    this.load.on("progress", (progress: number) => this.hud.setLoading(progress));
    this.load.on("loaderror", (file: { key: string }) => {
      this.provided.delete(file.key.replace("illustration.source.", ""));
    });
  }

  create() {
    this.time0 = performance.now();
    this.cameras.main.setBackgroundColor("#171d27");
    this.makeTextures();
    this.drawEnvironment();
    this.tele = this.add.graphics().setDepth(-500);
    this.gates = this.add.graphics().setDepth(-400);
    this.overlay = this.add.graphics().setDepth(100000);
    this.fxLayer = this.add.graphics().setDepth(-350);
    this.hud.setLoading(1);
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
    for (const asset of ILLUSTRATED_ASSETS) {
      if (asset.key.startsWith("char.") && this.partyArtwork.size && !this.partyArtwork.has(asset.key)) continue;
      if (!asset.normalize) {
        if (this.textures.exists(asset.key)) this.provided.add(asset.key);
        continue;
      }
      if (!this.textures.exists(asset.key)) {
        let art = artworkMetrics(asset.key);
        const raw = rawArtworkKey(asset.key);
        if (!art && this.textures.exists(raw)) {
          art = normalizeArtwork(asset.key, this.textures.get(raw).getSourceImage() as HTMLImageElement);
        }
        if (art) this.textures.addCanvas(asset.key, art.canvas);
        // The source PNG is preserved on disk. Release the large GPU source;
        // battlefield sprites share the inexpensive normalized texture.
        if (this.textures.exists(raw)) this.textures.remove(raw);
      }
      if (this.textures.exists(asset.key)) this.provided.add(asset.key);
    }
    const shadow = newCanvas(128, 48);
    drawShadow(shadow.getContext("2d")!, 128, 48);
    if (!this.textures.exists("shadow")) this.textures.addCanvas("shadow", shadow);
    if (!this.textures.exists("pickup")) {
      const pickup = newCanvas(48);
      drawPickup(pickup.getContext("2d")!);
      this.textures.addCanvas("pickup", pickup);
    }
    // A visible loading marker is only used for a failed illustration request.
    for (const lineage of Object.keys(LINEAGE_COLORS) as LineageId[]) {
      const key = `missing.${lineage}`;
      if (this.textures.exists(key)) continue;
      const canvas = newCanvas();
      drawMissingArtwork(canvas.getContext("2d")!, LINEAGE_COLORS[lineage].glow);
      this.textures.addCanvas(key, canvas);
    }
    for (const kind of Object.keys(ENEMY_FRAME)) {
      if (this.textures.exists(`enemy.${kind}.provided`)) continue;
      const canvas = newCanvas();
      drawMissingArtwork(canvas.getContext("2d")!, "#d7a1ac");
      if (!this.textures.exists(`enemy.${kind}`)) this.textures.addCanvas(`enemy.${kind}`, canvas);
    }
  }

  private charTexture(lineage: LineageId, evo: string, _mastery: boolean) {
    const key = characterArtworkKey(lineage, evo);
    if (this.textures.exists(key)) return key;
    const base = characterArtworkKey(lineage);
    return this.textures.exists(base) ? base : `missing.${lineage}`;
  }

  private drawEnvironment() {
    const backdrop = this.textures.exists("env.station_nexus") ? this.textures.get("env.station_nexus").getSourceImage() as HTMLImageElement : null;
    const floor = this.textures.exists("env.floor") ? this.textures.get("env.floor").getSourceImage() as HTMLImageElement : null;
    const materialSize = 368, materialDepth = Math.round(materialSize * DS);
    const tile = newCanvas(materialSize * 2, materialDepth * 2);
    const tileCtx = tile.getContext("2d")!;
    if (floor) {
      // Mirror repeat keeps organic panel lines continuous at every tile edge.
      for (let row = 0; row < 2; row++) for (let column = 0; column < 2; column++) {
        tileCtx.save();
        tileCtx.translate(column ? materialSize * 2 : 0, row ? materialDepth * 2 : 0);
        tileCtx.scale(column ? -1 : 1, row ? -1 : 1);
        tileCtx.drawImage(floor, 0, 0, materialSize, materialDepth);
        tileCtx.restore();
      }
    }
    else { tileCtx.fillStyle = "#3b4850"; tileCtx.fillRect(0, 0, tile.width, tile.height); }
    const edges = walkableEdges();
    const top = -230, height = Math.ceil(sy(MAP.height) + 310);
    // Small baked chunks avoid oversized textures on mobile GPUs. Painting the
    // exact rectangle union makes every pictured floor edge match navigation.
    for (let startX = -128, index = 0; startX < MAP.width + 128; startX += 1024, index++) {
      const width = Math.min(1024, MAP.width + 128 - startX);
      const canvas = newCanvas(width, height);
      const ctx = canvas.getContext("2d")!;
      ctx.translate(-startX, -top);
      ctx.fillStyle = "#121c27"; ctx.fillRect(startX, top, width, height);
      if (backdrop) {
        const scenicWidth = 1780;
        for (let x = -300, n = 0; x < MAP.width + 500; x += scenicWidth, n++) {
          ctx.save();
          ctx.translate(x + (n % 2 ? scenicWidth : 0), 0);
          if (n % 2) ctx.scale(-1, 1);
          drawImageCover(ctx, backdrop, 0, top, scenicWidth, height);
          ctx.restore();
        }
      }
      const mist = ctx.createLinearGradient(0, top, 0, height + top);
      mist.addColorStop(0, "rgba(16,25,37,.12)"); mist.addColorStop(.48, "rgba(17,27,36,.18)"); mist.addColorStop(1, "rgba(6,13,21,.68)");
      ctx.fillStyle = mist; ctx.fillRect(startX, top, width, height);
      // Stone foundation is outside the playable plane; it adds side-on depth.
      for (const edge of edges) {
        if (edge.side !== "front") continue;
        const foundation = ctx.createLinearGradient(0, edge.y1, 0, edge.y1 + 32);
        foundation.addColorStop(0, "#3d413f"); foundation.addColorStop(1, "#111b24");
        ctx.fillStyle = foundation;
        ctx.fillRect(edge.x1, edge.y1, edge.x2 - edge.x1, 32);
        ctx.strokeStyle = "#8f8b72"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(edge.x1, edge.y1 + 4); ctx.lineTo(edge.x2, edge.y2 + 4); ctx.stroke();
      }
      ctx.save();
      ctx.beginPath();
      for (const r of MAP.walkable) ctx.rect(r.x, sy(r.y), r.w, r.h * DS);
      ctx.clip();
      ctx.fillStyle = ctx.createPattern(tile, "repeat")!;
      ctx.fillRect(startX, 0, width, sy(MAP.height));
      const floorLight = ctx.createLinearGradient(0, 0, 0, sy(MAP.height));
      floorLight.addColorStop(0, "rgba(92,125,134,.18)"); floorLight.addColorStop(.55, "rgba(105,120,113,.025)"); floorLight.addColorStop(1, "rgba(16,30,41,.2)");
      ctx.fillStyle = floorLight; ctx.fillRect(startX, 0, width, sy(MAP.height));
      // Subtle inlaid guides run only inside real corridors and rooms.
      ctx.strokeStyle = "rgba(214,188,136,.15)"; ctx.lineWidth = 1;
      for (const r of MAP.walkable) {
        ctx.strokeRect(r.x + 18, sy(r.y) + 12, r.w - 36, r.h * DS - 24);
      }
      ctx.restore();
      // Draw only exterior union edges, never walls across rectangle overlaps.
      for (const edge of edges) {
        ctx.beginPath(); ctx.moveTo(edge.x1, edge.y1); ctx.lineTo(edge.x2, edge.y2);
        ctx.strokeStyle = "rgba(6,14,21,.82)"; ctx.lineWidth = 7; ctx.stroke();
        ctx.strokeStyle = edge.side === "back" ? "#a19c81" : "#b9ac86"; ctx.lineWidth = 1.6; ctx.stroke();
        if (edge.side === "back") {
          ctx.strokeStyle = "rgba(37,51,57,.85)"; ctx.lineWidth = 12;
          ctx.beginPath(); ctx.moveTo(edge.x1, edge.y1 - 10); ctx.lineTo(edge.x2, edge.y2 - 10); ctx.stroke();
          ctx.strokeStyle = "rgba(131,159,156,.45)"; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(edge.x1, edge.y1 - 17); ctx.lineTo(edge.x2, edge.y2 - 17); ctx.stroke();
        }
      }
      const texture = `painted.station.${index}`;
      if (this.textures.exists(texture)) this.textures.remove(texture);
      this.textures.addCanvas(texture, canvas);
      this.add.image(startX, top, texture).setOrigin(0).setDepth(-1000);
    }
    const ground = this.add.graphics().setDepth(-700);
    for (const [index, section] of MAP.sections.entries()) {
      const x = section.arena.x + section.arena.w / 2, y = sy(300);
      ground.lineStyle(1, 0xc1b894, .12);
      ground.strokeEllipse(x, y, 190, 190 * DS);
      ground.strokeEllipse(x, y, 182, 182 * DS);
      const inscription = this.add.text(x, y - 6, ["I", "II", "III"][index], { fontFamily: "Georgia, serif", fontSize: "28px", color: "#c8bb95" }).setOrigin(.5).setAlpha(.2).setDepth(-650);
      inscription.setScale(1, DS);
    }
    const st = MAP.stabilizer, ex = MAP.extraction;
    for (const pad of [{ x: st.x, y: st.y, radius: st.activateRadius, color: 0xa3e7d0 }, { ...ex, color: 0xd4cd97 }]) {
      ground.fillStyle(pad.color, .06); ground.fillEllipse(pad.x, sy(pad.y), pad.radius * 2, pad.radius * 2 * DS);
      ground.lineStyle(1.5, pad.color, .38); ground.strokeEllipse(pad.x, sy(pad.y), pad.radius * 2, pad.radius * 2 * DS);
      ground.lineStyle(1, pad.color, .2); ground.strokeEllipse(pad.x, sy(pad.y), pad.radius * 2 + 10, (pad.radius * 2 + 10) * DS);
    }
    this.addPaintedProp("prop.stabilizer", st.x, st.y, 132);
    for (const x of [1500, 2780]) {
      const gateway = this.addPaintedProp("prop.gateway", x, 386, 178);
      if (gateway) this.gatewayViews.set(x, gateway);
    }
    // These are baked into bounded-size scenery chunks and are no longer drawn
    // directly. Release their extra full-resolution GPU copies after the bake.
    for (const key of ["env.station_nexus", "env.floor"]) if (this.textures.exists(key)) this.textures.remove(key);
  }

  private addPaintedProp(key: string, x: number, y: number, height: number) {
    if (!this.textures.exists(key)) return null;
    const art = artworkMetrics(key);
    const image = this.add.image(sx(x), sy(y), key).setOrigin(FEET.x / FRAME, FEET.y / FRAME);
    image.setScale(height / (art?.bodyHeight ?? 220)).setDepth(sy(y));
    this.add.image(sx(x), sy(y) + 2, "shadow").setDisplaySize(height * .65, height * .17).setDepth(-600);
    return image;
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
    this.drawGroundEffects(st, now);
    this.hudAccumulator += dt;
    if (this.hudAccumulator >= 0.08) { this.updateHud(st, me); this.hudAccumulator = 0; }
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
        this.swingFx(this.pred.x, this.pred.y, Math.atan2(this.facing.y, this.facing.x), spec.range, spec.arcDeg ?? 90, me.lineage, L.step, characterDisplayHeight(me.lineage, me.level, me.evolution) * .48);
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
    st.players.forEach((p: any, id: string) => {
      seen.add(id);
      if (p.life === "departed") { this.removePlayer(id); return; }
      let view = this.players.get(id);
      const key = this.charTexture(p.lineage, p.evolution, p.mastery);
      const height = characterDisplayHeight(p.lineage, p.level, p.evolution);
      if (!view) {
        const shadow = this.add.image(0, 0, "shadow").setDepth(-600);
        const body = this.add.image(0, 0, key).setOrigin(FEET.x / FRAME, FEET.y / FRAME);
        const label = this.add.text(0, 0, p.name, {
          fontFamily: "system-ui, sans-serif", fontSize: "11px", fontStyle: "600",
          color: LINEAGE_COLORS[p.lineage as LineageId]?.glow ?? "#fff", stroke: "#10212a", strokeThickness: 3,
        }).setOrigin(.5, 1);
        const phase = [...id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 13;
        view = { body, shadow, label, dx: p.x, dy: p.y, texKey: key, lunge: 0, hitFlash: 0, aura: 0, height, gait: phase, motion: 0 };
        this.players.set(id, view);
      }
      if (view.texKey !== key) { view.body.setTexture(key); view.texKey = key; }
      const isMe = id === this.room.sessionId;
      const previousX = view.dx, previousY = view.dy;
      if (isMe && p.life === "alive") { view.dx = this.pred.x; view.dy = this.pred.y; }
      else {
        const k = Math.min(1, dt * 12);
        view.dx += (p.x - view.dx) * k; view.dy += (p.y - view.dy) * k;
        if (Math.hypot(p.x - view.dx, p.y - view.dy) > 300) { view.dx = p.x; view.dy = p.y; }
      }
      const fx = isMe ? this.facing.x : p.fx, fy = isMe ? this.facing.y : p.fy;
      const moving = p.life === "alive" && Math.hypot(view.dx - previousX, view.dy - previousY) > dt * 12;
      view.motion += ((moving ? 1 : 0) - view.motion) * Math.min(1, dt * 14);
      view.gait += (isMe && this.hitStop > 0 ? 0 : dt) * (2.2 + view.motion * 10);
      view.aura = Math.max(0, view.aura - dt);
      view.height += (height - view.height) * Math.min(1, dt * 5);
      view.lunge = Math.max(0, view.lunge - dt * 6);
      view.hitFlash = Math.max(0, view.hitFlash - dt * 8);
      const alive = p.life === "alive";
      const motion = settings.reducedMotion || !alive ? 0 : view.motion;
      const breath = settings.reducedMotion || !alive ? 0 : Math.sin(view.gait) * .012;
      const stepLift = Math.abs(Math.sin(view.gait)) * motion * 2;
      const hitPose = Math.sin(view.lunge * Math.PI);
      const scale = view.height / (artworkMetrics(key)?.bodyHeight ?? 220);
      view.body.setPosition(sx(view.dx) + fx * hitPose * 8, sy(view.dy) + fy * hitPose * 5 * DS - stepLift);
      if (fx < -.04) view.body.setFlipX(true); else if (fx > .04) view.body.setFlipX(false);
      view.body.setScale(scale * (1 - breath * .35 + hitPose * .055), scale * (1 + breath - hitPose * .02));
      const direction = view.body.flipX ? -1 : 1;
      view.body.setRotation(!alive ? direction * 1.15 : (direction * motion * .035 + fx * hitPose * .08));
      view.body.setAlpha(p.life === "waiting" ? .24 : p.connected ? (p.act === "dash" ? .63 : 1) : .48);
      if (view.hitFlash > .2) view.body.setTint(0xffb8a8).setTintMode(Phaser.TintModes.MULTIPLY);
      else view.body.clearTint();
      view.body.setDepth(sy(view.dy));
      if ((p.act === "dash" || (isMe && this.pred.dash)) && view.aura <= 0 && !settings.reducedEffects && !settings.reducedMotion) {
        this.addAfterimage(view, LINEAGE_COLORS[p.lineage as LineageId]?.glowHex ?? 0xffffff);
        view.aura = .055;
      }
      view.shadow.setPosition(sx(view.dx), sy(view.dy) + 1).setDisplaySize(view.height * .76, view.height * .24).setAlpha(p.life === "waiting" ? .25 : .84);
      view.label.setText(p.name).setPosition(sx(view.dx), sy(view.dy) - view.height - 10).setDepth(95000);
      view.label.setVisible(!isMe || !alive);
    });
    for (const id of this.players.keys()) if (!seen.has(id)) this.removePlayer(id);
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
    st.enemies.forEach((enemy: any, id: string) => {
      seen.add(id);
      let view = this.enemies.get(id);
      const painted = `enemy.${enemy.kind}.provided`;
      const key = this.textures.exists(painted) ? painted : `enemy.${enemy.kind}`;
      if (!view) {
        const height = ENEMY_DISPLAY_HEIGHT[enemy.kind] ?? 60;
        const shadow = this.add.image(0, 0, "shadow").setDisplaySize(height * .9, height * .27).setDepth(-600);
        const body = this.add.image(0, 0, key).setOrigin(FEET.x / FRAME, FEET.y / FRAME);
        view = { body, shadow, dx: enemy.x, dy: enemy.y, flash: 0, kind: enemy.kind, height, gait: id.length * 1.7, motion: 0 };
        this.enemies.set(id, view);
      }
      const beforeX = view.dx, beforeY = view.dy;
      const k = Math.min(1, dt * 12);
      view.dx += (enemy.x - view.dx) * k; view.dy += (enemy.y - view.dy) * k;
      const moving = Math.hypot(view.dx - beforeX, view.dy - beforeY) > dt * 8;
      view.motion += ((moving ? 1 : 0) - view.motion) * Math.min(1, dt * 12);
      view.gait += dt * (2 + view.motion * (enemy.kind === "boss" ? 5 : 10));
      view.flash = Math.max(0, view.flash - dt * 9);
      const winding = enemy.state === "windup";
      const animate = !settings.reducedMotion;
      const pulse = animate ? Math.sin(view.gait) : 0;
      const wobble = winding && animate ? Math.sin(performance.now() / 42) * 1.4 : 0;
      const hover = enemy.kind === "support" ? 6 + pulse * 2 : animate ? Math.abs(pulse) * view.motion * 1.6 : 0;
      const scale = view.height / (artworkMetrics(painted)?.bodyHeight ?? 220);
      view.body.setPosition(sx(view.dx) + wobble, sy(view.dy) - hover);
      view.body.setScale(scale * (1 + pulse * .013), scale * (1 - pulse * .012));
      if (enemy.fx < -.04) view.body.setFlipX(true); else if (enemy.fx > .04) view.body.setFlipX(false);
      view.body.setRotation(winding ? -.035 * Math.sign(enemy.fx || 1) : pulse * view.motion * .02);
      view.body.setDepth(sy(view.dy));
      view.shadow.setPosition(sx(view.dx), sy(view.dy) + 1).setAlpha(enemy.kind === "support" ? .55 : .9);
      if (view.flash > .15) view.body.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
      else if (winding || enemy.state === "channel") view.body.setTint(0xffc3ba).setTintMode(Phaser.TintModes.MULTIPLY);
      else if (enemy.state === "stagger") view.body.setTint(0xc9d0ff).setTintMode(Phaser.TintModes.MULTIPLY);
      else if (enemy.chill > 0) view.body.setTint(0xcdefff).setTintMode(Phaser.TintModes.MULTIPLY);
      else view.body.clearTint().setTintMode(Phaser.TintModes.MULTIPLY);
    });
    for (const [id, view] of this.enemies) {
      if (!seen.has(id)) { view.body.destroy(); view.shadow.destroy(); this.enemies.delete(id); }
    }
  }

  private syncPickups(st: any, now: number) {
    const seen = new Set<string>();
    st.pickups.forEach((k: any, id: string) => {
      seen.add(id);
      let img = this.pickups.get(id);
      if (!img) {
        const key = this.textures.exists("pickup.biocell") ? "pickup.biocell" : "pickup";
        img = this.add.image(sx(k.x), sy(k.y), key).setOrigin(.5, .7);
        img.setScale(key === "pickup" ? .55 : 25 / (artworkMetrics(key)?.bodyHeight ?? 220));
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
      const top = sy(v.dy) - v.height - (e.kind === "support" ? 12 : 7);
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
        g.fillRect(x - 18, y - v.height - 6, 36, 5);
        g.fillStyle(0x6ee06e, 1);
        g.fillRect(x - 17, y - v.height - 5, (34 * Math.max(0, p.hp)) / Math.max(1, p.maxHp), 3);
      }
      if (p.shield > 0) {
        g.lineStyle(2, 0xbfe6ff, 0.7);
        g.strokeEllipse(x, y - v.height * .48, v.height * .92, v.height * 1.12);
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
        g.fillCircle(x, y - v.height - 18, 3);
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

  private drawGroundEffects(st: any, now: number) {
    const graphics = this.fxLayer;
    graphics.clear();
    st.players.forEach((player: any, id: string) => {
      const view = this.players.get(id);
      if (!view || player.life !== "alive") return;
      const color = LINEAGE_COLORS[player.lineage as LineageId]?.glowHex ?? 0xffffff;
      const x = sx(view.dx), y = sy(view.dy);
      const own = id === this.room.sessionId;
      const radius = own ? Math.max(20, view.height * .34) : 17;
      if (own || player.odT > 0 || player.mastery) {
        graphics.fillStyle(color, player.odT > 0 ? .11 : .04);
        graphics.fillEllipse(x, y, radius * 2.5, radius * 2.5 * DS);
        graphics.lineStyle(own ? 1.3 : 1, color, own ? .62 : .23);
        graphics.strokeEllipse(x, y, radius * 2, radius * 2 * DS);
      }
      if (own) {
        graphics.fillStyle(0xf4eddb, .9);
        graphics.fillTriangle(x - 3, y + radius * DS + 5, x + 3, y + radius * DS + 5, x, y + radius * DS + 2);
      }
      if ((player.odT > 0 || player.mastery) && !settings.reducedEffects) {
        const count = player.odT > 0 ? 5 : 3;
        for (let i = 0; i < count; i++) {
          const a = now / 680 + i * Math.PI * 2 / count;
          graphics.fillStyle(color, .45);
          graphics.fillCircle(x + Math.cos(a) * radius, y + Math.sin(a) * radius * DS, 1.4);
        }
      }
    });
    const stabilizer = MAP.stabilizer;
    if (st.stage === "s2_activate" || st.stage === "s2_defend") {
      graphics.lineStyle(2, 0xa3e7d0, .2 + .12 * Math.sin(now / 420));
      graphics.strokeEllipse(stabilizer.x, sy(stabilizer.y), stabilizer.activateRadius * 2, stabilizer.activateRadius * 2 * DS);
    }
  }

  private drawGates(st: any) {
    for (const [gateX, image] of this.gatewayViews) {
      image.setAlpha(st.maxX > gateX ? .67 : .94);
    }
    const g = this.gates;
    g.clear();
    const maxX = st.maxX;
    if (!maxX || maxX >= MAP.width - 10) return;
    const corridor = MAP.walkable.find((r) => r.h <= 200 && maxX >= r.x && maxX <= r.x + r.w);
    const near = sy((corridor?.y ?? 220) + (corridor?.h ?? 160));
    const far = sy(corridor?.y ?? 220);
    const pulse = .55 + .2 * Math.sin(performance.now() / 240);
    g.lineStyle(9, 0x85dcd4, pulse * .12);
    g.lineBetween(maxX, far - 30, maxX, near);
    g.lineStyle(2, 0xb6e9d7, pulse);
    g.lineBetween(maxX, far - 30, maxX, near);
    g.lineStyle(1, 0xf0e1b6, pulse * .45);
    g.lineBetween(maxX - 4, far - 30, maxX - 4, near);
    for (let i = 0; i < 5; i++) {
      const y = far - 20 + i * (near - far + 20) / 5;
      g.fillStyle(0xb6e9d7, pulse * .6);
      diamond(g, maxX, y, 2, 4);
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
      this.hud.updateSelf({ name: me.name, lineage: me.lineage, evolution: me.evolution, level: me.level, hp: me.hp, maxHp: me.maxHp, shield: me.shield, od: me.od, odT: me.odT, hasOverdrive: me.hasOverdrive, mastery: me.mastery });
      this.hud.downed(me.life === "alive" ? null : { life: me.life, downT: me.downT, revive: me.revive });
      const alive = me.life === "alive";
      this.controls.setButton("dodge", { ratio: me.cdDodge / PLAYER.dodgeCooldown, enabled: alive });
      this.controls.setButton("skill1", { ratio: me.cdS1 / Math.max(0.1, me.maxS1), enabled: alive });
      this.controls.setButton("skill2", { ratio: me.cdS2 / Math.max(0.1, me.maxS2), enabled: alive && me.hasSkill2, visible: me.hasSkill2 });
      this.controls.setButton("overdrive", { ratio: 1 - me.od / OVERDRIVE.max, enabled: alive && me.od >= OVERDRIVE.max, ready: me.od >= OVERDRIVE.max || me.odT > 0, visible: me.hasOverdrive });
      this.controls.setTheme(LINEAGE_COLORS[me.lineage as LineageId]?.glow ?? "#fff", me.lineage);
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
  private addAfterimage(view: PlayerView, color: number) {
    if (this.afterimages.length >= 24) return;
    const source = view.body;
    const image = this.add.image(source.x, source.y, view.texKey).setOrigin(source.originX, source.originY)
      .setScale(source.scaleX, source.scaleY).setFlipX(source.flipX).setRotation(source.rotation)
      .setTint(color).setAlpha(.28).setBlendMode(Phaser.BlendModes.ADD).setDepth(source.depth - .2);
    this.afterimages.push({ image, life: .2 });
  }

  private addTransient(life: number, draw: (g: Phaser.GameObjects.Graphics, k: number) => void, depth = 80000) {
    if (this.transient.length >= (settings.reducedEffects ? 28 : 96)) return;
    const g = this.add.graphics().setDepth(depth);
    this.transient.push({ g, life, max: life, draw });
  }

  private updateTransients(dt: number) {
    for (let i = this.afterimages.length - 1; i >= 0; i--) {
      const trail = this.afterimages[i];
      trail.life -= dt;
      if (trail.life <= 0) { trail.image.destroy(); this.afterimages.splice(i, 1); }
      else trail.image.setAlpha(trail.life * 1.3);
    }
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
    if (this.numbers.length >= (settings.reducedEffects ? 12 : 56)) return;
    let txt = this.numberPool.pop();
    if (!txt) txt = this.add.text(0, 0, "", { fontFamily: "system-ui, sans-serif", fontSize: "16px", fontStyle: "bold", stroke: "#000", strokeThickness: 3 }).setOrigin(0.5);
    txt.setText(String(value)).setColor(color).setPosition(sx(x) + (Math.random() - 0.5) * 16, sy(y) - 60).setVisible(true).setAlpha(1).setDepth(150000);
    this.numbers.push({ txt, life: 0.7, vy: 50 });
  }

  private swingFx(x: number, y: number, ang: number, range: number, arcDeg: number, lineage: string, step: number, elevation = 28) {
    const color = LINEAGE_COLORS[lineage as LineageId]?.glowHex ?? 0xffffff;
    const arc = (arcDeg * Math.PI) / 180;
    const heavy = step === 2;
    this.addTransient(heavy ? .27 : .22, (graphics, progress) => {
      const fade = (1 - progress) ** 1.3;
      const radius = range * (.68 + .32 * Math.sqrt(progress));
      const start = ang - arc / 2 + (step % 2 ? .07 : -.07);
      graphics.setBlendMode(Phaser.BlendModes.ADD);
      crescent(graphics, x, y, radius, start, arc, heavy ? 17 : 11, elevation, color, fade * .15);
      crescent(graphics, x, y, radius, start, arc, heavy ? 8 : 5, elevation, color, fade * .78);
      crescent(graphics, x, y, radius + 1, start + arc * .08, arc * .84, 1.6, elevation, 0xfff5db, fade * .9);
      if (settings.reducedEffects) return;
      const count = heavy ? 8 : 5;
      for (let i = 0; i < count; i++) {
        const a = start + arc * ((i + .5) / count);
        const reach = radius + progress * (8 + i * 2);
        const px = sx(x + Math.cos(a) * reach), py = sy(y + Math.sin(a) * reach) - elevation - progress * (4 + i);
        graphics.fillStyle(i % 3 ? color : 0xffffff, fade * .75);
        if (lineage === "krios") diamond(graphics, px, py, 2.5 * fade + .5, 5 * fade + 1);
        else if (lineage === "litos") graphics.fillRect(px, py, 2.5 * fade + 1, 2.5 * fade + 1);
        else {
          graphics.fillCircle(px, py, 1.5 * fade + .4);
          if (lineage === "vektor") {
            graphics.lineStyle(1, color, fade * .45);
            graphics.lineBetween(px, py, px - Math.cos(a) * 10, py - Math.sin(a) * 6);
          }
        }
      }
    });
    if (heavy && lineage === "litos") {
      this.addTransient(.3, (graphics, progress) => {
        graphics.lineStyle(1.7, color, .6 * (1 - progress));
        graphics.strokeEllipse(x + Math.cos(ang) * range * .6, sy(y + Math.sin(ang) * range * .6), 12 + progress * 72, (12 + progress * 72) * DS);
      }, -300);
    }
  }

  private onFx(f: FxEvent) {
    const myId = this.room.sessionId;
    switch (f.t) {
      case "swing":
        if (f.id !== myId) {
          this.swingFx(f.x, f.y, f.ang, f.range, f.arc, f.lin, f.step, (this.players.get(f.id)?.height ?? 58) * .48);
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
          const source = (this.room.state as any).players?.get(f.src);
          const color = LINEAGE_COLORS[source?.lineage as LineageId]?.glowHex ?? 0xd4e7c4;
          const lift = (this.enemies.get(f.target)?.height ?? 56) * .47;
          this.addTransient(.24, (graphics, progress) => {
            graphics.setBlendMode(Phaser.BlendModes.ADD);
            const fade = 1 - progress;
            graphics.fillStyle(color, fade * .2);
            graphics.fillCircle(sx(f.x), sy(f.y) - lift, 4 + 17 * progress);
            graphics.fillStyle(0xfff7e4, fade);
            diamond(graphics, sx(f.x), sy(f.y) - lift, 2 + fade * 4, 2 + fade * 8);
            graphics.lineStyle(1.5, color, fade);
            for (let i = 0; i < 7; i++) {
              const a = i * Math.PI * 2 / 7 + f.x * .13;
              const distance = 4 + progress * (15 + i * 2);
              graphics.lineBetween(sx(f.x) + Math.cos(a) * distance, sy(f.y) - lift + Math.sin(a) * distance * .7, sx(f.x) + Math.cos(a) * (distance + 6 * fade), sy(f.y) - lift + Math.sin(a) * (distance + 6 * fade) * .7);
            }
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

  private skillFx(event: Extract<FxEvent, { t: "skill" }>) {
    const color = LINEAGE_COLORS[event.lin as LineageId]?.glowHex ?? 0xffffff;
    if (event.id !== this.room.sessionId) sfx("skill");
    const { x, y, ang: angle, range } = event;
    const elevation = (this.players.get(event.id)?.height ?? 58) * .48;
    const particles = settings.reducedEffects ? 4 : 10;
    switch (event.skill) {
      case "detonate":
      case "frost_pulse":
      case "shockwave":
        this.addTransient(.52, (graphics, progress) => {
          const reach = range * Math.sqrt(progress), fade = 1 - progress;
          graphics.setBlendMode(Phaser.BlendModes.ADD);
          graphics.fillStyle(color, fade * .07);
          graphics.fillEllipse(x, sy(y), reach * 2, reach * 2 * DS);
          graphics.lineStyle(2 + fade * 3, color, fade * .55);
          graphics.strokeEllipse(x, sy(y), reach * 2, reach * 2 * DS);
          graphics.lineStyle(1.2, 0xfff6de, fade * .6);
          graphics.strokeEllipse(x, sy(y), reach * 1.87, reach * 1.87 * DS);
          for (let i = 0; i < particles; i++) {
            const a = i * Math.PI * 2 / particles + .3;
            const px = x + Math.cos(a) * reach * .85;
            const py = sy(y + Math.sin(a) * reach * .85) - Math.sin(progress * Math.PI) * 16;
            graphics.fillStyle(color, fade * .65);
            if (event.skill === "frost_pulse") diamond(graphics, px, py, 2 + fade * 3, 6 + fade * 13);
            else if (event.skill === "shockwave") graphics.fillTriangle(px - 4, py + 3, px + 5, py + 2, px - 1, py - 9 * fade);
            else {
              graphics.fillEllipse(px, py, 3 + fade * 7, 7 + fade * 18);
              graphics.fillStyle(0xfff1c2, fade * .65);
              graphics.fillEllipse(px, py + 2, 2 + fade * 2, 4 + fade * 7);
            }
          }
        });
        break;
      case "plasma_burst":
      case "dash_cut":
        this.addTransient(.36, (graphics, progress) => {
          const fade = 1 - progress;
          const ex = x + Math.cos(angle) * range, ey = sy(y + Math.sin(angle) * range) - elevation;
          const ox = x, oy = sy(y) - elevation;
          const perpendicularX = -Math.sin(angle), perpendicularY = Math.cos(angle) * DS;
          const width = event.skill === "dash_cut" ? 5 : 13;
          graphics.setBlendMode(Phaser.BlendModes.ADD);
          graphics.fillStyle(color, fade * .24);
          graphics.beginPath();
          graphics.moveTo(ox - perpendicularX * width * fade, oy - perpendicularY * width * fade);
          graphics.lineTo(ex - perpendicularX * width * .6, ey - perpendicularY * width * .6);
          graphics.lineTo(ex + perpendicularX * width * .6, ey + perpendicularY * width * .6);
          graphics.lineTo(ox + perpendicularX * width * fade, oy + perpendicularY * width * fade);
          graphics.closePath(); graphics.fillPath();
          graphics.lineStyle(width * .6 * fade + 1, color, fade * .8); graphics.lineBetween(ox, oy, ex, ey);
          graphics.lineStyle(1 + 2 * fade, 0xfff8e5, fade * .9); graphics.lineBetween(ox, oy, ex, ey);
          for (let i = 0; i < 4; i++) {
            const distance = range * Math.min(1, progress * 1.6 + i * .16);
            const px = x + Math.cos(angle) * distance, py = sy(y + Math.sin(angle) * distance) - elevation;
            graphics.lineStyle(1, color, fade * .5);
            graphics.strokeEllipse(px, py, 8 + width * fade, 13 + width * fade * 2);
          }
        });
        break;
      case "shard_cone":
        this.addTransient(.4, (graphics, progress) => {
          graphics.setBlendMode(Phaser.BlendModes.ADD);
          const fade = 1 - progress;
          for (let i = 0; i < 7; i++) {
            const a = angle - .4 + i * .8 / 6;
            const distance = range * (.15 + .85 * Math.sqrt(progress));
            const px = x + Math.cos(a) * distance, py = sy(y + Math.sin(a) * distance) - elevation;
            graphics.lineStyle(2, color, fade * .35);
            graphics.lineBetween(x + Math.cos(a) * Math.max(0, distance - 28), sy(y + Math.sin(a) * Math.max(0, distance - 28)) - elevation, px, py);
            graphics.fillStyle(0xd9fbff, fade * .85);
            diamond(graphics, px, py, 2.5 + fade * 1.5, 6 + fade * 4);
          }
        });
        break;
      case "vortex":
        this.addTransient(.72, (graphics, progress) => {
          const cx = x + Math.cos(angle) * 60, cy = y + Math.sin(angle) * 60;
          const fade = 1 - progress;
          graphics.setBlendMode(Phaser.BlendModes.ADD);
          graphics.fillStyle(color, fade * .035); graphics.fillEllipse(cx, sy(cy), range * 2, range * 2 * DS);
          for (let arm = 0; arm < 3; arm++) {
            graphics.lineStyle(2.8 - arm * .55, arm === 0 ? 0xedfff0 : color, fade * .65);
            graphics.beginPath();
            for (let point = 0; point <= 26; point++) {
              const ratio = point / 26;
              const a = ratio * Math.PI * 2 + arm * Math.PI * 2 / 3 - progress * 5;
              const radius = range * ratio * (.85 + .15 * fade);
              const px = cx + Math.cos(a) * radius, py = sy(cy + Math.sin(a) * radius) - (1 - ratio) * 28;
              if (point === 0) graphics.moveTo(px, py); else graphics.lineTo(px, py);
            }
            graphics.strokePath();
          }
        });
        break;
      case "brace_counter":
        this.addTransient(.35, (graphics, progress) => {
          const fade = 1 - progress;
          graphics.setBlendMode(Phaser.BlendModes.ADD);
          crescent(graphics, x, y, range * (.8 + progress * .2), angle - 1.1, 2.2, 12 * fade, elevation, color, fade * .35);
          crescent(graphics, x, y, range * (.8 + progress * .2), angle - 1.1, 2.2, 2, elevation, 0xffedbd, fade * .9);
          graphics.lineStyle(2, color, fade * .5);
          graphics.strokeEllipse(x, sy(y) - elevation, 22 + progress * 38, 40 + progress * 25);
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


interface FloorEdge { x1: number; y1: number; x2: number; y2: number; side: "back" | "front" | "left" | "right" }

/** Exterior edges of the authored navigation union; overlaps stay open. */
function walkableEdges(): FloorEdge[] {
  const result: FloorEdge[] = [];
  const inside = (x: number, y: number) => MAP.walkable.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
  for (const r of MAP.walkable) {
    for (const side of ["back", "front"] as const) {
      const y = side === "back" ? r.y : r.y + r.h;
      const outsideY = y + (side === "back" ? -.01 : .01);
      const cuts = [...new Set([r.x, r.x + r.w, ...MAP.walkable.flatMap((other) => [other.x, other.x + other.w])])].filter((x) => x >= r.x && x <= r.x + r.w).sort((a, b) => a - b);
      for (let i = 0; i < cuts.length - 1; i++) {
        if (!inside((cuts[i] + cuts[i + 1]) / 2, outsideY)) result.push({ x1: cuts[i], y1: sy(y), x2: cuts[i + 1], y2: sy(y), side });
      }
    }
    for (const side of ["left", "right"] as const) {
      const x = side === "left" ? r.x : r.x + r.w;
      const outsideX = x + (side === "left" ? -.01 : .01);
      const cuts = [...new Set([r.y, r.y + r.h, ...MAP.walkable.flatMap((other) => [other.y, other.y + other.h])])].filter((y) => y >= r.y && y <= r.y + r.h).sort((a, b) => a - b);
      for (let i = 0; i < cuts.length - 1; i++) {
        if (!inside(outsideX, (cuts[i] + cuts[i + 1]) / 2)) result.push({ x1: x, y1: sy(cuts[i]), x2: x, y2: sy(cuts[i + 1]), side });
      }
    }
  }
  return result;
}

function drawImageCover(ctx: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, width: number, height: number) {
  const factor = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const sourceWidth = width / factor, sourceHeight = height / factor;
  ctx.drawImage(image, (image.naturalWidth - sourceWidth) / 2, (image.naturalHeight - sourceHeight) * .45, sourceWidth, sourceHeight, x, y, width, height);
}


function diamond(graphics: Phaser.GameObjects.Graphics, x: number, y: number, width: number, height: number) {
  graphics.beginPath(); graphics.moveTo(x, y - height); graphics.lineTo(x + width, y); graphics.lineTo(x, y + height); graphics.lineTo(x - width, y); graphics.closePath(); graphics.fillPath();
}

/** A tapered arc avoids the harsh uniform-width rings of placeholder VFX. */
function crescent(graphics: Phaser.GameObjects.Graphics, x: number, y: number, radius: number, angle: number, arc: number, width: number, elevation: number, color: number, alpha: number) {
  graphics.fillStyle(color, Math.max(0, alpha));
  graphics.beginPath();
  for (let i = 0; i <= 18; i++) {
    const ratio = i / 18, a = angle + arc * ratio;
    const r = radius + Math.sin(ratio * Math.PI) * width * .5;
    const px = sx(x + Math.cos(a) * r), py = sy(y + Math.sin(a) * r) - elevation;
    if (i === 0) graphics.moveTo(px, py); else graphics.lineTo(px, py);
  }
  for (let i = 18; i >= 0; i--) {
    const ratio = i / 18, a = angle + arc * ratio;
    const r = radius - Math.sin(ratio * Math.PI) * width;
    graphics.lineTo(sx(x + Math.cos(a) * r), sy(y + Math.sin(a) * r) - elevation);
  }
  graphics.closePath(); graphics.fillPath();
}
