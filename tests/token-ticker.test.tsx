import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  tokenTicker,
  tokenIconSymbol,
} from "../packages/shared/src/token-ticker.ts";
import { TokenTicker, PerpsTicker } from "../apps/web/src/TokenMedia.tsx";
it("formats tickers with exactly one dollar prefix, including feeds that already supply it", () => {
  expect(tokenTicker("BTC")).toBe("$BTC");
  expect(tokenTicker(" $WIF ")).toBe("$WIF");
  expect(tokenTicker("$$PEPE")).toBe("$PEPE");
  expect(tokenTicker(null)).toBe("$TOKEN");
});
it("renders bundled Bitcoin art beside the ticker without an external image dependency", () => {
  const html = renderToStaticMarkup(<PerpsTicker symbol="BTC" />);
  expect(html).toContain("$BTC");
  expect(html).toContain("<svg");
  expect(html).not.toContain("<img");
});
it("keeps exact token artwork and uses venue art for curated meme markets", () => {
  const html = renderToStaticMarkup(
    <TokenTicker symbol="$MEME" src="https://cdn.dexscreener.com/token.png" />,
  );
  expect(html).toContain("https://cdn.dexscreener.com/token.png");
  expect(html).not.toContain("$$MEME");
  expect(renderToStaticMarkup(<PerpsTicker symbol="WIF" />)).toContain(
    "https://app.hyperliquid.xyz/coins/WIF.svg",
  );
  expect(tokenIconSymbol("kPEPE")).toBe("PEPE");
  expect(renderToStaticMarkup(<PerpsTicker symbol="kPEPE" />)).toContain(
    "$kPEPE",
  );
});
