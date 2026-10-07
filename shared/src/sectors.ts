// Numbered sectors (BOTS-style). Each sector reuses the three-room station layout
// with its own theme, enemy roster, difficulty, time limit and (every 4th) a boss.
import { TIERS, type BossVariant } from "./config.ts";

export type SectorTheme = "nexus" | "lava" | "crystal" | "hive" | "sky";
export type FinalRoom = "boss" | "waves";

export interface SectorDef {
  n: number;
  tier: number; // reward / scaling band (1–3)
  theme: SectorTheme;
  elite: boolean; // sectors ending in 8: tougher, double rewards
  hpMult: number;
  dmgMult: number;
  timeLimit: number; // seconds
  waves: string[][]; // room 1
  room2: "defend" | "waves";
  room2Waves: string[][];
  final: FinalRoom;
  boss: BossVariant | null;
  finalWaves: string[][]; // room 3 when there is no boss
  rewardMult: number;
}

export const SECTOR_COUNT = 20;
export const SECTOR_THEMES: SectorTheme[] = ["nexus", "lava", "crystal", "hive", "sky"];

export function sectorTier(n: number) {
  return n <= 6 ? 1 : n <= 13 ? 2 : 3;
}

const P = "pursuer", R = "ranged", A = "armored", S = "support";

/** Deterministic sector definition (same on server and client). */
export function sectorDef(nIn: number): SectorDef {
  const n = Math.max(1, Math.min(SECTOR_COUNT, Math.floor(nIn) || 1));
  const tier = sectorTier(n);
  const T = TIERS[tier - 1];
  const tierStart = tier === 1 ? 1 : tier === 2 ? 7 : 14;
  const elite = n % 10 === 8;
  const step = n - tierStart;
  // Smooth growth inside a tier on top of the tier's base multipliers.
  const hpMult = T.enemyHpMult * (1 + 0.07 * step) * (elite ? 1.45 : 1);
  const dmgMult = T.enemyDamageMult * (1 + 0.05 * step) * (elite ? 1.3 : 1);
  const theme = SECTOR_THEMES[(n - 1) % SECTOR_THEMES.length];
  const boss: BossVariant | null = n % 4 === 0 ? (theme === "crystal" || n % 8 === 0 ? "warden" : "brood") : null;
  const late = n >= 5;
  const star = (k: string, i: number) => (elite || (late && i % 3 === 0) ? `${k}*` : k);
  // Many small fights: more enemies per wave as sectors climb, elites from sector 5.
  const size = Math.min(8, 5 + Math.floor(n / 4));
  // New biomass types join as sectors climb: slappers (2+), bombers (3+), rollers (5+), shields (6+).
  const roster = [P, n >= 2 ? "slapper" : P, R, n >= 3 ? "bomber" : P, A, n >= 5 ? "roller" : P, n >= 6 ? "shield" : R, S];
  const wave = (offset: number, count: number) =>
    Array.from({ length: count }, (_, i) => star(roster[(i + offset + n) % roster.length], i + offset));
  const waves = [wave(0, size - 1), wave(1, size), wave(3, size), ...(n >= 3 ? [wave(5, size + 1)] : [])];
  const room2: "defend" | "waves" = n % 2 === 1 ? "defend" : "waves";
  const room2Waves = [wave(2, size), wave(4, size + 1), wave(6, size)];
  const finalWaves = [wave(1, size + 1), wave(4, size + 1), [star(A, 0), star(A, 3), P, P, R, R, ...(n >= 6 ? [S] : [])]];
  return {
    n, tier, theme, elite, hpMult, dmgMult,
    timeLimit: (boss ? 480 : 360) + (room2 === "defend" ? 60 : 0) + (elite ? 90 : 0),
    waves, room2, room2Waves,
    final: boss ? "boss" : "waves",
    boss, finalWaves,
    rewardMult: elite ? 2 : 1,
  };
}
