import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { JustHootPanel, daoAssetUrl } from "../apps/dao/src/ui/JustHootPanel.tsx";
import {
  SputnikDaoPanel,
  SputnikSummaryBanner,
} from "../apps/dao/src/ui/SputnikDaoPanel.tsx";
import {
  JustHootDrawControl,
  JustHootLeaderboardTable,
} from "../apps/web/src/JustHootDraw.tsx";
import { filterPatchSchema } from "../packages/shared/src/filter-schema.ts";
import {
  JUSTHOOT_DEFAULT_TOP3_KEYS,
  JUSTHOOT_LEADERBOARD_TOKENS,
  fetchLiveJustHootRooms,
  justHootPoolIds,
  justHootTokenObservations,
} from "../packages/shared/src/justhoot-tokens.ts";
import { evaluateFilters, admissionReasons } from "../apps/server/src/market/model.ts";
import { discoveryPreset } from "../packages/shared/src/discovery-presets.ts";
import { FilterSettings } from "../apps/web/src/FilterSettings.tsx";

const mockState: any = {
  config: { token_id: "LOCAL", members: [] },
  treasury: { reward_available: "1000", agent_available: "100" },
  proposals: [],
  jobs: [],
  actor: "alice.testnet",
  mode: "local-demo",
};

const mockClient: any = {
  mode: "local-demo",
  call: vi.fn(),
  local: vi.fn(),
};

