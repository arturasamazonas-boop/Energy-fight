# Design and technical notes

All tunable numbers live in `shared/src/config.ts` and are checked by `validateConfig()` (in tests, in `npm run check` and at server boot). They are **starting values for playtesting, not a balance claim.**

## World, camera and the 2.5D projection

- **Ground coordinates** `(x, y)`: x runs along the station (0–4300), y is depth (0 = back wall, 600 = nearest the camera). Collision, attack ranges, AI and all server logic use ground coordinates only.
- **Projection** (`shared/src/map.ts`):
  `screenX = x`, `screenY = y × 0.62 − z`
  **Inverse** (on the ground plane, z = 0): `x = screenX`, `y = screenY / 0.62`.
  `z` is visual elevation (effects, numbers, the lift of a projectile) and never affects collision.
- Depth sorting uses the feet: sprite depth = projected `screenY` of the ground position. Shadows sit at the feet. Front railings are drawn above everything as partially transparent occluders.
- The camera never rotates. It follows the local player inside the map bounds, zoomed so the full arena depth (~400 projected px) fits the screen height. Teammates outside the view get coloured edge arrows.
- The map is a chain of walkable rectangles (corridor → arena A → passage → arena B → passage → boss hall). Gates (`maxX`) open as sections clear. Enemies route through doorways with `navTarget`.

## Networking

- One authoritative Colyseus room per mission. The simulation (`shared/src/sim.ts`, no Phaser) runs at **20 Hz**. State patches go out every **50 ms**. Presentation-only events (swings, hits, telegraph starts, banners) are batched per tick into an `fx` message.
- Clients send bounded **input** messages `{seq, mx, my, atk}` and **action** intents `{seq, a, dx, dy}`. Both are validated (types, ranges, integer sequence, allowed action names) and rate-limited (40 inputs/s and 12 actions/s per client, using a token bucket). Stale or replayed sequence numbers are ignored. Clients never send positions, damage, XP or rewards. Unknown message types are answered with `rejected`, and nothing changes.
- **Prediction:** the client moves its own character immediately with the shared `stepMovement` rules (and predicts dodges). Each input records the predicted position. When the server acknowledges `ack = seq`, the error against the recorded position is blended out over a few frames, and it snaps if the error is above 220 units. Remote players and enemies are smoothed toward the latest server position. There is no rollback combat engine: swing visuals and sounds play locally at once, while hits, damage and deaths come from the server.
- **Reconnection:** a dropped connection keeps its seat for **90 s** (`allowReconnection`). The SDK reconnects automatically after short network loss. After a page reload, the client reuses the stored reconnection token, which it refreshes while connected and expires locally after 85 s. Held inputs are cleared on disconnect and on return. A disconnected body stays in the world and can be hit or revived. If the room is gone, the client clears the token and returns to the lab with a message.
- **Active-run locks** (in memory): a profile can hold one seat in one room. It is released on leave, on run completion or failure, on reconnection expiry and on room disposal, and it is empty after a server restart. Lab mutations are refused while the profile is in a running mission.
- The room locks at start: no late joins (reconnects still work). The 9th client is rejected by `maxClients = 8`. Leadership passes to the next connected player when the leader leaves.

## Combat model (data-driven)

Every attack is an `AttackSpec`: a shape (arc, circle or line), damage, stagger, flinch, knockback, plus optional primitives: apply or consume status, zone, self-shield, pull, dash, aftershock, brace, first-target bonus and area follow-up. Lineages, evolutions, level-15 modifiers and modules are **patches** applied to these specs (`buildLoadout`). Evolutions modify existing skills instead of creating new classes.

Safety rules: the status caps are heat 3, chill 5 and a single strongest armour-break value. Consuming removes stacks. Spread detonations and fragments mark their targets, so nothing chains. Armour break does not stack between players. Boss slow is capped at 20% and the boss ignores pulls and knockback. A stagger meter with a growing threshold prevents stun-locking. Overdrive gain is limited to 6 charge per second per player and comes from hits, defensive actions, revives and objective time, not from final blows.

Enemy pressure: at most two melee enemies commit to attacking the same player at once (attack tokens). Telegraphs are drawn from enemy `windup` states and from delayed hazards. Ranged shots are visible projectiles. The support enemy channels a summon that can be interrupted by damage or stagger. Bio-cell pickups heal everyone nearby.

## Mission flow

1. **Section 1:** the corridor guards, then five waves in arena A.
2. **Section 2:** stand on the stabilizer for 1.5 s, then defend it. Progress builds while someone is in the zone (0.5%/s) and +2.5% per kill, so a strong team finishes faster. Spawns pause while 7 or more enemies are alive or queued. A support enemy arrives at 30% and an armoured one at 60%. Remaining enemies must then be cleared.
3. **Section 3:** the boss (two phases): sweep, aimed ground strikes (one per player, the rest landing elsewhere in the arena), reinforcements at 75% and 30% HP. Phase 2 adds faster combos and biomass pools. Boss death collapses the remaining biomass. Then everyone extracts by standing on the pad for 3 s.

Scaling uses the tier and the number of participants locked at start (regular HP ×(1 + 0.45(N−1)), boss HP ×(1 + 0.6(N−1)), damage ×(1 + 0.04(N−1))). It never uses the highest level. Disconnects do not rescale anything. The enemy cap is 24, with queued, staggered spawns.

