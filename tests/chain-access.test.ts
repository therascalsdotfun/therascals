import { expect, it } from "vitest";
import {
  accessibleToken,
  chainAccess,
  exactIntentsAsset,
} from "../packages/shared/src/chain-access.ts";
const token = { chain: "base" as const, mint: "0x" + "A".repeat(40) };
const catalog: any = {
  assets: [
    {
      blockchain: "base",
      contractAddress: token.mint.toLowerCase(),
      assetId: "base-coin",
    },
    { blockchain: "sol", contractAddress: "ABC", assetId: "sol-coin" },
  ],
};
it("limits chains to connected wallet capabilities or NEAR's exact Intents assets", () => {
  expect(chainAccess("solana", {}).kind).toBe("unavailable");
  expect(chainAccess("solana", { phantom: { address: "sol" } }).kind).toBe(
    "wallet",
  );
  for (const chain of ["base", "bsc"] as const)
    expect(chainAccess(chain, { metamask: { address: "0x1" } }).kind).toBe(
      "wallet",
    );
  expect(
    chainAccess("base", { near: { address: "user.near" } }, catalog).kind,
  ).toBe("intents");
  expect(
    accessibleToken(token, { near: { address: "user.near" } }, catalog),
  ).toBe(true);
  expect(
    accessibleToken(
      { ...token, mint: "0x" + "B".repeat(40) },
      { near: { address: "user.near" } },
      catalog,
    ),
  ).toBe(false);
  expect(
    exactIntentsAsset(catalog, { ...token, chain: "bsc" }),
  ).toBeUndefined();
  expect(
    exactIntentsAsset(catalog, { chain: "solana", mint: "abc" }),
  ).toBeUndefined();
  expect(accessibleToken(token, {}, catalog)).toBe(false);
});

it("drops an inaccessible saved Solana selection when an EVM user enables Base, then allows mixing Base and BNB", async () => {
  const { chooseAccessibleChain } =
    await import("../packages/shared/src/chain-access.ts");
  const accounts = { metamask: { address: "0x1" } };
  const base = chooseAccessibleChain(
    { chains: ["solana"] } as any,
    "base",
    true,
    accounts,
  );
  expect(base.chains).toEqual(["base"]);
  expect(chooseAccessibleChain(base, "bsc", true, accounts).chains).toEqual([
    "base",
    "bsc",
  ]);
  expect(() => chooseAccessibleChain(base, "near", true, accounts)).toThrow(
    "compatible wallet",
  );
});
