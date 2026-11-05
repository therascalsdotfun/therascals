import { expect, it } from "vitest";
import { admissionReasons } from "../apps/server/src/market/model.ts";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ChainPicker,
  TokenPoolEditor,
} from "../apps/web/src/TokenPoolEditor.tsx";
import {
  chainName,
  tokenKey,
  tokenExplorer,
} from "../packages/shared/src/token-selection.ts";
import {
  parseBasePairs,
  validPreviewAddress,
  BaseDiscovery,
} from "../apps/server/src/market/base.ts";
it("renders four accessible icon toggles, selected state and last-chain guard", () => {
  const h = renderToStaticMarkup(
    <ChainPicker
      filters={{ chains: ["near"] } as any}
      disabled={false}
      onChange={() => {}}
    />,
  );
  expect(h.match(/type="checkbox"/g)).toHaveLength(4);
  for (const label of ["Solana", "Base", "BNB", "NEAR"])
    expect(h).toContain(`aria-label="${label}`);
  expect(h).toMatch(
    /aria-label="NEAR · preview only"[^>]*disabled=""[^>]*checked=""/,
  );
  expect(h).not.toContain("<small>Preview</small>");
});
it("keeps wallet-approved chain labels consistent inside the mainnet pool editor", () => {
  const h = renderToStaticMarkup(
    <TokenPoolEditor
      mainnet
      data={
        {
          configurationHash: "test",
          filters: { chains: ["base"] },
          pool: [],
          rows: [],
          eligible: 0,
        } as any
      }
      accounts={{ metamask: { address: "0x" + "1".repeat(40) } }}
      disabled={false}
      onChange={async () => {}}
    />,
  );
  expect(h).toContain('aria-label="Base · wallet-approved buys"');
  expect(h).toContain('aria-label="BNB · wallet-approved buys"');
  expect(h).not.toContain('aria-label="Base · preview only"');
});
it("normalizes exact BNB and NEAR identities and rejects invalid contracts", () => {
  const now = Date.now();
  for (const chain of ["bsc", "near"] as const) {
    const mint = chain === "bsc" ? "0x" + "1".repeat(40) : "coin.meme.near";
    const t = parseBasePairs(
      [
        {
          chainId: chain,
          baseToken: { address: mint, name: "Coin", symbol: "COIN" },
          pairAddress: "pool",
          pairCreatedAt: now - 60000,
          marketCap: 10000,
          liquidity: { usd: 1000 },
        },
      ],
      now,
      chain,
    )[0];
    expect(t.chain).toBe(chain);
    expect(tokenKey(t)).toBe(chain + ":" + mint);
    expect(tokenExplorer(t)).toContain(
      chain === "bsc" ? "bscscan.com" : "nearblocks.io",
    );
    expect(chainName(chain)).toBe(chain === "bsc" ? "BNB" : "NEAR");
  }
  expect(validPreviewAddress("near", "https://example.com")).toBe(false);
  expect(validPreviewAddress("bsc", "coin.near")).toBe(false);
});
it("NEAR imports use real pair data and remain excluded without a risk provider", async () => {
  const fetcher: any = async () =>
    Response.json([
      {
        chainId: "near",
        baseToken: { address: "coin.near", name: "Coin", symbol: "COIN" },
        pairAddress: "pool",
        pairCreatedAt: Date.now() - 60000,
        marketCap: 10000,
        liquidity: { usd: 1000 },
      },
    ]);
  const adapter = new BaseDiscovery(fetcher, () => Date.now(), "near");
  const t = await adapter.import("coin.near");
  expect(t.security?.status).toBe("unavailable");
  expect(t.security?.source).toBe("Not configured");
  expect(t.security?.chain).toBe("near");
  expect(
    admissionReasons(
      { ...t, security: { ...t.security!, status: "checked", risks: [] } },
      Date.now(),
    ),
  ).toContain("near_screening_not_configured");
});
it("BNB risk checks use GoPlus chain 56 and preserve the report chain", async () => {
  const mint = "0x" + "4".repeat(40),
    urls: string[] = [];
  const fetcher: any = async (url: string) => {
    urls.push(url);
    return Response.json(
      url.includes("goplus")
        ? {
            code: 1,
            result: {
              [mint]: {
                is_honeypot: "0",
                is_open_source: "1",
                cannot_sell_all: "0",
                buy_tax: "0",
                sell_tax: "0",
              },
            },
          }
        : [
            {
              chainId: "bsc",
              baseToken: { address: mint, symbol: "BNBQA", name: "BNB QA" },
              pairAddress: "pool",
              pairCreatedAt: Date.now() - 60000,
              marketCap: 10000,
              liquidity: { usd: 1000 },
            },
          ],
    );
  };
  const adapter = new BaseDiscovery(fetcher, () => Date.now(), "bsc");
  const t = await adapter.import(mint);
  expect(t.security?.status).toBe("checked");
  expect(t.security?.chain).toBe("bsc");
  expect(urls[1]).toContain("token_security/56?");
  expect(urls[0]).toContain("/token-pairs/v1/bsc/");
});

it("shows which selected chains can actually win, with zero-chain reasons", async () => {
  const { ChainPoolStatus } =
    await import("../apps/web/src/TokenPoolEditor.tsx");
  const h = renderToStaticMarkup(
    <ChainPoolStatus
      data={
        {
          filters: { chains: ["solana", "base", "bsc", "near"] },
          pool: [{ mint: "sol" }, { mint: "sol2" }],
          coverage: {
            chainSources: {
              solana: {
                observed: 10,
                matching: 5,
                eligible: 2,
                inDraw: 2,
                blockers: {},
                previewOnly: false,
              },
              base: {
                observed: 8,
                matching: 3,
                eligible: 0,
                inDraw: 0,
                blockers: { security_unavailable: 3 },
                previewOnly: true,
              },
              bsc: {
                observed: 5,
                matching: 0,
                eligible: 0,
                inDraw: 0,
                blockers: {},
                previewOnly: true,
              },
              near: {
                observed: 1,
                matching: 0,
                eligible: 0,
                inDraw: 0,
                blockers: {},
                previewOnly: true,
              },
            },
          },
        } as any
      }
    />,
  );
  expect(h).toContain("This draw: Solana only");
  expect(h).toContain("Base: 0");
  expect(h).toContain("3 awaiting a complete risk report");
  expect(h).toContain("No tokens match your filters");
  expect(h).toContain("NEAR risk screening is not connected");
});

it("lights selected connected-wallet chains and disables unrelated choices", () => {
  const h = renderToStaticMarkup(
    <ChainPicker
      filters={{ chains: ["base", "bsc"] } as any}
      accounts={{ metamask: { address: "0x1" } }}
      disabled={false}
      onChange={() => {}}
    />,
  );
  expect(h).toMatch(/aria-label="Base · preview only"[^>]*checked=""/);
  expect(h).toMatch(/aria-label="BNB · preview only"[^>]*checked=""/);
  expect(h).toMatch(/aria-label="Solana"[^>]*disabled=""/);
  expect(h).toMatch(/aria-label="NEAR · preview only"[^>]*disabled=""/);
  expect(h).toContain("Connected EVM wallet");
});
