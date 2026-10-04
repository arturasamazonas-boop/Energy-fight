// Simulated-client network test (NOT a human playtest): eight independent
// connections with separate profiles drive the real server through a whole
// mission. The room runs its simulation at 3× speed to keep the test short.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { matchMaker } from "colyseus";
import { fullClearXp, sectionXp } from "../shared/src/index.ts";
import { NetBot, seeded, sleep, startTestServer, waitFor } from "./net-helpers.ts";

let app: Awaited<ReturnType<typeof startTestServer>>;
before(async () => {
  app = await startTestServer();
});
after(async () => {
  await app.close();
});

test("eight simulated clients complete a mission; per-profile rewards match the server ledger", { timeout: 420_000 }, async () => {
  const levels = [18, 1, 6, 4, 8, 3, 10, 5];
  const lineages = ["litos", "krios", "pyra", "vektor", "pyra", "litos", "krios", "vektor"];
  const profiles = [];
  for (let i = 0; i < 8; i++) profiles.push(await seeded(app, `Bot${i}`, levels[i]));
  const bots = profiles.map((p, i) => new NetBot(app.base, p.token, i === 7 ? { passive: true } : i === 1 ? { timid: true } : { seed: i }));
  await bots[0].create(lineages[0], { testSpeed: 3 });
  const code = bots[0].room.roomId;
  for (let i = 1; i < 8; i++) await bots[i].join(code, lineages[i]);
  await waitFor(() => bots.every((b) => b.state.players.size === 8), 5000, "8 players");
  for (const b of bots.slice(1)) b.room.send("ready", { ready: true });
  await waitFor(() => [...bots[0].state.players.values()].filter((p: any) => p.ready).length === 7, 5000, "ready");
  bots[0].room.send("start");
  await waitFor(() => bots.every((b) => b.state.phase === "running"), 5000, "running");
  const server = matchMaker.getLocalRoomById(code) as any;
  const runId = server.state.runId;
  assert.equal(server.sim.players.size, 8);
  bots.forEach((b) => b.startDriving());

  // Periodically check that every client converges to the authoritative state.
  let convergenceChecks = 0;
  let reconnected = false;
  const deadline = Date.now() + 380_000;
  while (Date.now() < deadline && server.state.phase === "running") {
    await sleep(1500);
    if (server.state.phase !== "running") break;
    const snap = (st: any) => `${st.stage}|${st.section}`;
    try {
      await waitFor(() => bots.every((b) => snap(b.state) === `${server.sim.stage}|${server.sim.section}`), 1500, "phase convergence");
      convergenceChecks++;
    } catch {}
    // Reconnect around boss death: drop one client late in the boss fight.
    const boss = server.sim.bossId && server.sim.enemies.get(server.sim.bossId);
    if (!reconnected && boss && boss.hp < boss.maxHp * 0.35) {
      reconnected = true;
      const victim = bots[2];
      const token = victim.room.reconnectionToken;
      const sid = victim.room.sessionId;
      victim.dropConnection();
      await sleep(1200);
      await victim.reconnectWith(token);
      assert.equal(victim.room.sessionId, sid);
      victim.startDriving();
    }
  }
  bots.forEach((b) => b.stopDriving());
  await waitFor(() => bots.every((b) => (b.messages.results ?? []).length === 1), 30_000, "results on every client");
  assert.ok(convergenceChecks >= 3, `convergence checked ${convergenceChecks} times`);
  const results = bots[0].messages.results[0];
  for (const b of bots) assert.deepEqual(b.messages.results[0], results, "every client sees the same results");
  console.log(`# mission result: ${results.success ? "success" : "failed"} in ${results.durationSec}s wall time (3× sim speed); reconnect tested: ${reconnected}`);

  for (let i = 0; i < 8; i++) {
    const r = results.players.find((p: any) => p.name === `Bot${i}`);
    assert.ok(r, `result for Bot${i}`);
    const ledger = await app.db.query("SELECT * FROM reward_ledger WHERE run_id = $1 AND profile_id = $2 ORDER BY section_id", [runId, profiles[i].profile.id]);
    const xpSum = ledger.reduce((a: number, row: any) => a + Number(row.xp), 0);
    const salvageSum = ledger.reduce((a: number, row: any) => a + Number(row.salvage), 0);
    assert.equal(r.totalXp, xpSum, `Bot${i} displayed XP equals persisted ledger`);
    assert.equal(r.totalSalvage, salvageSum, `Bot${i} displayed salvage equals ledger`);
    const prof = await app.profiles.getProfile(profiles[i].profile.id);
    const rec = prof!.lineages[lineages[i] as "pyra"];
    assert.deepEqual([r.levelNow, r.xpNow], [rec.level, rec.xp], `Bot${i} level matches database`);
    assert.equal(prof!.salvage, salvageSum, `Bot${i} salvage balance`);
    // Each eligible section paid exactly the carry formula for this profile.
    const parts = sectionXp(fullClearXp(1, levels[i]));
    for (const row of ledger) assert.equal(Number(row.xp), row.eligible ? parts[row.section_id - 1] : 0);
  }
  const afk = results.players.find((p: any) => p.name === "Bot7");
  assert.equal(afk.totalXp, 0, "AFK participant earns nothing");
  const novice = results.players.find((p: any) => p.name === "Bot1");
  const helper = results.players.find((p: any) => p.name === "Bot0");
  if (results.success) {
    assert.ok(novice.totalXp > 0, "timid low-damage novice still earns XP");
    assert.ok(novice.totalXp > helper.totalXp, "carry: novice earns more XP than the veteran");
    const noviceAll = novice.sections.length === 3 && novice.sections.every((s: any) => s.eligible);
    assert.equal(helper.supportMark, noviceAll, "support mark iff the lower-level teammate qualified in every section");
    // Every player's mark follows the rule exactly (≥5 levels above a fully eligible teammate).
    const full = (p: any) => p.sections.length === 3 && p.sections.every((s: any) => s.eligible);
    for (const p of results.players) {
      const expected = full(p) && results.players.some((o: any) => o !== p && full(o) && o.levelAtStart <= p.levelAtStart - 5);
      assert.equal(p.supportMark, expected, `support mark for ${p.name}`);
      const prof = await app.profiles.getProfile(profiles[Number(p.name.slice(3))].profile.id);
      assert.equal(prof!.supportMarks, expected ? 1 : 0);
    }
  }
  // Re-processing every section award is a no-op.
  const before = await Promise.all(profiles.map((p) => app.profiles.getProfile(p.profile.id)));
  for (let i = 0; i < 8; i++) {
    for (const s of [1, 2, 3]) {
      await app.profiles.awardSection({ runId, sectionId: s, profileId: profiles[i].profile.id, lineage: lineages[i] as any, tier: 1, levelAtStart: levels[i], eligible: true, supportMark: true });
    }
  }
  const afterP = await Promise.all(profiles.map((p) => app.profiles.getProfile(p.profile.id)));
  if (results.success) assert.deepEqual(afterP, before, "duplicate award processing changes nothing");
  for (const b of bots) await b.room.leave(true).catch(() => {});
});
