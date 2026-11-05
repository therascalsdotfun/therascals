import { expect, it } from "vitest";
import { DrawMotion, extractionPose } from "../apps/web/src/lottery/motion.ts";
it("cannot finish mixing before a ball exists, even when selection is late", () => {
  const motion = new DrawMotion(0);
  expect(motion.sample(10000, null, false).stage).toBe("mixing");
  expect(motion.sample(10001, "mint", false, true)).toMatchObject({
    stage: "extracting",
    progress: 0,
  });
  expect(motion.sample(11000, "mint", false, true).stage).toBe("extracting");
  expect(motion.sample(11901, "mint", false, true)).toMatchObject({
    stage: "complete",
    progress: 1,
  });
});
it("finishes only after capture, tube exit and landing, including reduced motion", () => {
  const motion = new DrawMotion(0);
  expect(motion.sample(200, "mint", false, true).stage).toBe("mixing");
  expect(motion.sample(2600, "mint", false, true).stage).toBe("extracting");
  expect(motion.sample(4499, "mint", false, true).stage).toBe("extracting");
  expect(motion.sample(4500, "mint", false, true).stage).toBe("complete");
  const reduced = new DrawMotion(0);
  reduced.sample(0, "mint", true, true);
  expect(reduced.sample(150, "mint", true, true).stage).toBe("extracting");
  expect(reduced.sample(400, "mint", true, true).stage).toBe("complete");
});
it("the extraction path visits the intake, vertical tube and outlet before landing", () => {
  const points = [
    { x: 0, y: 0, r: 10 },
    { x: 20, y: -80, r: 10 },
    { x: 20, y: -130, r: 10 },
    { x: 70, y: -130, r: 10 },
    { x: 110, y: -60, r: 12 },
    { x: 0, y: -10, r: 45 },
  ];
  expect(extractionPose(0, points)).toEqual(points[0]);
  expect(extractionPose(0.2, points)).toEqual(points[1]);
  expect(extractionPose(0.4, points)).toEqual(points[2]);
  expect(extractionPose(0.6, points)).toEqual(points[3]);
  expect(extractionPose(0.8, points)).toEqual(points[4]);
  expect(extractionPose(1, points)).toEqual(points[5]);
});

it("waits at the capture stage until the chosen ball physically reaches the intake", () => {
  const motion = new DrawMotion(0);
  expect(motion.sample(2600, "mint", false, false).stage).toBe("capturing");
  expect(motion.sample(9000, "mint", false, false).stage).toBe("capturing");
  expect(motion.sample(9100, "mint", false, true)).toMatchObject({
    stage: "extracting",
    progress: 0,
  });
  expect(motion.sample(11000, "mint", false, true).stage).toBe("complete");
});

it("the compatibility renderer also exits below the cage with no upward reveal segment", async () => {
  const { bottomCanvasExit } =
    await import("../apps/web/src/lottery/canvas-exit.ts");
  const points = bottomCanvasExit(300, 200, 180, 1);
  expect(points.at(-1)!.y).toBeGreaterThan(200 + 180);
  for (let i = 1; i < points.length; i++)
    expect(points[i].y).toBeGreaterThan(points[i - 1].y);
  let last = points[0].y;
  for (let i = 0; i <= 100; i++) {
    const pose = extractionPose(i / 100, points);
    expect(pose.y).toBeGreaterThanOrEqual(last);
    last = pose.y;
  }
});
