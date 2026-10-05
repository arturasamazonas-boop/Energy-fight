import { randomInt, randomUUID } from "node:crypto";
import { Room, type Client } from "colyseus";
import {
  NET,
  REWARDS,
  Sim,
  TIERS,
  buildLoadout,
  carryMultiplier,
  isLineage,
  impactScores,
  rollBoxContents,
  rollBoxTier,
  parseAction,
  parseInput,
  tierSpec,
  unlocksBetween,
  type LineageId,
  type PlayerResult,
  type ResultsMsg,
  type SectionRewardView,
  type BoxTier,
  type LootMsg,
} from "@ef/shared";
import { ActiveRuns } from "./locks.ts";
import type { ProfileService, ProfileView } from "./profiles.ts";
import { EnemyS, GameState, HazardS, PickupS, PlayerS } from "./schema.ts";

export interface RoomServices {
  profiles: ProfileService;
  log?: (msg: string) => void;
  /** Automated tests only: lets a room run several simulation steps per tick. */
  allowTestSpeed?: boolean;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const activeCodes = new Set<string>();

function newCode() {
  for (let attempt = 0; attempt < 50; attempt++) {
    let c = "";
    for (let i = 0; i < 5; i++) c += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    if (!activeCodes.has(c)) return c;
  }
  throw new Error("could not allocate room code");
}

interface Seat {
  sessionId: string;
  profileId: string;
  lineage: LineageId;
  levelAtStart: number;
  departed: boolean;
  departedSection: number | null;
  eligibility: boolean[]; // per section index
  rewards: SectionRewardView[];
  box: { tier: BoxTier; impact: number; performance: number } | null;
  inputBudget: number;
  actionBudget: number;
  rejected: number;
}

export class GameRoom extends Room {
  static services: RoomServices;
  state = new GameState();
  maxClients = NET.maxPlayers;
  private seats = new Map<string, Seat>();
  private sim: Sim | null = null;
  private rewardChain: Promise<unknown> = Promise.resolve();
  private results: ResultsMsg | null = null;
  private startedAt = 0;
  private lootRolled = false;
  private speed = 1;

  get svc() {
    return GameRoom.services;
  }

  onCreate(options: any) {
    const code = typeof options?.code === "string" && /^[A-Z2-9]{5}$/.test(options.code) && !activeCodes.has(options.code) ? options.code : newCode();
    activeCodes.add(code);
    this.roomId = code;
    this.state.code = code;
    if (this.svc.allowTestSpeed && Number.isInteger(options?.testSpeed)) this.speed = Math.max(1, Math.min(10, options.testSpeed));
    this.setPrivate(true);
    this.setPatchRate(NET.patchMs);
    this.setSimulationInterval(() => this.tick(), 1000 / NET.tickHz);
    this.seatReservationTimeout = 20;

    this.onMessage("lineage", (client, m: any) => this.onLineage(client, m));
    this.onMessage("ready", (client, m: any) => this.onReady(client, m));
    this.onMessage("tier", (client, m: any) => this.onTier(client, m));
    this.onMessage("start", (client) => this.onStart(client).catch((e) => this.fail(client, e)));
    this.onMessage("input", (client, m) => this.onInput(client, m));
    this.onMessage("action", (client, m) => this.onAction(client, m));
    this.onMessage("ping", (client, m) => client.send("pong", m));
    // Anything else (for example a forged "xp" or "damage" message) is ignored.
    this.onMessage("*", (client, type) => {
      const seat = this.seats.get(client.sessionId);
      if (seat) seat.rejected++;
      client.send("rejected", { type: String(type).slice(0, 32) });
    });
  }

  async onAuth(client: Client, options: any) {
    const profileId = await this.svc.profiles.authenticate(options?.token);
    if (!profileId) throw new Error("invalid_credential");
    if (this.state.phase !== "lobby") throw new Error("run_in_progress");
    const lock = ActiveRuns.get(profileId);
    if (lock) throw new Error(lock.roomId === this.roomId ? "already_in_room" : "already_in_run");
    return { profileId };
  }

