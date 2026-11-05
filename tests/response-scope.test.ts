import { expect, it } from "vitest";
import { responseMatchesWallet } from "../apps/web/src/wallets/response-scope.ts";
const a = { kind: "phantom" as const, address: "a", expiresAt: "2026-10-26" },
  b = { ...a, address: "b" };
it("discards the previous verified wallet response while logout or a new wallet connection is pending", () => {
  expect(responseMatchesWallet({ viewer: { identity: a } }, null)).toBe(false);
  expect(responseMatchesWallet({ viewer: { identity: a } }, b)).toBe(false);
  expect(responseMatchesWallet({ viewer: { identity: a } }, a)).toBe(true);
  expect(responseMatchesWallet({ viewer: { identity: null } }, null)).toBe(
    true,
  );
  expect(responseMatchesWallet({ viewer: { identity: null } }, a)).toBe(false);
  expect(responseMatchesWallet({}, null)).toBe(true);
});
