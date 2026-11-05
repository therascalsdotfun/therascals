// Regression: RELEASE-002 — mainnet Full Degen labelled amounts TEST-USDC.
// Found by /qa on 2026-10-29. Report: docs/release-audit-2026-10-29.md
import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SlotMachine } from "../apps/web/src/rolling/SlotMachine.tsx";
it.each(["USDC", "TEST-USDC"])(
  "labels the amount reel with %s",
  (currencyLabel) => {
    const html = renderToStaticMarkup(
      <SlotMachine
        {...({
          tokens: [],
          chains: ["solana"],
          selected: null,
          amount: null,
          phase: "idle",
          roll: 0,
          onExtracted: () => {},
          onExtractionStart: () => {},
          previewChains: true,
          currencyLabel,
        } as any)}
      />,
    );
    expect(html).toContain(`<small>${currencyLabel}</small>`);
    if (currencyLabel === "USDC") expect(html).not.toContain("TEST-USDC");
  },
);
