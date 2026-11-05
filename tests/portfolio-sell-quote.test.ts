import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import {
  SellQuotes,
  registerSellQuotes,
  saleQuoteInput,
} from "../apps/server/src/portfolio/sell-quote.ts";
import {
  SOLANA_SELL_OUTPUTS as outputs,
  matchesSellEstimate,
} from "../packages/shared/src/sell-output.ts";
import { sellForm } from "../apps/web/src/portfolio/PortfolioSell.tsx";
const inputMint = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const input = { inputMint, output: "USDC" as const, amount: "12000000" };
const response = (extra = {}) => ({
  transaction: null,
  inputMint,
  outputMint: outputs.USDC.mint,
  inAmount: input.amount,
  outAmount: "1950234",
  swapMode: "ExactIn",
  routePlan: [{ swapInfo: { label: "Venue" } }],
  ...extra,
});
const now = 1700000000000;
describe("portfolio receive estimates", () => {
  it("requests exact input/output without a taker and exposes no transaction", async () => {
    const get = vi.fn(async () => Response.json(response()));
    const service = new SellQuotes(get as typeof fetch, () => now);
    const q = await service.quote(input);
    const [url, options] = get.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(new URL(url).searchParams.get("taker")).toBeNull();
    expect(new URL(url).searchParams.get("amount")).toBe(input.amount);
    expect(options.redirect).toBe("error");
    expect(q).toEqual({
      inputMint,
      outputMint: outputs.USDC.mint,
      inAmount: input.amount,
      outAmount: "1950234",
      observedAt: now,
      expiresAt: now + 30000,
    });
    const copy = await service.quote(input);
    copy.outAmount = "1";
    expect((await service.quote(input)).outAmount).toBe("1950234");
    expect(get).toHaveBeenCalledTimes(1);
  });
  it("uses SOL atomic decimals and selected output in the execution review", async () => {
    const get = vi.fn(async () =>
      Response.json(
        response({ outputMint: outputs.SOL.mint, outAmount: "15000000" }),
      ),
    );
    const q = await new SellQuotes(get as typeof fetch, () => now).quote({
      ...input,
      output: "SOL",
    });
    expect(matchesSellEstimate(q, inputMint, "SOL", input.amount, now)).toBe(
      true,
    );
    expect(sellForm(inputMint, input.amount, "SOL").initialOutputMint).toBe(
      outputs.SOL.mint,
    );
    expect(
      sellForm(outputs.USDC.mint, "1000000", "SOL").initialOutputMint,
    ).toBe(outputs.SOL.mint);
    expect(() => sellForm(outputs.SOL.mint, "1000000", "SOL")).toThrow();
  });
  it.each([
    { inputMint: outputs.SOL.mint },
    { outputMint: outputs.SOL.mint },
    { inAmount: "1" },
    { outAmount: "0" },
    { outAmount: "1e5" },
    { outAmount: "18446744073709551616" },
    { transaction: "unsigned payload" },
    { swapMode: "ExactOut" },
    { routePlan: [] },
    { errorCode: 42 },
  ])("rejects mismatched, unsafe or absent routes: %j", async (extra) => {
    const get = vi.fn(async () => Response.json(response(extra)));
    await expect(
      new SellQuotes(get as typeof fetch, () => now).quote(input),
    ).rejects.toThrow();
  });
  it("never reuses an estimate after input, amount, output or freshness changes", () => {
    const q = {
      inputMint,
      outputMint: outputs.USDC.mint,
      inAmount: input.amount,
      outAmount: "123",
      observedAt: now,
      expiresAt: now + 30000,
    };
    expect(matchesSellEstimate(q, inputMint, "USDC", input.amount, now)).toBe(
      true,
    );
    expect(matchesSellEstimate(q, inputMint, "SOL", input.amount, now)).toBe(
      false,
    );
    expect(matchesSellEstimate(q, inputMint, "USDC", "1", now)).toBe(false);
    expect(
      matchesSellEstimate(q, outputs.SOL.mint, "USDC", input.amount, now),
    ).toBe(false);
    expect(
      matchesSellEstimate(q, inputMint, "USDC", input.amount, now + 30000),
    ).toBe(false);
    expect(
      matchesSellEstimate(
        { ...q, observedAt: now + 5000 },
        inputMint,
        "USDC",
        input.amount,
        now,
      ),
    ).toBe(false);
  });
  it("rejects unsupported currencies, invalid amounts and same-token conversions", () => {
    for (const body of [
      { ...input, output: "BNB" },
      { ...input, amount: "0" },
      { ...input, amount: "18446744073709551616" },
      { ...input, inputMint: outputs.USDC.mint },
      { ...input, inputMint: "native" },
      { ...input, amount: "1.5" },
      { ...input, taker: inputMint },
    ])
      expect(saleQuoteInput.safeParse(body).success).toBe(false);
  });
  it("keeps provider errors private and reports failure without a quote", async () => {
    const app = Fastify(),
      rate = vi.fn();
    registerSellQuotes(
      app,
      rate,
      new SellQuotes(
        vi.fn(async () => {
          throw Error("private provider detail");
        }) as typeof fetch,
      ),
    );
    const bad = await app.inject({
      method: "POST",
      url: "/api/mainnet/solana/sell-quote",
      payload: { ...input, amount: "0" },
    });
    expect(bad.statusCode).toBe(400);
    const r = await app.inject({
      method: "POST",
      url: "/api/mainnet/solana/sell-quote",
      payload: input,
    });
    expect(r.statusCode).toBe(503);
    expect(r.body).not.toContain("private provider detail");
    expect(r.json().outAmount).toBeUndefined();
    expect(rate).toHaveBeenCalledWith(
      expect.stringContaining("solana-sell-quote:"),
      30,
    );
    await app.close();
  });
});
