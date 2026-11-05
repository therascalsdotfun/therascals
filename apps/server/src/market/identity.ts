import type { TokenObservation } from "../../../../packages/shared/src/market.ts";
import type { TokenIdentity } from "../../../../packages/shared/src/token-security.ts";
const alias = (value: string) => {
  const key = value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
  return ["", "unknown", "unknowntoken", "token"].includes(key) ? null : key;
};
export function tokenQuality(t: TokenObservation): [number, number] {
  const dex = t.dex && !t.dex.stale ? t.dex : null;
  return [
    dex?.liquidity ?? t.liquidity.value ?? -1,
    dex?.marketCap ?? t.marketCap.value ?? -1,
  ];
}
export function resolveTokenIdentities(
  tokens: TokenObservation[],
): Map<string, TokenIdentity> {
  const unique = [...new Map(tokens.map((t) => [t.mint, t])).values()];
  const parents = new Map(unique.map((t) => [t.mint, t.mint])),
    labels = new Map<string, string>();
  const root = (mint: string): string => {
    let r = mint;
    while (parents.get(r) !== r) r = parents.get(r)!;
    let at = mint;
    while (parents.get(at) !== r) {
      const next = parents.get(at)!;
      parents.set(at, r);
      at = next;
    }
    return r;
  };
  for (const token of unique)
    for (const label of [alias(token.name), alias(token.symbol)]) {
      if (!label) continue;
      const prior = labels.get(label);
      if (prior) parents.set(root(token.mint), root(prior));
      else labels.set(label, token.mint);
    }
  const groups = new Map<string, TokenObservation[]>();
  for (const t of unique) {
    const id = root(t.mint);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id)!.push(t);
  }
  const result = new Map<string, TokenIdentity>();
  for (const group of groups.values()) {
    group.sort((a, b) => {
      const x = tokenQuality(a),
        y = tokenQuality(b);
      return y[0] - x[0] || y[1] - x[1] || a.mint.localeCompare(b.mint);
    });
    for (const t of group)
      result.set(t.mint, { winnerMint: group[0].mint, count: group.length });
  }
  return result;
}
