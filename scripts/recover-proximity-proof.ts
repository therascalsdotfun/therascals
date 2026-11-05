/** Rebuild public evidence after a verifier-process interruption; never re-broadcast. */
import { readFileSync, writeFileSync } from "node:fs";
import { MarketStore } from "../apps/server/src/market/store.ts";
import { operatorPaths } from "../apps/server/src/execution/paths.ts";
import { nearView } from "../apps/server/src/execution/setup.ts";
import {
  NEAR_RPC,
  assertTestnetAccount,
  devnetConnection,
  assertDevnetGenesis,
} from "../apps/server/src/execution/network.ts";
import { JsonRpcProvider } from "near-api-js";
import { rollWinner } from "../apps/server/src/routes/roll-commit.ts";
import { tokenKey } from "../packages/shared/src/token-selection.ts";
const base = process.env.JACKPOT_API_URL ?? "http://127.0.0.1:4317";
if (!/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(base))
  throw Error("Loopback only");
const cfg = JSON.parse(readFileSync(operatorPaths.publicConfig, "utf8"));
assertTestnetAccount(cfg.contractId);
const upgrade = JSON.parse(
  readFileSync(
    `docs/evidence/proximity/${process.env.JACKPOT_SLOT ?? "operator"}-upgrade.json`,
    "utf8",
  ),
);
if (upgrade.wasmSha256 !== cfg.wasmSha256)
  throw Error("Upgrade evidence mismatch");
const state = await (await fetch(base + "/api/execution")).json();
const sell = state.operation;
if (
  sell?.mode !== "exit" ||
  sell.phase !== "finalized_success" ||
  state.session?.pending ||
  !state.session?.revoked
)
  throw Error("No finalized revoked-session exit to recover");
const store = new MarketStore(operatorPaths.database);
try {
  const buy = store
    .records<any>("op:")
    .find(
      (o) =>
        o.mode !== "exit" &&
        o.phase === "finalized_success" &&
        o.session === sell.session &&
        o.draw?.id === sell.draw?.id &&
        o.marketIndex === sell.marketIndex,
    );
  if (
    !buy?.commitment ||
    !buy?.seed ||
    buy.selectionPolicy !== "proximity-v1" ||
    Date.parse(buy.createdAt) < Date.parse(upgrade.checkedAt)
  )
    throw Error("No matching post-upgrade committed roll");
  // Re-derive the winner from the revealed seed instead of trusting a reported
  // geometry, which is exactly what the old proof could not do.
  const releaseHash = buy.commitment,
    derived = rollWinner(
      buy.seed,
      buy.manifest.configurationHash,
      buy.manifest.pool.map(tokenKey),
    );
  if (derived !== buy.selectedMint)
    throw Error("Committed winner does not match the revealed seed");
  const provider = new JsonRpcProvider({ url: NEAR_RPC });
  if (
    ((await provider.sendJsonRpc("status", [])) as any).chain_id !== "testnet"
  )
    throw Error("Testnet only");
  const draw = await nearView(provider, cfg.contractId, "get_draw", {
    draw_id: buy.draw.id,
  });
  if (
    draw.selection_policy !== "proximity-v1" ||
    draw.release_hash !== releaseHash ||
    draw.source_mint !== buy.source.mint ||
    buy.source?.mint !== buy.selectedMint
  )
    throw Error("NEAR receipt mismatch");
  const buyFill = store.getRecord<any>("fill:" + buy.solanaSignature),
    sellFill = store.getRecord<any>("fill:" + sell.solanaSignature);
  for (const [op, fill] of [
    [buy, buyFill],
    [sell, sellFill],
  ])
    if (
      !fill?.success ||
      fill.signature !== op.solanaSignature ||
      fill.session !== op.session ||
      fill.drawId !== op.draw.id ||
      fill.marketIndex !== op.marketIndex
    )
      throw Error("Fill does not match the exact operation");
  const sol = devnetConnection();
  assertDevnetGenesis(await sol.getGenesisHash());
  for (const op of [buy, sell]) {
    const tx = await sol.getTransaction(op.solanaSignature, {
      commitment: "finalized",
      maxSupportedTransactionVersion: 0,
    });
    if (!tx?.meta || tx.meta.err)
      throw Error("Transaction not finalized successfully");
  }
  const markets = await (
    await fetch(base + "/api/markets?matchingOnly=true")
  ).json();
  const rejected = await fetch(base + "/api/execution/draw", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      configurationHash: markets.configurationHash,
      mode: "auto",
    }),
  });
  if (rejected.status !== 409)
    throw Error("Revocation did not reject a new buy");
  const evidence = {
    checkedAt: new Date().toISOString(),
    recoveredFromPersistedOperations: true,
    contractId: cfg.contractId,
    wasmSha256: cfg.wasmSha256,
    sessionId: buy.session,
    drawId: buy.draw.id,
    sourceMainnetMint: buy.source.mint,
    amountMode: buy.amountMode,
    actualBuyAmountAtomic: buy.amount,
    selectionPolicy: draw.selection_policy,
    releaseHash,
    release: buy.release,
    drawPopulation: buy.manifest.pool.length,
    drawMints: buy.manifest.pool.map((t: any) => t.mint),
    actualTestMint: cfg.markets[buy.marketIndex].mintToken,
    marketId: cfg.markets[buy.marketIndex].id,
    buyFinalized: true,
    sellFinalized: true,
    ownerExitAfterRevocation: true,
    newBuyAfterRevocationRejected: true,
    buy: buyFill,
    sell: sellFill,
    buyNearTransactions: buy.nearTransactions,
    sellNearTransactions: sell.nearTransactions,
    buyTimeline: buy.timeline,
    sellTimeline: sell.timeline,
    sourceMemecoinWasNotPurchased: true,
  };
  writeFileSync(operatorPaths.proof, JSON.stringify(evidence, null, 2));
  console.log(
    JSON.stringify({
      recovered: true,
      contract: cfg.contractId,
      drawId: draw.id,
      buy: buyFill.signature,
      sell: sellFill.signature,
    }),
  );
} finally {
  store.close();
}
