// All tunable gameplay numbers live here. They are starting parameters for
// playtesting, not a claim of balance. validateConfig() runs in tests and at
// server boot so a bad edit fails loudly.

export const LINEAGES = ["pyra", "krios", "vektor", "litos"] as const;
export type LineageId = (typeof LINEAGES)[number];

export const NET = {
  tickHz: 20,
  patchMs: 50,
  maxInputsPerSecond: 40,
  maxActionsPerSecond: 12,
  reconnectSeconds: 90,
  maxPlayers: 8,
} as const;

export const WORLD = {
  // Oblique projection: screenX = x, screenY = y * depthScale - z.
  depthScale: 0.62,
  playerRadius: 16,
};

export const PLAYER = {
  baseHp: 240,
  baseDamage: 20,
  moveSpeed: 190, // ground units per second
  dodgeDistance: 120,
  dodgeDuration: 0.18,
  dodgeInvuln: 0.22,
  dodgeCooldown: 0.9,
  targetAssistRange: 70, // beyond attack reach
  targetAssistAngleDeg: 55,
  downedBleedSeconds: 20,
  reviveRadius: 70,
  reviveSeconds: 2.5,
  reviveHpFraction: 0.4,
  levelCap: 20,
  calmRegenPerSecond: 0.03,
} as const;

export const OVERDRIVE = {
  max: 100,
  duration: 8,
  maxGainPerSecond: 6,
  gainPerHit: 1.6,
  gainPerDefensive: 6,
  gainPerReviveSecond: 6,
  gainPerObjectiveSecond: 2,
  gainPerDamageTakenPct: 0.25,
} as const;

export const ACTIVITY = {
  windowSeconds: 3,
  nearEnemyRange: 260,
  squadRange: 380,
  minMoveDistance: 30,
} as const;

export const ENEMY_CAP = 24;

// Bio-cell pickups heal everyone near the pickup when collected.
export const PICKUPS = { healFraction: 0.22, shareRadius: 140, collectRadius: 34, life: 20, dropChance: 0.14, guaranteed: ["armored", "support"] as string[] };

// ---- Attack / status primitives -------------------------------------------

export type StatusId = "heat" | "chill" | "armorBreak";

export interface ZoneSpec {
  kind: "scorch" | "frost";
  radius: number;
  duration: number;
  dps: number; // as multiplier of player base damage per second
  slow: number;
}

export interface AttackSpec {
  shape: "arc" | "circle" | "line";
  range: number; // arc radius / line length / circle radius
  arcDeg?: number;
  width?: number;
  offset?: number; // circle centre distance in front of the user
  damage: number; // multiplier of player damage
  stagger: number;
  flinch: boolean;
  knockback: number;
  applyStatus?: { id: StatusId; stacks: number; value?: number; duration?: number };
  consume?: {
    id: StatusId;
    minStacks: number;
    bonusPerStack: number; // extra damage multiplier per consumed stack
    spread?: { radius: number; damage: number }; // reduced detonation to nearby marked enemies
    shieldPerStack?: number;
    fragments?: { count: number; range: number; damage: number };
  };
  zone?: ZoneSpec;
  selfShield?: { amount: number; duration: number };
  pull?: { radius: number; strength: number };
  dash?: { distance: number; duration: number };
  aftershock?: { delay: number; radius: number; damage: number; stagger: number };
  brace?: { window: number; perfectWindow: number; perfectBonus: number; shell?: { amount: number; duration: number } };
  firstTargetBonus?: number;
  areaFollowUp?: { radius: number; damage: number };
}

export interface SkillSpec {
  id: string;
  cooldown: number;
  windup: number; // seconds before the hit resolves
  recover: number; // lockout after the hit
  attack: AttackSpec;
}

export interface LineageSpec {
  id: LineageId;
  hpMult: number;
  damageMult: number;
  speedMult: number;
  combo: { hits: AttackSpec[]; interval: number[]; resetAfter: number };
  skill1: SkillSpec;
  skill2: SkillSpec;
  dodgeEmpower?: { window: number; bonus: number }; // vektor perfect-dodge empowered hit
  overdrive: { damageMult: number; cooldownRate: number; speedMult: number; damageTaken: number; extraStacks: number };
  evolutions: [EvolutionSpec, EvolutionSpec];
  modifiers: [ModifierSpec, ModifierSpec];
}

export type Patch = { path: string; op: "set" | "mul" | "add"; value: unknown };

export interface EvolutionSpec {
  id: string;
  patches: Patch[];
}
export interface ModifierSpec {
  id: string;
  patches: Patch[];
}

