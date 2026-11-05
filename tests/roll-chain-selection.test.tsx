import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ChainPicker } from "../apps/web/src/TokenPoolEditor.tsx";
import { CaseOpening } from "../apps/web/src/rolling/CaseOpening.tsx";
import {
  chainsForRoll,
  chooseChain,
} from "../packages/shared/src/roll-chain-selection.ts";
import { discoveryPreset } from "../packages/shared/src/discovery-presets.ts";
import type { FilterSpec } from "../packages/shared/src/market.ts";
const filters: FilterSpec = {
  ...discoveryPreset("broad"),
  chains: ["bsc", "base", "solana"],
  minLiquidity: 7000,
  tokenSelection: { included: ["bsc:0x123"], excluded: [], manualOnly: false },
};
it("all roll styles preserve multiple chains and other filters", () => {
  for (const style of ["lottery", "case"] as const) {
    const next = chainsForRoll(filters, style);
    expect(next.chains).toEqual(["bsc", "base", "solana"]);
    expect(next.tokenSelection).toEqual(filters.tokenSelection);
    expect(next.minLiquidity).toBe(7000);
  }
  expect(chainsForRoll(filters, "degen").chains).toEqual([
    "bsc",
    "base",
    "solana",
  ]);
});
it("single selection replaces the chain while multiple selection toggles and keeps at least one", () => {
  expect(chooseChain(filters, "near", false).chains).toEqual(["near"]);
  expect(chooseChain(filters, "base", true).chains).toEqual(["bsc", "solana"]);
  expect(
    chooseChain({ ...filters, chains: ["base"] }, "base", true).chains,
  ).toEqual(["base"]);
  expect(
    chooseChain({ ...filters, chains: ["base"] }, "bsc", true).chains,
  ).toEqual(["base", "bsc"]);
});
it("single-chain controls are an accessible radio group with all chains available", () => {
  const h = renderToStaticMarkup(
    <ChainPicker
      filters={{ ...filters, chains: ["base"] }}
      disabled={false}
      multiple={false}
      onChange={() => {}}
    />,
  );
  expect(h.match(/type="radio"/g)).toHaveLength(4);
  expect(h).toContain("Choose one chain");
  expect(h).not.toContain('disabled=""');
  expect(h).toMatch(/aria-label="Base · preview only"[^>]*checked=""/);
});
it("Case cards identify each token's actual chain rather than stamping Solana on every card", () => {
  for (const chain of ["base", "bsc", "near"] as const) {
    const h = renderToStaticMarkup(
      <CaseOpening
        tokens={[
          {
            mint: "0x123",
            symbol: "COIN",
            name: "Coin",
            chain,
            marketCap: { value: 100000 },
          } as any,
        ]}
        selected={null}
        phase="idle"
        roll={0}
      />,
    );
    expect(h).not.toContain("SOLANA");
    expect(h).toContain(chain === "bsc" ? "BNB" : chain.toUpperCase());
  }
});
