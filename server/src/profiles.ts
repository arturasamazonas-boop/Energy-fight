import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  LINEAGES,
  MODULES,
  MODULE_MAX_RANK,
  MODULE_UPGRADE_COST,
  PLAYER,
  UNLOCKS,
  applyXp,
  evolutionIds,
  fullClearXp,
  modifierIds,
  sectionMaterials,
  sectionXp,
  type LineageId,
  type LineageRecord,
  type SectionRewardView,
  LOOT,
  SLOTS,
  type BoxTier,
  type ItemInstance,
  reforgeItem,
  reforgeCost,
  upgradeCost,
} from "@ef/shared";
import type { Db, Queryer } from "./db.ts";

export interface ProfileView {
  id: string;
  name: string;
  salvage: number;
  supportMarks: number;
  tierUnlocked: number;
  lastLineage: LineageId;
  lineages: Record<LineageId, LineageRecord>;
}

export class LabError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function sanitizeName(raw: unknown): string {
  const s = typeof raw === "string" ? raw : "";
  const clean = s.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 16);
  return clean || "Žaidėjas";
}

export class ProfileService {
  private locks = new Map<string, Promise<unknown>>();
  constructor(readonly db: Db) {}

  /** Serializes conflicting mutations of one profile inside this process. */
  private withLock<T>(profileId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(profileId) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    this.locks.set(profileId, next);
    next.finally(() => {
      if (this.locks.get(profileId) === next) this.locks.delete(profileId);
    }).catch(() => {});
    return next;
  }

  async createGuest(name: unknown, opts: { level?: number; tierUnlocked?: number; salvage?: number } = {}) {
    const token = randomBytes(32).toString("base64url");
    const id = randomUUID();
    const level = Math.max(1, Math.min(PLAYER.levelCap, opts.level ?? 1));
    await this.db.tx(async (q) => {
      await q.query(`INSERT INTO profiles (id, token_hash, name, tier_unlocked, salvage) VALUES ($1, $2, $3, $4, $5)`, [
        id,
        hashToken(token),
        sanitizeName(name),
        opts.tierUnlocked ?? 1,
        opts.salvage ?? 0,
      ]);
      for (const l of LINEAGES) {
        await q.query(`INSERT INTO lineage_progress (profile_id, lineage, level) VALUES ($1, $2, $3)`, [id, l, level]);
      }
    });
    return { token, profile: (await this.getProfile(id))! };
  }

  async authenticate(token: unknown): Promise<string | null> {
    if (typeof token !== "string" || token.length < 20 || token.length > 100) return null;
    const rows = await this.db.query<{ id: string }>(`SELECT id FROM profiles WHERE token_hash = $1`, [hashToken(token)]);
    return rows[0]?.id ?? null;
  }

  async getProfile(id: string, q: Queryer = this.db): Promise<ProfileView | null> {
    const p = (await q.query(`SELECT * FROM profiles WHERE id = $1`, [id]))[0];
    if (!p) return null;
    const rows = await q.query(`SELECT * FROM lineage_progress WHERE profile_id = $1`, [id]);
    const lineages = {} as Record<LineageId, LineageRecord>;
    for (const r of rows) lineages[r.lineage as LineageId] = rowToRecord(r);
    return {
      id: p.id,
      name: p.name,
      salvage: Number(p.salvage),
      supportMarks: Number(p.support_marks),
      tierUnlocked: Number(p.tier_unlocked),
      lastLineage: p.last_lineage,
      lineages,
    };
  }

  async setLastLineage(id: string, lineage: LineageId) {
    await this.db.query(`UPDATE profiles SET last_lineage = $2, updated_at = now() WHERE id = $1`, [id, lineage]);
  }

  async rename(id: string, name: unknown) {
    await this.db.query(`UPDATE profiles SET name = $2, updated_at = now() WHERE id = $1`, [id, sanitizeName(name)]);
  }

