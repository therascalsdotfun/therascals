import Fastify from "fastify";
import { expect, it, vi } from "vitest";
import { registerMainnet } from "../apps/server/src/mainnet/http.ts";
import { UserError } from "../apps/server/src/client-message.ts";
const wallet = "0x" + "1".repeat(40),
  mint = "0x" + "2".repeat(40),
  quoteId = "12345678-1234-4234-8234-123456789012";
it("rechecks the exact selected token before quote and before simulation; accepts no arbitrary calldata", async () => {
  const checked = vi.fn(async () => ({ symbol: "TINY" })),
    quote = vi.fn(async (x) => ({ id: quoteId, ...x })),
    simulate = vi.fn(async () => ({
      status: "insufficient_funds",
      message: "Add ETH",
    }));
  const app = Fastify();
  registerMainnet(app, {
    market: () => ({
      snapshot: () => ({ filters: { chains: ["base"] } }),
      revalidateEvmSelected: checked,
    }),
    rate: () => {},
    evm: {
      quote,
      get: () => ({ chain: "base", mint, wallet }),
      simulate,
    } as any,
  });
  try {
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/mainnet/evm/quote",
          payload: { chain: "base", mint, wallet, amount: "5" },
        })
      ).statusCode,
    ).toBe(200);
    expect(checked).toHaveBeenCalledWith("base", mint, { chains: ["base"] });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/mainnet/evm/simulate",
          payload: { quoteId, wallet },
        })
      ).json().status,
    ).toBe("insufficient_funds");
    expect(checked).toHaveBeenCalledTimes(2);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/mainnet/evm/simulate",
          payload: { quoteId, wallet, transaction: "0xdead", overrides: {} },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/mainnet/evm/quote",
          payload: { chain: "base", mint, wallet, amount: "101" },
        })
      ).statusCode,
    ).toBe(400);
  } finally {
    await app.close();
  }
});
it("fails closed when the risk check fails, without building or simulating a trade", async () => {
  const quote = vi.fn(),
    simulate = vi.fn(),
    app = Fastify();
  registerMainnet(app, {
    rate: () => {},
    market: () => ({
      snapshot: () => ({ filters: {} }),
      revalidateEvmSelected: async () => {
        throw new UserError("Risk flagged");
      },
    }),
    evm: { quote, simulate } as any,
  });
  try {
    const r = await app.inject({
      method: "POST",
      url: "/api/mainnet/evm/quote",
      payload: { chain: "base", mint, wallet, amount: "1" },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("Risk flagged");
    expect(quote).not.toHaveBeenCalled();
    expect(simulate).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});
it("shows a player our own block reason, never a raw provider fault", async () => {
  const app = Fastify();
  registerMainnet(app, {
    rate: () => {},
    market: () => ({
      snapshot: () => ({ filters: {} }),
      revalidateEvmSelected: async () => {
        throw Error("fetch failed to 10.0.0.4:8545 (ECONNRESET)");
      },
    }),
    evm: {} as any,
  });
  try {
    const r = await app.inject({
      method: "POST",
      url: "/api/mainnet/evm/quote",
      payload: { chain: "base", mint, wallet, amount: "1" },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toEqual({
      error: "Trade unavailable. No transaction was sent.",
    });
  } finally {
    await app.close();
  }
});
