import { LINEAGES, type LineageId } from "./config.ts";

export const ROOM_NAME = "mission";

export type ActionKind = "dodge" | "skill1" | "skill2" | "overdrive";
export const ACTIONS: ActionKind[] = ["dodge", "skill1", "skill2", "overdrive"];

export interface InputMsg {
  seq: number;
  mx: number;
  my: number;
  atk: boolean;
  fx?: number; // facing hint (unit vector) used when standing still
  fy?: number;
}
export interface ActionMsg {
  seq: number;
  a: ActionKind;
  dx: number;
  dy: number;
}

export type Phase = "lobby" | "running" | "results";

const isNum = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;

export function parseInput(m: unknown): InputMsg | null {
  if (!m || typeof m !== "object") return null;
  const o = m as Record<string, unknown>;
  if (!isNum(o.seq, 0, 2 ** 31) || !Number.isInteger(o.seq)) return null;
  if (!isNum(o.mx, -1.01, 1.01) || !isNum(o.my, -1.01, 1.01)) return null;
  if (typeof o.atk !== "boolean") return null;
  const out: InputMsg = { seq: o.seq as number, mx: o.mx as number, my: o.my as number, atk: o.atk };
  if (o.fx !== undefined || o.fy !== undefined) {
    if (!isNum(o.fx, -1.01, 1.01) || !isNum(o.fy, -1.01, 1.01)) return null;
    out.fx = o.fx as number;
    out.fy = o.fy as number;
  }
  return out;
}

export function parseAction(m: unknown): ActionMsg | null {
  if (!m || typeof m !== "object") return null;
  const o = m as Record<string, unknown>;
  if (!isNum(o.seq, 0, 2 ** 31) || !Number.isInteger(o.seq)) return null;
  if (typeof o.a !== "string" || !ACTIONS.includes(o.a as ActionKind)) return null;
  if (!isNum(o.dx, -1.01, 1.01) || !isNum(o.dy, -1.01, 1.01)) return null;
  return { seq: o.seq as number, a: o.a as ActionKind, dx: o.dx as number, dy: o.dy as number };
}

export function isLineage(v: unknown): v is LineageId {
  return typeof v === "string" && (LINEAGES as readonly string[]).includes(v);
}

// Server → client one-shot presentation events, batched per tick.
export type FxEvent =
  | { t: "hit"; x: number; y: number; dmg: number; crit?: boolean; target: string; src: string; kind?: string }
  | { t: "swing"; id: string; x: number; y: number; ang: number; range: number; arc: number; lin: string; step: number }
  | { t: "skill"; id: string; skill: string; x: number; y: number; ang: number; range: number; lin: string; evo: string }
  | { t: "pdmg"; id: string; dmg: number; src?: string }
  | { t: "down"; id: string }
  | { t: "revive"; id: string; by: string }
  | { t: "death"; id: string; kind: string; x: number; y: number }
  | { t: "shield"; id: string }
  | { t: "perfect"; id: string }
  | { t: "od"; id: string; lin: string }
  | { t: "section"; id: number }
  | { t: "msg"; key: string };

export interface SectionRewardView {
  sectionId: number;
  xp: number;
  salvage: number;
  fragments: number;
  bonus: boolean;
  eligible: boolean;
  supportMark: boolean;
  levelAfter: number;
  xpAfter: number;
}

export interface PlayerResult {
  id: string;
  name: string;
  lineage: LineageId;
  levelAtStart: number;
  levelNow: number;
  xpNow: number;
  carryMult: number;
  sections: SectionRewardView[];
  totalXp: number;
  totalSalvage: number;
  totalFragments: number;
  supportMark: boolean;
  pendingUnlocks: string[];
  revives: number;
  damage: number;
  stagger: number;
  controlSeconds: number;
  objectiveSeconds: number;
  departed: boolean;
}

export interface ResultsMsg {
  success: boolean;
  tier: number;
  durationSec: number;
  players: PlayerResult[];
}