  chooseEvolution(id: string, lineage: LineageId, evo: string) {
    return this.withLock(id, () =>
      this.db.tx(async (q) => {
        const r = (await q.query(`SELECT * FROM lineage_progress WHERE profile_id = $1 AND lineage = $2 FOR UPDATE`, [id, lineage]))[0];
        if (!r) throw new LabError("not_found");
        if (r.level < UNLOCKS.evolution) throw new LabError("level_too_low");
        if (r.evolution) throw new LabError("already_chosen");
        if (!evolutionIds(lineage).includes(evo)) throw new LabError("invalid_choice");
        await q.query(`UPDATE lineage_progress SET evolution = $3 WHERE profile_id = $1 AND lineage = $2`, [id, lineage, evo]);
        return this.getProfile(id, q);
      }),
    );
  }

  chooseModifier(id: string, lineage: LineageId, mod: string) {
    return this.withLock(id, () =>
      this.db.tx(async (q) => {
        const r = (await q.query(`SELECT * FROM lineage_progress WHERE profile_id = $1 AND lineage = $2 FOR UPDATE`, [id, lineage]))[0];
        if (!r) throw new LabError("not_found");
        if (r.level < UNLOCKS.modifier) throw new LabError("level_too_low");
        if (!modifierIds(lineage).includes(mod)) throw new LabError("invalid_choice");
        await q.query(`UPDATE lineage_progress SET modifier = $3 WHERE profile_id = $1 AND lineage = $2`, [id, lineage, mod]);
        return this.getProfile(id, q);
      }),
    );
  }

  equipModule(id: string, lineage: LineageId, moduleId: string | null) {
    return this.withLock(id, () =>
      this.db.tx(async (q) => {
        if (moduleId !== null && !MODULES.some((m) => m.id === moduleId)) throw new LabError("invalid_choice");
        await q.query(`UPDATE lineage_progress SET module_equipped = $3 WHERE profile_id = $1 AND lineage = $2`, [id, lineage, moduleId]);
        return this.getProfile(id, q);
      }),
    );
  }

  upgradeModule(id: string, lineage: LineageId, moduleId: string) {
    return this.withLock(id, () =>
      this.db.tx(async (q) => {
        if (!MODULES.some((m) => m.id === moduleId)) throw new LabError("invalid_choice");
        const p = (await q.query(`SELECT salvage FROM profiles WHERE id = $1 FOR UPDATE`, [id]))[0];
        const r = (await q.query(`SELECT module_ranks FROM lineage_progress WHERE profile_id = $1 AND lineage = $2 FOR UPDATE`, [id, lineage]))[0];
        if (!p || !r) throw new LabError("not_found");
        const ranks = parseRanks(r.module_ranks);
        const cur = ranks[moduleId] ?? 0;
        if (cur >= MODULE_MAX_RANK) throw new LabError("max_rank");
        const cost = MODULE_UPGRADE_COST[cur];
        if (Number(p.salvage) < cost) throw new LabError("not_enough_salvage");
        ranks[moduleId] = cur + 1;
        await q.query(`UPDATE profiles SET salvage = salvage - $2, updated_at = now() WHERE id = $1`, [id, cost]);
        await q.query(`UPDATE lineage_progress SET module_ranks = $3::jsonb, module_equipped = COALESCE(module_equipped, $4) WHERE profile_id = $1 AND lineage = $2`, [
          id,
          lineage,
          JSON.stringify(ranks),
          moduleId,
        ]);
        return this.getProfile(id, q);
      }),
    );
  }

