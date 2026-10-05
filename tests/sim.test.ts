import { test } from "node:test";
import assert from "node:assert/strict";
import { ENEMY_CAP, LINEAGES, SectionParticipation, Sim, type FxEvent, type LineageId } from "../shared/src/index.ts";
import { loadoutFor, runBots } from "./helpers.ts";

function soloSim(lineage: LineageId, level: number, evolution: string | null = null, tier = 1) {
  const sim = new Sim({ runId: `t-${lineage}-${level}-${evolution}`, tier, partySize: 1, seed: 7 });
  sim.addPlayer("p", "prof", "Test", loadoutFor(lineage, level, evolution));
  return sim;
}

function ticks(sim: Sim, n: number, fx: FxEvent[] = []) {
  for (let i = 0; i < n; i++) {
    sim.tick();
    fx.push(...sim.drainFx());
  }
  return fx;
}

/** Puts an idle enemy in front of the player so mechanics can be exercised deterministically. */
function dummy(sim: Sim, dx = 60, dy = 0, kind: "pursuer" | "armored" = "pursuer") {
  const p = sim.players.get("p")!;
  const e = sim.spawn(kind, p.x + dx, p.y + dy)!;
  e.state = "flinch";
  e.t = 999;
  e.hp = e.maxHp = 100000;
  return e;
}

for (const lineage of LINEAGES) {
  test(`${lineage}: moves, attacks, dodges and uses unlocked skills`, () => {
    const sim = soloSim(lineage, 5);
    const p = sim.players.get("p")!;
    const x0 = p.x;
    sim.setInput("p", 1, 0, false, 1);
    ticks(sim, 10);
    assert.ok(p.x > x0 + 50, "moved right");
    const e = dummy(sim, 50);
    sim.setInput("p", 0, 0, true, 2);
    const fx = ticks(sim, 20);
    assert.ok(fx.some((f) => f.t === "swing"), "combo swings");
    assert.ok(e.hp < e.maxHp, "combo damaged the enemy");
    sim.setInput("p", 0, 0, false, 3);
    ticks(sim, 20);
    assert.equal(sim.action("p", "dodge", 0, 1), true);
    assert.ok(p.iframes > 0);
    assert.equal(sim.action("p", "dodge", 0, 1), false, "dodge has a cooldown");
    ticks(sim, 20);
    p.x = e.x - 60;
    p.y = e.y;
    p.fx = 1;
    p.fy = 0;
    const before = e.hp;
    assert.equal(sim.action("p", "skill1", 1, 0), true);
    ticks(sim, 30);
    assert.ok(p.cds.skill1 > 0);
    assert.ok(e.hp < before, "skill 1 dealt damage");
    p.x = e.x - 60;
    p.y = e.y;
    assert.equal(sim.action("p", "skill2", 1, 0), true);
    ticks(sim, 30);
    assert.ok(p.cds.skill2 > 0);
  });

  test(`${lineage}: skill 2 is locked below level 3`, () => {
    const sim = soloSim(lineage, 2);
    assert.equal(sim.action("p", "skill2", 1, 0), false);
  });

  test(`${lineage}: completes the first section solo at level 5`, () => {
    const sim = new Sim({ runId: `solo-${lineage}`, tier: 1, partySize: 1, seed: 3 });
    sim.addPlayer("p", "prof", "Solo", loadoutFor(lineage, 5));
    sim.start();
    let cleared = false;
    const origDrain = sim.drainClears.bind(sim);
    for (let i = 0; i < 20 * 400 && !cleared && sim.result === "running"; i += 200) {
      runBots(sim, {}, 10);
      if (sim.section >= 2) cleared = true;
    }
    assert.ok(cleared, `section 1 cleared (stage ${sim.stage}, result ${sim.result})`);
    const clears = origDrain();
    assert.equal(clears[0].sectionId, 1);
    assert.equal(clears[0].eligibility.get("p"), true);
  });
}