describe("JustHoot DAO panel & bonding curve integration", () => {
  it("renders JustHoot panel with brand logo, trenches hero and DCL pool details", () => {
    const html = renderToStaticMarkup(
      <JustHootPanel
        state={mockState}
        client={mockClient}
        pending={null}
        act={vi.fn() as any}
      />,
    );

    expect(html).toContain("JustHoot Bonding-Curve Roll");
    expect(html).toContain("/brands/justhoot/logo.png");
    expect(html).toContain("HOOT");
    expect(html).toContain("IMEME");
    expect(html).toContain("THREE");
    expect(html).toContain("dclv2.ref-labs.near");
    expect(html).toContain("wrap.near ft_transfer_call");
    expect(html).toContain("https://justhoot.fun");
  });

  it("validates filterPatchSchema allows includeBondingCurve option and default top 3 keys", () => {
    const parsed = filterPatchSchema.parse({
      chains: ["near"],
      includeBondingCurve: true,
      hasX: false,
      hasWebsite: false,
      tokenSelection: {
        included: JUSTHOOT_DEFAULT_TOP3_KEYS,
        excluded: [],
        manualOnly: true,
      },
    });
    expect(parsed.includeBondingCurve).toBe(true);
    expect(parsed.tokenSelection?.included).toHaveLength(3);
  });

  it("renders JustHoot Draw tickbox defaulting to top 3 ($HOOT, $IMEME, $THREE) and leaderboard table", () => {
    const controlHtml = renderToStaticMarkup(
      <JustHootDrawControl
        filters={{
          ...discoveryPreset("broad"),
          chains: ["near"],
          includeBondingCurve: true,
          tokenSelection: {
            included: JUSTHOOT_DEFAULT_TOP3_KEYS,
            excluded: [],
            manualOnly: true,
          },
        }}
        onApplyFilters={() => {}}
      />,
    );
    expect(controlHtml).toContain("JustHoot Draw");
    expect(controlHtml).toContain("$HOOT");
    expect(controlHtml).toContain("$IMEME");
    expect(controlHtml).toContain("$THREE");
    expect(controlHtml).toContain("3 JustHoot tokens loaded in cage");

    const tableHtml = renderToStaticMarkup(
      <JustHootLeaderboardTable
        filters={{
          ...discoveryPreset("broad"),
          chains: ["near"],
          includeBondingCurve: true,
        }}
      />,
    );
    expect(tableHtml).toContain("JustHoot Token Leaderboard");
    expect(tableHtml).toContain("by justho...near");
    expect(tableHtml).toContain("The Intelligent Meme ...");
    expect(tableHtml).toContain("Three is NEAR.");
    expect(tableHtml).toContain("$1.2M");
    expect(tableHtml).toContain("$307K");
    expect(tableHtml).toContain("$55.2K");
    expect(JUSTHOOT_LEADERBOARD_TOKENS.length).toBeGreaterThanOrEqual(10);
  });

  it("admits JustHoot tokens into draw pool when includeBondingCurve is enabled", () => {
    const now = Date.now();
    const obs = justHootTokenObservations(now);
    const filters = {
      ...discoveryPreset("broad"),
      chains: ["near" as const],
      includeBondingCurve: true,
      tokenSelection: {
        included: JUSTHOOT_DEFAULT_TOP3_KEYS,
        excluded: [],
        manualOnly: true,
      },
    };
    const matched = obs.filter(
      (t) =>
        evaluateFilters(t, filters, now).matches &&
        admissionReasons(t, now).length === 0,
    );
    expect(matched.map((t) => t.symbol)).toEqual(["HOOT", "IMEME", "THREE"]);
  });

  it("renders Minimum coins in the cage and Maximum coins in the cage in FilterSettings", () => {
    const html = renderToStaticMarkup(
      <FilterSettings
        value={{
          ...discoveryPreset("broad"),
          minPoolSize: 3,
          maxPoolSize: 12,
        }}
        onChange={() => {}}
      />,
    );
    expect(html).toContain("Minimum coins in the cage");
    expect(html).toContain("Maximum coins in the cage");
    expect(html).not.toContain(">Coins in the cage<");
  });

  it("renders Sputnik DAO v2 summary banner and full Sputnik multisig panel with NEAR Testnet notice", () => {
    const stateWithSputnik: any = {
      ...mockState,
      contract_id: "v2.rascals-dao-1104.testnet",
      sputnik_dao_id: "therascals.sputnikv2.testnet",
      token_symbol: "TEST-USDC",
      sputnik: {
        contract_id: "therascals.sputnikv2.testnet",
        factory_id: "sputnikv2.testnet",
        version: "2.3.1",
        config: {
          name: "TheRascals Contributor DAO",
          purpose: "Sputnik DAO v2 council multisig on NEAR testnet",
          metadata: "",
        },
        policy: {
          roles: [
            {
              name: "council",
              kind: { Group: ["alice.testnet", "bob.testnet"] },
              permissions: ["*:AddProposal", "*:VoteApprove"],
              vote_policy: {},
            },
          ],
          default_vote_policy: {
            weight_kind: "RoleWeight",
            quorum: "0",
            threshold: [1, 2],
          },
          proposal_bond: "10000000000000000000000",
          proposal_period: "604800000000000",
          bounty_bond: "10000000000000000000000",
          bounty_forgiveness_period: "86400000000000",
        },
        token_balance: "4750000000",
        proposals: [
          {
            id: 0,
            proposer: "alice.testnet",
            description: "Sputnik DAO Treasury Grant #1",
            kind: {
              FunctionCall: {
                receiver_id: "rewards.rascals-council2-1104.testnet",
                actions: [
                  {
                    method_name: "ft_transfer_call",
                    args: btoa(
                      JSON.stringify({
                        receiver_id: "v2.rascals-dao-1104.testnet",
                        amount: "250000000",
                        msg: '{"bucket":"rewards"}',
                      }),
                    ),
                    deposit: "1",
                    gas: "120000000000000",
                  },
                ],
              },
            },
            status: "Approved",
            vote_counts: { council: [2, 0, 0] },
            votes: { "alice.testnet": "Approve", "bob.testnet": "Approve" },
            submission_time: "1794225600000000000",
          },
        ],
        bounties: [
          {
            id: 0,
            description: "Verified merged PR contribution",
            token: "rewards.rascals-council2-1104.testnet",
            amount: "100000000",
            times: 5,
            max_deadline: "604800000000000",
          },
        ],
      },
    };

    const bannerHtml = renderToStaticMarkup(
      <SputnikSummaryBanner
        state={stateWithSputnik}
        onOpenSputnik={() => {}}
      />,
    );
    expect(bannerHtml).toContain("SPUTNIK DAO v2 INTEGRATED");
    expect(bannerHtml).toContain("WORKING ON NEAR TESTNET");
    expect(bannerHtml).toContain("therascals.sputnikv2.testnet");
    expect(bannerHtml).toContain("v2.rascals-dao-1104.testnet");

    const panelHtml = renderToStaticMarkup(
      <SputnikDaoPanel
        state={stateWithSputnik}
        client={{
          ...mockClient,
          sputnikProposeGrant: vi.fn(),
          sputnikProposeBounty: vi.fn(),
          sputnikVote: vi.fn(),
        }}
        pending={null}
        act={vi.fn() as any}
      />,
    );
    expect(panelHtml).toContain("Sputnik Proposal #0");
    expect(panelHtml).toContain("APPROVED &amp; EXECUTED");
    expect(panelHtml).toContain("SPUTNIK BOUNTY #0");
    expect(panelHtml).toContain("Live on NEAR Testnet");
    expect(panelHtml).toContain("COUNCIL &amp; BOUNTIES");
    expect(panelHtml).not.toContain("OPTION A ARCHITECTURE");
  });

  it("resolves multi-hop Ref DCL routes for PRL and iNEAR pools and parses live JustHoot rooms", async () => {
    expect(justHootPoolIds("hoot-8ecf65.launchpad.justhoot.near")).toEqual([
      "hoot-8ecf65.launchpad.justhoot.near|wrap.near|10000",
    ]);
    expect(justHootPoolIds("oyster.v2-launchpad.justhoot.near")).toEqual([
      "prl.omft.near|wrap.near|10000",
      "oyster.v2-launchpad.justhoot.near|prl.omft.near|10000",
    ]);
    expect(
      justHootPoolIds(
        "bbc.v2-launchpad.justhoot.near",
        "bbc.v2-launchpad.justhoot.near|inear.nearonhq.near|10000",
      ),
    ).toEqual([
      "inear.nearonhq.near|wrap.near|400",
      "bbc.v2-launchpad.justhoot.near|inear.nearonhq.near|10000",
    ]);

    const snap = await fetchLiveJustHootRooms((async () =>
      new Response(
        JSON.stringify({
          rooms: [
            {
              pool_id: "hoot-8ecf65.launchpad.justhoot.near|wrap.near|10000",
              token: { id: "hoot-8ecf65.launchpad.justhoot.near", symbol: "HOOT", name: "Hoot", decimals: 18 },
              quote: { id: "wrap.near", symbol: "wNEAR", decimals: 24 },
              market_cap: "300000",
              market_cap_usd: "1050000",
              volume_24h_usd: "31500",
              change_24h: "-2.5",
              price_usd: "0.00105",
              trades_24h: 88,
              holder_count: 901,
              graduated: true,
            },
          ],
        }),
        { status: 200 },
      )) as typeof fetch);
    expect(snap).not.toBeNull();
    expect(snap!.nearPriceUsd).toBeCloseTo(3.5, 4);
    expect(snap!.entries.find((e) => e.symbol === "HOOT")).toMatchObject({
      marketCapLabel: "$1.1M",
      volume24hLabel: "$31.5K",
      change24h: -2.5,
      holders: 901,
    });
  });

  it("prefixes JustHoot brand and token asset URLs with DAO BASE_URL", () => {
    expect(daoAssetUrl("brands/justhoot/logo.png", "/dao/")).toBe(
      "/dao/brands/justhoot/logo.png",
    );
    expect(daoAssetUrl("/brands/justhoot/tokens/hoot.webp", "/dao/")).toBe(
      "/dao/brands/justhoot/tokens/hoot.webp",
    );
    expect(daoAssetUrl("/brands/justhoot/tokens/hoot.webp", "/")).toBe(
      "/brands/justhoot/tokens/hoot.webp",
    );
    expect(daoAssetUrl("https://cdn.example/icon.png", "/dao/")).toBe(
      "https://cdn.example/icon.png",
    );
    expect(
      daoAssetUrl("data:image/webp;base64,UklGRkwHAABX", "/dao/"),
    ).toBe("data:image/webp;base64,UklGRkwHAABX");
    expect(daoAssetUrl("data:image/svg+xml;base64,PHN2Zz4=", "/dao/")).toBe("");
  });
});
