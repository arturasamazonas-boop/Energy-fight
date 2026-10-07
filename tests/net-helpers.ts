import { Client, type Room } from "@colyseus/sdk";
import { botDecide, type BotOptions } from "../shared/src/index.ts";
import { startApp, type RunningApp } from "../server/src/app.ts";

export async function startTestServer(): Promise<RunningApp & { base: string }> {
  const app = await startApp({ port: 0, host: "127.0.0.1", quiet: true, allowTestSpeed: true });
  return Object.assign(app, { base: `http://127.0.0.1:${app.port}` });
}

export async function guest(base: string, name: string) {
  const r = await fetch(base + "/api/guest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
  return (await r.json()) as { token: string; profile: any };
}

export async function seeded(app: RunningApp, name: string, level: number) {
  return app.profiles.createGuest(name, { level, tierUnlocked: 3 });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(fn: () => boolean, ms = 5000, label = "condition") {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${label}`);
    await sleep(20);
  }
}

/** A simulated network client: independent connection, profile and input stream. */
export class NetBot {
  room!: Room;
  client: Client;
  seq = 1;
  timer: NodeJS.Timeout | null = null;
  messages: Record<string, any[]> = {};
  constructor(readonly base: string, readonly token: string, readonly opts: BotOptions = {}) {
    this.client = new Client(base);
  }
  private wire(room: Room) {
    this.room = room;
    for (const type of ["fx", "results", "reward", "error", "rejected", "deny", "pong", "loot"]) {
      room.onMessage(type, (m: any) => {
        if (type === "fx") return;
        (this.messages[type] ??= []).push(m);
      });
    }
    return room;
  }
  async create(lineage: string, extra: Record<string, unknown> = {}) {
    return this.wire(await this.client.create("mission", { token: this.token, lineage, ...extra }));
  }
  async join(code: string, lineage: string) {
    return this.wire(await this.client.joinById(code, { token: this.token, lineage }));
  }
  async reconnectWith(token: string) {
    this.client = new Client(this.base);
    return this.wire(await this.client.reconnect(token));
  }
  get state(): any {
    return this.room.state;
  }
  get me(): any {
    return this.state.players.get(this.room.sessionId);
  }
  startDriving() {
    this.timer = setInterval(() => this.step(), 50);
  }
  stopDriving() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  private step() {
    const st = this.state;
    const me = this.me;
    if (!st || !me || st.phase !== "running") return;
    const view = {
      self: { x: me.x, y: me.y, life: me.life, hp: me.hp, maxHp: me.maxHp, od: me.od },
      enemies: [...st.enemies.values()].map((e: any) => ({ x: e.x, y: e.y, kind: e.kind, hp: e.hp, state: e.state })),
      allies: [...st.players.values()].filter((p: any) => p.id !== me.id).map((p: any) => ({ x: p.x, y: p.y, life: p.life })),
      stage: st.stage,
      maxX: st.maxX,
      hasSkill2: me.hasSkill2,
      hasOverdrive: me.hasOverdrive,
      hazards: [...st.hazards.values()].filter((h: any) => h.kind !== "shot").map((h: any) => ({ x: h.x, y: h.y, r: h.r, enemy: h.side === "enemy" })),
      pickups: [...st.pickups.values()].map((k: any) => ({ x: k.x, y: k.y })),
    };
    const d = botDecide(view, this.opts, st.time);
    try {
      this.room.send("input", { seq: this.seq++, mx: d.mx, my: d.my, atk: d.atk });
      if (d.action) this.room.send("action", { seq: this.seq++, a: d.action.a, dx: d.action.dx, dy: d.action.dy });
      else if (d.atk && this.seq % 4 === 0) this.room.send("action", { seq: this.seq++, a: "attack", dx: 0, dy: 0 });
    } catch {}
  }
  /** Simulates an abrupt network loss (not a consented leave). */
  dropConnection() {
    this.stopDriving();
    (this.room as any).reconnection.enabled = false;
    (this.room as any).connection.close(4010);
  }
}
