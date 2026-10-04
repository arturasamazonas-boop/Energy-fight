// Touch (multi-pointer) and keyboard controls. Movement stick and action
// buttons use independent pointers so moving and attacking work together.
import type { ActionKind } from "@ef/shared";
import { t } from "../i18n.ts";
import { unlockAudio } from "./audio.ts";

export interface ControlState {
  mx: number;
  my: number;
  atk: boolean;
}

const STICK_RADIUS = 56;

export class Controls {
  state: ControlState = { mx: 0, my: 0, atk: false };
  onAction: (a: ActionKind) => void = () => {};
  readonly root: HTMLElement;
  private stickPointer: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private stickBase: HTMLElement;
  private stickKnob: HTMLElement;
  private atkPointers = new Set<number>();
  private keys = new Set<string>();
  private buttons: Record<string, HTMLElement> = {};
  private cleanup: (() => void)[] = [];

  constructor(parent: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "controls";
    this.root.innerHTML = `
      <div class="stick-zone"></div>
      <div class="stick-base hidden"><div class="stick-knob"></div></div>
      <div class="btn-cluster">
        <button class="cbtn od" data-a="overdrive" aria-label="Perkrova"><span>OD</span><i></i></button>
        <button class="cbtn s2" data-a="skill2" aria-label="2 įgūdis"><span>2</span><i></i></button>
        <button class="cbtn s1" data-a="skill1" aria-label="1 įgūdis"><span>1</span><i></i></button>
        <button class="cbtn dodge" data-a="dodge" aria-label="Išsisukti"><span>⤳</span><i></i></button>
        <button class="cbtn atk" data-a="attack" aria-label="Smūgis"><span>✦</span></button>
      </div>
      <div class="keys-help">${t("keys_help")}</div>`;
    parent.appendChild(this.root);
    this.stickBase = this.root.querySelector(".stick-base")!;
    this.stickKnob = this.root.querySelector(".stick-knob")!;
    this.root.querySelectorAll<HTMLElement>(".cbtn").forEach((b) => (this.buttons[b.dataset.a!] = b));
    const help = this.root.querySelector(".keys-help") as HTMLElement;
    const helpTimer = window.setTimeout(() => help.classList.add("faded"), 9000);
    this.cleanup.push(() => clearTimeout(helpTimer));

    const zone = this.root.querySelector<HTMLElement>(".stick-zone")!;
    this.listen(zone, "pointerdown", (e: PointerEvent) => {
      unlockAudio();
      if (this.stickPointer !== null) return;
      e.preventDefault();
      zone.setPointerCapture(e.pointerId);
      this.stickPointer = e.pointerId;
      this.stickOrigin = { x: e.clientX, y: e.clientY };
      this.stickBase.style.left = `${e.clientX}px`;
      this.stickBase.style.top = `${e.clientY}px`;
      this.stickBase.classList.remove("hidden");
      this.updateStick(e.clientX, e.clientY);
    });
    this.listen(zone, "pointermove", (e: PointerEvent) => {
      if (e.pointerId !== this.stickPointer) return;
      e.preventDefault();
      this.updateStick(e.clientX, e.clientY);
    });
    const endStick = (e: PointerEvent) => {
      if (e.pointerId !== this.stickPointer) return;
      this.releaseStick();
    };
    this.listen(zone, "pointerup", endStick);
    this.listen(zone, "pointercancel", endStick);
    this.listen(zone, "lostpointercapture", endStick);

    const atk = this.buttons.attack;
    this.listen(atk, "pointerdown", (e: PointerEvent) => {
      unlockAudio();
      e.preventDefault();
      atk.setPointerCapture(e.pointerId);
      this.atkPointers.add(e.pointerId);
      this.refreshAtk();
    });
    const endAtk = (e: PointerEvent) => {
      this.atkPointers.delete(e.pointerId);
      this.refreshAtk();
    };
    this.listen(atk, "pointerup", endAtk);
    this.listen(atk, "pointercancel", endAtk);
    this.listen(atk, "lostpointercapture", endAtk);

    for (const a of ["dodge", "skill1", "skill2", "overdrive"] as ActionKind[]) {
      this.listen(this.buttons[a], "pointerdown", (e: PointerEvent) => {
        unlockAudio();
        e.preventDefault();
        this.onAction(a);
        this.buttons[a].classList.add("pressed");
        setTimeout(() => this.buttons[a].classList.remove("pressed"), 120);
      });
    }
    this.listen(this.root, "contextmenu", (e: Event) => e.preventDefault());

    this.listen(window, "keydown", (e: KeyboardEvent) => this.onKey(e, true));
    this.listen(window, "keyup", (e: KeyboardEvent) => this.onKey(e, false));
    this.listen(window, "blur", () => this.releaseAll());
    this.listen(document, "visibilitychange", () => {
      if (document.hidden) this.releaseAll();
    });
  }

