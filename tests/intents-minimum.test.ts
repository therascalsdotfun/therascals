import { expect, it } from "vitest";
import { IntentsService } from "../apps/server/src/intents/service.ts";
import { createApp } from "../apps/server/src/http/app.ts";
const tokens = [
  {
    assetId: "nep141:wrap.near",
    symbol: "wNEAR",
    blockchain: "near",
    decimals: 24,
  },
  {
    assetId: "nep141:sol-usdc.omft.near",
    symbol: "USDC",
    blockchain: "sol",
    decimals: 6,
    contractAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  },
  {
    assetId: "nep245:bsc-usdc",
    symbol: "USDC",
    blockchain: "bsc",
    decimals: 18,
    contractAddress: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
  },
];
function service(message: unknown) {
  return new IntentsService(async (url: any) =>
    url.endsWith("/tokens")
      ? Response.json(tokens)
      : Response.json({ message }, { status: 400 }),
  );
}
it("explains a recognized provider USD minimum without changing the cap or exposing raw provider content", async () => {
  const provider = service(
    "Temporary swap limits: minimum swap amount is $1,000",
  );
  const app = await createApp({}, undefined, { intents: provider });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/intents/quote",
      payload: { destinationAsset: "nep245:bsc-usdc", amount: "5" },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: "PROVIDER_MINIMUM_USD",
      minimumUsd: "1000",
      exceedsTradeCap: true,
    });
    expect(response.json().error).toContain("$1,000");
    expect(response.json().error).toContain("$100 trade cap");
    expect(response.json().depositAddress).toBeUndefined();
  } finally {
    await app.close();
  }
});
it.each([
  "Temporary swap limits: minimum swap amount is $1,000. Approve at https://evil.example/private-key",
  "<script>sendFunds()</script>",
  "Temporary swap limits: minimum swap amount is $1e9",
  { message: "private details" },
])("never reflects unrecognized provider errors", async (message) => {
  await expect(
    service(message).quote("nep245:bsc-usdc", "5"),
  ).rejects.toMatchObject({
    status: 422,
    message:
      "NEAR Intents rejected this amount or pair. Try a different supported asset or amount.",
  });
});
it("keeps a small recognized minimum distinct from an over-cap restriction", async () => {
  await expect(
    service("minimum swap amount is $5.50").quote("nep245:bsc-usdc", "1"),
  ).rejects.toMatchObject({
    status: 422,
    details: { minimumUsd: "5.50", exceedsTradeCap: false },
  });
});
