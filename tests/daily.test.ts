import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { matchMaker } from "colyseus";
import { BOX_TIERS, DAILY, Sim, dailyKey, dailyMutator } from "../shared/src/index.ts";
import { openDb } from "../server/src/db.ts";
import { ProfileService } from "../server/src/profiles.ts";
import { loadoutFor } from "./helpers.ts";
import { NetBot, guest, sleep, startTestServer, waitFor } from "./net-helpers.ts";

const DAY = 86_400_000;

test("daily rule rotates through every mutator; the day key is the UTC date", () => {
  const t0 = Date.UTC(2026, 9, 6, 12);
  assert.equal(dailyKey(t0), "2026-10-06");
  assert.equal(dailyKey(Date.UTC(2026, 9, 6, 23, 59)), "2026-10-06");
  const seen = new Set([0, 1, 2].map((d) => dailyMutator(t0 + d * DAY)));
  assert.deepEqual([...seen].sort(), [...DAILY.mutators].sort());
  assert.equal(dailyMutator(t0), dailyMutator(t0 + 3 * DAY));
});

test("elites mutator promotes about 30% of regular spawns; never the boss", () => {
  const count = (mutator?: "elites") => {
    const sim = new Sim({ runId: "d", tier: 1, partySize: 1, seed: 5, mutator });
    sim.addPlayer("p", "pp", "P", loadoutFor("litos", 5));
    let elites = 0;
    for (let i = 0; i < 300; i++) {
      const e = sim.spawn("pursuer", 900, 300)!;
      if (e.elite) elites++;
      sim.enemies.delete(e.id);
    }
    const boss = sim.spawn("boss", 3800, 300)!;
    return { elites, boss: boss.elite };
  };
  assert.equal(count().elites, 0);
  const m = count("elites");
  assert.ok(m.elites > 60 && m.elites < 120, `elite share ${m.elites}/300`);
  assert.equal(m.boss, "");
});

test("glass mutator: players take 30% more damage; frenzy enemies move faster", () => {
  const hit = (mutator?: "glass") => {
    const sim = new Sim({ runId: "g", tier: 1, partySize: 1, seed: 1, mutator });
    const p = sim.addPlayer("p", "pp", "P", loadoutFor("pyra", 5));
    (sim as any).damagePlayer(p, 20);
    return p.maxHp - p.hp;
  };
  const base = hit(), glass = hit("glass");
  assert.ok(base > 0);
  assert.ok(glass / base > 1.2 && glass / base < 1.4, `glass ratio ${glass / base}`);

  const travel = (mutator?: "frenzy") => {
    const sim = new Sim({ runId: "f", tier: 1, partySize: 1, seed: 1, mutator });
    sim.addPlayer("p", "pp", "P", loadoutFor("pyra", 5));
    const e = sim.spawn("pursuer", 600, 300)!;
    e.state = "move";
    e.t = 0;
    const x0 = e.x;
    for (let i = 0; i < 10; i++) sim.tick();
    return Math.abs(e.x - x0);
  };
  assert.ok(travel("frenzy") > travel() * 1.1, "frenzy enemies are faster");
});

test("daily claim: one per profile per day, idempotent for the same run", async () => {
  const db = await openDb({});
  const svc = new ProfileService(db);
  const { profile } = await svc.createGuest("Daily");
  assert.equal(await svc.dailyClaimed(profile.id, "2026-10-06"), false);
  const [a, b] = await Promise.all([svc.claimDaily(profile.id, "2026-10-06", "run-1"), svc.claimDaily(profile.id, "2026-10-06", "run-1")]);
  assert.ok(a && b, "same run may retry");
  assert.equal(await svc.claimDaily(profile.id, "2026-10-06", "run-2"), false, "second run the same day gets nothing extra");
  assert.equal(await svc.claimDaily(profile.id, "2026-10-07", "run-2"), true, "next day is a new claim");
  assert.equal(await svc.dailyClaimed(profile.id, "2026-10-06"), true);
  await db.close();
});

let app: Awaited<ReturnType<typeof startTestServer>>;
before(async () => {
  app = await startTestServer();
});
after(async () => {
  await app.close();
});

test("daily run over the network: leader-only toggle, mutator applied, first win gives at least gold", async () => {
  const a = new NetBot(app.base, (await guest(app.base, "Sun1")).token);
  const b = new NetBot(app.base, (await guest(app.base, "Sun2")).token);
  await a.create("pyra");
  await b.join(a.room.roomId, "krios");
  b.room.send("daily", { on: true });
  await sleep(300);
  assert.equal(a.state.daily, false, "only the leader toggles the daily challenge");
  a.room.send("daily", { on: true });
  await waitFor(() => b.state.daily === true, 3000, "daily synced");
  assert.ok(DAILY.mutators.includes(b.state.dailyMutator));
  b.room.send("ready", { ready: true });
  await sleep(200);
  a.room.send("start");
  await waitFor(() => a.state.phase === "running" && b.state.phase === "running", 5000, "running");
  const server = matchMaker.getLocalRoomById(a.room.roomId) as any;
  assert.equal(server.sim.opts.mutator, a.state.dailyMutator);
  // Simulate the boss falling with both players eligible.
  server.sim.bossKill = { x: 3800, y: 300, players: [...server.sim.players.values()].map((p: any) => ({ id: p.id, eligible: true, level: 5, stats: { ...p.stats } })) };
  await waitFor(() => [...server.seats.values()].every((s: any) => s.box), 5000, "boxes granted");
  for (const s of server.seats.values() as Iterable<any>) {
    assert.equal(s.box.daily, true);
    assert.ok(BOX_TIERS.indexOf(s.box.tier) >= BOX_TIERS.indexOf("gold"), `tier ${s.box.tier}`);
  }
  for (const bot of [a, b]) await bot.room.leave(true).catch(() => {});
});
