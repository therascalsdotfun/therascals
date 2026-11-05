import { expect, it, vi } from "vitest";
import { EvmMainnet } from "../apps/server/src/mainnet/evm.ts";
import { clientMessage } from "../apps/server/src/client-message.ts";
import { quoteFixture } from "./fixtures/evm-quote.ts";
const wallet = "0x" + "1".repeat(40),
  mint = "0x" + "2".repeat(40);
it.each([
  "passed",
  "empty",
  "revert",
  "wrong-chain",
  "high-gas",
  "rpc-funds",
  "rpc-out-of-funds",
])("runs actual-balance simulation: %s", async (kind) => {
  const calls: any[] = [],
    now = Date.now();
  const provider: typeof fetch = async (input, options) => {
    const url = String(input);
    if (url.includes("/token?"))
      return Response.json({
        address: "0x" + "0".repeat(40),
        chainId: 8453,
        decimals: 18,
        symbol: "ETH",
        priceUSD: "2500",
      });
    if (url.includes("/quote?")) return Response.json(quoteFixture());
    const r = JSON.parse(String(options?.body));
    calls.push(r);
    if (r.method === "eth_estimateGas" && kind.startsWith("rpc-"))
      return Response.json({
        error: {
          code: -32000,
          message:
            kind === "rpc-funds"
              ? "insufficient funds for gas * price + value at private-node:8545"
              : "OutOfFunds at private-node:8545",
        },
      });
    if (r.method === "eth_call" && kind === "revert")
      return Response.json({
        error: {
          code: 3,
          message: "execution reverted: Too little received",
        },
      });
    return Response.json({
      result: (
        {
          eth_chainId: kind === "wrong-chain" ? "0x38" : "0x2105",
          eth_getCode: "0x1234",
          eth_getBalance: kind === "empty" ? "0x0" : "0xde0b6b3a7640000",
          eth_call: "0x",
          eth_estimateGas: "0x493e0",
          eth_gasPrice: kind === "high-gas" ? "0x2540be400" : "0x989680",
        } as any
      )[r.method],
    });
  };
  const service = new EvmMainnet(provider, () => now),
    q = await service.quote({
      chain: "base",
      wallet,
      mint,
      amount: "5",
      symbol: "TINY",
    });
  const s = await service.simulate(q);
  expect(s.status).toBe(
    kind === "passed"
      ? "passed"
      : kind === "empty" || kind.startsWith("rpc-")
        ? "insufficient_funds"
        : "failed",
  );
  if (kind.startsWith("rpc-")) {
    expect(s.message).toMatch(/Not enough ETH/);
    expect(s.message).not.toContain("private-node");
  }
  expect(
    calls.every((r) => !r.method.includes("send") && r.params.length <= 2),
  ).toBe(true);
  expect(() => service.get(q.id, mint)).toThrow(/wallet/);
  expect(() => new EvmMainnet(provider).get(q.id, wallet)).toThrow();
});
it("keeps a chain node's own error wording out of the displayable trade error", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const service = new EvmMainnet(
      async () =>
        Response.json({
          jsonrpc: "2.0",
          id: 1,
          error: {
            code: -32000,
            message:
              "execution reverted at node 10.2.0.7:8545: re-execution of eth_call failed",
          },
        }),
      () => Date.now(),
    );
    const e = await service
      .rpc("base", "eth_getBalance", [wallet])
      .catch((x) => x);
    expect(e).toBeInstanceOf(Error);
    // EvmTradeError is displayable copy, so the curated message is what the
    // player sees; the node's wording must not have been carried into it.
    expect(clientMessage(e, "fallback")).toBe(
      "The chain node rejected this request.",
    );
    expect(e.message).toBe("The chain node rejected this request.");
    expect(warn.mock.calls.flat().join(" ")).toContain("re-execution");
  } finally {
    warn.mockRestore();
  }
});
