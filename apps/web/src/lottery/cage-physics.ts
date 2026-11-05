import {
  Body,
  World,
  Sphere,
  Vec3,
  Material,
  ContactMaterial,
  SAPBroadphase,
  GSSolver,
} from "cannon-es";
import { DrawMotion } from "./motion.ts";
export const CAGE_RADIUS = 1.5;
/** Seconds a guided ball may drift on its own before the landing assist takes over. */
export const CAPTURE_ASSIST_S = 2.5;
export const OUTLET = new Vec3(1.38, -2.28, 0.8);
// Shared by the physical presentation and the visible chute. Every segment
// descends, so the selected ball never has to be lifted out of the cage.
export function exitPose(radius: number, progress: number): Vec3 {
  const q = Math.max(0, Math.min(1, progress));
  if (q === 1) return OUTLET.clone();
  const startY = -CAGE_RADIUS + radius - 0.01;
  const turn = Math.max(0, (q - 0.55) / 0.45),
    bend = turn * turn * (3 - 2 * turn);
  return new Vec3(
    OUTLET.x * bend,
    startY + (OUTLET.y - startY) * q,
    OUTLET.z * bend,
  );
}
export function bottomExitPath(radius: number): Vec3[] {
  return Array.from({ length: 33 }, (_, i) => exitPose(radius, i / 32));
}
export type CageSeed = { id: string; radius: number };
export type PhysicalBall = CageSeed & { body: Body };
export class LotteryPhysics {
  readonly world = new World({ gravity: new Vec3(0, -9.81, 0) });
  readonly balls: PhysicalBall[];
  stage: "idle" | "mixing" | "capturing" | "extracting" | "complete" = "idle";
  captured = false;
  selectedId: string | null = null;
  progress = 0;
  settling = false;
  hold = false;
  private rotationSpeed = 0;
  private releaseReady = true;
  private clock = 0;
  private motion = new DrawMotion(0);
  private rolling = false;
  private captureOrigin: Vec3 | null = null;
  private captureAt = 0;
  constructor(seeds: CageSeed[]) {
    this.world.broadphase = new SAPBroadphase(this.world);
    const solver = new GSSolver();
    solver.iterations = 20;
    solver.tolerance = 1e-7;
    this.world.solver = solver;
    const material = new Material("lottery-resin");
    this.world.addContactMaterial(
      new ContactMaterial(material, material, {
        friction: 0.18,
        restitution: 0.55,
        contactEquationStiffness: 1e7,
        contactEquationRelaxation: 4,
      }),
    );
    this.balls = seeds.slice(0, 32).map((s, i) => {
      const radius = Math.min(0.3, Math.max(0.13, s.radius)),
        body = new Body({
          mass: Math.pow(radius / 0.2, 3),
          shape: new Sphere(radius),
          material,
          linearDamping: 0.08,
          angularDamping: 0.12,
        });
      // Fibonacci placement starts separated throughout the globe, then settles.
      const y = 1 - (2 * (i + 0.5)) / Math.max(seeds.length, 1),
        a = i * 2.399963;
      body.position.set(
        Math.sqrt(1 - y * y) * Math.cos(a) * 0.95,
        y * 0.85,
        Math.sqrt(1 - y * y) * Math.sin(a) * 0.95,
      );
      body.angularVelocity.set(Math.sin(a) * 2, Math.cos(a) * 2, 1);
      this.world.addBody(body);
      return { ...s, radius, body };
    });
    this.world.addEventListener("preStep", () => this.forces());
    this.world.addEventListener("postStep", () => this.wallContacts());
  }
  observations() {
    return this.balls.map((b) => ({
      key: b.id,
      x: b.body.position.x,
      y: b.body.position.y,
      z: b.body.position.z,
      radius: b.radius,
    }));
  }
  setRotation(speed: number, releaseReady = true) {
    this.rotationSpeed = Number.isFinite(speed)
      ? Math.max(-12, Math.min(12, speed))
      : 0;
    this.releaseReady = releaseReady;
  }
  beginRoll() {
    this.settling = false;
    this.hold = false;
    this.clock = 0;
    this.motion = new DrawMotion(0);
    this.captured = false;
    this.captureOrigin = null;
    this.progress = 0;
    this.selectedId = null;
    this.rolling = true;
    this.stage = "mixing";
    for (const { body } of this.balls) {
      body.type = Body.DYNAMIC;
      body.collisionResponse = true;
      body.updateMassProperties();
      body.wakeUp();
      // Preserve momentum: starting a draw does not teleport every ball into
      // an unrelated high-speed trajectory. The drum and bottom jet do the work.
      body.velocity.y += 0.6;
    }
  }
  private intake(ball: PhysicalBall) {
    return bottomExitPath(ball.radius)[0];
  }
  private forces() {
    for (let i = 0; i < this.balls.length; i++) {
      const b = this.balls[i],
        p = b.body.position;
      if (b.body.type !== Body.DYNAMIC) continue;
      if (
        this.stage === "capturing" &&
        b.id === this.selectedId &&
        this.releaseReady
      ) {
        const target = this.intake(b);
        b.body.force.vadd(
          new Vec3(
            (target.x - p.x) * 46 * b.body.mass -
              b.body.velocity.x * 12 * b.body.mass,
            0, // Gravity provides the drop; no upward capture force.
            (target.z - p.z) * 46 * b.body.mass -
              b.body.velocity.z * 12 * b.body.mass,
          ),
          b.body.force,
        );
        continue;
      }
      if (
        this.stage === "capturing" &&
        this.releaseReady &&
        b.id !== this.selectedId
      ) {
        // The outlet funnel holds other balls outside the one-ball throat.
        // This prevents a settled neighbour from pinning the chosen ball above it.
        const radial = Math.hypot(p.x, p.z),
          clearance = 0.54 + b.radius;
        if (radial < clearance && p.y < 0.15) {
          const angle = i * 2.399963;
          const nx = radial > 0.01 ? p.x / radial : Math.cos(angle),
            nz = radial > 0.01 ? p.z / radial : Math.sin(angle);
          const radialSpeed = b.body.velocity.x * nx + b.body.velocity.z * nz;
          const guide =
            Math.max(0, (clearance - radial) * 100 - radialSpeed * 10) *
            b.body.mass;
          b.body.force.x += nx * guide;
          b.body.force.z += nz * guide;
        }
        continue;
      }
      const omega = this.rotationSpeed;
      if (Math.abs(omega) > 0.02) {
        // Tangential wall/air coupling about the drum's real X axle. Faster
        // turning raises contact velocities; the enclosing sphere stays bounded.
        const shell = Math.min(1, (p.length() + b.radius) / CAGE_RADIUS);
        const coupling = 0.25 + 6 * Math.pow(shell, 8),
          m = b.body.mass;
        b.body.force.vadd(
          new Vec3(
            Math.sin(this.clock * 3 + i) * Math.abs(omega) * 0.08 * m,
            (-omega * p.z - b.body.velocity.y) * coupling * m,
            (omega * p.y - b.body.velocity.z) * coupling * m,
          ),
          b.body.force,
        );
        b.body.torque.x += omega * m * 0.7;
        const speed = b.body.velocity.length(),
          limit = Math.min(12, 5.5 + Math.abs(omega) * 0.7);
        if (speed > limit)
          b.body.velocity.scale(limit / speed, b.body.velocity);
      }
      const manual = Math.abs(omega) > 0.15;
      const active = this.stage === "mixing" || this.stage === "capturing";
      if (this.settling || (!active && !manual)) continue;
      const t = this.clock,
        seed = i * 2.39,
        m = b.body.mass;
      // Mixing energy only comes from a draw motor or the user's crank.
      // With no crank motion and no draw, gravity and contacts do all the work.
      const power = active ? 1 : Math.min(1, Math.abs(omega) / 6);
      const jetX = Math.sin(t * 1.6) * 0.5,
        jetZ = Math.cos(t * 1.3) * 0.45;
      const radial = (p.x - jetX) ** 2 + (p.z - jetZ) ** 2;
      const jet =
        power *
        (43 * Math.exp(-radial / 0.65) + 14 * Math.exp(-radial / 1.8)) *
        Math.max(0.16, 1 - (p.y + CAGE_RADIUS) / 3.1);
      const drift = active ? 3 : 1.7;
      b.body.force.vadd(
        new Vec3(
          (Math.sin(t * 3.5 + seed) * drift + p.y * 1.8 - p.z * 1.4) *
            power *
            m,
          jet * (0.9 + Math.sin(t * 3 + seed) * 0.1) * m,
          (Math.cos(t * 3.2 + seed) * drift + p.x * 1.4) * power * m,
        ),
        b.body.force,
      );
      b.body.torque.set(
        Math.sin(t + seed) * m,
        Math.cos(t * 2 + seed) * m,
        0.4 * m,
      );
      const speed = b.body.velocity.length();
      const limit = Math.min(12, 5.5 + Math.abs(this.rotationSpeed) * 0.7);
      if (speed > limit) b.body.velocity.scale(limit / speed, b.body.velocity);
    }
  }
  restore(id: string) {
    const ball = this.balls.find((b) => b.id === id);
    if (!ball) return;
    this.selectedId = id;
    this.stage = "complete";
    this.captured = true;
    this.progress = 1;
    this.rolling = false;
    ball.body.type = Body.KINEMATIC;
    ball.body.collisionResponse = false;
    ball.body.position.copy(OUTLET);
    ball.body.velocity.setZero();
  }
  advance(delta: number, id: string | null, reduced: boolean) {
    const dt = Math.max(0, Math.min(delta, 0.05));
    if (!dt || (this.hold && !id)) return;
    this.clock += dt;
    const chosen = this.balls.find((b) => b.id === id);
    if (this.rolling) {
      // Pin the exact result once known; missing IDs cannot complete a draw.
      this.selectedId = chosen?.id ?? null;
      const sample = this.motion.sample(
        this.clock * 1000,
        chosen?.id ?? null,
        reduced,
        this.captured,
      );
      this.stage = sample.stage;
      this.progress = sample.progress;
      if (
        this.stage === "capturing" &&
        this.releaseReady &&
        chosen &&
        !this.captureOrigin
      ) {
        this.captureOrigin = chosen.body.position.clone();
        this.captureAt = this.clock;
        // Brake the upward blower momentum as the gate opens; then let gravity
        // lower the chosen ball while horizontal guides center it over the gate.
        chosen.body.velocity.y = Math.min(0, chosen.body.velocity.y);
      }
      // Presentation guarantee: whichever ball the server committed to always
      // reaches the gate. In a dense cage a buried ball may drift there slowly
      // or never, so after a short assist it is walked down the same route the
      // reduced-motion path uses. This moves only the already-chosen ball, so it
      // cannot change an outcome.
      const assistOrigin = this.captureOrigin,
        assistFrom = reduced
          ? this.captureAt
          : this.captureAt + CAPTURE_ASSIST_S;
      if (
        assistOrigin &&
        chosen &&
        this.stage === "capturing" &&
        this.releaseReady &&
        this.clock >= assistFrom
      ) {
        const t = Math.min(
          1,
          (this.clock - assistFrom) / (reduced ? 0.12 : 1.2),
        );
        chosen.body.velocity.setZero();
        assistOrigin.lerp(this.intake(chosen), t, chosen.body.position);
      }
      if (
        this.stage === "capturing" &&
        this.releaseReady &&
        chosen &&
        chosen.body.position.distanceTo(this.intake(chosen)) < 0.045
      ) {
        this.captured = true;
        chosen.body.type = Body.KINEMATIC;
        chosen.body.collisionResponse = false;
        chosen.body.velocity.setZero();
        chosen.body.angularVelocity.setZero();
        chosen.body.position.copy(this.intake(chosen));
        const next = this.motion.sample(
          this.clock * 1000,
          chosen.id,
          reduced,
          true,
        );
        this.stage = next.stage;
        this.progress = next.progress;
      }
      if (chosen && ["extracting", "complete"].includes(this.stage)) {
        chosen.body.position.copy(exitPose(chosen.radius, this.progress));
        chosen.body.velocity.setZero();
        chosen.body.angularVelocity.setZero();
        if (this.stage === "complete") {
          chosen.body.position.copy(OUTLET);
          this.rolling = false;
        }
      }
    }
    // A fast ball travels <= 6cm per fixed tick, below the smallest radius.
    // Wall response runs on each tick, not once after several collision steps.
    this.world.step(1 / 240, dt, 12);
  }
  private wallContacts() {
    for (const b of this.balls) {
      if (b.body.type !== Body.DYNAMIC) continue;
      const p = b.body.position,
        len = p.length(),
        limit = CAGE_RADIUS - b.radius;
      if (len > limit) {
        const normal = p.scale(1 / len);
        p.copy(normal.scale(limit));
        const outward = b.body.velocity.dot(normal);
        if (outward > 0) {
          const impulse = outward * (outward > 0.25 ? 1.55 : 1);
          b.body.velocity.vsub(normal.scale(impulse), b.body.velocity);
          const surface = new Vec3(
            0,
            -this.rotationSpeed * p.z,
            this.rotationSpeed * p.y,
          );
          const slip = b.body.velocity.vsub(surface);
          slip.vsub(normal.scale(slip.dot(normal)), slip);
          const speed = slip.length();
          if (speed > 1e-6)
            b.body.velocity.vsub(
              slip.scale(Math.min(speed * 0.15, impulse * 0.28) / speed),
              b.body.velocity,
            );
        }
      }
      const speed = b.body.velocity.length();
      if (speed > 14) b.body.velocity.scale(14 / speed, b.body.velocity);
      const spin = b.body.angularVelocity.length();
      if (spin > 28)
        b.body.angularVelocity.scale(28 / spin, b.body.angularVelocity);
    }
  }
}
