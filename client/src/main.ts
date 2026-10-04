import "./styles.css";
import Phaser from "phaser";
import type { Room } from "@colyseus/sdk";
import type { LineageId, ResultsMsg } from "@ef/shared";
import { api, clearToken, getToken, setToken, type ProfileView } from "./api.ts";
import { BattleScene } from "./game/BattleScene.ts";
import { Controls } from "./game/controls.ts";
import { Hud } from "./game/hud.ts";
import { applyVolume, unlockAudio, sfx } from "./game/audio.ts";
import { errorText, t } from "./i18n.ts";
import { clearReconnect, createRoom, errorCode, joinRoom, loadReconnect, reconnect, saveReconnect } from "./net.ts";
import { saveSettings, settings } from "./settings.ts";
import { esc, modal, toast } from "./ui/dom.ts";
import { renderLab } from "./ui/lab.ts";
import { renderLobby } from "./ui/lobby.ts";
import { renderResults } from "./ui/results.ts";

const ui = document.getElementById("ui")!;
const stage = document.getElementById("stage")!;

let profile: ProfileView | null = null;
let devTools = false;
let room: Room | null = null;
let leaving = false;
let game: Phaser.Game | null = null;
let hud: Hud | null = null;
let controls: Controls | null = null;
let lobbyRefresh: (() => void) | null = null;
let lastResults: ResultsMsg | null = null;

// Expose a tiny read-only hook for automated browser checks.
(window as any).__ef = { get room() { return room; }, get phase() { return (room?.state as any)?.phase; } };

window.addEventListener("pointerdown", () => unlockAudio(), { once: true });

async function boot() {
  ui.innerHTML = `<div class="screen center"><h1>${t("title")}</h1><p>${t("loading")}</p></div>`;
  try {
    devTools = (await api.config()).devTools;
  } catch {
    devTools = false;
  }
  if (!getToken()) return askName();
  try {
    profile = (await api.profile()).profile;
  } catch (e: any) {
    if (e.code === "invalid_credential") {
      clearToken();
      return askName();
    }
    return showError(errorText(e.code));
  }
  const info = loadReconnect();
  if (info) {
    try {
      const r = await reconnect(info);
      return enterRoom(r);
    } catch {
      clearReconnect();
      return showLab(t("room_gone"));
    }
  }
  showLab();
}

function showError(msg: string) {
  ui.innerHTML = `<div class="screen center"><h1>${t("title")}</h1><p class="notice">${esc(msg)}</p><button class="primary retry">${t("continue")}</button></div>`;
  (ui.querySelector(".retry") as HTMLButtonElement).onclick = () => boot();
}

function askName() {
  ui.innerHTML = `
    <div class="screen center intro">
      <h1>${t("title")}</h1><p class="sub">${t("subtitle")}</p>
      <label>${t("name_prompt")}</label>
      <input class="name" maxlength="16" placeholder="${t("name_placeholder")}" />
      <button class="primary go">${t("continue")}</button>
      <p class="fine">${t("guest_note")}</p>
    </div>`;
  const input = ui.querySelector(".name") as HTMLInputElement;
  const go = async () => {
    try {
      const r = await api.createGuest(input.value || "Žaidėjas");
      setToken(r.token);
      profile = r.profile;
      showLab();
    } catch (e: any) {
      toast(errorText(e.code));
    }
  };
  (ui.querySelector(".go") as HTMLButtonElement).onclick = go;
  input.onkeydown = (e) => {
    if (e.key === "Enter") go();
  };
  input.focus();
}

async function showLab(message?: string) {
  teardownGame();
  room = null;
  lobbyRefresh = null;
  document.body.classList.remove("in-game");
  try {
    profile = (await api.profile()).profile;
  } catch {}
  if (!profile) return askName();
  renderLab(ui, profile, {
    devTools,
    onProfile: (p) => (profile = p),
    onSettings: openSettings,
    onCreate: (lineage) => connect(() => createRoom(lineage)),
    onJoin: (code, lineage) => connect(() => joinRoom(code, lineage)),
    onDevSeed: async (level) => {
      try {
        const r = await api.devSeed(level);
        setToken(r.token);
        profile = r.profile;
        toast(`${r.profile.name}`);
        showLab();
      } catch (e: any) {
        toast(errorText(e.code));
      }
    },
  }, message);
}

async function connect(fn: () => Promise<Room>) {
  unlockAudio();
  try {
    enterRoom(await fn());
  } catch (e) {
    toast(errorText(errorCode(e)), 3500);
  }
}

function enterRoom(r: Room) {
  room = r;
  leaving = false;
  lastResults = null;
  saveReconnect(r);
  r.onMessage("error", (m: any) => toast(errorText(m?.code ?? "?")));
  r.onMessage("rejected", () => {});
  r.onMessage("reward", () => {});
  r.onMessage("pong", () => {});
  r.onMessage("fx", () => {});
  r.onMessage("deny", () => {});
  r.onMessage("results", (res: ResultsMsg) => {
    lastResults = res;
    clearReconnect();
    teardownGame();
    document.body.classList.remove("in-game");
    renderResults(ui, res, r.sessionId, () => leaveRoom());
  });
  r.onDrop?.(() => {
    controls?.releaseAll();
    hud?.connection(t("disconnected"));
  });
  r.onReconnect?.(() => {
    controls?.releaseAll();
    hud?.connection(null);
    toast(t("reconnected"));
    saveReconnect(r);
  });
  r.onLeave(() => {
    if (leaving) return;
    // Lost for good (reconnection window expired or room gone).
    clearReconnect();
    if (!lastResults) showLab(t("room_gone"));
  });
  r.onStateChange(() => route());
  route();
}

