import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  evmJourney,
  reportedJourney,
  intentsJourney,
  perpsJourney,
} from "../apps/web/src/status-journey.ts";
import { StatusJourney } from "../apps/web/src/StatusJourney.tsx";
import { ReportedSwapJourney } from "../apps/web/src/ReportedSwapJourney.tsx";
import { TokenIcon } from "../apps/web/src/TokenMedia.tsx";

it("never calls a submitted, ambiguous or reverted EVM trade confirmed", () => {
  for (const status of ["awaiting_wallet", "pending", "unknown", "reverted"]) {
    const view = evmJourney(status);
    expect(view.states.every((s) => s === "complete")).toBe(false);
    expect(view.badge).not.toBe("Confirmed");
  }
  expect(evmJourney("pending").states[3]).toBe("pending");
  expect(evmJourney("unknown").states[1]).toBe("unresolved");
  expect(evmJourney("success").states).toEqual(Array(4).fill("complete"));
  expect(evmJourney(undefined, "insufficient_funds").headline).toBe(
    "Balance too low",
  );
  expect(evmJourney(undefined, "failed").tone).toBe("attention");
});
it("keeps provider-callback Solana receipts unresolved until independently verified", () => {
  const view = reportedJourney(true, false, false);
  expect(view.tone).toBe("attention");
  expect(view.states.at(-1)).toBe("unresolved");
  const html = renderToStaticMarkup(
    <ReportedSwapJourney
      input="USDC"
      output="SOL"
      inputIcon={<TokenIcon symbol="USDC" branded />}
      outputIcon={<TokenIcon symbol="SOL" branded />}
      submitted
      busy={false}
      error={false}
    />,
  );
  expect(html).toContain("verify the receipt");
  expect(html).toContain('aria-label="SOL: unresolved"');
  expect(html).not.toContain("Trade confirmed");
});
it("represents refunds, unknown deposits and funding failures without claiming a destination fill", () => {
  expect(intentsJourney("prepared", false).states).toEqual([
    "complete",
    "active",
    "pending",
    "pending",
  ]);
  expect(intentsJourney("unknown", false).states[1]).toBe("unresolved");
  expect(intentsJourney("funding_failed", false).states[3]).toBe("pending");
  expect(intentsJourney("refunded", true).headline).toBe("Refund reported");
  expect(intentsJourney("refunded", true).tone).toBe("attention");
  expect(intentsJourney("success", true).badge).toBe("Provider reported");
});
it("keeps an open perp distinct from a closed or liquidated position", () => {
  expect(perpsJourney("opening").states.at(-1)).toBe("pending");
  expect(perpsJourney("closing").badge).toBe("Awaiting venue");
  expect(perpsJourney("open").headline).toBe("Position open");
  expect(perpsJourney("closed").headline).toBe("Position closed");
  expect(perpsJourney("liquidated").tone).toBe("attention");
  expect(perpsJourney("failed").states).toContain("failed");
});
it("renders semantic states, token art and labels without manufacturing duration or links", () => {
  const html = renderToStaticMarkup(
    <StatusJourney
      headline="Submitted"
      badge="Pending"
      tone="active"
      nodes={[
        {
          id: "input",
          name: "USDC",
          label: "USDC",
          icon: <TokenIcon symbol="USDC" branded size={32} />,
          state: "complete",
        },
        {
          id: "output",
          name: "SOL",
          label: "SOL",
          icon: <TokenIcon symbol="SOL" branded size={32} />,
          state: "pending",
        },
      ]}
    />,
  );
  expect(html).toContain('aria-live="polite"');
  expect(html).toContain('aria-label="SOL: pending"');
  expect(html).toContain('data-state="pending"');
  expect(html).not.toContain("1.2s");
  expect(html).not.toContain("href=");
});
