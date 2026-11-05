import { expect, it } from "vitest";
import bs58 from "bs58";
import {
  parseRiskReport,
  RiskData,
  riskReasons,
} from "../apps/server/src/market/security.ts";
const mint = bs58.encode(new Uint8Array(32).fill(12)),
  now = 1793010000000;
const report = (extra: any = {}) => ({
  mint,
  tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  token: { mintAuthority: null, freezeAuthority: null },
  rugged: false,
  detectedAt: new Date(now).toISOString(),
  risks: [],
  score: 1,
  ...extra,
});
it("passes only exact-mint recent complete reports and blocks provider risks and active authorities", () => {
  expect(parseRiskReport(report(), mint, now).status).toBe("checked");
  for (const extra of [
    { rugged: true },
    {
      risks: [
        { name: "LP unlocked", level: "danger", description: "Withdrawable" },
      ],
    },
    { token: { mintAuthority: mint, freezeAuthority: null } },
  ])
    expect(parseRiskReport(report(extra), mint, now).status).toBe("flagged");
  for (const extra of [
    { mint: "wrong" },
    { risks: null },
    { rugged: undefined },
    { token: {} },
    { detectedAt: "bad" },
    { tokenProgram: "wrong" },
  ])
    expect(() => parseRiskReport(report(extra), mint, now)).toThrow();
  expect(
    parseRiskReport(
      report({ detectedAt: new Date(now - 900001).toISOString() }),
      mint,
      now,
    ).status,
  ).toBe("checked");
  expect(riskReasons(undefined, now)).toContain("security_pending");
  expect(
    riskReasons(parseRiskReport(report(), mint, now), now + 300001),
  ).toContain("security_stale");
});
it("deduplicates scans and fails closed after rate limiting without hammering", async () => {
  let at = now,
    calls = 0,
    fail = false;
  const data = new RiskData(
    async () => {
      calls++;
      return fail
        ? new Response("{}", { status: 429 })
        : new Response(JSON.stringify(report()));
    },
    0,
    () => at,
  );
  const results = await Promise.all([data.scan(mint), data.scan(mint)]);
  expect(calls).toBe(1);
  expect(results[0].status).toBe("checked");
  await data.scan(mint);
  expect(calls).toBe(1);
  at += 300001;
  fail = true;
  expect((await data.scan(mint)).status).toBe("unavailable");
  expect((await data.scan(mint)).status).toBe("unavailable");
  expect(calls).toBe(2);
});

it("bounds queue/request wait and marks timed-out scans unavailable", async () => {
  const { vi } = await import("vitest");
  vi.useFakeTimers();
  let release!: (value: Response) => void;
  const data = new RiskData(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
    0,
    () => Date.now(),
  );
  try {
    const pending = data.scan(mint, 60000, 3);
    await vi.advanceTimersByTimeAsync(20001);
    expect((await pending).status).toBe("unavailable");
    expect(data.peek(mint)?.status).toBe("unavailable");
    release(new Response("{}"));
    await Promise.resolve();
  } finally {
    vi.useRealTimers();
  }
});

it("rejects oversized provider reports before parsing untrusted JSON", async () => {
  const data = new RiskData(
    async () => new Response(" ".repeat(2_000_001)),
    0,
    () => now,
  );
  const result = await data.scan(mint);
  expect(result.status).toBe("unavailable");
  expect(result.error).toContain("too large");
  expect(riskReasons(result, now)).toContain("security_unavailable");
});

it("uses response receipt age rather than token detection age for expiry", () => {
  const oldDetection = report({
    detectedAt: new Date(now - 86400000).toISOString(),
  });
  const checked = parseRiskReport(oldDetection, mint, now);
  expect(checked.status).toBe("checked");
  expect(riskReasons(checked, now)).toEqual([]);
  expect(riskReasons(checked, now + 300001)).toEqual(["security_stale"]);
  const flagged = parseRiskReport(
    {
      ...oldDetection,
      risks: [
        {
          name: "Copycat token",
          level: "warn",
          description: "Known symbol collision",
        },
      ],
    },
    mint,
    now,
  );
  expect(flagged.status).toBe("flagged");
  expect(riskReasons(flagged, now)).toEqual(["security_flagged"]);
});

it("refreshes an older token's report at the pre-buy receipt limit and blocks new warnings", async () => {
  let at = now,
    calls = 0;
  const data = new RiskData(
    async () => {
      calls++;
      return new Response(
        JSON.stringify(
          report({
            detectedAt: new Date(now - 86400000).toISOString(),
            risks:
              calls > 1
                ? [
                    {
                      name: "LP unlocked",
                      level: "danger",
                      description: "Liquidity changed",
                    },
                  ]
                : [],
          }),
        ),
      );
    },
    0,
    () => at,
  );
  expect((await data.scan(mint)).status).toBe("checked");
  at += 60001;
  expect((await data.scan(mint, 60000, 3)).status).toBe("flagged");
  expect(calls).toBe(2);
});
