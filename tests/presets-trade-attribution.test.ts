import { describe, expect, it } from "vitest";
import { MarketStore } from "../apps/server/src/market/store.ts";
import { CommunityPresets } from "../apps/server/src/presets/service.ts";
import { RewardsService } from "../apps/server/src/rewards/service.ts";
import { encodeFilterCode } from "../packages/shared/src/filter-code.ts";
import { DEFAULT_FILTERS } from "../apps/server/src/market/model.ts";
import type { WalletIdentity } from "../packages/shared/src/wallet-auth.ts";

const alice: WalletIdentity = {
  kind: "phantom",
  address: "11111111111111111111111111111111",
  expiresAt: "2099-01-01T00:00:00Z",
};
const bob: WalletIdentity = {
  kind: "phantom",
  address: "So11111111111111111111111111111111111111112",
  expiresAt: "2099-01-01T00:00:00Z",
};
const charlieMetamask: WalletIdentity = {
  kind: "metamask",
  address: "0x1234567890123456789012345678901234567890",
  expiresAt: "2099-01-01T00:00:00Z",
};

const filters = { ...DEFAULT_FILTERS };
const code = encodeFilterCode(filters);

function setup() {
  let now = Date.parse("2026-11-05T12:00:00Z");
  const store = new MarketStore(":memory:");
  const presets = new CommunityPresets(store, () => now);
  const rewards = new RewardsService(
    store,
    {
      verifyMainnet: async (_identity, _ticket, sig) => ({
        volumeAtomic: "5000000",
        mint: "TokenMint11111111111111111111111111111111",
        signature: sig,
        confirmedAt: new Date(now).toISOString(),
      }),
      practiceReceipt: () => ({
        volumeAtomic: "5000000",
        mint: "TokenMint11111111111111111111111111111111",
        signature: "dummy",
        confirmedAt: new Date(now).toISOString(),
      }),
      promotionToken: async (m) => ({
        mint: m,
        symbol: "TEST",
        name: "Test Token",
        icon: null,
      }),
    },
    () => now,
  );
  const published = presets.publish(alice, {
    requestId: crypto.randomUUID(),
    title: "Multi-venue Alpha",
    code,
  });
  return { store, presets, rewards, published, advance: (ms: number) => (now += ms) };
}

describe("multi-venue trade attribution for community presets", () => {
  it("attributes verified Solana trades via reward claims and excludes self-trades", async () => {
    const { presets, rewards, published } = setup();

    // Bob adopts Alice's preset
    presets.applied(bob, published.id, filters);
    presets.begin(bob, filters, "roll-sol-1");
    presets.revealed(bob, "roll-sol-1");

    // Create a trade ticket linked to the preset
    const activePreset = presets.activeFor(bob, filters);
    expect(activePreset).toBe(published.id);

    const ticket = rewards.createTradeTicket(
      bob,
      "TokenMint11111111111111111111111111111111",
      "10000000",
      activePreset,
    );
    expect(ticket.presetId).toBe(published.id);

    // Claim reward with trade attribution hook
    const sig = "5" + "1".repeat(87);
    await rewards.claimMainnet(bob, ticket.id, sig, (t, s) => {
      if (t.presetId) presets.tradeExecuted(bob, t.presetId, s);
    });

    let current = presets.list().presets.find((p) => p.id === published.id)!;
    expect(current.usage.executedTrades).toBe(1);

    // Duplicate trade execution with same signature does not increment
    presets.tradeExecuted(bob, published.id, sig);
    current = presets.list().presets.find((p) => p.id === published.id)!;
    expect(current.usage.executedTrades).toBe(1);

    // Creator self-trade does not increment
    presets.tradeExecuted(alice, published.id, "sig-creator-self-buy");
    current = presets.list().presets.find((p) => p.id === published.id)!;
    expect(current.usage.executedTrades).toBe(1);
  });

  it("attributes verified EVM trades and deduplicates on receipt hashes", () => {
    const { presets, published } = setup();

    // Charlie adopts Alice's preset
    presets.applied(charlieMetamask, published.id, filters);
    const active = presets.activeFor(charlieMetamask);
    expect(active).toBe(published.id);

    // EVM transaction confirms on-chain
    const txHash = "0x" + "a".repeat(64);
    presets.tradeExecuted(charlieMetamask, active!, txHash);

    let current = presets.list().presets.find((p) => p.id === published.id)!;
    expect(current.usage.executedTrades).toBe(1);

    // Repeated receipt query / poll is deduplicated
    presets.tradeExecuted(charlieMetamask, active!, txHash);
    current = presets.list().presets.find((p) => p.id === published.id)!;
    expect(current.usage.executedTrades).toBe(1);

    // Second distinct EVM trade
    const txHash2 = "0x" + "b".repeat(64);
    presets.tradeExecuted(charlieMetamask, active!, txHash2);
    current = presets.list().presets.find((p) => p.id === published.id)!;
    expect(current.usage.executedTrades).toBe(2);
  });

  it("attributes NEAR Intents swap deposits with deduplication", () => {
    const { presets, published } = setup();

    // Bob adopts Alice's preset
    presets.applied(bob, published.id, filters);
    const active = presets.activeFor(bob);
    expect(active).toBe(published.id);

    // NEAR Intents deposit submitted
    const depositTxHash = "9" + "c".repeat(43);
    presets.tradeExecuted(bob, active!, depositTxHash);

    let current = presets.list().presets.find((p) => p.id === published.id)!;
    expect(current.usage.executedTrades).toBe(1);

    // Duplicate webhook / polling notification deduplicates
    presets.tradeExecuted(bob, active!, depositTxHash);
    current = presets.list().presets.find((p) => p.id === published.id)!;
    expect(current.usage.executedTrades).toBe(1);

    // Second swap deposit
    const depositTxHash2 = "8" + "d".repeat(43);
    presets.tradeExecuted(bob, active!, depositTxHash2);
    current = presets.list().presets.find((p) => p.id === published.id)!;
    expect(current.usage.executedTrades).toBe(2);
  });

  it("resolves attributed preset through roll attribution even after active settings change", () => {
    const { presets, published } = setup();

    presets.applied(bob, published.id, filters);
    presets.begin(bob, filters, "roll-multi-venue-1");
    presets.revealed(bob, "roll-multi-venue-1");

    // Bob changes active settings to custom
    presets.applied(bob, undefined, { ...filters, minLiquidity: 999999 });
    expect(presets.activeFor(bob)).toBeNull();

    // But the earlier roll's attribution is securely preserved:
    const rollPreset = presets.presetForRoll(bob, "roll-multi-venue-1");
    expect(rollPreset).toBe(published.id);

    // Executing the trade from that roll credits the original preset!
    presets.tradeExecuted(bob, rollPreset!, "0x" + "f".repeat(64));
    const current = presets.list().presets.find((p) => p.id === published.id)!;
    expect(current.usage.executedTrades).toBe(1);
  });
});
