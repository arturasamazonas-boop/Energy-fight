// One-time contextual hints for new players (each shown once per device).
import { storage } from "../api.ts";
import { t } from "../i18n.ts";

const KEY = "ef.tipsSeen";

export class Tips {
  private seen: Set<string>;
  private el: HTMLElement;
  private queue: string[] = [];
  private showing = 0;
  private enabled: boolean;

  constructor(parent: HTMLElement, playerLevel: number) {
    let saved: string[] = [];
    try {
      saved = JSON.parse(storage.get(KEY) ?? "[]");
    } catch {}
    this.seen = new Set(saved);
    // Hints are for beginners; experienced profiles skip them.
    this.enabled = playerLevel <= 6 && this.seen.size < 12;
    this.el = document.createElement("div");
    this.el.className = "tip hidden";
    parent.appendChild(this.el);
  }

  /** Requests a hint; it is shown once and queued if another is visible. */
  show(id: string) {
    if (!this.enabled || this.seen.has(id) || this.queue.includes(id)) return;
    this.queue.push(id);
  }

  update(dt: number) {
    if (this.showing > 0) {
      this.showing -= dt;
      if (this.showing <= 0) this.el.classList.add("hidden");
      return;
    }
    const id = this.queue.shift();
    if (!id) return;
    this.seen.add(id);
    storage.set(KEY, JSON.stringify([...this.seen]));
    this.el.textContent = t(`tip_${id}${id === "move" && matchMedia("(pointer: fine)").matches ? "_keys" : ""}`);
    this.el.classList.remove("hidden");
    this.showing = 5.5;
  }

  destroy() {
    this.el.remove();
  }
}
