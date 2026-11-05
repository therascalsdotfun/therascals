import { expect, it } from "vitest";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { createApp } from "../apps/server/src/http/app.ts";
import { MarketStore } from "../apps/server/src/market/store.ts";
import { RewardsService } from "../apps/server/src/rewards/service.ts";
const origin = "https://rascals.example";
const cookie = (r: any) =>
  [r.headers["set-cookie"]]
    .flat()
    .filter(Boolean)
    .map((s: string) => s.split(";")[0])
    .join("; ");
it("protects the local practice ledger with wallet ownership and exact origin; refuses forged amounts, results and promotion prices", async () => {
  const store = new MarketStore(":memory:");
  const rewards = new RewardsService(store, {
    verifyMainnet: async () => {
      throw Error("Unexpected chain read");
    },
    practiceReceipt: () => {
      throw Error("Not an owned finalized buy");
    },
    promotionToken: async (mint) => ({
      mint,
      symbol: "SYN",
      name: "Synthetic",
      icon: null,
    }),
  });
  const app = await createApp({}, undefined, {
    store,
    rewards,
    runtime: { mode: "local", origins: new Set([origin]), slots: [] },
  });
  const post = (
    path: string,
    payload: unknown,
    session = "",
    requestOrigin = origin,
  ) =>
    app.inject({
      method: "POST",
      url: "/api/rewards/" + path,
      headers: { origin: requestOrigin, cookie: session },
      payload: payload as any,
    });
  async function login(seed: number) {
    const pair = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(seed));
    const c = await app.inject({
      method: "POST",
      url: "/api/auth/challenge",
      headers: { origin },
      payload: { kind: "phantom", address: bs58.encode(pair.publicKey) },
    });
    const challenge = c.json();
    const v = await app.inject({
      method: "POST",
      url: "/api/auth/verify",
      headers: { origin, cookie: cookie(c) },
      payload: {
        id: challenge.id,
        signature: bs58.encode(
          nacl.sign.detached(Buffer.from(challenge.message), pair.secretKey),
        ),
      },
    });
    expect(v.statusCode).toBe(200);
    return cookie(v);
  }
  try {
    expect((await app.inject("/api/rewards")).statusCode).toBe(401);
    const leaders = await app.inject("/api/rewards/leaderboard?lane=practice");
    expect(leaders.statusCode).toBe(200);
    expect(leaders.json()).toMatchObject({ lane: "practice", entries: [] });
    expect(
      (await app.inject("/api/rewards/leaderboard?lane=bad")).statusCode,
    ).toBe(400);
    expect((await post("practice-starter", {})).statusCode).toBe(401);
    const alice = await login(11),
      bob = await login(12);
    expect(
      (await post("practice-starter", {}, alice, "https://evil.example"))
        .statusCode,
    ).toBe(403);
    expect(
      (await post("practice-starter", { points: 1e9 }, alice)).statusCode,
    ).toBe(400);
    expect((await post("practice-starter", {}, alice)).json().points).toBe(
      1000,
    );
    expect((await post("practice-starter", {}, alice)).json().points).toBe(
      1000,
    );
    const snapshot = (
      await app.inject({ url: "/api/rewards", headers: { cookie: alice } })
    ).json();
    expect(snapshot.balances.practice.balance).toBe(1000);
    expect(
      (
        await app.inject({ url: "/api/rewards", headers: { cookie: bob } })
      ).json().balances.practice.balance,
    ).toBe(0);
    for (const payload of [
      { lane: "practice", operationId: crypto.randomUUID(), points: 10000 },
      {
        lane: "mainnet",
        ticketId: crypto.randomUUID(),
        signature: "bad",
        multiplier: 50000,
      },
      {
        lane: "practice",
        operationId: crypto.randomUUID(),
        owner: snapshot.owner,
      },
    ])
      expect((await post("claim", payload, alice)).statusCode).toBe(400);
    expect(
      (
        await post(
          "claim",
          { lane: "practice", operationId: crypto.randomUUID() },
          alice,
        )
      ).statusCode,
    ).toBe(503);
    const purchase = {
      requestId: crypto.randomUUID(),
      lane: "practice",
      mint: "11111111111111111111111111111111",
      message: "test",
      placement: "market",
      durationHours: 24,
    };
    expect(
      (await post("promotions", { ...purchase, cost: 0 }, alice)).statusCode,
    ).toBe(400);
    expect((await post("promotions", purchase, alice)).statusCode).toBe(200);
    expect((await post("promotions", purchase, alice)).statusCode).toBe(200);
    expect(
      (
        await app.inject({ url: "/api/rewards", headers: { cookie: alice } })
      ).json().balances.practice.balance,
    ).toBe(750);
    expect(
      (await app.inject("/api/rewards/promotions")).json().promotions,
    ).toHaveLength(0);
  } finally {
    await app.close();
    store.close();
  }
});
