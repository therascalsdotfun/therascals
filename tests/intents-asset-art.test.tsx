import { it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { IntentsAssetLabel } from "../apps/web/src/IntentsAssetLabel.tsx";
it("does not brand a ticker lookalike as the native Intents asset", () => {
  const fake = renderToStaticMarkup(
    <IntentsAssetLabel
      asset={{
        assetId: "nep141:fake.test.near",
        symbol: "NEAR",
        blockchain: "near",
        decimals: 24,
      }}
    />,
  );
  const real = renderToStaticMarkup(
    <IntentsAssetLabel
      asset={{
        assetId: "nep141:wrap.near",
        symbol: "NEAR",
        blockchain: "near",
        decimals: 24,
      }}
    />,
  );
  expect(fake).not.toContain("<svg");
  expect(fake).toContain("NE");
  expect(real).toContain("<svg");
});
it("uses the exact destination artwork and rejects unsafe art URLs", () => {
  const asset = {
    assetId: "nep141:token.near",
    symbol: "SAME",
    blockchain: "near" as const,
    decimals: 6,
    icon: "https://example.com/exact-art.png",
  };
  expect(renderToStaticMarkup(<IntentsAssetLabel asset={asset} />)).toContain(
    "https://example.com/exact-art.png",
  );
  expect(
    renderToStaticMarkup(
      <IntentsAssetLabel asset={{ ...asset, icon: "javascript:alert(1)" }} />,
    ),
  ).not.toContain("<img");
});