  /**
   * Idempotent section award. The ledger row keyed by (run, section, profile)
   * is inserted first; if it already exists nothing else changes and the
   * stored reward is returned.
   */
  awardSection(a: {
    runId: string;
    sectionId: number;
    profileId: string;
    lineage: LineageId;
    tier: number;
    levelAtStart: number;
    eligible: boolean;
    supportMark: boolean;
  }): Promise<SectionRewardView> {
    return this.withLock(a.profileId, () =>
      this.db.tx(async (q) => {
        const existing = (await q.query(`SELECT * FROM reward_ledger WHERE run_id = $1 AND section_id = $2 AND profile_id = $3`, [a.runId, a.sectionId, a.profileId]))[0];
        if (existing) return ledgerToView(existing);
        const lp = (await q.query(`SELECT * FROM lineage_progress WHERE profile_id = $1 AND lineage = $2 FOR UPDATE`, [a.profileId, a.lineage]))[0];
        await q.query(`SELECT id FROM profiles WHERE id = $1 FOR UPDATE`, [a.profileId]);
        if (!lp) throw new LabError("not_found");
        const xp = a.eligible ? sectionXp(fullClearXp(a.tier, a.levelAtStart))[a.sectionId - 1] : 0;
        const mats = a.eligible ? sectionMaterials(a.tier, a.runId, a.sectionId, a.profileId) : { salvage: 0, fragments: 0, bonus: false };
        const support = a.eligible && a.supportMark && a.sectionId === 3 ? 1 : 0;
        const after = applyXp({ level: Number(lp.level), xp: Number(lp.xp) }, xp);
        const inserted = await q.query(
          `INSERT INTO reward_ledger (run_id, section_id, profile_id, lineage, eligible, xp, xp_applied, salvage, fragments, support_mark, level_before, level_after, xp_after)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           ON CONFLICT (run_id, section_id, profile_id) DO NOTHING RETURNING *`,
          [a.runId, a.sectionId, a.profileId, a.lineage, a.eligible, xp, after.xpApplied, mats.salvage, mats.fragments, support, Number(lp.level), after.level, after.xp],
        );
        if (inserted.length === 0) {
          const row = (await q.query(`SELECT * FROM reward_ledger WHERE run_id = $1 AND section_id = $2 AND profile_id = $3`, [a.runId, a.sectionId, a.profileId]))[0];
          return ledgerToView(row);
        }
        if (a.eligible) {
          await q.query(`UPDATE lineage_progress SET level = $3, xp = $4, fragments = fragments + $5 WHERE profile_id = $1 AND lineage = $2`, [
            a.profileId,
            a.lineage,
            after.level,
            after.xp,
            mats.fragments,
          ]);
          await q.query(`UPDATE profiles SET salvage = salvage + $2, support_marks = support_marks + $3, updated_at = now() WHERE id = $1`, [a.profileId, mats.salvage, support]);
        }
        if (a.sectionId === 3 && a.eligible) {
          await q.query(`UPDATE profiles SET tier_unlocked = GREATEST(tier_unlocked, $2) WHERE id = $1`, [a.profileId, Math.min(3, a.tier + 1)]);
        }
        return ledgerToView(inserted[0], mats.bonus);
      }),
    );
  }

  // ---- loot crates & equipment ---------------------------------------------------

  /** Idempotent crate grant keyed by (run, profile). Returns the stored crate. */
  grantBox(a: { runId: string; profileId: string; tier: BoxTier; impact: number; performance: number; salvage: number; items: ItemInstance[] }): Promise<BoxView> {
    return this.withLock(a.profileId, () =>
      this.db.tx(async (q) => {
        const inserted = await q.query(
          `INSERT INTO loot_boxes (run_id, profile_id, tier, impact, performance, salvage, item_ids)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT (run_id, profile_id) DO NOTHING RETURNING run_id`,
          [a.runId, a.profileId, a.tier, a.impact, a.performance, a.salvage, JSON.stringify(a.items.map((i) => i.id))],
        );
        if (inserted.length) {
          for (const it of a.items) {
            await q.query(`INSERT INTO items (id, profile_id, base_id, slot, rarity, stats, special, source_run) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`, [
              it.id, a.profileId, it.baseId, it.slot, it.rarity, JSON.stringify(it.stats), it.special, a.runId,
            ]);
          }
          await q.query(`UPDATE profiles SET salvage = salvage + $2, updated_at = now() WHERE id = $1`, [a.profileId, a.salvage]);
          await this.enforceInventoryLimit(q, a.profileId, new Set(a.items.map((i) => i.id)));
        }
        return (await this.boxView(q, a.profileId, a.runId))!;
      }),
    );
  }

