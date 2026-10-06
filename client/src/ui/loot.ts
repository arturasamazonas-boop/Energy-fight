// Loot UI: item cards, the crate reveal and the arsenal (equipment) panel.
import {
  BOX_COLORS,
  LOOT,
  RARITY_COLORS,
  SLOTS,
  gearTotals,
  effectiveStats,
  reforgeCost,
  upgradeCost,
  type BoxTier,
  type ItemInstance,
  type LineageId,
  type Slot,
  type StatId,
} from "@ef/shared";
import { api, type BoxView, type ProfileView } from "../api.ts";
import { crateCanvas, TIER_RANK } from "../game/crate.ts";
import { sfx, unlockAudio } from "../game/audio.ts";
import { itemLabel, t } from "../i18n.ts";
import { settings } from "../settings.ts";
import { confirmDialog, esc, toast } from "./dom.ts";

const SLOT_ICONS: Record<Slot, string> = { weapon: "⚔", shield: "🛡", helmet: "⛑", armor: "🜨", aura: "✺", relic: "◈" };

export function statLines(stats: Partial<Record<StatId, number>>) {
  return (Object.entries(stats) as [StatId, number][])
    .filter(([, v]) => v > 0)
    .map(([k, v]) => t(`stat_${k}`, { v: (v * 100).toFixed(1).replace(/\.0$/, "") }));
}

export function itemCardHtml(it: ItemInstance, extra = "") {
  const color = RARITY_COLORS[it.rarity];
  return `<div class="item-card rarity-${it.rarity}" style="--rar:${color}">
    <div class="item-head"><span class="item-icon">${SLOT_ICONS[it.slot]}</span><div><b>${esc(itemLabel(it))}</b><small>${t("rarity_" + it.rarity)} · ${t("slot_" + it.slot)}</small></div></div>
    <ul>${statLines(effectiveStats(it)).map((l) => `<li>${l}</li>`).join("")}</ul>
    ${it.special ? `<p class="item-special">✦ ${t("special_" + it.special)}</p>` : ""}
    ${extra}
  </div>`;
}

/** Full-screen crate opening. Marks the crate opened on the server. */
export async function revealBox(box: BoxView): Promise<void> {
  unlockAudio();
  const rank = TIER_RANK[box.tier];
  const d = document.createElement("div");
  d.className = `reveal tier-${box.tier}${rank >= 3 ? " epic" : ""}${settings.reducedMotion ? " calm" : ""}`;
  d.style.setProperty("--tier", BOX_COLORS[box.tier]);
  d.innerHTML = `
    <div class="reveal-rays"></div>
    <div class="reveal-sparks">${Array.from({ length: rank >= 3 ? 28 : 10 }, (_, i) => `<i style="--i:${i}"></i>`).join("")}</div>
    <div class="reveal-title">${rank >= 3 ? `<span class="wow">${t("box_wow")}</span>` : ""}<h2>${t("box_" + box.tier)}</h2></div>
    <div class="reveal-crate"></div>
    <div class="reveal-items"></div>
    <div class="reveal-actions"><span class="reveal-salvage"></span><button class="primary reveal-close">${t("great")}</button></div>`;
  document.body.appendChild(d);
  const crate = d.querySelector(".reveal-crate") as HTMLElement;
  crate.appendChild(crateCanvas(box.tier, 0, 220));
  sfx(rank >= 3 ? "jackpot" : "section");
  let opened = box;
  try {
    opened = (await api.openBox(box.runId)).box;
  } catch {}
  await new Promise((r) => setTimeout(r, settings.reducedMotion ? 300 : 1300 + rank * 150));
  sfx("crate_open");
  d.classList.add("open");
  crate.replaceChildren(crateCanvas(box.tier, 1, 220));
  const list = d.querySelector(".reveal-items") as HTMLElement;
  opened.items.forEach((it, i) => {
    const w = document.createElement("div");
    w.className = "reveal-item";
    w.style.animationDelay = `${0.25 + i * 0.35}s`;
    w.innerHTML = itemCardHtml(it);
    list.appendChild(w);
  });
  (d.querySelector(".reveal-salvage") as HTMLElement).textContent = t("box_salvage", { n: opened.salvage });
  await new Promise<void>((resolve) => {
    (d.querySelector(".reveal-close") as HTMLButtonElement).onclick = () => {
      d.remove();
      resolve();
    };
  });
}

