/** Requests one real production-signed quote, never funds it. */
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import bs58 from "bs58";
import { MarketStore } from "../apps/server/src/market/store.ts";
import { IntentsService } from "../apps/server/src/intents/service.ts";
import { IntentsExecution } from "../apps/server/src/intents/execution.ts";
const store = new MarketStore(":memory:");
try {
  const provider = new IntentsService(),
    catalog = await provider.catalog();
  const origin = catalog.assets.find(
    (a) => a.blockchain === "sol" && a.symbol === "SOL" && !a.contractAddress,
  );
  if (!origin) throw Error("Native SOL is not available in the live catalog");
  // A throwaway unfunded address, not a user account. No secret/signing API.
  const address = bs58.encode(randomBytes(32));
  const execution = new IntentsExecution(store, provider);
  const identity = {
    kind: "phantom" as const,
    address,
    expiresAt: new Date(Date.now() + 300000).toISOString(),
  };
  const op = await execution.prepare(identity, {
    requestId: randomUUID(),
    originAsset: origin.assetId,
    destinationAsset: catalog.defaultDestination,
    amount: "0.01",
    recipient: address,
  });
  const checked = execution.assertFundable(identity, op.id);
  const report = {
    checkedAt: new Date().toISOString(),
    network: "mainnet",
    funded: false,
    phase: checked.phase,
    signatureAndPolicyVerified: true,
    origin: op.origin.symbol,
    destination: op.destination.symbol,
    amountIn: op.amountIn,
    minAmountOut: op.minAmountOut,
    appFeeBps: op.appFeeBps,
    fundBefore: op.fundBefore,
    refundDeadline: op.refundDeadline,
    quoteHash: op.quoteHash,
    depositAddressCreated: !!op.depositAddress,
    note: "Unfunded throwaway quote only. No wallet approval, deposit, settlement or refund was tested.",
  };
  mkdirSync("docs/evidence/release-audit", { recursive: true });
  writeFileSync(
    "docs/evidence/release-audit/intents-signed-quote.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  store.close();
}
