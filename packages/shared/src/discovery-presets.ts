import type { FilterSpec } from "./market.ts";
import type { MemeType } from "./meme-types.ts";
export const DISCOVERY_PRESETS = [
  {
    id: "broad",
    label: "More coins",
    detail: "Lower thresholds · more early launches",
  },
  {
    id: "strict",
    label: "Balanced",
    detail: "A middle ground for fresh, liquid tokens",
  },
  {
    id: "tight",
    label: "Fewer coins",
    detail: "Higher cap, liquidity and activity floors",
  },
] as const;
export type DiscoveryPreset = (typeof DISCOVERY_PRESETS)[number]["id"];
export function discoveryPreset(
  id: DiscoveryPreset,
  memeTypes: MemeType[] = [],
): FilterSpec {
  const base: FilterSpec = {
    poolSize: 8,
    ageBasis: "first_pool",
    minAgeMinutes: 0,
    maxAgeMinutes: 1440,
    minMarketCap: 5000,
    maxMarketCap: 5000000,
    minLiquidity: 2000,
    minVolume5m: 250,
    minBuys5m: 0,
    minSells5m: 0,
    minHolders: 0,
    hasX: false,
    hasWebsite: false,
    memeTypes,
  };
  return id === "broad"
    ? {
        ...base,
        minAgeMinutes: 0,
        maxAgeMinutes: 10080,
        minMarketCap: 2000,
        minLiquidity: 1000,
        minVolume5m: 100,
      }
    : id === "tight"
      ? {
          ...base,
          minAgeMinutes: 15,
          maxAgeMinutes: 1440,
          minMarketCap: 25000,
          minLiquidity: 10000,
          minVolume5m: 1000,
        }
      : base;
}
export function presetFor(filters: FilterSpec): DiscoveryPreset | "custom" {
  if (
    filters.hasTelegram ||
    (
      [
        "maxLiquidity",
        "maxVolume5m",
        "maxBuys5m",
        "maxSells5m",
        "maxHolders",
        "minBuyShare5m",
        "maxBuyShare5m",
      ] as const
    ).some((key) => filters[key] != null)
  )
    return "custom";
  return (
    DISCOVERY_PRESETS.find((p) => {
      const candidate = discoveryPreset(p.id);
      return Object.keys(candidate)
        .filter(
          (k) =>
            ![
              "memeTypes",
              "poolSize",
              "minPoolSize",
              "maxPoolSize",
              "chains",
              "tokenSelection",
            ].includes(k),
        )
        .every(
          (k) =>
            filters[k as keyof FilterSpec] === candidate[k as keyof FilterSpec],
        );
    })?.id ?? "custom"
  );
}