const arc = (range: number, arcDeg: number, damage: number, extra: Partial<AttackSpec> = {}): AttackSpec => ({
  shape: "arc",
  range,
  arcDeg,
  damage,
  stagger: 4,
  flinch: true,
  knockback: 8,
  ...extra,
});

export const LINEAGE_SPECS: Record<LineageId, LineageSpec> = {
  pyra: {
    id: "pyra",
    hpMult: 1.0,
    damageMult: 1.05,
    speedMult: 1.05,
    combo: {
      hits: [
        arc(62, 100, 0.8, { applyStatus: { id: "heat", stacks: 1, duration: 6 } }),
        arc(62, 100, 0.85, { applyStatus: { id: "heat", stacks: 1, duration: 6 } }),
        arc(70, 130, 1.25, { applyStatus: { id: "heat", stacks: 1, duration: 6 }, knockback: 20, stagger: 8 }),
      ],
      interval: [0.28, 0.28, 0.45],
      resetAfter: 0.7,
    },
    skill1: {
      id: "detonate",
      cooldown: 6,
      windup: 0.15,
      recover: 0.3,
      attack: {
        shape: "circle",
        range: 130,
        damage: 1.6,
        stagger: 12,
        flinch: true,
        knockback: 18,
        consume: { id: "heat", minStacks: 1, bonusPerStack: 0.7 },
      },
    },
    skill2: {
      id: "plasma_burst",
      cooldown: 9,
      windup: 0.25,
      recover: 0.35,
      attack: {
        shape: "line",
        range: 230,
        width: 70,
        damage: 2.0,
        stagger: 10,
        flinch: true,
        knockback: 30,
        applyStatus: { id: "heat", stacks: 1, duration: 6 },
        zone: { kind: "scorch", radius: 70, duration: 3, dps: 0.6, slow: 0 },
      },
    },
    overdrive: { damageMult: 1.3, cooldownRate: 1.3, speedMult: 1.1, damageTaken: 1, extraStacks: 1 },
    evolutions: [
      { id: "flare", patches: [{ path: "skill1.attack.consume.spread", op: "set", value: { radius: 150, damage: 0.55 } }] },
      { id: "furnace", patches: [{ path: "skill1.attack.consume.shieldPerStack", op: "set", value: 9 }] },
    ],
    modifiers: [
      { id: "pyra_cd", patches: [{ path: "skill1.cooldown", op: "mul", value: 0.8 }] },
      { id: "pyra_area", patches: [{ path: "skill1.attack.range", op: "mul", value: 1.25 }] },
    ],
  },
  krios: {
    id: "krios",
    hpMult: 0.95,
    damageMult: 1.0,
    speedMult: 1.0,
    combo: {
      hits: [
        arc(80, 60, 0.8, { applyStatus: { id: "chill", stacks: 1, duration: 4 } }),
        arc(80, 60, 0.8, { applyStatus: { id: "chill", stacks: 1, duration: 4 } }),
        arc(95, 70, 1.15, { applyStatus: { id: "chill", stacks: 2, duration: 4 }, stagger: 8 }),
      ],
      interval: [0.3, 0.3, 0.45],
      resetAfter: 0.7,
    },
    skill1: {
      id: "shard_cone",
      cooldown: 5.5,
      windup: 0.2,
      recover: 0.3,
      attack: {
        shape: "arc",
        range: 190,
        arcDeg: 50,
        damage: 1.5,
        stagger: 10,
        flinch: true,
        knockback: 10,
        consume: { id: "chill", minStacks: 3, bonusPerStack: 0.45 },
      },
    },
    skill2: {
      id: "frost_pulse",
      cooldown: 11,
      windup: 0.2,
      recover: 0.3,
      attack: {
        shape: "circle",
        range: 140,
        damage: 0.9,
        stagger: 8,
        flinch: true,
        knockback: 0,
        applyStatus: { id: "chill", stacks: 2, duration: 4 },
        selfShield: { amount: 45, duration: 4 },
        zone: { kind: "frost", radius: 120, duration: 3, dps: 0.15, slow: 0.35 },
      },
    },
    overdrive: { damageMult: 1.15, cooldownRate: 1.6, speedMult: 1.05, damageTaken: 0.9, extraStacks: 1 },
    evolutions: [
      { id: "prism", patches: [{ path: "skill1.attack.consume.fragments", op: "set", value: { count: 4, range: 110, damage: 0.5 } }] },
      {
        id: "glacier",
        patches: [
          { path: "skill2.attack.selfShield.amount", op: "mul", value: 1.8 },
          { path: "skill2.attack.zone.duration", op: "mul", value: 1.8 },
        ],
      },
    ],
    modifiers: [
      { id: "krios_cd", patches: [{ path: "skill1.cooldown", op: "mul", value: 0.8 }] },
      { id: "krios_area", patches: [{ path: "skill1.attack.arcDeg", op: "mul", value: 1.35 }] },
    ],
  },
  vektor: {
    id: "vektor",
    hpMult: 0.9,
    damageMult: 0.95,
    speedMult: 1.15,
    combo: {
      hits: [arc(58, 110, 0.65), arc(58, 110, 0.65), arc(66, 140, 0.95, { stagger: 6 })],
      interval: [0.2, 0.2, 0.34],
      resetAfter: 0.6,
    },
    dodgeEmpower: { window: 1.2, bonus: 1.0 },
    skill1: {
      id: "dash_cut",
      cooldown: 5,
      windup: 0.05,
      recover: 0.25,
      attack: {
        shape: "line",
        range: 200,
        width: 60,
        damage: 1.7,
        stagger: 10,
        flinch: true,
        knockback: 12,
        dash: { distance: 200, duration: 0.2 },
      },
    },
    skill2: {
      id: "vortex",
      cooldown: 10,
      windup: 0.3,
      recover: 0.35,
      attack: {
        shape: "circle",
        range: 170,
        offset: 60,
        damage: 0.8,
        stagger: 6,
        flinch: true,
        knockback: 0,
        pull: { radius: 170, strength: 90 },
      },
    },
    overdrive: { damageMult: 1.2, cooldownRate: 1.4, speedMult: 1.35, damageTaken: 1, extraStacks: 0 },
    evolutions: [
      { id: "tempest", patches: [{ path: "skill1.attack.areaFollowUp", op: "set", value: { radius: 110, damage: 0.7 } }] },
      {
        id: "raptor",
        patches: [
          { path: "skill1.attack.firstTargetBonus", op: "set", value: 0.8 },
          { path: "dodgeEmpower.bonus", op: "add", value: 0.6 },
        ],
      },
    ],
    modifiers: [
      { id: "vektor_cd", patches: [{ path: "skill1.cooldown", op: "mul", value: 0.8 }] },
      { id: "vektor_area", patches: [{ path: "skill2.attack.range", op: "mul", value: 1.3 }, { path: "skill2.attack.pull.radius", op: "mul", value: 1.3 }] },
    ],
  },
  litos: {
    id: "litos",
    hpMult: 1.3,
    damageMult: 1.1,
    speedMult: 0.88,
    combo: {
      hits: [
        arc(70, 110, 0.95, { stagger: 6 }),
        arc(70, 110, 1.0, { stagger: 6 }),
        arc(85, 150, 1.9, { stagger: 18, knockback: 30 }),
      ],
      interval: [0.42, 0.42, 0.7],
      resetAfter: 0.9,
    },
    skill1: {
      id: "brace_counter",
      cooldown: 6,
      windup: 0,
      recover: 0.35,
      attack: {
        shape: "arc",
        range: 100,
        arcDeg: 160,
        damage: 1.8,
        stagger: 20,
        flinch: true,
        knockback: 30,
        brace: { window: 0.6, perfectWindow: 0.6, perfectBonus: 1.2 },
      },
    },
    skill2: {
      id: "shockwave",
      cooldown: 9,
      windup: 0.35,
      recover: 0.4,
      attack: {
        shape: "circle",
        range: 160,
        damage: 1.4,
        stagger: 16,
        flinch: true,
        knockback: 20,
        applyStatus: { id: "armorBreak", stacks: 1, value: 0.2, duration: 5 },
      },
    },
    overdrive: { damageMult: 1.2, cooldownRate: 1.3, speedMult: 1.0, damageTaken: 0.6, extraStacks: 0 },
    evolutions: [
      { id: "monolith", patches: [{ path: "skill1.attack.brace.shell", op: "set", value: { amount: 70, duration: 4 } }] },
      { id: "seismic", patches: [{ path: "skill2.attack.aftershock", op: "set", value: { delay: 0.9, radius: 150, damage: 1.0, stagger: 12 } }] },
    ],
    modifiers: [
      { id: "litos_cd", patches: [{ path: "skill2.cooldown", op: "mul", value: 0.8 }] },
      { id: "litos_area", patches: [{ path: "skill2.attack.range", op: "mul", value: 1.25 }] },
    ],
  },
};

