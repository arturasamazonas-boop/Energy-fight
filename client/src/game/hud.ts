// Painted HUD: display-only, updated at a bounded cadence by BattleScene.
import { t } from "../i18n.ts";
import { actionGlyph, lineagePortrait, LINEAGE_COLORS } from "./art.ts";
import type { LineageId } from "@ef/shared";
import "./interface.css";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
interface TeammateView { root: HTMLElement; name: HTMLElement; status: HTMLElement; bar: HTMLElement; lineage: string }

export class Hud {
  readonly root: HTMLElement;
  private els: Record<string, HTMLElement> = {};
  private bars = new Map<string, HTMLElement>();
  private teammates = new Map<string, TeammateView>();
  private bannerTimer: number | undefined;
  private selfSignature = "";
  private portraitSignature = "";
  onMenu: () => void = () => {};

  constructor(parent: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "hud illustrated-hud";
    this.root.innerHTML = `
      <div class="hud-self">
        <div class="hud-portrait"></div>
        <div class="hud-self-content"><div class="hud-name"></div>
          <div class="bar hp"><b></b><s></s><em></em></div>
          <div class="bar od"><b></b></div>
        </div>
      </div>
      <div class="hud-obj">
        <div class="hud-eyebrow"><span>NEXUS</span><span class="hud-section">01 / 03</span></div>
        <div class="obj-text"></div>
        <div class="bar obj"><b></b></div>
        <div class="boss hidden"><div class="boss-name">${t("boss_name")}</div><div class="bar bosshp"><b></b></div><div class="bar stag"><b></b></div></div>
      </div>
      <div class="hud-team"><div class="hud-team-count"></div><div class="team-members"></div></div>
      <button class="hud-menu" aria-label="${t("menu")}">${actionGlyph("menu")}</button>
      <div class="hud-chain hidden"><b class="chain-n">0</b><span class="chain-label"></span><em class="chain-bonus"></em><i class="chain-timer"><u></u></i></div>
      <div class="hud-banner hidden"></div>
      <div class="hud-clear hidden"><span class="clear-text"></span></div>
      <div class="hud-down hidden"><div class="down-skull">✖</div><div class="down-title"></div><div class="down-timer"></div><div class="bar revive"><b></b></div><div class="down-sub"></div></div>
      <div class="hud-end hidden"><div class="end-title"></div><div class="end-sub"></div></div>
      <div class="hud-conn hidden"></div>
      <div class="hud-loading"><div class="loading-sigil"></div><span>${t("loading")}</span><div class="bar loading"><b></b></div></div>
      <div class="vignette"></div>`;
    parent.appendChild(this.root);
    for (const key of ["hud-name", "hud-portrait", "hud-team", "hud-team-count", "team-members", "hud-section", "obj-text", "boss", "hud-banner", "hud-clear", "clear-text", "hud-chain", "chain-n", "chain-label", "chain-bonus", "hud-down", "down-title", "down-sub", "down-timer", "hud-end", "end-title", "end-sub", "hud-conn", "hud-loading", "vignette"]) {
      this.els[key] = this.root.querySelector("." + key)!;
    }
    for (const key of ["hp", "od", "obj", "bosshp", "stag", "revive", "loading"]) this.bars.set(key, this.root.querySelector(`.bar.${key} b`)!);
    this.root.querySelector(".hud-menu")!.addEventListener("click", () => this.onMenu());
  }

  private bar(key: string, ratio: number) {
    const bar = this.bars.get(key);
    if (!bar) return;
    const width = `${Math.round(Math.max(0, Math.min(1, ratio)) * 1000) / 10}%`;
    if (bar.style.width !== width) bar.style.width = width;
  }

  setLoading(progress: number) {
    this.bar("loading", progress);
    this.els["hud-loading"].classList.toggle("hidden", progress >= 1);
  }

