import { it, expect } from "vitest";
import { MarketStore } from "../apps/server/src/market/store.ts";
import { ExecutionService } from "../apps/server/src/execution/service.ts";
it("rejects a non-testnet NEAR RPC and a changed policy code hash before execution", async () => {
  const store = new MarketStore(":memory:"),
    e: any = new ExecutionService(store, {} as any);
  e.config = {
    contractId: "session.owner.testnet",
    wasmSha256: "00".repeat(32),
  };
  e.provider = {
    sendJsonRpc: async () => ({ chain_id: "mainnet" }),
    query: async () => ({ code_hash: "wrong" }),
  };
  await expect(e.refresh()).rejects.toThrow("not testnet");
  expect(e.policyCodeVerified).toBe(false);
  e.provider.sendJsonRpc = async () => ({ chain_id: "testnet" });
  await expect(e.refresh()).rejects.toThrow("policy code changed");
  expect(e.policyCodeVerified).toBe(false);
  store.close();
});
