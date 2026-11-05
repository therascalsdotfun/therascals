type SummaryPosition = { exitQuoteAtomic?: string | null };
type SummaryReceipt = {
  success?: boolean;
  buy?: boolean;
  output?: string;
  costBasisAtomic?: string | null;
};
export function portfolioSummary(
  cashAtomic: string | null | undefined,
  positions: SummaryPosition[],
  receipts: SummaryReceipt[],
) {
  const cash = cashAtomic == null ? null : Number(cashAtomic) / 1e6;
  const values = positions.map((p) =>
    p.exitQuoteAtomic == null ? null : Number(p.exitQuoteAtomic) / 1e6,
  );
  const complete = values.every((v) => v !== null && Number.isFinite(v));
  const sells = receipts.filter((f) => f.success && f.buy === false);
  const pnl = sells.map((f) =>
    f.output != null && f.costBasisAtomic != null
      ? (Number(f.output) - Number(f.costBasisAtomic)) / 1e6
      : null,
  );
  return {
    realizedPnl:
      sells.length && pnl.every((v) => v !== null && Number.isFinite(v))
        ? pnl.reduce<number>((n, v) => n + (v ?? 0), 0)
        : null,
    estimatedValue:
      cash !== null && Number.isFinite(cash) && complete
        ? cash + values.reduce<number>((n, v) => n + (v ?? 0), 0)
        : null,
    successfulBuys: receipts.filter((f) => f.success && f.buy).length,
    successfulSells: sells.length,
  };
}
