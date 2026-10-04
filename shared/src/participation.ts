// Section participation tracker: a basic AFK safeguard, not anti-bot protection.
//
// The section is split into short windows. For each window we know whether the
// character was able to act (alive, seat held) and whether useful activity
// happened (attacks at nearby enemies, defensive actions, revives, objective
// work, or moving with the squad during active combat).
//
// Rules:
// - eligible ⇔ active ≥ 1 AND active * 2 ≥ denominator
// - a disconnected-but-seated player whose body is able to act counts as an
//   inactive window (disconnecting never improves the ratio)
// - downed windows are excluded from the denominator only if the player already
//   had useful activity in this section (genuine participation)
// - zero windows never grant eligibility

export interface WindowSample {
  ableTicks: number;
  downedTicks: number;
  totalTicks: number;
  useful: boolean;
  connected: boolean;
}

export class SectionParticipation {
  active = 0;
  denominator = 0;
  windows = 0;
  private cur: WindowSample = { ableTicks: 0, downedTicks: 0, totalTicks: 0, useful: false, connected: true };

  tick(state: { able: boolean; downed: boolean; connected: boolean }) {
    this.cur.totalTicks++;
    if (state.able) this.cur.ableTicks++;
    if (state.downed) this.cur.downedTicks++;
    if (!state.connected) this.cur.connected = false;
  }

  markUseful(connected: boolean) {
    // Disconnected time never generates activity credit.
    if (connected) this.cur.useful = true;
  }

  closeWindow() {
    const w = this.cur;
    this.cur = { ableTicks: 0, downedTicks: 0, totalTicks: 0, useful: false, connected: true };
    if (w.totalTicks === 0) return;
    this.windows++;
    const mostlyDowned = w.downedTicks * 2 > w.totalTicks;
    const able = w.ableTicks * 2 >= w.totalTicks;
    if (w.useful) {
      this.active++;
      this.denominator++;
      return;
    }
    if (mostlyDowned) {
      if (this.active === 0) this.denominator++; // downed without having participated still counts
      return;
    }
    if (able) this.denominator++;
  }

  eligible(): boolean {
    return this.active >= 1 && this.active * 2 >= this.denominator;
  }

  snapshot() {
    return { active: this.active, denominator: this.denominator, eligible: this.eligible() };
  }
}