// ---- Modules ---------------------------------------------------------------
// One slot per lineage, three alternatives, max rank 3. Bonuses stay modest.
export interface ModuleSpec {
  id: string;
  perRank: Patch[];
}
export const MODULES: ModuleSpec[] = [
  { id: "capacitor", perRank: [{ path: "skill1.cooldown", op: "mul", value: 0.95 }] },
  { id: "amplifier", perRank: [{ path: "skill2.attack.damage", op: "mul", value: 1.06 }] },
  { id: "carapace", perRank: [{ path: "hpMult", op: "mul", value: 1.05 }] },
];
export const MODULE_MAX_RANK = 3;
export const MODULE_UPGRADE_COST = [15, 35, 60]; // salvage cost for rank 1,2,3

// ---- Unlock levels ---------------------------------------------------------
export const UNLOCKS = { skill2: 3, overdrive: 5, evolution: 10, modifier: 15, mastery: 20 } as const;

// ---- Enemies ---------------------------------------------------------------
export type EnemyKind = "pursuer" | "ranged" | "armored" | "support" | "boss" | "pylon";
export type BossVariant = "brood" | "warden";
export const BOSS_VARIANTS: BossVariant[] = ["brood", "warden"];

// ---- Daily challenge ---------------------------------------------------------
// Opt-in (leader toggles it in the lobby). A rotating rule makes the run harder;
// each player's first boss kill of the UTC day guarantees at least a gold box.
export type DailyMutator = "elites" | "frenzy" | "glass";
export const DAILY = {
  mutators: ["elites", "frenzy", "glass"] as DailyMutator[],
  eliteChance: 0.3, // elites: share of regular spawns promoted to elites
  frenzySpeed: 1.2, // frenzy: enemy movement and attack-rate multiplier
  glassDealt: 1.3, // glass: everyone hits harder…
  glassTaken: 1.3, // …and takes more damage
  minBox: "gold" as const,
  bonusSalvage: 40,
};
const DAY_MS = 86_400_000;
/** UTC calendar day, e.g. "2026-10-06". */
export function dailyKey(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}
export function dailyMutator(now = Date.now()): DailyMutator {
  return DAILY.mutators[Math.floor(now / DAY_MS) % DAILY.mutators.length];
}

