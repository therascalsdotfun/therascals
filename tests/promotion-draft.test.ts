import { expect, it } from "vitest";
import bs58 from "bs58";
import {
  readPromotionDrafts,
  savePromotionDraft,
  serializePromotionDrafts,
  validPromotionMint,
} from "../packages/shared/src/promotion-draft.ts";
const mint = (n: number) => bs58.encode(new Uint8Array(32).fill(n));
const draft = (n: number): any => ({
  mint: mint(n),
  name: "Source token",
  symbol: "SOURCE",
  icon: null,
  message: "A creator's preview",
  placement: "market",
  durationHours: 24,
  updatedAt: "2026-10-26T14:00:00.000Z",
});

it("accepts only exact Solana addresses, never a ticker or URL", () => {
  expect(validPromotionMint(mint(1))).toBe(true);
  for (const value of [
    "SOL",
    "https://dexscreener.com/solana/" + mint(1),
    "invalid",
    " " + mint(1),
  ])
    expect(validPromotionMint(value)).toBe(false);
});
it("restores bounded public draft data without importing a live/payment state", () => {
  const value = {
    ...draft(1),
    icon: "https://localhost/private",
    published: true,
    paid: true,
    message: "x".repeat(200),
  };
  const restored: any = readPromotionDrafts(
    JSON.stringify({
      version: 1,
      drafts: [value, { ...draft(2), mint: "BAD" }],
    }),
  );
  expect(restored).toHaveLength(1);
  expect(restored[0].icon).toBeNull();
  expect(restored[0].message).toHaveLength(96);
  expect(restored[0].paid).toBeUndefined();
  expect(restored[0].published).toBeUndefined();
  expect(() => readPromotionDrafts('{"version":2,"drafts":[]}')).toThrow(
    "unsupported",
  );
});
it("keeps one preview per mint and at most ten, with a round trip across reload", () => {
  let drafts: any[] = [];
  for (let n = 1; n <= 12; n++) drafts = savePromotionDraft(drafts, draft(n));
  expect(drafts).toHaveLength(10);
  drafts = savePromotionDraft(drafts, {
    ...draft(12),
    message: "Updated copy",
  });
  expect(drafts).toHaveLength(10);
  expect(drafts[0].message).toBe("Updated copy");
  expect(new Set(drafts.map((d) => d.mint)).size).toBe(10);
  expect(readPromotionDrafts(serializePromotionDrafts(drafts))).toEqual(drafts);
});
