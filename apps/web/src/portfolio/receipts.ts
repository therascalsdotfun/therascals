export function savedPortfolioSignatures(wallet: string): string[] {
  try {
    const rows = JSON.parse(
      localStorage.getItem("jackpot-mainnet-receipts") ?? "[]",
    );
    if (!Array.isArray(rows)) return [];
    return [
      ...new Set<string>(
        rows
          .filter(
            (r) =>
              r.wallet === wallet &&
              /^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(r.signature ?? ""),
          )
          .map((r) => r.signature),
      ),
    ].slice(0, 20);
  } catch {
    return [];
  }
}
export function recordPortfolioReceipt(
  wallet: string,
  signature: string,
  provider = "Jupiter · sell",
) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(signature)) return;
  try {
    const rows = JSON.parse(
      localStorage.getItem("jackpot-mainnet-receipts") ?? "[]",
    );
    localStorage.setItem(
      "jackpot-mainnet-receipts",
      JSON.stringify(
        [
          {
            wallet,
            signature,
            at: new Date().toISOString(),
            provider,
          },
          ...(Array.isArray(rows) ? rows : []).filter(
            (r) => r.signature !== signature,
          ),
        ].slice(0, 50),
      ),
    );
  } catch {
    /* Chain confirmation does not depend on browser storage. */
  }
  window.dispatchEvent(new Event("rascals-portfolio-trades"));
}
