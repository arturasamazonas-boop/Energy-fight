// Boss loot: mineral crates (boxes) with equipment.
//
// Every eligible player who helped kill the boss gets their OWN crate. The crate
// tier depends on a fixed rare-drop chance (scaled by performance) and on the
// player's impact in the run, measured relative to the party and weighted by
// their level so a low-level player who plays well can still earn a good crate.
//
// Rarest tiers (at average performance, p = 0.5):
//   ULTRA MEGA ≈ 1 / 10 000, DIVINE ≈ 1 / 1 000, PLATINUM ≈ 1 / 100.
import type { LineageId } from "./config.ts";
import { damageScale } from "./progression.ts";

export const SLOTS = ["weapon", "shield", "helmet", "armor", "aura", "relic"] as const;
export type Slot = (typeof SLOTS)[number];

export const RARITIES = ["common", "rare", "epic", "legendary", "mythic", "ultra"] as const;
export type Rarity = (typeof RARITIES)[number];

export const BOX_TIERS = ["bronze", "silver", "gold", "platinum", "divine", "ultra"] as const;
export type BoxTier = (typeof BOX_TIERS)[number];

export type StatId = "damage" | "health" | "armor" | "cooldown" | "speed" | "crit" | "overdrive";
export const STATS: StatId[] = ["damage", "health", "armor", "cooldown", "speed", "crit", "overdrive"];

export type SpecialId = "lifesteal" | "thorns" | "pulse" | "phoenix" | "dodgeShield" | "firstStrike" | "overcharge" | "guardian";
export const SPECIALS: SpecialId[] = ["lifesteal", "thorns", "pulse", "phoenix", "dodgeShield", "firstStrike", "overcharge", "guardian"];

export const LOOT = {
  // Base chances of the three rare tiers at performance multiplier 1.0.
  ultraChance: 1 / 10_000,
  divineChance: 1 / 1_000,
  platinumChance: 1 / 100,
  // Performance p ∈ [0,1] scales rare chances by (0.5 + p): 0.5× … 1.5×.
  // Common tiers: gold = 0.05 + 0.35p, silver = 0.25 + 0.25p, the rest bronze.
  // Per-item maximum of each stat (an ULTRA item rolls at 75–100% of these).
  statMax: { damage: 0.1, health: 0.1, armor: 0.06, cooldown: 0.05, speed: 0.03, crit: 0.05, overdrive: 0.08 } as Record<StatId, number>,
  // Hard caps on the sum of a stat across all six equipped slots.
  statCap: { damage: 0.45, health: 0.45, armor: 0.25, cooldown: 0.2, speed: 0.12, crit: 0.2, overdrive: 0.35 } as Record<StatId, number>,
  rarityPower: { common: 0.35, rare: 0.5, epic: 0.65, legendary: 0.8, mythic: 0.92, ultra: 1 } as Record<Rarity, number>,
  rarityStats: { common: 1, rare: 2, epic: 2, legendary: 3, mythic: 3, ultra: 4 } as Record<Rarity, number>,
  specialChance: { common: 0, rare: 0, epic: 0.1, legendary: 0.45, mythic: 1, ultra: 1 } as Record<Rarity, number>,
  dismantleSalvage: { common: 3, rare: 6, epic: 12, legendary: 25, mythic: 50, ultra: 120 } as Record<Rarity, number>,
  critMultiplier: 1.6,
  inventoryLimit: 150,
} as const;

/** Box contents: number of items, rarity weights and bonus salvage per crate tier. */
export const BOX_CONTENTS: Record<BoxTier, { items: number; extraItemChance: number; weights: Partial<Record<Rarity, number>>; salvage: number; guaranteedUltra?: boolean }> = {
  bronze: { items: 1, extraItemChance: 0, weights: { common: 80, rare: 20 }, salvage: 10 },
  silver: { items: 1, extraItemChance: 0.35, weights: { common: 35, rare: 55, epic: 10 }, salvage: 20 },
  gold: { items: 2, extraItemChance: 0, weights: { rare: 45, epic: 45, legendary: 10 }, salvage: 35 },
  platinum: { items: 2, extraItemChance: 0.3, weights: { epic: 45, legendary: 45, mythic: 10 }, salvage: 60 },
  divine: { items: 3, extraItemChance: 0, weights: { legendary: 50, mythic: 50 }, salvage: 120 },
  ultra: { items: 3, extraItemChance: 0, weights: { mythic: 100 }, salvage: 300, guaranteedUltra: true },
};

/** Primary stat of each slot (always present, rolled toward the top of its range). */
export const SLOT_PRIMARY: Record<Slot, StatId> = {
  weapon: "damage",
  shield: "armor",
  helmet: "health",
  armor: "health",
  aura: "overdrive",
  relic: "crit",
};

