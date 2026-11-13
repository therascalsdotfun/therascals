import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { registerPerpsTestnet } from "../apps/server/src/perps/http.ts";
import { NearPerpsTestnetService } from "../apps/server/src/perps/near-testnet.ts";
import { WalletAuthService } from "../apps/server/src/auth/service.ts";
import { perpsSeedHash } from "../packages/shared/src/perps.ts";
import type { WalletIdentity } from "../packages/shared/src/wallet-auth.ts";

const nearWallet: WalletIdentity = {
  kind: "near",
  address: "rascal-user.near",
  chainId: "near:mainnet",
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
};

describe("NEAR Perps Testnet × Hyperliquid Testnet routes", () => {
  it("allows any verified wallet (including NEAR) to spin, reveal, open and receive explorer + position links", async () => {
    const app = Fastify();
    const service = new NearPerpsTestnetService({
      markets: async () => [
        { name: "BTC", display: "BTC", universe: "perp", maxLeverage: 40, szDecimals: 5 },
        { name: "SOL", display: "SOL", universe: "perp", maxLeverage: 20, szDecimals: 2 },
      ],
      markPrice: async (coin) => (coin === "BTC" ? 95000 : 195),
    });
    vi.spyOn(service as any, "settleNearTestnetOpen").mockResolvedValue({
      txHash: "9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e",
      explorerUrl:
        "https://testnet.nearblocks.io/txns/9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e",
      settlementAccount: "rascals-fees-80f33cf4.testnet",
      settlementContract: "vault.rascals-fees-80f33cf4.testnet",
    });

    registerPerpsTestnet(app, () => nearWallet, new WalletAuthService(), service);
    await app.ready();

    const catalogRes = await app.inject("/api/perps/testnet/catalog");
    expect(catalogRes.statusCode).toBe(200);
    expect(catalogRes.json().network).toBe("testnet");
    expect(catalogRes.json().markets).toHaveLength(2);

    const agentRes = await app.inject("/api/perps/testnet/agent");
    expect(agentRes.statusCode).toBe(200);
    expect(agentRes.json().approved).toBe(true);

    const clientSeed = "a".repeat(64);
    const spinRes = await app.inject({
      method: "POST",
      url: "/api/perps/testnet/spin",
      payload: {
        universe: "custom",
        marketNames: ["BTC", "SOL"],
        amountCap: 10,
        closeSeconds: 60,
        clientSeedHash: perpsSeedHash(clientSeed),
      },
    });
    expect(spinRes.statusCode).toBe(200);
    const { spinId } = spinRes.json();

    const revealRes = await app.inject({
      method: "POST",
      url: `/api/perps/testnet/spin/${spinId}/reveal`,
      payload: { clientSeed },
    });
    expect(revealRes.statusCode).toBe(200);

    const openRes = await app.inject({
      method: "POST",
      url: `/api/perps/testnet/spin/${spinId}/open`,
      payload: {},
    });
    expect(openRes.statusCode).toBe(200);
    const opened = openRes.json();
    expect(opened.phase).toBe("open");
    expect(opened.txHash).toBe("9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e");
    expect(opened.explorerUrl).toContain("https://testnet.nearblocks.io/txns/");
    expect(opened.nearPerpsUrl).toBe("https://perps.near.com/");
    expect(opened.hyperliquidPositionUrl).toContain(
      "https://app.hyperliquid-testnet.xyz/trade/",
    );

    await app.close();
  });
});
