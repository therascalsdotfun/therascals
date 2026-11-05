import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { registerPerps } from "../apps/server/src/perps/http.ts";
import { WalletAuthService } from "../apps/server/src/auth/service.ts";
import type { WalletIdentity } from "../packages/shared/src/wallet-auth.ts";

const identity: WalletIdentity = {
  kind: "metamask",
  address: "0x1111111111111111111111111111111111111111",
  chainId: "0x66eee",
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
};

function fakePerps() {
  return {
    network: "testnet",
    catalog: vi.fn(async () => ({
      network: "testnet",
      markets: [],
      minNotional: 10,
      defaultAmountCap: 10,
      maxAmountCap: 25,
      defaultCloseSeconds: 60,
      closeOptions: [30, 60, 300, null],
    })),
    agentStatus: vi.fn(async () => ({ approved: false })),
    prepareAgent: vi.fn(() => ({ agentAddress: "0x" + "22".repeat(20) })),
    approveAgent: vi.fn(async () => ({ approved: true })),
    revokeAgent: vi.fn(async () => ({ approved: false, agentAddress: null })),
    startSpin: vi.fn(async (_identity, input) => ({ spinId: "spin", input })),
    reveal: vi.fn(() => ({ spinId: "spin" })),
    open: vi.fn(async () => ({ id: "spin", phase: "open" })),
    list: vi.fn(async () => []),
    close: vi.fn(async () => ({ id: "spin", phase: "closed" })),
  };
}

async function appWith(wallet: WalletIdentity | null) {
  const app = Fastify();
  const perps = fakePerps();
  registerPerps(app, perps as any, () => wallet, new WalletAuthService());
  await app.ready();
  return { app, perps };
}

describe("perps HTTP routes", () => {
  it("serves the public catalog and enforces verified-wallet routes", async () => {
    const { app } = await appWith(null);
    expect((await app.inject("/api/perps/catalog")).statusCode).toBe(200);
    const unauthorized = await app.inject("/api/perps/agent");
    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.json().code).toBe("AUTH_REQUIRED");
    await app.close();
  });

  it("validates spin bodies and passes the exact parameters through", async () => {
    const { app, perps } = await appWith(identity);
    const invalid = await app.inject({
      method: "POST",
      url: "/api/perps/spin",
      payload: { universe: "perp", amountCap: 99, closeSeconds: 60 },
    });
    expect(invalid.statusCode).toBe(400);
    expect(perps.startSpin).not.toHaveBeenCalled();

    const valid = await app.inject({
      method: "POST",
      url: "/api/perps/spin",
      payload: {
        universe: "meme",
        amountCap: 10,
        closeSeconds: 30,
        clientSeedHash: "b".repeat(64),
      },
    });
    expect(valid.statusCode).toBe(200);
    expect(perps.startSpin).toHaveBeenCalledWith(identity, {
      universe: "meme",
      amountCap: 10,
      closeSeconds: 30,
      clientSeedHash: "b".repeat(64),
    });
    await app.close();
  });

  it("rejects malformed IDs and empty mutation bodies", async () => {
    const { app } = await appWith(identity);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/perps/spin/not-a-uuid/reveal",
          payload: {},
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/perps/spin/00000000-0000-4000-8000-000000000000/open",
          payload: { amountCap: 25 },
        })
      ).statusCode,
    ).toBe(400);
    await app.close();
  });

  it("revokes the trading agent only for the verified wallet and an empty body", async () => {
    const { app, perps } = await appWith(identity);
    const revoked = await app.inject({
      method: "POST",
      url: "/api/perps/agent/revoke",
      payload: {},
    });
    expect(revoked.statusCode).toBe(200);
    expect(perps.revokeAgent).toHaveBeenCalledWith(identity);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/perps/agent/revoke",
          payload: { agentAddress: "0x" + "33".repeat(20) },
        })
      ).statusCode,
    ).toBe(400);
    await app.close();

    const anonymous = await appWith(null);
    expect(
      (
        await anonymous.app.inject({
          method: "POST",
          url: "/api/perps/agent/revoke",
          payload: {},
        })
      ).statusCode,
    ).toBe(401);
    expect(anonymous.perps.revokeAgent).not.toHaveBeenCalled();
    await anonymous.app.close();
  });

  it("accepts a bounded custom token pool and rejects duplicate or incomplete pools", async () => {
    const { app, perps } = await appWith(identity);
    const payload = {
      universe: "custom",
      marketNames: ["BTC", "WIF"],
      amountCap: 10,
      closeSeconds: 60,
      clientSeedHash: "b".repeat(64),
    };
    expect(
      (await app.inject({ method: "POST", url: "/api/perps/spin", payload }))
        .statusCode,
    ).toBe(200);
    expect(perps.startSpin).toHaveBeenCalledWith(identity, payload);
    for (const marketNames of [
      undefined,
      ["BTC"],
      ["BTC", "BTC"],
      Array.from({ length: 33 }, (_, i) => "T" + i),
    ]) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/perps/spin",
            payload: { ...payload, marketNames },
          })
        ).statusCode,
      ).toBe(400);
    }
    await app.close();
  });

  it("requires a signed approval payload shape", async () => {
    const { app, perps } = await appWith(identity);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/perps/agent/approve",
          payload: { signature: "0x1234", nonce: 1 },
        })
      ).statusCode,
    ).toBe(400);
    expect(perps.approveAgent).not.toHaveBeenCalled();
    await app.close();
  });
});
