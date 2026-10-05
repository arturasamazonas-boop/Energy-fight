import fs from "node:fs";
import path from "node:path";
import express from "express";
import { Server, matchMaker } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { randomUUID } from "node:crypto";
import { ROOM_NAME, isLineage, rollBoxContents, validateConfig } from "@ef/shared";
import { openDb, type Db } from "./db.ts";
import { GameRoom } from "./GameRoom.ts";
import { ActiveRuns } from "./locks.ts";
import { LabError, ProfileService } from "./profiles.ts";

export interface AppOptions {
  port: number;
  host?: string;
  databaseUrl?: string;
  dataDir?: string;
  clientDist?: string;
  devTools?: boolean;
  quiet?: boolean;
  allowTestSpeed?: boolean;
}

export interface RunningApp {
  port: number;
  db: Db;
  profiles: ProfileService;
  gameServer: Server;
  close(): Promise<void>;
}

export async function startApp(opts: AppOptions): Promise<RunningApp> {
  const configErrors = validateConfig();
  if (configErrors.length) throw new Error("Invalid game config:\n" + configErrors.join("\n"));
  const log = (m: string) => {
    if (!opts.quiet) console.log(`[server] ${m}`);
  };
  const db = await openDb({ url: opts.databaseUrl, dataDir: opts.dataDir });
  log(`database: ${db.kind}${db.kind === "pglite" ? ` (${opts.dataDir ?? "in-memory"})` : ""}`);
  const profiles = new ProfileService(db);
  GameRoom.services = { profiles, log, allowTestSpeed: !!opts.allowTestSpeed };
  ActiveRuns.clear();

  const transport = new WebSocketTransport({ pingInterval: 3000, pingMaxRetries: 3 } as any);
  const app = transport.getExpressApp();
  app.disable("x-powered-by");
  app.use("/api", express.json({ limit: "8kb" }));

  // ---- guest creation rate limit (per IP, in memory) ----
  const guestHits = new Map<string, number[]>();
  const allowGuest = (ip: string) => {
    const now = Date.now();
    const list = (guestHits.get(ip) ?? []).filter((t) => now - t < 3600_000);
    if (list.length >= 30) return false;
    list.push(now);
    guestHits.set(ip, list);
    return true;
  };

  const auth = async (req: express.Request): Promise<string | null> => {
    const h = req.headers.authorization ?? "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : "";
    return profiles.authenticate(token);
  };
  const handle =
    (fn: (req: express.Request, res: express.Response, profileId: string) => Promise<unknown>, needsAuth = true) =>
    async (req: express.Request, res: express.Response) => {
      try {
        let profileId = "";
        if (needsAuth) {
          const id = await auth(req);
          if (!id) return void res.status(401).json({ error: "invalid_credential" });
          profileId = id;
        }
        const out = await fn(req, res, profileId);
        if (!res.headersSent) res.json(out);
      } catch (e: any) {
        if (e instanceof LabError) return void res.status(400).json({ error: e.code });
        log(`api error ${req.path}: ${e?.message}`);
        res.status(500).json({ error: "server_error" });
      }
    };
  const labGuard = (profileId: string) => {
    if (ActiveRuns.isRunning(profileId)) throw new LabError("in_run");
  };
  const lineageOf = (v: unknown) => {
    if (!isLineage(v)) throw new LabError("invalid_lineage");
    return v;
  };

  app.get("/api/health", (_req, res) => void res.json({ ok: true, db: db.kind }));
  app.get("/api/config", (_req, res) => void res.json({ devTools: !!opts.devTools }));
  app.post(
    "/api/guest",
    handle(async (req, res) => {
      if (!allowGuest(req.ip ?? "?")) return void res.status(429).json({ error: "rate_limited" });
      return profiles.createGuest(req.body?.name);
    }, false),
  );
  app.get("/api/profile", handle(async (_req, _res, id) => ({ profile: await profiles.getProfile(id), inRun: ActiveRuns.isRunning(id) })));
  app.post(
    "/api/profile/name",
    handle(async (req, _res, id) => {
      await profiles.rename(id, req.body?.name);
      return { profile: await profiles.getProfile(id) };
    }),
  );
  app.post(
    "/api/lab/lineage",
    handle(async (req, _res, id) => {
      labGuard(id);
      await profiles.setLastLineage(id, lineageOf(req.body?.lineage));
      return { profile: await profiles.getProfile(id) };
    }),
  );
  app.post(
    "/api/lab/evolve",
    handle(async (req, _res, id) => {
      labGuard(id);
      return { profile: await profiles.chooseEvolution(id, lineageOf(req.body?.lineage), String(req.body?.evolution ?? "")) };
    }),
  );
  app.post(
    "/api/lab/modifier",
    handle(async (req, _res, id) => {
      labGuard(id);
      return { profile: await profiles.chooseModifier(id, lineageOf(req.body?.lineage), String(req.body?.modifier ?? "")) };
    }),
  );
  app.post(
    "/api/lab/module/upgrade",
    handle(async (req, _res, id) => {
      labGuard(id);
      return { profile: await profiles.upgradeModule(id, lineageOf(req.body?.lineage), String(req.body?.module ?? "")) };
    }),
  );
  app.post(
    "/api/lab/module/equip",
    handle(async (req, _res, id) => {
      labGuard(id);
      const m = req.body?.module;
      return { profile: await profiles.equipModule(id, lineageOf(req.body?.lineage), m === null ? null : String(m ?? "")) };
    }),
  );
  app.get(
    "/api/inventory",
    handle(async (_req, _res, id) => ({ items: await profiles.inventory(id), boxes: await profiles.listBoxes(id) })),
  );
  app.post(
    "/api/boxes/open",
    handle(async (req, _res, id) => ({ box: await profiles.openBox(id, String(req.body?.runId ?? "")) })),
  );
  app.post(
    "/api/items/equip",
    handle(async (req, _res, id) => {
      labGuard(id);
      const item = req.body?.itemId;
      return { profile: await profiles.equipItem(id, lineageOf(req.body?.lineage), String(req.body?.slot ?? ""), item === null ? null : String(item ?? "")) };
    }),
  );
  app.post(
    "/api/items/dismantle",
    handle(async (req, _res, id) => {
      labGuard(id);
      return profiles.dismantleItem(id, String(req.body?.itemId ?? ""));
    }),
  );
  if (opts.devTools) {
    // Development only: grants a crate of a chosen tier to a profile so the reveal and arsenal can be inspected.
    app.post(
      "/api/dev/box",
      handle(async (req, _res, id) => {
        const tiers = ["bronze", "silver", "gold", "platinum", "divine", "ultra"];
        const tier = tiers.includes(req.body?.tier) ? req.body.tier : "gold";
        const contents = rollBoxContents(tier, Math.random, () => randomUUID());
        return { box: await profiles.grantBox({ runId: `dev-${randomUUID()}`, profileId: id, tier, impact: 1, performance: 0.5, salvage: contents.salvage, items: contents.items }) };
      }),
    );
    // Development only: creates a NEW separate test profile at a chosen level.
    // It never edits an existing profile and is disabled unless DEV_TOOLS=1 outside production.
    app.post(
      "/api/dev/seed",
      handle(async (req) => {
        const level = Math.max(1, Math.min(20, Number(req.body?.level) || 1));
        const tier = level >= 17 ? 3 : level >= 10 ? 2 : 1;
        return profiles.createGuest(req.body?.name ?? `Test L${level}`, { level, tierUnlocked: tier, salvage: 60 });
      }, false),
    );
  }

  if (opts.clientDist && fs.existsSync(opts.clientDist)) {
    app.use(express.static(opts.clientDist, { index: "index.html", maxAge: "1h", setHeaders: (res, p) => {
      if (p.endsWith("index.html")) res.setHeader("Cache-Control", "no-cache");
    } }));
    app.get(/^\/(?!api|matchmake).*/, (_req, res) => res.sendFile(path.join(opts.clientDist!, "index.html")));
    log(`serving client from ${opts.clientDist}`);
  }

  const gameServer = new Server({ transport, greet: false, gracefullyShutdown: false } as any);
  gameServer.define(ROOM_NAME, GameRoom);
  await gameServer.listen(opts.port, opts.host);
  const address = (transport as any).server?.address?.();
  const port = typeof address === "object" && address ? address.port : opts.port;
  log(`listening on ${opts.host ?? "0.0.0.0"}:${port}`);

  return {
    port,
    db,
    profiles,
    gameServer,
    async close() {
      try {
        await gameServer.gracefullyShutdown(false);
      } catch {}
      await db.close();
    },
  };
}

export { matchMaker };
