/**
 * The cage settles, then asks the server for the winner. The settle window is
 * presentation only: no ball observation leaves this file, and nothing here can
 * decide the outcome, which is what the old `ProximityRelease` report did.
 */
export const SETTLE_MS = 4000;
export type SettleReport = { version: 2; elapsedMs: number };
export class ReleaseClock {
  elapsedMs = 0;
  released = false;
  submitted = false;
  private idleMs = 0;
  reset() {
    this.elapsedMs = 0;
    this.released = false;
    this.submitted = false;
    this.idleMs = 0;
  }
  update(
    dt: number,
    dragging: boolean,
    manualRelease: boolean,
  ): SettleReport | null {
    if (this.submitted) return null;
    const ms = Math.max(0, Math.min(0.05, dt)) * 1000;
    if (dragging) {
      this.elapsedMs = 0;
      this.released = false;
      this.idleMs = 0;
      return null;
    }
    if (!this.released) {
      this.idleMs += ms;
      if (manualRelease || this.idleMs >= 1200) this.released = true;
      else return null;
    }
    this.elapsedMs += ms;
    if (this.elapsedMs < SETTLE_MS) return null;
    this.submitted = true;
    return { version: 2, elapsedMs: Math.min(5000, this.elapsedMs) };
  }
}
