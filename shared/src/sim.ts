// Authoritative mission simulation. Pure TypeScript, no renderer, no network.
// The server owns one Sim per running mission and copies its state into the
// Colyseus schema after every tick. Tests drive it headlessly.
import {
  ACTIVITY,
  WARDEN,
  type BossVariant,
  BOSS,
  ENEMY_CAP,
  ENEMY_SPECS,
  PICKUPS,
  OVERDRIVE,
  PLAYER,
  SUPPORT,
  type AttackSpec,
  type EnemyKind,
  type EnemySpec,
  type SkillSpec,
  type StatusId,
} from "./config.ts";
import type { Loadout } from "./loadout.ts";
import { MAP, clampToWalkable, inRect, moveOnGround, navTarget } from "./map.ts";
import { normalizeInput, stepMovement } from "./movement.ts";
import { SectionParticipation } from "./participation.ts";
import { partyScaling, tierSpec } from "./progression.ts";
import type { ActionKind, FxEvent } from "./protocol.ts";
import { LOOT, SPECIAL_VALUES } from "./loot.ts";

export type Life = "alive" | "downed" | "waiting" | "departed";

export interface SimPlayer {
  id: string;
  profileId: string;
  name: string;
  loadout: Loadout;
  x: number;
  y: number;
  fx: number;
  fy: number;
  hp: number;
  maxHp: number;
  shield: number;
  shieldT: number;
  life: Life;
  downT: number;
  reviveProgress: number;
  connected: boolean;
  input: { mx: number; my: number; atk: boolean };
  lastSeq: number;
  cds: { dodge: number; skill1: number; skill2: number };
  comboStep: number;
  comboIdle: number;
  lock: number;
  pending: { kind: "combo" | "skill1" | "skill2"; t: number; spec: AttackSpec; step: number; skill?: SkillSpec } | null;
  dash: { t: number; dur: number; dx: number; dy: number; dist: number } | null;
  iframes: number;
  brace: { t: number; perfect: boolean; spec: AttackSpec } | null;
  empowerT: number;
  od: number;
  odT: number;
  odBudget: number;
  moving: boolean;
  stats: { damage: number; stagger: number; controlSeconds: number; objectiveSeconds: number; revives: number; downs: number };
  phoenixUsed: boolean;
  phoenixT: number;
  pulseT: number;
  healBudget: number;
  participation: Map<number, SectionParticipation>;
  moveAccum: number;
  calmT: number;
}

export type EliteAffix = "armored" | "swift" | "volatile" | "regen";
export const ELITE_AFFIXES: EliteAffix[] = ["armored", "swift", "volatile", "regen"];
export const ELITE = { hp: 2.6, damage: 1.25, armorBonus: 0.25, swiftSpeed: 1.35, swiftCooldown: 1.45, regenPerSecond: 0.03, regenDelay: 3, volatileRadius: 95, volatileDelay: 0.9 } as const;

export interface EnemyStatus {
  heat: { stacks: number; t: number };
  chill: { stacks: number; t: number };
  armorBreak: { value: number; t: number };
}

export type EnemyState = "idle" | "move" | "windup" | "recover" | "flinch" | "stagger" | "channel" | "roar";

export interface SimEnemy {
  id: string;
  kind: EnemyKind;
  spec: EnemySpec;
  x: number;
  y: number;
  fx: number;
  fy: number;
  hp: number;
  maxHp: number;
  state: EnemyState;
  t: number;
  cd: number;
  target: string | null;
  attack: { kind: string; ang: number; tx: number; ty: number } | null;
  status: EnemyStatus;
  zoneSlow: number;
  stagger: number;
  staggerThreshold: number;
  knock: { vx: number; vy: number; t: number };
  channels: number;
  channelDamage: number;
  section: number;
  phase: number;
  reinforced: number;
  bossCombo: string[];
  elite: EliteAffix | "";
  lastHitT: number;
  variant: BossVariant | "";
}

export interface Hazard {
  id: string;
  kind: "scorch" | "frost" | "strike" | "pool" | "aftershock" | "shot" | "slam" | "beam" | "shard";
  side: "player" | "enemy";
  ownerId: string;
  x: number;
  y: number;
  r: number;
  delay: number; // telegraph time left before it becomes active
  life: number; // active time left
  dps: number; // per second (zones) or instant damage (strikes)
  slow: number;
  vx: number;
  vy: number;
  stagger: number;
  hitOnce: boolean;
  ang?: number; // beams: current angle
  len?: number; // beams: length
  spin?: number; // beams: angular speed (rad/s)
}

export interface Pickup {
  id: string;
  x: number;
  y: number;
  life: number;
}

export type Stage =
  | "s1_corridor"
  | "s1_waves"
  | "s2_activate"
  | "s2_defend"
  | "s2_clear"
  | "s3_approach"
  | "s3_boss"
  | "s3_extract"
  | "done";

export interface SimOptions {
  runId: string;
  tier: number;
  partySize: number;
  seed?: number;
  boss?: BossVariant;
}

export interface SectionClear {
  sectionId: number;
  eligibility: Map<string, boolean>; // playerId → eligible
}

const DT = 1 / 20;
const DEG = Math.PI / 180;

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function angleOf(x: number, y: number) {
  return Math.atan2(y, x);
}
function angleDiff(a: number, b: number) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return Math.abs(d);
}
function dist(ax: number, ay: number, bx: number, by: number) {
  return Math.hypot(ax - bx, ay - by);
}

export class Sim {
  readonly opts: SimOptions;
  players = new Map<string, SimPlayer>();
  enemies = new Map<string, SimEnemy>();
  hazards = new Map<string, Hazard>();
  pickups = new Map<string, Pickup>();
  fx: FxEvent[] = [];
  time = 0;
  tickCount = 0;
  section = 1;
  stage: Stage = "s1_corridor";
  maxX = MAP.sections[0].gateX;
  objective = 0; // 0..100 generic progress shown in HUD
  activateProgress = 0;
  extractT = 0;
  result: "running" | "success" | "failed" = "running";
  bossId: string | null = null;
  clears: SectionClear[] = [];
  private nextId = 1;
  private rng: () => number;
  private spawnQueue: { kind: EnemyKind; x: number; y: number; required: boolean; elite?: boolean }[] = [];
  private waveIndex = 0;
  private defendSpawnT = 0;
  private defendSpawnIdx = 0;
  private defendSpecials = new Set<string>();
  private poolT = 0;
  private hpMult: { regular: number; boss: number };
  private dmgMult: number;

  constructor(opts: SimOptions) {
    this.opts = opts;
    this.rng = mulberry32(opts.seed ?? hashString(opts.runId));
    const t = tierSpec(opts.tier);
    const ps = partyScaling(opts.partySize);
    this.hpMult = { regular: t.enemyHpMult * ps.regularHp, boss: t.enemyHpMult * ps.bossHp };
    this.dmgMult = t.enemyDamageMult * ps.damage;
  }

  // ---- setup -----------------------------------------------------------------
  addPlayer(id: string, profileId: string, name: string, loadout: Loadout): SimPlayer {
    const idx = this.players.size;
    const p: SimPlayer = {
      id,
      profileId,
      name,
      loadout,
      x: MAP.start.x + (idx % 2) * 40,
      y: MAP.start.y - 60 + idx * 17,
      fx: 1,
      fy: 0,
      hp: loadout.maxHp,
      maxHp: loadout.maxHp,
      shield: 0,
      shieldT: 0,
      life: "alive",
      downT: 0,
      reviveProgress: 0,
      connected: true,
      input: { mx: 0, my: 0, atk: false },
      lastSeq: 0,
      cds: { dodge: 0, skill1: 0, skill2: 0 },
      comboStep: 0,
      comboIdle: 0,
      lock: 0,
      pending: null,
      dash: null,
      iframes: 0,
      brace: null,
      empowerT: 0,
      od: 0,
      odT: 0,
      odBudget: OVERDRIVE.maxGainPerSecond,
      moving: false,
      stats: { damage: 0, stagger: 0, controlSeconds: 0, objectiveSeconds: 0, revives: 0, downs: 0 },
      phoenixUsed: false,
      phoenixT: 0,
      pulseT: SPECIAL_VALUES.pulse.every,
      healBudget: 0,
      participation: new Map([[1, new SectionParticipation()]]),
      moveAccum: 0,
      calmT: 0,
    };
    const c = clampToWalkable(p.x, p.y, this.maxX);
    p.x = c.x;
    p.y = c.y;
    if (this.has(p, "overcharge") && loadout.hasOverdrive) p.od = SPECIAL_VALUES.overcharge;
    this.players.set(id, p);
    return p;
  }

  private has(p: SimPlayer, special: string) {
    return p.loadout.gear?.specials.includes(special as any) ?? false;
  }

  start() {
    // Corridor guards.
    this.spawn("pursuer", 470, 260, true);
    this.spawn("pursuer", 500, 340, true);
  }

  // ---- input -----------------------------------------------------------------
  setInput(id: string, mx: number, my: number, atk: boolean, seq: number, fx?: number, fy?: number) {
    const p = this.players.get(id);
    if (!p || p.life === "departed") return;
    if (seq <= p.lastSeq) return; // stale or replayed
    p.lastSeq = seq;
    const n = normalizeInput(mx, my);
    p.input = { mx: n.mx, my: n.my, atk };
    if (n.mx !== 0 || n.my !== 0) {
      const l = Math.hypot(n.mx, n.my);
      p.fx = n.mx / l;
      p.fy = n.my / l;
    } else if (fx !== undefined && fy !== undefined && Math.hypot(fx, fy) > 0.5) {
      const l = Math.hypot(fx, fy);
      p.fx = fx / l;
      p.fy = fy / l;
    }
  }

