import bs58 from "bs58";
import { tokenImageUrl } from "./token-media.ts";

export const PROMOTION_STORAGE_KEY = "jackpot.promotion-previews.v1";
export const PROMOTION_DURATIONS = [24, 72, 168] as const;
export type PromotionPlacement = "market" | "detail";
export type PromotionDraft = {
  mint: string;
  name: string;
  symbol: string;
  icon: string | null;
  message: string;
  placement: PromotionPlacement;
  durationHours: number;
  updatedAt: string;
};

export function validPromotionMint(mint: string): boolean {
  if (mint.length < 32 || mint.length > 44) return false;
  try {
    const bytes = bs58.decode(mint);
    return bytes.length === 32 && bs58.encode(bytes) === mint;
  } catch {
    return false;
  }
}

export function readPromotionDrafts(value: string | null): PromotionDraft[] {
  if (!value) return [];
  if (value.length > 64_000)
    throw Error("Saved previews are too large to load.");
  const data = JSON.parse(value);
  if (data?.version !== 1 || !Array.isArray(data.drafts))
    throw Error("Saved previews use an unsupported format.");
  const drafts = new Map<string, PromotionDraft>();
  for (const item of data.drafts.slice(0, 10)) {
    if (
      !item ||
      typeof item.mint !== "string" ||
      !validPromotionMint(item.mint) ||
      typeof item.name !== "string" ||
      typeof item.symbol !== "string" ||
      typeof item.message !== "string" ||
      !["market", "detail"].includes(item.placement) ||
      !PROMOTION_DURATIONS.includes(item.durationHours) ||
      typeof item.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(item.updatedAt))
    )
      continue;
    drafts.set(item.mint, {
      mint: item.mint,
      name: item.name.slice(0, 100),
      symbol: item.symbol.slice(0, 24),
      icon: tokenImageUrl(item.icon),
      message: item.message.slice(0, 96),
      placement: item.placement,
      durationHours: item.durationHours,
      updatedAt: new Date(item.updatedAt).toISOString(),
    });
  }
  return [...drafts.values()];
}

export function savePromotionDraft(
  drafts: PromotionDraft[],
  next: PromotionDraft,
) {
  // Only browser-local planning data. This never grants a paid/live placement.
  const checked = readPromotionDrafts(
    JSON.stringify({ version: 1, drafts: [next] }),
  )[0];
  if (!checked)
    throw Error("Check the token and promotion details before saving.");
  return [checked, ...drafts.filter((d) => d.mint !== checked.mint)].slice(
    0,
    10,
  );
}

export function serializePromotionDrafts(drafts: PromotionDraft[]) {
  return JSON.stringify({ version: 1, drafts });
}
