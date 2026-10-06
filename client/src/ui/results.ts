import type { ResultsMsg } from "@ef/shared";
import { t } from "../i18n.ts";
import { esc } from "./dom.ts";
import { crateBadgeHtml, revealBox } from "./loot.ts";
import { api } from "../api.ts";
import { brandHtml, icon, portraitHtml, UI_COPY, UI_LINEAGE_COLORS } from "./artwork.ts";

export function renderResults(root: HTMLElement, res: ResultsMsg, myId: string, onBack: () => void, evolutions: ReadonlyMap<string, string> = new Map()) {
  // Team completion first; players are not ranked by damage.
  const cards = res.players
    .map((p) => {
      const color = UI_LINEAGE_COLORS[p.lineage];
      const missed = p.sections.filter((s) => !s.eligible).map((s) => `<li class="warn">${t("results_not_eligible", { n: s.sectionId })}</li>`);
      const carry = p.carryMult > 1 ? `<span class="carry">${t("results_carry", { mult: p.carryMult.toFixed(2) })}</span>` : "";
      const pending = p.pendingUnlocks.length ? `<li class="pending">${t("results_pending", { list: p.pendingUnlocks.map((u) => t("unlock_" + u)).join(", ") })}</li>` : "";
      return `<article class="rcard${p.id === myId ? " me" : ""}" style="--lin:${color}">
        <div class="result-character">${portraitHtml(p.lineage, evolutions.get(p.id) ?? "", p.levelNow, "result-art")}<span>${t(p.lineage)}</span></div>
        <div class="result-detail">
        <h3>${esc(p.name)}${p.id === myId ? `<small class="you-tag">${UI_COPY.you}</small>` : ""}${p.departed ? ` <em>${t("results_departed")}</em>` : ""}</h3>
        <div class="big">${t("results_xp", { xp: p.totalXp })}</div>${carry}
        <div class="result-level">${p.levelNow >= 20 && p.levelAtStart >= 20 ? t("level_cap_note") : t("results_level", { from: p.levelAtStart, to: p.levelNow })}</div>
        <ul>
          ${p.box ? `<li class="result-box">${crateBadgeHtml(p.box.tier)}${p.box.daily ? `<span class="daily-badge">☀ ${t("daily_title")}</span>` : ""} <small>${t("box_impact", { n: p.box.impact.toFixed(2) })}</small>${p.id === myId ? ` <button class="primary open-box">${t("box_open")}</button>` : ""}</li>` : p.id === myId && res.success ? `<li class="dim">${t("box_none")}</li>` : ""}
          ${pending}
          ${p.supportMark ? `<li class="support">${icon("support")}${t("results_support")}</li>` : ""}
          <li class="result-currencies"><span title="${t("help_scrap_desc")}">${icon("salvage")}${t("salvage")} +${p.totalSalvage}</span></li>
          <li>${t("results_revives", { n: p.revives })} · ${t("results_control", { n: p.controlSeconds })} · ${t("results_objective", { n: p.objectiveSeconds })}</li>
          <li class="dim">${t("results_damage", { n: p.damage })} · ${t("results_stagger", { n: p.stagger })}</li>
          ${missed.join("")}
        </ul></div>
      </article>`;
    })
    .join("");
  root.innerHTML = `
    <div class="screen results illustrated-screen ${res.success ? "win" : "fail"}">
      <header class="results-head"><div class="brand">${brandHtml()}</div><span class="eyebrow">${UI_COPY.station}</span></header>
      <div class="results-banner"><div class="result-insignia">${icon(res.success ? "check" : "shield")}</div><div><span class="eyebrow">${UI_COPY.missionComplete}</span><h1>${res.success ? t("results_win") : t("results_fail")}</h1>
      ${res.success ? "" : `<p>${t("results_fail_note")}</p>`}
      <p>${t("mission_" + (res.mission || "brood"))} · ${t("mission_tier", { tier: res.tier })} · ${Math.floor(res.durationSec / 60)}:${String(res.durationSec % 60).padStart(2, "0")}</p></div></div>
      <div class="rgrid">${cards}</div>
      <footer class="results-footer"><p class="small">${icon("check")}${t("results_saved")}</p><button class="primary back">${t("back_to_lab")}${icon("arrow")}</button></footer>
    </div>`;
  (root.querySelector(".back") as HTMLButtonElement).onclick = onBack;
  const open = root.querySelector(".open-box") as HTMLButtonElement | null;
  if (open) {
    open.onclick = async () => {
      open.disabled = true;
      // The crate is persisted asynchronously at boss death; retry briefly if it is not there yet.
      for (let i = 0; i < 6; i++) {
        try {
          const { box } = await api.openBox(res.runId);
          await revealBox(box);
          open.textContent = t("box_opened");
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 700));
        }
      }
      open.disabled = false;
    };
  }
}