  clearInput(id: string) {
    const p = this.players.get(id);
    if (p) p.input = { mx: 0, my: 0, atk: false };
  }

  setConnected(id: string, connected: boolean) {
    const p = this.players.get(id);
    if (!p) return;
    p.connected = connected;
    this.clearInput(id);
  }

  depart(id: string) {
    const p = this.players.get(id);
    if (!p) return;
    p.life = "departed";
    p.connected = false;
    p.input = { mx: 0, my: 0, atk: false };
    p.pending = null;
    p.dash = null;
  }

  /** Returns false if the action was rejected (cooldown, locked, not unlocked). */
  action(id: string, a: ActionKind, dx: number, dy: number): boolean {
    const p = this.players.get(id);
    if (!p || p.life !== "alive") return false;
    const dl = Math.hypot(dx, dy);
    if (dl > 0.3) {
      p.fx = dx / dl;
      p.fy = dy / dl;
    }
    const L = p.loadout;
    if (a === "dodge") {
      if (p.cds.dodge > 0 || p.dash) return false;
      const dirx = dl > 0.3 ? dx / dl : p.input.mx || p.fx;
      const diry = dl > 0.3 ? dy / dl : p.input.my || p.fy;
      p.dash = { t: 0, dur: PLAYER.dodgeDuration, dx: dirx, dy: diry, dist: PLAYER.dodgeDistance };
      p.iframes = PLAYER.dodgeInvuln;
      p.cds.dodge = PLAYER.dodgeCooldown;
      p.pending = null;
      p.lock = Math.max(p.lock, PLAYER.dodgeDuration * 0.8);
      if (this.has(p, "dodgeShield")) this.giveShield(p, Math.round(p.maxHp * SPECIAL_VALUES.dodgeShield), 3);
      if (this.enemyNear(p.x, p.y, ACTIVITY.nearEnemyRange)) this.useful(p);
      return true;
    }
    if (p.lock > 0 || p.pending || p.dash || p.brace) return false;
    if (a === "overdrive") {
      if (!L.hasOverdrive || p.od < OVERDRIVE.max || p.odT > 0) return false;
      p.od = 0;
      p.odT = OVERDRIVE.duration;
      this.fx.push({ t: "od", id: p.id, lin: L.lineage });
      return true;
    }
    const skill = a === "skill1" ? L.spec.skill1 : L.spec.skill2;
    if (a === "skill2" && !L.hasSkill2) return false;
    if (p.cds[a] > 0) return false;
    this.assistAim(p, skill.attack.range);
    p.cds[a] = skill.cooldown;
    if (this.enemyNear(p.x, p.y, ACTIVITY.nearEnemyRange)) this.useful(p);
    if (skill.attack.brace) {
      p.brace = { t: skill.attack.brace.window, perfect: false, spec: skill.attack };
      this.fx.push({ t: "skill", id: p.id, skill: skill.id, x: p.x, y: p.y, ang: angleOf(p.fx, p.fy), range: skill.attack.range, lin: L.lineage, evo: L.evolution ?? "" });
      return true;
    }
    p.pending = { kind: a, t: skill.windup, spec: skill.attack, step: 0, skill };
    p.lock = skill.windup + skill.recover;
    return true;
  }

  // ---- main tick -------------------------------------------------------------
  tick() {
    if (this.result !== "running") return;
    this.time += DT;
    this.tickCount++;
    for (const p of this.players.values()) this.tickPlayer(p);
    this.flushSpawnQueue();
    for (const e of this.enemies.values()) this.tickEnemy(e);
    this.tickHazards();
    this.separateEnemies();
    this.tickRevives();
    this.tickPickups();
    this.tickDirector();
    this.sampleParticipation();
    this.checkWipe();
  }

  drainFx(): FxEvent[] {
    const out = this.fx;
    this.fx = [];
    return out;
  }

  // ---- players ---------------------------------------------------------------
  private tickPlayer(p: SimPlayer) {
    if (p.life === "departed" || p.life === "waiting") return;
    if (p.life === "downed") {
      if (p.phoenixT > 0) {
        p.phoenixT -= DT;
        if (p.phoenixT <= 0) {
          p.life = "alive";
          p.hp = Math.round(p.maxHp * SPECIAL_VALUES.phoenix.hp);
          p.reviveProgress = 0;
          p.iframes = 1.5;
          this.fx.push({ t: "revive", id: p.id, by: p.id });
          return;
        }
      }
      p.downT -= DT;
      if (p.downT <= 0) {
        p.life = "waiting";
        p.reviveProgress = 0;
      }
      return;
    }
    const L = p.loadout;
    const od = p.odT > 0 ? L.spec.overdrive : null;
    const cdRate = od ? od.cooldownRate : 1;
    p.cds.dodge = Math.max(0, p.cds.dodge - DT);
    p.cds.skill1 = Math.max(0, p.cds.skill1 - DT * cdRate);
    p.cds.skill2 = Math.max(0, p.cds.skill2 - DT * cdRate);
    p.lock = Math.max(0, p.lock - DT);
    p.iframes = Math.max(0, p.iframes - DT);
    p.empowerT = Math.max(0, p.empowerT - DT);
    p.odT = Math.max(0, p.odT - DT);
    const odMax = OVERDRIVE.maxGainPerSecond * (1 + (L.gear?.stats.overdrive ?? 0));
    p.odBudget = Math.min(odMax, p.odBudget + odMax * DT);
    p.healBudget = Math.min(p.maxHp * 0.03, p.healBudget + p.maxHp * 0.03 * DT);
    if (this.has(p, "pulse")) {
      p.pulseT -= DT;
      if (p.pulseT <= 0) {
        p.pulseT = SPECIAL_VALUES.pulse.every;
        for (const e of [...this.enemies.values()]) {
          if (dist(p.x, p.y, e.x, e.y) <= SPECIAL_VALUES.pulse.radius + e.spec.radius) this.damageEnemy(p, e, L.damage * SPECIAL_VALUES.pulse.damage, 2, false, 0, p.x, p.y, "pulse");
        }
      }
    }
    if (p.shieldT > 0) {
      p.shieldT -= DT;
      if (p.shieldT <= 0) p.shield = 0;
    }

    if (this.enemyNear(p.x, p.y, 420)) p.calmT = 0;
    else p.calmT += DT;
    if (p.calmT > 4 && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + p.maxHp * PLAYER.calmRegenPerSecond * DT);

    const ox = p.x;
    const oy = p.y;
    if (p.dash) {
      const d = p.dash;
      const step = Math.min(DT, d.dur - d.t);
      const l = Math.hypot(d.dx, d.dy) || 1;
      const v = d.dist / d.dur;
      const m = moveOnGround(p.x, p.y, (d.dx / l) * v * step, (d.dy / l) * v * step, this.maxX);
      p.x = m.x;
      p.y = m.y;
      d.t += DT;
      if (d.t >= d.dur) p.dash = null;
    } else {
      let speed = L.moveSpeed * (od ? od.speedMult : 1);
      if (p.pending || p.brace) speed *= 0.35;
      else if (p.input.atk) speed *= 0.6;
      const m = stepMovement(p.x, p.y, p.input, speed, DT, this.maxX);
      p.x = m.x;
      p.y = m.y;
    }
    const moved = dist(ox, oy, p.x, p.y);
    p.moving = moved > 0.5;
    this.trackMovement(p, moved);

    if (p.brace) {
      p.brace.t -= DT;
      if (p.brace.t <= 0) this.releaseBrace(p);
    }

    if (p.pending) {
      p.pending.t -= DT;
      if (p.pending.t <= 0) {
        const pend = p.pending;
        p.pending = null;
        this.resolvePlayerAttack(p, pend.spec, pend.kind, pend.step, pend.skill);
      }
    } else if (p.input.atk && p.lock <= 0 && !p.dash && !p.brace) {
      const step = p.comboStep;
      const spec = L.spec.combo.hits[step];
      this.assistAim(p, spec.range);
      if (this.enemyNear(p.x, p.y, spec.range + ACTIVITY.nearEnemyRange * 0.5)) this.useful(p);
      p.pending = { kind: "combo", t: 0.06, spec, step };
      p.lock = L.spec.combo.interval[step];
      p.comboStep = (step + 1) % 3;
      p.comboIdle = 0;
      this.fx.push({ t: "swing", id: p.id, x: p.x, y: p.y, ang: angleOf(p.fx, p.fy), range: spec.range, arc: spec.arcDeg ?? 90, lin: L.lineage, step });
    } else {
      p.comboIdle += DT;
      if (p.comboIdle > L.spec.combo.resetAfter) p.comboStep = 0;
    }
  }

  private trackMovement(p: SimPlayer, moved: number) {
    if (moved <= 0) return;
    const enemyClose = this.enemyNear(p.x, p.y, ACTIVITY.nearEnemyRange * 1.5);
    let squad = false;
    if (this.sectionHasActiveCombat()) {
      for (const o of this.players.values()) {
        if (o !== p && o.life === "alive" && dist(o.x, o.y, p.x, p.y) < ACTIVITY.squadRange) squad = true;
      }
    }
    if (enemyClose || squad) {
      p.moveAccum += moved;
      if (p.moveAccum >= ACTIVITY.minMoveDistance) {
        this.useful(p);
        p.moveAccum = 0;
      }
    }
  }

  private sectionHasActiveCombat() {
    if (this.enemies.size > 0 || this.spawnQueue.length > 0) return true;
    return this.stage === "s2_activate" || this.stage === "s2_defend" || this.stage === "s3_extract";
  }