  async onJoin(client: Client, options: any) {
    const { profileId } = client.auth as { profileId: string };
    if (!ActiveRuns.acquire(profileId, this.roomId, client.sessionId)) throw new Error("already_in_run");
    if (this.state.phase !== "lobby") {
      ActiveRuns.release(profileId, this.roomId);
      throw new Error("run_in_progress");
    }
    const profile = await this.svc.profiles.getProfile(profileId);
    if (!profile) throw new Error("invalid_credential");
    const lineage: LineageId = isLineage(options?.lineage) ? options.lineage : profile.lastLineage;
    const p = new PlayerS();
    p.id = client.sessionId;
    p.name = profile.name;
    p.tierUnlocked = profile.tierUnlocked;
    this.applyLobbyLineage(p, profile, lineage);
    this.state.players.set(client.sessionId, p);
    this.seats.set(client.sessionId, {
      sessionId: client.sessionId,
      profileId,
      lineage,
      levelAtStart: p.level,
      departed: false,
      departedSection: null,
      eligibility: [],
      rewards: [],
      box: null,
      inputBudget: NET.maxInputsPerSecond,
      actionBudget: NET.maxActionsPerSecond,
      rejected: 0,
    });
    if (!this.state.leaderId) this.state.leaderId = client.sessionId;
    if (isLineage(options?.lineage)) this.svc.profiles.setLastLineage(profileId, lineage).catch(() => {});
  }

  private applyLobbyLineage(p: PlayerS, profile: ProfileView, lineage: LineageId) {
    const rec = profile.lineages[lineage];
    const L = buildLoadout(rec);
    p.lineage = lineage;
    p.level = L.level;
    p.evolution = L.evolution ?? "";
    p.mastery = L.mastery;
    p.hasSkill2 = L.hasSkill2;
    p.hasOverdrive = L.hasOverdrive;
    p.maxHp = L.maxHp;
    p.hp = L.maxHp;
  }

  private async onLineage(client: Client, m: any) {
    const seat = this.seats.get(client.sessionId);
    const p = this.state.players.get(client.sessionId);
    if (!seat || !p) return;
    // Lineage is frozen once the run starts.
    if (this.state.phase !== "lobby" || !isLineage(m?.lineage)) {
      client.send("error", { code: "lineage_locked" });
      return;
    }
    const profile = await this.svc.profiles.getProfile(seat.profileId);
    if (!profile || this.state.phase !== "lobby") return;
    seat.lineage = m.lineage;
    this.applyLobbyLineage(p, profile, m.lineage);
    p.ready = false;
    this.svc.profiles.setLastLineage(seat.profileId, m.lineage).catch(() => {});
  }

  private onReady(client: Client, m: any) {
    const p = this.state.players.get(client.sessionId);
    if (!p || this.state.phase !== "lobby") return;
    p.ready = !!m?.ready;
  }

  private onTier(client: Client, m: any) {
    if (this.state.phase !== "lobby" || client.sessionId !== this.state.leaderId) return;
    const tier = Number(m?.tier);
    const leader = this.state.players.get(client.sessionId);
    if (!TIERS.some((t) => t.tier === tier) || !leader || tier > leader.tierUnlocked) {
      client.send("error", { code: "tier_locked" });
      return;
    }
    this.state.tier = tier;
  }

  private async onStart(client: Client) {
    if (this.state.phase !== "lobby") return;
    if (client.sessionId !== this.state.leaderId) return client.send("error", { code: "not_leader" });
    const leader = this.state.players.get(client.sessionId)!;
    leader.ready = true;
    const notReady = [...this.state.players.values()].filter((p) => p.connected && !p.ready);
    if (notReady.length > 0) return client.send("error", { code: "not_all_ready" });
    if (this.state.tier > leader.tierUnlocked) return client.send("error", { code: "tier_locked" });
    this.state.phase = "starting";
    await this.lock();

    // Snapshot every participant's loadout from the database at run start.
    const runId = randomUUID();
    const participants = [...this.seats.values()].filter((s) => this.state.players.get(s.sessionId)?.connected);
    const sim = new Sim({ runId, tier: this.state.tier, partySize: participants.length });
    for (const seat of participants) {
      const profile = await this.svc.profiles.getProfile(seat.profileId);
      if (!profile) continue;
      const loadout = buildLoadout(profile.lineages[seat.lineage], await this.svc.profiles.equippedItems(seat.profileId, seat.lineage));
      seat.levelAtStart = loadout.level;
      const p = this.state.players.get(seat.sessionId)!;
      this.applyLobbyLineage(p, profile, seat.lineage);
      sim.addPlayer(seat.sessionId, seat.profileId, profile.name, loadout);
      p.maxHp = loadout.maxHp;
      p.hp = loadout.maxHp;
      p.auraRarity = loadout.gear.auraRarity;
      p.weaponRarity = loadout.gear.weaponRarity;
      p.maxS1 = loadout.spec.skill1.cooldown;
      p.maxS2 = loadout.spec.skill2.cooldown;
      ActiveRuns.setRunning(seat.profileId, this.roomId, true);
    }
    // Seats that were disconnected in the lobby do not join the run.
    for (const seat of this.seats.values()) {
      if (!participants.includes(seat)) {
        seat.departed = true;
        this.state.players.delete(seat.sessionId);
        ActiveRuns.release(seat.profileId, this.roomId);
      }
    }
    sim.start();
    this.sim = sim;
    this.state.runId = runId;
    this.state.partySize = participants.length;
    this.state.phase = "running";
    this.startedAt = Date.now();
    this.svc.profiles.recordRunStart(runId, this.roomId, this.state.tier, participants.length).catch((e) => this.svc.log?.(`run record failed: ${e.message}`));
    this.syncState();
  }