export interface EnemySpec {
  kind: EnemyKind;
  hp: number;
  speed: number;
  radius: number;
  damage: number;
  armor: number; // damage reduction 0..1
  attackRange: number;
  windup: number;
  recover: number;
  cooldown: number;
  staggerThreshold: number; // stagger points needed to stagger (regular enemies flinch on hits anyway)
  slowCap: number;
}

export const ENEMY_SPECS: Record<EnemyKind, EnemySpec> = {
  pursuer: { kind: "pursuer", hp: 90, speed: 105, radius: 16, damage: 7, armor: 0, attackRange: 42, windup: 0.5, recover: 0.7, cooldown: 1.4, staggerThreshold: 20, slowCap: 0.6 },
  ranged: { kind: "ranged", hp: 70, speed: 85, radius: 15, damage: 10, armor: 0, attackRange: 300, windup: 0.85, recover: 0.6, cooldown: 2.4, staggerThreshold: 20, slowCap: 0.6 },
  armored: { kind: "armored", hp: 260, speed: 62, radius: 22, damage: 20, armor: 0.45, attackRange: 70, windup: 0.85, recover: 0.9, cooldown: 2.2, staggerThreshold: 45, slowCap: 0.5 },
  support: { kind: "support", hp: 110, speed: 70, radius: 17, damage: 6, armor: 0, attackRange: 0, windup: 2.0, recover: 1.0, cooldown: 7, staggerThreshold: 15, slowCap: 0.6 },
  boss: { kind: "boss", hp: 3000, speed: 70, radius: 46, damage: 20, armor: 0.1, attackRange: 170, windup: 0.95, recover: 0.9, cooldown: 1.6, staggerThreshold: 160, slowCap: 0.2 },
  pylon: { kind: "pylon", hp: 220, speed: 0, radius: 24, damage: 0, armor: 0, attackRange: 0, windup: 1, recover: 1, cooldown: 99, staggerThreshold: 99999, slowCap: 0 },
};

export const BOSS = {
  phase2At: 0.5,
  reinforceAt: [0.75, 0.3],
  strikeRadius: 70,
  strikeDelay: 1.25,
  strikesPhase1: 3,
  strikesPhase2: 5,
  sweepArcDeg: 150,
  staggerDuration: 2.5,
  staggerDamageTaken: 0.25,
  staggerThresholdGrowth: 1.35,
  pools: { max: 4, every: 7, radius: 60, duration: 12, dps: 6 },
} as const;

