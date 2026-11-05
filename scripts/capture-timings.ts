import { writeFileSync } from "node:fs";
import { MarketStore } from "../apps/server/src/market/store.ts";
const store = new MarketStore(".data/jackpot.sqlite");
const samples = store
  .records<any>("op:")
  .filter((o) => o.phase === "finalized_success" && o.timeline?.length > 1)
  .map((o) => ({
    operationId: o.id,
    side: o.buy === false ? "sell" : "buy",
    signature: o.attempt?.signature,
    elapsedMs: o.timeline.at(-1).at - o.timeline[0].at,
    timeline: o.timeline,
  }));
store.close();
const summary = ["buy", "sell"].map((side) => {
  const values = samples
    .filter((s) => s.side === side)
    .map((s) => s.elapsedMs)
    .sort((a, b) => a - b);
  return {
    side,
    n: values.length,
    p50Ms: values.length ? values[Math.ceil(values.length * 0.5) - 1] : null,
    p95Ms: values.length ? values[Math.ceil(values.length * 0.95) - 1] : null,
  };
});
writeFileSync(
  "docs/evidence/timings.json",
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      method:
        "First persisted operation phase through finalized settlement; nearest-rank percentiles; includes real RPC wait and any restart downtime. Tiny local sample, not a production latency estimate.",
      summary,
      samples,
    },
    null,
    2,
  ),
);
console.log(summary);