test("evolutions change real mechanics", () => {
  // PYRA FLARE: detonation spreads to other marked enemies.
  {
    const sim = soloSim("pyra", 10, "flare");
    const a = dummy(sim, 50);
    const b = dummy(sim, 50 + 120, 0);
    a.status.heat = { stacks: 3, t: 5 };
    b.status.heat = { stacks: 2, t: 5 };
    const p = sim.players.get("p")!;
    p.x = a.x - 140; // b is out of the 130 detonation radius
    sim.action("p", "skill1", 1, 0);
    const fx = ticks(sim, 10);
    assert.ok(fx.some((f) => f.t === "hit" && f.kind === "spread" && f.target === b.id), "spread hit");
    assert.equal(b.status.heat.stacks, 0);
  }
  // Without FLARE there is no spread.
  {
    const sim = soloSim("pyra", 10, null);
    const a = dummy(sim, 50);
    const b = dummy(sim, 170, 0);
    a.status.heat = { stacks: 3, t: 5 };
    b.status.heat = { stacks: 2, t: 5 };
    sim.players.get("p")!.x = a.x - 140;
    sim.action("p", "skill1", 1, 0);
    const fx = ticks(sim, 10);
    assert.ok(!fx.some((f) => f.t === "hit" && f.kind === "spread"));
  }
  // PYRA FURNACE: consumed marks become a shield.
  {
    const sim = soloSim("pyra", 10, "furnace");
    const a = dummy(sim, 50);
    a.status.heat = { stacks: 3, t: 5 };
    sim.action("p", "skill1", 1, 0);
    ticks(sim, 6);
    assert.ok(sim.players.get("p")!.shield >= 27);
  }
  // KRIOS PRISM: shatter throws fragments.
  {
    const sim = soloSim("krios", 10, "prism");
    const a = dummy(sim, 60);
    dummy(sim, 120, 40);
    a.status.chill = { stacks: 4, t: 5 };
    sim.action("p", "skill1", 1, 0);
    const fx = ticks(sim, 10);
    assert.ok(fx.some((f) => f.t === "hit" && f.kind === "fragment"));
  }
  // KRIOS GLACIER: bigger frost shield.
  {
    const base = soloSim("krios", 10, null);
    base.action("p", "skill2", 1, 0);
    ticks(base, 8);
    const evo = soloSim("krios", 10, "glacier");
    evo.action("p", "skill2", 1, 0);
    ticks(evo, 8);
    assert.ok(evo.players.get("p")!.shield > base.players.get("p")!.shield * 1.5);
  }
  // VEKTOR TEMPEST: dash ends with an area follow-up.
  {
    const sim = soloSim("vektor", 10, "tempest");
    const e = dummy(sim, 260, 0);
    sim.action("p", "skill1", 1, 0);
    const fx = ticks(sim, 10);
    assert.ok(fx.filter((f) => f.t === "hit" && f.target === e.id).length >= 1);
    assert.ok(e.hp < e.maxHp);
  }
  // LITOS SEISMIC: shockwave leaves a delayed aftershock.
  {
    const sim = soloSim("litos", 10, "seismic");
    dummy(sim, 60);
    sim.action("p", "skill2", 1, 0);
    ticks(sim, 10);
    assert.ok([...sim.hazards.values()].some((h) => h.kind === "aftershock"));
    const fx = ticks(sim, 20);
    assert.ok(fx.some((f) => f.t === "hit" && f.kind === "aftershock"));
  }
  // LITOS MONOLITH: a perfect brace grants a shell.
  {
    const sim = soloSim("litos", 10, "monolith");
    const e = sim.spawn("pursuer", sim.players.get("p")!.x + 40, sim.players.get("p")!.y)!;
    sim.action("p", "skill1", 1, 0);
    e.state = "windup";
    e.t = 0.01;
    e.attack = { kind: "melee", ang: Math.PI, tx: 0, ty: 0 };
    ticks(sim, 3);
    assert.ok(sim.players.get("p")!.shield >= 70);
  }
});

test("statuses are capped, boss slow is capped and boss is not displaced", () => {
  const sim = soloSim("krios", 18);
  const boss = sim.spawn("boss", 400, 300)!;
  boss.status.chill = { stacks: 5, t: 10 };
  const slow = Math.min(boss.spec.slowCap, boss.status.chill.stacks * 0.06);
  assert.ok(slow <= 0.2);
  const vk = new Sim({ runId: "pull", tier: 1, partySize: 1 });
  vk.addPlayer("p", "x", "V", loadoutFor("vektor", 10));
  const p = vk.players.get("p")!;
  const b = vk.spawn("boss", p.x + 120, p.y)!;
  b.state = "stagger";
  b.t = 99;
  const bx = b.x;
  vk.action("p", "skill2", 1, 0);
  ticks(vk, 10);
  assert.equal(b.x, bx, "boss resists the vortex");
});