  /**
   * Claims today's daily reward for a run. Idempotent per run: returns true when this
   * run owns the claim (just inserted, or inserted earlier by the same run).
   */
  async claimDaily(profileId: string, day: string, runId: string): Promise<boolean> {
    await this.db.query(`INSERT INTO daily_claims (profile_id, day, run_id) VALUES ($1,$2,$3) ON CONFLICT (profile_id, day) DO NOTHING`, [profileId, day, runId]);
    const rows = await this.db.query(`SELECT run_id FROM daily_claims WHERE profile_id = $1 AND day = $2`, [profileId, day]);
    return rows[0]?.run_id === runId;
  }

  async dailyClaimed(profileId: string, day: string): Promise<boolean> {
    return (await this.db.query(`SELECT 1 FROM daily_claims WHERE profile_id = $1 AND day = $2`, [profileId, day])).length > 0;
  }

  /** Over the limit, the weakest unequipped older items are salvaged automatically. */
  private async enforceInventoryLimit(q: Queryer, profileId: string, keep: Set<string>) {
    const rows = await q.query(`SELECT id, rarity FROM items WHERE profile_id = $1`, [profileId]);
    const excess = rows.length - LOOT.inventoryLimit;
    if (excess <= 0) return;
    const worn = new Set<string>();
    for (const r of await q.query(`SELECT equipment FROM lineage_progress WHERE profile_id = $1`, [profileId])) {
      for (const id of Object.values(parseRanks(r.equipment) as unknown as Record<string, string>)) worn.add(id);
    }
    const order = ["common", "rare", "epic", "legendary", "mythic", "ultra"];
    const victims = rows
      .filter((r: any) => !worn.has(r.id) && !keep.has(r.id))
      .sort((x: any, y: any) => order.indexOf(x.rarity) - order.indexOf(y.rarity))
      .slice(0, excess);
    let gain = 0;
    for (const v of victims) {
      await q.query(`DELETE FROM items WHERE id = $1`, [v.id]);
      gain += LOOT.dismantleSalvage[v.rarity as keyof typeof LOOT.dismantleSalvage] ?? 0;
    }
    if (gain) await q.query(`UPDATE profiles SET salvage = salvage + $2 WHERE id = $1`, [profileId, gain]);
  }

  private async boxView(q: Queryer, profileId: string, runId: string): Promise<BoxView | null> {
    const b = (await q.query(`SELECT * FROM loot_boxes WHERE run_id = $1 AND profile_id = $2`, [runId, profileId]))[0];
    if (!b) return null;
    const ids: string[] = typeof b.item_ids === "string" ? JSON.parse(b.item_ids) : b.item_ids;
    const rows = ids.length ? await q.query(`SELECT * FROM items WHERE id = ANY($1)`, [ids]) : [];
    const byId = new Map(rows.map((r: any) => [r.id, rowToItem(r)]));
    return {
      runId: b.run_id,
      tier: b.tier,
      salvage: Number(b.salvage),
      impact: Number(b.impact),
      performance: Number(b.performance),
      opened: !!b.opened,
      // Items dismantled later are simply omitted.
      items: ids.map((id) => byId.get(id)).filter(Boolean) as ItemInstance[],
      createdAt: new Date(b.created_at).toISOString(),
    };
  }

  async listBoxes(profileId: string, limit = 20): Promise<BoxView[]> {
    const rows = await this.db.query(`SELECT run_id FROM loot_boxes WHERE profile_id = $1 ORDER BY opened ASC, created_at DESC LIMIT $2`, [profileId, limit]);
    const out: BoxView[] = [];
    for (const r of rows) {
      const v = await this.boxView(this.db, profileId, r.run_id);
      if (v) out.push(v);
    }
    return out;
  }

  openBox(profileId: string, runId: string): Promise<BoxView> {
    return this.withLock(profileId, () =>
      this.db.tx(async (q) => {
        const r = await q.query(`UPDATE loot_boxes SET opened = true WHERE run_id = $1 AND profile_id = $2 RETURNING run_id`, [runId, profileId]);
        if (!r.length) throw new LabError("not_found");
        return (await this.boxView(q, profileId, runId))!;
      }),
    );
  }

  async inventory(profileId: string): Promise<ItemInstance[]> {
    const rows = await this.db.query(`SELECT * FROM items WHERE profile_id = $1 ORDER BY created_at DESC`, [profileId]);
    return rows.map(rowToItem);
  }

