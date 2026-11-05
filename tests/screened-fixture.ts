// Unit-test providers: explicit known reference and risk evidence, no live HTTP.
export function screenedProviders(service: any, now: number) {
  const risk = (mint: string) => ({
    mint,
    source: "RugCheck",
    status: "checked",
    checkedAt: new Date(now).toISOString(),
    reportAt: new Date(now).toISOString(),
    risks: [],
    score: 0,
  });
  const pair = (mint: string) => ({
    mint,
    pool: mint,
    stale: false,
    fetchedAt: new Date(now).toISOString(),
    liquidity: 20000,
    marketCap: 100000,
  });
  service.dex = {
    peek: pair,
    tokens: async (mints: string[]) => mints.map(pair),
  };
  service.risk = { peek: risk, scan: async (mint: string) => risk(mint) };
}
