import { expect, it, vi } from "vitest";
import {
  parseBasePairs,
  parseBaseRisk,
  BaseDiscovery,
} from "../apps/server/src/market/base.ts";
const address = "0x" + "1".repeat(40),
  now = Date.now();
const pair = (extra: any = {}) => ({
  chainId: "base",
  pairAddress: "0x" + "2".repeat(40),
  baseToken: { address, name: "Tiny coin", symbol: "TINY" },
  pairCreatedAt: now - 3600000,
  marketCap: 100000,
  priceUsd: "0.001",
  liquidity: { usd: 20000 },
  volume: { m5: 1000 },
  txns: { m5: { buys: 10, sells: 9 } },
  ...extra,
});
it("refreshes an expiring clean report before a backlog of incomplete reports can starve it", async () => {
  vi.useFakeTimers();
  const current = Date.now(),
    scanned: string[] = [];
  const addresses = Array.from(
    { length: 20 },
    (_, i) => "0x" + (i + 1).toString(16).padStart(40, "0"),
  );
  const clean = addresses.at(-1)!;
  const observations = addresses.map((mint) => {
    const token = parseBasePairs(
      [
        pair({
          baseToken: { address: mint, symbol: mint.slice(-4), name: mint },
          chainId: "base",
        }),
      ],
      current - 130000,
    )[0];
    token.security = {
      mint,
      source: "GoPlus",
      chain: "base",
      status: mint === clean ? "checked" : "unavailable",
      checkedAt: new Date(
        current - (mint === clean ? 240000 : 600000),
      ).toISOString(),
      reportAt: null,
      risks: [],
      score: null,
    };
    return token;
  });
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("token-profiles"))
      return Response.json(
        addresses.map((tokenAddress) => ({ chainId: "base", tokenAddress })),
      );
    if (url.includes("tokens/v1"))
      return Response.json(
        addresses.map((mint) =>
          pair({
            baseToken: { address: mint, symbol: mint.slice(-4), name: mint },
          }),
        ),
      );
    if (url.includes("goplus")) {
      const mint = new URL(url).searchParams.get("contract_addresses")!;
      scanned.push(mint);
      return Response.json({
        code: 1,
        result:
          mint === clean
            ? {
                [mint]: {
                  is_honeypot: "0",
                  is_open_source: "1",
                  cannot_sell_all: "0",
                  buy_tax: "0",
                  sell_tax: "0",
                },
              }
            : {},
      });
    }
    return Response.json({ data: [] });
  };
  try {
    const adapter = new BaseDiscovery(fetcher, () => Date.now(), "base");
    adapter.restore(observations);
    const collection = adapter.collect();
    await vi.advanceTimersByTimeAsync(60000);
    await collection;
    expect(scanned[0]).toBe(clean);
    expect(scanned).toHaveLength(15);
    const retained = adapter.tokens().find((t) => t.mint === clean)!;
    expect(retained.security?.status).toBe("checked");
    expect(Date.parse(retained.security!.checkedAt)).toBeGreaterThan(current);
    expect(
      adapter
        .tokens()
        .filter((t) => t.mint !== clean)
        .every((t) => t.security?.status === "unavailable"),
    ).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});
it("reads real Base pool metrics, exact addresses and strongest liquidity without FDV fallback", () => {
  const t = parseBasePairs(
    [
      pair({ marketCap: null, fdv: 900000 }),
      pair({ liquidity: { usd: 40000 }, marketCap: 123000 }),
      pair({ chainId: "solana" }),
    ],
    now,
  )[0];
  expect(t.chain).toBe("base");
  expect(t.previewOnly).toBe(false);
  expect(t.marketCap.value).toBe(123000);
  expect(t.liquidity.value).toBe(40000);
  expect(t.mintAuthorityDisabled).toBe(null);
  expect(
    parseBasePairs([pair({ marketCap: null, fdv: 100000 })], now)[0].marketCap
      .value,
  ).toBe(null);
});
it("GoPlus fails closed on missing fields and flags reported controls/taxes", () => {
  const report = {
    code: 1,
    result: {
      [address]: {
        is_honeypot: "0",
        is_open_source: "1",
        cannot_sell_all: "0",
        buy_tax: "0",
        sell_tax: "0",
      },
    },
  };
  expect(parseBaseRisk(report, address, now).status).toBe("checked");
  expect(parseBaseRisk({ code: 1, result: {} }, address, now).status).toBe(
    "unavailable",
  );
  report.result[address].is_honeypot = "1";
  expect(parseBaseRisk(report, address, now).status).toBe("flagged");
});
it("an import is exact-contract only and never accepts an arbitrary URL", async () => {
  let requests = 0;
  const base = new BaseDiscovery(async () => {
    requests++;
    return Response.json([
      pair({ baseToken: { address: "0x" + "3".repeat(40) } }),
    ]);
  });
  await expect(base.import("https://example.com")).rejects.toThrow("Invalid");
  expect(requests).toBe(0);
  await expect(base.import(address)).rejects.toThrow("not found");
  expect(base.tokens()).toHaveLength(0);
});
it("restored Base metadata expires and malformed tax values cannot pass risk checks", () => {
  const base = new BaseDiscovery(fetch, () => now + 120001);
  base.restore(parseBasePairs([pair()], now));
  expect(base.tokens()[0].dex?.stale).toBe(true);
  const risk = parseBaseRisk(
    {
      code: 1,
      result: {
        [address]: {
          is_honeypot: "0",
          is_open_source: "1",
          cannot_sell_all: "0",
          buy_tax: false,
          sell_tax: " ",
        },
      },
    },
    address,
    now,
  );
  expect(risk.status).toBe("flagged");
  expect(risk.risks).toHaveLength(2);
});

