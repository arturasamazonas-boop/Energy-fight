// Real restart: the server runs as a child process, is stopped and started again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

async function boot(env: Record<string, string>): Promise<{ proc: ChildProcess; base: string }> {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const proc = spawn(process.execPath, ["--import", "tsx", "server/src/index.ts"], {
    cwd: root,
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", DEV_TOOLS: "", ...env },
    stdio: "ignore",
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(base + "/api/health")).ok) return { proc, base };
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill("SIGKILL");
  throw new Error("server did not start");
}

async function stop(proc: ChildProcess) {
  const done = new Promise((r) => proc.once("exit", r));
  proc.kill("SIGTERM");
  await Promise.race([done, new Promise((r) => setTimeout(r, 5000))]);
  if (proc.exitCode === null) proc.kill("SIGKILL");
}

test("guest profile and lab changes survive a server restart; dev seeding is off by default", { timeout: 60_000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-restart-"));
  try {
    let s = await boot({ DATA_DIR: dir });
    const post = (p: string, body: unknown, token?: string) =>
      fetch(s.base + p, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    const g = await (await post("/api/guest", { name: "Keep" })).json();
    await post("/api/lab/lineage", { lineage: "litos" }, g.token);
    const seed = await post("/api/dev/seed", { level: 18 });
    assert.notEqual(seed.status, 200, "dev seeding disabled without DEV_TOOLS=1");
    const before = await (await fetch(s.base + "/api/profile", { headers: { authorization: `Bearer ${g.token}` } })).json();
    await stop(s.proc);
    s = await boot({ DATA_DIR: dir });
    const res = await fetch(s.base + "/api/profile", { headers: { authorization: `Bearer ${g.token}` } });
    assert.equal(res.status, 200);
    const after = await res.json();
    assert.deepEqual(after.profile, before.profile);
    assert.equal(after.profile.lastLineage, "litos");
    assert.equal(after.inRun, false, "active-run locks start empty after restart");
    await stop(s.proc);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
