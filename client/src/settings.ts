import { storage } from "./api.ts";

export interface Settings {
  volume: number; // 0..1
  reducedMotion: boolean;
  reducedEffects: boolean;
}

const KEY = "ef.settings";
const prefersReduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export const settings: Settings = { volume: 0.6, reducedMotion: prefersReduced, reducedEffects: false };

try {
  Object.assign(settings, JSON.parse(storage.get(KEY) ?? "{}"));
} catch {}

export function saveSettings() {
  storage.set(KEY, JSON.stringify(settings));
}
