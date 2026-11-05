import { expect, it, vi } from "vitest";
import { Wallet, Signature } from "ethers";
import { HyperliquidClient } from "../apps/server/src/perps/hyperliquid.ts";
import { perpsAgentApproval } from "../packages/shared/src/perps.ts";
it("serializes a real mainnet EIP712 approval as r/s/v, not a hex string", async () => {
  const wallet = Wallet.createRandom(),
    agent = Wallet.createRandom();
  const approval = perpsAgentApproval({
    network: "mainnet",
    agentAddress: agent.address,
    nonce: Date.now(),
  });
  const { EIP712Domain, ...types } = approval.typedData.types;
  const signature = await wallet.signTypedData(
    approval.typedData.domain,
    types,
    approval.typedData.message,
  );
  const parts = Signature.from(signature);
  const client = new HyperliquidClient("mainnet");
  const send = vi
    .spyOn(client.transport, "request")
    .mockResolvedValue({ status: "ok", response: { type: "default" } });
  await client.approveAgent(approval, signature);
  expect(send).toHaveBeenCalledWith(
    "exchange",
    expect.objectContaining({
      action: expect.objectContaining({
        hyperliquidChain: "Mainnet",
        signatureChainId: "0xa4b1",
      }),
      signature: { r: parts.r, s: parts.s, v: parts.v },
    }),
    undefined,
  );
});
it("does not convert malformed balances into an insufficient-funds result", async () => {
  const client = new HyperliquidClient("mainnet");
  vi.spyOn(client.info, "clearinghouseState").mockResolvedValue({
    marginSummary: { accountValue: "broken" },
    withdrawable: "0",
    assetPositions: [],
  } as any);
  await expect(client.account("0x" + "11".repeat(20))).rejects.toThrow(
    "Malformed",
  );
});