  private fail(client: Client, e: Error) {
    this.svc.log?.(`room ${this.roomId}: ${e.message}`);
    client.send("error", { code: "server_error" });
  }

  private onInput(client: Client, m: unknown) {
    const seat = this.seats.get(client.sessionId);
    if (!this.sim || !seat || this.state.phase !== "running") return;
    if (seat.inputBudget <= 0) return void seat.rejected++;
    seat.inputBudget--;
    const msg = parseInput(m);
    if (!msg) return void seat.rejected++;
    this.sim.setInput(client.sessionId, msg.mx, msg.my, msg.atk, msg.seq, msg.fx, msg.fy);
  }

  private onAction(client: Client, m: unknown) {
    const seat = this.seats.get(client.sessionId);
    if (!this.sim || !seat || this.state.phase !== "running") return;
    if (seat.actionBudget <= 0) return void seat.rejected++;
    seat.actionBudget--;
    const msg = parseAction(m);
    if (!msg) return void seat.rejected++;
    const ok = this.sim.action(client.sessionId, msg.a, msg.dx, msg.dy);
    if (!ok) client.send("deny", { seq: msg.seq, a: msg.a });
  }

  // ---- connection lifecycle --------------------------------------------------
  async onDrop(client: Client) {
    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    p.connected = false;
    this.sim?.setConnected(client.sessionId, false);
    try {
      await this.allowReconnection(client, NET.reconnectSeconds);
    } catch {
      // onLeave handles permanent departure.
    }
  }

  onReconnect(client: Client) {
    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    p.connected = true;
    this.sim?.setConnected(client.sessionId, true);
    if (this.results) client.send("results", this.results);
  }

  onLeave(client: Client) {
    const seat = this.seats.get(client.sessionId);
    if (!seat) return;
    ActiveRuns.release(seat.profileId, this.roomId);
    if (this.state.phase === "running" && this.sim) {
      seat.departed = true;
      seat.departedSection = this.sim.section;
      this.sim.depart(client.sessionId);
      const p = this.state.players.get(client.sessionId);
      if (p) {
        p.connected = false;
        p.life = "departed";
      }
    } else {
      this.state.players.delete(client.sessionId);
      if (this.state.phase === "lobby") this.seats.delete(client.sessionId);
    }
    if (this.state.leaderId === client.sessionId) {
      const next = [...this.state.players.values()].find((p) => p.connected && p.life !== "departed");
      this.state.leaderId = next?.id ?? "";
    }
  }

  onDispose() {
    activeCodes.delete(this.roomId);
    ActiveRuns.releaseRoom(this.roomId);
    if (this.sim && this.state.phase === "running") this.svc.profiles.recordRunEnd(this.state.runId, "abandoned").catch(() => {});
  }

  // ---- simulation ------------------------------------------------------------
  private tick() {
    for (const seat of this.seats.values()) {
      seat.inputBudget = Math.min(NET.maxInputsPerSecond, seat.inputBudget + NET.maxInputsPerSecond / NET.tickHz);
      seat.actionBudget = Math.min(NET.maxActionsPerSecond, seat.actionBudget + NET.maxActionsPerSecond / NET.tickHz);
    }
    const sim = this.sim;
    if (!sim || this.state.phase !== "running") return;
    const fx = [];
    for (let i = 0; i < this.speed && sim.result === "running"; i++) {
      sim.tick();
      fx.push(...sim.drainFx());
      for (const c of sim.drainClears()) this.queueSectionRewards(c.sectionId, c.eligibility);
    }
    if (fx.length) this.broadcast("fx", fx);
    if (sim.bossKill && !this.lootRolled) this.grantLoot();
    this.syncState();
    if (sim.result !== "running") this.finish(sim.result === "success");
  }