test("enemy cap queues excess spawns instead of dropping them", () => {
  const sim = soloSim("pyra", 5);
  for (let i = 0; i < ENEMY_CAP + 6; i++) sim.spawn("pursuer", 900 + (i % 10) * 20, 100 + Math.floor(i / 10) * 60);
  assert.equal(sim.enemies.size, ENEMY_CAP);
  assert.equal(sim.queuedSpawns(), 6);
  for (const e of [...sim.enemies.values()].slice(0, 6)) sim.enemies.delete(e.id);
  ticks(sim, 4);
  assert.equal(sim.enemies.size, ENEMY_CAP);
  assert.equal(sim.queuedSpawns(), 0);
});

test("overdrive charge gain is capped per second", () => {
  const sim = soloSim("pyra", 10);
  const p = sim.players.get("p")!;
  for (let i = 0; i < 6; i++) dummy(sim, 40 + i * 4, (i - 3) * 8);
  sim.setInput("p", 0, 0, true, 1);
  ticks(sim, 20 * 5);
  assert.ok(p.od <= 6 * 5 + 6 + 1e-6, `od ${p.od}`);
});

test("participation: low-damage helper-carried player earns credit, AFK player does not", () => {
  const sim = new Sim({ runId: "carry", tier: 1, partySize: 3, seed: 11 });
  sim.addPlayer("vet", "pv", "Veteran", loadoutFor("litos", 18, "seismic"));
  sim.addPlayer("kid", "pk", "Novice", loadoutFor("krios", 1));
  sim.addPlayer("afk", "pa", "AFK", loadoutFor("pyra", 5));
  sim.start();
  const all: ReturnType<Sim["drainClears"]> = [];
  for (let i = 0; i < 60 && sim.section < 2 && sim.result === "running"; i++) {
    runBots(sim, { kid: { timid: true }, afk: { passive: true } }, 5);
    all.push(...sim.drainClears());
  }
  const c1 = all.find((c) => c.sectionId === 1);
  assert.ok(c1, "section 1 cleared");
  assert.equal(c1!.eligibility.get("vet"), true);
  assert.equal(c1!.eligibility.get("kid"), true, "novice qualifies without kills");
  assert.equal(c1!.eligibility.get("afk"), false, "AFK does not qualify");
  const kid = sim.players.get("kid")!;
  const vet = sim.players.get("vet")!;
  assert.ok(vet.stats.damage > kid.stats.damage * 2, `veteran did most of the damage (${vet.stats.damage} vs ${kid.stats.damage})`);
});

test("participation window rules", () => {
  // Zero windows never qualify.
  assert.equal(new SectionParticipation().eligible(), false);
  // Disconnected seat counts as inactive able-to-act windows.
  const d = new SectionParticipation();
  for (let w = 0; w < 4; w++) {
    for (let i = 0; i < 60; i++) d.tick({ able: true, downed: false, connected: w < 1 });
    if (w < 1) d.markUseful(true);
    d.markUseful(false); // ignored while disconnected
    d.closeWindow();
  }
  assert.deepEqual([d.active, d.denominator], [1, 4]);
  assert.equal(d.eligible(), false);
  // Downed after genuine participation is excluded from the denominator.
  const g = new SectionParticipation();
  for (let i = 0; i < 60; i++) g.tick({ able: true, downed: false, connected: true });
  g.markUseful(true);
  g.closeWindow();
  for (let w = 0; w < 5; w++) {
    for (let i = 0; i < 60; i++) g.tick({ able: false, downed: true, connected: true });
    g.closeWindow();
  }
  assert.deepEqual([g.active, g.denominator], [1, 1]);
  assert.equal(g.eligible(), true);
  // Downed without having participated still counts against the player.
  const n = new SectionParticipation();
  for (let w = 0; w < 3; w++) {
    for (let i = 0; i < 60; i++) n.tick({ able: false, downed: true, connected: true });
    n.closeWindow();
  }
  assert.equal(n.eligible(), false);
  assert.equal(n.denominator, 3);
});

test("party wipe ends the attempt, including solo", () => {
  const sim = soloSim("vektor", 1);
  sim.start();
  const p = sim.players.get("p")!;
  p.hp = 1;
  const e = sim.spawn("pursuer", p.x + 30, p.y)!;
  e.state = "windup";
  e.t = 0.01;
  e.attack = { kind: "melee", ang: Math.PI, tx: p.x, ty: p.y };
  ticks(sim, 3);
  assert.equal(p.life, "downed");
  assert.equal(sim.result, "failed");
});

