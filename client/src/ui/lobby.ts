import type { Room } from "@colyseus/sdk";
import { LINEAGES, TIERS, carryMultiplier, type LineageId } from "@ef/shared";
import type { ProfileView } from "../api.ts";
import { LINEAGE_COLORS, lineagePortrait } from "../game/art.ts";
import { t } from "../i18n.ts";
import { esc } from "./dom.ts";

export function renderLobby(root: HTMLElement, room: Room, profile: ProfileView, onLeave: () => void) {
  root.innerHTML = `
    <div class="screen lobby">
      <header><h1>${t("lobby")}</h1><button class="ghost leave">${t("leave")}</button></header>
      <div class="code-box"><span>${t("share_code")}</span><b class="code"></b></div>
      <div class="lobby-body">
        <div class="col">
          <h3 class="pcount"></h3>
          <div class="plist"></div>
        </div>
        <div class="col">
          <h3>${t("mission")}</h3>
          <div class="tiers"></div>
          <p class="small carry"></p>
          <h3>${t("lineage")}</h3>
          <div class="lpick"></div>
        </div>
      </div>
      <footer class="lobby-actions">
        <button class="ready-btn"></button>
        <button class="primary start-btn">${t("start")}</button>
        <p class="small wait"></p>
      </footer>
    </div>`;
  const $ = (s: string) => root.querySelector(s) as HTMLElement;
  $(".leave").onclick = onLeave;

  const lpick = $(".lpick");
  for (const id of LINEAGES) {
    const b = document.createElement("button");
    b.className = "lmini";
    b.dataset.id = id;
    b.style.setProperty("--lin", LINEAGE_COLORS[id].glow);
    b.appendChild(lineagePortrait(id, profile.lineages[id].evolution ?? "", false, 48));
    b.insertAdjacentHTML("beforeend", `<small>${t(id)} ${profile.lineages[id].level}</small>`);
    b.onclick = () => room.send("lineage", { lineage: id });
    lpick.appendChild(b);
  }
  const tiers = $(".tiers");
  for (const ts of TIERS) {
    const b = document.createElement("button");
    b.className = "tier";
    b.dataset.tier = String(ts.tier);
    b.innerHTML = `<b>${t("mission_tier", { tier: ts.tier })}</b><small>${t("recommended", { level: ts.recommendedLevel })}</small>`;
    b.onclick = () => room.send("tier", { tier: ts.tier });
    tiers.appendChild(b);
  }
  $(".ready-btn").onclick = () => {
    const me = (room.state as any).players.get(room.sessionId);
    room.send("ready", { ready: !me?.ready });
  };
  $(".start-btn").onclick = () => room.send("start");

  const refresh = () => {
    const st = room.state as any;
    if (!st?.players) return;
    $(".code").textContent = st.code;
    const me = st.players.get(room.sessionId);
    const isLeader = st.leaderId === room.sessionId;
    $(".pcount").textContent = t("players", { n: st.players.size });
    const rows: string[] = [];
    st.players.forEach((p: any, id: string) => {
      rows.push(`<div class="prow${p.connected ? "" : " dc"}" style="--lin:${LINEAGE_COLORS[p.lineage as LineageId]?.glow}">
        <i></i><b>${esc(p.name)}</b><span>${t(p.lineage)} · ${t("level_short")} ${p.level}</span>
        ${st.leaderId === id ? `<em class="lead">${t("leader")}</em>` : ""}
        <em class="${p.ready ? "ok" : "no"}">${p.ready ? t("ready") : t("not_ready")}</em></div>`);
    });
    $(".plist").innerHTML = rows.join("");
    tiers.querySelectorAll<HTMLButtonElement>(".tier").forEach((b) => {
      const tier = Number(b.dataset.tier);
      b.classList.toggle("on", st.tier === tier);
      const locked = !isLeader || tier > (me?.tierUnlocked ?? 1);
      b.disabled = locked && st.tier !== tier;
      if (tier > (me?.tierUnlocked ?? 1) && isLeader) b.title = t("tier_locked");
    });
    lpick.querySelectorAll<HTMLButtonElement>(".lmini").forEach((b) => b.classList.toggle("on", b.dataset.id === me?.lineage));
    const ts = TIERS.find((x) => x.tier === st.tier)!;
    if (me) $(".carry").textContent = t("carry_hint", { mult: carryMultiplier(ts.recommendedLevel, me.level).toFixed(2) });
    $(".ready-btn").textContent = me?.ready ? t("unset_ready") : t("set_ready");
    $(".ready-btn").classList.toggle("on", !!me?.ready);
    $(".start-btn").style.display = isLeader ? "" : "none";
    $(".wait").textContent = isLeader ? "" : t("waiting_leader");
  };
  refresh();
  return refresh;
}
