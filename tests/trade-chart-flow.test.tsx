import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TradeChartFlow } from "../apps/web/src/TradeChartFlow.tsx";
it("renders the actual source chart without demo controls or simulated receipts", () => {
  const html = renderToStaticMarkup(
    <TradeChartFlow
      token={{ mint: "SOURCE", symbol: "COIN", chain: "solana" } as any}
    />,
  );
  expect(html).toContain("Live market data");
  expect(html).toContain("mainnet source");
  expect(html).not.toMatch(
    /Simulate buy|Demo chart|TEST-USDC|SIMULATED|Test buy|Devnet/,
  );
});
it("keeps the actual chain chart for non-Solana tokens", () => {
  const html = renderToStaticMarkup(
    <TradeChartFlow
      token={{ mint: "SOURCE", symbol: "COIN", chain: "base" } as any}
      baseChart={<div>Base market chart</div>}
    />,
  );
  expect(html).toContain("Base market chart");
  expect(html).not.toContain("Solana mainnet source pool");
});
