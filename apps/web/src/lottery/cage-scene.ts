import { scenePopulation } from "./scene-population.ts";
import { paintBallSurface } from "./ball-surface.ts";
import { tokenTicker } from "../../../../packages/shared/src/token-ticker.ts";
import { ReleaseClock, SETTLE_MS, type SettleReport } from "./release-clock.ts";
import { CrankDrive } from "./crank-drive.ts";
import * as THREE from "three";
import {
  LotteryPhysics,
  OUTLET,
  bottomExitPath,
  exitPose,
} from "./cage-physics.ts";
import { marketCapRadius } from "./dynamics.ts";
import { tokenKey } from "../../../../packages/shared/src/token-selection.ts";
import { tokenImageUrl } from "../../../../packages/shared/src/token-media.ts";
import type { TokenObservation } from "../../../../packages/shared/src/market.ts";
export type CageProps = {
  tokens: TokenObservation[];
  selected: TokenObservation | null;
  phase: string;
  roll: number;
  ambientMotion?: boolean;
  crank?: CrankDrive;
  proximity?: boolean;
  selectionArmed?: boolean;
  onCrankStart?: () => boolean | void;
  onReleaseSelection?: (settle: SettleReport) => void;
  onExtractionStart?: () => void;
  onExtracted?: (mint: string, roll: number) => void;
};
const palette = [
  "#d6f15c",
  "#e9ba77",
  "#9bbde1",
  "#bdade1",
  "#8fceae",
  "#ed997c",
];
export function createCageScene(
  canvas: HTMLCanvasElement,
  current: () => CageProps,
  failed: () => void,
) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "default",
  });
  renderer.setPixelRatio(
    Math.min(
      devicePixelRatio || 1,
      matchMedia("(max-width: 600px)").matches ? 1.25 : 1.5,
    ),
  );
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  let lastShadowUpdate = -Infinity;
  const ballGeometry = new THREE.SphereGeometry(1, 24, 16);
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(36, 1, 0.1, 40);
  scene.add(new THREE.HemisphereLight(0xf3ffe1, 0x27301e, 2.8));
  const key = new THREE.DirectionalLight(0xfff5da, 4);
  key.position.set(-3, 5, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -4;
  key.shadow.camera.right = 4;
  key.shadow.camera.top = 4;
  key.shadow.camera.bottom = -4;
  key.shadow.bias = -0.001;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xc7d5f1, 2);
  rim.position.set(2, 2, -4);
  scene.add(rim);
  const fill = new THREE.PointLight(0xa6c8e1, 16, 10);
  fill.position.set(-3, -0.4, 3);
  scene.add(fill);
  const metal = new THREE.MeshStandardMaterial({
    color: 0x4267df,
    metalness: 0.35,
    roughness: 0.27,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0xa58ccf,
    metalness: 0.65,
    roughness: 0.3,
  });
  const bright = new THREE.MeshStandardMaterial({
    color: 0xffaa70,
    metalness: 0.4,
    roughness: 0.25,
    emissive: 0xff8860,
    emissiveIntensity: 0.25,
  });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xc1dfbb,
    metalness: 0,
    roughness: 0.08,
    transparent: true,
    opacity: 0.035,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const staticGroup = new THREE.Group();
  scene.add(staticGroup);
  function mesh(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    x = 0,
    y = 0,
    z = 0,
  ) {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    staticGroup.add(m);
    return m;
  }
  function ring(
    radius: number,
    tube: number,
    y: number,
    material: THREE.Material,
  ) {
    const m = mesh(
      new THREE.TorusGeometry(radius, tube, 8, 80),
      material,
      0,
      y,
    );
    m.rotation.x = Math.PI / 2;
    return m;
  }
  const drum = new THREE.Group();
  staticGroup.add(drum);
  // The cage rotates about its side axle; pedestal and bottom chute stay fixed.
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 10,
      points = Array.from({ length: 81 }, (_, j) => {
        const t = -Math.PI + 0.24 + (j / 80) * (Math.PI * 2 - 0.48);
        return new THREE.Vector3(
          Math.sin(t) * Math.cos(a) * 1.52,
          Math.cos(t) * 1.52,
          Math.sin(t) * Math.sin(a) * 1.52,
        );
      });
    mesh(
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(points, false),
        96,
        0.009,
        6,
        false,
      ),
      metal,
    );
  }
  for (const y of [-1.23, -0.78, -0.3, 0.3, 0.78, 1.23])
    ring(Math.sqrt(1.52 ** 2 - y * y), 0.01, y, metal);
  ring(1.535, 0.026, 0, bright);
  mesh(
    new THREE.SphereGeometry(1.51, 40, 24, 0, Math.PI * 2, 0, Math.PI - 0.24),
    glass,
  ).castShadow = false;
  for (const part of [...staticGroup.children])
    if (part !== drum) {
      // Fine wire shadows read as a second cage behind the real one.
      if (part instanceof THREE.Mesh) part.castShadow = false;
      drum.add(part);
    }
  // Support yoke, axle caps and a weighted pedestal.
  const support = new THREE.Group();
  staticGroup.add(support);
  for (const x of [-1.67, 1.67]) {
    const upright = mesh(
      new THREE.BoxGeometry(0.1, 2.55, 0.18),
      dark,
      x,
      -1.275,
    );
    upright.rotation.z = x < 0 ? -0.12 : 0.12;
    const cap = mesh(
      new THREE.CylinderGeometry(0.105, 0.105, 0.2, 20),
      bright,
      x,
      0,
    );
    cap.rotation.z = Math.PI / 2;
  }
  // Side crank: axle, turning wheel, spokes and an offset hand grip.
  const crankAxle = mesh(
    new THREE.CylinderGeometry(0.055, 0.055, 0.42, 20),
    metal,
    1.84,
    0,
    0,
  );
  crankAxle.rotation.z = Math.PI / 2;
  const crankRotor = new THREE.Group();
  crankRotor.position.set(2.04, 0, 0);
  staticGroup.add(crankRotor);
  const wheel = new THREE.Mesh(
    new THREE.TorusGeometry(0.4, 0.028, 10, 48),
    metal,
  );
  wheel.rotation.y = Math.PI / 2;
  crankRotor.add(wheel);
  for (let i = 0; i < 3; i++) {
    const spoke = new THREE.Mesh(
      new THREE.BoxGeometry(0.035, 0.035, 0.78),
      metal,
    );
    spoke.rotation.x = (i * Math.PI) / 3;
    crankRotor.add(spoke);
  }
  const grip = new THREE.Mesh(
    new THREE.CylinderGeometry(0.065, 0.065, 0.25, 20),
    bright,
  );
  grip.rotation.z = Math.PI / 2;
  grip.position.set(0.14, 0.4, 0);
  crankRotor.add(grip);
  // Open frame leaves the bottom chute unobstructed. A solid central plinth
  // would intersect both the vertical drop and the curved outlet.
  for (const x of [-1.67, 1.67]) {
    mesh(new THREE.BoxGeometry(0.55, 0.12, 0.9), dark, x, -2.6, -0.24);
    mesh(new THREE.BoxGeometry(0.46, 0.025, 0.8), bright, x, -2.53, -0.24);
  }
  mesh(new THREE.BoxGeometry(3.25, 0.12, 0.12), metal, 0, -2.54, -0.65);
  mesh(new THREE.BoxGeometry(1.2, 0.25, 0.05), dark, 0, -2.44, -0.55);
  // Open gate at the lowest point. The chute and the ball share this exact
  // downhill path; there is no overhead duct or upward extraction segment.
  const intake = mesh(
    new THREE.TorusGeometry(0.36, 0.035, 12, 40),
    bright,
    0,
    -1.49,
    0,
  );
  intake.rotation.x = Math.PI / 2;
  const gate = mesh(
    new THREE.CylinderGeometry(0.34, 0.34, 0.035, 40),
    dark,
    0,
    -1.49,
    0,
  );
  let gateOpening = 0;
  class OutletCurve extends THREE.Curve<THREE.Vector3> {
    constructor() {
      super();
    }
    getPoint(t: number, target = new THREE.Vector3()) {
      const p = exitPose(0.2, 0.22 + t * 0.78);
      return target.set(p.x, p.y, p.z);
    }
  }
  const tubeCurve = new OutletCurve();
  const tube = mesh(
    new THREE.TubeGeometry(tubeCurve, 96, 0.36, 32, false),
    new THREE.MeshPhysicalMaterial({
      color: 0x91b8d7,
      roughness: 0.2,
      metalness: 0,
      transparent: true,
      opacity: 0.29,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  tube.castShadow = false;
  // Solid lower channel + clear upper cover: visibly hollow, with the token
  // traveling inside rather than through a stack of floating wire hoops.
  const lower = tube.geometry.clone();
  const normals = lower.getAttribute("normal"),
    indices = lower.getIndex()!;
  const bottomFaces: number[] = [];
  for (let i = 0; i < indices.count; i += 3) {
    const a = indices.getX(i),
      b = indices.getX(i + 1),
      c = indices.getX(i + 2);
    if ((normals.getY(a) + normals.getY(b) + normals.getY(c)) / 3 < -0.12)
      bottomFaces.push(a, b, c);
  }
  lower.setIndex(bottomFaces);
  mesh(
    lower,
    new THREE.MeshStandardMaterial({
      color: 0xb5a3d5,
      roughness: 0.65,
      side: THREE.DoubleSide,
    }),
  );
  for (const t of [0, 1]) {
    const collar = mesh(new THREE.TorusGeometry(0.375, 0.035, 12, 40), bright);
    collar.position.copy(tubeCurve.getPoint(t));
    collar.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      tubeCurve.getTangent(t),
    );
  }
  mesh(
    new THREE.CylinderGeometry(0.43, 0.32, 0.18, 40),
    dark,
    OUTLET.x,
    OUTLET.y - 0.3,
    OUTLET.z,
  );
  const cup = mesh(
    new THREE.TorusGeometry(0.41, 0.04, 10, 48),
    bright,
    OUTLET.x,
    OUTLET.y - 0.2,
    OUTLET.z,
  );
  cup.rotation.x = Math.PI / 2;
  // Ground receives soft shadows; no visible full-screen card background.
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.ShadowMaterial({ opacity: 0.13 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -2.7;
  floor.receiveShadow = true;
  scene.add(floor);
  const brandCanvas = document.createElement("canvas");
  brandCanvas.width = 512;
  brandCanvas.height = 96;
  const bc = brandCanvas.getContext("2d")!;
  bc.fillStyle = "#30243b";
  bc.font = "800 62px sans-serif";
  bc.textAlign = "center";
  bc.fillText("RASCALS", 256, 70);
  const brandTexture = new THREE.CanvasTexture(brandCanvas);
  brandTexture.colorSpace = THREE.SRGBColorSpace;
  const brand = mesh(
    new THREE.PlaneGeometry(1.05, 0.2),
    new THREE.MeshBasicMaterial({
      map: brandTexture,
      transparent: true,
      depthWrite: false,
    }),
    0,
    -2.44,
    -0.51,
  );
  brand.rotation.x = -0.06;
  const tokenGroup = new THREE.Group();
  scene.add(tokenGroup);
  type Visual = {
    group: THREE.Group;
    texture: THREE.CanvasTexture;
    material: THREE.MeshStandardMaterial;
    token: TokenObservation;
    cancelled: boolean;
  };
  let visuals: Visual[] = [],
    physics: LotteryPhysics | null = null,
    identity = "",
    lastRoll = -1,
    started = false,
    finished = false,
    raf = 0,
    previous = performance.now(),
    disposed = false,
    visible = !document.hidden,
    inViewport = true,
    populationSource: TokenObservation[] | null = null,
    population: TokenObservation[] = [],
    populationId = "",
    lastDiagnostics = -Infinity;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)"),
    pointer = new THREE.Vector2(),
    smoothPointer = new THREE.Vector2();
  const fallbackCrank = new CrankDrive();
  let fpsStart = 0,
    frameCount = 0;
  function disposeVisuals() {
    for (const v of visuals) {
      v.cancelled = true;
      v.texture.dispose();
      v.material.dispose();
      v.group.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          if (o.geometry !== ballGeometry) o.geometry.dispose();
          // The ball material is shared with this visual and disposed once.
          if (o.material !== v.material)
            (o.material as THREE.Material).dispose();
        }
      });
      tokenGroup.remove(v.group);
    }
    visuals = [];
  }
  function createVisual(token: TokenObservation, i: number, r: number): Visual {
    const group = new THREE.Group(),
      color = palette[i % palette.length];
    const surface = document.createElement("canvas");
    paintBallSurface(surface, color, tokenTicker(token.symbol));
    const texture = new THREE.CanvasTexture(surface);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.22,
      metalness: 0.025,
    });
    const ball = new THREE.Mesh(ballGeometry, material);
    ball.scale.setScalar(r);
    ball.castShadow = true;
    ball.receiveShadow = true;
    group.add(ball);
    tokenGroup.add(group);
    const v = { group, texture, material, token, cancelled: false };
    function paint(image?: HTMLImageElement) {
      if (v.cancelled || disposed) return;
      paintBallSurface(surface, color, tokenTicker(token.symbol), image);
      texture.needsUpdate = true;
    }
    const rawUrl = tokenImageUrl(token.dex?.icon ?? token.icon);
    const url =
      rawUrl && /^https?:\/\//i.test(rawUrl)
        ? `/api/token-art/${encodeURIComponent(token.mint)}`
        : rawUrl;
    if (url) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.referrerPolicy = "no-referrer";
      img.onload = () => paint(img);
      img.onerror = () => {};
      img.src = url;
    }
    return v;
  }
  function resize() {
    const r = canvas.getBoundingClientRect();
    renderer.setSize(Math.max(1, r.width), Math.max(1, r.height), false);
    camera.aspect = r.width / Math.max(r.height, 1);
    camera.updateProjectionMatrix();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  function move(e: PointerEvent) {
    if (reduced.matches || current().ambientMotion === false) return;
    const r = canvas.getBoundingClientRect();
    pointer.set(
      (e.clientX - r.left) / r.width - 0.5,
      (e.clientY - r.top) / r.height - 0.5,
    );
  }
  const leave = () => pointer.set(0, 0);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerleave", leave);
  const changeVisibility = () => {
    visible = !document.hidden && inViewport;
    previous = performance.now();
  };
  document.addEventListener("visibilitychange", changeVisibility);
  const intersection = new IntersectionObserver(
    (entries) => {
      inViewport = entries.some((entry) => entry.isIntersecting);
      changeVisibility();
    },
    { rootMargin: "100px" },
  );
  intersection.observe(canvas);
  const contextLost = (e: Event) => {
    e.preventDefault();
    failed();
  };
  canvas.addEventListener("webglcontextlost", contextLost);
  const releaseClock = new ReleaseClock();
  let lastReleaseVersion = 0;
  function render(now: number) {
    if (disposed) return;
    raf = requestAnimationFrame(render);
    const dt = visible
      ? Math.min(0.05, Math.max(0, (now - previous) / 1000))
      : 0;
    previous = now;
    if (!visible) return;
    const p = current();
    if (populationSource !== p.tokens) {
      populationSource = p.tokens;
      population = scenePopulation(p.tokens);
      populationId = population.map(tokenKey).join("|");
    }
    const id = populationId;
    if (identity !== id || !physics) {
      identity = id;
      disposeVisuals();
      physics = new LotteryPhysics(
        population.map((t) => ({
          id: tokenKey(t),
          radius: marketCapRadius(t.marketCap.value) * 1.5,
        })),
      );
      visuals = population.map((t, i) =>
        createVisual(t, i, physics!.balls[i].radius),
      );
      lastRoll = -1;
    }
    const running = ["mixing", "extracting"].includes(p.phase);
    if (running && p.roll !== lastRoll) {
      lastRoll = p.roll;
      physics.beginRoll();
      releaseClock.reset();
      started = false;
      finished = false;
    }
    if (p.phase === "reveal" && p.selected && physics.stage !== "complete")
      physics.restore(tokenKey(p.selected));
    const crank = p.crank ?? fallbackCrank;
    const braking =
      ["capturing", "extracting", "complete"].includes(physics.stage) ||
      p.phase === "reveal" ||
      (p.proximity === true &&
        releaseClock.released &&
        !crank.dragging &&
        !crank.keyboardActive);
    crank.advance(
      dt,
      running && !reduced.matches && !braking ? 1.8 : 0,
      braking,
    );
    if (running && p.proximity && !p.selected) {
      const report = releaseClock.update(
        dt,
        crank.dragging || crank.keyboardActive,
        crank.releaseVersion !== lastReleaseVersion,
      );
      lastReleaseVersion = crank.releaseVersion;
      physics.settling = releaseClock.released;
      physics.hold = releaseClock.submitted;
      canvas.dataset.releaseStage = releaseClock.submitted
        ? "verifying"
        : releaseClock.released
          ? "settling"
          : "mixing";
      canvas.dataset.releaseElapsed = String(releaseClock.elapsedMs);
      if (report) p.onReleaseSelection?.(report);
    }
    crank.settlingMs =
      p.proximity && running && releaseClock.released && !p.selected
        ? Math.max(0, SETTLE_MS - releaseClock.elapsedMs)
        : null;
    physics.setRotation(crank.speed, crank.aligned);
    drum.rotation.x = crank.angle;
    crankRotor.rotation.x = crank.angle;
    if (
      running ||
      Math.abs(crank.speed) > 0.02 ||
      (!reduced.matches && p.ambientMotion !== false)
    )
      physics.advance(
        dt,
        p.selected ? tokenKey(p.selected) : null,
        reduced.matches,
      );
    if (!running && p.phase === "idle" && physics.stage !== "idle") {
      physics = new LotteryPhysics(
        population.map((t) => ({
          id: tokenKey(t),
          radius: marketCapRadius(t.marketCap.value) * 1.5,
        })),
      );
    }
    if (running && physics.stage === "capturing" && !started) {
      started = true;
      p.onExtractionStart?.();
    }
    if (running && physics.stage === "complete" && !finished && p.selected) {
      finished = true;
      p.onExtracted?.(p.selected.mint, p.roll);
    }
    physics.balls.forEach((b, i) => {
      const v = visuals[i];
      if (!v) return;
      v.group.position.set(
        b.body.position.x,
        b.body.position.y,
        b.body.position.z,
      );
      v.group.quaternion.set(
        b.body.quaternion.x,
        b.body.quaternion.y,
        b.body.quaternion.z,
        b.body.quaternion.w,
      );
      // At the catch cup the landed token faces the viewer; inside it tumbles.
      if (b.id === physics!.selectedId && physics!.stage === "complete")
        v.group.lookAt(camera.position);
    });
    const selectedBody = physics.balls.find(
      (b) => b.id === physics!.selectedId,
    );
    // Keep the shutter open until the entire ball clears its underside.
    const gateOpen =
      (physics.stage === "capturing" || physics.captured) &&
      physics.stage !== "complete" &&
      !!selectedBody &&
      selectedBody.body.position.y + selectedBody.radius > -1.53;
    gateOpening += ((gateOpen ? 1 : 0) - gateOpening) * Math.min(1, dt * 15);
    gate.position.x = -0.72 * gateOpening;
    smoothPointer.lerp(pointer, 0.06);
    const wide = camera.aspect > 1.25,
      scale = wide ? 1 : 1.08;
    camera.position.set(
      (3.2 + smoothPointer.x * 0.5) * scale,
      (1.65 - smoothPointer.y * 0.3) * scale,
      (7.2 + Math.max(0, 1.05 - camera.aspect) * 4) * scale,
    );
    camera.lookAt(0.35, -0.5, 0.15);
    if (p.selected)
      canvas.dataset.releaseStage =
        physics.stage === "complete" ? "landed" : "releasing";
    else if (p.phase === "idle") {
      canvas.dataset.releaseStage = "idle";
      canvas.dataset.releaseElapsed = "0";
    }
    if (
      now - lastDiagnostics >= 100 ||
      canvas.dataset.drawStage !== physics.stage
    ) {
      lastDiagnostics = now;
      canvas.dataset.drawStage = physics.stage;
      canvas.dataset.renderer = "webgl";
      canvas.dataset.exit = "bottom";
      canvas.dataset.crankSpeed = String(crank.speed);
      canvas.dataset.drumAngle = String(crank.angle);
      canvas.dataset.meanBallSpeed = String(
        physics.balls.reduce((sum, b) => sum + b.body.velocity.length(), 0) /
          Math.max(1, physics.balls.length),
      );
      canvas.dataset.gateOpen = String(gateOpening > 0.5);
      canvas.dataset.selectedY = selectedBody
        ? String(selectedBody.body.position.y)
        : "";
      canvas.dataset.extractionProgress = String(physics.progress);
      canvas.dataset.captureDistance = String(physics.captured ? 0 : -1);
      canvas.dataset.selectedId = physics.selectedId ?? "";
      canvas.dataset.ballCount = String(physics.balls.length);
      canvas.dataset.ballSurface = "spherical-texture";
      canvas.dataset.topBallY = String(
        Math.max(...physics.balls.map((b) => b.body.position.y)),
      );
      canvas.dataset.verticalSpan = String(
        Math.max(...physics.balls.map((b) => b.body.position.y)) -
          Math.min(...physics.balls.map((b) => b.body.position.y)),
      );
      canvas.dataset.ballSizes = physics.balls
        .map((b, i) => `${population[i]?.symbol}:${b.radius.toFixed(3)}`)
        .join(",");
    }
    frameCount++;
    if (now - fpsStart > 1000) {
      canvas.dataset.fps = String(
        Math.round((frameCount * 1000) / (now - fpsStart)),
      );
      fpsStart = now;
      frameCount = 0;
    }
    // Dynamic shadows need not be recomputed on every display refresh.
    if (now - lastShadowUpdate >= 1000 / 30) {
      renderer.shadowMap.needsUpdate = true;
      lastShadowUpdate = now;
    }
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(render);
  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    observer.disconnect();
    intersection.disconnect();
    document.removeEventListener("visibilitychange", changeVisibility);
    canvas.removeEventListener("pointermove", move);
    canvas.removeEventListener("pointerleave", leave);
    canvas.removeEventListener("webglcontextlost", contextLost);
    disposeVisuals();
    const materials = new Set<THREE.Material>(),
      geometries = new Set<THREE.BufferGeometry>();
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        geometries.add(o.geometry);
        for (const m of Array.isArray(o.material) ? o.material : [o.material])
          materials.add(m);
      }
    });
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    ballGeometry.dispose();
    brandTexture.dispose();
    renderer.dispose();
  };
}
