import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { matchMaker } from "colyseus";
import { NetBot, guest, seeded, sleep, startTestServer, waitFor } from "./net-helpers.ts";

let app: Awaited<ReturnType<typeof startTestServer>>;
before(async () => {
  app = await startTestServer();
});
after(async () => {
  await app.close();
});

async function lobby(n: number, lineages = ["pyra", "krios", "vektor", "litos"]) {
  const bots: NetBot[] = [];
  for (let i = 0; i < n; i++) bots.push(new NetBot(app.base, (await guest(app.base, `P${i}`)).token));
  await bots[0].create(lineages[0]);
  for (let i = 1; i < n; i++) await bots[i].join(bots[0].room.roomId, lineages[i % lineages.length]);
  return bots;
}
async function startRun(bots: NetBot[]) {
  for (const b of bots.slice(1)) b.room.send("ready", { ready: true });
  await waitFor(() => [...bots[0].state.players.values()].filter((p: any) => p.ready).length === bots.length - 1, 3000, "ready");
  bots[0].room.send("start");
  await waitFor(() => bots.every((b) => b.state.phase === "running"), 5000, "running");
}
async function closeAll(bots: NetBot[]) {
  for (const b of bots) {
    b.stopDriving();
    await b.room?.leave(true).catch(() => {});
  }
}

test("two independent sessions join by code and see the same authoritative enemy state", async () => {
  const bots = await lobby(2);
  assert.match(bots[0].room.roomId, /^[A-Z2-9]{5}$/);
  await startRun(bots);
  bots.forEach((b) => b.startDriving());
  await sleep(4000);
  bots.forEach((b) => b.stopDriving());
  const server = matchMaker.getLocalRoomById(bots[0].room.roomId) as any;
  const snap = (st: any) => [...st.enemies.values()].map((e: any) => `${e.id}:${e.hp}`).sort().join(",") + "|" + st.stage;
  const serverSnap = () => [...server.sim.enemies.values()].map((e: any) => `${e.id}:${e.hp}`).sort().join(",") + "|" + server.sim.stage;
  // Both clients converge to the authoritative simulation within a few patches.
  await waitFor(() => snap(bots[0].state) === serverSnap() && snap(bots[1].state) === serverSnap(), 3000, "convergence");
  const dealt = [...server.sim.players.values()].map((p: any) => p.stats.damage);
  assert.ok(dealt.every((d: number) => d > 0), "both clients' inputs damaged the shared enemies");
  await closeAll(bots);
});

test("eight independent profiles connect; a ninth is rejected", async () => {
  const bots = await lobby(8);
  await waitFor(() => bots.every((b) => b.state.players.size === 8), 3000, "eight players visible to all");
  const ninth = new NetBot(app.base, (await guest(app.base, "Ninth")).token);
  await assert.rejects(ninth.join(bots[0].room.roomId, "pyra"));
  await sleep(200);
  assert.equal(bots[0].state.players.size, 8);
  await closeAll(bots);
});

test("late joins after mission start are rejected", async () => {
  const bots = await lobby(2);
  await startRun(bots);
  const late = new NetBot(app.base, (await guest(app.base, "Late")).token);
  await assert.rejects(late.join(bots[0].room.roomId, "pyra"));
  await closeAll(bots);
});

test("one profile cannot control two rooms or two seats", async () => {
  const g = await guest(app.base, "Twin");
  const a = new NetBot(app.base, g.token);
  await a.create("pyra");
  const b = new NetBot(app.base, g.token);
  await assert.rejects(b.join(a.room.roomId, "pyra"), /already_in_room/);
  const c = new NetBot(app.base, g.token);
  await assert.rejects(c.create("krios"), /already_in_run/);
  await a.room.leave(true);
  await sleep(200);
  const d = new NetBot(app.base, g.token);
  await d.create("krios"); // lock released after leaving
  await d.room.leave(true);
});

test("invalid credentials are refused", async () => {
  const bad = new NetBot(app.base, "x".repeat(43));
  await assert.rejects(bad.create("pyra"), /invalid_credential/);
});

test("malformed and forged messages are rejected without changing progression", async () => {
  const g = await guest(app.base, "Cheater");
  const bots = [new NetBot(app.base, g.token), new NetBot(app.base, (await guest(app.base, "Friend")).token)];
  await bots[0].create("pyra");
  await bots[1].join(bots[0].room.roomId, "krios");
  await startRun(bots);
  const r = bots[0].room;
  r.send("xp", { amount: 99999 });
  r.send("damage", { target: "e1", amount: 99999 });
  r.send("reward", { xp: 1e9 });
  r.send("input", { seq: "1", mx: 5, my: 0, atk: "yes" });
  r.send("input", { seq: 1, mx: 50, my: 0, atk: true });
  r.send("action", { seq: 2, a: "nuke", dx: 0, dy: 0 });
  r.send("lineage", { lineage: "litos" });
  await sleep(500);
  assert.ok((bots[0].messages.rejected ?? []).length >= 3, "unknown types are answered with a rejection");
  assert.ok((bots[0].messages.error ?? []).some((e: any) => e.code === "lineage_locked"), "lineage switch during a run is rejected");
  assert.equal(bots[0].me.lineage, "pyra");
  const server = matchMaker.getLocalRoomById(r.roomId) as any;
  const sp = server.sim.players.get(r.sessionId);
  assert.equal(sp.input.mx, 0, "out-of-range input ignored");
  const enemies = [...server.sim.enemies.values()];
  assert.ok(enemies.every((e: any) => e.hp === e.maxHp), "no forged damage");
  const res = await fetch(app.base + "/api/profile", { headers: { authorization: `Bearer ${g.token}` } });
  const { profile } = await res.json();
  assert.deepEqual([profile.lineages.pyra.level, profile.lineages.pyra.xp, profile.salvage], [1, 0, 0]);
  await closeAll(bots);
});

test("disconnect + reconnect restores the same seat with cleared inputs and no duplicate", async () => {
  const bots = await lobby(2);
  await startRun(bots);
  const victim = bots[1];
  const sessionId = victim.room.sessionId;
  const token = victim.room.reconnectionToken;
  victim.room.send("input", { seq: 5, mx: 1, my: 0, atk: true });
  await sleep(200);
  const server = matchMaker.getLocalRoomById(victim.room.roomId) as any;
  assert.equal(server.sim.players.get(sessionId).input.atk, true);
  victim.dropConnection();
  await waitFor(() => bots[0].state.players.get(sessionId)?.connected === false, 3000, "seat marked disconnected");
  assert.equal(server.sim.players.get(sessionId).input.atk, false, "held input cleared on disconnect");
  assert.equal(server.sim.players.get(sessionId).input.mx, 0);
  await sleep(500);
  await victim.reconnectWith(token);
  assert.equal(victim.room.sessionId, sessionId, "same identity");
  await waitFor(() => bots[0].state.players.get(sessionId)?.connected === true, 3000, "reconnected");
  assert.equal(bots[0].state.players.size, 2, "no duplicate character");
  assert.equal(server.sim.players.size, 2);
  // The new connection can keep sending inputs (sequence numbers continue).
  victim.seq = 100;
  victim.room.send("input", { seq: 101, mx: 0, my: 1, atk: false });
  await sleep(200);
  assert.equal(server.sim.players.get(sessionId).input.my, 1);
  await closeAll(bots);
});

test("leader leaving the lobby transfers leadership", async () => {
  const bots = await lobby(3);
  const second = bots[1].room.sessionId;
  await bots[0].room.leave(true);
  await waitFor(() => bots[1].state.leaderId === second, 3000, "leader transfer");
  await closeAll(bots.slice(1));
});
