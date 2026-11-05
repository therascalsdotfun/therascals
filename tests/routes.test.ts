import bs58 from "bs58";
import { it, expect } from "vitest";
import {
  RequestScheduler,
  checkRoutePair,
  selectPool,
} from "../apps/server/src/routes/eligibility.ts";
import { normalizeJupiter } from "../apps/server/src/market/model.ts";
const A = "DjggwaPYk1bk1FvET7rFwDXJ9vwYNDZAAxQ9XgyMsc7y",
  U = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const quote = (input: string, output: string, amount: string, out: string) => ({
  inputMint: input,
  outputMint: output,
  inAmount: amount,
  outAmount: out,
  router: "metis",
  transaction: null,
  routePlan: [{ swapInfo: { label: "Pump.fun Amm" } }],
  feeBps: 10,
});
it("spaces all shared requests and keeps execution serial", async () => {
  let now = 0,
    active = 0,
    peak = 0;
  const starts: number[] = [];
  const s = new RequestScheduler(
    2500,
    () => now,
    async (ms) => {
      now += ms;
    },
  );
  await Promise.all(
    [1, 2, 3].map((i) =>
      s.run(async () => {
        starts.push(now);
        peak = Math.max(peak, ++active);
        await Promise.resolve();
        active--;
        return i;
      }),
    ),
  );
  expect(starts).toEqual([0, 2500, 5000]);
  expect(peak).toBe(1);
});
it("uses atomic buy output for reverse quotation without constructing a transaction", async () => {
  const urls: string[] = [];
  const get = async (url: string) => {
    urls.push(url);
    return urls.length === 1
      ? quote(U, A, "10000000", "414829786700")
      : quote(A, U, "414829786700", "9980000");
  };
  const r = await checkRoutePair(A, "10000000", get, () => 1000);
  expect(r.status).toBe("eligible");
  expect(new URL(urls[1]).searchParams.get("amount")).toBe("414829786700");
  expect(urls.every((u) => !new URL(u).searchParams.has("taker"))).toBe(true);
  expect(r.ticketAtomic).toBe("10000000");
  expect(r.sell?.outAmount).toBe("9980000");
});
it("rejects an HTTP-200 error or empty route", async () => {
  expect(
    (
      await checkRoutePair(
        A,
        "10000000",
        async () => ({ error: "Failed to get quotes" }),
        () => 1000,
      )
    ).status,
  ).toBe("unavailable");
  expect(
    (
      await checkRoutePair(
        A,
        "10000000",
        async () => ({ ...quote(U, A, "10000000", "1"), routePlan: [] }),
        () => 1000,
      )
    ).status,
  ).toBe("unavailable");
});
it("rejects quote identity mismatches, zero output, and unexpected transaction construction", async () => {
  for (const change of [
    { outputMint: U },
    { outAmount: "0" },
    { transaction: "base64-tx" },
  ])
    expect(
      (
        await checkRoutePair(
          A,
          "10000000",
          async () => ({ ...quote(U, A, "10000000", "100"), ...change }),
          () => 1000,
        )
      ).status,
    ).toBe("unavailable");
});
it("binds eligibility to ticket amount and freshness and never pads the pool", () => {
  const now = 100000;
  const t = normalizeJupiter(
    {
      id: A,
      name: "Bina",
      symbol: "BINA",
      mcap: 24000,
      decimals: 6,
      updatedAt: new Date(now - 1000).toISOString(),
      firstPool: { createdAt: new Date(0).toISOString() },
      audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true },
    },
    now,
  )!;
  const r: any = {
    mint: A,
    ticketAtomic: "10000000",
    status: "eligible",
    checkedAt: now - 1000,
    expiresAt: now + 89000,
  };
  expect(
    selectPool([t], new Map([[A + ":10000000", r]]), "10000000", now),
  ).toHaveLength(1);
  expect(
    selectPool([t], new Map([[A + ":10000000", r]]), "25000000", now),
  ).toHaveLength(0);
  expect(
    selectPool(
      [t],
      new Map([[A + ":10000000", { ...r, expiresAt: now - 1 }]]),
      "10000000",
      now,
    ),
  ).toHaveLength(0);
});
it("honors each requested population and caps at32 without padding stale routes", () => {
  const now = Date.now(),
    tokens = Array.from({ length: 33 }, (_, i) =>
      normalizeJupiter(
        {
          id: bs58.encode(new Uint8Array(32).fill(i + 1)),
          decimals: 6,
          mcap: 10000,
          updatedAt: new Date(now).toISOString(),
          firstPool: { createdAt: new Date(now - 60000).toISOString() },
          audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true },
        },
        now,
      )!,
    );
  const routes = new Map(
    tokens.map((t) => [
      t.mint + ":5000000",
      {
        mint: t.mint,
        ticketAtomic: "5000000",
        status: "eligible",
        checkedAt: now,
        expiresAt: now + 90000,
      } as any,
    ]),
  );
  expect(selectPool(tokens, routes, "5000000", now, 4)).toHaveLength(4);
  expect(selectPool(tokens, routes, "5000000", now, 5)).toHaveLength(5);
  expect(selectPool(tokens, routes, "5000000", now, 32)).toHaveLength(32);
  expect(selectPool(tokens, routes, "5000000", now + 90001, 32)).toHaveLength(
    0,
  );
});
