import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "../server/src/db.ts";
import { ProfileService } from "../server/src/profiles.ts";

async function service(dataDir?: string) {
  const db = await openDb({ dataDir });
  return { db, svc: new ProfileService(db) };
}

test("guest credentials are random, hashed and validated", async () => {
  const { db, svc } = await service();
  const a = await svc.createGuest("Ana");
  const b = await svc.createGuest("<b>Bo</b>");
  assert.notEqual(a.token, b.token);
  assert.ok(a.token.length >= 40);
  assert.equal(await svc.authenticate(a.token), a.profile.id);
  assert.equal(await svc.authenticate("nope-nope-nope-nope-nope"), null);
  assert.equal(b.profile.name, "bBo/b");
  const rows = await db.query("SELECT token_hash FROM profiles");
  assert.ok(rows.every((r: any) => r.token_hash !== a.token && r.token_hash.length === 64));
  assert.equal(Object.keys(a.profile.lineages).length, 4);
  await db.close();
});

test("section reward is idempotent and records the server-computed amount", async () => {
  const { db, svc } = await service();
  const { profile } = await svc.createGuest("Kid", { level: 5 });
  const award = { runId: "run-1", sectionId: 1, profileId: profile.id, lineage: "krios" as const, tier: 2, levelAtStart: 5, eligible: true, supportMark: false };
  const [r1, r2] = await Promise.all([svc.awardSection(award), svc.awardSection(award)]);
  const r3 = await svc.awardSection(award);
  assert.equal(r1.xp, 112); // 25% of 450
  assert.deepEqual(r2, { ...r1, bonus: r2.bonus });
  assert.equal(r3.xp, r1.xp);
  const ledger = await db.query("SELECT * FROM reward_ledger WHERE profile_id = $1", [profile.id]);
  assert.equal(ledger.length, 1);
  const p = (await svc.getProfile(profile.id))!;
  assert.equal(p.lineages.krios.xp, 112);
  assert.equal(p.lineages.pyra.xp, 0, "other lineages untouched");
  assert.equal(p.salvage, r1.salvage);
  await db.close();
});

test("full clear across three sections matches the carry example and unlocks the next tier", async () => {
  const { db, svc } = await service();
  const { profile } = await svc.createGuest("Kid", { level: 5 });
  let last;
  for (const sectionId of [1, 2, 3]) {
    last = await svc.awardSection({ runId: "run-2", sectionId, profileId: profile.id, lineage: "pyra", tier: 2, levelAtStart: 5, eligible: true, supportMark: false });
  }
  const p = (await svc.getProfile(profile.id))!;
  // 450 XP from level 5 → level 7 with 20 XP (the brief's example).
  assert.deepEqual([p.lineages.pyra.level, p.lineages.pyra.xp], [7, 20]);
  assert.deepEqual([last!.levelAfter, last!.xpAfter], [7, 20]);
  assert.equal(p.tierUnlocked, 3);
  await db.close();
});

test("support mark is granted once in the final section and is not combat power", async () => {
  const { db, svc } = await service();
  const { profile } = await svc.createGuest("Vet", { level: 18 });
  const a = { runId: "run-3", sectionId: 3, profileId: profile.id, lineage: "litos" as const, tier: 2, levelAtStart: 18, eligible: true, supportMark: true };
  await svc.awardSection(a);
  await svc.awardSection(a);
  const p = (await svc.getProfile(profile.id))!;
  assert.equal(p.supportMarks, 1);
  await db.close();
});

test("ineligible section records zero reward", async () => {
  const { db, svc } = await service();
  const { profile } = await svc.createGuest("Afk");
  const r = await svc.awardSection({ runId: "run-4", sectionId: 1, profileId: profile.id, lineage: "pyra", tier: 1, levelAtStart: 1, eligible: false, supportMark: false });
  assert.deepEqual([r.xp, r.salvage, r.fragments, r.eligible], [0, 0, 0, false]);
  const p = (await svc.getProfile(profile.id))!;
  assert.equal(p.lineages.pyra.xp, 0);
  await db.close();
});

test("modules debit the shared salvage balance; evolution is permanent per lineage", async () => {
  const { db, svc } = await service();
  const { profile } = await svc.createGuest("Lab", { level: 10, salvage: 40 });
  await assert.rejects(svc.chooseEvolution(profile.id, "pyra", "glacier"), /invalid_choice/);
  await svc.chooseEvolution(profile.id, "pyra", "flare");
  await assert.rejects(svc.chooseEvolution(profile.id, "pyra", "furnace"), /already_chosen/);
  let p = (await svc.upgradeModule(profile.id, "krios", "capacitor"))!;
  assert.equal(p.salvage, 25);
  assert.equal(p.lineages.krios.moduleRanks.capacitor, 1);
  assert.equal(p.lineages.krios.moduleEquipped, "capacitor");
  assert.equal(p.lineages.pyra.moduleEquipped, null);
  await assert.rejects(svc.upgradeModule(profile.id, "krios", "capacitor"), /not_enough_salvage/);
  p = (await svc.getProfile(profile.id))!;
  assert.equal(p.salvage, 25);
  assert.equal(p.lineages.pyra.evolution, "flare");
  assert.equal(p.lineages.krios.evolution, null);
  await assert.rejects(svc.chooseModifier(profile.id, "pyra", "pyra_cd"), /level_too_low/);
  await db.close();
});

test("progression for all four lineages survives a database restart", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-db-"));
  try {
    let { db, svc } = await service(dir);
    const { token, profile } = await svc.createGuest("Persist", { level: 9 });
    for (const [i, lineage] of (["pyra", "krios", "vektor", "litos"] as const).entries()) {
      await svc.awardSection({ runId: `r${i}`, sectionId: 1, profileId: profile.id, lineage, tier: 2, levelAtStart: 9, eligible: true, supportMark: false });
    }
    await svc.awardSection({ runId: "r0", sectionId: 2, profileId: profile.id, lineage: "pyra", tier: 2, levelAtStart: 9, eligible: true, supportMark: false });
    await svc.awardSection({ runId: "r0", sectionId: 3, profileId: profile.id, lineage: "pyra", tier: 2, levelAtStart: 9, eligible: true, supportMark: false });
    await svc.chooseEvolution(profile.id, "pyra", "furnace");
    const before = await svc.getProfile(profile.id);
    await db.close();
    ({ db, svc } = await service(dir));
    assert.equal(await svc.authenticate(token), profile.id);
    const after = await svc.getProfile(profile.id);
    assert.deepEqual(after, before);
    assert.equal(after!.lineages.pyra.evolution, "furnace");
    assert.ok(after!.lineages.pyra.level >= 10);
    // Re-processing an old section after restart is still a no-op.
    await svc.awardSection({ runId: "r1", sectionId: 1, profileId: profile.id, lineage: "krios", tier: 2, levelAtStart: 9, eligible: true, supportMark: false });
    assert.deepEqual(await svc.getProfile(profile.id), before);
    await db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