test("downed teammate can be revived by standing close", () => {
  const sim = new Sim({ runId: "rev", tier: 1, partySize: 2 });
  sim.addPlayer("a", "pa", "A", loadoutFor("litos", 5));
  sim.addPlayer("b", "pb", "B", loadoutFor("pyra", 5));
  const a = sim.players.get("a")!;
  const b = sim.players.get("b")!;
  b.life = "downed";
  b.downT = 20;
  b.hp = 0;
  a.x = b.x + 20;
  a.y = b.y;
  ticks(sim, 20 * 3);
  assert.equal(b.life, "alive");
  assert.equal(a.stats.revives, 1);
});

test("Crystal Warden: pylons shield the boss, breaking them staggers it", async () => {
  const { WARDEN } = await import("../shared/src/index.ts");
  const sim = new Sim({ runId: "warden", tier: 1, partySize: 1, seed: 4, boss: "warden" });
  sim.addPlayer("p", "pp", "P", loadoutFor("pyra", 12));
  const p = sim.players.get("p")!;
  const boss = sim.spawn("boss", 3800, 300)!;
  assert.equal(boss.variant, "warden");
  sim.tick(); // raises pylons
  const pylons = [...sim.enemies.values()].filter((e) => e.kind === "pylon");
  assert.equal(pylons.length, WARDEN.pylons);
  const hp0 = boss.hp;
  (sim as any).damageEnemy(p, boss, 1000, 0, false, 0, p.x, p.y);
  const shieldedLoss = hp0 - boss.hp;
  assert.ok(shieldedLoss <= 1000 * (1 - WARDEN.shieldReduction) * 1.2, `shielded loss ${shieldedLoss}`);
  for (const py of pylons) (sim as any).damageEnemy(p, py, 1e6, 0, false, 0, p.x, p.y);
  assert.equal([...sim.enemies.values()].filter((e) => e.kind === "pylon").length, 0);
  assert.equal(boss.state, "stagger", "boss is exposed when the last pylon breaks");
  const hp1 = boss.hp;
  (sim as any).damageEnemy(p, boss, 1000, 0, false, 0, p.x, p.y);
  assert.ok(hp1 - boss.hp > shieldedLoss * 4, "full damage once exposed");
});

test("Crystal Warden beam hurts players on the line and is dodged with i-frames", async () => {
  const sim = new Sim({ runId: "beam", tier: 1, partySize: 2, seed: 4, boss: "warden" });
  sim.addPlayer("a", "pa", "A", loadoutFor("litos", 10));
  sim.addPlayer("b", "pb", "B", loadoutFor("litos", 10));
  const a = sim.players.get("a")!;
  const b = sim.players.get("b")!;
  const boss = sim.spawn("boss", 3600, 300)!;
  boss.state = "stagger";
  boss.t = 99;
  a.x = 3800; a.y = 300; // on the beam line
  b.x = 3800; b.y = 300;
  b.iframes = 99; // dodging through it
  (sim as any).addHazard({ kind: "beam", side: "enemy", ownerId: boss.id, x: boss.x, y: boss.y, r: 17, delay: 0, life: 1, dps: 200, slow: 0, stagger: 0, hitOnce: false, ang: 0, len: 540, spin: 0 });
  const ha = a.hp, hb = b.hp;
  for (let i = 0; i < 10; i++) sim.tick();
  assert.ok(a.hp < ha - 50, "beam damages the player in its path");
  assert.equal(b.hp, hb, "i-frames avoid the beam");
});

test("a four-player bot party defeats the Crystal Warden", () => {
  const sim = new Sim({ runId: "warden-run", tier: 1, partySize: 4, seed: 9, boss: "warden" });
  ["litos", "krios", "pyra", "vektor"].forEach((l, i) => sim.addPlayer(`p${i}`, `x${i}`, `B${i}`, loadoutFor(l as any, 6)));
  sim.start();
  for (let i = 0; i < 160 && !sim.bossKill && sim.result === "running"; i++) runBots(sim, {}, 5);
  assert.ok(sim.bossKill, `warden killed (stage ${sim.stage}, result ${sim.result})`);
});
