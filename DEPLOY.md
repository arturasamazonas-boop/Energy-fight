# Deployment

The game is **one Node process**. It serves the built client, the HTTP API (`/api/*`) and the Colyseus WebSocket server on the same origin. Active missions live in that process's memory. Progression lives in PostgreSQL.

## Option A: Render (free) + Neon (free)

Facts checked in October 2026. Check them again before relying on them.

- [Render free web services](https://render.com/docs/free) spin down after 15 minutes with no inbound HTTP request **or WebSocket message**, and take about one minute to wake. The account has 750 free instance hours per month, shared by all free services in the workspace. There is **no persistent disk**, so the database must be external. Outbound bandwidth counts toward the account's monthly allowance.
- [Neon free plan](https://neon.com/faqs/free-plan-limits-and-quotas): 0.5 GB storage and 100 CU-hours per project per month. Compute scales to zero after 5 minutes idle, so the first query after idle is slower.

Steps:

1. **Neon:** create a new project (keep it separate from other games), copy the *pooled* connection string. It looks like `postgres://user:pass@ep-xxx-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require`. Pick an EU region near Frankfurt.
2. **Render:** New → Blueprint → select this repository. `render.yaml` creates the `energy-fight` web service in Frankfurt on the free plan:
   - build: `npm ci --include=dev && npm run build`
   - start: `npm start`
   - health check: `/api/health`
3. In the service's **Environment**, set `DATABASE_URL` to the Neon string. Never commit it. `NODE_ENV=production` is already in the blueprint. Dev tools stay off in production.
4. Deploy, then open `https://energy-fight.onrender.com` (or whatever name Render assigns). Render terminates HTTPS, so the client automatically uses WSS on the same origin.

Tables are created by migrations on startup (`schema_migrations`). Nothing destructive runs.

What to expect on free tiers:

- The first visit after ~15 idle minutes waits about a minute while the service wakes up.
- A redeploy or spin-down **ends any active mission**. Section rewards already committed are safe in Neon. Players are sent back to the lab with a message.
- CPU on the free instance is small. Two to four players should be fine. **Eight players with 24 enemies has not been measured on Render.** Watch the logs and the room's tick timing.

## Option B: Oracle Cloud Always Free VM (more CPU, no sleep)

Nothing in the code is Render-specific. The same process runs on any Linux VM.

1. Create an Always Free Ampere (ARM) or AMD VM with Ubuntu. Open ports 80 and 443 in the VCN security list and in the host firewall.
2. Install Docker, or Node 22.
3. Either keep using Neon (set `DATABASE_URL`) or omit it and mount a persistent volume for the embedded database:

```bash
docker build -t energy-fight .
docker run -d --restart unless-stopped -p 2567:2567 \
  -e DATABASE_URL="postgres://..." \
  -v ef-data:/data \
  --name energy-fight energy-fight
```

4. Put **Caddy** in front for automatic HTTPS/WSS:

```
# /etc/caddy/Caddyfile
game.example.com {
  reverse_proxy 127.0.0.1:2567
}
```

Point a domain (or a free DuckDNS subdomain) at the VM's public IP. Caddy obtains certificates automatically and proxies WebSocket upgrades.

Moving from Render to Oracle: keep the same Neon `DATABASE_URL` and the profiles carry over. Guest credentials stay in each player's browser, but they are tied to the **origin** (domain). If the domain changes, players start with new guest profiles unless you keep the old domain pointing to the new server.

## Environment variables

See `.env.example`.

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | Postgres connection string. Without it, PGlite is used in `DATA_DIR`. |
| `DATA_DIR` | Embedded database folder. Must be persistent storage if used on a host. |
| `PORT` / `HOST` | Listen address (default `2567` / `0.0.0.0`) |
| `NODE_ENV` | `production` disables dev tools |
| `DEV_TOOLS` | `1` enables the test-profile seeding endpoint outside production |
| `VITE_SERVER_URL` | Build-time option, only if the client is hosted on a different origin than the server |
