import { expect, it } from "vitest";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { createApp } from "../apps/server/src/http/app.ts";
import { WalletAuthService } from "../apps/server/src/auth/service.ts";
import { MarketStore } from "../apps/server/src/market/store.ts";
import { MarketService } from "../apps/server/src/market/service.ts";
import { BetaAccess } from "../apps/server/src/beta/access.ts";
const origin = "https://jackpot.example";
const cookies = (r: any) =>
  (Array.isArray(r.headers["set-cookie"])
    ? r.headers["set-cookie"]
    : [r.headers["set-cookie"]]
  )
    .filter(Boolean)
    .map((s: string) => s.split(";")[0])
    .join("; ");
async function fixture(
  options: {
    claimPolicy?: Record<string, unknown>;
    trustProxy?: string | false;
    intents?: Record<string, unknown>;
  } = {},
) {
  const store = new MarketStore(":memory:"),
    service = new MarketService(store),
    auth = new WalletAuthService(),
    claims: (string | undefined)[] = [],
    access = new BetaAccess(
      store,
      ["beta01", "beta02", "beta03"],
      Date.now,
      options.claimPolicy as any,
    ),
    calls: any[] = [];
  const beta = {
    snapshot: (identity: any) => ({
      access: { public: true, claimed: !!identity && !!access.slot(identity) },
      positions:
        identity && access.slot(identity) ? [{ owner: identity.address }] : [],
      ready: false,
    }),
    claim: (i: any, origin?: string) => {
      access.claim(i, origin);
      claims.push(origin);
      return { ok: true };
    },
    forIdentity: (i: any) => {
      const slot = access.slot(i);
      if (!slot) throw Error("Claim first");
      return {
        snapshot: () => ({ slot }),
        exit: (index: number) => {
          calls.push({ slot, index });
          return { ok: true };
        },
        confirm: (id: string) => {
          calls.push({ slot, id });
          throw Error("Not your operation");
        },
        subscribe: () => () => {},
      };
    },
    activate: async (i: any) => {
      access.reserveActivation(i);
      calls.push({ activate: access.slot(i) });
      return { ok: true };
    },
  };
  const app = await createApp(service, undefined, {
    runtime: {
      mode: "public-testnet",
      origins: new Set([origin]),
      slots: ["beta01", "beta02", "beta03"],
    },
    store,
    auth,
    beta: beta as any,
    ...(options.intents ? { intents: options.intents as any } : {}),
    ...(options.trustProxy !== undefined
      ? { trustProxy: options.trustProxy }
      : {}),
  });
  async function login(seed: number) {
    const key = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(seed)),
      address = bs58.encode(key.publicKey);
    const c = await app.inject({
        method: "POST",
        url: "/api/auth/challenge",
        headers: { origin },
        payload: { kind: "phantom", address },
      }),
      challenge = c.json();
    const v = await app.inject({
      method: "POST",
      url: "/api/auth/verify",
      headers: { origin, cookie: cookies(c) },
      payload: {
        id: challenge.id,
        signature: bs58.encode(
          nacl.sign.detached(Buffer.from(challenge.message), key.secretKey),
        ),
      },
    });
    expect(v.statusCode).toBe(200);
    expect(String(v.headers["set-cookie"])).toContain("Path=/api;");
    expect(String(v.headers["set-cookie"])).toContain("Secure");
    return { cookie: cookies(v), address };
  }
  return { store, service, app, login, calls, claims };
}
it("requires exact origin and verified ownership; routes mutations only to the server-assigned slot", async () => {
  const f = await fixture(),
    { app } = f;
  for (const headers of [{}, { origin: "https://evil.example" }])
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/execution/claim",
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/execution/activate",
        headers: { origin },
        payload: {},
      })
    ).statusCode,
  ).toBe(401);
  expect((await app.inject("/api/execution")).json().positions).toEqual([]);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/execution/smoke-draw",
        headers: { origin },
        payload: {},
      })
    ).statusCode,
  ).toBe(404);
  const a = await f.login(8),
    b = await f.login(9);
  for (const user of [a, b])
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/execution/claim",
          headers: { origin, cookie: user.cookie },
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
  expect(
    (
      await app.inject({ url: "/api/execution", headers: { cookie: a.cookie } })
    ).json().positions,
  ).toEqual([{ owner: a.address }]);
  expect(
    (
      await app.inject({ url: "/api/execution", headers: { cookie: b.cookie } })
    ).json().positions,
  ).toEqual([{ owner: b.address }]);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/execution/exit",
        headers: { origin, cookie: b.cookie },
        payload: { marketIndex: 0, slot: "beta01" },
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/execution/exit",
        headers: { origin, cookie: b.cookie },
        payload: { marketIndex: 0 },
      })
    ).statusCode,
  ).toBe(200);
  expect(f.calls).toEqual([{ slot: "beta02", index: 0 }]);
  expect(
    (
      await app.inject({ url: "/api/markets", headers: { cookie: a.cookie } })
    ).json().viewer.identity.address,
  ).toBe(a.address);
  const logout = await app.inject({
    method: "POST",
    url: "/api/auth/logout",
    headers: { origin, cookie: a.cookie },
    payload: {},
  });
  expect(logout.statusCode).toBe(200);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/execution/revoke",
        headers: { origin, cookie: a.cookie },
        payload: {},
      })
    ).statusCode,
  ).toBe(401);
  expect(
    (
      await app.inject({ url: "/api/execution", headers: { cookie: a.cookie } })
    ).json().positions,
  ).toEqual([]);
  await app.close();
  f.store.close();
});
it("keeps anonymous discovery configurations separate and never changes operator settings", async () => {
  const f = await fixture(),
    { app } = f;
  const a = await app.inject("/api/markets"),
    b = await app.inject("/api/markets");
  await app.inject({
    method: "POST",
    url: "/api/discovery",
    headers: { origin, cookie: cookies(a) },
    payload: { ticket: "1", preset: "broad", filters: { poolSize: 20 } },
  });
  expect(
    (
      await app.inject({ url: "/api/markets", headers: { cookie: cookies(a) } })
    ).json().filters.poolSize,
  ).toBe(20);
  expect(
    (
      await app.inject({ url: "/api/markets", headers: { cookie: cookies(b) } })
    ).json().filters.poolSize,
  ).not.toBe(20);
  expect(f.service.ticketSize()).toBe("5000000");
  expect(a.headers["cache-control"]).toBe("no-store");
  expect(a.json().viewer.identity).toBeNull();
  expect((await app.inject("/api/events")).statusCode).toBe(404);
  await app.close();
  f.store.close();
});
it("budgets sponsored claims per subscriber through the HTTP route", async () => {
  const f = await fixture({
      claimPolicy: { allowlist: null, perNetworkPerDay: 2 },
    }),
    { app } = f,
    claim = (seed: number, remoteAddress: string) =>
      f.login(seed).then((user) =>
        app.inject({
          method: "POST",
          url: "/api/execution/claim",
          headers: { origin, cookie: user.cookie },
          payload: {},
          remoteAddress,
        }),
      );
  expect((await claim(31, "203.0.113.1")).statusCode).toBe(200);
  expect((await claim(32, "203.0.113.200")).statusCode).toBe(200);
  const blocked = await claim(33, "203.0.113.99");
  expect(blocked.statusCode).toBe(429);
  expect(blocked.json().code).toBe("BETA_CLAIM_LIMIT");
  expect((await claim(34, "198.51.100.9")).statusCode).toBe(200);
  // The socket address is what gets budgeted, so a client header cannot buy a
  // fresh budget or spend someone else's.
  expect(f.claims).toEqual(["203.0.113.1", "203.0.113.200", "198.51.100.9"]);
});
it("scopes limits to the verified wallet, to one route each, and to the real client address", async () => {
  const quotes: string[] = [];
  const f = await fixture({
    // Only this proxy may speak for a client.
    trustProxy: "127.0.0.1",
    intents: {
      catalog: async () => ({}),
      quote: async (asset: string) => {
        quotes.push("intents:" + asset);
        return { ok: true };
      },
      hyperliquidQuote: async (amount: string) => {
        quotes.push("funding:" + amount);
        return { ok: true };
      },
    },
  });
  const post = (
    url: string,
    options: {
      cookie?: string;
      forwardedFor?: string;
      remoteAddress?: string;
    } = {},
  ) =>
    f.app.inject({
      method: "POST",
      url,
      remoteAddress: options.remoteAddress ?? "203.0.113.9",
      headers: {
        origin,
        ...(options.cookie ? { cookie: options.cookie } : {}),
        ...(options.forwardedFor
          ? { "x-forwarded-for": options.forwardedFor }
          : {}),
      },
      payload:
        url === "/api/intents/quote"
          ? { destinationAsset: "SOL", amount: "1" }
          : { amount: "1" },
    });

  // A direct client cannot buy a fresh budget by writing its own forwarding
  // header: the peer address is what counts, so the 13th request is refused
  // however many different forged prefixes it sends.
  for (let i = 0; i < 12; i++)
    expect(
      (
        await post("/api/intents/quote", {
          forwardedFor: `198.51.100.${i}`,
        })
      ).statusCode,
    ).toBe(200);
  expect(
    (await post("/api/intents/quote", { forwardedFor: "198.51.100.200" }))
      .statusCode,
  ).toBe(429);

  // Behind the named proxy the header is honoured, and each client gets its
  // own budget instead of sharing the proxy's.
  for (let i = 0; i < 12; i++)
    expect(
      (
        await post("/api/intents/quote", {
          remoteAddress: "127.0.0.1",
          forwardedFor: "203.0.113.20",
        })
      ).statusCode,
    ).toBe(200);
  expect(
    (
      await post("/api/intents/quote", {
        remoteAddress: "127.0.0.1",
        forwardedFor: "203.0.113.20",
      })
    ).statusCode,
  ).toBe(429);
  expect(
    (
      await post("/api/intents/quote", {
        remoteAddress: "127.0.0.1",
        forwardedFor: "198.51.100.20",
      })
    ).statusCode,
  ).toBe(200);

  const a = await f.login(51),
    b = await f.login(52);
  // Signed in, the budget follows the wallet rather than its neighbours.
  for (let i = 0; i < 12; i++)
    expect(
      (await post("/api/intents/quote", { cookie: b.cookie })).statusCode,
    ).toBe(200);
  expect(
    (await post("/api/intents/quote", { cookie: b.cookie })).statusCode,
  ).toBe(429);
  // A different wallet on that same exhausted address is untouched.
  expect(
    (await post("/api/intents/quote", { cookie: a.cookie })).statusCode,
  ).toBe(200);

  // A drained quote bucket does not reach the funding quote bucket.
  expect(
    (await post("/api/perps/funding-quote", { cookie: b.cookie })).statusCode,
  ).toBe(200);
  expect(quotes).toContain("funding:1");
  await f.app.close();
});
it("keeps a shared network ceiling when many verified wallets request provider quotes", async () => {
  let providerCalls = 0;
  const f = await fixture({
    intents: {
      catalog: async () => ({}),
      quote: async () => {
        providerCalls++;
        return { ok: true };
      },
    },
  });
  try {
    const quote = (cookie: string) =>
      f.app.inject({
        method: "POST",
        url: "/api/intents/quote",
        remoteAddress: "203.0.113.99",
        headers: { origin, cookie },
        payload: { destinationAsset: "SOL", amount: "1" },
      });
    for (let seed = 70; seed < 78; seed++) {
      const user = await f.login(seed);
      for (let i = 0; i < 12; i++)
        expect((await quote(user.cookie)).statusCode).toBe(200);
    }
    const next = await f.login(78);
    expect((await quote(next.cookie)).statusCode).toBe(429);
    expect(providerCalls).toBe(96);
  } finally {
    await f.app.close();
    f.store.close();
  }
});
it("preserves a visitor throttle as 429 through the current proximity preview route", async () => {
  const f = await fixture();
  try {
    const post = () =>
      f.app.inject({
        method: "POST",
        url: "/api/preview",
        remoteAddress: "203.0.113.77",
        headers: { origin },
        payload: { configurationHash: "a".repeat(64) },
      });
    for (let i = 0; i < 12; i++) expect((await post()).statusCode).toBe(409);
    const blocked = await post();
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers["retry-after"]).toBe("60");
    expect(blocked.json().code).toBe("RATE_LIMITED");
  } finally {
    await f.app.close();
    f.store.close();
  }
});
