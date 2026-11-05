import { expect, it } from "vitest";
import { resolveTokenIdentities } from "../apps/server/src/market/identity.ts";
const t = (
  mint: string,
  name: string,
  symbol: string,
  liquidity: number,
  marketCap: number,
) =>
  ({
    mint,
    name,
    symbol,
    liquidity: { value: liquidity },
    marketCap: { value: marketCap },
  }) as any;
it("collapses name/ticker collisions transitively using liquidity then cap and never boosts", () => {
  const tokens = [
    t("A", "Anh Yêu Em", "ILY", 10, 100),
    t("B", "Anh Yeu Em", "OTHER", 20, 200),
    t("C", "Another", "other", 20, 300),
    t("D", "Distinct", "D", 1, 1),
  ];
  const r = resolveTokenIdentities(tokens);
  expect(r.get("A")?.winnerMint).toBe("C");
  expect(r.get("B")?.winnerMint).toBe("C");
  expect(r.get("C")?.winnerMint).toBe("C");
  expect(r.get("D")?.count).toBe(1);
  expect(r.get("A")?.count).toBe(3);
  tokens[0].dex = {
    liquidity: 10,
    marketCap: 100,
    promoted: true,
    activeBoosts: 999,
    stale: false,
  };
  expect(resolveTokenIdentities(tokens).get("A")?.winnerMint).toBe("C");
  expect(
    resolveTokenIdentities([...tokens].reverse()).get("A")?.winnerMint,
  ).toBe("C");
});
it("does not merge empty/unknown names and resolves exact mint duplicates", () => {
  const tokens = [
    t("A", "Unknown token", "?", 1, 1),
    t("B", "Unknown token", "?", 1, 1),
    t("A", "Unknown token", "?", 1, 1),
  ];
  const r = resolveTokenIdentities(tokens);
  expect(r.size).toBe(2);
  expect(r.get("A")?.count).toBe(1);
  expect(r.get("B")?.count).toBe(1);
});
