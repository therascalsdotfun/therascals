import { expect, it } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { reviewPool } from "../apps/agent/src/pool-review.ts";
import { createAgentServer } from "../apps/agent/src/server.ts";
const now = 1793620000000;
const sample = () => {
  const pool = ["a", "b"].map((mint) => ({
    mint,
    id: mint,
    symbol: mint,
    chain: "solana",
    icon: null,
    sourceUpdatedAt: new Date(now).toISOString(),
  }));
  return {
    now: new Date(now).toISOString(),
    configurationHash: "a".repeat(64),
    ticketAtomic: "5000000",
    filters: { chains: ["solana"] },
    health: { state: "live" },
    pool,
    rows: pool.map((token) => ({
      token,
      matches: true,
      reasons: [],
      admissionReasons: [],
      route: {
        status: "eligible",
        ticketAtomic: "5000000",
        expiresAt: now + 10000,
        buy: {},
        sell: {},
      },
    })),
    page: { offset: 0, limit: 50, total: 2, nextOffset: null },
  } as any;
};
it("explains only the supplied screened pool without ranking or changing it", () => {
  const data = sample(),
    before = JSON.stringify(data);
  const r = reviewPool(data, "a".repeat(64), now);
  expect(r.status).toBe("screened_pool");
  expect(r.members.map((m) => m.mint)).toEqual(["a", "b"]);
  expect(r.scope).toContain("Agent visitor");
  expect(JSON.stringify(data)).toBe(before);
});
it("fails closed on stale evidence, changed configuration, degraded providers and preview chains", () => {
  for (const mutate of [
    (d: any) => (d.now = new Date(now - 30001).toISOString()),
    (d: any) => (d.configurationHash = "b".repeat(64)),
    (d: any) => (d.health.state = "rate_limited"),
    (d: any) => (d.pool[0].previewOnly = true),
    (d: any) => (d.rows[0].route.expiresAt = now),
    (d: any) => (d.rows[0].route.ticketAtomic = "1000000"),
    (d: any) => (d.rows = []),
    (d: any) => d.pool.pop(),
  ]) {
    const d = sample();
    mutate(d);
    expect(reviewPool(d, "a".repeat(64), now).status).toBe("blocked");
  }
});
it("uses only one bounded GET and never forwards wallet identity or execution credentials", async () => {
  const calls: any[] = [];
  const data = sample();
  data.now = new Date().toISOString();
  data.pool.forEach((t: any) => (t.sourceUpdatedAt = data.now));
  data.rows.forEach((r: any) => (r.route.expiresAt = Date.now() + 20000));
  data.viewer = { identity: { address: "private-wallet" } };
  data.execution = { solanaAddress: "private-policy-address" };
  const server = createAgentServer(
    "http://127.0.0.1:4317",
    async (url: any, init: any) => {
      calls.push({ url, init });
      return Response.json(data);
    },
  );
  const client = new Client({ name: "review-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  try {
    const r = await client.callTool({
      name: "review_pool",
      arguments: { expectedConfigurationHash: "a".repeat(64) },
    });
    expect(r.isError).not.toBe(true);
    expect(JSON.stringify(r)).toContain("screened_pool");
    expect(JSON.stringify(r)).not.toMatch(
      /private-wallet|private-policy-address/,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].init.method).toBe("GET");
    expect(calls[0].url).toContain("limit=50");
  } finally {
    await client.close();
    await server.close();
  }
});
