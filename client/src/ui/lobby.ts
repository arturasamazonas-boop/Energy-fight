import type { Room } from "@colyseus/sdk";
import { LINEAGES, TIERS, carryMultiplier, type LineageId } from "@ef/shared";
import type { ProfileView } from "../api.ts";
import { t } from "../i18n.ts";
import { esc, toast } from "./dom.ts";
import { brandHtml, icon, portraitHtml, UI_COPY, UI_LINEAGE_COLORS } from "./artwork.ts";

export function renderLobby(root: HTMLElement, room: Room, profile: ProfileView, onLeave: () => void) {
  root.innerHTML = `
    <div class="screen lobby illustrated-screen">
      <header class="lobby-head"><div class="brand">${brandHtml()}</div><button class="ghost leave">${icon("back")}${t("leave")}</button></header>
      <div class="lobby-title"><div><span class="eyebrow">${UI_COPY.missionReady}</span><h1>${t("lobby")}</h1><p>${UI_COPY.lobbyHelp}</p></div>
        <div class="code-box"><span>${t("share_code")}</span><button class="copy-code" title="${UI_COPY.copyCode}" aria-label="${UI_COPY.copyCode}"><b class="code"></b>${icon("copy")}</button></div>
      </div>
      <div class="lobby-body">
        <section class="squad-panel">
          <div class="panel-heading"><h2>${UI_COPY.squad}</h2><span class="pcount"></span></div>
          <div class="plist"></div>
        </section>
        <section class="mission-panel">
          <div class="mission-art"><span class="mission-location">${UI_COPY.station}</span><span class="mission-duration">${UI_COPY.expeditionTime}</span></div>
          <div class="mission-brief"><span class="eyebrow">${UI_COPY.expedition}</span><h2>${UI_COPY.missionName}</h2><p class="small">${UI_COPY.missionDescription}</p></div>
          <div class="tiers"></div>
          <p class="small carry"></p>
          <h3>${t("lineage")}</h3>
          <div class="lpick"></div>
        </section>
      </div>
      <footer class="lobby-actions">
        <button class="ready-btn"></button>
        <p class="small wait"></p>
        <button class="primary start-btn">${t("start")}${icon("arrow")}</button>
      </footer>
    </div>`;
  const $ = (s: string) => root.querySelector(s) as HTMLElement;
  $(".leave").onclick = onLeave;
  $(".copy-code").onclick = async () => {
    const code = (room.state as any)?.code;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      toast(UI_COPY.copied);
    } catch {
      toast(`${t("room_code")}: ${code}`);
    }
  };

  const lpick = $(".lpick");
  for (const id of LINEAGES) {
    const b = document.createElement("button");
    b.className = "lmini";
    b.dataset.id = id;
    b.style.setProperty("--lin", UI_LINEAGE_COLORS[id]);
    b.insertAdjacentHTML("beforeend", portraitHtml(id, profile.lineages[id].evolution ?? "", profile.lineages[id].level, "mini-art"));
    b.insertAdjacentHTML("beforeend", `<b>${t(id)}</b><small>${t("level_short")} ${profile.lineages[id].level}</small>`);
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

  let rosterSignature = "";
  const refresh = () => {
    const st = room.state as any;
    if (!st?.players) return;
    $(".code").textContent = st.code;
    const me = st.players.get(room.sessionId);
    const isLeader = st.leaderId === room.sessionId;
    $(".pcount").textContent = t("players", { n: st.players.size });
    const rows: string[] = [];
    st.players.forEach((p: any, id: string) => {
      rows.push(`<div class="prow${p.connected ? "" : " dc"}${id === room.sessionId ? " is-me" : ""}" style="--lin:${UI_LINEAGE_COLORS[p.lineage as LineageId]}">
        <div class="player-art">${portraitHtml(p.lineage, p.evolution ?? "", p.level, "roster-art")}</div>
        <div class="player-info"><b>${esc(p.name)}${id === room.sessionId ? `<small class="you-tag">${UI_COPY.you}</small>` : ""}</b><span>${t(p.lineage)} · ${t("level_short")} ${p.level}</span>
          <div class="player-badges">${st.leaderId === id ? `<em class="lead">${t("leader")}</em>` : ""}<em class="${p.ready ? "ok" : "no"}">${p.ready ? icon("check") : ""}${p.ready ? t("ready") : t("not_ready")}</em></div>
        </div></div>`);
    });
    for (let i = st.players.size; i < 8; i++) {
      rows.push(`<div class="prow empty-slot"><span class="slot-mark">${icon("plus")}</span><div><b>${UI_COPY.openSlot}</b><span>0${i + 1}</span></div></div>`);
    }
    const nextRoster = rows.join("");
    if (nextRoster !== rosterSignature) {
      $(".plist").innerHTML = nextRoster;
      rosterSignature = nextRoster;
    }
    tiers.querySelectorAll<HTMLButtonElement>(".tier").forEach((b) => {
      const tier = Number(b.dataset.tier);
      b.classList.toggle("on", st.tier === tier);
      b.setAttribute("aria-pressed", String(st.tier === tier));
      const locked = !isLeader || tier > (me?.tierUnlocked ?? 1);
      b.disabled = locked && st.tier !== tier;
      if (tier > (me?.tierUnlocked ?? 1) && isLeader) b.title = t("tier_locked");
    });
    lpick.querySelectorAll<HTMLButtonElement>(".lmini").forEach((b) => {
      b.classList.toggle("on", b.dataset.id === me?.lineage);
      b.setAttribute("aria-pressed", String(b.dataset.id === me?.lineage));
    });
    const ts = TIERS.find((x) => x.tier === st.tier)!;
    if (me) $(".carry").textContent = t("carry_hint", { mult: carryMultiplier(ts.recommendedLevel, me.level).toFixed(2) });
    $(".ready-btn").innerHTML = `${icon("check")}${me?.ready ? t("unset_ready") : t("set_ready")}`;
    $(".ready-btn").classList.toggle("on", !!me?.ready);
    $(".start-btn").style.display = isLeader ? "" : "none";
    $(".wait").textContent = isLeader ? "" : t("waiting_leader");
  };
  refresh();
  return refresh;
}
