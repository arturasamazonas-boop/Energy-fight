// Measures authoritative simulation cost: 8 players, enemy cap reached.
import { ENEMY_CAP, Sim, buildLoadout, defaultLineageRecord, LINEAGES } from "../shared/src/index.ts";
const sim = new Sim({ runId: "bench", tier: 3, partySize: 8, seed: 1 });
for (let i = 0; i < 8; i++) sim.addPlayer(`p${i}`, `x${i}`, "B", buildLoadout({ ...defaultLineageRecord(LINEAGES[i % 4]), level: 18 }));
for (const p of sim.players.values()) { p.x = 1000 + Math.random() * 200; p.y = 200 + Math.random() * 200; p.hp = p.maxHp = 1e9; }
sim.maxX = 1500;
for (let i = 0; i < ENEMY_CAP; i++) sim.spawn((["pursuer", "ranged", "armored", "support"] as const)[i % 4], 700 + (i % 8) * 90, 80 + Math.floor(i / 8) * 150);
let seq = 1;
const N = 2000;
const t0 = performance.now();
for (let i = 0; i < N; i++) {
  for (const p of sim.players.values()) { sim.setInput(p.id, Math.sin(i / 20), Math.cos(i / 30), true, seq++); if (i % 40 === 0) sim.action(p.id, "skill1", 1, 0); }
  sim.tick(); sim.drainFx();
  for (const e of sim.enemies.values()) if (e.hp < e.maxHp * 0.2) e.hp = e.maxHp; // keep the cap full
  while (sim.enemies.size < ENEMY_CAP) sim.spawn("pursuer", 800, 300);
}
const ms = (performance.now() - t0) / N;
console.log(`sim tick: ${ms.toFixed(3)} ms average over ${N} ticks with 8 players and ${sim.enemies.size} enemies (budget 50 ms at 20 Hz)`);
