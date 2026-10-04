import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PLAYER,
  TIERS,
  applyXp,
  buildLoadout,
  carryMultiplier,
  defaultLineageRecord,
  fullClearXp,
  sectionXp,
  validateConfig,
  xpToNext,
  LINEAGES,
  partyScaling,
} from "../shared/src/index.ts";

test("game config validates", () => {
  assert.deepEqual(validateConfig(), []);
});

test("xp requirement formula 80 + 30 × (L − 1)", () => {
  assert.equal(xpToNext(1), 80);
  assert.equal(xpToNext(5), 200);
  assert.equal(xpToNext(6), 230);
  assert.equal(xpToNext(19), 620);
});

test("brief example: level 5 with 0 XP + 450 XP → level 7 with 20 XP", () => {
  const r = applyXp({ level: 5, xp: 0 }, 450);
  assert.equal(r.level, 7);
  assert.equal(r.xp, 20);
  assert.equal(r.levelsGained, 2);
});

test("overflow across many levels and the level cap", () => {
  const r = applyXp({ level: 1, xp: 0 }, 80 + 110 + 140 + 5);
  assert.deepEqual([r.level, r.xp], [4, 5]);
  const capped = applyXp({ level: 19, xp: 600 }, 5000);
  assert.equal(capped.level, PLAYER.levelCap);
  assert.equal(capped.xp, 0);
  assert.equal(capped.xpApplied, 20);
  const atCap = applyXp({ level: 20, xp: 0 }, 300);
  assert.deepEqual([atCap.level, atCap.xp, atCap.xpApplied], [20, 0, 0]);
});

test("carry examples for recommended level 10 with 300 base XP", () => {
  assert.equal(fullClearXp(2, 5), 450);
  assert.equal(fullClearXp(2, 10), 300);
  assert.equal(fullClearXp(2, 18), 75);
  assert.equal(carryMultiplier(10, 1), 1.5); // clamp max
  assert.equal(carryMultiplier(3, 20), 0.25); // clamp min
});

test("full-clear base XP per tier", () => {
  assert.deepEqual(
    TIERS.map((t) => fullClearXp(t.tier, t.recommendedLevel)),
    [180, 300, 450],
  );
});

test("section split sums to full clear and section-by-section equals the total award", () => {
  for (const t of TIERS) {
    for (let level = 1; level <= 20; level++) {
      const full = fullClearXp(t.tier, level);
      const parts = sectionXp(full);
      assert.equal(parts[0] + parts[1] + parts[2], full);
      for (let start = 1; start <= 20; start += 3) {
        for (const xp0 of [0, 17]) {
          const s0 = { level: start, xp: Math.min(xp0, xpToNext(start) - 1) };
          let s = s0;
          for (const p of parts) s = applyXp(s, p);
          const once = applyXp(s0, full);
          assert.deepEqual([s.level, s.xp], [once.level, once.xp], `tier ${t.tier} level ${level} start ${start}`);
        }
      }
    }
  }
});

test("level scaling and unlocks in the loadout", () => {
  for (const l of LINEAGES) {
    const a = buildLoadout({ ...defaultLineageRecord(l), level: 1 });
    const b = buildLoadout({ ...defaultLineageRecord(l), level: 10 });
    assert.ok(b.damage > a.damage * 1.7 && b.maxHp > a.maxHp * 1.85);
    assert.equal(a.hasSkill2, false);
    assert.equal(buildLoadout({ ...defaultLineageRecord(l), level: 3 }).hasSkill2, true);
    assert.equal(buildLoadout({ ...defaultLineageRecord(l), level: 5 }).hasOverdrive, true);
  }
});

test("evolution below level 10 is ignored; modules are bounded", () => {
  const low = buildLoadout({ ...defaultLineageRecord("pyra"), level: 9, evolution: "flare" });
  assert.equal(low.evolution, null);
  const mod = buildLoadout({ ...defaultLineageRecord("litos"), level: 5, moduleEquipped: "carapace", moduleRanks: { carapace: 9 } });
  assert.equal(mod.module?.rank, 3);
  const base = buildLoadout({ ...defaultLineageRecord("litos"), level: 5 });
  assert.ok(mod.maxHp / base.maxHp < 1.17);
});

test("party scaling formula", () => {
  assert.deepEqual(partyScaling(1), { regularHp: 1, bossHp: 1, damage: 1 });
  const s8 = partyScaling(8);
  assert.ok(Math.abs(s8.regularHp - 4.15) < 1e-9);
  assert.ok(Math.abs(s8.bossHp - 5.2) < 1e-9);
  assert.ok(Math.abs(s8.damage - 1.28) < 1e-9);
});
