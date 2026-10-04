// Movement rules shared by client prediction and the authoritative server.
import { moveOnGround } from "./map.ts";

export interface MoveInput {
  mx: number; // -1..1
  my: number; // -1..1
}

export function normalizeInput(mx: number, my: number): MoveInput {
  if (!Number.isFinite(mx) || !Number.isFinite(my)) return { mx: 0, my: 0 };
  mx = Math.max(-1, Math.min(1, mx));
  my = Math.max(-1, Math.min(1, my));
  const len = Math.hypot(mx, my);
  if (len > 1) return { mx: mx / len, my: my / len };
  if (len < 0.12) return { mx: 0, my: 0 }; // dead zone
  return { mx, my };
}

/** One movement step. speed is ground units/s. */
export function stepMovement(x: number, y: number, input: MoveInput, speed: number, dt: number, maxX: number) {
  if (input.mx === 0 && input.my === 0) return { x, y };
  return moveOnGround(x, y, input.mx * speed * dt, input.my * speed * dt, maxX);
}

/** Dodge step: fixed distance over duration in direction (dx,dy). */
export function stepDash(x: number, y: number, dirX: number, dirY: number, distance: number, duration: number, dt: number, maxX: number) {
  const len = Math.hypot(dirX, dirY) || 1;
  const v = distance / duration;
  return moveOnGround(x, y, (dirX / len) * v * dt, (dirY / len) * v * dt, maxX);
}