/** Base item names per slot; index is part of the item's baseId (e.g. "weapon_2"). */
export const ITEM_BASES: Record<Slot, string[]> = {
  weapon: ["Bazalto ašmenys", "Kvarco kardas", "Plazmos ietis", "Obsidiano kirvis", "Gintaro dalgis", "Rezonanso kūjis"],
  shield: ["Granito skydas", "Kristalų bastionas", "Chitino skydas", "Magnetito barjeras", "Opalo veidrodis", "Biokeramikos siena"],
  helmet: ["Ametisto šalmas", "Kvarco vainikas", "Chitino kaukė", "Safyro karūna", "Bazalto šalmas", "Jutiklių diadema"],
  armor: ["Mineralų šarvai", "Grafeno kiautas", "Obsidiano krūtinšarvis", "Biokeramikos apsiaustas", "Žėručio plokštės", "Gintaro šarvai"],
  aura: ["Smaragdo aura", "Šalčio rūkas", "Liepsnų vainikas", "Audros sūkurys", "Gravitacijos laukas", "Rezonanso aidas"],
  relic: ["Geodo širdis", "Meteorito skeveldra", "Fosilijos akis", "Kristalo sėkla", "Branduolio fragmentas", "Žvaigždžių dulkės"],
};

/** One unique ULTRA item per slot, always with the slot's signature special. */
export const ULTRA_ITEMS: Record<Slot, { name: string; special: SpecialId }> = {
  weapon: { name: "Pirmapradis Rezonanso Ašmuo", special: "lifesteal" },
  shield: { name: "Pasaulio Kevalas", special: "thorns" },
  helmet: { name: "Begalybės Vainikas", special: "overcharge" },
  armor: { name: "Nexus Širdies Šarvas", special: "phoenix" },
  aura: { name: "Dieviškoji Rezonanso Aura", special: "guardian" },
  relic: { name: "Pirmapradis Branduolys", special: "pulse" },
};

export const SPECIAL_VALUES = {
  lifesteal: 0.05, // heal 5% of damage dealt (max 3% max HP per second)
  thorns: 0.3, // reflect 30% of melee damage taken
  pulse: { every: 2, radius: 120, damage: 0.45 }, // aura pulse, × player damage
  phoenix: { delay: 3, hp: 0.5 }, // once per run, self-revive after 3 s at 50% HP
  dodgeShield: 0.08, // dodging grants a shield of 8% max HP
  firstStrike: 0.5, // +50% damage to enemies above 90% HP
  overcharge: 50, // start the mission with 50 overdrive charge (if unlocked)
  guardian: { radius: 160, reduction: 0.1 }, // nearby allies take 10% less damage (strongest one counts)
} as const;

export interface ItemInstance {
  id: string;
  baseId: string; // "weapon_2" or "ultra_weapon"
  slot: Slot;
  rarity: Rarity;
  stats: Partial<Record<StatId, number>>;
  special: SpecialId | null;
}

export type Rng = () => number;

export function itemName(item: Pick<ItemInstance, "baseId" | "slot">): string {
  if (item.baseId.startsWith("ultra_")) return ULTRA_ITEMS[item.slot].name;
  const idx = Number(item.baseId.split("_")[1]) || 0;
  return ITEM_BASES[item.slot][idx % ITEM_BASES[item.slot].length];
}

