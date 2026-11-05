import { it, expect, vi } from "vitest";
import { clientMessage, UserError } from "../apps/server/src/client-message.ts";
import { AuthError } from "../apps/server/src/auth/service.ts";
import { IntentsError } from "../apps/server/src/intents/service.ts";
import { PerpsError } from "../apps/server/src/perps/errors.ts";
import { RewardsError } from "../apps/server/src/rewards/service.ts";
import { EvmTradeError } from "../apps/server/src/mainnet/evm.ts";

it("shows only copy Jackpot authored, everything else becomes the fallback", () => {
  expect(clientMessage(new UserError("Try again in a minute."), "No.")).toBe(
    "Try again in a minute.",
  );
  for (const e of [
    Error("fetch failed: ECONNREFUSED 10.0.3.7:8545"),
    TypeError("Cannot read properties of undefined (reading 'id')"),
    new SyntaxError("Unexpected token < in JSON at position 0"),
    "a provider threw a string",
    null,
  ])
    expect(clientMessage(e, "Provider unavailable.")).toBe(
      "Provider unavailable.",
    );
});

it("keeps every domain error class inside the displayable hierarchy", () => {
  for (const e of [
    new AuthError("SIGNED_OUT", "Sign in again."),
    new IntentsError("Intent expired."),
    new PerpsError("Daily loss cap reached."),
    new RewardsError("Reward already claimed."),
    new EvmTradeError("Wrong RPC network."),
  ])
    expect(clientMessage(e, "Request unavailable.")).toBe(e.message);
});

it("logs the suppressed error once for the operator", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    clientMessage(
      Error("upstream said: pool overflow"),
      "Chart unavailable.",
      "chart",
    );
    expect(warn).toHaveBeenCalledWith(
      "chart:",
      expect.stringContaining("pool overflow"),
    );
    clientMessage(new UserError("Cooling down."), "No.", "chart");
    expect(warn).not.toHaveBeenCalledTimes(2);
  } finally {
    warn.mockRestore();
  }
});
