import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DrawOutcome } from "../apps/web/src/DrawOutcome.tsx";
it("keeps a free reveal distinct from an approved purchase and offers real routes", () => {
  const html = renderToStaticMarkup(
    <DrawOutcome symbol="COIN" onReset={() => {}} onQuote={() => {}} />,
  );
  expect(html).toContain("COIN pulled.");
  expect(html).toContain('role="status"');
  expect(html).toContain("Free preview · nothing bought.");
  expect(html).toContain("Review mainnet routes");
  expect(html).toContain("Roll again");
  expect(html).not.toMatch(/test trading|test position|Devnet|Test Mode/);
});

it("uses known contract identity for missing artwork rather than trusting a SOL ticker", () => {
  const props = { symbol: "SOL", onReset: () => {}, onQuote: () => {} };
  const unknown = renderToStaticMarkup(<DrawOutcome {...props} />);
  const known = renderToStaticMarkup(
    <DrawOutcome
      {...props}
      mint="So11111111111111111111111111111111111111112"
      chain="solana"
    />,
  );
  expect(unknown).toContain(">SO</span>");
  expect(known).not.toContain(">SO</span>");
  expect(known).toContain("Free preview · nothing bought.");
});
