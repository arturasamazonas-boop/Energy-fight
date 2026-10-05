import {
  LINEAGES,
  LINEAGE_SPECS,
  MODULES,
  MODULE_MAX_RANK,
  MODULE_UPGRADE_COST,
  PLAYER,
  UNLOCKS,
  buildLoadout,
  xpToNext,
  type LineageId,
} from "@ef/shared";
import { api, type ProfileView } from "../api.ts";
import { t } from "../i18n.ts";
import { esc, toast, confirmDialog } from "./dom.ts";
import { brandHtml, icon, portraitHtml, UI_COPY, UI_LINEAGE_COLORS } from "./artwork.ts";
import { renderArsenal, type ArsenalState } from "./loot.ts";

export interface LabHandlers {
  onCreate: (lineage: LineageId) => void;
  onJoin: (code: string, lineage: LineageId) => void;
  onSettings: () => void;
  onProfile: (p: ProfileView) => void;
  devTools: boolean;
  onDevSeed: (level: number) => void;
}

export function renderLab(root: HTMLElement, profile: ProfileView, h: LabHandlers, message?: string) {
  let selected: LineageId = profile.lastLineage;
  let inv: ArsenalState = { items: [], boxes: [] };
  const loadInventory = async () => {
    try {
      inv = await api.inventory();
    } catch {}
    drawList();
    drawDetail();
  };
  root.innerHTML = `
    <div class="screen lab illustrated-screen">
      <header class="lab-head">
        <div class="brand">${brandHtml()}</div>
        <div class="wallet">
          <div class="wallet-item" title="${t("salvage")}">${icon("salvage")}<span><small>${t("salvage")}</small><b data-wallet="salvage">${profile.salvage}</b></span></div>
          <div class="wallet-item" title="${t("support_marks")}">${icon("support")}<span><small>${t("support_marks")}</small><b data-wallet="support">${profile.supportMarks}</b></span></div>
          <div class="wallet-item" title="${t("tiers")}">${icon("tier")}<span><small>${t("tiers")}</small><b data-wallet="tier">${profile.tierUnlocked}/3</b></span></div>
          <button class="ghost settings-btn icon-button" title="${t("settings")}" aria-label="${t("settings")}">${icon("settings")}</button>
        </div>
      </header>
      ${message ? `<div class="notice">${esc(message)}</div>` : ""}
      <footer class="lab-actions">
        <div class="expedition-copy"><span class="eyebrow">${UI_COPY.expedition}</span><strong>${UI_COPY.expeditionHelp}</strong></div>
        <div class="expedition-actions">
          <button class="primary create-btn">${icon("plus")}${t("create_room")}</button>
          <div class="join-row">
            <input class="code-input" maxlength="5" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="${t("room_code")}" placeholder="${t("room_code")}" />
            <button class="join-btn">${t("join_room")}${icon("arrow")}</button>
          </div>
        </div>
      </footer>
      <div class="lab-section-title"><div><span class="eyebrow">${t("lab")} · ${esc(profile.name)}</span><h1>${UI_COPY.chooseLineage}</h1></div><p>${UI_COPY.lineageHelp}</p></div>
      <div class="lab-body">
        <div class="lineage-list" aria-label="${UI_COPY.selectLineage}"></div>
        <div class="lineage-detail"></div>
      </div>

      ${h.devTools ? `<details class="dev"><summary>${t("dev_tools")}</summary>${[1, 9, 18].map((l) => `<button class="ghost dev-seed" data-l="${l}">${t("dev_seed", { level: l })}</button>`).join("")}${["gold", "platinum", "divine", "ultra"].map((x) => `<button class="ghost dev-box" data-t="${x}">+ ${t("box_" + x)}</button>`).join("")}</details>` : ""}
      <p class="fine">${t("guest_note")}</p>
    </div>`;

  const list = root.querySelector(".lineage-list") as HTMLElement;
  const detail = root.querySelector(".lineage-detail") as HTMLElement;

  const drawList = () => {
    list.innerHTML = "";
    for (const id of LINEAGES) {
      const rec = profile.lineages[id];
      const b = document.createElement("button");
      b.className = `lcard${id === selected ? " sel" : ""}`;
      b.style.setProperty("--lin", UI_LINEAGE_COLORS[id]);
      b.setAttribute("aria-pressed", String(id === selected));
      b.insertAdjacentHTML("beforeend", portraitHtml(id, rec.evolution ?? "", rec.level, "card-art"));
      const info = document.createElement("div");
      info.className = "lcard-info";
      info.innerHTML = `<b>${t(id)}</b><small>${t("level_short")} ${String(rec.level).padStart(2, "0")}</small>`;
      b.appendChild(info);
      b.insertAdjacentHTML("beforeend", `<span class="lcard-check">${icon("check")}</span>`);
      b.onclick = () => {
        selected = id;
        api.setLineage(id).catch(() => {});
        drawList();
        drawDetail();
      };
      list.appendChild(b);
    }
  };

  const drawDetail = () => {
    const rec = profile.lineages[selected];
    const byId = new Map(inv.items.map((i) => [i.id, i]));
    const L = buildLoadout(rec, Object.values(rec.equipment ?? {}).map((id) => byId.get(id!)).filter(Boolean) as any);
    const spec = LINEAGE_SPECS[selected];
    const atCap = rec.level >= PLAYER.levelCap;
    const need = xpToNext(rec.level);
    const unlockEntries = Object.entries(UNLOCKS) as [string, number][];
    const next = unlockEntries.find(([, lvl]) => lvl > rec.level);
    detail.style.setProperty("--lin", UI_LINEAGE_COLORS[selected]);
    detail.innerHTML = `
      <article class="character-overview">
        <div class="portrait-stage">
          <span class="specimen-index" aria-hidden="true">0${LINEAGES.indexOf(selected) + 1}</span>
          <span class="specimen-location">${UI_COPY.station}</span>
          <div class="portrait">${portraitHtml(selected, rec.evolution ?? "", rec.level, "hero-art")}</div>
          <div class="stage-name"><span>${rec.evolution ? t(rec.evolution) : UI_COPY.beginning}</span><span>${t("level_short")} ${String(rec.level).padStart(2, "0")}</span></div>
        </div>
        <div class="character-summary">
          <div class="character-title"><h2>${t(selected)}</h2><span class="level-badge">${t("level_short")} ${rec.level}</span></div>
          <p class="lineage-description">${t(selected + "_desc")}</p>
          <div class="character-stats">
            <span title="${UI_COPY.health}">${icon("shield")}<b>${L.maxHp}</b><small>${UI_COPY.health}</small></span>
            <span title="${UI_COPY.damage}">${icon("sword")}<b>${L.damage.toFixed(1)}</b><small>${UI_COPY.damage}</small></span>
            <span title="${t("fragments")}">${icon("crystal")}<b>${rec.fragments}</b><small>${t("fragments")}</small></span>
          </div>
          <div class="progress-caption"><span>${t("level")} ${rec.level}</span><b>${atCap ? UI_COPY.mastery : `${rec.xp} / ${need} ${t("xp")}`}</b></div>
          <div class="xpbar" role="progressbar" aria-label="${t("xp")}" aria-valuemin="0" aria-valuemax="${atCap ? 100 : need}" aria-valuenow="${atCap ? 100 : rec.xp}"><b style="width:${atCap ? 100 : Math.min(100, (rec.xp / need) * 100)}%"></b></div>
          <p class="small next-unlock">${next ? t("next_unlock", { name: t("unlock_" + next[0]), level: next[1] }) : t("level_cap_note")}</p>
          <div class="growth-track">${[[1, UI_COPY.beginning], [10, t("evolution")], [20, UI_COPY.mastery]].map(([level, name]) => `<span class="${rec.level >= Number(level) ? "reached" : ""}"><i>${String(level).padStart(2, "0")}</i><small>${name}</small></span>`).join("")}</div>
        </div>
      </article>
      <div class="character-loadout">
        <section class="arsenal"></section>
        <section class="ability-section"><h3>${UI_COPY.abilities}</h3>
          <div class="skills">
            <div class="skill"><b>${icon("sword")}</b><span><small>01</small>${t(spec.skill1.id)}</span></div>
            <div class="skill ${L.hasSkill2 ? "" : "locked"}"><b>${icon(L.hasSkill2 ? "shield" : "lock")}</b><span><small>${L.hasSkill2 ? "02" : `${t("level_short")} ${UNLOCKS.skill2}`}</small>${t(spec.skill2.id)}</span></div>
            <div class="skill ${L.hasOverdrive ? "" : "locked"}"><b>${icon(L.hasOverdrive ? "spark" : "lock")}</b><span><small>${L.hasOverdrive ? "OD" : `${t("level_short")} ${UNLOCKS.overdrive}`}</small>${t("unlock_overdrive")}</span></div>
          </div>
        </section>
        <section class="evo"></section>
        <section class="mod"></section>
        <section class="modules"></section>
      </div>`;

    renderArsenal(detail.querySelector(".arsenal") as HTMLElement, profile, selected, inv, (p) => {
      if (p) update(p);
      loadInventory();
    });

    // Evolution (level 10): before/after silhouettes + precise mechanical change.
    const evo = detail.querySelector(".evo") as HTMLElement;
    evo.innerHTML = `<h3>${t("evolution")}</h3>`;
    if (rec.level < UNLOCKS.evolution) {
      evo.innerHTML += `<p class="small">${t("evolution_locked")}</p>`;
    }
    const opts = document.createElement("div");
    opts.className = "evo-opts";
    for (const e of spec.evolutions) {
      const card = document.createElement("div");
      const chosen = rec.evolution === e.id;
      card.className = `evo-card${chosen ? " chosen" : ""}${rec.evolution && !chosen ? " dim" : ""}`;
      const pics = document.createElement("div");
      pics.className = "beforeafter";
      const before = document.createElement("figure");
      before.insertAdjacentHTML("beforeend", portraitHtml(selected, "", 1, "evo-art"));
      before.insertAdjacentHTML("beforeend", `<figcaption>${t("before")}</figcaption>`);
      const after = document.createElement("figure");
      after.insertAdjacentHTML("beforeend", portraitHtml(selected, e.id, Math.max(10, rec.level), "evo-art"));
      after.insertAdjacentHTML("beforeend", `<figcaption>${t("after")}</figcaption>`);
      const arrow = document.createElement("span");
      arrow.className = "evo-arrow";
      arrow.innerHTML = icon("arrow");
      pics.append(before, arrow, after);
      card.appendChild(pics);
      card.insertAdjacentHTML("beforeend", `<b>${t(e.id)}</b><p class="small">${t(e.id + "_desc")}</p>`);
      if (!rec.evolution && rec.level >= UNLOCKS.evolution) {
        const btn = document.createElement("button");
        btn.className = "evo-choose";
        btn.innerHTML = `${t("choose")}${icon("arrow")}`;
        btn.onclick = async () => {
          if (!(await confirmDialog(t("evolution_confirm", { name: t(e.id) })))) return;
          try {
            const r = await api.evolve(selected, e.id);
            update(r.profile);
          } catch (err: any) {
            toast(t("err_" + err.code) || err.code);
          }
        };
        card.appendChild(btn);
      } else if (chosen) card.insertAdjacentHTML("beforeend", `<span class="tag">${icon("check")}${t("chosen")}</span>`);
      opts.appendChild(card);
    }
    evo.appendChild(opts);

    // Modifier (level 15, changeable between missions).
    const mod = detail.querySelector(".mod") as HTMLElement;
    if (rec.level >= UNLOCKS.modifier) {
      mod.innerHTML = `<h3>${t("modifier")}</h3>`;
      for (const m of spec.modifiers) {
        const b = document.createElement("button");
        b.className = `pill${rec.modifier === m.id ? " on" : ""}`;
        b.textContent = t(m.id);
        b.onclick = async () => {
          try {
            update((await api.modifier(selected, m.id)).profile);
          } catch (err: any) {
            toast(t("err_" + err.code));
          }
        };
        mod.appendChild(b);
      }
    }

    // Module slot.
    const mods = detail.querySelector(".modules") as HTMLElement;
    mods.innerHTML = `<h3>${t("module")}</h3>`;
    for (const m of MODULES) {
      const rank = rec.moduleRanks[m.id] ?? 0;
      const row = document.createElement("div");
      row.className = `mrow${rec.moduleEquipped === m.id ? " on" : ""}`;
      row.innerHTML = `<div><b>${t(m.id)}</b> <small>${t("module_rank", { rank })}</small><p class="small">${t(m.id + "_desc")}</p></div>`;
      const btns = document.createElement("div");
      if (rank > 0) {
        const eq = document.createElement("button");
        eq.className = "ghost";
        eq.textContent = rec.moduleEquipped === m.id ? t("equipped") : t("equip");
        eq.disabled = rec.moduleEquipped === m.id;
        eq.onclick = async () => {
          try { update((await api.equipModule(selected, m.id)).profile); }
          catch (err: any) { toast(t("err_" + err.code)); }
        };
        btns.appendChild(eq);
      }
      const up = document.createElement("button");
      if (rank >= MODULE_MAX_RANK) {
        up.textContent = t("max_rank");
        up.disabled = true;
      } else {
        const cost = MODULE_UPGRADE_COST[rank];
        up.textContent = t("upgrade", { cost });
        up.disabled = profile.salvage < cost;
        up.onclick = async () => {
          try {
            update((await api.upgradeModule(selected, m.id)).profile);
          } catch (err: any) {
            toast(t("err_" + err.code));
          }
        };
      }
      btns.appendChild(up);
      row.appendChild(btns);
      mods.appendChild(row);
    }
  };

  const update = (p: ProfileView) => {
    profile = p;
    h.onProfile(p);
    const w = root.querySelector(".wallet")!;
    w.querySelector('[data-wallet="salvage"]')!.textContent = String(p.salvage);
    w.querySelector('[data-wallet="support"]')!.textContent = String(p.supportMarks);
    w.querySelector('[data-wallet="tier"]')!.textContent = `${p.tierUnlocked}/3`;
    drawList();
    drawDetail();
  };

  drawList();
  drawDetail();
  loadInventory();
  root.querySelector<HTMLButtonElement>(".create-btn")!.onclick = () => h.onCreate(selected);
  const input = root.querySelector<HTMLInputElement>(".code-input")!;
  input.oninput = () => (input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, ""));
  const join = () => {
    if (input.value.length === 5) h.onJoin(input.value, selected);
  };
  root.querySelector<HTMLButtonElement>(".join-btn")!.onclick = join;
  input.onkeydown = (e) => {
    if (e.key === "Enter") join();
  };
  root.querySelector<HTMLButtonElement>(".settings-btn")!.onclick = h.onSettings;
  root.querySelectorAll<HTMLButtonElement>(".dev-box").forEach(
    (b) =>
      (b.onclick = async () => {
        try {
          await api.devBox(b.dataset.t!);
          loadInventory();
        } catch (e: any) {
          toast(e.code);
        }
      }),
  );
  root.querySelectorAll<HTMLButtonElement>(".dev-seed").forEach((b) => (b.onclick = () => h.onDevSeed(Number(b.dataset.l))));
}