export function crateBadgeHtml(tier: string) {
  return `<span class="crate-badge tier-${tier}" style="--tier:${BOX_COLORS[tier as BoxTier] ?? "#fff"}">${t("box_" + tier)}</span>`;
}

// ---- Arsenal panel ------------------------------------------------------------------

export interface ArsenalState {
  items: ItemInstance[];
  boxes: BoxView[];
}

export function renderArsenal(
  el: HTMLElement,
  profile: ProfileView,
  lineage: LineageId,
  inv: ArsenalState,
  onChange: (p?: ProfileView) => void,
) {
  const eq = (profile.lineages[lineage].equipment ?? {}) as Partial<Record<Slot, string>>;
  const byId = new Map(inv.items.map((i) => [i.id, i]));
  const worn = SLOTS.map((s) => (eq[s] ? byId.get(eq[s]!) : undefined)).filter(Boolean) as ItemInstance[];
  const totals = gearTotals(worn);
  const unopened = inv.boxes.filter((b) => !b.opened);
  const wornBy = (itemId: string) =>
    (Object.keys(profile.lineages) as LineageId[]).find((l) => Object.values(profile.lineages[l].equipment ?? {}).includes(itemId));
  el.innerHTML = `
    <div class="arsenal-head"><h3>${t("arsenal")}</h3>
      <button class="boxes-btn${unopened.length ? " has" : ""}">${t("boxes")}${unopened.length ? ` <b>${unopened.length}</b>` : ""}</button></div>
    <div class="slots">${SLOTS.map((s) => {
      const it = eq[s] ? byId.get(eq[s]!) : undefined;
      return `<button class="slot${it ? " filled rarity-" + it.rarity : ""}" data-slot="${s}" style="--rar:${it ? RARITY_COLORS[it.rarity] : "transparent"}">
        <span class="slot-icon">${SLOT_ICONS[s]}</span><small>${t("slot_" + s)}</small><b>${it ? esc(itemLabel(it)) : t("slot_empty")}</b></button>`;
    }).join("")}</div>
    <p class="small gear-bonus">${statLines(totals.stats).join(" · ") || t("arsenal_help")}</p>
    ${totals.specials.length ? `<p class="small gear-specials">${totals.specials.map((s) => "✦ " + t("special_" + s)).join("<br>")}</p>` : ""}`;

  el.querySelector<HTMLButtonElement>(".boxes-btn")!.onclick = () => openBoxesList(inv, onChange);
  el.querySelectorAll<HTMLButtonElement>(".slot").forEach((b) => {
    b.onclick = () => {
      const slot = b.dataset.slot as Slot;
      const items = inv.items.filter((i) => i.slot === slot).sort((a, c) => RARITY_ORDER(c) - RARITY_ORDER(a));
      const m = document.createElement("div");
      m.className = "modal";
      m.innerHTML = `<div class="modal-box wide"><h3>${t("slot_pick", { slot: t("slot_" + slot) })}</h3>
        <div class="item-grid">${
          items.length
            ? items
                .map((it) => {
                  const on = eq[slot] === it.id;
                  const owner = wornBy(it.id);
                  return itemCardHtml(
                    it,
                    `${owner && !on ? `<small class="worn">${t("item_equipped_on", { lin: t(owner) })}</small>` : ""}
                     <div class="row"><button class="${on ? "ghost" : "primary"} eq" data-id="${it.id}" data-on="${on ? 1 : 0}">${on ? t("item_unequip") : t("item_equip")}</button>
                     <button class="ghost dis" data-id="${it.id}">${t("item_dismantle", { n: LOOT.dismantleSalvage[it.rarity] })}</button></div>
                     <div class="row">${upgradeCost(it) !== null ? `<button class="ghost upg" data-id="${it.id}" ${profile.salvage < upgradeCost(it)! ? "disabled" : ""}>${t("item_upgrade", { n: upgradeCost(it)! })}</button>` : `<small>${t("item_max_plus")}</small>`}
                     <button class="ghost ref" data-id="${it.id}" ${profile.salvage < reforgeCost(it) ? "disabled" : ""}>${t("item_reforge", { n: reforgeCost(it) })}</button></div>`,
                  );
                })
                .join("")
            : `<p class="small">${t("slot_none_items")}</p>`
        }</div><div class="row"><button class="primary close">${t("close")}</button></div></div>`;
      document.body.appendChild(m);
      m.querySelector<HTMLButtonElement>(".close")!.onclick = () => m.remove();
      m.addEventListener("click", (e) => {
        if (e.target === m) m.remove();
      });
      m.querySelectorAll<HTMLButtonElement>(".eq").forEach((btn) => {
        btn.onclick = async () => {
          try {
            const r = await api.equipItem(lineage, slot, btn.dataset.on === "1" ? null : btn.dataset.id!);
            m.remove();
            sfx("ui");
            onChange(r.profile);
          } catch (e: any) {
            toast(t("err_" + e.code));
          }
        };
      });
      const improve = (kind: "upg" | "ref") =>
        m.querySelectorAll<HTMLButtonElement>(`.${kind}`).forEach((btn) => {
          btn.onclick = async () => {
            try {
              const r = kind === "upg" ? await api.upgradeItem(btn.dataset.id!) : await api.reforgeItem(btn.dataset.id!);
              sfx(kind === "upg" ? "perfect" : "crate_open");
              toast(`${itemLabel(r.item)} · ${statLines(effectiveStats(r.item)).join(" · ")}`, 3500);
              m.remove();
              onChange(r.profile);
            } catch (e: any) {
              toast(t("err_" + e.code));
            }
          };
        });
      improve("upg");
      improve("ref");
      m.querySelectorAll<HTMLButtonElement>(".dis").forEach((btn) => {
        btn.onclick = async () => {
          const it = byId.get(btn.dataset.id!)!;
          if (!(await confirmDialog(t("item_dismantle_confirm", { name: itemLabel(it), n: LOOT.dismantleSalvage[it.rarity] })))) return;
          try {
            const r = await api.dismantle(it.id);
            m.remove();
            onChange(r.profile ?? undefined);
          } catch (e: any) {
            toast(t("err_" + e.code));
          }
        };
      });
    };
  });
}

