import { it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MarketStore } from "../apps/server/src/market/store.ts";
import { normalizeJupiter } from "../apps/server/src/market/model.ts";
const token = (
  time: number,
  symbol = "SAME",
  id = "DjggwaPYk1bk1FvET7rFwDXJ9vwYNDZAAxQ9XgyMsc7y",
) =>
  normalizeJupiter(
    { id, symbol, decimals: 6, updatedAt: new Date(time).toISOString() },
    time,
  )!;
const row = (time: number, symbol: string, id: string) => ({
  ...token(time, symbol),
  id,
  mint: id,
});
it("reuses unchanged immutable observations across small refreshes with SQL-equivalent ordering", () => {
  const s = new MarketStore(":memory:");
  const a = row(1000, "A", "a"),
    b = row(2000, "B", "b");
  s.upsert([a, b]);
  const before = s.all();
  s.upsert([
    { ...a, sourceUpdatedAt: new Date(3000).toISOString(), symbol: "UPDATED" },
  ]);
  const after = s.all();
  expect(after.map((t) => t.symbol)).toEqual(["UPDATED", "B"]);
  expect(after[1]).toBe(before[0]);
  expect(before[1].symbol).toBe("A");
  expect(Object.isFrozen(after[0].price)).toBe(true);
  s.upsert([row(3000, "C", "c"), row(3000, "AA", "aa")]);
  expect(s.all().map((t) => t.id)).toEqual(["a", "aa", "c", "b"]);
  s.close();
});
it("does not lose another writer's changes when refreshing a warm local cache", () => {
  const dir = mkdtempSync(join(tmpdir(), "jackpot-cache-merge-")),
    file = join(dir, "market.db");
  const a = new MarketStore(file),
    b = new MarketStore(file);
  try {
    a.upsert([row(1000, "A", "a")]);
    a.all();
    b.upsert([row(2000, "B", "b")]);
    a.upsert([row(3000, "C", "c")]);
    expect(a.all().map((t) => t.symbol)).toEqual(["C", "B", "A"]);
  } finally {
    a.close();
    b.close();
    rmSync(dir, { recursive: true });
  }
});
it("refreshes cached observations after writes from another connection", () => {
  const dir = mkdtempSync(join(tmpdir(), "jackpot-store-"));
  const reader = new MarketStore(join(dir, "market.db"));
  const writer = new MarketStore(join(dir, "market.db"));
  try {
    expect(reader.all()).toEqual([]);
    writer.upsert([token(1000)]);
    expect(reader.all()[0].symbol).toBe("SAME");
    const detached = reader.all();
    detached.pop();
    expect(reader.all()).toHaveLength(1);
    writer.upsert([token(2000, "CHANGED")]);
    expect(reader.all()[0].symbol).toBe("CHANGED");
    writer.prune(1500);
    expect(reader.all()).toEqual([]);
  } finally {
    reader.close();
    writer.close();
    rmSync(dir, { recursive: true });
  }
});
it("deduplicates by mint, preserves first observation and rejects older source data", () => {
  const s = new MarketStore(":memory:");
  s.upsert([token(1000)]);
  s.upsert([token(2000, "NEW")]);
  s.upsert([token(500, "OLD")]);
  expect(s.all()).toHaveLength(1);
  expect(s.all()[0].symbol).toBe("NEW");
  expect(s.all()[0].firstObservedAt).toBe("1970-01-01T00:00:01.000Z");
  s.close();
});
it("preserves different mints with the same symbol and prunes expired observations", () => {
  const s = new MarketStore(":memory:");
  s.upsert([
    token(1000),
    token(2000, "SAME", "So11111111111111111111111111111111111111112"),
  ]);
  const before = s.all();
  expect(before).toHaveLength(2);
  s.prune(1500);
  expect(s.all()).toHaveLength(1);
  expect(s.all()[0]).toBe(before[0]);
  expect(before).toHaveLength(2);
  s.close();
});
it("does not preserve a stale cache across pruning after another writer updates a surviving token", () => {
  const dir = mkdtempSync(join(tmpdir(), "jackpot-prune-")),
    file = join(dir, "market.db"),
    a = new MarketStore(file),
    b = new MarketStore(file);
  try {
    a.upsert([row(1000, "EXPIRED", "a"), row(2000, "OLD", "b")]);
    a.all();
    b.upsert([row(3000, "NEW", "b")]);
    a.prune(1500);
    expect(a.all().map((t) => t.symbol)).toEqual(["NEW"]);
  } finally {
    a.close();
    b.close();
    rmSync(dir, { recursive: true });
  }
});
it("retains established creation history across newer pools and missing fields, and fills unknown history", () => {
  const s = new MarketStore(":memory:"),
    old = token(1000),
    newer = token(2000);
  old.mintCreatedAt = new Date(0).toISOString();
  old.firstPoolCreatedAt = new Date(100).toISOString();
  old.firstPoolId = "original";
  newer.mintCreatedAt = new Date(1800).toISOString();
  newer.firstPoolCreatedAt = new Date(1900).toISOString();
  newer.firstPoolId = "replacement";
  s.upsert([old]);
  s.upsert([newer]);
  expect(s.all()[0].mintCreatedAt).toBe(old.mintCreatedAt);
  expect(s.all()[0].firstPoolCreatedAt).toBe(old.firstPoolCreatedAt);
  expect(s.all()[0].firstPoolId).toBe("original");
  s.upsert([token(3000)]);
  expect(s.all()[0].firstPoolCreatedAt).toBe(old.firstPoolCreatedAt);
  const unknown = token(
    4000,
    "UNKNOWN",
    "So11111111111111111111111111111111111111112",
  );
  s.upsert([unknown]);
  s.upsert([
    {
      ...unknown,
      sourceUpdatedAt: new Date(5000).toISOString(),
      mintCreatedAt: new Date(200).toISOString(),
    },
  ]);
  expect(s.all().find((t) => t.symbol === "UNKNOWN")!.mintCreatedAt).toBe(
    new Date(200).toISOString(),
  );
  s.close();
});
