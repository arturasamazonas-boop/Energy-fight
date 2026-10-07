import { test } from "node:test";
import assert from "node:assert/strict";
import { MOVES, Sim } from "../shared/src/index.ts";
import { loadoutFor } from "./helpers.ts";

function setup() {
  const sim = new Sim({ runId: "moves", tier: 1, partySize: 1, seed: 7 });
  const p = sim.addPlayer("p", "pp", "P", loadoutFor("litos", 6));
  sim.maxX = 1500;
  p.x = 1000; p.y = 300; p.fx = -1; p.fy = 0;
  return { sim, p };
}
let seq = 1;
const tick = (sim: Sim, n: number, input: { mx?: number; my?: number; atk?: boolean; guard?: boolean; run?: boolean } = {}) => {
  for (let i = 0; i < n; i++) {
    sim.setInput("p", input.mx ?? 0, input.my ?? 0, input.atk ?? false, seq++, undefined, undefined, input.guard ?? false, input.run ?? false);
    sim.tick();
    sim.drainFx();
  }
};

test("jump rises and lands; airborne players are not hit by ground attacks", () => {
  const { sim, p } = setup();
  assert.ok(sim.action("p", "jump", 0, 0));
  assert.equal(sim.action("p", "jump", 0, 0), false, "no double jump");
  tick(sim, 4);
  assert.ok(p.z > MOVES.jump.avoidHeight, `z ${p.z}`);
  const hp = p.hp;
  const e = sim.spawn("pursuer", 970, 300)!;
  assert.equal((sim as any).damagePlayer(p, 30, e), false);
  assert.equal(p.hp, hp);
  tick(sim, 30);
  assert.equal(p.z, 0, "back on the ground");
});

test("attacking in the air slams the ground and hurts nearby enemies", () => {
  const { sim, p } = setup();
  const e = sim.spawn("armored", 1040, 300)!;
  e.state = "flinch"; e.t = 99;
  const hp0 = e.hp;
  sim.action("p", "jump", 0, 0);
  tick(sim, 5);
  sim.action("p", "attack", 0, 0);
  tick(sim, 1);
  assert.ok(p.slam);
  tick(sim, 20);
  assert.equal(p.z, 0);
  assert.ok(e.hp < hp0, "slam damaged the enemy");
});

test("guard blocks 80% of frontal damage; a timely guard parries and stuns", () => {
  const { sim, p } = setup();
  const e = sim.spawn("pursuer", 960, 300)!; // in front (player faces left)
  tick(sim, 1, { guard: true });
  // Within the parry window: no damage, attacker stunned.
  const hp0 = p.hp;
  assert.equal((sim as any).damagePlayer(p, 40, e), false);
  assert.equal(p.hp, hp0);
  assert.equal(e.state, "flinch");
  tick(sim, 10, { guard: true });
  const hp1 = p.hp;
  (sim as any).damagePlayer(p, 40, e);
  const lost = hp1 - p.hp;
  assert.ok(lost > 0 && lost <= Math.ceil(40 * (1 - MOVES.guard.reduction)) + 1, `lost ${lost}`);
  // From behind the guard does nothing.
  const back = sim.spawn("pursuer", 1040, 300)!;
  const hp2 = p.hp;
  (sim as any).damagePlayer(p, 40, back);
  assert.ok(hp2 - p.hp >= 30);
});

test("an exhausted guard breaks and stuns the hero", () => {
  const { sim, p } = setup();
  const e = sim.spawn("armored", 960, 300)!;
  tick(sim, 10, { guard: true });
  for (let i = 0; i < 30 && p.stunT <= 0; i++) (sim as any).damagePlayer(p, p.maxHp * 0.1, e);
  assert.ok(p.stunT > 0, "guard break stun");
  assert.equal(p.guarding, false);
});

test("running is faster than walking; tap attacks swing faster than holding", () => {
  const walk = setup();
  tick(walk.sim, 20, { mx: 1 });
  const run = setup();
  tick(run.sim, 20, { mx: 1, run: true });
  assert.ok(run.p.x - 1000 > (walk.p.x - 1000) * 1.3);

  const count = (tap: boolean) => {
    const { sim } = setup();
    let swings = 0;
    for (let i = 0; i < 80; i++) {
      if (tap && i % 3 === 0) sim.action("p", "attack", -1, 0);
      sim.setInput("p", 0, 0, !tap, seq++);
      sim.tick();
      swings += sim.drainFx().filter((f) => f.t === "swing").length;
    }
    return swings;
  };
  assert.ok(count(true) > count(false), "rhythmic tapping beats holding");
});