/** Second boss: the Crystal Warden. Shielded by pylons; beams, shard novas and blinks. */
export const WARDEN = {
  spec: { kind: "boss" as const, hp: 2200, speed: 48, radius: 44, damage: 18, armor: 0.1, attackRange: 520, windup: 1.2, recover: 1.0, cooldown: 1.8, staggerThreshold: 180, slowCap: 0.2 },
  shieldReduction: 0.85, // damage reduction while any pylon stands
  pylons: 3,
  pylonRadius: 300, // distance of pylons from the arena centre
  exposedStagger: 3.5, // seconds staggered when the last pylon breaks
  beam: { windup: 1.2, duration: 2.6, length: 540, width: 34, spin: 0.85, dps: 1.6 }, // dps × boss damage
  nova: { windup: 0.9, shots: 10, shotsPhase2: 14, speed: 230, damage: 0.8 },
  blink: { windup: 0.6, minDistance: 260 },
  phase2At: 0.5,
} as const;

export const SUPPORT = { channelSeconds: 2.0, maxChannels: 3, spawnPerChannel: 2, interruptDamageFraction: 0.12 } as const;

// ---- Mission tiers and scaling ---------------------------------------------
export interface TierSpec {
  tier: 1 | 2 | 3;
  recommendedLevel: number;
  baseXp: number;
  enemyHpMult: number;
  enemyDamageMult: number;
  salvagePerSection: number;
  fragmentsPerSection: number;
}

export const TIERS: TierSpec[] = [
  { tier: 1, recommendedLevel: 3, baseXp: 180, enemyHpMult: 1.0, enemyDamageMult: 1.0, salvagePerSection: 10, fragmentsPerSection: 1 },
  { tier: 2, recommendedLevel: 10, baseXp: 300, enemyHpMult: 2.3, enemyDamageMult: 1.5, salvagePerSection: 18, fragmentsPerSection: 2 },
  { tier: 3, recommendedLevel: 17, baseXp: 450, enemyHpMult: 4.2, enemyDamageMult: 2.1, salvagePerSection: 28, fragmentsPerSection: 3 },
];

export const PARTY_SCALING = { regularHpPerExtra: 0.45, bossHpPerExtra: 0.6, damagePerExtra: 0.04 } as const;

export const REWARDS = {
  sectionShares: [0.25, 0.25], // last section receives the remainder
  carrySlope: 0.1,
  carryMin: 0.25,
  carryMax: 1.5,
  bonusDropChance: 0.2,
  bonusDropSalvage: 5,
  supportLevelGap: 5,
} as const;

// ---- Validation ------------------------------------------------------------
export function validateConfig(): string[] {
  const errors: string[] = [];
  const pos = (v: number, name: string) => {
    if (!(typeof v === "number" && Number.isFinite(v) && v > 0)) errors.push(`${name} must be > 0 (got ${v})`);
  };
  for (const id of LINEAGES) {
    const l = LINEAGE_SPECS[id];
    if (l.id !== id) errors.push(`lineage id mismatch ${id}`);
    if (l.combo.hits.length !== 3 || l.combo.interval.length !== 3) errors.push(`${id}: combo must have 3 hits`);
    for (const s of [l.skill1, l.skill2]) {
      pos(s.cooldown, `${id}.${s.id}.cooldown`);
      pos(s.attack.range, `${id}.${s.id}.range`);
      if (s.attack.damage < 0) errors.push(`${id}.${s.id}.damage negative`);
    }
    if (l.evolutions.length !== 2) errors.push(`${id}: needs 2 evolutions`);
    for (const e of [...l.evolutions, ...l.modifiers]) {
      for (const p of e.patches) if (!p.path) errors.push(`${id}.${e.id}: empty patch path`);
    }
  }
  for (const k of Object.keys(ENEMY_SPECS) as EnemyKind[]) {
    const e = ENEMY_SPECS[k];
    pos(e.hp, `${k}.hp`);
    if (e.armor < 0 || e.armor >= 1) errors.push(`${k}.armor out of range`);
  }
  if (TIERS.map((t) => t.tier).join() !== "1,2,3") errors.push("tiers must be 1,2,3");
  if (MODULE_UPGRADE_COST.length !== MODULE_MAX_RANK) errors.push("module costs length");
  if (ENEMY_CAP > 40) errors.push("enemy cap too high");
  return errors;
}
