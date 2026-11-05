export type TokenRisk = {
  mint: string;
  source: "RugCheck" | "GoPlus" | "Not configured";
  chain?: "base" | "bsc" | "near";
  status: "checked" | "flagged" | "stale" | "unavailable";
  checkedAt: string;
  /** Legacy wire name for RugCheck detectedAt (token detection, not scan time). */
  reportAt: string | null;
  score: number | null;
  risks: { name: string; level: string; description: string }[];
  error?: string;
};
export type TokenIdentity = { winnerMint: string; count: number };
