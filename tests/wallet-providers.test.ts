import { it, expect } from "vitest";
import {
  selectMetaMask,
  phantomProvider,
  readEvmPortfolio,
  walletError,
  switchToBase,
} from "../apps/web/src/wallets/providers.ts";
it("reads BNB native, known stables and indexed holdings with correct decimals", async () => {
  const methods: string[] = [];
  const portfolio = await readEvmPortfolio(
    {
      request: async ({ method, params }: any) => {
        methods.push(method);
        if (method === "eth_chainId") return "0x38";
        if (method === "eth_getBalance") return "0xde0b6b3a7640000";
        return params[0].data === "0x313ce567" ? "0x12" : "0x64";
      },
    },
    "0x" + "1".repeat(40),
    [{ address: "0x" + "2".repeat(40), symbol: "TINY" }],
  );
  expect(portfolio.network).toBe("BNB Chain mainnet");
  expect(portfolio.assets.map((a) => a.symbol)).toEqual([
    "BNB",
    "USDC",
    "USDT",
    "TINY",
  ]);
  expect(portfolio.assets.every((a) => a.decimals === 18)).toBe(true);
  expect(methods).not.toContain("eth_sendTransaction");
});
it("switches to Base explicitly and adds the official network only if absent", async () => {
  const calls: any[] = [];
  await switchToBase({
    request: async (r: any) => {
      calls.push(r);
      if (r.method === "wallet_switchEthereumChain") throw { code: 4902 };
      return r.method === "eth_chainId" ? "0x2105" : null;
    },
  });
  expect(calls.map((c) => c.method)).toEqual([
    "wallet_switchEthereumChain",
    "wallet_addEthereumChain",
    "eth_chainId",
  ]);
  expect(calls[1].params[0].rpcUrls).toEqual(["https://mainnet.base.org"]);
});
it("preserves a rejected Base switch without another popup", async () => {
  const calls: string[] = [];
  await expect(
    switchToBase({
      request: async ({ method }: any) => {
        calls.push(method);
        throw { code: 4001 };
      },
    }),
  ).rejects.toMatchObject({ code: 4001 });
  expect(calls).toEqual(["wallet_switchEthereumChain"]);
});
it("selects MetaMask by its announcement and never Phantom's Ethereum provider", () => {
  const phantom = {
      isMetaMask: true,
      isPhantom: true,
      request: async () => [],
    },
    mm = { request: async () => [] };
  expect(
    selectMetaMask(
      [
        { info: { rdns: "app.phantom" }, provider: phantom },
        { info: { rdns: "io.metamask" }, provider: mm },
      ],
      phantom,
    ),
  ).toBe(mm);
  expect(selectMetaMask([], phantom)).toBeNull();
  expect(
    phantomProvider({
      ethereum: phantom,
      solana: { isPhantom: true },
      phantom: { solana: { isPhantom: true, tag: "right" } },
    } as any)?.tag,
  ).toBe("right");
});
it("uses read-only EVM methods and keeps large balances as exact integers", async () => {
  const methods: string[] = [];
  const p = {
    request: async ({ method }: any) => {
      methods.push(method);
      if (method === "eth_chainId") return "0x1";
      if (method === "eth_getBalance") return "0xffffffffffffffff";
      return "0x0";
    },
  };
  const result = await readEvmPortfolio(p, "0x" + "1".repeat(40));
  expect(result.chainId).toBe("0x1");
  expect(result.assets[0].raw).toBe("18446744073709551615");
  expect(
    methods.every((m) =>
      ["eth_chainId", "eth_getBalance", "eth_call"].includes(m),
    ),
  ).toBe(true);
});
it("explains rejection and pending requests without asking for signatures", () => {
  expect(walletError({ code: 4001 })).toContain("cancelled");
  expect(walletError({ code: -32002 })).toContain("already waiting");
});
it("gives recovery instructions for unsupported signing, locked accounts and RPC failures", () => {
  expect(walletError({ code: 4200 })).toMatch(/support|wallet/i);
  expect(walletError({ code: 4100 })).toMatch(/unlock|permission/i);
  expect(walletError({ code: 4900 })).toMatch(/network|connect/i);
  expect(walletError({ code: "REQUEST_TIMEOUT" })).toMatch(/timed out|popup/i);
  expect(walletError({ message: "INTERNAL_SECRET_INFORMATION" })).not.toContain(
    "INTERNAL_SECRET",
  );
});
it("treats the installed NEAR connector dismissal errors as cancellation", () => {
  expect(walletError(new Error("User rejected"))).toContain("cancelled");
  expect(walletError(new Error("Wallet closed"))).toContain("cancelled");
});

it("reads Base native USDC and indexed ERC-20 balances without sending transactions", async () => {
  const address = "0x" + "1".repeat(40),
    token = "0x" + "2".repeat(40),
    methods: string[] = [];
  const provider: any = {
    request: async ({ method, params }: any) => {
      methods.push(method);
      if (method === "eth_chainId") return "0x2105";
      if (method === "eth_getBalance") return "0x10";
      if (method === "eth_call")
        return params[0].data === "0x313ce567" ? "0x12" : "0x64";
      throw Error("Unexpected method");
    },
  };
  const p = await readEvmPortfolio(provider, address, [
    { address: token, symbol: "BASEMEME", name: "Base Meme" },
  ]);
  expect(p.network).toBe("Base mainnet");
  expect(p.assets.map((a) => a.symbol)).toEqual(["ETH", "USDC", "BASEMEME"]);
  expect(p.assets[2].decimals).toBe(18);
  expect(methods).not.toContain("eth_sendTransaction");
  expect(p.coverage).toContain("incomplete");
});
