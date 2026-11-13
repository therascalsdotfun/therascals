import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PerpsPage } from "../apps/web/src/perps/PerpsGame.tsx";

const mockGame: any = {
  network: "mainnet",
  phase: "idle",
  spin: null,
  result: null,
  selectedMarkets: [],
  amountCap: 100,
  busy: false,
  error: "",
  account: null,
  positions: [],
  history: [],
  universe: { markets: [] },
  catalog: { markets: [] },
  clearError: () => {},
};

it("renders the confidential perps hub with near.com integration by default", () => {
  const html = renderToStaticMarkup(<PerpsPage game={mockGame} />);
  expect(html).toContain("Trade Perps, Confidentially");
  expect(html).toContain("perps.near.com");
  expect(html).toContain("Launch near.com Perps");
  expect(html).toContain("40x Leverage");
  expect(html).toContain("NEAR Intents");
  expect(html).toContain("BTC-PERP");
  expect(html).toContain("ETH-PERP");
  expect(html).toContain("SOL-PERP");
});

it("supports pre-IPO equities and ecosystem perps (JIO, RELIANCE, PEARL) via perps.near.com and trade.xyz", () => {
  const html = renderToStaticMarkup(<PerpsPage game={mockGame} />);
  expect(html).toContain("JIO-PERP");
  expect(html).toContain("RELIANCE-PERP");
  expect(html).toContain("PEARL-PERP");
  expect(html).toContain("trade.xyz");
  expect(html).toContain("India’s biggest IPO");
  expect(html).toContain("Pre-IPO &amp; Equities 24/7");
  expect(html).toContain("NEAR Ecosystem");
});

it("includes mode toggle between confidential hub and arcade slot mode", () => {
  const html = renderToStaticMarkup(<PerpsPage game={mockGame} />);
  expect(html).toContain("Confidential Hub (near.com)");
  expect(html).toContain("Arcade Slot Mode");
});
