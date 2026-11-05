import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { SOLANA_MAINNET_GENESIS } from "../packages/shared/src/solana-network.ts";
const state = vi.hoisted(() => ({ provider: null as any }));
vi.mock("../apps/web/src/wallets/providers.ts", () => ({
  phantomProvider: () => state.provider,
}));
import { sellWalletContext } from "../apps/web/src/portfolio/sell-wallet.ts";
const address = new PublicKey(new Uint8Array(32).fill(12)).toBase58();
const tx = () => ({
  serialize: () => new Uint8Array([1, 2]),
  message: {
    serialize: () => new Uint8Array([3, 4]),
    recentBlockhash: address,
  },
  signatures: [new Uint8Array(64).fill(8)],
});
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
  vi.stubGlobal("navigator", {
    locks: {
      request: vi.fn(async (_name: string, operation: () => unknown) =>
        operation(),
      ),
    },
  });
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  vi.stubGlobal("window", new EventTarget());
  state.provider = {
    publicKey: new PublicKey(address),
    signTransaction: vi.fn(async (t: any) => t),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: "passed", blockhashSlot: 200 }),
    })),
  );
});
const context = (current = () => true) =>
  sellWalletContext({
    address,
    current,
    status: () => {},
    signing: () => {},
    connect: async () => {},
    disconnect: async () => {},
  });
it("requests wallet approval only after preflight passes", async () => {
  await context().signTransaction(tx());
  expect(fetch).toHaveBeenCalledWith(
    "/api/mainnet/solana/simulate",
    expect.anything(),
  );
  expect(state.provider.signTransaction).toHaveBeenCalledTimes(1);
});
it("blocks approval when preflight fails or account changes during simulation", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: false,
      json: async () => ({ error: "insufficient funds" }),
    })),
  );
  await expect(context().signTransaction(tx())).rejects.toThrow("insufficient");
  expect(state.provider.signTransaction).not.toHaveBeenCalled();
  let current = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      current = false;
      return {
        ok: true,
        json: async () => ({ status: "passed", blockhashSlot: 200 }),
      };
    }),
  );
  await expect(context(() => current).signTransaction(tx())).rejects.toThrow(
    "changed",
  );
  expect(state.provider.signTransaction).not.toHaveBeenCalled();
});
it("rejects a wallet-modified message", async () => {
  state.provider.signTransaction = vi.fn(async () => ({
    message: { serialize: () => new Uint8Array([9, 9]) },
  }));
  await expect(context().signTransaction(tx())).rejects.toThrow(
    "different transaction",
  );
});
it("does not send on a non-mainnet connection", async () => {
  const send = vi.fn();
  await expect(
    context().sendTransaction(
      tx(),
      { getGenesisHash: async () => "devnet", sendRawTransaction: send },
      {},
    ),
  ).rejects.toThrow("mainnet");
  expect(send).not.toHaveBeenCalled();
  expect(state.provider.signTransaction).not.toHaveBeenCalled();
});

// Regression: signed sales must remain recoverable when Jupiter loses its callback.
// A mocked wallet and RPC exercise the signing boundary; no funded execution is claimed.
it("blocks another sale after a signature is handed to Jupiter, including a new context", async () => {
  await context().signTransaction(tx());
  await expect(context().signTransaction(tx())).rejects.toThrow(
    /unresolved|pending/i,
  );
  expect(state.provider.signTransaction).toHaveBeenCalledTimes(1);
});