  private queueSectionRewards(sectionId: number, eligibility: Map<string, boolean>) {
    const sim = this.sim!;
    for (const [id, ok] of eligibility) {
      const seat = this.seats.get(id);
      if (seat) seat.eligibility[sectionId - 1] = ok;
    }
    // Support mark: helper ≥5 levels above an eligible teammate, both eligible for every section.
    const fullyEligible = (s: Seat) => [0, 1, 2].every((i) => s.eligibility[i] === true);
    const tasks: (() => Promise<void>)[] = [];
    for (const seat of this.seats.values()) {
      if (seat.departed || !sim.players.has(seat.sessionId)) continue; // no rewards after permanent departure
      let supportMark = false;
      if (sectionId === 3 && fullyEligible(seat)) {
        supportMark = [...this.seats.values()].some(
          (o) => o !== seat && !o.departed && fullyEligible(o) && o.levelAtStart <= seat.levelAtStart - REWARDS.supportLevelGap,
        );
      }
      const award = {
        runId: this.state.runId,
        sectionId,
        profileId: seat.profileId,
        lineage: seat.lineage,
        tier: this.state.tier,
        levelAtStart: seat.levelAtStart,
        eligible: eligibility.get(seat.sessionId) === true,
        supportMark,
      };
      tasks.push(async () => {
        const view = await this.awardWithRetry(award);
        seat.rewards = seat.rewards.filter((r) => r.sectionId !== sectionId).concat(view);
        const client = this.clients.find((c) => c.sessionId === seat.sessionId);
        client?.send("reward", view);
      });
    }
    this.rewardChain = this.rewardChain.then(() => Promise.all(tasks.map((t) => t()))).catch((e) => this.svc.log?.(`reward error ${e.message}`));
  }

  /** Boss is down: every eligible participant gets their own crate, tier by impact. */
  private grantLoot() {
    const sim = this.sim!;
    const kill = sim.bossKill!;
    this.lootRolled = true;
    const scores = impactScores(
      kill.players.map((k) => ({ id: k.id, level: k.level, ...k.stats })),
      this.state.tier,
    );
    const rng = () => randomInt(0, 2 ** 32) / 2 ** 32;
    const msg: LootMsg = { x: kill.x, y: kill.y, drops: [] };
    const tasks: (() => Promise<void>)[] = [];
    for (const k of kill.players) {
      const seat = this.seats.get(k.id);
      if (!seat || seat.departed || !k.eligible) continue;
      const score = scores.get(k.id)!;
      const tier = rollBoxTier(score.p, rng);
      const contents = rollBoxContents(tier, rng, () => randomUUID());
      seat.box = { tier, impact: score.relative, performance: score.p };
      msg.drops.push({ id: k.id, name: sim.players.get(k.id)?.name ?? "", tier });
      const grant = { runId: this.state.runId, profileId: seat.profileId, tier, impact: score.relative, performance: score.p, salvage: contents.salvage, items: contents.items };
      tasks.push(async () => {
        for (let i = 0; ; i++) {
          try {
            await this.svc.profiles.grantBox(grant);
            return;
          } catch (e: any) {
            if (i >= 5) throw e;
            await new Promise((r) => setTimeout(r, 200 * 2 ** i));
          }
        }
      });
    }
    this.broadcast("loot", msg);
    this.rewardChain = this.rewardChain.then(() => Promise.all(tasks.map((t) => t()))).catch((e) => this.svc.log?.(`loot error ${e.message}`));
  }

  private async awardWithRetry(award: Parameters<ProfileService["awardSection"]>[0]) {
    let delay = 200;
    for (let i = 0; ; i++) {
      try {
        return await this.svc.profiles.awardSection(award);
      } catch (e: any) {
        if (i >= 5) throw e;
        this.svc.log?.(`award retry ${i + 1}: ${e.message}`);
        await new Promise((r) => setTimeout(r, delay));
        delay *= 2;
      }
    }
  }

