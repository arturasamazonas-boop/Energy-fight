import path from "node:path";
import { fileURLToPath } from "node:url";
import { startApp } from "./app.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const production = process.env.NODE_ENV === "production";

const app = await startApp({
  port: Number(process.env.PORT ?? 2567),
  host: process.env.HOST ?? "0.0.0.0",
  databaseUrl: process.env.DATABASE_URL || undefined,
  dataDir: process.env.DATA_DIR ?? path.resolve(here, "../../.data/pglite"),
  clientDist: process.env.CLIENT_DIST ?? path.resolve(here, "../../client/dist"),
  devTools: process.env.DEV_TOOLS === "1" && !production,
});

if (production && !process.env.DATABASE_URL) {
  console.warn("[server] WARNING: NODE_ENV=production without DATABASE_URL. Progress is stored in DATA_DIR, which must be persistent storage.");
}

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
