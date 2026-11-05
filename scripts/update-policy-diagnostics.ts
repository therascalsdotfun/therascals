import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { Account, JsonRpcProvider } from "near-api-js";
import { NEAR_RPC } from "../apps/server/src/execution/network.ts";
import { nearView } from "../apps/server/src/execution/setup.ts";
const path = "docs/evidence/session-config.json",
  cfg = JSON.parse(readFileSync(path, "utf8")),
  wallet = JSON.parse(readFileSync(".credentials/wallets.json", "utf8")),
  p = new JsonRpcProvider({ url: NEAR_RPC });
const network: any = await p.sendJsonRpc("status", []);
if (network.chain_id !== "testnet") throw new Error("Only testnet");
const before = await nearView(p, cfg.contractId, "get_state");
if (before.session?.pending)
  throw new Error("No update while an operation is unresolved");
const backup: any = await p.query({
  request_type: "view_code",
  account_id: cfg.contractId,
  finality: "final",
});
writeFileSync(
  ".data/policy-prior.wasm",
  Buffer.from(backup.code_base64, "base64"),
);
const wasm = readFileSync(
    "target/wasm32-unknown-unknown/release/jackpot_session.wasm",
  ),
  sha = createHash("sha256").update(wasm).digest("hex");
if (sha === cfg.wasmSha256) throw new Error("No code change");
const account = new Account(cfg.contractId, p, wallet.near.secretKey),
  tx = await account.deployContract(wasm);
const after = await nearView(p, cfg.contractId, "get_state");
if (JSON.stringify(before) !== JSON.stringify(after))
  throw new Error(
    "Unexpected state change: stop and restore the saved prior code",
  );
if (
  existsSync("docs/evidence/near-cpmm-smoke.json") &&
  !existsSync("docs/evidence/near-cpmm-smoke-v1.json")
)
  writeFileSync(
    "docs/evidence/near-cpmm-smoke-v1.json",
    readFileSync("docs/evidence/near-cpmm-smoke.json"),
  );
if (existsSync("docs/evidence/near-cpmm-smoke.json"))
  writeFileSync(
    `docs/evidence/near-cpmm-smoke-${cfg.wasmSha256.slice(0, 8)}.json`,
    readFileSync("docs/evidence/near-cpmm-smoke.json"),
  );
writeFileSync(
  path,
  JSON.stringify(
    {
      ...cfg,
      wasmSha256: sha,
      diagnosticUpdateTransaction: tx.transaction.hash,
    },
    null,
    2,
  ),
);
writeFileSync(
  "docs/evidence/policy-diagnostic-update.json",
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      transaction: tx.transaction.hash,
      contractId: cfg.contractId,
      priorSha256: cfg.wasmSha256,
      wasmSha256: sha,
      stateUnchanged: true,
      purpose:
        "Preserve exits beyond the buy-history admission ceiling; explicit buy/replay diagnostics. State schema, spending caps and recipients unchanged.",
    },
    null,
    2,
  ),
);
console.log("Test policy diagnostics updated; state preserved; new hash", sha);
