import { mkdirSync, writeFileSync } from "node:fs";
const r = await fetch("http://127.0.0.1:4317/api/markets?matchingOnly=true", {
  signal: AbortSignal.timeout(10000),
});
if (!r.ok) throw new Error("Start pnpm dev before running provider smoke");
const data = await r.json();
const report = {
  checkedAt: new Date().toISOString(),
  health: data.health,
  observed: data.observed,
  matching: data.matching,
  eligible: data.eligible,
  ticketAtomic: data.ticketAtomic,
  configurationHash: data.configurationHash,
  coverage: data.coverage,
  examples: data.rows.slice(0, 3).map((r: any) => ({
    mint: r.token.mint,
    symbol: r.token.symbol,
    mintCreatedAt: r.token.mintCreatedAt,
    firstPoolCreatedAt: r.token.firstPoolCreatedAt,
    marketCap: r.token.marketCap,
    volume5m: r.token.volume5m,
  })),
  quotePairs: data.rows
    .filter((r: any) => r.route?.status === "eligible")
    .slice(0, 2)
    .map((r: any) => r.route),
};
mkdirSync("docs/evidence", { recursive: true });
writeFileSync(
  "docs/evidence/provider-smoke.json",
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify(
    {
      observed: report.observed,
      matching: report.matching,
      eligible: report.eligible,
      health: report.health,
      report: "docs/evidence/provider-smoke.json",
    },
    null,
    2,
  ),
);
if (data.health.state !== "live" || !data.observed) process.exitCode = 1;
