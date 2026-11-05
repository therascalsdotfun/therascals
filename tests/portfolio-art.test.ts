import { expect, it } from "vitest";
import { assetBrand } from "../apps/web/src/portfolio/asset-art.ts";
import { SOLANA_SELL_OUTPUTS } from "../packages/shared/src/sell-output.ts";
it("only brands the exact contract on its matching network", () => {
  expect(assetBrand(SOLANA_SELL_OUTPUTS.USDC.mint, "Solana mainnet")).toBe(
    "USDC",
  );
  expect(
    assetBrand(SOLANA_SELL_OUTPUTS.USDC.mint, "Solana Devnet"),
  ).toBeUndefined();
  expect(assetBrand("lookalike-usdc", "Solana mainnet")).toBeUndefined();
  expect(assetBrand("native", "EVM", "0x38")).toBe("BNB");
  expect(assetBrand("native", "EVM", "0x61")).toBeUndefined();
  expect(
    assetBrand(
      "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "Base mainnet",
      "0x2105",
    ),
  ).toBe("USDC");
  expect(
    assetBrand(
      "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "BNB Chain mainnet",
      "0x38",
    ),
  ).toBeUndefined();
});
