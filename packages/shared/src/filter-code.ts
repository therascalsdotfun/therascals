import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { discoveryPreset } from "./discovery-presets.ts";
import { filterPatchSchema, validFilterRanges } from "./filter-schema.ts";
import type { FilterSpec } from "./market.ts";

/** Positional wire layout is immutable for DEGEN1. New formats need a new version. */
const keys = [
  "chains",
  "poolSize",
  "memeTypes",
  "ageBasis",
  "minAgeMinutes",
  "maxAgeMinutes",
  "minMarketCap",
  "maxMarketCap",
  "minLiquidity",
  "minVolume5m",
  "minBuys5m",
  "minSells5m",
  "minHolders",
  "hasX",
  "hasWebsite",
  "maxLiquidity",
  "maxVolume5m",
  "maxBuys5m",
  "maxSells5m",
  "maxHolders",
  "minBuyShare5m",
  "maxBuyShare5m",
  "hasTelegram",
  "tokenSelection",
] as const satisfies readonly (keyof FilterSpec)[];
export const FILTER_CODE_LIMIT = 65536;
const optionalNumbers = [
  "maxAgeMinutes",
  "maxLiquidity",
  "maxVolume5m",
  "maxBuys5m",
  "maxSells5m",
  "maxHolders",
  "minBuyShare5m",
  "maxBuyShare5m",
] as const;

function normalize(value: unknown): FilterSpec {
  const parsed = filterPatchSchema.parse(value);
  const defined = Object.fromEntries(
    Object.entries(parsed).filter(([, v]) => v !== undefined),
  );
  const f: FilterSpec = {
    ...discoveryPreset("strict"),
    ...defined,
    chains: parsed.chains ?? ["solana"],
    memeTypes: [...new Set(parsed.memeTypes ?? [])].sort(),
    hasTelegram: parsed.hasTelegram ?? false,
    tokenSelection: {
      included: [...new Set(parsed.tokenSelection?.included ?? [])],
      excluded: [...new Set(parsed.tokenSelection?.excluded ?? [])].sort(),
      manualOnly: parsed.tokenSelection?.manualOnly ?? false,
    },
  };
  for (const key of optionalNumbers) f[key] = parsed[key] ?? null;
  if (!validFilterRanges(f)) throw Error("Invalid filter ranges");
  return f;
}
function payloadFor(f: FilterSpec) {
  return JSON.stringify(keys.map((key) => f[key]));
}
function digest(payload: string) {
  return bytesToHex(sha256(utf8ToBytes("rascals-degen-code-v1|" + payload)));
}

/** Includes filter rules/public token picks only, never amount, identity or wallet authority. */
export function encodeFilterCode(value: FilterSpec): string {
  try {
    // Explicit allowlist: unrelated runtime fields never enter the shared code.
    const picked = Object.fromEntries(
      keys.filter((k) => value[k] !== undefined).map((k) => [k, value[k]]),
    );
    const payload = payloadFor(normalize(picked));
    const encoded = btoa(
      Array.from(utf8ToBytes(payload), (byte) =>
        String.fromCharCode(byte),
      ).join(""),
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const code = `DEGEN1.${encoded}.${digest(payload).slice(0, 16)}`;
    if (code.length > FILTER_CODE_LIMIT) throw Error("Too long");
    return code;
  } catch {
    throw Error("Check your filter values before copying a code.");
  }
}
export function decodeFilterCode(input: string): FilterSpec {
  const code = input.trim();
  if (code.length > FILTER_CODE_LIMIT)
    throw Error("This code is too long. Ask for a fresh Degen Code.");
  const parts = /^DEGEN1\.([A-Za-z0-9_-]+)\.([a-f0-9]{16})$/.exec(code);
  if (!parts) throw Error("Paste the full Degen Code, starting with DEGEN1.");
  try {
    const binary = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    const payload = new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(binary, (c) => c.charCodeAt(0)),
    );
    if (digest(payload).slice(0, 16) !== parts[2])
      throw Error("Checksum mismatch");
    const wire: unknown = JSON.parse(payload);
    if (!Array.isArray(wire) || wire.length !== keys.length)
      throw Error("Wrong format");
    return normalize(
      Object.fromEntries(keys.map((key, index) => [key, wire[index]])),
    );
  } catch {
    throw Error(
      "This Degen Code is damaged or has invalid settings. Ask for a fresh copy.",
    );
  }
}