  /** Items equipped on one lineage (used for the run-start loadout snapshot). */
  async equippedItems(profileId: string, lineage: LineageId, q: Queryer = this.db): Promise<ItemInstance[]> {
    const lp = (await q.query(`SELECT equipment FROM lineage_progress WHERE profile_id = $1 AND lineage = $2`, [profileId, lineage]))[0];
    const eq = parseRanks(lp?.equipment) as unknown as Record<string, string>;
    const ids = Object.values(eq).filter(Boolean);
    if (!ids.length) return [];
    const rows = await q.query(`SELECT * FROM items WHERE profile_id = $1 AND id = ANY($2)`, [profileId, ids]);
    return rows.map(rowToItem);
  }

  /** Equips an item on one lineage; an item can be worn by only one lineage at a time. */
  equipItem(profileId: string, lineage: LineageId, slot: string, itemId: string | null) {
    return this.withLock(profileId, () =>
      this.db.tx(async (q) => {
        if (!(SLOTS as readonly string[]).includes(slot)) throw new LabError("invalid_choice");
        if (itemId !== null) {
          const it = (await q.query(`SELECT slot FROM items WHERE id = $1 AND profile_id = $2`, [itemId, profileId]))[0];
          if (!it) throw new LabError("not_found");
          if (it.slot !== slot) throw new LabError("invalid_choice");
        }
        const rows = await q.query(`SELECT lineage, equipment FROM lineage_progress WHERE profile_id = $1 FOR UPDATE`, [profileId]);
        for (const r of rows) {
          const eq = parseRanks(r.equipment) as unknown as Record<string, string>;
          let changed = false;
          for (const [s, id] of Object.entries(eq)) {
            if (itemId !== null && id === itemId && !(r.lineage === lineage && s === slot)) {
              delete eq[s];
              changed = true;
            }
          }
          if (r.lineage === lineage) {
            if (itemId === null) delete eq[slot];
            else eq[slot] = itemId;
            changed = true;
          }
          if (changed) await q.query(`UPDATE lineage_progress SET equipment = $3::jsonb WHERE profile_id = $1 AND lineage = $2`, [profileId, r.lineage, JSON.stringify(eq)]);
        }
        return this.getProfile(profileId, q);
      }),
    );
  }

  /** +1 upgrade for salvage (max +5). */
  upgradeItem(profileId: string, itemId: string) {
    return this.withLock(profileId, () =>
      this.db.tx(async (q) => {
        const row = (await q.query(`SELECT * FROM items WHERE id = $1 AND profile_id = $2 FOR UPDATE`, [itemId, profileId]))[0];
        if (!row) throw new LabError("not_found");
        const cost = upgradeCost(rowToItem(row));
        if (cost === null) throw new LabError("max_rank");
        const p = (await q.query(`SELECT salvage FROM profiles WHERE id = $1 FOR UPDATE`, [profileId]))[0];
        if (Number(p.salvage) < cost) throw new LabError("not_enough_salvage");
        await q.query(`UPDATE profiles SET salvage = salvage - $2, updated_at = now() WHERE id = $1`, [profileId, cost]);
        await q.query(`UPDATE items SET plus = plus + 1 WHERE id = $1`, [itemId]);
        return { profile: await this.getProfile(profileId, q), item: rowToItem((await q.query(`SELECT * FROM items WHERE id = $1`, [itemId]))[0]) };
      }),
    );
  }

  /** Re-rolls secondary stats for salvage. */
  reforgeItem(profileId: string, itemId: string, rng: () => number) {
    return this.withLock(profileId, () =>
      this.db.tx(async (q) => {
        const row = (await q.query(`SELECT * FROM items WHERE id = $1 AND profile_id = $2 FOR UPDATE`, [itemId, profileId]))[0];
        if (!row) throw new LabError("not_found");
        const item = rowToItem(row);
        const cost = reforgeCost(item);
        const p = (await q.query(`SELECT salvage FROM profiles WHERE id = $1 FOR UPDATE`, [profileId]))[0];
        if (Number(p.salvage) < cost) throw new LabError("not_enough_salvage");
        const next = reforgeItem(item, rng);
        await q.query(`UPDATE profiles SET salvage = salvage - $2, updated_at = now() WHERE id = $1`, [profileId, cost]);
        await q.query(`UPDATE items SET stats = $2::jsonb WHERE id = $1`, [itemId, JSON.stringify(next.stats)]);
        return { profile: await this.getProfile(profileId, q), item: next };
      }),
    );
  }

