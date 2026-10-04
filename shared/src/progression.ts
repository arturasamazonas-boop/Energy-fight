import { PLAYER, REWARDS, TIERS, type TierSpec } from "./config.ts";

export function xpToNext(level: number): number {
  return 80 + 30 * (level - 1);
}

export interface LevelState {
  level: number;
  xp: number; // xp within the current level
}

/** Applies XP with overflow across several levels; XP beyond the cap is discarded. */
export function applyXp(state: LevelState, amount: number): LevelState & { levelsGained: number; xpApplied: number } {
  let { level, xp } = state;
  let remaining = Math.max(0, Math.floor(amount));
  let applied = 0;
  const startLevel = level;
  while (remaining > 0 && level < PLAYER.levelCap) {
    const need = xpToNext(level) - xp;
    if (remaining >= need) {
      remaining -= need;
      applied += need;
      level += 1;
      xp = 0;
    } else {
      xp += remaining;
      applied += remaining;
      remaining = 0;
    }
  }
  if (level >= PLAYER.levelCap) xp = 0;
  return { level, xp, levelsGained: level - startLevel, xpApplied: applied };
}

export function damageScale(level: number): number {
  return 1 + 0.08 * (level - 1);
}
export function healthScale(level: number): number {
  return 1 + 0.1 * (level - 1);
}

export function tierSpec(tier: number): TierSpec {
  const t = TIERS.find((x) => x.tier === tier);
  if (!t) throw new Error(`unknown tier ${tier}`);
  return t;
}

export function carryMultiplier(recommendedLevel: number, levelAtRunStart: number): number {
  const raw = 1 + REWARDS.carrySlope * (recommendedLevel - levelAtRunStart);
  return Math.min(REWARDS.carryMax, Math.max(REWARDS.carryMin, raw));
}

export function fullClearXp(tier: number, levelAtRunStart: number): number {
  const t = tierSpec(tier);
  return Math.round(t.baseXp * carryMultiplier(t.recommendedLevel, levelAtRunStart));
}

/** Section XP split: 25% / 25% / remainder so the sum is exactly the full clear. */
export function sectionXp(fullXp: number): [number, number, number] {
  const a = Math.floor(fullXp * REWARDS.sectionShares[0]);
  const b = Math.floor(fullXp * REWARDS.sectionShares[1]);
  return [a, b, fullXp - a - b];
}

export function partyScaling(n: number) {
  const extra = Math.max(0, n - 1);
  return {
    regularHp: 1 + 0.45 * extra,
    bossHp: 1 + 0.6 * extra,
    damage: 1 + 0.04 * extra,
  };
}

/** Deterministic hash → [0,1) for bonus drops so retries can never re-roll. */
export function stableRandom(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

export interface SectionMaterials {
  salvage: number;
  fragments: number;
  bonus: boolean;
}
export function sectionMaterials(tier: number, runId: string, sectionId: number, profileId: string): SectionMaterials {
  const t = tierSpec(tier);
  const bonus = stableRandom(`${runId}:${sectionId}:${profileId}`) < REWARDS.bonusDropChance;
  return {
    salvage: t.salvagePerSection + (bonus ? REWARDS.bonusDropSalvage : 0),
    fragments: t.fragmentsPerSection,
    bonus,
  };
}
