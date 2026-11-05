import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MarketStore } from "../apps/server/src/market/store.ts";
import {
  ephemeralRecords,
  startRecordRetention,
} from "../apps/server/src/market/retention.ts";

const HOUR = 3_600_000,
  DAY = 24 * HOUR;

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), "jackpot-retention-")),
    file = join(dir, "state.sqlite");
  return { file, close: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("record retention", () => {
  afterEach(() => vi.useRealTimers());

  it("adds writtenAt to a database from the previous schema and keeps its rows", () => {
    const f = tempDb();
    const legacy = new DatabaseSync(f.file);
    legacy.exec(
      "CREATE TABLE records (id TEXT PRIMARY KEY, data TEXT NOT NULL)",
    );
    legacy
      .prepare("INSERT INTO records(id,data) VALUES(?,?)")
      .run("roll:old", JSON.stringify({ kept: true }));
    legacy.close();

    const store = new MarketStore(f.file);
    expect(store.getRecord("roll:old")).toEqual({ kept: true });
    expect(store.recordCount()).toBe(1);
    // Existing rows are aged from the upgrade, so nothing looks ancient on boot.
    expect(
      store.sweepRecords([{ prefix: "roll:", ttlMs: HOUR }], Date.now()),
    ).toBe(0);
    store.close();
    f.close();
  });

  it("ages each throwaway prefix on its own clock and never touches history", () => {
    const f = tempDb(),
      store = new MarketStore(f.file),
      written = Date.now();
    for (const id of [
      "roll:1",
      "roll:2",
      "preview-00000000-0000-4000-8000-000000000000",
      "perps-spin:1",
      "beta-claims:v4:203.0.113.0/24:2026-10-30",
      "beta-funding:beta01:2026-10-30",
      "outbox:5Qe2",
      "fill:5Qe2",
      "points:account:abc",
      "points:ticket:t1",
      "drawdown:sol:abc",
      "op:1",
    ])
      store.putRecord(id, { id });

    // Three hours on: the rolls and the legacy preview rows are out of date.
    expect(store.sweepRecords(ephemeralRecords, written + 3 * HOUR)).toBe(3);
    expect(store.getRecord("perps-spin:1")).not.toBeNull();
    expect(
      store.getRecord("beta-claims:v4:203.0.113.0/24:2026-10-30"),
    ).not.toBeNull();

    // A day and a bit on: the abandoned spin goes, the daily counters stay.
    expect(store.sweepRecords(ephemeralRecords, written + 26 * HOUR)).toBe(1);
    expect(store.getRecord("beta-funding:beta01:2026-10-30")).not.toBeNull();

    // Forty days on: the counters go too. Nothing is swept twice.
    expect(store.sweepRecords(ephemeralRecords, written + 40 * DAY)).toBe(2);
    expect(store.sweepRecords(ephemeralRecords, written + 60 * DAY)).toBe(0);

    // Signatures, spend evidence and positions are records of money, and a
    // drawdown row has to survive to keep its token disqualified.
    expect(store.getRecord("outbox:5Qe2")).not.toBeNull();
    expect(store.getRecord("fill:5Qe2")).not.toBeNull();
    expect(store.getRecord("points:account:abc")).not.toBeNull();
    expect(store.getRecord("points:ticket:t1")).not.toBeNull();
    expect(store.getRecord("drawdown:sol:abc")).not.toBeNull();
    expect(store.getRecord("op:1")).not.toBeNull();
    store.close();
    f.close();
  });

  it("keeps money, evidence and ownership prefixes out of the shipped list", () => {
    for (const guarded of [
      "op:1",
      "execution-current",
      "fill:5Qe2",
      "outbox:5Qe2",
      "drawdown:sol:abc",
      "points:account:abc",
      "intents-op:1",
      "intents-funding:1",
      "perps-op:1",
      "perps-agent:testnet:abc",
      "beta-owner:beta01",
    ])
      expect(
        ephemeralRecords.some(
          (rule) =>
            guarded.startsWith(rule.prefix) || rule.prefix.startsWith(guarded),
        ),
        guarded + " must never be aged out",
      ).toBe(false);
  });

  it("keeps a record alive while it is still being written", () => {
    const f = tempDb(),
      store = new MarketStore(f.file);
    vi.useFakeTimers();
    store.putRecord("roll:active", { phase: "committed" });
    vi.advanceTimersByTime(90 * 60_000);
    store.putRecord("roll:active", { phase: "settled" });
    vi.advanceTimersByTime(90 * 60_000);
    // Two hours since the last write, not the first.
    expect(store.sweepRecords([{ prefix: "roll:", ttlMs: 2 * HOUR }])).toBe(0);
    expect(store.getRecord("roll:active")).toEqual({ phase: "settled" });
    vi.advanceTimersByTime(2 * HOUR);
    expect(store.sweepRecords([{ prefix: "roll:", ttlMs: 2 * HOUR }])).toBe(1);
    store.close();
    f.close();
  });

  it("sweeps at boot and on the interval until stopped", () => {
    const f = tempDb(),
      store = new MarketStore(f.file),
      reports: [number, number][] = [];
    vi.useFakeTimers();
    store.putRecord("roll:a", {});
    const stop = startRecordRetention(store, (removed, remaining) =>
      reports.push([removed, remaining]),
    );
    expect(store.getRecord("roll:a")).not.toBeNull();
    // Nothing was aged at boot, so the operator hears nothing.
    expect(reports).toEqual([]);
    vi.advanceTimersByTime(3 * HOUR);
    expect(store.getRecord("roll:a")).toBeNull();
    expect(reports).toEqual([[1, 0]]);
    store.putRecord("roll:b", {});
    stop();
    vi.advanceTimersByTime(3 * HOUR);
    expect(store.getRecord("roll:b")).not.toBeNull();
    store.close();
    f.close();
  });
});
