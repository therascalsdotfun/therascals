import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { dexChartUrl } from "../apps/web/src/dex-chart.ts";
import { SourceChart } from "../apps/web/src/SourceChart.tsx";
const mint = "So11111111111111111111111111111111111111112";
const pair = "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2";
it("builds an exact-pair embed on a fixed host and excludes token-supplied URLs", () => {
  const u = new URL(dexChartUrl("solana", pair)!);
  expect(u.origin).toBe("https://dexscreener.com");
  expect(u.pathname).toBe("/solana/" + pair);
  expect(u.searchParams.get("embed")).toBe("1");
  expect(dexChartUrl("solana", "https://attacker.example/")).toBeNull();
  expect(dexChartUrl("solana", "../elsewhere")).toBeNull();
  expect(dexChartUrl("near", pair)).toBeNull();
  expect(dexChartUrl("base", pair)).toBeNull();
  expect(dexChartUrl("bsc", "0x" + "12".repeat(20))).toContain("/bsc/0x");
});
it("renders the known exact pair immediately and never displays a stale different mint", () => {
  const token = {
    mint,
    chain: "solana",
    symbol: "SOL",
    dex: { mint, pool: pair },
  } as any;
  const good = renderToStaticMarkup(
    <SourceChart mint={mint} symbol="SOL" source={token} />,
  );
  expect(good).toContain("<iframe");
  expect(good).toContain("/solana/" + pair);
  expect(good).not.toContain("GeckoTerminal");
  const mismatch = renderToStaticMarkup(
    <SourceChart mint={mint} symbol="SOL" source={{ ...token, mint: pair }} />,
  );
  expect(mismatch).not.toContain("<iframe");
});
