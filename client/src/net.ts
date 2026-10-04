import { Client, type Room } from "@colyseus/sdk";
import { ROOM_NAME, type LineageId } from "@ef/shared";
import { getToken, serverHttpBase, storage } from "./api.ts";

const RECONNECT_KEY = "ef.reconnect";
const RECONNECT_WINDOW_MS = 85_000;

export interface ReconnectInfo {
  token: string;
  roomId: string;
  savedAt: number;
}

let client: Client | null = null;
function getClient() {
  if (!client) client = new Client(serverHttpBase());
  return client;
}

export function saveReconnect(room: Room) {
  storage.set(RECONNECT_KEY, JSON.stringify({ token: room.reconnectionToken, roomId: room.roomId, savedAt: Date.now() } satisfies ReconnectInfo));
}
export function clearReconnect() {
  storage.del(RECONNECT_KEY);
}
export function loadReconnect(): ReconnectInfo | null {
  const raw = storage.get(RECONNECT_KEY);
  if (!raw) return null;
  try {
    const info = JSON.parse(raw) as ReconnectInfo;
    if (Date.now() - info.savedAt > RECONNECT_WINDOW_MS) {
      clearReconnect();
      return null;
    }
    return info;
  } catch {
    clearReconnect();
    return null;
  }
}

function track(room: Room) {
  saveReconnect(room);
  // Keep the token fresh while connected so a reload within the seat window works.
  const iv = setInterval(() => saveReconnect(room), 5000);
  room.onLeave(() => clearInterval(iv));
  room.onReconnect?.(() => saveReconnect(room));
  return room;
}

export async function createRoom(lineage: LineageId) {
  return track(await getClient().create(ROOM_NAME, { token: getToken(), lineage }));
}

export async function joinRoom(code: string, lineage: LineageId) {
  return track(await getClient().joinById(code.trim().toUpperCase(), { token: getToken(), lineage }));
}

export async function reconnect(info: ReconnectInfo) {
  return track(await getClient().reconnect(info.token));
}

export function errorCode(e: unknown): string {
  const m = (e as any)?.message ?? String(e);
  if (/invalid_credential|already_in_run|already_in_room|run_in_progress/.test(m)) return m.match(/invalid_credential|already_in_run|already_in_room|run_in_progress/)![0];
  if (/full|locked/i.test(m)) return "room_full";
  if (/not found|no rooms|invalid room/i.test(m)) return "room_not_found";
  if (/fetch|network|ECONN|Failed/i.test(m)) return "network";
  return m;
}
