import { expect, it } from "vitest";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import {
  decodeFilterCode,
  encodeFilterCode,
  FILTER_CODE_LIMIT,
} from "../packages/shared/src/filter-code.ts";
import { discoveryPreset } from "../packages/shared/src/discovery-presets.ts";
import {
  evaluateFilters,
  normalizeJupiter,
} from "../apps/server/src/market/model.ts";
import { createApp } from "../apps/server/src/http/app.ts";

const base = () => ({
  ...discoveryPreset("broad"),
  chains: ["solana"] as const,
});
const custom = () => ({
  ...discoveryPreset("broad"),
  chains: ["solana", "base"] as ("solana" | "base")[],
  maxLiquidity: 120000,
  maxVolume5m: 40000,
  maxHolders: 4000,
  minBuyShare5m: 30,
  maxBuyShare5m: 90,
  hasTelegram: true,
  tokenSelection: {
    included: [
      "So11111111111111111111111111111111111111112",
      "base:0x1111111111111111111111111111111111111111",
    ],
    excluded: [],
    manualOnly: false,
  },
});
function forge(code: string, edit: (a: unknown[]) => void) {
  const a = JSON.parse(
    Buffer.from(code.split(".")[1], "base64url").toString("utf8"),
  );
  edit(a);
  const payload = JSON.stringify(a);
  return `DEGEN1.${Buffer.from(payload).toString("base64url")}.${bytesToHex(sha256(utf8ToBytes("rascals-degen-code-v1|" + payload))).slice(0, 16)}`;
}

it("round trips all custom rules, exact chain/pick order and public choices without a registry", () => {
  const f = custom(),
    code = encodeFilterCode(f);
  expect(code).toMatch(/^DEGEN1\.[\w-]+\.[a-f0-9]{16}$/);
  expect(decodeFilterCode(code)).toMatchObject(f);
  expect(encodeFilterCode(decodeFilterCode(code))).toBe(code);
  expect(decodeFilterCode(` \n${code}\n `)).toEqual(decodeFilterCode(code));
});
it("normalizes optional legacy settings deterministically and shares no runtime authority", () => {
  const f = discoveryPreset("strict"),
    code = encodeFilterCode(f);
  const loaded = decodeFilterCode(code);
  expect(loaded.maxLiquidity).toBeNull();
  expect(loaded.chains).toEqual(["solana"]);
  const noisy = {
    ...f,
    ticketAtomic: "99999999",
    wallet: "PRIVATE-WALLET",
    apiKey: "SECRET",
    creator: "FAKE-AUTHOR",
  };
  expect(encodeFilterCode(noisy)).toBe(code);
  const decodedText = Buffer.from(code.split(".")[1], "base64url").toString(
    "utf8",
  );
  expect(decodedText).not.toMatch(/PRIVATE|SECRET|FAKE|ticketAtomic/);
  expect(
    encodeFilterCode({ ...f, maxLiquidity: null, hasTelegram: false }),
  ).toBe(code);
});
it("rejects truncated, modified, wrong-version, oversized and hash-only input", () => {
  const code = encodeFilterCode(discoveryPreset("broad"));
  for (const invalid of [
    code.slice(0, -1),
    code.replace("DEGEN1.", "DEGEN2."),
    code.replace(/.$/, code.endsWith("0") ? "1" : "0"),
    "a".repeat(64),
    "x".repeat(FILTER_CODE_LIMIT + 1),
  ])
    expect(() => decodeFilterCode(invalid)).toThrow();
});
it("validates payloads even if their checksum was recomputed by an untrusted sender", () => {
  const code = encodeFilterCode(discoveryPreset("broad"));
  for (const edit of [
    (a: unknown[]) => {
      a[0] = ["solana", "solana"];
    },
    (a: unknown[]) => {
      a[4] = 200;
      a[5] = 100;
    },
    (a: unknown[]) => {
      a[20] = 101;
    },
    (a: unknown[]) => {
      a[23] = {
        included: ["javascript:alert(1)"],
        excluded: [],
        manualOnly: true,
      };
    },
    (a: unknown[]) => {
      a.push("unknown extension");
    },
  ])
    expect(() => decodeFilterCode(forge(code, edit))).toThrow(
      /damaged|invalid/,
    );
});
it("does not encode invalid local ranges", () => {
  expect(() =>
    encodeFilterCode({
      ...discoveryPreset("broad"),
      minBuyShare5m: 80,
      maxBuyShare5m: 20,
    }),
  ).toThrow(/Check/);
});
it("keeps token eligibility the same before and after sharing and cannot loosen safety", () => {
  const now = Date.now(),
    f = custom();
  const token = normalizeJupiter(
    {
      id: "So11111111111111111111111111111111111111112",
      decimals: 6,
      mcap: 30000,
      liquidity: 20000,
      holderCount: 200,
      stats5m: { buyVolume: 1000, sellVolume: 500, numBuys: 10, numSells: 5 },
      firstPool: { createdAt: new Date(now - 600000).toISOString() },
      telegram: "https://t.me/example",
    },
    now,
  )!;
  expect(
    evaluateFilters(token, decodeFilterCode(encodeFilterCode(f)), now),
  ).toEqual(evaluateFilters(token, f, now));
  const staleUniverse = {
    ...token,
    firstPoolCreatedAt: new Date(now - 172800000).toISOString(),
  };
  expect(
    evaluateFilters(staleUniverse, decodeFilterCode(encodeFilterCode(f)), now)
      .matches,
  ).toBe(false);
});
it("uses the same validation as the server and lets independent users apply a shared version", async () => {
  const calls: any[] = [];
  const app = await createApp({
    configure: (x: unknown) => calls.push(x),
  } as any);
  try {
    const loaded = decodeFilterCode(encodeFilterCode(custom()));
    const response = await app.inject({
      method: "POST",
      url: "/api/discovery",
      payload: { ticket: "5", preset: "broad", filters: loaded },
    });
    expect(response.statusCode).toBe(200);
    expect(calls[0].filters).toEqual(loaded);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/discovery",
          payload: { ticket: "5", filters: { ...loaded, spendApproval: true } },
        })
      ).statusCode,
    ).toBe(400);
  } finally {
    await app.close();
  }
});
