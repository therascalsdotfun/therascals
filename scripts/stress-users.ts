/** Isolated concurrent logical-user journeys. Synthetic public-source fixtures,
 * local signatures only. No RPCs, provider calls, deposits or trade execution.
 * Fastify injection measures application/session behavior, not browser capacity.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { mkdirSync, writeFileSync } from "node:fs";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { createApp } from "../apps/server/src/http/app.ts";
import { MarketStore } from "../apps/server/src/market/store.ts";
import { MarketService } from "../apps/server/src/market/service.ts";
import { normalizeJupiter } from "../apps/server/src/market/model.ts";

const origin = "https://rascals.example",
  start = Date.now();
const count = Number(process.env.STRESS_TOKEN_COUNT ?? 1000);
assert.ok(Number.isInteger(count) && count >= 1000 && count <= 10000);
const store = new MarketStore(":memory:");
const tokens = Array.from({ length: count }, (_, i) =>
  normalizeJupiter(
    {
      id: bs58.encode(
        createHash("sha256")
          .update("synthetic-token-" + i)
          .digest(),
      ),
      name: "Synthetic " + i,
      symbol: "S" + i,
      decimals: 6,
      updatedAt: new Date(start).toISOString(),
      createdAt: new Date(start - 3600000).toISOString(),
      firstPool: {
        id: "fixture-" + i,
        createdAt: new Date(start - 1800000).toISOString(),
      },
      mcap: 50000 + i,
      liquidity: 20000,
      usdPrice: 0.01,
      holderCount: 500,
      stats5m: { buyVolume: 4000, sellVolume: 2000, numBuys: 50, numSells: 20 },
      audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true },
    },
    start,
  )!,
);
store.upsert(tokens);
const service = new MarketService(store);
// Only the eight synthetic candidate tokens have fixture provider evidence.
// These overrides belong to this local harness, never the production service.
const candidates = new Set(tokens.slice(0, 8).map((t) => t.mint));
(service as any).warm = async () => {};
(service as any).risk.peek = (mint: string) =>
  candidates.has(mint)
    ? {
        mint,
        source: "RugCheck",
        status: "checked",
        checkedAt: new Date(start).toISOString(),
        reportAt: new Date(start).toISOString(),
        score: 0,
        risks: [],
      }
    : undefined;
(service as any).dex.peek = (mint: string) =>
  candidates.has(mint)
    ? {
        mint,
        pool: "fixture-" + mint,
        fetchedAt: new Date(start).toISOString(),
        stale: false,
        liquidity: 20000,
      }
    : undefined;
for (const t of tokens.slice(0, 8))
  for (let ticket = 1; ticket <= 100; ticket++)
    (service as any).routes.set(t.mint + ":" + ticket * 1e6, {
      mint: t.mint,
      ticketAtomic: String(ticket * 1e6),
      status: "eligible",
      expiresAt: start + 90000,
      checkedAt: start,
      buy: null,
      sell: null,
      error: null,
    });
const app = await createApp(service, undefined, {
  store,
  runtime: { mode: "public", origins: new Set([origin]), slots: [] },
});
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  throw Error("Outbound requests forbidden by the concurrent-user harness");
};
const groups: unknown[] = [],
  samples: number[] = [];
let total = 0,
  identities = 0,
  previews = 0,
  profiles = 0;
const cookie = (r: any) =>
  [r.headers["set-cookie"]]
    .flat()
    .filter(Boolean)
    .map((v: string) => v.split(";")[0])
    .join("; ");
const percentile = (xs: number[], p: number) =>
  [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) * p)];
const users: {
  id: number;
  ip: string;
  cookie: string;
  address: string | null;
  ticket: string;
  size: number;
}[] = [];
async function send(
  user: (typeof users)[number],
  method: "GET" | "POST",
  url: string,
  payload?: Record<string, unknown>,
  expected = 200,
) {
  const begin = performance.now();
  const response = await app.inject({
    method,
    url,
    remoteAddress: user.ip,
    headers: { origin, ...(user.cookie ? { cookie: user.cookie } : {}) },
    ...(payload === undefined ? {} : { payload }),
  });
  samples.push(performance.now() - begin);
  total++;
  assert.equal(
    response.statusCode,
    expected,
    `${method} ${url}: ${response.statusCode}`,
  );
  if (cookie(response))
    user.cookie = [user.cookie, cookie(response)].filter(Boolean).join("; ");
  return response.json();
}
try {
  for (const concurrency of [10, 50, 150]) {
    const begin = performance.now(),
      sampleStart = samples.length;
    await Promise.all(
      Array.from({ length: concurrency }, async (_, i) => {
        const id = profiles++,
          user = {
            id,
            ip: `198.18.${Math.floor(id / 250)}.${(id % 250) + 1}`,
            cookie: "",
            address: null as string | null,
            ticket: String((id % 100) + 1),
            size: (id % 7) + 2,
          };
        users.push(user);
        if (i % 2 === 0) {
          const key = nacl.sign.keyPair.fromSeed(
            createHash("sha256")
              .update("local-signature-fixture-" + id)
              .digest(),
          );
          user.address = bs58.encode(key.publicKey);
          const challenge = await send(user, "POST", "/api/auth/challenge", {
            kind: "phantom",
            address: user.address,
          });
          await send(user, "POST", "/api/auth/verify", {
            id: challenge.id,
            signature: bs58.encode(
              nacl.sign.detached(Buffer.from(challenge.message), key.secretKey),
            ),
          });
          identities++;
        } else await send(user, "GET", "/api/markets?limit=10");
        await send(user, "POST", "/api/discovery", {
          ticket: user.ticket,
          preset: "broad",
          filters: { poolSize: user.size },
        });
        const state = await send(user, "GET", "/api/markets?limit=10");
        assert.equal(state.ticketAtomic, String(Number(user.ticket) * 1e6));
        assert.equal(state.filters.poolSize, user.size);
        assert.equal(state.viewer.identity?.address ?? null, user.address);
        assert.equal(state.pool.length, user.size);
        const preview = await send(user, "POST", "/api/preview", {
          configurationHash: state.configurationHash,
        });
        assert.equal(preview.purchaseMade, false);
        assert.equal(preview.ticketAtomic, state.ticketAtomic);
        assert.ok(
          state.pool.some((t: any) => t.mint === preview.selected.mint),
        );
        previews++;
        await send(
          user,
          "POST",
          "/api/preview",
          { configurationHash: "0".repeat(64) },
          409,
        );
      }),
    );
    const latencies = samples.slice(sampleStart);
    groups.push({
      logicalConcurrentUsers: concurrency,
      requests: latencies.length,
      elapsedMs: Math.round(performance.now() - begin),
      p95Ms: Math.round(percentile(latencies, 0.95)),
      unexpectedErrors: 0,
    });
  }
  // 210 distinct profiles exceed the service's 128-entry cache. Read them back
  // together: persisted profiles must survive eviction without crossing users.
  await Promise.all(
    users.map(async (user) => {
      const state = await send(user, "GET", "/api/markets?limit=1");
      assert.equal(state.ticketAtomic, String(Number(user.ticket) * 1e6));
      assert.equal(state.filters.poolSize, user.size);
      assert.equal(state.viewer.identity?.address ?? null, user.address);
    }),
  );
  const result = {
    checkedAt: new Date().toISOString(),
    synthetic: true,
    tokens: count,
    profiles,
    authenticatedWalletMessages: identities,
    successfulFreePreviews: previews,
    requests: total,
    groups,
    p95Ms: Math.round(percentile(samples, 0.95)),
    rssMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    isolationAfterCacheEviction: true,
    limitations:
      "Fastify injection with independent cookies/IP fixtures; eight synthetic screened candidates and fixture routes. No real-browser/WebGL, remote providers, SSE or funded trades. Does not establish internet production capacity. Real same-IP rate limiting is covered by stress-public.ts.",
  };
  mkdirSync("docs/evidence/release-audit", { recursive: true });
  writeFileSync(
    `docs/evidence/release-audit/stress-users-${count}.json`,
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  globalThis.fetch = originalFetch;
  await app.close();
  store.close();
}
