import { expect, it } from "vitest";
import { DrawdownGuard } from "../apps/server/src/market/drawdown.ts";
import { MarketStore } from "../apps/server/src/market/store.ts";
import { MarketService } from "../apps/server/src/market/service.ts";
import { normalizeJupiter } from "../apps/server/src/market/model.ts";
const mint = "11111111111111111111111111111111";
const raw = (price: number, at: number) => ({
  id: mint,
  symbol: "SYN",
  name: "Synthetic",
  decimals: 6,
  usdPrice: price,
  updatedAt: new Date(at).toISOString(),
});
const token = (price: number, at: number) =>
  normalizeJupiter(raw(price, at), at)!;
it("quarantines a 90% observed loss and persists through recovery/restart without comparing chains", () => {
  let now = Date.now();
  const store = new MarketStore(":memory:");
  try {
    const guard = new DrawdownGuard(store, () => now);
    guard.observe([token(10, now)]);
    now += 1000;
    guard.observe([token(1.01, now)]);
    expect(guard.evidence(mint)).toBeUndefined();
    now += 1000;
    guard.observe([token(1, now)]);
    expect(guard.evidence(mint)?.dropFraction).toBeCloseTo(0.9);
    now += 1000;
    guard.observe([token(30, now)]);
    const reloaded = new DrawdownGuard(store, () => now);
    expect(reloaded.evidence(mint)?.observed.price).toBe(1);
    expect(reloaded.evidence("base:" + mint)).toBeUndefined();
  } finally {
    store.close();
  }
});
it("ignores stale/future/zero/out-of-order prices, old peaks and changed source/pool identities", () => {
  let now = Date.now();
  const store = new MarketStore(":memory:");
  try {
    const guard = new DrawdownGuard(store, () => now);
    guard.observe([token(10, now)]);
    for (const observation of [
      token(0.1, now - 121000),
      token(0.1, now + 1),
      token(0, now),
    ])
      guard.observe([observation]);
    expect(guard.evidence(mint)).toBeUndefined();
    now += 86400000;
    guard.observe([token(0.1, now)]);
    expect(guard.evidence(mint)).toBeUndefined();
    const changed = token(0.001, now);
    changed.price.source = "dexscreener";
    guard.observe([changed]);
    expect(guard.evidence(mint)).toBeUndefined();
    const pooled = token(0.00001, now + 1);
    pooled.price.scope = "pool";
    now++;
    guard.observe([pooled]); // no exact pool identity => do not compare.
    expect(guard.evidence(mint)).toBeUndefined();
  } finally {
    store.close();
  }
});
it("rejects quarantined tokens in screening and frozen previews, including after service restart", () => {
  const store = new MarketStore(":memory:");
  try {
    const at = Date.now() - 1000,
      guard = new DrawdownGuard(store);
    guard.observe([token(10, at), token(1, at + 1)]);
    const service = new MarketService(store);
    expect(
      (service as any).screeningReasons(token(1, at), Date.now()),
    ).toContain("severe_drawdown_quarantine");
    expect(() => service.frozenSnapshot([mint, "other"])).toThrow(
      "quarantined",
    );
  } finally {
    store.close();
  }
});