  private finish(success: boolean) {
    this.state.phase = "results";
    const sim = this.sim!;
    for (const seat of this.seats.values()) ActiveRuns.release(seat.profileId, this.roomId);
    this.rewardChain.then(async () => {
      const players: PlayerResult[] = [];
      const t = tierSpec(this.state.tier);
      for (const seat of this.seats.values()) {
        const sp = sim.players.get(seat.sessionId);
        if (!sp) continue;
        const profile = await this.svc.profiles.getProfile(seat.profileId);
        const rec = profile?.lineages[seat.lineage];
        const rewards = seat.rewards.sort((a, b) => a.sectionId - b.sectionId);
        players.push({
          id: seat.sessionId,
          name: sp.name,
          lineage: seat.lineage,
          levelAtStart: seat.levelAtStart,
          levelNow: rec?.level ?? seat.levelAtStart,
          xpNow: rec?.xp ?? 0,
          carryMult: carryMultiplier(t.recommendedLevel, seat.levelAtStart),
          sections: rewards,
          totalXp: rewards.reduce((a, r) => a + r.xp, 0),
          totalSalvage: rewards.reduce((a, r) => a + r.salvage, 0),
          totalFragments: rewards.reduce((a, r) => a + r.fragments, 0),
          supportMark: rewards.some((r) => r.supportMark),
          pendingUnlocks: unlocksBetween(seat.levelAtStart, rec?.level ?? seat.levelAtStart),
          revives: sp.stats.revives,
          damage: Math.round(sp.stats.damage),
          stagger: Math.round(sp.stats.stagger),
          controlSeconds: Math.round(sp.stats.controlSeconds),
          objectiveSeconds: Math.round(sp.stats.objectiveSeconds),
          departed: seat.departed,
          box: seat.box,
        });
      }
      this.results = { runId: this.state.runId, success, tier: this.state.tier, durationSec: Math.round((Date.now() - this.startedAt) / 1000), players };
      this.broadcast("results", this.results);
      await this.svc.profiles.recordRunEnd(this.state.runId, success ? "success" : "failed").catch(() => {});
    });
  }

  /** Waits until all queued reward transactions have finished (tests). */
  async settled() {
    await this.rewardChain;
  }

  private syncState() {
    const sim = this.sim!;
    const st = this.state;
    st.stage = sim.stage;
    st.section = sim.section;
    st.maxX = sim.maxX;
    st.objective = sim.objective;
    st.bossId = sim.bossId && sim.enemies.has(sim.bossId) ? sim.bossId : "";
    st.queued = sim.queuedSpawns();
    st.time = sim.time;
    for (const sp of sim.players.values()) {
      const p = st.players.get(sp.id);
      if (!p) continue;
      p.x = sp.x;
      p.y = sp.y;
      p.fx = sp.fx;
      p.fy = sp.fy;
      p.hp = Math.round(sp.hp);
      p.maxHp = sp.maxHp;
      p.shield = Math.round(sp.shield);
      p.life = sp.life;
      p.downT = sp.downT;
      p.revive = sp.reviveProgress;
      p.od = sp.od;
      p.odT = sp.odT;
      p.cdDodge = sp.cds.dodge;
      p.cdS1 = sp.cds.skill1;
      p.cdS2 = sp.cds.skill2;
      p.act = sp.dash ? "dash" : sp.brace ? "brace" : sp.pending ? "windup" : "";
      p.combo = sp.comboStep;
      p.ack = sp.lastSeq;
      p.empower = sp.empowerT;
    }
    syncMap(st.enemies, sim.enemies, EnemyS, (s, e) => {
      s.id = e.id;
      s.kind = e.kind;
      s.x = e.x;
      s.y = e.y;
      s.fx = e.fx;
      s.fy = e.fy;
      s.hp = e.hp;
      s.maxHp = e.maxHp;
      s.state = e.state;
      s.atk = e.attack?.kind ?? "";
      s.ang = e.attack?.ang ?? Math.atan2(e.fy, e.fx);
      s.t = e.t;
      s.heat = e.status.heat.stacks;
      s.chill = e.status.chill.stacks;
      s.broken = e.status.armorBreak.value > 0;
      s.phase = e.phase;
      s.stagger = e.kind === "boss" ? Math.min(1, e.stagger / e.staggerThreshold) : 0;
    });
    syncMap(st.hazards, sim.hazards, HazardS, (s, h) => {
      s.id = h.id;
      s.kind = h.kind;
      s.side = h.side;
      s.x = h.x;
      s.y = h.y;
      s.r = h.r;
      s.delay = h.delay;
      s.life = h.life;
    });
    syncMap(st.pickups, sim.pickups, PickupS, (s, k) => {
      s.id = k.id;
      s.x = k.x;
      s.y = k.y;
    });
  }
}

function syncMap<S, T>(target: Map<string, S> & { delete(k: string): boolean }, source: Map<string, T>, Ctor: new () => S, copy: (s: S, t: T) => void) {
  for (const k of [...target.keys()]) if (!source.has(k)) target.delete(k);
  for (const [k, v] of source) {
    let s = target.get(k);
    if (!s) {
      s = new Ctor();
      copy(s, v);
      target.set(k, s);
    } else copy(s, v);
  }
}