function pickWeighted<T extends string>(weights: Partial<Record<T, number>>, rng: Rng): T {
  const entries = Object.entries(weights) as [T, number][];
  const total = entries.reduce((a, [, w]) => a + w, 0);
  let r = rng() * total;
  for (const [k, w] of entries) {
    r -= w;
    if (r < 0) return k;
  }
  return entries[entries.length - 1][0];
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** Rolls a new item. `newId` supplies the persistent id (server: random UUID). */
export function rollItem(rarity: Rarity, rng: Rng, newId: () => string, slot?: Slot): ItemInstance {
  const s: Slot = slot ?? SLOTS[Math.floor(rng() * SLOTS.length)];
  const power = LOOT.rarityPower[rarity];
  const primary = SLOT_PRIMARY[s];
  const stats: Partial<Record<StatId, number>> = {};
  stats[primary] = round3(LOOT.statMax[primary] * power * (0.85 + 0.15 * rng()));
  const pool = STATS.filter((x) => x !== primary);
  for (let i = 1; i < LOOT.rarityStats[rarity] && pool.length; i++) {
    const st = pool.splice(Math.floor(rng() * pool.length), 1)[0];
    stats[st] = round3(LOOT.statMax[st] * power * (0.6 + 0.4 * rng()));
  }
  if (rarity === "ultra") {
    return { id: newId(), baseId: `ultra_${s}`, slot: s, rarity, stats, special: ULTRA_ITEMS[s].special };
  }
  const special = rng() < LOOT.specialChance[rarity] ? SPECIALS[Math.floor(rng() * SPECIALS.length)] : null;
  return { id: newId(), baseId: `${s}_${Math.floor(rng() * ITEM_BASES[s].length)}`, slot: s, rarity, stats, special };
}

/** Crate tier from performance p ∈ [0,1]. */
export function rollBoxTier(p: number, rng: Rng): BoxTier {
  const perf = Math.max(0, Math.min(1, p));
  const m = 0.5 + perf;
  const r = rng();
  let acc = LOOT.ultraChance * m;
  if (r < acc) return "ultra";
  acc += LOOT.divineChance * m;
  if (r < acc) return "divine";
  acc += LOOT.platinumChance * m;
  if (r < acc) return "platinum";
  const r2 = rng();
  const gold = 0.05 + 0.35 * perf;
  const silver = 0.25 + 0.25 * perf;
  if (r2 < gold) return "gold";
  if (r2 < gold + silver) return "silver";
  return "bronze";
}

export function rollBoxContents(tier: BoxTier, rng: Rng, newId: () => string): { items: ItemInstance[]; salvage: number } {
  const spec = BOX_CONTENTS[tier];
  const items: ItemInstance[] = [];
  if (spec.guaranteedUltra) items.push(rollItem("ultra", rng, newId));
  let n = spec.items - items.length + (rng() < spec.extraItemChance ? 1 : 0);
  while (n-- > 0) items.push(rollItem(pickWeighted(spec.weights, rng), rng, newId));
  return { items, salvage: spec.salvage };
}

// ---- impact ------------------------------------------------------------------------

export interface ImpactInput {
  id: string;
  level: number;
  damage: number;
  stagger: number;
  controlSeconds: number;
  objectiveSeconds: number;
  revives: number;
  downs: number;
}

const IMPACT_WEIGHTS = { damage: 0.45, stagger: 0.15, controlSeconds: 0.15, objectiveSeconds: 0.15, revives: 0.1 } as const;

/**
 * Performance p ∈ [0,1] per player. Damage and stagger are divided by the
 * player's level scaling, so impact is judged against what that level can do.
 * relative = 1 means an average share of the party's work (solo = 1).
 */
export function impactScores(players: ImpactInput[], tier = 1): Map<string, { relative: number; p: number }> {
  const out = new Map<string, { relative: number; p: number }>();
  const n = players.length;
  if (n === 0) return out;
  const adjusted = players.map((pl) => ({
    id: pl.id,
    downs: pl.downs,
    damage: pl.damage / damageScale(pl.level),
    stagger: pl.stagger / damageScale(pl.level),
    controlSeconds: pl.controlSeconds,
    objectiveSeconds: pl.objectiveSeconds,
    revives: pl.revives,
  }));
  const totals = Object.fromEntries(Object.keys(IMPACT_WEIGHTS).map((k) => [k, adjusted.reduce((a, x) => a + (x as any)[k], 0)]));
  for (const a of adjusted) {
    let c = 0;
    for (const [k, w] of Object.entries(IMPACT_WEIGHTS)) {
      const total = totals[k];
      c += w * (total > 0 ? (a as any)[k] / total : 1 / n);
    }
    const relative = c * n;
    const p = Math.max(0, Math.min(1, 0.25 + 0.45 * relative - 0.08 * Math.min(3, a.downs) + 0.05 * (tier - 1)));
    out.set(a.id, { relative: round3(relative), p: round3(p) });
  }
  return out;
}

// ---- equipment totals ---------------------------------------------------------------

export interface GearTotals {
  stats: Record<StatId, number>;
  specials: SpecialId[];
  auraRarity: Rarity | "";
  weaponRarity: Rarity | "";
}

export function gearTotals(items: ItemInstance[]): GearTotals {
  const stats = Object.fromEntries(STATS.map((s) => [s, 0])) as Record<StatId, number>;
  const specials = new Set<SpecialId>();
  const bySlot = new Map<Slot, ItemInstance>();
  for (const it of items) if (!bySlot.has(it.slot)) bySlot.set(it.slot, it); // one item per slot
  for (const it of bySlot.values()) {
    for (const [k, v] of Object.entries(it.stats) as [StatId, number][]) stats[k] += v;
    if (it.special) specials.add(it.special);
  }
  for (const s of STATS) stats[s] = round3(Math.min(LOOT.statCap[s], stats[s]));
  return {
    stats,
    specials: [...specials],
    auraRarity: bySlot.get("aura")?.rarity ?? "",
    weaponRarity: bySlot.get("weapon")?.rarity ?? "",
  };
}

export const RARITY_COLORS: Record<Rarity, string> = {
  common: "#b9c2c9",
  rare: "#59b8ff",
  epic: "#b77cff",
  legendary: "#ffb340",
  mythic: "#ff5d8f",
  ultra: "#7dfff0",
};
export const BOX_COLORS: Record<BoxTier, string> = {
  bronze: "#c07a43",
  silver: "#cfd8e0",
  gold: "#ffcf4a",
  platinum: "#a8f0ff",
  divine: "#fff3b0",
  ultra: "#ff7dfa",
};

export type GearByLineage = Partial<Record<LineageId, Partial<Record<Slot, string>>>>;
