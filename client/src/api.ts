import type { LineageId, LineageRecord } from "@ef/shared";

export interface ProfileView {
  id: string;
  name: string;
  salvage: number;
  supportMarks: number;
  tierUnlocked: number;
  lastLineage: LineageId;
  lineages: Record<LineageId, LineageRecord>;
}

const TOKEN_KEY = "ef.guestToken";

export function serverHttpBase(): string {
  const env = (import.meta as any).env ?? {};
  if (env.VITE_SERVER_URL) return env.VITE_SERVER_URL.replace(/\/$/, "");
  if (env.DEV) return `${location.protocol}//${location.hostname}:2567`;
  return location.origin;
}

export const storage = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
  del(k: string) {
    try {
      localStorage.removeItem(k);
    } catch {}
  },
};

export function getToken() {
  return storage.get(TOKEN_KEY);
}
export function setToken(t: string) {
  storage.set(TOKEN_KEY, t);
}
export function clearToken() {
  storage.del(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(public code: string, public status: number) {
    super(code);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(serverHttpBase() + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError("network", 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `http_${res.status}`, res.status);
  return data as T;
}

export const api = {
  config: () => call<{ devTools: boolean }>("GET", "/api/config"),
  createGuest: (name: string) => call<{ token: string; profile: ProfileView }>("POST", "/api/guest", { name }),
  profile: () => call<{ profile: ProfileView; inRun: boolean }>("GET", "/api/profile"),
  rename: (name: string) => call<{ profile: ProfileView }>("POST", "/api/profile/name", { name }),
  setLineage: (lineage: LineageId) => call<{ profile: ProfileView }>("POST", "/api/lab/lineage", { lineage }),
  evolve: (lineage: LineageId, evolution: string) => call<{ profile: ProfileView }>("POST", "/api/lab/evolve", { lineage, evolution }),
  modifier: (lineage: LineageId, modifier: string) => call<{ profile: ProfileView }>("POST", "/api/lab/modifier", { lineage, modifier }),
  upgradeModule: (lineage: LineageId, module: string) => call<{ profile: ProfileView }>("POST", "/api/lab/module/upgrade", { lineage, module }),
  equipModule: (lineage: LineageId, module: string | null) => call<{ profile: ProfileView }>("POST", "/api/lab/module/equip", { lineage, module }),
  devSeed: (level: number) => call<{ token: string; profile: ProfileView }>("POST", "/api/dev/seed", { level }),
};
