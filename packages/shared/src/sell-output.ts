export const SOLANA_SELL_OUTPUTS = {
  USDC: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
  SOL: { mint: "So11111111111111111111111111111111111111112", decimals: 9 },
} as const;
export type SellOutput = keyof typeof SOLANA_SELL_OUTPUTS;
export type SellEstimate = {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  observedAt: number;
  expiresAt: number;
};
export function matchesSellEstimate(
  q: SellEstimate | undefined,
  inputMint: string,
  output: SellOutput,
  amount: string,
  now = Date.now(),
) {
  return (
    !!q &&
    q.inputMint === inputMint &&
    q.outputMint === SOLANA_SELL_OUTPUTS[output].mint &&
    q.inAmount === amount &&
    typeof q.outAmount === "string" &&
    /^[1-9]\d{0,19}$/.test(q.outAmount) &&
    Number.isFinite(q.observedAt) &&
    Number.isFinite(q.expiresAt) &&
    q.observedAt <= now + 1000 &&
    q.observedAt > now - 30000 &&
    q.expiresAt > now &&
    q.expiresAt <= q.observedAt + 30000
  );
}
