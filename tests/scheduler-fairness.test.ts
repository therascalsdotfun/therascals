import { expect, it } from "vitest";
import { RequestScheduler } from "../apps/server/src/routes/eligibility.ts";
it("makes background progress despite a burst of priority requests", async () => {
  let release!: () => void;
  const queue = new RequestScheduler(0),
    gate = new Promise<void>((r) => (release = r)),
    order: string[] = [];
  const first = queue.run(() => gate);
  const background = queue.run(async () => {
    order.push("background");
  });
  const urgent = Array.from({ length: 8 }, (_, i) =>
    queue.run(async () => {
      order.push("urgent" + i);
    }, 2),
  );
  release();
  await first;
  await background;
  await Promise.all(urgent);
  expect(order.indexOf("background")).toBeLessThanOrEqual(3);
});
