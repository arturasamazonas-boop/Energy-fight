# Energy Fight (Projektas RESONANCE)

A cooperative 2.5D action brawler prototype for **landscape mobile browsers** (Android Chrome, iPhone Safari). 1–8 friends fight through the mission *Breach at Station Nexus* together. Stronger characters can carry weaker friends, and the weaker friends level up faster.

**Illustrated graphics update:** 23 original PNG illustrations now supply the four juvenile lineages, eight evolutions, five enemies, station environments and interactive objects. The laboratory, lobby, battle HUD and results use the new artwork. Open [PIESINIU_GALERIJA.html](PIESINIU_GALERIJA.html) locally to inspect the paintings without starting the server. Lithuanian delivery and validation notes: [GRAFIKOS_PAKEITIMAI.md](GRAFIKOS_PAKEITIMAI.md).

> **Trumpai lietuviškai.** Atidaryk žaidimą telefone gulsčiai, įvesk vardą, laboratorijoje pasirink liniją (PYRA, KRIOS, VEKTOR arba LITOS) ir paspausk „Kurti kambarį“. 5 raidžių kodą duok draugams, kad prisijungtų. Kai visi pasiruošę, lyderis paspaudžia „Pradėti misiją“. Kairė ekrano pusė yra judėjimo vairalazdė, dešinėje yra smūgio mygtukas (laikyk jį), išsisukimas, 1 ir 2 įgūdžiai ir perkrova. Progresas saugomas serveryje (Postgres arba Neon).

Assumptions for this first prototype: it runs in a landscape mobile browser, with touch controls first. Desktop keyboard is a fallback. Native APK/IPA builds are not part of this prototype.

## Stack (versions pinned in `package-lock.json`)

| Part | Choice |
| --- | --- |
| Runtime | Node.js 22 LTS (22.22.0, see `.nvmrc`; requires ≥ 22.12) |
| Client | TypeScript, Vite 8.3.2, **Phaser 4.2.1** (Phaser 4 APIs only) |
| Server | **Colyseus 0.18.9** (`@colyseus/schema` 5.0.36, `@colyseus/sdk` 0.18.5 on the client), authoritative 20 Hz simulation |
| Data | PostgreSQL via `pg` 8.23.1 (Neon in production). Locally, embedded **PGlite 0.5.8** (real Postgres in WASM) stored in `.data/` |
| Tests | `node:test` + tsx, Playwright 1.56 for browser emulation |

The brief asked for SQLite. The owner chose **Postgres/Neon** instead, because free hosting (Render free) has no persistent disk and an SQLite file would be wiped on every deploy or sleep. Local development still needs no paid service: without `DATABASE_URL` the server uses PGlite in a local folder.

Workspaces:

```
shared/   game rules: config, progression, participation, map, movement, the simulation (no Phaser)
server/   Colyseus room, HTTP API, Postgres/PGlite persistence, reward ledger
client/   Phaser renderer, DOM UI (lab, lobby, results), touch controls, illustrated art
tests/    unit, database, network, eight-client simulation, restart, browser e2e
```

## Run locally

```bash
nvm use            # Node 22
npm install
node -e "require('fs').mkdirSync('.data', { recursive: true })"
npm run dev        # server on :2567 (dev tools on) + Vite client on :5173
```

Open http://localhost:5173. Test it on **a phone on the same Wi-Fi**:

1. Find the computer's LAN address (`ipconfig` / `ip addr`, e.g. `192.168.1.23`).
2. On the phone, open `http://192.168.1.23:5173`. Do **not** use `localhost` on the phone, because there it means the phone itself.
3. Both dev servers bind to `0.0.0.0`. In development the client talks to the game server at `<same host>:2567`, so allow ports 5173 and 2567 through the computer's firewall.

Development-only test profiles: the lab has a "Testavimo profiliai" panel that creates **new separate** profiles at levels 1, 9 and 18. This lets you inspect carry XP, evolution and modifiers. It appears only when the server runs with `DEV_TOOLS=1` and `NODE_ENV` is not `production`. It never edits an existing profile.

### Production build

```bash
npm ci --include=dev
npm run build                        # builds client/dist
NODE_ENV=production DATABASE_URL=postgres://... npm start
```

One process serves the client, the HTTP API and the WebSocket game server on `PORT` (default 2567).

**Remote friends** need the game hosted on an HTTPS URL, so the browser uses WSS. Running on your own machine is not an internet deployment. See [DEPLOY.md](DEPLOY.md) (Render free + Neon, or an Oracle Cloud Always Free VM).

## Controls

- **Touch:** the left 45% of the screen is a floating movement stick. On the right are a large attack button (hold it for the 3-hit combo; releasing stops it), dodge, skill 1 and skill 2. Overdrive sits above them and stays dim until charged. Movement and buttons use independent pointers. All held input is released on pointer cancel, focus loss and reconnect.
- **Keyboard:** WASD/arrows to move, Space/J attack (hold), Shift/K dodge, Q/U skill 1, E/I skill 2, R/O overdrive.
- **Settings:** volume, reduced motion (no camera shake) and reduced effects (lower device-pixel-ratio cap, fewer particles).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | server (watch) + Vite client |
| `npm run build` | production client build |
| `npm start` | production server (serves `client/dist`) |
| `npm run check` | TypeScript typecheck of all packages + game-config validation |
| `npm test` | all automated tests (~2 min; includes an 8-client mission) |
| `npm run test:e2e` | Playwright mobile-emulation test against a running server (`E2E_BASE=http://localhost:2567`) |
| `npm run assets:validate` | validates replacement art listed in `ASSET_MANIFEST.json` |

Set `TEST_DATABASE_URL` to run the database tests against a real PostgreSQL server instead of PGlite.

## Guest accounts

The server issues a cryptographically random guest credential (only its SHA-256 is stored). The browser keeps it in `localStorage`, along with preferences and the short-lived Colyseus reconnection token. **Recovery is tied to that browser's storage.** Cross-device login and account recovery are outside this prototype. Authoritative progression lives only on the server.

## Further documents

- [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md): what is implemented, what was verified and how, known limits, next actions
- [DESIGN_NOTES.md](DESIGN_NOTES.md): projection, networking, reward and participation rules, decisions made
- [DEPLOY.md](DEPLOY.md): hosting on Render + Neon (free) and moving to Oracle Cloud Always Free
- [ART_GUIDE.md](ART_GUIDE.md) and [ASSET_MANIFEST.json](ASSET_MANIFEST.json): the art contract and ChatGPT image prompts
