/** Fee-inclusive USDC entry accounting. Six decimals; never floating-point money. */
export const PROTOCOL_FEE_BPS = 50;
export const PROTOCOL_FEE_VERSION = "usdc-entry-v1";
export function protocolFeeSplit(grossAtomic: string) {
  if (!/^[1-9]\d{0,19}$/.test(grossAtomic))
    throw Error("Expected a positive atomic USDC input");
  const gross = BigInt(grossAtomic);
  if (gross > 18446744073709551615n) throw Error("USDC input exceeds u64");
  const fee = (gross * BigInt(PROTOCOL_FEE_BPS)) / 10000n;
  return {
    version: PROTOCOL_FEE_VERSION,
    feeBps: PROTOCOL_FEE_BPS,
    grossAtomic,
    feeAtomic: String(fee),
    principalAtomic: String(gross - fee),
  };
}
