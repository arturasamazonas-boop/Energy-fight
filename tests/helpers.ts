import { Sim, botDecide, buildLoadout, defaultLineageRecord, type BotOptions, type LineageId } from "../shared/src/index.ts";

export function viewFor(sim: Sim, id: string) {
  const p = sim.players.get(id)!;
  return {
    self: { x: p.x, y: p.y, life: p.life, hp: p.hp, maxHp: p.maxHp, od: p.od },
    enemies: [...sim.enemies.values()].map((e) => ({ x: e.x, y: e.y, kind: e.kind, hp: e.hp, state: e.state })),
    allies: [...sim.players.values()].filter((o) => o.id !== id).map((o) => ({ x: o.x, y: o.y, life: o.life })),
    stage: sim.stage,
    maxX: sim.maxX,
    hasSkill2: p.loadout.hasSkill2,
    hasOverdrive: p.loadout.hasOverdrive,
    pickups: [...sim.pickups.values()].map((k) => ({ x: k.x, y: k.y })),
    hazards: [...sim.hazards.values()].filter((h) => h.kind !== "shot").map((h) => ({ x: h.x, y: h.y, r: h.r, enemy: h.side === "enemy" })),
  };
}

const seqs = new WeakMap<Sim, number>();

export function runBots(sim: Sim, opts: Record<string, BotOptions> = {}, maxSeconds = 1500) {
  let seq = seqs.get(sim) ?? 1;
  const ticks = maxSeconds * 20;
  for (let i = 0; i < ticks && sim.result === "running"; i++) {
    if (i % 2 === 0) {
      for (const p of sim.players.values()) {
        if (p.life === "departed") continue;
        const d = botDecide(viewFor(sim, p.id), opts[p.id] ?? {}, sim.time);
        sim.setInput(p.id, d.mx, d.my, d.atk, seq++);
        if (d.action) sim.action(p.id, d.action.a, d.action.dx, d.action.dy);
        else if (d.atk && i % 4 === 0) sim.action(p.id, "attack", 0, 0); // bots tap in rhythm
      }
    }
    sim.tick();
    sim.drainFx();
  }
  seqs.set(sim, seq);
  return sim;
}

export function loadoutFor(lineage: LineageId, level: number, evolution: string | null = null) {
  return buildLoadout({ ...defaultLineageRecord(lineage), level, evolution });
}
