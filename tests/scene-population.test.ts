import { expect, it } from "vitest";
import { scenePopulation } from "../apps/web/src/lottery/scene-population.ts";
import { tokenKey } from "../packages/shared/src/token-selection.ts";
const token = (mint: string, chain = "solana") =>
  ({ mint, chain, marketCap: { value: 100000 } }) as any;
it("keeps physical membership/order stable when discovery only changes ranking", () => {
  const source = [token("z"), token("a"), token("m")];
  expect(scenePopulation(source).map(tokenKey)).toEqual(
    scenePopulation([...source].reverse()).map(tokenKey),
  );
  expect(source.map((t) => t.mint)).toEqual(["z", "a", "m"]);
});
it("distinguishes exact assets on different chains and removes no eligible member", () => {
  const source = [token("same", "base"), token("same", "bsc"), token("same")];
  expect(new Set(scenePopulation(source).map(tokenKey)).size).toBe(3);
});
