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
