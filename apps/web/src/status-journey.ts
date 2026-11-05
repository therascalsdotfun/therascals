export type JourneyStepState =
  "complete" | "active" | "pending" | "failed" | "unresolved";
export type JourneyTone = "success" | "active" | "failed" | "attention";
export function evmJourney(
  status?: string,
  preflight?: string,
): {
  headline: string;
  badge: string;
  tone: JourneyTone;
  states: JourneyStepState[];
} {
  if (!status && ["failed", "insufficient_funds"].includes(preflight ?? ""))
    return {
      headline:
        preflight === "insufficient_funds"
          ? "Balance too low"
          : "Preflight blocked",
      badge: "Review checks",
      tone: "attention",
      states: ["complete", "pending", "failed", "pending"],
    };
  if (status === "success")
    return {
      headline: "Trade confirmed",
      badge: "Confirmed",
      tone: "success",
      states: ["complete", "complete", "complete", "complete"],
    };
  if (status === "reverted")
    return {
      headline: "Transaction reverted",
      badge: "Reverted",
      tone: "failed",
      states: ["complete", "complete", "failed", "failed"],
    };
  if (status === "unknown")
    return {
      headline: "Check transaction status",
      badge: "Unresolved",
      tone: "attention",
      states: ["complete", "unresolved", "pending", "pending"],
    };
  if (status === "pending")
    return {
      headline: "Waiting for chain confirmation",
      badge: "Submitted",
      tone: "active",
      states: ["complete", "complete", "active", "pending"],
    };
  return {
    headline: "Review in your wallet",
    badge: "Your approval",
    tone: "active",
    states: ["complete", "active", "pending", "pending"],
  };
}
export function reportedJourney(
  submitted: boolean,
  busy: boolean,
  error: boolean,
): ReturnType<typeof evmJourney> {
  if (submitted)
    return {
      headline: "Submitted · verify the receipt",
      badge: "Check receipt",
      tone: "attention",
      states: ["complete", "complete", "complete", "unresolved"],
    };
  if (error)
    return {
      headline: "Review transaction status",
      badge: "Needs attention",
      tone: "attention",
      states: ["complete", "unresolved", "pending", "pending"],
    };
  return {
    headline: busy ? "Waiting for wallet approval" : "Review your swap",
    badge: busy ? "In progress" : "Your approval",
    tone: "active",
    states: ["complete", busy ? "active" : "pending", "pending", "pending"],
  };
}
export function intentsJourney(
  phase: string,
  deposit: boolean,
): ReturnType<typeof evmJourney> {
  if (phase === "success")
    return {
      headline: "Destination transfer reported",
      badge: "Provider reported",
      tone: "success",
      states: ["complete", "complete", "complete", "complete"],
    };
  if (phase === "refunded")
    return {
      headline: "Refund reported",
      badge: "Refunded",
      tone: "attention",
      states: ["complete", "complete", "complete", "complete"],
    };
  if (phase === "funding_failed")
    return {
      headline: "Source funding failed",
      badge: "Not funded",
      tone: "failed",
      states: ["complete", "failed", "pending", "pending"],
    };
  if (["unknown", "needs_attention"].includes(phase))
    return {
      headline: "Swap needs a status check",
      badge: "Unresolved",
      tone: "attention",
      states: [
        "complete",
        deposit ? "complete" : "unresolved",
        "unresolved",
        "pending",
      ],
    };
  return {
    headline: deposit ? "Swap in progress" : "Review the deposit",
    badge: deposit ? "Processing" : "Your approval",
    tone: "active",
    states: [
      "complete",
      deposit ? "complete" : "active",
      deposit ? "active" : "pending",
      "pending",
    ],
  };
}

export function perpsJourney(phase: string): ReturnType<typeof evmJourney> {
  if (phase === "failed")
    return {
      headline: "Position request failed",
      badge: "Failed",
      tone: "failed",
      states: ["complete", "failed", "pending"],
    };
  if (phase === "liquidated")
    return {
      headline: "Position liquidated",
      badge: "Liquidated",
      tone: "attention",
      states: ["complete", "complete", "complete"],
    };
  if (phase === "closed")
    return {
      headline: "Position closed",
      badge: "Closed",
      tone: "success",
      states: ["complete", "complete", "complete"],
    };
  if (phase === "open")
    return {
      headline: "Position open",
      badge: "Open",
      tone: "success",
      states: ["complete", "complete", "complete"],
    };
  return {
    headline: phase === "closing" ? "Closing position" : "Opening position",
    badge: "Awaiting venue",
    tone: "active",
    states: ["complete", "active", "pending"],
  };
}
