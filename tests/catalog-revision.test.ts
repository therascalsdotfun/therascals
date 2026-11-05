import { expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MarketStore } from "../apps/server/src/market/store.ts";
import { normalizeJupiter } from "../apps/server/src/market/model.ts";
it("keeps parsed token objects across other-connection record writes but immediately sees token updates and deletes", () => {
  const dir = mkdtempSync(join(tmpdir(), "catalog-version-"));
  const a = new MarketStore(join(dir, "data.sqlite")),
    b = new MarketStore(a.file),
    reader = new MarketStore(a.file, true);
  try {
    const now = Date.now();
    const token = normalizeJupiter(
      {
        id: "So11111111111111111111111111111111111111112",
        decimals: 6,
        symbol: "A",
        name: "A",
        updatedAt: new Date(now).toISOString(),
      },
      now,
    )!;
    a.upsert([token]);
    const initial = reader.all()[0];
    b.putRecord("visitor:unrelated", { expires: now + 60000 });
    expect(reader.all()[0]).toBe(initial);
    b.upsert([
      {
        ...token,
        symbol: "B",
        sourceUpdatedAt: new Date(now + 1).toISOString(),
      },
    ]);
    expect(reader.all()[0].symbol).toBe("B");
    expect(reader.all()[0]).not.toBe(initial);
    a.prune(now + 10);
    expect(reader.all()).toEqual([]);
  } finally {
    reader.close();
    a.close();
    b.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("rolls back an interrupted batch instead of publishing a partial catalog revision", () => {
  const dir = mkdtempSync(join(tmpdir(), "catalog-batch-")),
    store = new MarketStore(join(dir, "data.sqlite")),
    reader = new MarketStore(store.file, true);
  try {
    const now = Date.now(),
      token = normalizeJupiter(
        {
          id: "So11111111111111111111111111111111111111112",
          decimals: 6,
          symbol: "Original",
          updatedAt: new Date(now).toISOString(),
        },
        now,
      )!;
    store.upsert([token]);
    const version = store.catalogVersion();
    expect(() =>
      store.upsert([
        { ...token, symbol: "Partial" },
        { ...token, id: "broken", firstObservedAt: "invalid-date" },
      ]),
    ).toThrow();
    expect(store.catalogVersion()).toBe(version);
    expect(reader.all()[0].symbol).toBe("Original");
    expect(store.all()[0].symbol).toBe("Original");
  } finally {
    reader.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
