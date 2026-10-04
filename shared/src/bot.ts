// Simple scripted player used by automated tests (headless sim and simulated
// network clients). It is a test driver, not an AI teammate in the game.
import { MAP, navTarget } from "./map.ts";
import type { ActionKind } from "./protocol.ts";

export interface BotView {
  self: { x: number; y: number; life: string; hp: number; maxHp: number; od: number };
  enemies: { x: number; y: number; kind: string; hp: number; state?: string }[];
  allies: { x: number; y: number; life: string }[];
  stage: string;
  maxX: number;
  hasSkill2: boolean;
  hasOverdrive: boolean;
  hazards?: { x: number; y: number; r: number; enemy: boolean }[];
  pickups?: { x: number; y: number }[];
}

export interface BotDecision {
  mx: number;
  my: number;
  atk: boolean;
  action?: { a: ActionKind; dx: number; dy: number };
}

export interface BotOptions {
  passive?: boolean; // AFK: never acts
  timid?: boolean; // follows the squad, attacks only things very close
  seed?: number;
}

export function botDecide(v: BotView, opts: BotOptions = {}, t = 0): BotDecision {
  if (opts.passive || v.self.life !== "alive") return { mx: 0, my: 0, atk: false };
  const s = v.self;
  // Revive downed allies first.
  const downed = v.allies.find((a) => a.life === "downed");
  if (downed && Math.hypot(downed.x - s.x, downed.y - s.y) < 500 && v.enemies.filter((e) => Math.hypot(e.x - downed.x, e.y - downed.y) < 180).length < 3) {
    return steer(s, downed.x, downed.y, 20, false);
  }
  // Step out of telegraphed ground strikes and pools.
  const danger = (v.hazards ?? []).find((h) => h.enemy && Math.hypot(h.x - s.x, h.y - s.y) < h.r + 22);
  if (danger) {
    let ax = s.x - danger.x;
    let ay = s.y - danger.y;
    const al = Math.hypot(ax, ay);
    if (al < 1) {
      ax = 0;
      ay = 1;
    }
    return { mx: ax / (al || 1), my: ay / (al || 1), atk: false };
  }
  if (s.hp < s.maxHp * 0.5 && v.pickups?.length) {
    const k = v.pickups.reduce((a, b) => (Math.hypot(a.x - s.x, a.y - s.y) < Math.hypot(b.x - s.x, b.y - s.y) ? a : b));
    if (Math.hypot(k.x - s.x, k.y - s.y) < 350) return steer(s, k.x, k.y, 0, true);
  }
  let nearest: BotView["enemies"][number] | null = null;
  let nd = Infinity;
  for (const e of v.enemies) {
    const d = Math.hypot(e.x - s.x, e.y - s.y);
    if (d < nd) {
      nd = d;
      nearest = e;
    }
  }
  if (nearest && (!opts.timid || nd < 160)) {
    const nav = navTarget(s.x, s.y, nearest.x, nearest.y);
    const nl = Math.hypot(nav.x - s.x, nav.y - s.y) || 1;
    const dx = (nav.x - s.x) / nl;
    const dy = (nav.y - s.y) / nl;
    const reach = nearest.kind === "boss" ? 95 : 55;
    const dec: BotDecision = nd > reach ? { mx: dx, my: dy, atk: nd < reach + 40 } : { mx: 0, my: 0, atk: true };
    if (opts.timid) return { mx: dx * 0.5, my: dy * 0.5, atk: true };
    const phase = Math.floor(t * 2) % 9;
    const threat = v.enemies.find((e) => e.state === "windup" && Math.hypot(e.x - s.x, e.y - s.y) < (e.kind === "boss" ? 200 : 90));
    if (threat && (threat.kind === "boss" || ((opts.seed ?? 0) % 2 === 0 && Math.floor(t * 10) % 3 === 0))) {
      const tx = s.x - threat.x;
      const ty = s.y - threat.y;
      const tl = Math.hypot(tx, ty) || 1;
      if (threat.kind === "boss" && Math.hypot(tx, ty) > 120) return { mx: tx / tl, my: ty / tl, atk: false };
      return { mx: tx / tl, my: ty / tl, atk: false, action: { a: "dodge", dx: tx / tl, dy: ty / tl } };
    }
    if (nd < 160) {
      if (s.od >= 100 && v.hasOverdrive) dec.action = { a: "overdrive", dx, dy };
      else if (phase === 1) dec.action = { a: "skill1", dx, dy };
      else if (phase === 4 && v.hasSkill2) dec.action = { a: "skill2", dx, dy };
      else if (phase === 7 && s.hp < s.maxHp * 0.5) dec.action = { a: "dodge", dx: -dx, dy: -dy };
    }
    return dec;
  }
  // No enemies: go to the objective.
  const goal = objectiveFor(v);
  if (opts.timid) {
    const lead = v.allies.find((a) => a.life === "alive");
    if (lead) return steer(s, lead.x - 50, lead.y, 30, false);
  }
  return steer(s, goal.x, goal.y, 10, false);
}

function objectiveFor(v: BotView) {
  switch (v.stage) {
    case "s1_corridor":
    case "s1_waves":
      return { x: 1000, y: 300 };
    case "s2_activate":
    case "s2_defend":
    case "s2_clear":
      return { x: MAP.stabilizer.x, y: MAP.stabilizer.y };
    case "s3_approach":
    case "s3_boss":
      return { x: 3700, y: 300 };
    default:
      return { x: MAP.extraction.x, y: MAP.extraction.y };
  }
}

function steer(s: { x: number; y: number }, tx: number, ty: number, stopAt: number, atk: boolean): BotDecision {
  if (Math.hypot(tx - s.x, ty - s.y) < stopAt) return { mx: 0, my: 0, atk };
  const nav = navTarget(s.x, s.y, tx, ty);
  const dx = nav.x - s.x;
  const dy = nav.y - s.y;
  const d = Math.hypot(dx, dy) || 1;
  return { mx: dx / d, my: dy / d, atk };
}
