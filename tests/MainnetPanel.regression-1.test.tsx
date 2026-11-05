// Regression: RELEASE-001 — discovery refresh unmounted the real trading panel.
// Found by /qa on 2026-10-29. Report: docs/release-audit-2026-10-29.md
import { afterEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("../apps/web/src/wallets/Wallets.tsx", () => ({
  useWallets: () => ({
    accounts: {},
    identity: null,
    pending: null,
    error: "",
    issue: null,
  }),
  WalletConnections: () => null,
}));
vi.mock("../apps/web/src/MainnetTrading.tsx", () => ({
  MainnetTrading: () => (
    <div data-testid="mainnet-trading">Wallet-approved mainnet trading</div>
  ),
}));
import App from "../apps/web/src/App.tsx";
afterEach(() => vi.unstubAllGlobals());
it("keeps the mainnet route panel available while the token pool is loading", () => {
  vi.stubGlobal("location", { hash: "#draw", search: "" });
  vi.stubGlobal("localStorage", { getItem: () => null });
  vi.stubGlobal("sessionStorage", { getItem: () => null });
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  vi.stubGlobal("document", { hidden: false });
  const html = renderToStaticMarkup(<App />);
  expect(html).toContain('data-testid="mainnet-trading"');
  expect(html).toContain('aria-busy="true"');
});
