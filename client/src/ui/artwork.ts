import type { LineageId } from "@ef/shared";
import { t } from "../i18n.ts";
import { esc } from "./dom.ts";

/** UI-only artwork contract. Gameplay and saved lineage identifiers stay unchanged. */
export const UI_LINEAGE_COLORS: Record<LineageId, string> = {
  pyra: "#be7145",
  krios: "#70a5af",
  vektor: "#7b9b83",
  litos: "#b49861",
};

const FORMS: Record<LineageId, readonly string[]> = {
  pyra: ["base", "flare", "furnace"],
  krios: ["base", "prism", "glacier"],
  vektor: ["base", "tempest", "raptor"],
  litos: ["base", "monolith", "seismic"],
};

export const UI_COPY = {
  project: "PROJEKTAS RESONANCE",
  station: "NEXUS · TYRIMŲ STOTIS",
  welcomeTitle: "Mažas kūnas.\nDidelė energija.",
  welcomeBody: "Augink savo kovotoją ir leiskis į misijas kartu su draugais.",
  cooperative: "1–8 žaidėjai · Bendros misijos",
  yourProfile: "Tavo profilis",
  chooseLineage: "Pasirink savo liniją",
  lineageHelp: "Kiekviena linija auga atskirai.",
  abilities: "Gebėjimai",
  health: "Gyvybės",
  damage: "Žala",
  beginning: "Pradžia",
  mastery: "Meistriškumas",
  expedition: "Kita ekspedicija",
  expeditionHelp: "Sukviesk komandą arba prisijunk prie draugų.",
  expeditionTime: "10–15 min.",
  missionName: "Pralauža stotyje NEXUS",
  missionDescription: "Pasiek stabilizatorių. Įveik Motininę masę. Grįžkite kartu.",
  squad: "Tavo komanda",
  openSlot: "Laisva vieta",
  lobbyHelp: "Pasidalykite kodu ir susitikite čia.",
  missionReady: "Pasiruošimas misijai",
  missionComplete: "Ekspedicijos ataskaita",
  you: "Tu",
  support: "Komandos pagalba",
  settingsNote: "Susikurk patogų kovos ritmą.",
  audio: "Garsas",
  accessibility: "Vaizdo patogumas",
  fullscreen: "Visas ekranas",
  selectLineage: "Pasirinkti liniją",
  copied: "Kambario kodas nukopijuotas",
  copyCode: "Kopijuoti kambario kodą",
  close: "Uždaryti",
} as const;

export function characterAsset(lineage: LineageId, evolution = ""): string {
  const form = FORMS[lineage]?.includes(evolution) ? evolution : "base";
  return `/assets/illustrated/char_${lineage}_${form}.png`;
}

/** Transparent full-body art; the growing scale is presentation only. */
export function portraitHtml(lineage: LineageId, evolution = "", level = 1, className = ""): string {
  const growth = level < 10 ? 0.76 + Math.max(0, level - 1) * 0.012 : 0.87 + Math.min(10, level - 10) * 0.013;
  return `<span class="character-art ${esc(className)}${level >= 20 ? " mature" : ""}" style="--growth:${growth.toFixed(3)};--lin:${UI_LINEAGE_COLORS[lineage]}" role="img" aria-label="${esc(`${t(lineage)}, ${t("level")} ${level}${evolution ? `, ${t(evolution)}` : ""}`)}"><img src="${characterAsset(lineage, evolution)}" alt="" width="512" height="512" decoding="async" draggable="false" /></span>`;
}

export type UiIcon = "arrow" | "back" | "settings" | "salvage" | "support" | "tier" | "shield" | "sword" | "crystal" | "check" | "lock" | "copy" | "plus" | "sound" | "motion" | "spark" | "expand" | "close";

const ICONS: Record<UiIcon, string> = {
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  back: '<path d="M20 12H5m6-6-6 6 6 6"/>',
  settings: '<path d="m9 3-.6 2.3-2 .9L4.3 6l-2 3.4L4 11v2l-1.7 1.6 2 3.4 2.1-.2 2 .9L9 21h4l.6-2.3 2-.9 2.1.2 2-3.4L18 13v-2l1.7-1.6-2-3.4-2.1.2-2-.9L13 3Z"/><circle cx="11" cy="12" r="3"/>',
  salvage: '<path d="m12 2 8.6 5v10L12 22l-8.6-5V7Zm0 0v10m8.6-5L12 12l-8.6-5M12 12v10"/>',
  support: '<path d="M20.8 4.6a5.4 5.4 0 0 0-7.6 0L12 5.8l-1.2-1.2a5.4 5.4 0 0 0-7.6 7.6L12 21l8.8-8.8a5.4 5.4 0 0 0 0-7.6Z"/>',
  tier: '<path d="m4 17 8-12 8 12ZM4 21h16"/>',
  shield: '<path d="m12 2 8 3v6c0 5-8 11-8 11S4 16 4 11V5Z"/><path d="M12 7v9m-4-5h8"/>',
  sword: '<path d="m5 19 4-4m-2-3 5 5M9 14 18 3h3v3L11 16M3 21l2-2"/>',
  crystal: '<path d="m12 2 7 5 2 8-9 7-9-7 2-8Zm0 0v20M5 7l7 5 7-5M3 15l9-3 9 3"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  sound: '<path d="m11 4-6 5H2v6h3l6 5Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  motion: '<path d="M3 8h9m-7 5h6m-4 5h5m3-15 6 9-6 9"/>',
  spark: '<path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5Z"/>',
  expand: '<path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
};

export function icon(name: UiIcon, className = ""): string {
  return `<svg class="ui-icon ${esc(className)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

export function brandHtml(): string {
  return `<span class="brand-emblem" aria-hidden="true">${icon("spark")}</span><span class="brand-type"><span class="eyebrow">${UI_COPY.project}</span><strong>${t("title")}</strong></span>`;
}
