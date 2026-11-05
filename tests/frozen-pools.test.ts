import { expect, it } from "vitest";
import { FrozenPools } from "../apps/server/src/market/frozen-pools.ts";
it("holds previously served membership across live reorder/removal, but not configuration changes or expiry", () => {
  let now = 100000;
  const cache = new FrozenPools(() => now);
  const original: any = {
    configurationHash: "A",
    pool: [{ mint: "a" }, { mint: "b" }, { mint: "c" }],
    filters: { chains: ["solana"] },
    ticketAtomic: "1000000",
    now: new Date(now).toISOString(),
  };
  cache.remember(original);
  original.pool[0].mint = "changed";
  const current = { ...original, pool: [{ mint: "x" }, { mint: "y" }] };
  cache.remember(current);
  expect(cache.resolve(current, ["b", "a"]).pool.map((t) => t.mint)).toEqual([
    "b",
    "a",
  ]);
  expect(() =>
    cache.resolve({ ...current, configurationHash: "other" }, ["a", "b"]),
  ).toThrow("expired");
  expect(() => cache.resolve(current, ["a", "unseen"])).toThrow("expired");
  expect(() => cache.resolve(current, ["a", "a"])).toThrow("population");
  now += 120001;
  expect(() => cache.resolve(current, ["a", "b"])).toThrow("expired");
});
