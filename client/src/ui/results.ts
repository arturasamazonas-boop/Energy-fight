import type { ResultsMsg } from "@ef/shared";
import { LINEAGE_COLORS } from "../game/art.ts";
import { t } from "../i18n.ts";
import { esc } from "./dom.ts";

export function renderResults(root: HTMLElement, res: ResultsMsg, myId: string, onBack: () => void) {
  // Team completion first; players are not ranked by damage.
  const cards = res.players
    .map((p) => {
      const color = LINEAGE_COLORS[p.lineage]?.glow ?? "#fff";
      const missed = p.sections.filter((s) => !s.eligible).map((s) => `<li class="warn">${t("results_not_eligible", { n: s.sectionId })}</li>`);
      const carry = p.carryMult > 1 ? `<span class="carry">${t("results_carry", { mult: p.carryMult.toFixed(2) })}</span>` : "";
      const pending = p.pendingUnlocks.length ? `<li class="pending">${t("results_pending", { list: p.pendingUnlocks.map((u) => t("unlock_" + u)).join(", ") })}</li>` : "";
      return `<div class="rcard${p.id === myId ? " me" : ""}" style="--lin:${color}">
        <h3>${esc(p.name)} <small>${t(p.lineage)}</small>${p.departed ? ` <em>${t("results_departed")}</em>` : ""}</h3>
        <div class="big">${t("results_xp", { xp: p.totalXp })} ${carry}</div>
        <div>${p.levelNow >= 20 && p.levelAtStart >= 20 ? t("level_cap_note") : t("results_level", { from: p.levelAtStart, to: p.levelNow })}</div>
        <ul>
          ${pending}
          ${p.supportMark ? `<li class="support">♥ ${t("results_support")}</li>` : ""}
          <li>⚙ ${p.totalSalvage} · ◆ ${p.totalFragments}</li>
          <li>${t("results_revives", { n: p.revives })} · ${t("results_control", { n: p.controlSeconds })} · ${t("results_objective", { n: p.objectiveSeconds })}</li>
          <li class="dim">${t("results_damage", { n: p.damage })} · ${t("results_stagger", { n: p.stagger })}</li>
          ${missed.join("")}
        </ul>
      </div>`;
    })
    .join("");
  root.innerHTML = `
    <div class="screen results ${res.success ? "win" : "fail"}">
      <h1>${res.success ? t("results_win") : t("results_fail")}</h1>
      ${res.success ? "" : `<p>${t("results_fail_note")}</p>`}
      <p class="small">${t("mission_tier", { tier: res.tier })} · ${Math.floor(res.durationSec / 60)}:${String(res.durationSec % 60).padStart(2, "0")} · ${t("results_saved")}</p>
      <div class="rgrid">${cards}</div>
      <button class="primary back">${t("back_to_lab")}</button>
    </div>`;
  (root.querySelector(".back") as HTMLButtonElement).onclick = onBack;
}
