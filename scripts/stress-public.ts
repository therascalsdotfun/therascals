/** Local public HTTP stress probe. Synthetic observations, no provider workers,
 * wallets, signing keys, funding or outbound requests. Never targets a URL.
 * Run: pnpm exec tsx scripts/stress-public.ts
 */
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { writeFileSync, mkdirSync } from "node:fs";
import bs58 from "bs58";
import { MarketStore } from "../apps/server/src/market/store.ts";
import { MarketService } from "../apps/server/src/market/service.ts";
import { normalizeJupiter } from "../apps/server/src/market/model.ts";
import { createApp } from "../apps/server/src/http/app.ts";
import { registerFrontend } from "../apps/server/src/http/frontend.ts";

const tokenCount = Number(process.env.STRESS_TOKEN_COUNT ?? 10000);
assert.ok(
  Number.isInteger(tokenCount) && tokenCount >= 1000 && tokenCount <= 50000,
);
const store = new MarketStore(":memory:"),
  now = Date.now();
const tokens = Array.from({ length: tokenCount }, (_, i) => {
  const key = Buffer.alloc(32, 7);
  key.writeUInt32LE(i, 0);
  return normalizeJupiter(
    {
      id: bs58.encode(key),
      name: `Synthetic ${i}`,
      symbol: `S${i}`,
      decimals: 6,
      createdAt: new Date(now - 3600_000).toISOString(),
      firstPool: {
        id: `fixture-${i}`,
        createdAt: new Date(now - 1800_000).toISOString(),
      },
      updatedAt: new Date(now).toISOString(),
      mcap: 20000 + i,
      liquidity: 10000,
      usdPrice: 0.001,
      holderCount: 200,
      stats5m: { buyVolume: 2000, sellVolume: 1000, numBuys: 30, numSells: 10 },
      audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true },
    },
    now,
  )!;
});
store.upsert(tokens);
const service = new MarketService(store);
const app = await createApp(service, undefined, {
  store,
  runtime: {
    mode: "public",
    origins: new Set(["https://rascals.example"]),
    slots: [],
  },
});
await registerFrontend(app);
const metrics: Record<string, unknown> = {};
const percentile = (xs: number[], p: number) =>
  [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) * p)];
async function load(
  name: string,
  count: number,
  concurrency: number,
  work: (i: number) => Promise<number>,
) {
  let next = 0;
  const latencies: number[] = [],
    statuses: Record<string, number> = {};
  const start = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (;;) {
        const i = next++;
        if (i >= count) break;
        const t = performance.now();
        const status = await work(i);
        latencies.push(performance.now() - t);
        statuses[status] = (statuses[status] ?? 0) + 1;
      }
    }),
  );
  metrics[name] = {
    count,
    concurrency,
    elapsedMs: Math.round(performance.now() - start),
    p50Ms: Math.round(percentile(latencies, 0.5)),
    p95Ms: Math.round(percentile(latencies, 0.95)),
    maxMs: Math.round(Math.max(...latencies)),
    statuses,
  };
}
try {
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  await load("httpHealth", 1000, 50, async () => {
    const r = await fetch(address + "/api/health", {
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).ok, true);
    return r.status;
  });
  // Per-client addresses are Fastify inject fixtures, never trusted proxy headers.
  await load("catalogReads", 200, 20, async (i) => {
    const r = await app.inject({
      url: "/api/markets?limit=20",
      remoteAddress: `192.0.2.${(i % 100) + 1}`,
    });
    assert.equal(r.statusCode, 200);
    const d = r.json();
    assert.equal(d.observed, tokenCount);
    assert.equal(d.rows.length, 20);
    assert.equal(d.pool.length, 0);
    return r.statusCode;
  });
  const ratelimit = await Promise.all(
    Array.from({ length: 300 }, () =>
      app.inject({ url: "/api/runtime", remoteAddress: "198.51.100.2" }),
    ),
  );
  const counts = ratelimit.reduce(
    (a, r) => ((a[r.statusCode] = (a[r.statusCode] ?? 0) + 1), a),
    {} as Record<string, number>,
  );
  assert.equal(counts[200], 240);
  assert.equal(counts[429], 60);
  assert.ok(
    ratelimit
      .filter((r) => r.statusCode === 429)
      .every((r) => r.headers["retry-after"] === "60"),
  );
  metrics.rateLimit = { requests: 300, statuses: counts };
  for (const path of [
    "/.credentials/wallets.json",
    "/.data/public.sqlite",
    "/README.md",
    "/api/execution/smoke-draw",
  ])
    assert.equal((await app.inject(path)).statusCode, 404);
  for (const headers of [{}, { origin: "https://evil.example" }])
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/discovery",
          headers,
          payload: { ticket: "5" },
        })
      ).statusCode,
      403,
    );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/intents/operations",
        headers: { origin: "https://rascals.example" },
        payload: {},
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/discovery",
        headers: { origin: "https://rascals.example" },
        payload: { ticket: "5", filters: { poolSize: 33 } },
      })
    ).statusCode,
    400,
  );
  metrics.boundaries = {
    privatePathsDenied: true,
    exactOriginRequired: true,
    mainnetWalletRequired: true,
    invalidPoolRejected: true,
  };
  metrics.memoryMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
  metrics.limitations =
    "Single local process; synthetic catalog; outbound providers and chain execution are not load-tested. HTTP health uses sockets; catalog/rate-limit probes use Fastify injection.";
  const report = {
    checkedAt: new Date().toISOString(),
    synthetic: true,
    tokens: tokens.length,
    metrics,
  };
  mkdirSync("docs/evidence/release-audit", { recursive: true });
  writeFileSync(
    `docs/evidence/release-audit/stress-public-${tokenCount}.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await app.close();
  store.close();
}
