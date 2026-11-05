/** Display only. Never use a ticker or icon to identify a trading asset. */
export function tokenTicker(symbol: string | null | undefined): string {
  const clean = (symbol ?? "").trim().replace(/^\$+/, "");
  return "$" + (clean || "TOKEN");
}
// The venue prefixes unit-scaled contracts (kPEPE), but artwork uses PEPE.
export function tokenIconSymbol(symbol: string): string {
  const clean = symbol.trim().replace(/^\$+/, "");
  return /^k(?:PEPE|BONK|SHIB|FLOKI)$/i.test(clean)
    ? clean.slice(1).toUpperCase()
    : clean.toUpperCase();
}
