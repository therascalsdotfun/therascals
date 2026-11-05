// The red team found no way to take back a delegated Hyperliquid trading key.
// This locks the revocation affordance in place, and keeps it unavailable while
// a position still needs that key to close.
import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PerpsAgentView } from "../packages/shared/src/perps.ts";

const AGENT = "0x" + "ab".repeat(20);

vi.mock("../apps/web/src/wallets/Wallets.tsx", () => ({
  useWallets: () => ({
    accounts: {
      metamask: { address: "0x" + "cd".repeat(20), connected: true },
    },
    identity: {
      kind: "metamask",
      address: "0x" + "cd".repeat(20),
      chainId: "0x66eee",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    },
    pending: null,
    error: "",
    issue: null,
  }),
  WalletConnections: () => null,
}));
vi.mock("../apps/web/src/perps/PerpsTokenPool.tsx", () => ({
  PerpsTokenPool: () => null,
}));
vi.mock("../apps/web/src/perps/PerpsFundingQuote.tsx", () => ({
  PerpsFundingQuote: () => null,
}));
import { PerpsPanel } from "../apps/web/src/perps/PerpsGame.tsx";

function game(
  agentOver: Record<string, unknown> = {},
  gameOver: Record<string, unknown> = {},
) {
  const agent: PerpsAgentView = {
    network: "testnet",
    master: "0x" + "cd".repeat(20),
    agentAddress: AGENT,
    approved: true,
    revokedAgent: null,
    revokedAgents: [],
    accountValue: 100,
    withdrawable: 100,
    positions: [],
    activeOperation: null,
    ...agentOver,
  } as PerpsAgentView;
  return {
    network: "testnet",
    catalog: null,
    agent,
    operations: [],
    phase: "idle",
    spin: null,
    result: null,
    proof: null,
    operation: null,
    busy: false,
    error: "",
    universe: "perp",
    selectedMarkets: ["BTC", "ETH"],
    amountCap: 10,
    closeSeconds: 60,
    tick: 0,
    canSpin: true,
    lastOperation: null,
    connectWallet: () => {},
    approveAgent: () => {},
    revokeAgent: () => {},
    spinNow: () => {},
    closeNow: () => {},
    retryOpen: () => {},
    refresh: () => {},
    changePool: () => {},
    changeAmountCap: () => {},
    changeCloseSeconds: () => {},
    clearError: () => {},
    ...gameOver,
  };
}

it("offers to revoke the trading agent once nothing depends on it", () => {
  const html = renderToStaticMarkup(<PerpsPanel game={game() as any} />);
  expect(html).toContain("Revoke trading agent");
});

it("hides revocation while a position still needs the agent key", () => {
  const html = renderToStaticMarkup(
    <PerpsPanel
      game={
        game(
          {},
          {
            operation: {
              id: "spin",
              phase: "open",
              market: "BTC",
              display: "BTC",
              side: "long",
              leverage: 5,
              amount: 10,
              notional: 50,
            },
          },
        ) as any
      }
    />,
  );
  expect(html).not.toContain("Revoke trading agent");
  expect(html).toContain("Close now");
});

it("names every agent address the owner still has to remove inside Hyperliquid", () => {
  const OLD = "0x" + "ef".repeat(20);
  const html = renderToStaticMarkup(
    <PerpsPanel
      game={
        game({
          // Revoked and then re-approved: the live key is new, the old address
          // is still authorized on Hyperliquid until the owner removes it.
          revokedAgent: {
            owner: "x",
            network: "testnet",
            master: "0x" + "cd".repeat(20),
            agentAddress: OLD,
            revokedAt: 1,
          },
        }) as any
      }
    />,
  );
  expect(html).toContain("no way to remove an agent by API");
  expect(html).toContain(AGENT);
  expect(html).toContain(OLD);
});

it("keeps every revoked address and the venue settings link visible after revocation", () => {
  const earlier = "0x" + "ef".repeat(20);
  const revoked = [earlier, AGENT].map((agentAddress) => ({
    owner: "x",
    network: "testnet",
    master: "0x" + "cd".repeat(20),
    agentAddress,
    revokedAt: 1,
  }));
  const html = renderToStaticMarkup(
    <PerpsPanel
      game={
        game({
          approved: false,
          agentAddress: null,
          revokedAgent: revoked[1],
          revokedAgents: revoked,
        }) as any
      }
    />,
  );
  expect(html).toContain(earlier);
  expect(html).toContain(AGENT);
  expect(html).toContain('href="https://app.hyperliquid-testnet.xyz"');
  expect(html).toContain("forget the key");
});

it("requests the mainnet signing network before delegation without hiding existing position controls", () => {
  const html = renderToStaticMarkup(
    <PerpsPanel
      game={game({ approved: false }, { network: "mainnet" }) as any}
    />,
  );
  expect(html).toContain("Switch signing network");
  expect(html).toContain("Arbitrum One");
  expect(html).not.toContain("Enable one-tap trading");
  const approved = renderToStaticMarkup(
    <PerpsPanel game={game({}, { network: "mainnet" }) as any} />,
  );
  expect(approved).toContain("Revoke trading agent");
});