  private assistAim(p: SimPlayer, range: number) {
    const reach = range + PLAYER.targetAssistRange;
    const fa = angleOf(p.fx, p.fy);
    let best: SimEnemy | null = null;
    let bestD = Infinity;
    for (const e of this.enemies.values()) {
      const d = dist(p.x, p.y, e.x, e.y) - e.spec.radius;
      if (d > reach) continue;
      if (angleDiff(angleOf(e.x - p.x, e.y - p.y), fa) > PLAYER.targetAssistAngleDeg * DEG) continue;
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    if (best) {
      const l = dist(p.x, p.y, best.x, best.y) || 1;
      p.fx = (best.x - p.x) / l;
      p.fy = (best.y - p.y) / l;
    }
  }

  private releaseBrace(p: SimPlayer) {
    const b = p.brace!;
    p.brace = null;
    const spec: AttackSpec = JSON.parse(JSON.stringify(b.spec));
    if (b.perfect && b.spec.brace) {
      spec.damage *= 1 + b.spec.brace.perfectBonus;
      spec.stagger *= 1.5;
      this.fx.push({ t: "perfect", id: p.id });
      if (b.spec.brace.shell) this.giveShield(p, b.spec.brace.shell.amount, b.spec.brace.shell.duration);
    }
    p.lock = 0.35;
    this.resolvePlayerAttack(p, spec, "skill1", 0, p.loadout.spec.skill1);
  }

  private giveShield(p: SimPlayer, amount: number, duration: number) {
    p.shield = Math.min(p.maxHp * 0.6, Math.max(p.shield, 0) + amount);
    p.shieldT = Math.max(p.shieldT, duration);
    this.fx.push({ t: "shield", id: p.id });
  }

  private gainOd(p: SimPlayer, amount: number) {
    if (!p.loadout.hasOverdrive || p.odT > 0) return;
    const g = Math.min(amount * (1 + (p.loadout.gear?.stats.overdrive ?? 0)), p.odBudget);
    p.odBudget -= g;
    p.od = Math.min(OVERDRIVE.max, p.od + g);
  }

  // ---- attack resolution ------------------------------------------------------
  private resolvePlayerAttack(p: SimPlayer, spec: AttackSpec, kind: "combo" | "skill1" | "skill2", step: number, skill?: SkillSpec) {
    const L = p.loadout;
    const od = p.odT > 0 ? L.spec.overdrive : null;
    let ox = p.x;
    let oy = p.y;
    const ang = angleOf(p.fx, p.fy);
    let lineLen = spec.range;

    if (spec.dash) {
      // Server-validated dash: walk the path, walls stop it.
      const sx = p.x;
      const sy = p.y;
      const steps = 8;
      for (let i = 0; i < steps; i++) {
        const m = moveOnGround(p.x, p.y, (p.fx * spec.dash.distance) / steps, (p.fy * spec.dash.distance) / steps, this.maxX);
        p.x = m.x;
        p.y = m.y;
      }
      p.iframes = Math.max(p.iframes, spec.dash.duration);
      lineLen = Math.max(20, dist(sx, sy, p.x, p.y));
      ox = sx;
      oy = sy;
    }

    if (kind !== "combo" && skill) {
      this.fx.push({ t: "skill", id: p.id, skill: skill.id, x: ox, y: oy, ang, range: spec.range, lin: L.lineage, evo: L.evolution ?? "" });
    }

    const cx = ox + p.fx * (spec.offset ?? 0);
    const cy = oy + p.fy * (spec.offset ?? 0);
    const hits: SimEnemy[] = [];
    for (const e of this.enemies.values()) {
      if (e.hp <= 0) continue;
      if (this.inShape(spec, ox, oy, cx, cy, p.fx, p.fy, lineLen, e.x, e.y, e.spec.radius)) hits.push(e);
    }
    hits.sort((a, b) => dist(ox, oy, a.x, a.y) - dist(ox, oy, b.x, b.y));

    let mult = od ? od.damageMult : 1;
    if (kind === "combo" && p.empowerT > 0 && L.spec.dodgeEmpower) {
      mult *= 1 + L.spec.dodgeEmpower.bonus;
      p.empowerT = 0;
      this.fx.push({ t: "perfect", id: p.id });
    } else if (kind === "skill1" && spec.dash && p.empowerT > 0 && L.spec.dodgeEmpower) {
      mult *= 1 + L.spec.dodgeEmpower.bonus * 0.5;
      p.empowerT = 0;
    }
    const extraStacks = od ? od.extraStacks : 0;
    const hitSet = new Set<string>();
    let shieldGain = 0;

    hits.forEach((e, i) => {
      hitSet.add(e.id);
      let dmgMult = spec.damage * mult;
      if (i === 0 && spec.firstTargetBonus) dmgMult *= 1 + spec.firstTargetBonus;
      if (spec.consume) {
        const c = spec.consume;
        const stacks = this.statusStacks(e, c.id);
        if (stacks >= c.minStacks && stacks > 0) {
          dmgMult *= 1 + stacks * c.bonusPerStack;
          this.clearStatus(e, c.id);
          if (c.shieldPerStack) shieldGain += stacks * c.shieldPerStack;
          if (c.spread) this.spreadDetonation(p, e, c.spread, hitSet, mult);
          if (c.fragments) this.fragments(p, e, c.fragments, hitSet, mult);
        }
      }
      this.damageEnemy(p, e, L.damage * dmgMult, spec.stagger, spec.flinch, spec.knockback, p.x, p.y);
      if (spec.applyStatus) this.applyStatus(p, e, spec.applyStatus.id, spec.applyStatus.stacks + extraStacks, spec.applyStatus.value, spec.applyStatus.duration);
    });

    if (hits.length > 0) this.gainOd(p, OVERDRIVE.gainPerHit * (kind === "combo" ? 1 : 2));
    if (shieldGain > 0) this.giveShield(p, Math.min(60, shieldGain), 4);
    if (spec.selfShield) this.giveShield(p, spec.selfShield.amount, spec.selfShield.duration);

    if (spec.pull) {
      for (const e of this.enemies.values()) {
        if (e.kind === "boss" || e.kind === "pylon") continue;
        const d = dist(cx, cy, e.x, e.y);
        if (d > spec.pull.radius || d < 4) continue;
        const move = Math.min(spec.pull.strength, d - 20);
        if (move <= 0) continue;
        e.x += ((cx - e.x) / d) * move;
        e.y += ((cy - e.y) / d) * move;
        p.stats.controlSeconds += 1;
        if (e.state === "windup" && e.kind !== "armored") this.flinch(e);
      }
    }
    if (spec.zone) {
      const zx = spec.shape === "line" ? ox + p.fx * lineLen * 0.7 : cx;
      const zy = spec.shape === "line" ? oy + p.fy * lineLen * 0.7 : cy;
      this.addHazard({
        kind: spec.zone.kind,
        side: "player",
        ownerId: p.id,
        x: zx,
        y: zy,
        r: spec.zone.radius,
        delay: 0,
        life: spec.zone.duration,
        dps: spec.zone.dps * L.damage,
        slow: spec.zone.slow,
        stagger: 0,
        hitOnce: false,
      });
    }
    if (spec.aftershock) {
      this.addHazard({
        kind: "aftershock",
        side: "player",
        ownerId: p.id,
        x: cx,
        y: cy,
        r: spec.aftershock.radius,
        delay: spec.aftershock.delay,
        life: 0.1,
        dps: spec.aftershock.damage * L.damage * mult,
        slow: 0,
        stagger: spec.aftershock.stagger,
        hitOnce: true,
      });
    }
    if (spec.areaFollowUp) {
      for (const e of this.enemies.values()) {
        if (dist(p.x, p.y, e.x, e.y) <= spec.areaFollowUp.radius + e.spec.radius) {
          this.damageEnemy(p, e, L.damage * spec.areaFollowUp.damage * mult, 4, true, 6, p.x, p.y);
        }
      }
    }
  }

  private inShape(spec: AttackSpec, ox: number, oy: number, cx: number, cy: number, fx: number, fy: number, lineLen: number, ex: number, ey: number, er: number) {
    if (spec.shape === "circle") return dist(cx, cy, ex, ey) <= spec.range + er;
    if (spec.shape === "line") {
      const rx = ex - ox;
      const ry = ey - oy;
      const along = rx * fx + ry * fy;
      const perp = Math.abs(-rx * fy + ry * fx);
      return along >= -er && along <= lineLen + er && perp <= (spec.width ?? 50) / 2 + er;
    }
    const d = dist(ox, oy, ex, ey);
    if (d > spec.range + er) return false;
    if (d < er + 12) return true;
    return angleDiff(angleOf(ex - ox, ey - oy), angleOf(fx, fy)) <= ((spec.arcDeg ?? 90) / 2) * DEG + Math.atan2(er, d);
  }

  private spreadDetonation(p: SimPlayer, origin: SimEnemy, spread: { radius: number; damage: number }, hitSet: Set<string>, mult: number) {
    // Reduced detonation that never chains further: targets are marked as hit.
    for (const e of this.enemies.values()) {
      if (hitSet.has(e.id) || e === origin) continue;
      if (dist(origin.x, origin.y, e.x, e.y) > spread.radius) continue;
      const stacks = e.status.heat.stacks;
      if (stacks <= 0) continue;
      hitSet.add(e.id);
      this.clearStatus(e, "heat");
      this.damageEnemy(p, e, p.loadout.damage * spread.damage * (1 + stacks * 0.3) * mult, 6, true, 8, origin.x, origin.y, "spread");
    }
  }

  private fragments(p: SimPlayer, origin: SimEnemy, f: { count: number; range: number; damage: number }, hitSet: Set<string>, mult: number) {
    let n = 0;
    for (const e of this.enemies.values()) {
      if (n >= f.count) break;
      if (hitSet.has(e.id) || e === origin) continue;
      if (dist(origin.x, origin.y, e.x, e.y) > f.range + e.spec.radius) continue;
      n++;
      this.damageEnemy(p, e, p.loadout.damage * f.damage * mult, 4, true, 4, origin.x, origin.y, "fragment");
    }
  }

  private statusStacks(e: SimEnemy, id: StatusId) {
    if (id === "heat") return e.status.heat.stacks;
    if (id === "chill") return e.status.chill.stacks;
    return e.status.armorBreak.value > 0 ? 1 : 0;
  }
  private clearStatus(e: SimEnemy, id: StatusId) {
    if (id === "heat") e.status.heat = { stacks: 0, t: 0 };
    else if (id === "chill") e.status.chill = { stacks: 0, t: 0 };
    else e.status.armorBreak = { value: 0, t: 0 };
  }
  private applyStatus(p: SimPlayer, e: SimEnemy, id: StatusId, stacks: number, value = 0, duration = 4) {
    if (e.hp <= 0) return;
    if (id === "heat") {
      e.status.heat.stacks = Math.min(3, e.status.heat.stacks + stacks);
      e.status.heat.t = duration;
    } else if (id === "chill") {
      e.status.chill.stacks = Math.min(5, e.status.chill.stacks + stacks);
      e.status.chill.t = duration;
      p.stats.controlSeconds += 0.5 * stacks;
    } else {
      // Non-stacking across players: strongest value wins, duration refreshes.
      e.status.armorBreak.value = Math.max(e.status.armorBreak.value, value);
      e.status.armorBreak.t = duration;
      p.stats.controlSeconds += 1;
    }
  }

  private damageEnemy(p: SimPlayer, e: SimEnemy, raw: number, stagger: number, flinch: boolean, knockback: number, fromX: number, fromY: number, kind?: string) {
    if (e.hp <= 0) return;
    let armor = e.spec.armor + (e.elite === "armored" ? ELITE.armorBonus : 0);
    e.lastHitT = this.time;
    if (e.state === "stagger") armor = 0;
    armor = Math.max(0, armor - e.status.armorBreak.value * 2);
    let taken = 1 + (e.state === "stagger" ? BOSS.staggerDamageTaken : 0) + e.status.armorBreak.value * 0.5;
    const gear = p.loadout.gear;
    let crit = false;
    if (gear && gear.stats.crit > 0 && kind !== "zone" && this.rng() < gear.stats.crit) {
      crit = true;
      raw *= LOOT.critMultiplier;
    }
    if (this.has(p, "firstStrike") && e.hp > e.maxHp * 0.9) raw *= 1 + SPECIAL_VALUES.firstStrike;
    // The Crystal Warden is shielded while any pylon stands.
    if (e.variant === "warden" && this.pylonsAlive() > 0) raw *= 1 - WARDEN.shieldReduction;
    const dmg = Math.max(1, Math.round(raw * (1 - armor) * taken));
    e.hp = Math.max(0, e.hp - dmg);
    p.stats.damage += dmg;
    p.stats.stagger += stagger;
    if (this.has(p, "lifesteal") && p.life === "alive" && p.healBudget > 0) {
      const heal = Math.min(p.healBudget, dmg * SPECIAL_VALUES.lifesteal, p.maxHp - p.hp);
      if (heal > 0) {
        p.hp += heal;
        p.healBudget -= heal;
      }
    }
    this.fx.push({ t: "hit", x: e.x, y: e.y, dmg, target: e.id, src: p.id, kind, crit: crit || undefined });
    if (e.state === "channel") {
      e.channelDamage += dmg;
      if (e.channelDamage >= e.maxHp * SUPPORT.interruptDamageFraction || stagger >= 10) {
        this.flinch(e);
        e.cd = 4;
        p.stats.controlSeconds += 2;
      }
    }
    // Stagger meter.
    e.stagger += stagger;
    if (e.kind === "boss") {
      if (e.stagger >= e.staggerThreshold && e.state !== "stagger" && e.state !== "roar") {
        e.state = "stagger";
        e.t = BOSS.staggerDuration;
        e.attack = null;
        e.stagger = 0;
        e.staggerThreshold *= BOSS.staggerThresholdGrowth;
        this.clearBossHazards(e);
        p.stats.controlSeconds += BOSS.staggerDuration;
      }
    } else if (e.kind !== "pylon") {
      const heavy = e.kind === "armored";
      if (heavy) {
        if (e.stagger >= e.staggerThreshold) {
          e.stagger = 0;
          this.flinch(e, 0.8);
        }
      } else if (flinch && (e.state === "windup" || e.state === "move" || e.state === "idle" || e.state === "recover")) {
        if (e.state === "windup" && e.kind !== "pursuer") {
          if (e.stagger >= e.staggerThreshold) this.flinch(e);
        } else this.flinch(e, 0.22);
      }
      if (knockback > 0 && e.kind !== "armored") {
        const d = dist(fromX, fromY, e.x, e.y) || 1;
        e.knock = { vx: ((e.x - fromX) / d) * knockback * 5, vy: ((e.y - fromY) / d) * knockback * 5, t: 0.12 };
      } else if (knockback > 0) {
        const d = dist(fromX, fromY, e.x, e.y) || 1;
        e.knock = { vx: ((e.x - fromX) / d) * knockback * 1.5, vy: ((e.y - fromY) / d) * knockback * 1.5, t: 0.1 };
      }
    }
    if (e.hp <= 0) this.killEnemy(e);
  }

  private flinch(e: SimEnemy, t = 0.3) {
    if (e.kind === "boss") return;
    e.state = "flinch";
    e.t = t;
    e.attack = null;
    e.channelDamage = 0;
    e.stagger = 0;
  }

  private killEnemy(e: SimEnemy) {
    this.enemies.delete(e.id);
    if (e.elite === "volatile") {
      this.addHazard({ kind: "strike", side: "enemy", ownerId: e.id, x: e.x, y: e.y, r: ELITE.volatileRadius, delay: ELITE.volatileDelay, life: 0.1, dps: e.spec.damage * this.dmgMult * 1.4, slow: 0, vx: 0, vy: 0, stagger: 0, hitOnce: true });
    }
    if (e.kind !== "boss" && (e.elite || PICKUPS.guaranteed.includes(e.kind) || this.rng() < PICKUPS.dropChance)) {
      const id = `k${this.nextId++}`;
      this.pickups.set(id, { id, x: e.x, y: e.y, life: PICKUPS.life });
    }
    this.fx.push({ t: "death", id: e.id, kind: e.kind, x: e.x, y: e.y });
    if (this.stage === "s2_defend") this.objective = Math.min(100, this.objective + 2.1);
    if (e.kind === "boss") this.onBossDead(e);
    if (e.kind === "pylon" && this.pylonsAlive() === 0) {
      const w = this.bossId ? this.enemies.get(this.bossId) : null;
      if (w && w.variant === "warden") {
        w.state = "stagger";
        w.t = WARDEN.exposedStagger;
        w.attack = null;
        this.clearBossHazards(w);
        this.fx.push({ t: "msg", key: "warden_exposed" });
      }
    }
  }

  // ---- damage to players -----------------------------------------------------
  private damagePlayer(p: SimPlayer, raw: number, src?: SimEnemy, srcKind = ""): boolean {
    if (p.life !== "alive") return false;
    if (p.iframes > 0) {
      // Accurately timed dodge.
      this.fx.push({ t: "perfect", id: p.id });
      this.gainOd(p, OVERDRIVE.gainPerDefensive);
      this.useful(p);
      if (p.loadout.spec.dodgeEmpower) p.empowerT = p.loadout.spec.dodgeEmpower.window;
      p.iframes = 0.05; // consume most of the window so multi-hits don't all count
      return false;
    }
    if (p.brace) {
      p.brace.perfect = true;
      this.gainOd(p, OVERDRIVE.gainPerDefensive);
      this.useful(p);
      this.releaseBrace(p);
      return false;
    }
    const od = p.odT > 0 ? p.loadout.spec.overdrive : null;
    let reduction = p.loadout.gear?.stats.armor ?? 0;
    let guardian = 0;
    for (const o of this.players.values()) {
      if (o.life === "alive" && this.has(o, "guardian") && dist(o.x, o.y, p.x, p.y) <= SPECIAL_VALUES.guardian.radius) guardian = SPECIAL_VALUES.guardian.reduction;
    }
    reduction = Math.min(0.4, reduction + guardian);
    if (src && this.has(p, "thorns") && src.hp > 0 && (srcKind === "" || srcKind === "sweep")) {
      this.damageEnemy(p, src, raw * SPECIAL_VALUES.thorns, 0, false, 0, p.x, p.y, "thorns");
    }
    let dmg = Math.round(raw * (od ? od.damageTaken : 1) * (1 - reduction));
    if (p.shield > 0) {
      const a = Math.min(p.shield, dmg);
      p.shield -= a;
      dmg -= a;
    }
    if (dmg <= 0) return true;
    p.hp = Math.max(0, p.hp - dmg);
    this.fx.push({ t: "pdmg", id: p.id, dmg, src: srcKind || src?.kind || "" });
    this.gainOd(p, (dmg / p.maxHp) * 100 * OVERDRIVE.gainPerDamageTakenPct);
    if (p.hp <= 0) {
      p.life = "downed";
      p.downT = PLAYER.downedBleedSeconds;
      p.reviveProgress = 0;
      p.pending = null;
      p.dash = null;
      p.brace = null;
      p.odT = 0;
      p.stats.downs++;
      if (this.has(p, "phoenix") && !p.phoenixUsed) {
        p.phoenixUsed = true;
        p.phoenixT = SPECIAL_VALUES.phoenix.delay;
      }
      this.fx.push({ t: "down", id: p.id });
    }
    void src;
    return true;
  }

  private tickRevives() {
    for (const p of this.players.values()) {
      if (p.life !== "downed") continue;
      let reviver: SimPlayer | null = null;
      for (const o of this.players.values()) {
        if (o === p || o.life !== "alive") continue;
        if (dist(o.x, o.y, p.x, p.y) <= PLAYER.reviveRadius) {
          reviver = o;
          break;
        }
      }
      if (reviver) {
        p.reviveProgress += DT / PLAYER.reviveSeconds;
        this.useful(reviver);
        this.gainOd(reviver, OVERDRIVE.gainPerReviveSecond * DT);
        if (p.reviveProgress >= 1) {
          p.life = "alive";
          p.hp = Math.round(p.maxHp * PLAYER.reviveHpFraction);
          p.reviveProgress = 0;
          p.iframes = 1;
          reviver.stats.revives++;
          this.fx.push({ t: "revive", id: p.id, by: reviver.id });
        }
      } else {
        p.reviveProgress = Math.max(0, p.reviveProgress - DT * 0.25);
      }
    }
  }

  private tickPickups() {
    for (const [id, k] of this.pickups) {
      k.life -= DT;
      let taker: SimPlayer | null = null;
      for (const p of this.players.values()) if (p.life === "alive" && dist(p.x, p.y, k.x, k.y) <= PICKUPS.collectRadius) taker = p;
      if (taker) {
        for (const p of this.players.values()) {
          if (p.life !== "alive" || dist(p.x, p.y, k.x, k.y) > PICKUPS.shareRadius) continue;
          p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * PICKUPS.healFraction));
        }
        this.fx.push({ t: "msg", key: "pickup:" + taker.id });
        this.pickups.delete(id);
      } else if (k.life <= 0) this.pickups.delete(id);
    }
  }

  private checkWipe() {
    if (this.result !== "running") return;
    let participants = 0;
    let alive = 0;
    for (const p of this.players.values()) {
      if (p.life === "departed") continue;
      participants++;
      if (p.life === "alive" || (p.life === "downed" && p.phoenixT > 0)) alive++;
    }
    if (participants === 0 || alive === 0) {
      this.result = "failed";
      this.stage = "done";
    }
  }

  // ---- enemies -----------------------------------------------------------------
  spawn(kind: EnemyKind, x: number, y: number, required = true, elite = false) {
    if (this.enemies.size >= ENEMY_CAP) {
      this.spawnQueue.push({ kind, x, y, required, elite });
      return;
    }
    const spec = kind === "boss" && this.opts.boss === "warden" ? (WARDEN.spec as EnemySpec) : ENEMY_SPECS[kind];
    const affix: EliteAffix | "" = elite && kind !== "boss" ? ELITE_AFFIXES[Math.floor(this.rng() * ELITE_AFFIXES.length)] : "";
    const hp = Math.round(spec.hp * (kind === "boss" ? this.hpMult.boss : this.hpMult.regular) * (affix ? ELITE.hp : 1));
    const id = `e${this.nextId++}`;
    const e: SimEnemy = {
      id,
      kind,
      spec,
      x,
      y,
      fx: -1,
      fy: 0,
      hp,
      maxHp: hp,
      state: kind === "boss" ? "roar" : "idle",
      t: kind === "boss" ? 1.5 : 0.4 + this.rng() * 0.4,
      cd: 0.6 + this.rng(),
      target: null,
      attack: null,
      status: { heat: { stacks: 0, t: 0 }, chill: { stacks: 0, t: 0 }, armorBreak: { value: 0, t: 0 } },
      zoneSlow: 0,
      stagger: 0,
      staggerThreshold: spec.staggerThreshold,
      knock: { vx: 0, vy: 0, t: 0 },
      channels: 0,
      channelDamage: 0,
      section: this.section,
      phase: 1,
      reinforced: 0,
      bossCombo: [],
      elite: affix,
      lastHitT: 0,
      variant: kind === "boss" ? (this.opts.boss ?? "brood") : "",
    };
    this.enemies.set(id, e);
    if (kind === "boss") this.bossId = id;
    if (affix) this.fx.push({ t: "msg", key: `elite_${affix}` });
    return e;
  }

  private flushSpawnQueue() {
    // Staggered: at most two queued spawns per tick.
    let n = 0;
    while (this.spawnQueue.length && this.enemies.size < ENEMY_CAP && n < 2) {
      const s = this.spawnQueue.shift()!;
      this.spawn(s.kind, s.x, s.y, s.required, s.elite);
      n++;
    }
  }

  queuedSpawns() {
    return this.spawnQueue.length;
  }

  private nearestPlayer(x: number, y: number): SimPlayer | null {
    let best: SimPlayer | null = null;
    let bd = Infinity;
    for (const p of this.players.values()) {
      if (p.life !== "alive") continue;
      const d = dist(x, y, p.x, p.y);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  private enemyNear(x: number, y: number, r: number) {
    for (const e of this.enemies.values()) if (dist(x, y, e.x, e.y) <= r + e.spec.radius) return true;
    return false;
  }

  private slowOf(e: SimEnemy) {
    return Math.min(e.spec.slowCap, e.status.chill.stacks * 0.06 + e.zoneSlow);
  }

  private moveEnemy(e: SimEnemy, tx0: number, ty0: number, speedMul = 1) {
    const nav = navTarget(e.x, e.y, tx0, ty0);
    const tx = nav.x;
    const ty = nav.y;
    const d = dist(e.x, e.y, tx, ty);
    if (d < 1) return;
    const sp = e.spec.speed * (e.elite === "swift" ? ELITE.swiftSpeed : 1) * (1 - this.slowOf(e)) * speedMul * DT;
    const m = moveOnGround(e.x, e.y, ((tx - e.x) / d) * Math.min(sp, d), ((ty - e.y) / d) * Math.min(sp, d), this.maxX, e.spec.radius * 0.6);
    e.x = m.x;
    e.y = m.y;
  }

  private faceTo(e: SimEnemy, x: number, y: number) {
    const d = dist(e.x, e.y, x, y) || 1;
    e.fx = (x - e.x) / d;
    e.fy = (y - e.y) / d;
  }

  private tickEnemy(e: SimEnemy) {
    // statuses
    const s = e.status;
    if (s.heat.t > 0 && (s.heat.t -= DT) <= 0) s.heat.stacks = 0;
    if (s.chill.t > 0 && (s.chill.t -= DT) <= 0) s.chill.stacks = 0;
    if (s.armorBreak.t > 0 && (s.armorBreak.t -= DT) <= 0) s.armorBreak.value = 0;
    e.zoneSlow = 0;
    for (const h of this.hazards.values()) {
      if (h.side === "player" && h.slow > 0 && h.delay <= 0 && dist(h.x, h.y, e.x, e.y) <= h.r + e.spec.radius) e.zoneSlow = Math.max(e.zoneSlow, h.slow);
    }
    if (e.knock.t > 0) {
      const m = moveOnGround(e.x, e.y, e.knock.vx * DT, e.knock.vy * DT, this.maxX, e.spec.radius * 0.6);
      e.x = m.x;
      e.y = m.y;
      e.knock.t -= DT;
    }
    e.cd = Math.max(0, e.cd - DT * (1 - this.slowOf(e) * 0.5) * (e.elite === "swift" ? ELITE.swiftCooldown : 1));
    if (e.elite === "regen" && this.time - e.lastHitT > ELITE.regenDelay && e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + Math.ceil(e.maxHp * ELITE.regenPerSecond * DT));
    e.stagger = Math.max(0, e.stagger - DT * (e.kind === "boss" ? 6 : 10));

    if (e.kind === "pylon") return;
    if (e.kind === "boss") return e.variant === "warden" ? this.tickWarden(e) : this.tickBoss(e);

    const target = this.nearestPlayer(e.x, e.y);
    e.target = target?.id ?? null;
    switch (e.state) {
      case "flinch":
      case "recover":
      case "idle":
        e.t -= DT;
        if (e.t <= 0) e.state = "move";
        return;
      case "windup":
        e.t -= DT * (1 - this.slowOf(e) * 0.5);
        if (e.t <= 0) this.enemyStrike(e);
        return;
      case "channel":
        e.t -= DT;
        if (e.t <= 0) {
          e.channels++;
          for (let i = 0; i < SUPPORT.spawnPerChannel; i++) {
            const a = this.rng() * Math.PI * 2;
            const c = clampToWalkable(e.x + Math.cos(a) * 50, e.y + Math.sin(a) * 50, this.maxX);
            this.spawn("pursuer", c.x, c.y, false);
          }
          e.state = "recover";
          e.t = e.spec.recover;
          e.cd = e.spec.cooldown;
        }
        return;
    }
    if (!target) return;
    const d = dist(e.x, e.y, target.x, target.y);
    this.faceTo(e, target.x, target.y);
    if (e.kind === "ranged") {
      if (d > 310) this.moveEnemy(e, target.x, target.y);
      else if (d < 170) this.moveEnemy(e, e.x - (target.x - e.x), e.y - (target.y - e.y), 0.8);
      else if (e.cd <= 0) {
        e.state = "windup";
        e.t = e.spec.windup;
        e.attack = { kind: "shot", ang: angleOf(target.x - e.x, target.y - e.y), tx: target.x, ty: target.y };
      } else this.moveEnemy(e, e.x + -e.fy * 40, e.y + e.fx * 40, 0.4); // strafe
      return;
    }
    if (e.kind === "support") {
      if (e.cd <= 0 && e.channels < SUPPORT.maxChannels && d < 520) {
        e.state = "channel";
        e.t = SUPPORT.channelSeconds;
        e.channelDamage = 0;
        e.attack = { kind: "summon", ang: 0, tx: e.x, ty: e.y };
        return;
      }
      if (d < 240) this.moveEnemy(e, e.x - (target.x - e.x), e.y - (target.y - e.y), 0.9);
      else if (d > 360) this.moveEnemy(e, target.x, target.y);
      return;
    }
    const reach = e.spec.attackRange + e.spec.radius;
    if (d <= reach * 2.2 && e.cd <= 0 && this.attackersOn(target.id, e.id) >= 2) {
      // Attack tokens: at most two melee attackers commit to one player at a time.
      if (d < reach * 1.6) this.moveEnemy(e, e.x - (target.x - e.x), e.y - (target.y - e.y), 0.5);
      else this.moveEnemy(e, e.x - e.fy * 50, e.y + e.fx * 50, 0.35);
      return;
    }
    if (d <= reach && e.cd <= 0) {
      e.state = "windup";
      e.t = e.spec.windup;
      e.attack = { kind: e.kind === "armored" ? "slam" : "melee", ang: angleOf(target.x - e.x, target.y - e.y), tx: target.x, ty: target.y };
    } else if (d > reach * 0.8) {
      this.moveEnemy(e, target.x, target.y);
    }
  }

  private attackersOn(playerId: string, exceptId: string) {
    let n = 0;
    for (const o of this.enemies.values()) {
      if (o.id === exceptId || o.target !== playerId) continue;
      if ((o.kind === "pursuer" || o.kind === "armored") && (o.state === "windup" || (o.state === "recover" && o.t > 0.3))) n++;
    }
    return n;
  }

  private enemyStrike(e: SimEnemy) {
    const a = e.attack;
    e.state = "recover";
    e.t = e.spec.recover;
    e.cd = e.spec.cooldown;
    e.attack = null;
    if (!a) return;
    const dmg = e.spec.damage * this.dmgMult * (e.elite ? ELITE.damage : 1);
    if (a.kind === "shot") {
      const sp = 330;
      this.addHazard({ kind: "shot", side: "enemy", ownerId: e.id, x: e.x, y: e.y, r: 10, delay: 0, life: 1.3, dps: dmg, slow: 0, vx: Math.cos(a.ang) * sp, vy: Math.sin(a.ang) * sp, stagger: 0, hitOnce: true });
      return;
    }
    if (a.kind === "slam") {
      const cx = e.x + Math.cos(a.ang) * 45;
      const cy = e.y + Math.sin(a.ang) * 45;
      for (const p of this.players.values()) if (p.life === "alive" && dist(cx, cy, p.x, p.y) <= 62 + 14) this.damagePlayer(p, dmg, e);
      return;
    }
    for (const p of this.players.values()) {
      if (p.life !== "alive") continue;
      const d = dist(e.x, e.y, p.x, p.y);
      if (d > e.spec.attackRange + e.spec.radius + 14) continue;
      if (angleDiff(angleOf(p.x - e.x, p.y - e.y), a.ang) > 55 * DEG && d > 26) continue;
      this.damagePlayer(p, dmg, e);
    }
  }

  // ---- boss --------------------------------------------------------------------
  private tickBoss(e: SimEnemy) {
    const hpFrac = e.hp / e.maxHp;
    if (e.phase === 1 && hpFrac <= BOSS.phase2At) {
      e.phase = 2;
      e.state = "roar";
      e.t = 1.4;
      e.attack = null;
      this.clearBossHazards(e);
      this.fx.push({ t: "msg", key: "boss_phase2" });
    }
    if (e.reinforced < BOSS.reinforceAt.length && hpFrac <= BOSS.reinforceAt[e.reinforced]) {
      const wave: string[] = e.reinforced === 0 ? ["pursuer", "pursuer", "ranged"] : ["pursuer*", "pursuer", "armored", "support"];
      e.reinforced++;
      const sp = MAP.sections[2].spawnPoints;
      wave.forEach((k, i) => this.spawnQueue.push({ ...parseSpawn(k), x: sp[i % sp.length].x, y: sp[i % sp.length].y, required: true }));
      this.fx.push({ t: "msg", key: "boss_reinforce" });
    }
    if (e.phase === 2) {
      this.poolT -= DT;
      const pools = [...this.hazards.values()].filter((h) => h.kind === "pool").length;
      if (this.poolT <= 0 && pools < BOSS.pools.max) {
        this.poolT = BOSS.pools.every;
        const ar = MAP.sections[2].arena;
        const edge = this.rng() < 0.5;
        const x = ar.x + 80 + this.rng() * (ar.w - 160);
        const y = edge ? ar.y + 60 + this.rng() * 80 : ar.y + ar.h - 60 - this.rng() * 80;
        this.addHazard({ kind: "pool", side: "enemy", ownerId: e.id, x, y, r: BOSS.pools.radius, delay: 1.2, life: BOSS.pools.duration, dps: BOSS.pools.dps * this.dmgMult, slow: 0.3, vx: 0, vy: 0, stagger: 0, hitOnce: false });
      }
    }
    const target = this.nearestPlayer(e.x, e.y);
    e.target = target?.id ?? null;
    if (e.state === "roar" || e.state === "stagger" || e.state === "recover" || e.state === "flinch") {
      e.t -= DT;
      if (e.t <= 0) e.state = "move";
      return;
    }
    if (e.state === "windup") {
      e.t -= DT * (1 - this.slowOf(e) * 0.5);
      if (e.t <= 0) this.bossStrike(e);
      return;
    }
    if (!target) return;
    const d = dist(e.x, e.y, target.x, target.y);
    this.faceTo(e, target.x, target.y);
    if (e.cd > 0) {
      if (d > 150) this.moveEnemy(e, target.x, target.y);
      return;
    }
    let next = e.bossCombo.shift();
    if (!next) {
      if (e.phase === 1) next = d < 210 ? "sweep" : "strikes";
      else {
        e.bossCombo = d < 210 ? ["strikes"] : ["sweep"];
        next = d < 210 ? "sweep" : "strikes";
      }
    }
    if (next === "sweep" && d > 260) {
      this.moveEnemy(e, target.x, target.y, 1.3);
      e.bossCombo.unshift("sweep");
      return;
    }
    e.state = "windup";
    e.t = next === "sweep" ? BOSS_SWEEP_WINDUP(e.phase) : 0.5;
    e.attack = { kind: next, ang: angleOf(target.x - e.x, target.y - e.y), tx: target.x, ty: target.y };
    if (next === "strikes") {
      const n = e.phase === 1 ? BOSS.strikesPhase1 : BOSS.strikesPhase2;
      const alive = [...this.players.values()].filter((p) => p.life === "alive");
      const ar = MAP.sections[2].arena;
      for (let i = 0; i < n; i++) {
        // One aimed strike per player; the rest land elsewhere in the arena as pressure.
        const p = alive[i];
        const x = p ? p.x : ar.x + 80 + this.rng() * (ar.w - 160);
        const y = p ? p.y : ar.y + 60 + this.rng() * (ar.h - 120);
        this.addHazard({ kind: "strike", side: "enemy", ownerId: e.id, x, y, r: BOSS.strikeRadius, delay: BOSS.strikeDelay + i * 0.12, life: 0.1, dps: e.spec.damage * 0.8 * this.dmgMult, slow: 0, vx: 0, vy: 0, stagger: 0, hitOnce: true });
      }
    }
  }

  private bossStrike(e: SimEnemy) {
    const a = e.attack;
    e.state = "recover";
    e.t = e.phase === 1 ? e.spec.recover : e.spec.recover * 0.7;
    e.cd = e.phase === 1 ? e.spec.cooldown : e.spec.cooldown * 0.75;
    e.attack = null;
    if (!a) return;
    if (a.kind === "sweep") {
      for (const p of this.players.values()) {
        if (p.life !== "alive") continue;
        const d = dist(e.x, e.y, p.x, p.y);
        if (d > e.spec.attackRange + 14) continue;
        if (angleDiff(angleOf(p.x - e.x, p.y - e.y), a.ang) > (BOSS.sweepArcDeg / 2) * DEG && d > e.spec.radius + 10) continue;
        this.damagePlayer(p, e.spec.damage * this.dmgMult, e, "sweep");
      }
    }
  }

  private pylonsAlive() {
    let n = 0;
    for (const e of this.enemies.values()) if (e.kind === "pylon") n++;
    return n;
  }

  private spawnPylons() {
    const ar = MAP.sections[2].arena;
    const cx = ar.x + ar.w / 2;
    const cy = ar.y + ar.h / 2;
    const existing = this.pylonsAlive();
    for (let i = existing; i < WARDEN.pylons; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / WARDEN.pylons;
      const p = this.spawn("pylon", cx + Math.cos(a) * WARDEN.pylonRadius, cy + Math.sin(a) * WARDEN.pylonRadius * 0.75);
      if (p) {
        p.state = "idle";
        p.t = 9999;
      }
    }
    this.fx.push({ t: "msg", key: "warden_shield" });
  }

  // ---- second boss: Crystal Warden -----------------------------------------------
  private tickWarden(e: SimEnemy) {
    const W = WARDEN;
    if (!e.reinforced) {
      e.reinforced = 1; // first tick: raise the pylons
      this.spawnPylons();
    }
    const hpFrac = e.hp / e.maxHp;
    if (e.phase === 1 && hpFrac <= W.phase2At) {
      e.phase = 2;
      e.state = "roar";
      e.t = 1.4;
      e.attack = null;
      this.clearBossHazards(e);
      this.spawnPylons();
      this.fx.push({ t: "msg", key: "warden_phase2" });
    }
    const target = this.nearestPlayer(e.x, e.y);
    e.target = target?.id ?? null;
    if (e.state === "roar" || e.state === "stagger" || e.state === "recover" || e.state === "flinch") {
      e.t -= DT;
      if (e.t <= 0) e.state = "move";
      return;
    }
    if (e.state === "windup") {
      e.t -= DT * (1 - this.slowOf(e) * 0.5);
      if (e.t <= 0) this.wardenStrike(e);
      return;
    }
    if (!target) return;
    const d = dist(e.x, e.y, target.x, target.y);
    this.faceTo(e, target.x, target.y);
    if (d > 330) this.moveEnemy(e, target.x, target.y);
    else if (d < 150) this.moveEnemy(e, e.x - (target.x - e.x), e.y - (target.y - e.y), 0.7);
    if (e.cd > 0) return;
    if (!e.bossCombo.length) e.bossCombo = e.phase === 1 ? ["beam", "nova"] : ["beam", "blink", "nova", "nova"];
    const next = e.bossCombo.shift()!;
    const ang = angleOf(target.x - e.x, target.y - e.y);
    e.state = "windup";
    e.attack = { kind: next, ang, tx: target.x, ty: target.y };
    if (next === "beam") {
      e.t = W.beam.windup;
      const spin = (this.rng() < 0.5 ? -1 : 1) * W.beam.spin * (e.phase === 2 ? 1.15 : 1);
      const beams = e.phase === 2 ? [ang, ang + Math.PI] : [ang];
      for (const a of beams) {
        this.addHazard({ kind: "beam", side: "enemy", ownerId: e.id, x: e.x, y: e.y, r: W.beam.width / 2, delay: W.beam.windup, life: W.beam.duration, dps: e.spec.damage * W.beam.dps * this.dmgMult, slow: 0, stagger: 0, hitOnce: false, ang: a, len: W.beam.length, spin });
      }
    } else if (next === "nova") e.t = W.nova.windup;
    else e.t = W.blink.windup;
  }

  private wardenStrike(e: SimEnemy) {
    const W = WARDEN;
    const a = e.attack;
    e.attack = null;
    e.state = "recover";
    e.t = e.spec.recover * (e.phase === 2 ? 0.7 : 1);
    e.cd = e.spec.cooldown * (e.phase === 2 ? 0.75 : 1);
    if (!a) return;
    if (a.kind === "beam") {
      e.t = W.beam.duration * 0.85; // stands still while the beam sweeps
      return;
    }
    if (a.kind === "blink") {
      const ar = MAP.sections[2].arena;
      for (let i = 0; i < 16; i++) {
        const x = ar.x + 120 + this.rng() * (ar.w - 240);
        const y = ar.y + 80 + this.rng() * (ar.h - 160);
        let ok = true;
        for (const p of this.players.values()) if (p.life === "alive" && dist(p.x, p.y, x, y) < W.blink.minDistance) ok = false;
        if (ok || i === 15) {
          e.x = x;
          e.y = y;
          break;
        }
      }
      this.fx.push({ t: "msg", key: "warden_blink" });
      this.wardenNova(e, 6, 0);
      return;
    }
    this.wardenNova(e, e.phase === 2 ? W.nova.shotsPhase2 : W.nova.shots, 0);
    if (e.phase === 2) this.wardenNova(e, W.nova.shotsPhase2, 0.45, Math.PI / W.nova.shotsPhase2);
  }

  private wardenNova(e: SimEnemy, count: number, delay: number, offset = 0) {
    const W = WARDEN;
    const base = this.rng() * Math.PI * 2 + offset;
    for (let i = 0; i < count; i++) {
      const a = base + (i * 2 * Math.PI) / count;
      this.addHazard({ kind: "shard", side: "enemy", ownerId: e.id, x: e.x, y: e.y, r: 12, delay, life: 2.6, dps: e.spec.damage * W.nova.damage * this.dmgMult, slow: 0, vx: Math.cos(a) * W.nova.speed, vy: Math.sin(a) * W.nova.speed, stagger: 0, hitOnce: true });
    }
  }

  private clearBossHazards(e: SimEnemy) {
    for (const [id, h] of this.hazards) if (h.ownerId === e.id && ((h.kind === "strike" && h.delay > 0.3) || h.kind === "beam")) this.hazards.delete(id);
  }

  /** Set when the boss dies: who was there and how much they contributed (for loot crates). */
  bossKill: { x: number; y: number; players: { id: string; eligible: boolean; level: number; stats: SimPlayer["stats"] }[] } | null = null;

  private onBossDead(boss: SimEnemy) {
    this.bossKill = {
      x: boss.x,
      y: boss.y,
      players: [...this.players.values()]
        .filter((p) => p.life !== "departed")
        .map((p) => ({ id: p.id, eligible: p.participation.get(3)?.eligibleSoFar() ?? false, level: p.loadout.level, stats: { ...p.stats } })),
    };
    // The unstable biomass collapses with its core.
    for (const e of [...this.enemies.values()]) {
      this.enemies.delete(e.id);
      this.fx.push({ t: "death", id: e.id, kind: e.kind, x: e.x, y: e.y });
    }
    this.spawnQueue = [];
    for (const [id, h] of this.hazards) if (h.side === "enemy") this.hazards.delete(id);
    this.stage = "s3_extract";
    this.fx.push({ t: "msg", key: "extract" });
  }

  private separateEnemies() {
    const list = [...this.enemies.values()];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const min = a.spec.radius + b.spec.radius;
        const d = dist(a.x, a.y, b.x, b.y);
        if (d >= min || d === 0) continue;
        const push = (min - d) / 2;
        const nx = (b.x - a.x) / d;
        const ny = (b.y - a.y) / d;
        if (a.kind !== "boss" && a.kind !== "pylon") {
          const m = moveOnGround(a.x, a.y, -nx * push, -ny * push, this.maxX, a.spec.radius * 0.6);
          a.x = m.x;
          a.y = m.y;
        }
        if (b.kind !== "boss" && b.kind !== "pylon") {
          const m = moveOnGround(b.x, b.y, nx * push, ny * push, this.maxX, b.spec.radius * 0.6);
          b.x = m.x;
          b.y = m.y;
        }
      }
    }
  }

  // ---- hazards -------------------------------------------------------------------
  private addHazard(h: Omit<Hazard, "id" | "vx" | "vy"> & { vx?: number; vy?: number }) {
    const id = `h${this.nextId++}`;
    this.hazards.set(id, { vx: 0, vy: 0, ...h, id });
  }

  private tickHazards() {
    for (const [id, h] of this.hazards) {
      if (h.delay > 0) {
        h.delay -= DT;
        if (h.delay > 0) continue;
        // becomes active
      }
      if (h.kind === "beam") {
        const owner = this.enemies.get(h.ownerId);
        if (owner) {
          h.x = owner.x;
          h.y = owner.y;
        }
        h.ang = (h.ang ?? 0) + (h.spin ?? 0) * DT;
        const dx = Math.cos(h.ang);
        const dy = Math.sin(h.ang);
        for (const p of this.players.values()) {
          if (p.life !== "alive" || p.iframes > 0) continue;
          const rx = p.x - h.x;
          const ry = p.y - h.y;
          const along = rx * dx + ry * dy;
          const perp = Math.abs(-rx * dy + ry * dx);
          if (along > 0 && along < (h.len ?? 0) && perp <= h.r + 14) this.damagePlayerTick(p, h.dps * DT);
        }
        h.life -= DT;
        if (h.life <= 0 || !owner) this.hazards.delete(id);
        continue;
      }
      if (h.kind === "shot" || h.kind === "shard") {
        h.x += h.vx * DT;
        h.y += h.vy * DT;
        let hit = false;
        for (const p of this.players.values()) {
          if (p.life !== "alive") continue;
          if (dist(h.x, h.y, p.x, p.y) <= h.r + 14) {
            this.damagePlayer(p, h.dps, undefined, "shot");
            hit = true;
            break;
          }
        }
        h.life -= DT;
        if (hit || h.life <= 0 || !inAnyWalkable(h.x, h.y)) this.hazards.delete(id);
        continue;
      }
      if (h.hitOnce) {
        if (h.side === "enemy") {
          for (const p of this.players.values()) if (p.life === "alive" && dist(h.x, h.y, p.x, p.y) <= h.r + 14) this.damagePlayer(p, h.dps, undefined, h.kind);
        } else {
          const owner = this.players.get(h.ownerId);
          if (owner) for (const e of [...this.enemies.values()]) if (dist(h.x, h.y, e.x, e.y) <= h.r + e.spec.radius) this.damageEnemy(owner, e, h.dps, h.stagger, true, 10, h.x, h.y, "aftershock");
        }
        this.hazards.delete(id);
        continue;
      }
      // persistent zone
      if (h.side === "enemy") {
        for (const p of this.players.values()) if (p.life === "alive" && dist(h.x, h.y, p.x, p.y) <= h.r + 10 && p.iframes <= 0) this.damagePlayerTick(p, h.dps * DT);
      } else if (h.dps > 0 && this.tickCount % 10 === 0) {
        const owner = this.players.get(h.ownerId);
        if (owner) for (const e of [...this.enemies.values()]) if (dist(h.x, h.y, e.x, e.y) <= h.r + e.spec.radius) this.damageEnemy(owner, e, h.dps * 0.5, 0, false, 0, h.x, h.y, "zone");
      }
      h.life -= DT;
      if (h.life <= 0) this.hazards.delete(id);
    }
  }

  private dotAcc = new Map<string, number>();
  private damagePlayerTick(p: SimPlayer, amount: number) {
    const acc = (this.dotAcc.get(p.id) ?? 0) + amount;
    if (acc >= 1) {
      const whole = Math.floor(acc);
      this.dotAcc.set(p.id, acc - whole);
      if (p.shield > 0) {
        const a = Math.min(p.shield, whole);
        p.shield -= a;
        if (whole - a > 0) p.hp = Math.max(0, p.hp - (whole - a));
      } else p.hp = Math.max(0, p.hp - whole);
      if (p.hp <= 0 && p.life === "alive") {
        p.hp = 1;
        this.damagePlayer(p, 1);
      }
    } else this.dotAcc.set(p.id, acc);
  }

  // ---- mission director ----------------------------------------------------------
  private anyPlayer(pred: (p: SimPlayer) => boolean) {
    for (const p of this.players.values()) if (p.life === "alive" && pred(p)) return true;
    return false;
  }

  private tickDirector() {
    const sp1 = MAP.sections[0].spawnPoints;
    switch (this.stage) {
      case "s1_corridor":
        if (this.anyPlayer((p) => p.x > 640)) {
          this.stage = "s1_waves";
          this.waveIndex = 0;
          this.spawnWave(WAVES_S1[0], sp1);
          this.waveIndex = 1;
        }
        this.objective = 0;
        break;
      case "s1_waves": {
        const alive = this.enemies.size + this.spawnQueue.length;
        if (this.waveIndex < WAVES_S1.length && alive <= 2) {
          this.spawnWave(WAVES_S1[this.waveIndex], sp1);
          this.waveIndex++;
        }
        this.objective = Math.round((Math.max(0, this.waveIndex - 1) / WAVES_S1.length) * 100);
        if (this.waveIndex >= WAVES_S1.length && alive === 0) {
          this.objective = 100;
          this.completeSection(1);
          this.stage = "s2_activate";
          this.objective = 0;
          this.spawn("pursuer", 2150, 200);
          this.spawn("pursuer", 2150, 400);
          this.spawn("ranged", 2500, 300);
        }
        break;
      }
      case "s2_activate": {
        const st = MAP.stabilizer;
        if (this.anyPlayer((p) => dist(p.x, p.y, st.x, st.y) <= st.activateRadius)) {
          this.activateProgress += DT / 1.5;
          for (const p of this.players.values()) if (p.life === "alive" && dist(p.x, p.y, st.x, st.y) <= st.activateRadius) this.objectiveWork(p);
        }
        this.objective = Math.round(Math.min(1, this.activateProgress) * 10);
        if (this.activateProgress >= 1) {
          this.stage = "s2_defend";
          this.objective = 0;
          this.defendSpawnT = 1;
          this.fx.push({ t: "msg", key: "defend" });
        }
        break;
      }
      case "s2_defend": {
        const st = MAP.stabilizer;
        let inZone = false;
        for (const p of this.players.values()) {
          if (p.life === "alive" && dist(p.x, p.y, st.x, st.y) <= st.radius) {
            inZone = true;
            this.objectiveWork(p);
          }
        }
        if (inZone) this.objective = Math.min(100, this.objective + 0.42 * DT);
        this.defendSpawnT -= DT;
        if (this.defendSpawnT <= 0 && this.objective < 100 && this.enemies.size + this.spawnQueue.length < 7) {
          this.defendSpawnT = 6.5;
          const sp = MAP.sections[1].spawnPoints;
          const group = DEFEND_GROUPS[this.defendSpawnIdx % DEFEND_GROUPS.length];
          const p = sp[this.defendSpawnIdx % sp.length];
          group.forEach((k, i) => this.spawnQueue.push({ ...parseSpawn(k), x: p.x - i * 20, y: p.y + (i % 2 ? 20 : -20), required: true }));
          this.defendSpawnIdx++;
        }
        if (this.objective >= 30 && !this.defendSpecials.has("support")) {
          this.defendSpecials.add("support");
          this.spawnQueue.push({ kind: "support", x: 2750, y: 300, required: true });
        }
        if (this.objective >= 60 && !this.defendSpecials.has("armored")) {
          this.defendSpecials.add("armored");
          this.spawnQueue.push({ kind: "armored", x: 2750, y: 150, required: true });
        }
        if (this.objective >= 100) {
          this.objective = 100;
          this.stage = "s2_clear";
          this.fx.push({ t: "msg", key: "stabilized" });
        }
        break;
      }
      case "s2_clear":
        if (this.enemies.size === 0 && this.spawnQueue.length === 0) {
          this.completeSection(2);
          this.stage = "s3_approach";
          this.objective = 0;
        }
        break;
      case "s3_approach":
        if (this.anyPlayer((p) => p.x > 3250)) {
          this.stage = "s3_boss";
          this.spawn("boss", MAP.bossSpawn.x, MAP.bossSpawn.y);
          this.fx.push({ t: "msg", key: "boss" });
        }
        break;
      case "s3_boss": {
        const b = this.bossId ? this.enemies.get(this.bossId) : null;
        this.objective = b ? Math.round((1 - b.hp / b.maxHp) * 100) : 100;
        break;
      }
      case "s3_extract": {
        const ex = MAP.extraction;
        let any = false;
        for (const p of this.players.values()) {
          if (p.life === "alive" && dist(p.x, p.y, ex.x, ex.y) <= ex.radius) {
            any = true;
            this.objectiveWork(p);
          }
        }
        if (any) this.extractT += DT;
        this.objective = Math.round(Math.min(1, this.extractT / 3) * 100);
        if (this.extractT >= 3) {
          this.completeSection(3);
          this.result = "success";
          this.stage = "done";
        }
        break;
      }
    }
  }

  private objectiveWork(p: SimPlayer) {
    p.stats.objectiveSeconds += DT;
    this.useful(p);
    this.gainOd(p, OVERDRIVE.gainPerObjectiveSecond * DT);
  }

  private spawnWave(kinds: string[], points: { x: number; y: number }[]) {
    kinds.forEach((k, i) => {
      const p = points[i % points.length];
      this.spawnQueue.push({ ...parseSpawn(k), x: p.x - Math.floor(i / points.length) * 30, y: p.y, required: true });
    });
  }


  private completeSection(id: number) {
    const eligibility = new Map<string, boolean>();
    for (const p of this.players.values()) {
      const part = p.participation.get(id);
      if (!part) continue;
      part.closeWindow();
      eligibility.set(p.id, p.life !== "departed" && part.eligible());
    }
    this.clears.push({ sectionId: id, eligibility });
    this.fx.push({ t: "section", id });
    if (id < 3) {
      this.section = id + 1;
      this.maxX = MAP.sections[id].gateX;
      const cp = MAP.sections[id].checkpoint;
      let i = 0;
      for (const p of this.players.values()) {
        if (p.life === "departed") continue;
        p.participation.set(this.section, new SectionParticipation());
        if (p.life === "alive") p.hp = p.maxHp; // checkpoint restore
        if (p.life === "waiting" || p.life === "downed") {
          const c = clampToWalkable(cp.x + (i % 3) * 30, cp.y - 40 + i * 12, this.maxX);
          p.x = c.x;
          p.y = c.y;
          p.life = "alive";
          p.hp = p.maxHp;
          p.iframes = 1.5;
          this.fx.push({ t: "revive", id: p.id, by: "" });
        }
        i++;
      }
    }
  }

  drainClears(): SectionClear[] {
    const out = this.clears;
    this.clears = [];
    return out;
  }

  // ---- participation -----------------------------------------------------------
  private useful(p: SimPlayer) {
    p.participation.get(this.section)?.markUseful(p.connected);
  }

  private sampleParticipation() {
    const closeNow = this.tickCount % Math.round(ACTIVITY.windowSeconds / DT) === 0;
    for (const p of this.players.values()) {
      if (p.life === "departed") continue;
      const part = p.participation.get(this.section);
      if (!part) continue;
      part.tick({ able: p.life === "alive", downed: p.life === "downed", connected: p.connected });
      if (closeNow) part.closeWindow();
    }
  }
}

