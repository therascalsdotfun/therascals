export const MAX_CRANK_SPEED = 12;
const TAU = Math.PI * 2;
const clamp = (n: number) =>
  Number.isFinite(n)
    ? Math.max(-MAX_CRANK_SPEED, Math.min(MAX_CRANK_SPEED, n))
    : 0;
const wrap = (n: number) => Math.atan2(Math.sin(n), Math.cos(n));
export class CrankDrive {
  angle = 0;
  speed = 0;
  dragging = false;
  keyboardActive = false;
  releaseVersion = 0;
  settlingMs: number | null = null;
  private pointerAngle = 0;
  private pointerTime = 0;
  private inputSpeed = 0;
  private inputAge = 0;
  get aligned() {
    return Math.abs(wrap(this.angle)) < 0.006 && Math.abs(this.speed) < 0.03;
  }
  grab(angle: number, time: number) {
    if (!Number.isFinite(angle) || !Number.isFinite(time)) return;
    this.dragging = true;
    this.pointerAngle = angle;
    this.pointerTime = time;
    this.inputSpeed = 0;
    this.inputAge = 0;
  }
  turn(angle: number, time: number) {
    if (
      !this.dragging ||
      !Number.isFinite(angle) ||
      !Number.isFinite(time) ||
      time <= this.pointerTime
    )
      return;
    const delta = wrap(angle - this.pointerAngle),
      dt = Math.max(0.008, (time - this.pointerTime) / 1000);
    this.inputSpeed = clamp(delta / dt);
    this.speed = clamp(this.speed * 0.35 + this.inputSpeed * 0.65);
    this.angle += delta;
    this.pointerAngle = angle;
    this.pointerTime = time;
    this.inputAge = 0;
  }
  release() {
    this.dragging = false;
    this.inputSpeed = 0;
  }
  boost(amount: number) {
    this.release();
    this.speed = clamp(this.speed + amount);
  }
  stop() {
    this.release();
    this.speed = 0;
  }
  advance(delta: number, automaticSpeed: number, brake: boolean) {
    const dt = Math.max(0, Math.min(0.05, delta));
    if (!dt) return;
    if (brake) {
      this.release();
      const error = -wrap(this.angle);
      this.speed = clamp(this.speed + (error * 38 - this.speed * 12) * dt);
      this.angle += this.speed * dt;
      if (this.aligned) {
        this.angle = Math.round(this.angle / TAU) * TAU;
        this.speed = 0;
      }
      return;
    }
    this.inputAge += dt;
    if (this.dragging) {
      this.speed *= Math.exp(-Math.max(0, this.inputAge - 0.04) * 8 * dt);
      return;
    }
    this.speed *= Math.exp(-1.15 * dt);
    const baseline = Math.max(0, Math.min(2.5, automaticSpeed));
    if (Math.abs(this.speed) < baseline) {
      const direction = this.speed < -0.1 ? -1 : 1;
      this.speed +=
        (baseline * direction - this.speed) * (1 - Math.exp(-dt * 6));
    }
    if (Math.abs(this.speed) < 0.015) this.speed = 0;
    this.angle += this.speed * dt;
  }
}
