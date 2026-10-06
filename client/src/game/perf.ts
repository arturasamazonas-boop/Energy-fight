// Frame-rate watchdog for phones. When the game runs slowly for several seconds
// it steps quality down once per level: first effects, then render resolution.
export type QualityStep = "effects" | "resolution";

export class PerfWatch {
  private warm = 0;
  private slow = 0;
  private avg = 60;
  private steps: QualityStep[];
  /** Exposed for diagnostics (window.__efPerf). */
  stats = { fps: 60, lowered: [] as QualityStep[] };

  constructor(available: QualityStep[], private onLower: (step: QualityStep) => void, private threshold = 40, private holdSeconds = 5) {
    this.steps = [...available];
  }

  /** Call once per frame with the frame time in seconds. */
  update(dtSec: number) {
    if (dtSec <= 0) return;
    this.warm += dtSec;
    const fps = Math.min(120, 1 / dtSec);
    this.avg += (fps - this.avg) * Math.min(1, dtSec * 2);
    this.stats.fps = Math.round(this.avg);
    if (this.warm < 4 || this.steps.length === 0) return; // ignore loading hitches
    if (typeof document !== "undefined" && document.hidden) return;
    this.slow = this.avg < this.threshold ? this.slow + dtSec : Math.max(0, this.slow - dtSec * 2);
    if (this.slow >= this.holdSeconds) {
      const step = this.steps.shift()!;
      this.stats.lowered.push(step);
      this.slow = 0;
      this.warm = 0; // give the new setting time to settle
      this.onLower(step);
    }
  }
}
