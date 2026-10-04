// Starts the game server (with file watching) and the Vite client together.
import { spawn } from "node:child_process";

const procs = [
  spawn("npx", ["tsx", "watch", "server/src/index.ts"], { stdio: "inherit", env: { DEV_TOOLS: "1", ...process.env } }),
  spawn("npx", ["vite", "--host", "0.0.0.0"], { stdio: "inherit", cwd: "client" }),
];
const stop = () => procs.forEach((p) => p.kill("SIGTERM"));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
procs.forEach((p) => p.on("exit", (code) => { if (code) stop(); }));
