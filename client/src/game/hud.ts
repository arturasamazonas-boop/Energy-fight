// DOM heads-up display layered over the Phaser canvas.
import { t } from "../i18n.ts";
import { LINEAGE_COLORS } from "./art.ts";
import type { LineageId } from "@ef/shared";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export class Hud {
  readonly root: HTMLElement;
  private els: Record<string, HTMLElement> = {};
  private bannerTimer: number | undefined;
  onMenu: () => void = () => {};

  constructor(parent: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "hud";
    this.root.innerHTML = `
      <div class="hud-self">
        <div class="hud-name"></div>
        <div class="bar hp"><b></b><s></s><em></em></div>
        <div class="bar od"><b></b></div>
      </div>
      <div class="hud-obj">
        <div class="obj-text"></div>
        <div class="bar obj"><b></b></div>
        <div class="boss hidden"><div class="boss-name">${t("boss_name")}</div><div class="bar bosshp"><b></b></div><div class="bar stag"><b></b></div></div>
      </div>
      <div class="hud-team"></div>
      <button class="hud-menu" aria-label="Meniu">☰</button>
      <div class="hud-banner hidden"></div>
      <div class="hud-down hidden"><div class="down-title"></div><div class="bar revive"><b></b></div><div class="down-sub"></div></div>
      <div class="hud-conn hidden"></div>
      <div class="vignette"></div>`;
    parent.appendChild(this.root);
    for (const k of ["hud-name", "hud-team", "obj-text", "boss", "hud-banner", "hud-down", "down-title", "down-sub", "hud-conn", "vignette"]) {
      this.els[k] = this.root.querySelector("." + k)!;
    }
    this.root.querySelector(".hud-menu")!.addEventListener("click", () => this.onMenu());
  }

  private bar(sel: string, ratio: number) {
    const b = this.root.querySelector(`.bar.${sel} b`) as HTMLElement | null;
    if (b) b.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
  }

  updateSelf(p: { name: string; lineage: string; level: number; hp: number; maxHp: number; shield: number; od: number; odT: number; hasOverdrive: boolean; mastery: boolean }) {
    const color = LINEAGE_COLORS[p.lineage as LineageId]?.glow ?? "#fff";
    this.els["hud-name"].innerHTML = `<i style="background:${color}"></i>${esc(p.name)} <small>${t(p.lineage)} · ${t("level_short")} ${p.level}${p.mastery ? " ★" : ""}</small>`;
    this.bar("hp", p.hp / Math.max(1, p.maxHp));
    const s = this.root.querySelector(".bar.hp s") as HTMLElement;
    s.style.width = `${Math.min(1, p.shield / Math.max(1, p.maxHp)) * 100}%`;
    (this.root.querySelector(".bar.hp em") as HTMLElement).textContent = `${Math.max(0, Math.round(p.hp))}/${p.maxHp}`;
    const od = this.root.querySelector(".bar.od") as HTMLElement;
    od.classList.toggle("hidden", !p.hasOverdrive);
    od.classList.toggle("full", p.od >= 100 || p.odT > 0);
    this.bar("od", p.odT > 0 ? p.odT / 8 : p.od / 100);
  }

  updateObjective(stage: string, objective: number, boss: { hp: number; maxHp: number; stagger: number } | null) {
    this.els["obj-text"].textContent = t(`obj_${stage}`);
    this.bar("obj", objective / 100);
    this.els["boss"].classList.toggle("hidden", !boss);
    if (boss) {
      this.bar("bosshp", boss.hp / Math.max(1, boss.maxHp));
      this.bar("stag", boss.stagger);
    }
  }

  updateTeam(list: { id: string; name: string; lineage: string; hp: number; maxHp: number; life: string; connected: boolean }[]) {
    this.els["hud-team"].innerHTML = list
      .map((p) => {
        const color = LINEAGE_COLORS[p.lineage as LineageId]?.glow ?? "#fff";
        const icon = !p.connected ? "⚡" : p.life === "downed" ? "✚" : p.life === "waiting" ? "…" : p.life === "departed" ? "✕" : "";
        return `<div class="tm ${p.life}${p.connected ? "" : " dc"}"><i style="background:${color}"></i><span>${esc(p.name)}</span><em>${icon}</em><div class="bar"><b style="width:${(Math.max(0, p.hp) / Math.max(1, p.maxHp)) * 100}%"></b></div></div>`;
      })
      .join("");
  }

  banner(text: string, ms = 2200) {
    const el = this.els["hud-banner"];
    el.textContent = text;
    el.classList.remove("hidden");
    el.classList.remove("pop");
    void el.offsetWidth;
    el.classList.add("pop");
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => el.classList.add("hidden"), ms);
  }

  downed(state: { life: string; downT: number; revive: number } | null) {
    const el = this.els["hud-down"];
    if (!state || state.life === "alive" || state.life === "departed") {
      el.classList.add("hidden");
      return;
    }
    el.classList.remove("hidden");
    if (state.life === "downed") {
      this.els["down-title"].textContent = t("downed");
      this.els["down-sub"].textContent = `${Math.ceil(state.downT)} s`;
      this.bar("revive", state.revive);
    } else {
      this.els["down-title"].textContent = t("waiting_checkpoint");
      this.els["down-sub"].textContent = "";
      this.bar("revive", 0);
    }
  }

  connection(text: string | null) {
    const el = this.els["hud-conn"];
    el.classList.toggle("hidden", !text);
    el.textContent = text ?? "";
  }

  hurt() {
    const v = this.els["vignette"];
    v.classList.remove("flash");
    void v.offsetWidth;
    v.classList.add("flash");
  }

  destroy() {
    clearTimeout(this.bannerTimer);
    this.root.remove();
  }
}
