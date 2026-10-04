# Implementation status

Last updated: 2026-10-04. Version: 0.1.0 (prototype).

## Milestones

| Milestone | State |
| --- | --- |
| A: networking loop (room, two clients, shared enemy) | Done and verified |
| B: playable mission (4 lineages, controls, 4 enemy roles, 3 sections, boss, downed/revive/checkpoint, results) | Done; balance not tuned with humans |
| C: growth (guest profiles, per-lineage progress, unlocks, evolution, modifiers, modules, tiers, carry XP, reward ledger) | Done and verified |
| D: 8 connections, reconnect/reload, phone layout, settings, asset workflow, acceptance checks | Done in automation and emulation. **No physical-device test yet.** |

## Implemented

- Shared, renderer-free simulation (`shared/src/sim.ts`):
  - four lineages built from reusable attack and status primitives, with 8 evolutions, 8 modifiers and 3 modules
  - overdrive with capped charge
  - four regular enemy roles and a two-phase boss with stagger
  - telegraphs, pickups, revive, checkpoints and wipe handling
  - the three-section mission director with spawn queueing under the 24-enemy cap
  - the participation tracker
- Authoritative Colyseus room:
  - lobby with room code, ready state, tier choice and leader transfer
  - run-start loadout snapshot
  - validated, rate-limited inputs and rejection of forged messages
  - 90 s seat reservation and reconnection
  - active-run locks
  - idempotent per-section reward transactions
  - support marks and results
- Persistence: PostgreSQL (Neon in production) or embedded PGlite locally, with migrations, a reward ledger and runs. Guest credentials are random and stored hashed.
- Client:
  - Phaser 4 renderer with procedural characters, enemies and environment, the oblique projection with foot depth sorting and shadows, telegraphs and hit feedback
  - teammate direction markers, local movement prediction with reconciliation, and smoothing for remote entities
  - DOM HUD, multi-touch controls with safe areas, the rotate overlay and the keyboard fallback
  - lab (evolution before/after silhouettes with confirmation, modifiers, modules), lobby and results that highlight carry XP, pending unlocks and support
  - settings (volume, reduced motion, reduced effects) and synthesized sounds that start after a gesture
- Asset replacement through `ASSET_MANIFEST.json` and `npm run assets:validate`; `ART_GUIDE.md` with ChatGPT prompts.
- Deployment: `render.yaml` (Render free + Neon), `Dockerfile` with Caddy notes for Oracle Always Free.

## Verification performed (commands actually run)

| Check | How | Result |
| --- | --- | --- |
| Typecheck + config validation | `npm run check` | pass |
| Production build | `npm run build` | pass (bundle 1.6 MB, 437 kB gzip; Phaser accounts for most of it) |
| All automated tests | `npm test` | **49 tests pass** (~2 min) |
| XP formula, overflow, cap, carry examples 450/300/75, section split = total | `tests/progression.test.ts` | pass |
| All four lineages move, attack, dodge, use skill 1/2; skill 2 locked below level 3 | `tests/sim.test.ts` | pass |
| Each lineage clears section 1 solo at level 5 (scripted bot) | `tests/sim.test.ts` | pass |
| Each evolution changes a real mechanic (spread, shield, fragments, bigger shield, follow-up, aftershock, shell) | `tests/sim.test.ts` | pass |
| Low-damage timid novice earns credit while the veteran does most damage; AFK earns nothing; downed-after-participating keeps credit; zero windows never qualify; disconnect does not help | `tests/sim.test.ts` | pass |
| Reward idempotency (concurrent and repeated), support mark once, module salvage debit, evolution permanent and per-lineage, ineligible = zero | `tests/db.test.ts` (PGlite, and also run with `TEST_DATABASE_URL` against **PostgreSQL 16**) | pass |
| Two clients by code converge to the authoritative enemy HP and stage | `tests/network.test.ts` | pass |
| 8 clients join; 9th rejected; late join rejected; one profile cannot hold two seats or rooms; forged `xp`/`damage`/bad inputs rejected; lineage switch during run rejected | `tests/network.test.ts` | pass |
| Abrupt disconnect + reconnect with token: same session, no duplicate, held input cleared | `tests/network.test.ts` | pass |
| **Simulated-client test (not a human playtest):** 8 independent connections and profiles (levels 1–18, one AFK, one timid novice) complete tier 1 through the real server at 3× simulation speed; a client is dropped and reconnected late in the boss fight; every client's results equal the server ledger and database per profile; carry and support-mark rules hold; re-processing all awards changes nothing | `tests/eight-client.test.ts` | pass (~70 s wall time) |
| Restart: profile and lab changes survive stopping and starting the server process; dev seeding is off by default | `tests/restart.test.ts` | pass |
| Asset validator accepts aligned sprites and rejects bad padding or anchor | `tests/assets.test.ts` | pass |
| Browser e2e (Chromium **mobile emulation** 844×390, touch): two isolated contexts join by code; multi-touch stick + held attack; no stuck input after touch cancel; reload during combat restores the same seat; controls 60/60/92 CSS px; portrait shows the rotate overlay; no page errors | `npm run test:e2e` against a production server using PostgreSQL 16 | pass |
| Full visual playthrough: one browser player + 3 network bots through all sections to results | manual Playwright script, screenshots reviewed | mission completed in 3:05 with an over-levelled party at tier 1 |
| Latency: ~130 ms RTT through a TCP delay proxy (measured ping 148 ms) | Playwright | playable; the authoritative position starts moving ~250 ms after the key press while local prediction moves at once (vs ~100 ms without the proxy) |
| Server simulation cost | `npx tsx scripts/bench-sim.ts` | 0.06 ms per tick with 8 players and 24 enemies (budget 50 ms). Schema encoding and network I/O not included |

## Not verified / known limits

- **No physical Android or iPhone test.** Frame rate, touch feel, Safari safe areas and audio unlock on real devices are unmeasured. The headless runs used software WebGL, so they say nothing about device performance.
- **No real hosting yet.** Render + Neon deployment, free-tier CPU under 8 players and real internet latency are unmeasured.
- **Balance is untuned.** Bot runs suggest tier 1 takes roughly 4–6 minutes of sim time for appropriately levelled bots; humans will differ. The 10–15 minute target has **not** been confirmed. Solo bots at level 5 sometimes lose the boss (VEKTOR most often). Tier 2/3 solo at the recommended level is hard for bots.
- The procedural art is a single mirrored pose per lineage/evolution, with no directional or frame animation yet.
- Prediction covers movement and dodge only. Dash-cut and pulls are corrected by reconciliation, which can cause a visible snap at high latency.
- Active missions do not survive a server restart or Render spin-down (by design). Committed section rewards do.
- Guest recovery depends on browser storage; there is no cross-device login.

## Next concrete actions

1. Deploy to Render with a Neon `DATABASE_URL` (see DEPLOY.md), then play one real session on two phones and note FPS, feel and latency.
2. Human-playtest tier 1 with a strong and a weak player. Tune `ENEMY_SPECS`, the wave lists in `sim.ts` and `TIERS` for the 10–15 minute target.
3. Generate the PYRA base reference with ART_GUIDE prompt 2, then wire the first provided sprite.
4. Add directional and frame animation playback once real sprite sheets exist.