function BOSS_SWEEP_WINDUP(phase: number) {
  return phase === 1 ? ENEMY_SPECS.boss.windup : ENEMY_SPECS.boss.windup * 0.8;
}

function inAnyWalkable(x: number, y: number) {
  return MAP.walkable.some((r) => inRect(r, x, y, -10));
}

export function hashString(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// "*" marks an elite (random affix, more HP, guaranteed bio-cell).
const WAVES_S1: string[][] = [
  ["pursuer", "pursuer", "pursuer", "pursuer"],
  ["pursuer", "pursuer", "ranged", "ranged", "pursuer"],
  ["armored", "pursuer", "pursuer*", "ranged"],
  ["pursuer", "pursuer", "support", "ranged", "pursuer"],
  ["armored", "armored", "pursuer", "ranged*", "pursuer"],
  ["pursuer*", "armored*", "ranged", "pursuer", "support"],
];

const DEFEND_GROUPS: string[][] = [
  ["pursuer", "pursuer", "pursuer"],
  ["pursuer", "ranged"],
  ["pursuer", "pursuer", "ranged"],
  ["armored", "pursuer"],
  ["pursuer*", "ranged", "pursuer"],
];

function parseSpawn(s: string): { kind: EnemyKind; elite: boolean } {
  return { kind: s.replace("*", "") as EnemyKind, elite: s.endsWith("*") };
}
