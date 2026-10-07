import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { matchMaker } from "colyseus";
import { SECTOR_COUNT, Sim, sectorDef, sectorTier } from "../shared/src/index.ts";
import { openDb } from "../server/src/db.ts";
import { ProfileService } from "../server/src/profiles.ts";
import { loadoutFor, runBots } from "./helpers.ts";
import { NetBot, sleep, startTestServer, waitFor } from "./net-helpers.ts";

test("sector rules: bosses every 4th sector, elites end in 8, difficulty grows", () => {
  for (let n = 1; n <= SECTOR_COUNT; n++) {
    const s = sectorDef(n);
    assert.deepEqual(sectorDef(n), s, "deterministic");
    assert.equal(s.final === "boss", n % 4 === 0, `boss on ${n}`);
    assert.equal(s.elite, n % 10 === 8);
    assert.equal(s.rewardMult, s.elite ? 2 : 1);
    assert.equal(s.tier, sectorTier(n));
    if (n > 1 && !s.elite && !sectorDef(n - 1).elite) assert.ok(s.hpMult >= sectorDef(n - 1).hpMult, `hp grows at ${n}`);
  }
  assert.equal(sectorDef(99).n, SECTOR_COUNT);
});

test("a sector without a boss is won by clearing its rooms; bots finish sector 1", () => {
  const sim = new Sim({ runId: "sec1", tier: 1, partySize: 1, sector: 1 });
  sim.addPlayer("p0", "pp", "Bot", loadoutFor("pyra", 4));
  sim.start();
  runBots(sim, {}, 600);
  assert.equal(sim.result, "success");
  assert.equal(sim.bossId, null, "no boss in sector 1");
  assert.ok(sim.timeLeft > 0);
});

test("the sector timer ends the run when it reaches zero", () => {
  const sim = new Sim({ runId: "late", tier: 1, partySize: 1, sector: 2 });
  sim.addPlayer("p0", "pp", "Idle", loadoutFor("litos", 20));
  sim.start();
  sim.timeLeft = 0.2;
  for (let i = 0; i < 10; i++) sim.tick();
  assert.equal(sim.result, "failed");
  assert.equal(sim.failReason, "timeout");
});

test("finishing a sector unlocks the next one; elite sectors pay double", async () => {
  const db = await openDb({});
  const svc = new ProfileService(db);
  const { profile } = await svc.createGuest("Sectors");
  assert.equal(profile.sectorUnlocked, 1);
  const award = (runId: string, sector: number, sectionId: number, mult = 1) =>
    svc.awardSection({ runId, sectionId, profileId: profile.id, lineage: "pyra", tier: sectorTier(sector), levelAtStart: 1, eligible: true, supportMark: false, sector, mult });
  for (const s of [1, 2, 3]) await award("r1", 1, s);
  assert.equal((await svc.getProfile(profile.id))!.sectorUnlocked, 2);
  const normal = await award("rA", 2, 1, 1);
  const elite = await award("rB", 2, 1, 2);
  assert.equal(elite.xp, normal.xp * 2);
  await db.close();
});

let app: Awaited<ReturnType<typeof startTestServer>>;
before(async () => {
  app = await startTestServer();
});
after(async () => {
  await app.close();
});

test("the leader can only pick an unlocked sector; the run uses it", async () => {
  const g = await app.profiles.createGuest("Leader", { level: 5, sectorUnlocked: 4 });
  const a = new NetBot(app.base, g.token);
  await a.create("pyra");
  await waitFor(() => a.state.sector === 4, 3000, "lobby opens on the newest unlocked sector");
  a.room.send("sector", { sector: 2 });
  await waitFor(() => a.state.sector === 2, 3000, "sector 2");
  a.room.send("sector", { sector: 9 });
  await sleep(250);
  assert.equal(a.state.sector, 2, "locked sector refused");
  a.room.send("sector", { sector: 4 });
  await waitFor(() => a.state.sector === 4, 3000, "sector set");
  assert.equal(a.state.mission, sectorDef(4).boss);
  a.room.send("start");
  await waitFor(() => a.state.phase === "running", 5000, "running");
  const server = matchMaker.getLocalRoomById(a.room.roomId) as any;
  assert.equal(server.sim.sector.n, 4);
  await waitFor(() => a.state.timeLeft > 0 && a.state.enemiesLeft > 0, 3000, "timer and enemy count synced");
  await a.room.leave(true);
});

test("new enemies: bulwark blocks frontal hits but breaks under a slam; coins pay scrap", () => {
  const sim = new Sim({ runId: "newe", tier: 1, partySize: 1, seed: 3 });
  const p = sim.addPlayer("p", "pp", "P", loadoutFor("litos", 8));
  sim.maxX = 1500;
  p.x = 900; p.y = 300;
  const front = sim.spawn("shield", 950, 300)!;
  front.fx = -1; front.fy = 0; // facing the player
  front.state = "move";
  const back = sim.spawn("shield", 950, 300)!;
  back.fx = 1; back.fy = 0; // facing away
  back.state = "move";
  (sim as any).damageEnemy(p, front, 100, 0, false, 0, p.x, p.y);
  (sim as any).damageEnemy(p, back, 100, 0, false, 0, p.x, p.y);
  const lostFront = front.maxHp - front.hp, lostBack = back.maxHp - back.hp;
  assert.ok(lostFront * 4 < lostBack, `front ${lostFront} vs back ${lostBack}`);
  (sim as any).damageEnemy(p, front, 50, 0, false, 0, p.x, p.y, "slam");
  assert.equal(front.state, "stagger", "slam breaks the shield wall");

  // Coins: kill → coins on the ground → walk over them → counted for the section.
  const e = sim.spawn("pursuer", 905, 300)!;
  e.hp = 1;
  (sim as any).damageEnemy(p, e, 10, 0, false, 0, p.x, p.y);
  let seq = 1;
  for (let i = 0; i < 5; i++) { sim.setInput("p", 0, 0, false, seq++); sim.tick(); }
  assert.ok(p.coins >= 1, `coins ${p.coins}`);
});

test("rollers and bombers attack with their own moves", () => {
  const sim = new Sim({ runId: "rb", tier: 1, partySize: 1, seed: 5 });
  const p = sim.addPlayer("p", "pp", "P", loadoutFor("pyra", 8));
  sim.maxX = 1500;
  p.x = 1000; p.y = 300;
  const r = sim.spawn("roller", 700, 300)!;
  r.state = "move"; r.cd = 0;
  const b = sim.spawn("bomber", 1260, 300)!;
  b.state = "move"; b.cd = 0;
  const kinds = new Set<string>();
  let seq = 1;
  for (let i = 0; i < 60; i++) {
    sim.setInput("p", 0, 0, false, seq++);
    sim.tick();
    for (const e of [r, b]) if (e.attack) kinds.add(e.attack.kind);
  }
  assert.ok(kinds.has("roll"), "roller rolls");
  assert.ok(kinds.has("bomb"), "bomber lobs");
});
