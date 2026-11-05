import { readFileSync, writeFileSync } from "node:fs";
import { Account, JsonRpcProvider } from "near-api-js";
import { nearView } from "../apps/server/src/execution/setup.ts";
import { NEAR_RPC } from "../apps/server/src/execution/network.ts";
const pub = JSON.parse(
    readFileSync("docs/evidence/session-config.json", "utf8"),
  ),
  priv = JSON.parse(readFileSync(".credentials/execution.json", "utf8")),
  wallet = JSON.parse(readFileSync(".credentials/wallets.json", "utf8")),
  provider = new JsonRpcProvider({ url: NEAR_RPC }),
  scoped = new Account(pub.ownerAccount, provider, priv.sessionSecret),
  settler = new Account(pub.settlerAccount, provider, priv.settlerSecret),
  owner = new Account(pub.ownerAccount, provider, wallet.near.secretKey);
const before = await nearView(provider, pub.contractId, "get_state");
if (before.session.pending) throw new Error("Wait for the current attempt");
if (before.session.revoked || Number(before.session.expires_ms) <= Date.now())
  throw new Error(
    "Use a live, unrevoked session so expiry does not mask these checks",
  );
const draw = String(BigInt(before.next_draw) - 1n),
  attempt = String(BigInt(before.next_attempt) - 1n),
  args = {
    draw_id: draw,
    expected_attempt: before.next_attempt,
    amount: "101000000",
    min_out: "1",
    blockhash: "11111111111111111111111111111111",
    last_valid: "0",
    observed_slot: "0",
    quote_expires_ms: String(Date.now() + 15000),
    quote_signature: [],
  },
  results: any[] = [];
async function rejected(
  label: string,
  account: Account,
  methodName: string,
  body: any,
  expected: string,
) {
  try {
    await account.callFunctionRaw({
      contractId: pub.contractId,
      methodName,
      args: body,
      gas: 50000000000000n,
      waitUntil: "FINAL",
    });
    throw new Error("UNEXPECTED SUCCESS: " + label);
  } catch (e) {
    const err = e as any,
      msg = String(err.message);
    const attributed = msg.includes(expected);
    const genericTrap =
      err.name === "ContractExecutionError" &&
      msg.includes("WebAssembly trap") &&
      err.transactionResult?.receipts_outcome?.some(
        (r: any) =>
          r.outcome?.executor_id === pub.contractId &&
          r.outcome?.status?.Failure,
      );
    if (!attributed && !genericTrap) throw e;
    results.push({
      label,
      expected,
      exactRuleAttributedByLiveError: attributed,
      interpretation: attributed
        ? "Specific contract rejection"
        : "Actual contract rejection; generic WASM trap does not identify the guard. Rule-specific assertions are covered by Rust VM tests.",
      transaction:
        err.txHash ?? err.transactionResult?.transaction?.hash ?? null,
      error: msg.slice(0, 500),
    });
    console.log("Actual NEAR rejection:", label);
  }
}
await rejected(
  "Per-buy amount above 10 demo USDC",
  scoped,
  "authorize_attempt",
  args,
  "Buy must be 1..100",
);
await rejected(
  "Settlement account cannot authorize a buy",
  settler,
  "authorize_attempt",
  { ...args, amount: "1000000" },
  "Unauthorized session key",
);
await rejected(
  "Issued attempt ID cannot be replayed",
  scoped,
  "authorize_attempt",
  { ...args, expected_attempt: attempt, amount: "1000000" },
  "Attempt replay",
);
await rejected(
  "Owner cannot forge an MPC callback",
  owner,
  "on_signature",
  { attempt_id: attempt },
  "private",
);
const after = await nearView(provider, pub.contractId, "get_state");
if (
  before.session.issued !== after.session.issued ||
  after.session.pending ||
  before.next_attempt !== after.next_attempt
)
  throw new Error("Rejected call changed authorization or issued an attempt");
writeFileSync(
  "docs/evidence/policy-rejections.json",
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      contractId: pub.contractId,
      wasmSha256: pub.wasmSha256,
      session: before.session.id,
      issuedBefore: before.session.issued,
      issuedAfter: after.session.issued,
      nextAttemptBefore: before.next_attempt,
      nextAttemptAfter: after.next_attempt,
      results,
    },
    null,
    2,
  ),
);