  private listen(target: EventTarget, type: string, fn: (e: any) => void) {
    target.addEventListener(type, fn, { passive: false });
    this.cleanup.push(() => target.removeEventListener(type, fn));
  }

  private updateStick(x: number, y: number) {
    let dx = x - this.stickOrigin.x;
    let dy = y - this.stickOrigin.y;
    const len = Math.hypot(dx, dy);
    if (len > STICK_RADIUS) {
      // Floating stick: drag the origin so direction changes stay responsive.
      this.stickOrigin.x = x - (dx / len) * STICK_RADIUS;
      this.stickOrigin.y = y - (dy / len) * STICK_RADIUS;
      this.stickBase.style.left = `${this.stickOrigin.x}px`;
      this.stickBase.style.top = `${this.stickOrigin.y}px`;
      dx = (dx / len) * STICK_RADIUS;
      dy = (dy / len) * STICK_RADIUS;
    }
    this.stickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
    this.state.mx = dx / STICK_RADIUS;
    this.state.my = dy / STICK_RADIUS;
  }

  private releaseStick() {
    this.stickPointer = null;
    this.stickBase.classList.add("hidden");
    this.stickKnob.style.transform = "";
    this.state.mx = 0;
    this.state.my = 0;
    this.applyKeys();
  }

  private refreshAtk() {
    this.state.atk = this.atkPointers.size > 0 || this.keys.has("atk");
    this.buttons.attack.classList.toggle("held", this.state.atk);
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    if ((e.target as HTMLElement)?.tagName === "INPUT") return;
    const k = e.key.toLowerCase();
    const map: Record<string, string> = {
      w: "up", arrowup: "up", s: "down", arrowdown: "down", a: "left", arrowleft: "left", d: "right", arrowright: "right",
      " ": "atk", j: "atk",
    };
    const act: Record<string, ActionKind> = { shift: "dodge", k: "dodge", q: "skill1", u: "skill1", e: "skill2", i: "skill2", r: "overdrive", o: "overdrive" };
    if (map[k]) {
      e.preventDefault();
      if (down) this.keys.add(map[k]);
      else this.keys.delete(map[k]);
      if (map[k] === "atk") this.refreshAtk();
      else this.applyKeys();
      unlockAudio();
    } else if (act[k] && down && !e.repeat) {
      e.preventDefault();
      unlockAudio();
      this.onAction(act[k]);
    }
  }

  private applyKeys() {
    if (this.stickPointer !== null) return;
    let x = 0;
    let y = 0;
    if (this.keys.has("left")) x -= 1;
    if (this.keys.has("right")) x += 1;
    if (this.keys.has("up")) y -= 1;
    if (this.keys.has("down")) y += 1;
    const l = Math.hypot(x, y) || 1;
    this.state.mx = x / l;
    this.state.my = y / l;
  }

  /** Clears every held input (focus loss, pointer cancel, reconnect). */
  releaseAll() {
    this.keys.clear();
    this.atkPointers.clear();
    if (this.stickPointer !== null) this.releaseStick();
    this.state = { mx: 0, my: 0, atk: false };
    this.buttons.attack.classList.remove("held");
  }

  setButton(a: string, opts: { ratio: number; enabled: boolean; ready?: boolean; visible?: boolean }) {
    const b = this.buttons[a];
    if (!b) return;
    const i = b.querySelector("i") as HTMLElement | null;
    if (i) i.style.setProperty("--cd", String(Math.max(0, Math.min(1, opts.ratio))));
    b.classList.toggle("disabled", !opts.enabled);
    b.classList.toggle("ready", !!opts.ready);
    b.classList.toggle("gone", opts.visible === false);
  }

  setTheme(color: string) {
    this.root.style.setProperty("--lin", color);
  }

  destroy() {
    this.releaseAll();
    this.cleanup.forEach((f) => f());
    this.root.remove();
  }
}
