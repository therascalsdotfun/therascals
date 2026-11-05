/** Complete evidence from the already-finalized buy/exit; never sends a trade. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { JsonRpcProvider } from "near-api-js";
import bs58 from "bs58";
import { executionPaths } from "../apps/server/src/execution/paths.ts";
import { nearView } from "../apps/server/src/execution/setup.ts";
import {
  NEAR_RPC,
  devnetConnection,
  assertDevnetGenesis,
} from "../apps/server/src/execution/network.ts";
import { canonicalSwapMessage } from "../apps/server/src/execution/policy-wire.ts";
const paths = executionPaths("beta08"),
  config = JSON.parse(readFileSync(paths.publicConfig, "utf8"));
const prior = JSON.parse(
  readFileSync("docs/evidence/fee-roll-testnet-2026-11-01.json", "utf8"),
);
assert.equal(prior.contractId, config.contractId);
assert.equal(prior.wasmSha256, config.wasmSha256);
const p = new JsonRpcProvider({ url: NEAR_RPC });
const account: any = await p.query({
  request_type: "view_account",
  account_id: config.contractId,
  finality: "final",
});
assert.equal(
  account.code_hash,
  bs58.encode(Buffer.from(config.wasmSha256, "hex")),
);
const state = await nearView(p, config.contractId, "get_state");
assert.equal(state.session.revoked, true);
assert.equal(state.session.pending, null);
assert(state.session.balances.every((n: string) => n === "0"));
const c = devnetConnection();
assertDevnetGenesis(await c.getGenesisHash());
for (const leg of ["buy", "exit"] as const) {
  const record = prior[leg];
  const receipt = await nearView(p, config.contractId, "get_attempt", {
    attempt_id: record.nearReceipt.id,
  });
  assert.equal(receipt.status, "finalized_success");
  assert.equal(receipt.signature, record.signature);
  const status = (
    await c.getSignatureStatuses([record.signature], {
      searchTransactionHistory: true,
    })
  ).value[0];
  assert.equal(status?.confirmationStatus, "finalized");
  assert.equal(status.err, null);
  const tx = await c.getTransaction(record.signature, {
    commitment: "finalized",
    maxSupportedTransactionVersion: 0,
  });
  assert(tx?.meta);
  assert.equal(tx.meta.err, null);
  const actual = Buffer.from(tx.transaction.message.serialize());
  assert.equal(
    createHash("sha256").update(actual).digest("hex"),
    receipt.message_hash,
  );
  const expected = canonicalSwapMessage(
    config.markets[receipt.market_index],
    state.session.source,
    state.session.usdc_ata,
    state.session.token_atas[receipt.market_index],
    receipt.buy,
    receipt.amount,
    receipt.min_out,
    receipt.blockhash,
    config.feeVaultAta,
  );
  assert(actual.equals(expected));
  if (leg === "buy") {
    assert.equal(receipt.protocol_fee.collected, true);
    assert.equal(receipt.protocol_fee.fee_atomic, "25000");
    const keys = tx.transaction.message.getAccountKeys().staticAccountKeys;
    const index = keys.findIndex((k) => k.toBase58() === config.feeVaultAta);
    const sum = (rows: any[]) =>
      BigInt(
        rows.find((b) => b.accountIndex === index && b.mint === prior.mint)
          ?.uiTokenAmount.amount ?? "0",
      );
    assert.equal(
      sum(tx.meta.postTokenBalances ?? []) -
        sum(tx.meta.preTokenBalances ?? []),
      25000n,
    );
  } else assert.equal(receipt.protocol_fee, null);
}
// A syntactically valid request must reach the revoked-session guard.
const buyRecord = prior.buy.nearReceipt;
const response = await fetch("http://127.0.0.1:4317/api/execution/smoke-draw", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    rollId: prior.rollId,
    mode: "auto",
  }),
  signal: AbortSignal.timeout(15000),
});
const refusal = await response.json();
assert.equal(response.status, 409);
assert.match(refusal.error, /Activate a fresh bounded test session/);
const proof = {
  ...prior,
  checkedAt: new Date().toISOString(),
  buyFinalized: true,
  sellFinalized: true,
  ownerExitAfterRevocation: true,
  newBuyAfterRevocationRejected: true,
  revocationRejection: { status: response.status, error: refusal.error },
  sourceMemecoinWasNotPurchased: true,
  verification:
    "independent finalized source-chain and NEAR receipts; no trade replay",
};
mkdirSync(dirname(paths.proof), { recursive: true });
writeFileSync(paths.proof, JSON.stringify(proof, null, 2) + "\n");
console.log(
  JSON.stringify({
    proof: paths.proof,
    buy: buyRecord.signature,
    exit: prior.exit.signature,
    feeAtomic: "25000",
    replayedTrades: 0,
  }),
);
