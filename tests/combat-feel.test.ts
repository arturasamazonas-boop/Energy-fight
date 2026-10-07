import { test } from "node:test";
import assert from "node:assert/strict";
import { COMBAT, Sim } from "../shared/src/index.ts";
import { loadoutFor } from "./helpers.ts";

test("landed hits build a chain that adds damage; the chain drops after a pause", () => {
  const sim = new Sim({ runId: "chain", tier: 1, partySize: 1, seed: 4 });
  const p = sim.addPlayer("p", "pp", "P", loadoutFor("pyra", 6));
  sim.maxX = 1500;
  p.x = 900; p.y = 300; p.fx = 1; p.fy = 0;
  const dummy = sim.spawn("armored", 950, 300)!;
  dummy.hp = dummy.maxHp = 1e7;
  dummy.state = "flinch"; dummy.t = 1e9; // stands still
  let seq = 1;
  const before = dummy.hp;
  const hitFor = (ticks: number) => { for (let i = 0; i < ticks; i++) { sim.setInput("p", 0, 0, false, seq++); if (i % 4 === 0) sim.action("p", "attack", 1, 0); sim.tick(); sim.drainFx(); } };
  hitFor(200);
  assert.ok(p.chain >= 20, `chain ${p.chain}`);
  assert.ok(dummy.hp < before);
  // Released attack → after the window the chain is gone.
  for (let i = 0; i < Math.ceil(COMBAT.chainWindow * 20) + 4; i++) { sim.setInput("p", 0, 0, false, seq++); sim.tick(); }
  assert.equal(p.chain, 0);
});

test("chain multiplies damage up to the cap", () => {
  const run = (chain: number) => {
    const sim = new Sim({ runId: "cap", tier: 1, partySize: 1, seed: 1 });
    const p = sim.addPlayer("p", "pp", "P", loadoutFor("litos", 5));
    const e = sim.spawn("pursuer", 600, 300)!;
    e.hp = e.maxHp = 1e6;
    p.chain = chain;
    (sim as any).damageEnemy(p, e, 100, 0, false, 0, p.x, p.y, "zone");
    return 1e6 - e.hp;
  };
  const base = run(0);
  assert.equal(run(10), Math.round(base * (1 + 10 * COMBAT.chainPerHit)));
  assert.equal(run(500), Math.round(base * (1 + COMBAT.chainMaxBonus)));
});

test("a heavy hit taken halves the chain", () => {
  const sim = new Sim({ runId: "brk", tier: 1, partySize: 1, seed: 1 });
  const p = sim.addPlayer("p", "pp", "P", loadoutFor("pyra", 5));
  p.chain = 18;
  (sim as any).damagePlayer(p, p.maxHp * 0.2);
  assert.equal(p.chain, 9);
});

test("pursuers lunge at a player who keeps distance", () => {
  const sim = new Sim({ runId: "lunge", tier: 1, partySize: 1, seed: 2 });
  const p = sim.addPlayer("p", "pp", "P", loadoutFor("pyra", 5));
  sim.maxX = 1500;
  p.x = 1000; p.y = 300;
  const e = sim.spawn("pursuer", 800, 300)!;
  e.state = "move"; e.t = 0; e.lungeCd = 0;
  let lunged = false;
  let seq = 1;
  for (let i = 0; i < 40 && !lunged; i++) {
    sim.setInput("p", 0, 0, false, seq++);
    sim.tick();
    if (e.attack?.kind === "lunge") lunged = true;
  }
  assert.ok(lunged, "pursuer telegraphs a lunge from mid range");
  const hp0 = p.hp;
  for (let i = 0; i < 30; i++) { sim.setInput("p", 0, 0, false, seq++); sim.tick(); }
  assert.ok(p.hp < hp0, "a lunge that is not dodged connects");
});
