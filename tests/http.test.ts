import { it, expect } from "vitest";
import { createApp } from "../apps/server/src/http/app.ts";
it("validates filter and ticket input and rejects cross-origin writes", async () => {
  const calls: any[] = [];
  const app = await createApp({
    snapshot: () => ({ observed: 0, pool: [] }),
    configure: (x: any) => calls.push(x),
  } as any);
  expect((await app.inject("/api/markets")).json()).toEqual({
    observed: 0,
    pool: [],
  });
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/discovery",
        payload: { ticket: "999999999999999999999" },
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/discovery",
        headers: { origin: "https://evil.example" },
        payload: { ticket: "5", preset: "broad" },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/discovery",
        payload: {
          ticket: "5",
          preset: "broad",
          filters: { minAgeMinutes: -1 },
        },
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/discovery",
        payload: { ticket: "5", preset: "broad" },
      })
    ).statusCode,
  ).toBe(200);
  expect(calls).toHaveLength(1);
  expect(calls[0].ticketAtomic).toBe("5000000");
  await app.close();
});

it("rejects custom filters outside the small fresh cage bounds", async () => {
  const calls: unknown[] = [];
  const app = await createApp({
    snapshot: () => ({}),
    configure: (x: unknown) => calls.push(x),
  } as any);
  for (const filters of [
    { maxMarketCap: 100000000 },
    { minMarketCap: 100000000 },
    { maxAgeMinutes: 1441 },
  ]) {
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/discovery",
          payload: { ticket: "5", filters },
        })
      ).statusCode,
    ).toBe(400);
  }
  expect(calls).toHaveLength(0);
  await app.close();
});

it("accepts narrative filters and tighter presets, rejecting invented narrative values", async () => {
  const calls: any[] = [];
  const app = await createApp({
    snapshot: () => ({}),
    configure: (x: any) => calls.push(x),
  } as any);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/discovery",
        payload: {
          ticket: "5",
          preset: "tight",
          filters: { memeTypes: ["politics", "tech"] },
        },
      })
    ).statusCode,
  ).toBe(200);
  expect(calls[0].filters.minMarketCap).toBe(100000);
  expect(calls[0].filters.memeTypes).toEqual(["politics", "tech"]);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/discovery",
        payload: { ticket: "5", filters: { memeTypes: ["guaranteed-gems"] } },
      })
    ).statusCode,
  ).toBe(400);
  await app.close();
});
it("persists bounded requested pool size and rejects fractions or oversized targets", async () => {
  const calls: any[] = [];
  const app = await createApp({
    snapshot: () => ({}),
    configure: (x: any) => calls.push(x),
  } as any);
  for (const n of [1, 33, 3.5])
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/discovery",
          payload: { ticket: "5", filters: { poolSize: n } },
        })
      ).statusCode,
    ).toBe(400);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/discovery",
        payload: { ticket: "5", filters: { poolSize: 32 } },
      })
    ).statusCode,
  ).toBe(200);
  expect(calls[0].filters.poolSize).toBe(32);
  await app.close();
});

it("accepts fixed tickets up to100 but rejects amounts beyond the extended testnet cap", async () => {
  const calls: any[] = [];
  const app = await createApp({ configure: (v: any) => calls.push(v) });
  try {
    for (const ticket of ["1", "25", "99.99", "100", "100.00"])
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/discovery",
            payload: { ticket },
          })
        ).statusCode,
      ).toBe(200);
    for (const ticket of ["0", "100.01", "101", "1e2", "-1"])
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/discovery",
            payload: { ticket },
          })
        ).statusCode,
      ).toBe(400);
    expect(calls.at(-1).ticketAtomic).toBe("100000000");
  } finally {
    await app.close();
  }
});
it("passes preview amount mode without accepting a client-selected amount or winner", async () => {
  const calls: any[] = [];
  const app = await createApp({
    beginRoll: (...args: any[]) => {
      calls.push(args);
      return { id: "roll-00000000-0000-0000-0000-000000000000", commitment: "c".repeat(64) };
    },
    revealRoll: () => ({ purchaseMade: false }),
  });
  const configurationHash = "a".repeat(64);
  try {
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/preview",
          payload: { configurationHash, amountMode: "full_degen" },
        })
      ).statusCode,
    ).toBe(200);
    expect(calls[0]).toEqual([configurationHash, "full_degen", undefined]);
    // A committed field cannot be steered: the old browser-release payload and
    // any hand-named winner are now plain invalid input.
    for (const fields of [
      { amountMode: "rigged" },
      { amountMode: "full_degen", amount: "100000000" },
      {
        release: {
          version: 1,
          elapsedMs: 3000,
          selectedKey: "MINE",
          positions: [
            { key: "MINE", x: 0, y: -1.26, z: 0, radius: 0.3 },
            { key: "OTHER", x: 0, y: 1.2, z: 0, radius: 0.13 },
          ],
        },
      },
      { selectedKey: "MINE" },
      { seed: "00".repeat(32) },
    ])
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/preview",
            payload: { configurationHash, ...fields },
          })
        ).statusCode,
      ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/preview/reveal",
          payload: { rollId: "not-a-roll" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/preview/reveal",
          payload: { rollId: "roll-00000000-0000-0000-0000-000000000000" },
        })
      ).statusCode,
    ).toBe(200);
  } finally {
    await app.close();
  }
});

it("validates chain selection, manual addresses and import chain identity", async () => {
  const calls: any[] = [];
  const app = await createApp({
    configure: (x: any) => calls.push(x),
    importToken: async (mint: string, chain: string) => ({ mint, chain }),
  });
  try {
    const mint = "So11111111111111111111111111111111111111112";
    const ok = await app.inject({
      method: "POST",
      url: "/api/discovery",
      payload: {
        ticket: "5",
        filters: {
          chains: ["solana", "base"],
          tokenSelection: { included: [mint], excluded: [], manualOnly: true },
        },
      },
    });
    expect(ok.statusCode).toBe(200);
    expect(calls[0].filters.chains).toEqual(["solana", "base"]);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/discovery",
          payload: {
            ticket: "5",
            filters: {
              chains: ["solana", "base", "bsc", "near"],
              tokenSelection: {
                included: ["bsc:0x" + "1".repeat(40), "near:coin.near"],
                excluded: [],
                manualOnly: false,
              },
            },
          },
        })
      ).statusCode,
    ).toBe(200);
    for (const [chain, address] of [
      ["bsc", "0x" + "2".repeat(40)],
      ["near", "coin.near"],
    ])
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/pool/import",
            payload: { chain, mint: address },
          })
        ).json().token.chain,
      ).toBe(chain);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/pool/import",
          payload: { chain: "near", mint: "https://example.com" },
        })
      ).statusCode,
    ).toBe(400);
    for (const chains of [[], ["ethereum"], ["base", "base"]])
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/discovery",
            payload: { ticket: "5", filters: { chains } },
          })
        ).statusCode,
      ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/pool/import",
          payload: { chain: "base", mint: "https://private.example" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/pool/import",
          payload: { chain: "base", mint: "0x" + "1".repeat(40) },
        })
      ).json().token.chain,
    ).toBe("base");
  } finally {
    await app.close();
  }
});
