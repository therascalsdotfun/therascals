import { z } from "zod";
import bs58 from "bs58";
import type { FilterSpec } from "./market.ts";

function validTokenMint(value: string) {
  try {
    const bytes = bs58.decode(value);
    return bytes.length === 32 && bs58.encode(bytes) === value;
  } catch {
    return false;
  }
}
const bound = z.number().finite().nonnegative().max(1e12),
  optional = bound.nullable();
export const filterPatchSchema = z
  .object({
    chains: z
      .array(z.enum(["solana", "base", "bsc", "near"]))
      .min(1)
      .max(4)
      .refine((x) => new Set(x).size === x.length),
    tokenSelection: z
      .object({
        included: z.array(z.string().max(100)).max(32),
        excluded: z.array(z.string().max(100)).max(256),
        manualOnly: z.boolean(),
      })
      .strict()
      .refine((x) =>
        [...x.included, ...x.excluded].every((id) =>
          /^(base|bsc):/.test(id)
            ? /^(base|bsc):0x[0-9a-f]{40}$/.test(id)
            : id.startsWith("near:")
              ? /^near:[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(id) &&
                id.length <= 69
              : validTokenMint(id),
        ),
      )
      .refine((x) => !x.included.some((id) => x.excluded.includes(id))),
    poolSize: z.number().int().min(2).max(32),
    memeTypes: z
      .array(
        z.enum([
          "politics",
          "crypto-twitter",
          "famous",
          "celebrity",
          "tech",
          "stocks",
          "animals",
          "other",
        ]),
      )
      .max(8),
    ageBasis: z.enum(["mint", "first_pool"]),
    minAgeMinutes: bound.max(1440),
    maxAgeMinutes: bound.max(1440),
    minMarketCap: bound.lt(100000000).nullable(),
    maxMarketCap: bound.lt(100000000).nullable(),
    minLiquidity: optional,
    minVolume5m: optional,
    minBuys5m: bound,
    minSells5m: bound,
    minHolders: bound,
    maxLiquidity: optional,
    maxVolume5m: optional,
    maxBuys5m: optional,
    maxSells5m: optional,
    maxHolders: optional,
    minBuyShare5m: bound.max(100).nullable(),
    maxBuyShare5m: bound.max(100).nullable(),
    hasTelegram: z.boolean(),
    hasX: z.boolean(),
    hasWebsite: z.boolean(),
  })
  .partial()
  .strict();

/** Check the completed filter config, including inherited preset floors. */
export function validFilterRanges(f: FilterSpec) {
  return (
    [
      ["minAgeMinutes", "maxAgeMinutes"],
      ["minMarketCap", "maxMarketCap"],
      ["minLiquidity", "maxLiquidity"],
      ["minVolume5m", "maxVolume5m"],
      ["minBuys5m", "maxBuys5m"],
      ["minSells5m", "maxSells5m"],
      ["minHolders", "maxHolders"],
      ["minBuyShare5m", "maxBuyShare5m"],
    ] as const
  ).every(
    ([low, high]) => f[low] == null || f[high] == null || f[low]! <= f[high]!,
  );
}