  updateSelf(p: { name: string; lineage: string; evolution?: string; level: number; hp: number; maxHp: number; shield: number; od: number; odT: number; hasOverdrive: boolean; mastery: boolean }) {
    const color = LINEAGE_COLORS[p.lineage as LineageId]?.glow ?? "#fff";
    const signature = `${p.name}|${p.lineage}|${p.level}|${p.mastery}`;
    if (signature !== this.selfSignature) {
      this.selfSignature = signature;
      this.root.style.setProperty("--lin", color);
      this.els["hud-name"].innerHTML = `<span class="hud-player-name">${esc(p.name)}</span><span class="hud-level">${t("level_short")} ${p.level}${p.mastery ? " ✦" : ""}</span><small>${t(p.lineage)}</small>`;
    }
    const portraitSignature = `${p.lineage}.${p.evolution ?? ""}.${p.mastery}`;
    if (portraitSignature !== this.portraitSignature) {
      this.portraitSignature = portraitSignature;
      this.els["hud-portrait"].replaceChildren(lineagePortrait(p.lineage as LineageId, p.evolution ?? "", p.mastery, 62));
    }
    this.bar("hp", p.hp / Math.max(1, p.maxHp));
    const shield = this.root.querySelector(".bar.hp s") as HTMLElement;
    shield.style.width = `${Math.min(1, p.shield / Math.max(1, p.maxHp)) * 100}%`;
    const healthText = `${Math.max(0, Math.round(p.hp))} / ${p.maxHp}`;
    const health = this.root.querySelector(".bar.hp em") as HTMLElement;
    if (health.textContent !== healthText) health.textContent = healthText;
    const overdrive = this.root.querySelector(".bar.od") as HTMLElement;
    overdrive.classList.toggle("hidden", !p.hasOverdrive);
    overdrive.classList.toggle("full", p.od >= 100 || p.odT > 0);
    this.bar("od", p.odT > 0 ? p.odT / 15 : p.od / 100);
  }

  updateObjective(stage: string, objective: number, boss: { hp: number; maxHp: number; stagger: number; name?: string; shielded?: boolean } | null) {
    const title = t(`obj_${stage}`);
    if (this.els["obj-text"].textContent !== title) this.els["obj-text"].textContent = title;
    this.els["hud-section"].textContent = `0${stage.match(/^s(\d)/)?.[1] ?? "3"} / 03`;
    this.bar("obj", objective / 100);
    this.els["boss"].classList.toggle("hidden", !boss);
    if (boss) {
      this.bar("bosshp", boss.hp / Math.max(1, boss.maxHp));
      this.bar("stag", boss.stagger);
      const nameEl = this.root.querySelector(".boss-name") as HTMLElement;
      const label = boss.shielded ? `${boss.name ?? t("boss_name")} · ${t("boss_shielded")}` : boss.name ?? t("boss_name");
      if (nameEl.textContent !== label) nameEl.textContent = label;
      this.els["boss"].classList.toggle("shielded", !!boss.shielded);
    }
  }

  updateTeam(list: { id: string; name: string; lineage: string; hp: number; maxHp: number; life: string; connected: boolean }[]) {
    const current = new Set<string>();
    this.els["hud-team"].classList.toggle("hidden", list.length === 0);
    this.els["hud-team-count"].textContent = t("players", { n: list.length + 1 });
    for (const p of list) {
      current.add(p.id);
      let view = this.teammates.get(p.id);
      if (!view) {
        const root = document.createElement("div");
        root.innerHTML = '<div class="tm-icon"></div><span class="tm-name"></span><em class="tm-status"></em><div class="bar"><b></b></div>';
        this.els["team-members"].appendChild(root);
        view = { root, name: root.querySelector(".tm-name")!, status: root.querySelector(".tm-status")!, bar: root.querySelector(".bar b")!, lineage: "" };
        this.teammates.set(p.id, view);
      }
      if (view.lineage !== p.lineage) {
        view.lineage = p.lineage;
        view.root.style.setProperty("--team-color", LINEAGE_COLORS[p.lineage as LineageId]?.glow ?? "#fff");
        view.root.querySelector(".tm-icon")!.replaceChildren(lineagePortrait(p.lineage as LineageId, "", false, 27));
      }
      const className = `tm ${p.life}${p.connected ? "" : " dc"}`;
      if (view.root.className !== className) view.root.className = className;
      if (view.name.textContent !== p.name) view.name.textContent = p.name;
      const status = !p.connected ? "·" : p.life === "downed" ? "+" : p.life === "waiting" ? "…" : p.life === "departed" ? "×" : "";
      if (view.status.textContent !== status) view.status.textContent = status;
      const width = `${Math.round(Math.max(0, Math.min(1, p.hp / Math.max(1, p.maxHp))) * 100)}%`;
      if (view.bar.style.width !== width) view.bar.style.width = width;
    }
    for (const [id, view] of this.teammates) {
      if (!current.has(id)) { view.root.remove(); this.teammates.delete(id); }
    }
  }

