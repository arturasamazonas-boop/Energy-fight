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
import { lineagePortrait, LINEAGE_COLORS } from "../game/art.ts";
import { t } from "../i18n.ts";
import { esc, toast, confirmDialog } from "./dom.ts";

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
  root.innerHTML = `
    <div class="screen lab">
      <header class="lab-head">
        <div><h1>${t("title")}</h1><div class="sub">${t("lab")} · ${esc(profile.name)}</div></div>
        <div class="wallet">
          <span title="${t("salvage")}">⚙ ${profile.salvage}</span>
          <span title="${t("support_marks")}">♥ ${profile.supportMarks}</span>
          <span title="${t("tiers")}">▲ ${profile.tierUnlocked}/3</span>
          <button class="ghost settings-btn">⚙ ${t("settings")}</button>
        </div>
      </header>
      ${message ? `<div class="notice">${esc(message)}</div>` : ""}
      <footer class="lab-actions">
        <button class="primary create-btn">${t("create_room")}</button>
        <div class="join-row">
          <input class="code-input" maxlength="5" autocomplete="off" autocapitalize="characters" placeholder="${t("room_code")}" />
          <button class="join-btn">${t("join_room")}</button>
        </div>
      </footer>
      <div class="lab-body">
        <div class="lineage-list"></div>
        <div class="lineage-detail"></div>
      </div>

      ${h.devTools ? `<details class="dev"><summary>${t("dev_tools")}</summary>${[1, 9, 18].map((l) => `<button class="ghost dev-seed" data-l="${l}">${t("dev_seed", { level: l })}</button>`).join("")}</details>` : ""}
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
      b.style.setProperty("--lin", LINEAGE_COLORS[id].glow);
      b.appendChild(lineagePortrait(id, rec.evolution ?? "", rec.level >= UNLOCKS.mastery, 72));
      const info = document.createElement("div");
      info.innerHTML = `<b>${t(id)}</b><small>${t("level_short")} ${rec.level}${rec.evolution ? " · " + t(rec.evolution) : ""}</small>`;
      b.appendChild(info);
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
    const L = buildLoadout(rec);
    const spec = LINEAGE_SPECS[selected];
    const atCap = rec.level >= PLAYER.levelCap;
    const need = xpToNext(rec.level);
    const unlockEntries = Object.entries(UNLOCKS) as [string, number][];
    const next = unlockEntries.find(([, lvl]) => lvl > rec.level);
    detail.innerHTML = `
      <div class="dhead" style="--lin:${LINEAGE_COLORS[selected].glow}">
        <div class="portrait"></div>
        <div>
          <h2>${t(selected)} <small>${t("level")} ${rec.level}</small></h2>
          <p>${t(selected + "_desc")}</p>
          <div class="xpbar"><b style="width:${atCap ? 100 : (rec.xp / need) * 100}%"></b><span>${atCap ? t("level_cap_note") : `${rec.xp}/${need} ${t("xp")}`}</span></div>
          <p class="small">${next ? t("next_unlock", { name: t("unlock_" + next[0]), level: next[1] }) : t("all_unlocked")}</p>
          <p class="small">♥ ${L.maxHp} · ⚔ ${L.damage.toFixed(1)} · ${t("fragments")}: ${rec.fragments}</p>
        </div>
      </div>
      <div class="skills">
        <div class="skill"><b>1</b> ${t(spec.skill1.id)}</div>
        <div class="skill ${L.hasSkill2 ? "" : "locked"}"><b>2</b> ${t(spec.skill2.id)} ${L.hasSkill2 ? "" : `🔒 ${UNLOCKS.skill2}`}</div>
        <div class="skill ${L.hasOverdrive ? "" : "locked"}"><b>OD</b> ${t("unlock_overdrive")} ${L.hasOverdrive ? "" : `🔒 ${UNLOCKS.overdrive}`}</div>
      </div>
      <section class="evo"></section>
      <section class="mod"></section>
      <section class="modules"></section>`;
    detail.querySelector(".portrait")!.appendChild(lineagePortrait(selected, rec.evolution ?? "", rec.level >= UNLOCKS.mastery, 112));

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
      before.appendChild(lineagePortrait(selected, "", false, 64, true));
      before.insertAdjacentHTML("beforeend", `<figcaption>${t("before")}</figcaption>`);
      const after = document.createElement("figure");
      after.appendChild(lineagePortrait(selected, e.id, false, 64, true));
      after.insertAdjacentHTML("beforeend", `<figcaption>${t("after")}</figcaption>`);
      pics.append(before, after);
      card.appendChild(pics);
      card.insertAdjacentHTML("beforeend", `<b>${t(e.id)}</b><p class="small">${t(e.id + "_desc")}</p>`);
      if (!rec.evolution && rec.level >= UNLOCKS.evolution) {
        const btn = document.createElement("button");
        btn.textContent = t("choose");
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
      } else if (chosen) card.insertAdjacentHTML("beforeend", `<span class="tag">${t("chosen")}</span>`);
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
        eq.onclick = async () => update((await api.equipModule(selected, m.id)).profile);
        btns.appendChild(eq);
      }
      const up = document.createElement("button");
      if (rank >= MODULE_MAX_RANK) {
        up.textContent = t("max_rank");
        up.disabled = true;
      } else {
        const cost = MODULE_UPGRADE_COST[rank];
        up.textContent = t("upgrade", { cost: `⚙${cost}` });
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
    w.querySelectorAll("span")[0].textContent = `⚙ ${p.salvage}`;
    w.querySelectorAll("span")[1].textContent = `♥ ${p.supportMarks}`;
    w.querySelectorAll("span")[2].textContent = `▲ ${p.tierUnlocked}/3`;
    drawList();
    drawDetail();
  };

  drawList();
  drawDetail();
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
  root.querySelectorAll<HTMLButtonElement>(".dev-seed").forEach((b) => (b.onclick = () => h.onDevSeed(Number(b.dataset.l))));
}