it("screens each discovered contract separately when GoPlus returns only the first requested address", async () => {
  vi.useFakeTimers();
  const now = Date.now(),
    addresses = ["0x" + "5".repeat(40), "0x" + "6".repeat(40)];
  const riskRequests: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("goplus")) {
      const requested = new URL(url).searchParams.get("contract_addresses")!;
      riskRequests.push(requested);
      const first = requested.split(",")[0];
      return Response.json({
        code: 1,
        result: {
          [first]: {
            is_honeypot: "0",
            is_open_source: "1",
            cannot_sell_all: "0",
            buy_tax: "0",
            sell_tax: "0",
          },
        },
      });
    }
    if (url.includes("token-profiles"))
      return Response.json(
        addresses.map((tokenAddress) => ({ chainId: "bsc", tokenAddress })),
      );
    if (url.includes("tokens/v1"))
      return Response.json(
        addresses.map((address, i) =>
          pair({
            chainId: "bsc",
            baseToken: { address, name: "BNB" + i, symbol: "BNB" + i },
          }),
        ),
      );
    return Response.json({ data: [] });
  };
  try {
    const adapter = new BaseDiscovery(fetcher, () => Date.now(), "bsc");
    const collection = adapter.collect();
    await vi.advanceTimersByTimeAsync(30000);
    await collection;
    expect(riskRequests).toEqual(addresses);
    expect(adapter.tokens().map((t) => t.security?.status)).toEqual([
      "checked",
      "checked",
    ]);
  } finally {
    vi.useRealTimers();
  }
});

it("refreshes previously screened live tokens after they disappear from the newest launch feeds", async () => {
  vi.useFakeTimers();
  const current = Date.now(),
    staleAt = current - 130000,
    requested: string[] = [];
  const token = parseBasePairs([pair({ chainId: "bsc" })], staleAt, "bsc")[0];
  token.security = {
    mint: address,
    source: "GoPlus",
    chain: "bsc",
    status: "checked",
    risks: [],
    checkedAt: new Date(staleAt).toISOString(),
    reportAt: null,
    score: null,
  };
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    requested.push(url);
    if (url.includes("token-profiles")) return Response.json([]);
    if (url.includes("tokens/v1"))
      return Response.json([pair({ chainId: "bsc" })]);
    if (url.includes("goplus"))
      return Response.json({
        code: 1,
        result: {
          [address]: {
            is_honeypot: "0",
            is_open_source: "1",
            cannot_sell_all: "0",
            buy_tax: "0",
            sell_tax: "0",
          },
        },
      });
    return Response.json({ data: [] });
  };
  try {
    const adapter = new BaseDiscovery(fetcher, () => Date.now(), "bsc");
    adapter.restore([token]);
    const collection = adapter.collect();
    await vi.advanceTimersByTimeAsync(30000);
    await collection;
    expect(
      requested.some((url) => url.includes("/tokens/v1/bsc/" + address)),
    ).toBe(true);
    expect(adapter.tokens()[0].dex?.stale).toBe(false);
    expect(Date.parse(adapter.tokens()[0].sourceUpdatedAt!)).toBeGreaterThan(
      staleAt,
    );
  } finally {
    vi.useRealTimers();
  }
});
