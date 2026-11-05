import { expect, it } from "vitest";
import { RequestScheduler } from "../apps/server/src/routes/eligibility.ts";
import { VisitorProfiles } from "../apps/server/src/beta/visitors.ts";
import { MarketStore } from "../apps/server/src/market/store.ts";
it("rejects an overloaded provider queue rather than accumulating unlimited public work", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    queue = new RequestScheduler(0);
  const first = queue.run(() => gate);
  const waiting = Array.from({ length: 64 }, () => queue.run(async () => true));
  await expect(queue.run(async () => true)).rejects.toThrow(/busy/i);
  release();
  await first;
  await Promise.all(waiting);
});
it("reserves visitor creation capacity before persisting a new profile", () => {
  const store = new MarketStore(":memory:"),
    visitors = new VisitorProfiles(store);
  expect(() =>
    visitors.resolve(undefined, () => {
      throw Error("rate limited");
    }),
  ).toThrow("rate limited");
  expect(store.records("visitor:")).toHaveLength(0);
  const a = visitors.resolve();
  expect(a.token).toBeTruthy();
  expect(
    visitors.resolve(a.token!, () => {
      throw Error("should not create");
    }).scope,
  ).toBe(a.scope);
  store.close();
});
