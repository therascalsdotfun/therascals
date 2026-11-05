/** All quantities and costs are atomic strings; quotes are never acquisition evidence. */
export type TrackedFill = {
  signature: string;
  wallet: string;
  mint: string;
  decimals: number;
  time: number;
  slot: number;
  before: string;
  after: string;
  usdcDelta: string;
};
export type TrackedPosition = {
  mint: string;
  decimals: number;
  quantityAtomic: string;
  costUsdcAtomic: string | null;
  coverage: "tracked-receipts";
  lastTradeAt: string;
};
export function trackedPositions(fills: TrackedFill[]): TrackedPosition[] {
  const result = new Map<string, TrackedPosition>();
  fills = [...new Map(fills.map((f) => [f.signature, f])).values()];
  const seen = new Set<string>();
  // Do not guess ordering when two transactions share a slot.
  const slots = new Map<string, number>();
  for (const f of fills)
    slots.set(
      `${f.mint}:${f.slot}`,
      (slots.get(`${f.mint}:${f.slot}`) ?? 0) + 1,
    );
  for (const f of [...fills].sort(
    (a, b) => a.slot - b.slot || a.time - b.time,
  )) {
    if (seen.has(f.signature)) continue;
    seen.add(f.signature);
    const before = BigInt(f.before),
      after = BigInt(f.after),
      usd = BigInt(f.usdcDelta);
    const prior = result.get(f.mint);
    let cost: bigint | null =
      before === 0n
        ? 0n
        : prior &&
            prior.decimals === f.decimals &&
            prior.quantityAtomic === f.before &&
            prior.costUsdcAtomic !== null
          ? BigInt(prior.costUsdcAtomic)
          : null;
    const change = after - before;
    if ((slots.get(`${f.mint}:${f.slot}`) ?? 0) > 1) cost = null;
    if (change > 0n && usd < 0n) cost = cost === null ? null : cost - usd;
    else if (change < 0n && usd > 0n && before > 0n)
      cost = cost === null ? null : (cost * after) / before;
    else cost = null;
    result.set(f.mint, {
      mint: f.mint,
      decimals: f.decimals,
      quantityAtomic: String(after),
      costUsdcAtomic: cost === null ? null : String(cost),
      coverage: "tracked-receipts",
      lastTradeAt: new Date(f.time * 1000).toISOString(),
    });
  }
  return [...result.values()];
}
export function positionMetrics(
  raw: string,
  decimals: number,
  valueUsd: number | null | undefined,
  position?: TrackedPosition,
) {
  const known =
    position &&
    position.quantityAtomic === raw &&
    position.decimals === decimals &&
    position.costUsdcAtomic !== null &&
    BigInt(raw) > 0n;
  const cost = known ? Number(position.costUsdcAtomic) / 1e6 : null;
  const quantity = Number(raw) / 10 ** decimals;
  const validCost =
    cost !== null &&
    Number.isFinite(cost) &&
    cost > 0 &&
    Number.isFinite(quantity) &&
    quantity > 0;
  const entry = validCost ? cost / quantity : null;
  const pnl =
    validCost && typeof valueUsd === "number" && Number.isFinite(valueUsd)
      ? valueUsd - cost
      : null;
  return {
    entry,
    cost: validCost ? cost : null,
    pnl,
    percent: pnl !== null && cost !== null ? (pnl / cost) * 100 : null,
  };
}
export const SELL_PERCENTAGES = [10, 25, 50, 75, 100] as const;
export function percentageAtomic(balance: string, percent: number) {
  if (!/^\d{1,80}$/.test(balance) || !SELL_PERCENTAGES.includes(percent as any))
    throw Error("Invalid balance or percentage");
  return String((BigInt(balance) * BigInt(percent)) / 100n);
}
export function atomicAmount(value: string, decimals: number): string {
  if (
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 36 ||
    !/^\d+(?:\.\d+)?$/.test(value) ||
    value.length > 100
  )
    throw Error("Enter a valid token amount");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals)
    throw Error(`Use at most ${decimals} decimal places`);
  const result =
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0") || "0");
  if (result <= 0n) throw Error("Choose an amount greater than zero");
  return String(result);
}
export function decimalAmount(raw: string, decimals: number) {
  const n = BigInt(raw),
    scale = 10n ** BigInt(decimals);
  const fraction = (n % scale)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return String(n / scale) + (fraction ? "." + fraction : "");
}
