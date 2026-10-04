// In-memory active-run locks: one profile may control one room at a time.
// They live in this single process and start empty after a restart.
export interface LockEntry {
  roomId: string;
  sessionId: string;
  running: boolean;
}

const locks = new Map<string, LockEntry>();

export const ActiveRuns = {
  get(profileId: string) {
    return locks.get(profileId);
  },
  acquire(profileId: string, roomId: string, sessionId: string): boolean {
    const cur = locks.get(profileId);
    if (cur && !(cur.roomId === roomId && cur.sessionId === sessionId)) return false;
    locks.set(profileId, { roomId, sessionId, running: cur?.running ?? false });
    return true;
  },
  setRunning(profileId: string, roomId: string, running: boolean) {
    const cur = locks.get(profileId);
    if (cur && cur.roomId === roomId) cur.running = running;
  },
  release(profileId: string, roomId: string) {
    const cur = locks.get(profileId);
    if (cur && cur.roomId === roomId) locks.delete(profileId);
  },
  releaseRoom(roomId: string) {
    for (const [k, v] of locks) if (v.roomId === roomId) locks.delete(k);
  },
  isRunning(profileId: string) {
    return !!locks.get(profileId)?.running;
  },
  clear() {
    locks.clear();
  },
  size() {
    return locks.size;
  },
};
