import { describe, expect, it } from "vitest";
import { MarketStore } from "../apps/server/src/market/store.ts";
import { CommunityPresets, PresetError } from "../apps/server/src/presets/service.ts";
import { encodeFilterCode } from "../packages/shared/src/filter-code.ts";
import { DEFAULT_FILTERS } from "../apps/server/src/market/model.ts";

const alice = { kind: "phantom" as const, address: "11111111111111111111111111111111", expiresAt: "2099-01-01" };
const bob = { ...alice, address: "So11111111111111111111111111111111111111112" };
const filters = { ...DEFAULT_FILTERS };
const code = encodeFilterCode(filters);
const other = { ...DEFAULT_FILTERS, minLiquidity: 987654 };

function fixture() {
  let now = Date.parse("2026-11-05T00:00:00Z");
  const store = new MarketStore(":memory:");
  const presets = new CommunityPresets(store, () => now);
  const publish = (user = alice, requestId = crypto.randomUUID()) =>
    presets.publish(user, { requestId, title: "Calm degen", code });
  return { presets, publish, advance: (ms: number) => (now += ms) };
}

describe("community presets", () => {
  it("publishes idempotently and hides owner internals", () => {
    const { presets, publish } = fixture();
    const requestId = crypto.randomUUID();
    const first = publish(alice, requestId);
    expect(publish(alice, requestId).id).toBe(first.id);
    expect(first).not.toHaveProperty("owner");
    expect(presets.list().presets).toHaveLength(1);
    expect(presets.list().rewardPolicy).toBe("not_enabled");
  });
  it("rejects a reused request id for different content", () => {
    const { presets, publish } = fixture();
    const requestId = crypto.randomUUID();
    publish(alice, requestId);
    expect(() => presets.publish(alice, { requestId, title: "Other", code })).toThrow(PresetError);
  });
  it("rejects bad titles and codes", () => {
    const { presets } = fixture();
    for (const title of ["", " ", "x".repeat(61), "bad\ntitle"])
      expect(() => presets.publish(alice, { requestId: crypto.randomUUID(), title, code })).toThrow();
    expect(() => presets.publish(alice, { requestId: crypto.randomUUID(), title: "ok", code: "nonsense" })).toThrow();
  });
  it("lists only the caller's presets for mine and requires a wallet", () => {
    const { presets, publish } = fixture();
    publish(alice); publish(bob);
    expect(presets.list(alice, true).presets).toHaveLength(1);
    expect(() => presets.list(undefined, true)).toThrow(PresetError);
  });
  it("only the creator can unpublish, and it leaves the public list", () => {
    const { presets, publish } = fixture();
    const p = publish(alice);
    expect(() => presets.unpublish(bob, p.id)).toThrow(/creator/);
    presets.unpublish(alice, p.id);
    expect(presets.list().presets).toHaveLength(0);
    expect(() => presets.applied(bob, p.id, filters)).toThrow(/no longer published/);
  });
  it("counts an adopting wallet once and excludes creator self-use", () => {
    const { presets, publish } = fixture();
    const p = publish(alice);
    presets.applied(alice, p.id, filters);
    presets.applied(bob, p.id, filters);
    presets.applied(bob, p.id, filters);
    expect(presets.list().presets[0]!.usage.adoptingWallets).toBe(1);
  });
  it("refuses attribution when applied settings differ from the preset", () => {
    const { presets, publish } = fixture();
    const p = publish(alice);
    expect(() => presets.applied(bob, p.id, other)).toThrow(/differ/);
  });
  it("counts a completed reveal once per roll and a qualified use once per wallet-day", () => {
    const { presets, publish, advance } = fixture();
    const p = publish(alice);
    presets.applied(bob, p.id, filters);
    presets.begin(bob, filters, "roll-1");
    presets.revealed(bob, "roll-1");
    presets.revealed(bob, "roll-1");
    presets.begin(bob, filters, "roll-2");
    presets.revealed(bob, "roll-2");
    let usage = presets.list().presets[0]!.usage;
    expect(usage).toMatchObject({ completedReveals: 2, qualifiedUses: 1 });
    advance(86_400_000);
    presets.begin(bob, filters, "roll-3");
    presets.revealed(bob, "roll-3");
    usage = presets.list().presets[0]!.usage;
    expect(usage.qualifiedUses).toBe(2);
  });
  it("ignores rolls begun after settings changed, other wallets' reveals and expired rolls", () => {
    const { presets, publish, advance } = fixture();
    const p = publish(alice);
    presets.applied(bob, p.id, filters);
    presets.begin(bob, other, "roll-edited");
    presets.revealed(bob, "roll-edited");
    presets.begin(bob, filters, "roll-b");
    presets.revealed(alice, "roll-b");
    presets.begin(bob, filters, "roll-old");
    advance(601_000);
    presets.revealed(bob, "roll-old");
    expect(presets.list().presets[0]!.usage.completedReveals).toBe(0);
  });
  it("clears attribution when applied without a preset", () => {
    const { presets, publish } = fixture();
    const p = publish(alice);
    presets.applied(bob, p.id, filters);
    presets.applied(bob, undefined, filters);
    presets.begin(bob, filters, "roll-x");
    presets.revealed(bob, "roll-x");
    expect(presets.list().presets[0]!.usage.completedReveals).toBe(0);
  });
  it("counts verified trade executions once per signature and excludes creator self-trades", () => {
    const { presets, publish } = fixture();
    const p = publish(alice);
    presets.applied(bob, p.id, filters);
    presets.begin(bob, filters, "roll-trade-1");
    presets.revealed(bob, "roll-trade-1");

    // Attributed roll executes trade:
    presets.tradeExecutedForRoll(bob, "roll-trade-1", "sig-1");
    // Duplicate submission of same signature is deduplicated:
    presets.tradeExecutedForRoll(bob, "roll-trade-1", "sig-1");
    expect(presets.list().presets[0]!.usage.executedTrades).toBe(1);

    // Second distinct trade execution:
    presets.tradeExecuted(bob, p.id, "sig-2");
    expect(presets.list().presets[0]!.usage.executedTrades).toBe(2);

    // Creator self-trade is excluded:
    presets.tradeExecuted(alice, p.id, "sig-creator");
    expect(presets.list().presets[0]!.usage.executedTrades).toBe(2);
  });
  it("supports single preset retrieval and filters out unpublished", () => {
    const { presets, publish } = fixture();
    const p = publish(alice);
    expect(presets.get(p.id).id).toBe(p.id);
    presets.unpublish(alice, p.id);
    expect(() => presets.get(p.id)).toThrow(PresetError);
  });
  it("searches presets by title or creator address and supports sorting and pagination", () => {
    const { presets, publish } = fixture();
    const p1 = presets.publish(alice, { requestId: crypto.randomUUID(), title: "Alpha Solana Gems", code });
    const p2 = presets.publish(bob, { requestId: crypto.randomUUID(), title: "Base Meme Runners", code });
    const p3 = presets.publish(alice, { requestId: crypto.randomUUID(), title: "Strict Whale Hunters", code });

    // Search by title
    expect(presets.list(undefined, { search: "Alpha" }).presets).toHaveLength(1);
    expect(presets.list(undefined, { search: "runners" }).presets[0]!.id).toBe(p2.id);

    // Search by creator address
    expect(presets.list(undefined, { search: bob.address.slice(0, 8) }).presets).toHaveLength(1);

    // Trade attribution impact on sorting
    presets.tradeExecuted(alice, p2.id, "sig-a");
    presets.tradeExecuted(alice, p2.id, "sig-b");
    presets.tradeExecuted(bob, p3.id, "sig-c");

    const byTrades = presets.list(undefined, { sort: "trades" }).presets;
    expect(byTrades[0]!.id).toBe(p2.id);
    expect(byTrades[1]!.id).toBe(p3.id);

    // Pagination
    const page1 = presets.list(undefined, { limit: 2, offset: 0 });
    expect(page1.presets).toHaveLength(2);
    expect(page1.total).toBe(3);
    const page2 = presets.list(undefined, { limit: 2, offset: 2 });
    expect(page2.presets).toHaveLength(1);
  });
});