  /** Breaks an item down into salvage; it is unequipped everywhere first. */
  dismantleItem(profileId: string, itemId: string) {
    return this.withLock(profileId, () =>
      this.db.tx(async (q) => {
        const it = (await q.query(`DELETE FROM items WHERE id = $1 AND profile_id = $2 RETURNING rarity`, [itemId, profileId]))[0];
        if (!it) throw new LabError("not_found");
        const rows = await q.query(`SELECT lineage, equipment FROM lineage_progress WHERE profile_id = $1 FOR UPDATE`, [profileId]);
        for (const r of rows) {
          const eq = parseRanks(r.equipment) as unknown as Record<string, string>;
          const before = JSON.stringify(eq);
          for (const [s, id] of Object.entries(eq)) if (id === itemId) delete eq[s];
          if (JSON.stringify(eq) !== before) await q.query(`UPDATE lineage_progress SET equipment = $3::jsonb WHERE profile_id = $1 AND lineage = $2`, [profileId, r.lineage, JSON.stringify(eq)]);
        }
        const gain = LOOT.dismantleSalvage[it.rarity as keyof typeof LOOT.dismantleSalvage] ?? 0;
        await q.query(`UPDATE profiles SET salvage = salvage + $2, updated_at = now() WHERE id = $1`, [profileId, gain]);
        return { profile: await this.getProfile(profileId, q), salvage: gain };
      }),
    );
  }

  async recordRunStart(runId: string, code: string, tier: number, partySize: number) {
    await this.db.query(`INSERT INTO runs (run_id, room_code, tier, party_size) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [runId, code, tier, partySize]);
  }
  async recordRunEnd(runId: string, result: string) {
    await this.db.query(`UPDATE runs SET ended_at = now(), result = $2 WHERE run_id = $1`, [runId, result]);
  }

  async ledgerFor(runId: string, profileId: string) {
    const rows = await this.db.query(`SELECT * FROM reward_ledger WHERE run_id = $1 AND profile_id = $2 ORDER BY section_id`, [runId, profileId]);
    return rows.map((r) => ledgerToView(r));
  }
}

function parseRanks(v: unknown): Record<string, number> {
  if (!v) return {};
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return {};
    }
  }
  return { ...(v as Record<string, number>) };
}

function rowToRecord(r: any): LineageRecord {
  return {
    lineage: r.lineage,
    level: Number(r.level),
    xp: Number(r.xp),
    evolution: r.evolution ?? null,
    modifier: r.modifier ?? null,
    fragments: Number(r.fragments),
    moduleEquipped: r.module_equipped ?? null,
    moduleRanks: parseRanks(r.module_ranks),
    equipment: parseRanks(r.equipment) as unknown as Record<string, string>,
  };
}

function rowToItem(r: any): ItemInstance {
  return { id: r.id, baseId: r.base_id, slot: r.slot, rarity: r.rarity, stats: typeof r.stats === "string" ? JSON.parse(r.stats) : r.stats, special: r.special ?? null, plus: Number(r.plus ?? 0) };
}

export interface BoxView {
  runId: string;
  tier: BoxTier;
  salvage: number;
  impact: number;
  performance: number;
  opened: boolean;
  items: ItemInstance[];
  createdAt: string;
}

function ledgerToView(r: any, bonus = false): SectionRewardView {
  return {
    sectionId: Number(r.section_id),
    xp: Number(r.xp),
    salvage: Number(r.salvage),
    fragments: Number(r.fragments),
    bonus,
    eligible: !!r.eligible,
    supportMark: Number(r.support_mark) > 0,
    levelAfter: Number(r.level_after),
    xpAfter: Number(r.xp_after),
  };
}