Downed, revive and checkpoint: at 0 HP a player is downed for 20 s. A living teammate within 70 units revives them in 2.5 s (40% HP). If nobody does, the player waits and returns at the next section checkpoint, where everyone is also healed. A full wipe (no living participant) ends the attempt, including in solo play. Earned levels and materials are never removed.

## Progression and rewards

- XP to advance from level L: `80 + 30(L−1)`. Overflow carries across levels. The cap is 20, and XP beyond the cap is discarded and shown as mastery.
- Damage scale `1 + 0.08(L−1)`, HP scale `1 + 0.10(L−1)`. Skill 2 unlocks at 3, overdrive at 5, evolution at 10 (free, permanent, confirmed in the lab), modifier at 15 (changeable), mastery accent at 20.
- Full-clear XP = `round(baseXP × clamp(1 + 0.10(recommended − levelAtRunStart), 0.25, 1.5))`. Base XP is 180/300/450 for tiers recommended at levels 3/10/17. Sections pay 25% / 25% / remainder (floor for the first two).
- Section rewards go through `ProfileService.awardSection`. One transaction locks the lineage row, computes the reward on the server and inserts a ledger row keyed by `(run_id, section_id, profile_id)` with `ON CONFLICT DO NOTHING`, then updates level, XP, fragments, salvage, support marks and tier unlock. A repeated call returns the stored row and changes nothing. Mutations of one profile are also serialized in-process.
- The combat snapshot (level, skills, evolution, module) is fixed at run start. New levels apply from the next mission, and the results screen lists pending unlocks.
- Materials: deterministic salvage and fragments per eligible section, plus one possible +5 salvage bonus decided by a stable hash of (run, section, profile), so a retry can never re-roll it. A module upgrade costs 15/35/60 salvage (max rank 3). A first tier-1 full clear (≥ 30 salvage) affords the first upgrade.
- **Support mark:** on the final section, a player who was eligible in all three sections earns one mark if a teammate at least 5 run-start levels lower was also eligible in all three. Marks give no combat power.

## Participation (basic AFK safeguard, not anti-bot)

Each section is split into 3-second windows. Useful activity means:

- attacks or skills while an enemy is near
- a dodge or brace near enemies
- reviving a teammate
- objective work (activation, defence zone, extraction)
- moving at least 30 units near enemies, or near a teammate while the section has active combat

A window counts as able-to-act if the body was alive for at least half of it. A disconnected but seated player is still able to act and gets no credit, so disconnecting never improves the ratio. Downed windows are excluded **only after** the player was useful in that section. The rule is `eligible ⇔ active ≥ 1 ∧ 2·active ≥ able windows`. Kills and damage are never required, so a novice whose targets were taken by a veteran still qualifies. Standing still in a cleared area, or attacking with no enemy near, earns nothing. The same eligibility applies to XP and to every material.

## Decisions taken for unanswered details

- Postgres/Neon instead of SQLite (owner decision; free hosting has no persistent disk).
- Lobby, lab and results are DOM UI. Only combat is drawn by Phaser, and touch controls are DOM pointer handlers (reliable multi-touch and safe areas).
- The illustrated art uses one right-facing painted pose per form and mirrors it. Runtime motion supplies breathing, bob, lean, lunge, hit feedback and elemental effects. Source images are normalized around their visible feet before GPU upload; this does not alter collision geometry or source PNG files. See `ART_GUIDE.md` for the 23-image inventory and scaling contract.
- Checkpoint behaviour: clearing a section heals the living players and revives downed or waiting ones at the next section's entrance.
- Room codes are 5 characters from an alphabet without O, 0, I or 1.

## Boss crates and equipment

- When the boss dies, the server snapshots every non-departed participant. A crate goes to each one who is still eligible in section 3 (the participation rule so far). Departed and AFK players get nothing.
- **Impact** (`shared/src/loot.ts → impactScores`):
  - Damage and stagger are divided by the player's level damage scale.
  - Each contribution (damage 45%, stagger 15%, control 15%, objective 15%, revives 10%) is taken as a share of the party total. `relative = 1` is an average share, and solo play is always 1.
  - `p = clamp(0.25 + 0.45·relative − 0.08·downs + 0.05·(tier−1), 0, 1)`.
- **Crate tier:** the rare tiers are rolled first with chance × (0.5 + p): ULTRA 1/10 000, divine 1/1 000, platinum 1/100. Otherwise gold `0.05+0.35p`, silver `0.25+0.25p`, the rest bronze. The rolls use `crypto.randomInt` on the server.
- **Contents:** items and salvage per tier (`BOX_CONTENTS`). An ULTRA crate always contains one unique ULTRA item.
- **Items:**
  - 6 slots, 6 base items per slot, 6 rarities.
  - Every slot has a primary stat.
  - Rarity sets the number of stats and their power.
  - Epic and higher can carry one of 8 specials (`SPECIAL_VALUES`).
  - Stat sums across the six slots are capped (`LOOT.statCap`).
  - Equipment is per lineage, and one item can be worn by only one lineage at a time.
  - It is snapshotted at run start like the rest of the loadout.
- **Persistence:**
  - `loot_boxes (run_id, profile_id)` is inserted once with `ON CONFLICT DO NOTHING`, together with the `items` rows and the crate salvage, in one transaction.
  - `lineage_progress.equipment` maps slot to item id.
  - Over 150 items, the weakest unequipped ones are salvaged automatically.
- **API:** `GET /api/inventory`, `POST /api/boxes/open`, `POST /api/items/equip`, `POST /api/items/dismantle`. `POST /api/dev/box` exists only with dev tools enabled.
