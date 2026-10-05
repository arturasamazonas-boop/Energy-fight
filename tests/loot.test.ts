import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BOX_TIERS,
  LOOT,
  RARITIES,
  SLOTS,
  STATS,
  Sim,
  buildLoadout,
  defaultLineageRecord,
  gearTotals,
  impactScores,
  rollBoxContents,
  rollBoxTier,
  rollItem,
  type ItemInstance,
} from "../shared/src/index.ts";
import { openDb } from "../server/src/db.ts";
import { ProfileService } from "../server/src/profiles.ts";
import { loadoutFor, runBots } from "./helpers.ts";

function mulberry(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let n = 0;
const id = () => `i${n++}`;

test("crate tier odds at average performance: platinum ≈ 1/100, divine ≈ 1/1000, ultra ≈ 1/10000", () => {
  const rng = mulberry(42);
  const N = 2_000_000;
  const counts = Object.fromEntries(BOX_TIERS.map((t) => [t, 0])) as Record<string, number>;
  for (let i = 0; i < N; i++) counts[rollBoxTier(0.5, rng)]++;
  const rate = (t: string) => counts[t] / N;
  assert.ok(Math.abs(rate("platinum") - 1 / 100) < 0.0006, `platinum ${rate("platinum")}`);
  assert.ok(Math.abs(rate("divine") - 1 / 1000) < 0.0002, `divine ${rate("divine")}`);
  assert.ok(Math.abs(rate("ultra") - 1 / 10000) < 0.00004, `ultra ${rate("ultra")}`);
  assert.ok(rate("bronze") > rate("silver") * 0.5 && rate("gold") > 0.1);
});

test("better impact gives better crates", () => {
  const avg = (p: number) => {
    const rng = mulberry(7);
    let s = 0;
    for (let i = 0; i < 200_000; i++) s += BOX_TIERS.indexOf(rollBoxTier(p, rng));
    return s / 200_000;
  };
  assert.ok(avg(1) > avg(0.5) + 0.3 && avg(0.5) > avg(0) + 0.3);
});

test("impact is relative to the party and weighted by level", () => {
  const base = { stagger: 0, controlSeconds: 0, objectiveSeconds: 0, revives: 0, downs: 0 };
  const solo = impactScores([{ id: "a", level: 5, damage: 1000, ...base }]).get("a")!;
  assert.equal(solo.relative, 1);
  // Same raw damage, but the level-1 player achieved it with far weaker stats → higher impact.
  const s = impactScores([
    { id: "vet", level: 18, damage: 5000, ...base },
    { id: "kid", level: 1, damage: 5000, ...base },
  ]);
  assert.ok(s.get("kid")!.p > s.get("vet")!.p);
  // Downs lower the score; a pure AFK-like zero contribution gets a low score.
  const d = impactScores([
    { id: "a", level: 5, damage: 1000, ...base, downs: 3 },
    { id: "b", level: 5, damage: 1000, ...base },
  ]);
  assert.ok(d.get("a")!.p < d.get("b")!.p);
});

test("box contents follow the tier table; ULTRA crate holds a unique ULTRA item", () => {
  const rng = mulberry(3);
  for (let i = 0; i < 200; i++) {
    const b = rollBoxContents("bronze", rng, id);
    assert.equal(b.items.length, 1);
    assert.ok(["common", "rare"].includes(b.items[0].rarity));
  }
  const u = rollBoxContents("ultra", rng, id);
  assert.equal(u.items.length, 3);
  assert.ok(u.items.some((i) => i.rarity === "ultra" && i.baseId.startsWith("ultra_") && i.special));
  assert.ok(u.salvage >= 300);
});

test("items: primary stat by slot, rarity scales power, totals are capped", () => {
  const rng = mulberry(9);
  for (const r of RARITIES) {
    const it = rollItem(r, rng, id, "weapon");
    assert.ok((it.stats.damage ?? 0) > 0);
    assert.ok(it.stats.damage! <= LOOT.statMax.damage + 1e-9);
  }
  // Six ultra items cannot exceed the caps.
  const gear: ItemInstance[] = SLOTS.map((s) => rollItem("ultra", rng, id, s));
  const tot = gearTotals(gear);
  for (const s of STATS) assert.ok(tot.stats[s] <= LOOT.statCap[s] + 1e-9);
  assert.equal(tot.specials.length, 6);
  const base = buildLoadout({ ...defaultLineageRecord("pyra"), level: 10 });
  const geared = buildLoadout({ ...defaultLineageRecord("pyra"), level: 10 }, gear);
  assert.ok(geared.damage > base.damage && geared.maxHp > base.maxHp);
  assert.ok(geared.spec.skill1.cooldown < base.spec.skill1.cooldown);
  assert.ok(geared.damage / base.damage <= 1 + LOOT.statCap.damage + 1e-9);
});

test("gear specials work in the simulation", () => {
  const mk = (special: string) =>
    ({ id: `x-${special}`, baseId: "relic_0", slot: "relic", rarity: "mythic", stats: { crit: 0 }, special } as ItemInstance);
  // Phoenix: self-revive once.
  const sim = new Sim({ runId: "phx", tier: 1, partySize: 2 });
  const L = buildLoadout({ ...defaultLineageRecord("litos"), level: 5 }, [mk("phoenix")]);
  sim.addPlayer("p", "pp", "P", L);
  sim.addPlayer("q", "pq", "Q", loadoutFor("pyra", 5));
  const p = sim.players.get("p")!;
  const q = sim.players.get("q")!;
  q.x = 1300; // far away, cannot revive
  p.hp = 1;
  const e = sim.spawn("pursuer", p.x + 30, p.y)!;
  e.state = "windup";
  e.t = 0.01;
  e.attack = { kind: "melee", ang: Math.PI, tx: p.x, ty: p.y };
  sim.tick();
  assert.equal(p.life, "downed");
  sim.enemies.clear();
  for (let i = 0; i < 70; i++) sim.tick();
  assert.equal(p.life, "alive");
  assert.equal(p.stats.downs, 1);
  // Overcharge: starts with overdrive.
  const s2 = new Sim({ runId: "oc", tier: 1, partySize: 1 });
  s2.addPlayer("o", "po", "O", buildLoadout({ ...defaultLineageRecord("krios"), level: 6 }, [mk("overcharge")]));
  assert.equal(s2.players.get("o")!.od, 50);
});

test("boss kill records eligible players for crates", () => {
  const sim = new Sim({ runId: "bk", tier: 1, partySize: 2, seed: 5 });
  sim.addPlayer("a", "pa", "A", loadoutFor("litos", 18, "seismic"));
  sim.addPlayer("b", "pb", "B", loadoutFor("krios", 16));
  sim.start();
  for (let i = 0; i < 200 && !sim.bossKill && sim.result === "running"; i++) runBots(sim, {}, 5);
  assert.ok(sim.bossKill, `boss killed (stage ${sim.stage})`);
  assert.equal(sim.bossKill!.players.length, 2);
  assert.ok(sim.bossKill!.players.every((p) => p.eligible));
});

test("crate grant is idempotent; equip moves items between lineages; dismantle gives salvage", async () => {
  const db = await openDb({});
  const svc = new ProfileService(db);
  const { profile } = await svc.createGuest("Looter");
  const contents = rollBoxContents("gold", mulberry(1), () => crypto.randomUUID());
  const grant = { runId: "run-x", profileId: profile.id, tier: "gold" as const, impact: 1.2, performance: 0.7, salvage: contents.salvage, items: contents.items };
  const [a, b] = await Promise.all([svc.grantBox(grant), svc.grantBox(grant)]);
  assert.deepEqual(a, b);
  assert.equal((await svc.inventory(profile.id)).length, contents.items.length);
  assert.equal((await svc.getProfile(profile.id))!.salvage, contents.salvage);
  const boxes = await svc.listBoxes(profile.id);
  assert.equal(boxes.length, 1);
  assert.equal(boxes[0].opened, false);
  assert.equal((await svc.openBox(profile.id, "run-x")).opened, true);

  const item = contents.items[0];
  await svc.equipItem(profile.id, "pyra", item.slot, item.id);
  let p = (await svc.getProfile(profile.id))!;
  assert.equal(p.lineages.pyra.equipment?.[item.slot], item.id);
  await assert.rejects(svc.equipItem(profile.id, "pyra", item.slot === "weapon" ? "shield" : "weapon", item.id), /invalid_choice/);
  await svc.equipItem(profile.id, "krios", item.slot, item.id);
  p = (await svc.getProfile(profile.id))!;
  assert.equal(p.lineages.krios.equipment?.[item.slot], item.id);
  assert.equal(p.lineages.pyra.equipment?.[item.slot], undefined, "an item is worn by one lineage at a time");
  assert.equal((await svc.equippedItems(profile.id, "krios")).length, 1);
  const before = p.salvage;
  const r = await svc.dismantleItem(profile.id, item.id);
  assert.equal(r.profile!.salvage, before + LOOT.dismantleSalvage[item.rarity]);
  assert.equal(r.profile!.lineages.krios.equipment?.[item.slot], undefined);
  await assert.rejects(svc.dismantleItem(profile.id, item.id), /not_found/);
  const other = await svc.createGuest("Thief");
  await assert.rejects(svc.equipItem(other.profile.id, "pyra", contents.items[1].slot, contents.items[1].id), /not_found/);
  await db.close();
});