function route() {
  if (!room || lastResults) return;
  const phase = (room.state as any)?.phase;
  if (!phase) return;
  if (phase === "lobby" || phase === "starting") {
    if (!lobbyRefresh) lobbyRefresh = renderLobby(ui, room, profile!, () => leaveRoom());
    else lobbyRefresh();
  } else if (phase === "running") {
    lobbyRefresh = null;
    const me = (room.state as any).players.get(room.sessionId);
    if (!me) {
      // Our seat did not make it into the run.
      leaveRoom(t("room_gone"));
      return;
    }
    if (!game) startGame();
  }
}

function startGame() {
  if (!room) return;
  ui.innerHTML = "";
  document.body.classList.add("in-game");
  sfx("section");
  hud = new Hud(stage);
  controls = new Controls(stage);
  hud.onMenu = openMenu;
  const holder = document.createElement("div");
  holder.className = "canvas-holder";
  stage.prepend(holder);
  const dpr = Math.min(settings.reducedEffects ? 1 : 2, window.devicePixelRatio || 1);
  const w = window.innerWidth;
  const h = window.innerHeight;
  game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: holder,
    width: Math.round(w * dpr),
    height: Math.round(h * dpr),
    backgroundColor: "#07090c",
    scale: { mode: Phaser.Scale.NONE, zoom: 1 / dpr },
    input: { keyboard: false, mouse: false, touch: false, gamepad: false },
    render: { antialias: true, powerPreference: "high-performance" },
    banner: false,
    audio: { noAudio: true },
  } as Phaser.Types.Core.GameConfig);
  game.registry.set("dpr", dpr);
  game.scene.add("battle", BattleScene, true, { room, hud, controls });
  const onResize = () => {
    if (!game) return;
    game.scale.resize(Math.round(window.innerWidth * dpr), Math.round(window.innerHeight * dpr));
    game.scale.setZoom(1 / dpr);
    (game.scene.getScene("battle") as BattleScene | null)?.resize();
  };
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", onResize);
  (game as any).__onResize = onResize;
}

function teardownGame() {
  if (game) {
    const r = (game as any).__onResize;
    window.removeEventListener("resize", r);
    window.removeEventListener("orientationchange", r);
    game.destroy(true);
    game = null;
  }
  hud?.destroy();
  hud = null;
  controls?.destroy();
  controls = null;
  stage.querySelectorAll(".canvas-holder").forEach((e) => e.remove());
}

function leaveRoom(message?: string) {
  leaving = true;
  clearReconnect();
  const r = room;
  room = null;
  r?.leave(true).catch(() => {});
  showLab(message);
}

function openMenu() {
  const d = modal(`
    <h3>${t("settings")}</h3>
    ${settingsHtml()}
    <div class="row"><button class="ghost fs">⛶</button><button class="danger leave">${t("leave")}</button><button class="primary close">${t("close")}</button></div>`);
  bindSettings(d);
  d.querySelector<HTMLButtonElement>(".close")!.onclick = () => d.remove();
  d.querySelector<HTMLButtonElement>(".leave")!.onclick = () => {
    d.remove();
    leaveRoom();
  };
  d.querySelector<HTMLButtonElement>(".fs")!.onclick = () => {
    const el = document.documentElement as any;
    if (!document.fullscreenElement) el.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.();
  };
}

function settingsHtml() {
  return `
    <label class="set">${t("volume")} <input type="range" class="vol" min="0" max="1" step="0.05" value="${settings.volume}"></label>
    <label class="set"><input type="checkbox" class="rm" ${settings.reducedMotion ? "checked" : ""}> ${t("reduced_motion")}</label>
    <label class="set"><input type="checkbox" class="re" ${settings.reducedEffects ? "checked" : ""}> ${t("reduced_effects")}</label>
    <h4>${t("controls")}</h4><p class="small">${t("touch_help")}</p><p class="small">${t("keys_help")}</p>`;
}

function bindSettings(d: HTMLElement) {
  const vol = d.querySelector<HTMLInputElement>(".vol")!;
  vol.oninput = () => {
    settings.volume = Number(vol.value);
    applyVolume();
    saveSettings();
  };
  d.querySelector<HTMLInputElement>(".rm")!.onchange = (e) => {
    settings.reducedMotion = (e.target as HTMLInputElement).checked;
    saveSettings();
  };
  d.querySelector<HTMLInputElement>(".re")!.onchange = (e) => {
    settings.reducedEffects = (e.target as HTMLInputElement).checked;
    saveSettings();
  };
}

function openSettings() {
  const d = modal(`<h3>${t("settings")}</h3>${settingsHtml()}<div class="row"><button class="primary close">${t("close")}</button></div>`);
  bindSettings(d);
  d.querySelector<HTMLButtonElement>(".close")!.onclick = () => d.remove();
}

// Prevent pinch-zoom / double-tap zoom / page scroll while playing.
document.addEventListener("gesturestart", (e) => e.preventDefault());
document.addEventListener("touchmove", (e) => {
  if (document.body.classList.contains("in-game")) e.preventDefault();
}, { passive: false });

export type { LineageId };
boot();