const RARITY_ORDER = (i: ItemInstance) => ["common", "rare", "epic", "legendary", "mythic", "ultra"].indexOf(i.rarity);

function openBoxesList(inv: ArsenalState, onChange: (p?: ProfileView) => void) {
  const m = document.createElement("div");
  m.className = "modal";
  m.innerHTML = `<div class="modal-box wide"><h3>${t("boxes")}</h3>
    <div class="box-list">${
      inv.boxes.length
        ? inv.boxes
            .map(
              (b) => `<div class="box-row tier-${b.tier}"><span class="box-thumb"></span>${crateBadgeHtml(b.tier)}
              <small>${new Date(b.createdAt).toLocaleDateString()}</small>
              ${b.opened ? `<span class="small">${t("box_opened")} · ${b.items.length}</span>` : `<button class="primary open" data-run="${esc(b.runId)}">${t("box_open")}</button>`}</div>`,
            )
            .join("")
        : `<p class="small">${t("boxes_empty")}</p>`
    }</div><div class="row"><button class="primary close">${t("close")}</button></div></div>`;
  document.body.appendChild(m);
  m.querySelectorAll<HTMLElement>(".box-row").forEach((row, i) => row.querySelector(".box-thumb")!.appendChild(crateCanvas(inv.boxes[i].tier, inv.boxes[i].opened ? 1 : 0, 56)));
  m.querySelector<HTMLButtonElement>(".close")!.onclick = () => m.remove();
  m.querySelectorAll<HTMLButtonElement>(".open").forEach((btn) => {
    btn.onclick = async () => {
      const box = inv.boxes.find((b) => b.runId === btn.dataset.run)!;
      m.remove();
      await revealBox(box);
      onChange();
    };
  });
}
