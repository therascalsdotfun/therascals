import type { Candle, ChartRange } from "../../server/src/market/gecko.ts";
export type ChartEntry = {
  kind: "simulated" | "test-reference";
  price: number;
  time: number;
  amount: number;
  label: string;
  signature?: string;
};
export function testReferenceEntry(
  mint: string,
  operation: any,
  receipts: any[],
): ChartEntry | null {
  if (
    !operation ||
    operation.phase !== "finalized_success" ||
    operation.buy !== true ||
    operation.mode === "exit" ||
    operation.source?.mint !== mint ||
    !operation.solanaSignature
  )
    return null;
  const fill = receipts.find(
    (r) =>
      r.success === true &&
      r.buy === true &&
      r.signature === operation.solanaSignature &&
      r.session === operation.session &&
      r.drawId === operation.draw?.id &&
      r.source?.mint === mint,
  );
  const price = operation.source.price?.value,
    time = Date.parse(operation.source.price?.asOf ?? "") / 1000;
  if (
    !fill ||
    !Number.isFinite(price) ||
    price <= 0 ||
    !Number.isFinite(time) ||
    time <= 0 ||
    !/^\d+$/.test(fill.input) ||
    BigInt(fill.input) <= 0n ||
    BigInt(fill.input) > 100000000n
  )
    return null;
  return {
    kind: "test-reference",
    price,
    time,
    amount: Number(fill.input) / 1e6,
    label: "TEST FILL · SOURCE REF",
    signature: fill.signature,
  };
}
/** Explicitly synthetic visual data. Never used for quotes, selection or PnL. */
export function demoCandles(
  mint: string,
  anchor: number,
  now: number,
  range: ChartRange,
): Candle[] {
  const price = Number.isFinite(anchor) && anchor > 0 ? anchor : 1;
  const step = range === "1h" ? 3600 : range === "5m" ? 300 : 60;
  const end = Math.floor(now / step) * step;
  const seed =
    [...mint].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7) % 1000;
  const curve = (i: number) =>
    1 +
    0.025 * Math.sin(i * 0.27 + seed) +
    0.011 * Math.cos(i * 0.73 + seed / 7) +
    (i - 59) * 0.0007;
  const scale = curve(59);
  let previous = (price * curve(0)) / scale;
  return Array.from({ length: 60 }, (_, i) => {
    const close = (price * curve(i)) / scale,
      open = previous;
    previous = close;
    return {
      time: end - (59 - i) * step,
      open,
      close,
      high: Math.max(open, close) * 1.006,
      low: Math.min(open, close) * 0.994,
      volume: 200 + (Math.sin(i + seed) + 1) * 450,
    };
  });
}
