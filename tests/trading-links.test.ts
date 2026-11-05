import { expect, it } from "vitest";
import { selectedPairLinks } from "../packages/shared/src/trading-links.ts";
it("carries exact mint identities, not ambiguous symbols, and rejects malformed sources", () => {
  const mint = "FcWCfnrFdASwSriuhPTfgSXFzWy97D8ghnhFU9Po2Z3L";
  const links = selectedPairLinks(mint);
  const url = new URL(links!.jupiter);
  expect(url.pathname).toBe("/swap");
  expect(url.searchParams.get("buy")).toBe(mint);
  expect(url.searchParams.get("sell")).toBe(
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  );
  expect(selectedPairLinks("javascript:alert(1)")).toBeNull();
  expect(selectedPairLinks("TRUMP")).toBeNull();
  expect(links?.near).toBe("https://near.com/home");
});