  banner(text: string, ms = 2200) {
    const element = this.els["hud-banner"];
    if (this.ended) return;
    element.textContent = text;
    element.classList.remove("hidden", "pop");
    void element.offsetWidth;
    element.classList.add("pop");
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => element.classList.add("hidden"), ms);
  }

  private clearTimer: number | undefined;
  /** Huge comic-book title across the screen ("SECTOR CLEAR!!"). */
  sectorClear(text: string, ms = 2600) {
    if (this.ended) return;
    const el = this.els["hud-clear"];
    this.els["clear-text"].textContent = text;
    el.classList.remove("hidden", "show");
    void el.offsetWidth;
    el.classList.add("show");
    clearTimeout(this.clearTimer);
    this.clearTimer = window.setTimeout(() => el.classList.add("hidden"), ms);
  }

  private lastChain = 0;
  /** Combo counter: pops on every new hit, colour climbs with the chain. */
  chain(n: number, bonusPct: number, windowLeft: number) {
    const el = this.els["hud-chain"];
    if (n < 2) {
      if (this.lastChain >= 2) el.classList.add("hidden");
      this.lastChain = n;
      return;
    }
    el.classList.remove("hidden");
    if (n !== this.lastChain) {
      this.els["chain-n"].textContent = String(n);
      this.els["chain-label"].textContent = t("combo");
      this.els["chain-bonus"].textContent = `+${bonusPct}% ${t("combo_dmg")}`;
      el.className = `hud-chain tier${n >= 20 ? 3 : n >= 10 ? 2 : 1}`;
      if (n > this.lastChain) {
        el.classList.remove("pop");
        void el.offsetWidth;
        el.classList.add("pop");
      }
      this.lastChain = n;
    }
    (el.querySelector(".chain-timer u") as HTMLElement).style.width = `${Math.max(0, Math.min(1, windowLeft)) * 100}%`;
  }

  /** Local player down: grey world, pulsing red edge, bleed-out timer and revive progress. */
  downed(state: { life: string; downT: number; revive: number } | null) {
    const element = this.els["hud-down"];
    if (this.ended) return;
    const down = !!state && (state.life === "downed" || state.life === "waiting");
    document.body.classList.toggle("is-downed", down && state!.life === "downed");
    document.body.classList.toggle("is-out", down && state!.life === "waiting");
    if (!down) { element.classList.add("hidden"); return; }
    element.classList.remove("hidden");
    const downed = state!.life === "downed";
    element.classList.toggle("reviving", downed && state!.revive > 0.02);
    this.els["down-title"].textContent = t(downed ? "down_title" : "out_title");
    this.els["down-timer"].textContent = downed ? `${Math.max(0, Math.ceil(state!.downT))}` : "";
    this.els["down-sub"].textContent = downed ? t(state!.revive > 0.02 ? "down_reviving" : "downed") : t("waiting_checkpoint");
    this.bar("revive", downed ? state!.revive : 0);
  }

  /** Run is over: big verdict across the screen before the results page. */
  private ended = false;
  endScreen(success: boolean) {
    this.ended = true;
    this.els["hud-banner"].classList.add("hidden");
    this.els["hud-chain"].classList.add("hidden");
    document.body.classList.remove("is-downed", "is-out");
    document.body.classList.add(success ? "run-won" : "run-lost");
    this.els["hud-down"].classList.add("hidden");
    this.els["end-title"].textContent = t(success ? "end_win" : "end_fail");
    this.els["end-sub"].textContent = t(success ? "end_win_sub" : "end_fail_sub");
    this.els["hud-end"].className = `hud-end ${success ? "win" : "fail"}`;
  }

  connection(text: string | null) {
    this.els["hud-conn"].classList.toggle("hidden", !text);
    this.els["hud-conn"].textContent = text ?? "";
  }

  hurt() {
    const vignette = this.els["vignette"];
    vignette.classList.remove("flash"); void vignette.offsetWidth; vignette.classList.add("flash");
  }

  destroy() {
    clearTimeout(this.bannerTimer);
    document.body.classList.remove("is-downed", "is-out", "run-won", "run-lost");
    this.root.remove();
    this.teammates.clear();
  }
}
