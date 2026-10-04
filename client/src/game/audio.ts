// Locally synthesized placeholder sounds. Audio starts only after a user gesture.
import { settings } from "../settings.ts";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let lastPlay: Record<string, number> = {};

export function unlockAudio() {
  if (ctx) {
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return;
  }
  try {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.connect(ctx.destination);
    applyVolume();
  } catch {
    ctx = null;
  }
}

export function applyVolume() {
  if (master) master.gain.value = settings.volume * 0.5;
}

function tone(freq: number, dur: number, type: OscillatorType, vol: number, slide = 0) {
  if (!ctx || !master || settings.volume <= 0) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, vol: number, hp = 800) {
  if (!ctx || !master || settings.volume <= 0) return;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = "highpass";
  f.frequency.value = hp;
  const g = ctx.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(master);
  src.start();
}

export function sfx(name: string) {
  const now = performance.now();
  if (now - (lastPlay[name] ?? 0) < 45) return; // avoid stacking in 8-player fights
  lastPlay[name] = now;
  switch (name) {
    case "swing":
      noise(0.08, 0.18, 2500);
      break;
    case "hit":
      tone(160, 0.09, "square", 0.12, -80);
      noise(0.05, 0.2, 1200);
      break;
    case "hurt":
      tone(110, 0.18, "sawtooth", 0.16, -50);
      break;
    case "dodge":
      noise(0.12, 0.12, 4000);
      break;
    case "skill":
      tone(320, 0.22, "triangle", 0.18, 260);
      break;
    case "death":
      tone(90, 0.25, "sawtooth", 0.12, -40);
      noise(0.2, 0.12, 400);
      break;
    case "down":
      tone(300, 0.5, "triangle", 0.2, -220);
      break;
    case "revive":
      tone(440, 0.15, "sine", 0.2, 220);
      setTimeout(() => tone(660, 0.2, "sine", 0.18, 120), 120);
      break;
    case "section":
      tone(523, 0.15, "triangle", 0.2);
      setTimeout(() => tone(659, 0.15, "triangle", 0.2), 130);
      setTimeout(() => tone(784, 0.3, "triangle", 0.2), 260);
      break;
    case "overdrive":
      tone(200, 0.5, "sawtooth", 0.16, 500);
      break;
    case "perfect":
      tone(880, 0.12, "sine", 0.16, 300);
      break;
    case "pickup":
      tone(600, 0.12, "sine", 0.16, 300);
      break;
    case "ui":
      tone(700, 0.05, "sine", 0.08);
      break;
  }
}
