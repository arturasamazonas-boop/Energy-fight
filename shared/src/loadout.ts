import {
  LINEAGE_SPECS,
  MODULES,
  MODULE_MAX_RANK,
  PLAYER,
  UNLOCKS,
  type LineageId,
  type LineageSpec,
  type Patch,
} from "./config.ts";
import { damageScale, healthScale } from "./progression.ts";

export interface LineageRecord {
  lineage: LineageId;
  level: number;
  xp: number;
  evolution: string | null;
  modifier: string | null;
  fragments: number;
  moduleEquipped: string | null;
  moduleRanks: Record<string, number>;
}

export interface Loadout {
  lineage: LineageId;
  level: number;
  evolution: string | null;
  modifier: string | null;
  module: { id: string; rank: number } | null;
  spec: LineageSpec; // patched copy
  maxHp: number;
  damage: number;
  moveSpeed: number;
  hasSkill2: boolean;
  hasOverdrive: boolean;
  mastery: boolean;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

export function applyPatch(target: any, patch: Patch) {
  const parts = patch.path.split(".");
  let obj = target;
  for (let i = 0; i < parts.length - 1; i++) {
    if (obj[parts[i]] === undefined) obj[parts[i]] = {};
    obj = obj[parts[i]];
  }
  const key = parts[parts.length - 1];
  if (patch.op === "set") obj[key] = clone(patch.value);
  else if (patch.op === "mul") obj[key] = (obj[key] ?? 0) * (patch.value as number);
  else if (patch.op === "add") obj[key] = (obj[key] ?? 0) + (patch.value as number);
}

export function evolutionIds(lineage: LineageId): [string, string] {
  const e = LINEAGE_SPECS[lineage].evolutions;
  return [e[0].id, e[1].id];
}
export function modifierIds(lineage: LineageId): [string, string] {
  const m = LINEAGE_SPECS[lineage].modifiers;
  return [m[0].id, m[1].id];
}

export function buildLoadout(rec: LineageRecord): Loadout {
  const spec = clone(LINEAGE_SPECS[rec.lineage]);
  const level = Math.max(1, Math.min(PLAYER.levelCap, rec.level));
  let evolution: string | null = null;
  if (level >= UNLOCKS.evolution && rec.evolution) {
    const evo = spec.evolutions.find((e) => e.id === rec.evolution);
    if (evo) {
      evo.patches.forEach((p) => applyPatch(spec, p));
      evolution = evo.id;
    }
  }
  let modifier: string | null = null;
  if (level >= UNLOCKS.modifier && rec.modifier) {
    const mod = spec.modifiers.find((m) => m.id === rec.modifier);
    if (mod) {
      mod.patches.forEach((p) => applyPatch(spec, p));
      modifier = mod.id;
    }
  }
  let module: Loadout["module"] = null;
  if (rec.moduleEquipped) {
    const m = MODULES.find((x) => x.id === rec.moduleEquipped);
    const rank = Math.min(MODULE_MAX_RANK, Math.max(0, rec.moduleRanks[rec.moduleEquipped] ?? 0));
    if (m && rank > 0) {
      for (let r = 0; r < rank; r++) m.perRank.forEach((p) => applyPatch(spec, p));
      module = { id: m.id, rank };
    }
  }
  return {
    lineage: rec.lineage,
    level,
    evolution,
    modifier,
    module,
    spec,
    maxHp: Math.round(PLAYER.baseHp * spec.hpMult * healthScale(level)),
    damage: PLAYER.baseDamage * spec.damageMult * damageScale(level),
    moveSpeed: PLAYER.moveSpeed * spec.speedMult,
    hasSkill2: level >= UNLOCKS.skill2,
    hasOverdrive: level >= UNLOCKS.overdrive,
    mastery: level >= UNLOCKS.mastery,
  };
}

export function defaultLineageRecord(lineage: LineageId): LineageRecord {
  return { lineage, level: 1, xp: 0, evolution: null, modifier: null, fragments: 0, moduleEquipped: null, moduleRanks: {} };
}

/** Lists unlocks that become available when going from level a to level b. */
export function unlocksBetween(a: number, b: number): string[] {
  const out: string[] = [];
  for (const [k, lvl] of Object.entries(UNLOCKS)) if (lvl > a && lvl <= b) out.push(k);
  return out;
}
