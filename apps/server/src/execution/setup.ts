import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  chmodSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { operatorPaths, type ExecutionPaths } from "./paths.ts";
import { Account, JsonRpcProvider, KeyPair } from "near-api-js";
import {
  PublicKey as SolKey,
  Keypair,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
  transfer,
} from "@solana/spl-token";
import nacl from "tweetnacl";
import bs58 from "bs58";
import {
  NEAR_RPC,
  devnetConnection,
  assertDevnetGenesis,
  assertTestnetAccount,
} from "./network.ts";
import type { DemoMarket } from "./cpmm.ts";
export const PUBLIC_CONFIG = operatorPaths.publicConfig;
export const PRIVATE_CONFIG = operatorPaths.privateConfig;
export async function nearView(
  provider: JsonRpcProvider,
  account_id: string,
  method_name: string,
  args: unknown = {},
) {
  assertTestnetAccount(account_id);
  const r: any = await provider.query({
    request_type: "call_function",
    account_id,
    method_name,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    finality: "final",
  });
  return JSON.parse(Buffer.from(r.result).toString());
}
export async function setupSession(
  activate = false,
  paths: ExecutionPaths = operatorPaths,
) {
  const PUBLIC_CONFIG = paths.publicConfig,
    PRIVATE_CONFIG = paths.privateConfig;
  mkdirSync(dirname(PUBLIC_CONFIG), { recursive: true });
  mkdirSync(dirname(PRIVATE_CONFIG), { recursive: true, mode: 0o700 });
  chmodSync(dirname(PRIVATE_CONFIG), 0o700);
  const wallet = JSON.parse(readFileSync(".credentials/wallets.json", "utf8"));
  if (paths.ownerWallet)
    wallet.near = JSON.parse(readFileSync(paths.ownerWallet, "utf8"));
  assertTestnetAccount(wallet.near.accountId);
  mkdirSync(".credentials", { recursive: true, mode: 0o700 });
  chmodSync(".credentials", 0o700);
  if (!existsSync(PRIVATE_CONFIG)) {
    const key = KeyPair.fromRandom("ed25519"),
      settler = KeyPair.fromRandom("ed25519"),
      quote = nacl.sign.keyPair();
    writeFileSync(
      PRIVATE_CONFIG,
      JSON.stringify(
        {
          sessionSecret: key.toString(),
          sessionPublic: key.getPublicKey().toString(),
          settlerSecret: settler.toString(),
          settlerPublic: settler.getPublicKey().toString(),
          quoteSecret: Array.from(quote.secretKey),
          quotePublic: bs58.encode(quote.publicKey),
        },
        null,
        2,
      ),
      { mode: 0o600, flag: "wx" },
    );
  }
  const privateConfig = JSON.parse(readFileSync(PRIVATE_CONFIG, "utf8")),
    provider = new JsonRpcProvider({ url: NEAR_RPC }),
    owner = new Account(wallet.near.accountId, provider, wallet.near.secretKey),
    contractId = paths.contractPrefix + "." + wallet.near.accountId,
    settlerId = paths.settlerPrefix + "." + wallet.near.accountId,
    contract = new Account(contractId, provider, wallet.near.secretKey);
  const manifest = JSON.parse(
      readFileSync(
        paths.marketManifest && existsSync(paths.marketManifest)
          ? paths.marketManifest
          : "docs/evidence/devnet-market-manifest.json",
        "utf8",
      ),
    ),
    markets = manifest.markets as DemoMarket[],
    wasm = readFileSync(
      "target/wasm32-unknown-unknown/release/jackpot_session.wasm",
    ),
    wasmHash = createHash("sha256").update(wasm).digest(),
    reserve = BigInt(wasm.length + 75000) * 10n ** 19n;
  let state: any;
  try {
    state = await contract.getState();
  } catch {}
  if (!state) {
    if (reserve > 6n * 10n ** 24n)
      throw new Error("Unexpected test contract storage requirement");
    await owner.createSubAccount({
      accountOrPrefix: paths.contractPrefix,
      publicKey: wallet.near.publicKey,
      nearToTransfer: reserve,
    });
    state = await contract.getState();
  }
  let settlerExists = true;
  try {
    await new Account(settlerId, provider).getState();
  } catch {
    settlerExists = false;
  }
  if (!settlerExists)
    await owner.createSubAccount({
      accountOrPrefix: paths.settlerPrefix,
      publicKey: privateConfig.settlerPublic,
      nearToTransfer: 3n * 10n ** 23n,
    });
  let publicConfig: any = existsSync(PUBLIC_CONFIG)
    ? JSON.parse(readFileSync(PUBLIC_CONFIG, "utf8"))
    : {};
  if (state.codeHash === "11111111111111111111111111111111") {
    const deploy = await contract.deployContract(wasm);
    const inputs = markets.map((m, i) => ({
      id: m.id,
      addresses: [
        m.pool,
        m.vaultUsdc,
        m.vaultToken,
        m.observation,
        m.authority,
        m.config,
        m.mintUsdc,
        m.mintToken,
      ],
      buy_floor: String(800 * (i + 1)),
      sell_floor_divisor: String(1250 * (i + 1)),
    }));
    const init = await owner.callFunctionRaw({
      contractId,
      methodName: "new",
      args: {
        owner: wallet.near.accountId,
        settler: settlerId,
        quote_key: privateConfig.quotePublic,
        markets: inputs,
      },
      gas: 50000000000000n,
      waitUntil: "FINAL",
    });
    publicConfig = {
      ...publicConfig,
      deployTransaction: deploy.transaction.hash,
      initTransaction: init.transaction.hash,
    };
    console.log("NEAR session contract initialized", contractId);
  } else if (state.codeHash !== bs58.encode(wasmHash))
    throw new Error(
      "Deployed session code differs; explicit reviewed migration required",
    );
  publicConfig = {
    ...publicConfig,
    contractId,
    ownerAccount: wallet.near.accountId,
    settlerAccount: settlerId,
    quotePublicKey: privateConfig.quotePublic,
    scopedPublicKey: privateConfig.sessionPublic,
    wasmSha256: wasmHash.toString("hex"),
    markets,
  };
  writeFileSync(PUBLIC_CONFIG, JSON.stringify(publicConfig, null, 2));
  if (publicConfig.feeVaultAta) {
    const policy = await nearView(provider, contractId, "get_fee_policy");
    if (!policy) {
      const before = await nearView(provider, contractId, "get_state");
      if (before.session)
        throw Error("Fee policy must be configured before the first session");
      const configure = await owner.callFunctionRaw({
        contractId,
        methodName: "configure_fee_vault",
        args: { vault_ata: publicConfig.feeVaultAta },
        gas: 30_000_000_000_000n,
        waitUntil: "FINAL",
      });
      publicConfig.feePolicyTransaction = configure.transaction.hash;
      writeFileSync(PUBLIC_CONFIG, JSON.stringify(publicConfig, null, 2));
    } else if (
      policy.vault_ata !== publicConfig.feeVaultAta ||
      policy.fee_bps !== 50
    )
      throw Error("Fee vault policy mismatch");
  }
  if (!activate) return publicConfig;
  const current = await nearView(provider, contractId, "get_state");
  if (
    current.session &&
    (current.session.pending ||
      current.session.balances.some((n: string) => BigInt(n) > 0n))
  )
    throw new Error("Resolve and exit the existing session first");
  const reuse = !!(
    current.session &&
    !current.session.revoked &&
    Number(current.session.expires_ms) > Date.now() &&
    BigInt(current.session.issued) < 100000000n
  );
  const sid = reuse ? current.session.id : current.next_session,
    path = "jackpot/session/" + sid,
    derived = await nearView(
      provider,
      "v1.signer-prod.testnet",
      "derived_public_key",
      { path, predecessor: contractId, domain_id: 1 },
    );
  if (typeof derived !== "string" || !derived.startsWith("ed25519:"))
    throw new Error("Unexpected Ed25519 derivation");
  const source = new SolKey(derived.slice(8)),
    c = devnetConnection();
  assertDevnetGenesis(await c.getGenesisHash());
  const payer = Keypair.fromSecretKey(Uint8Array.from(wallet.solana.secretKey));
  let funding = "";
  if ((await c.getBalance(source, "finalized")) < 50000000) {
    funding = await sendAndConfirmTransaction(
      c,
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: source,
          lamports: 50000000,
        }),
      ),
      [payer],
      { commitment: "finalized" },
    );
  }
  const usdcAta = await getOrCreateAssociatedTokenAccount(
      c,
      payer,
      new SolKey(markets[0].mintUsdc),
      source,
      false,
      "finalized",
    ),
    tokenAtas: string[] = [];
  for (const m of markets) {
    const ata = await getOrCreateAssociatedTokenAccount(
      c,
      payer,
      new SolKey(m.mintToken),
      source,
      false,
      "finalized",
    );
    tokenAtas.push(ata.address.toBase58());
  }
  let usdcFunding = "";
  if (usdcAta.amount < 100000000n) {
    const from = getAssociatedTokenAddressSync(
      new SolKey(markets[0].mintUsdc),
      payer.publicKey,
    );
    usdcFunding = await transfer(
      c,
      payer,
      from,
      usdcAta.address,
      payer,
      100000000n - usdcAta.amount,
      [],
      { commitment: "finalized" },
    );
  }
  let keyExists = false;
  try {
    const existing: any = await provider.query({
      request_type: "view_access_key",
      account_id: wallet.near.accountId,
      public_key: privateConfig.sessionPublic,
      finality: "final",
    });
    const permission = existing.permission?.FunctionCall;
    keyExists =
      permission?.receiver_id === contractId &&
      permission.method_names?.includes("begin_degen_draw") &&
      permission.method_names?.includes("begin_proximity_draw");
    if (!keyExists) await owner.deleteKey(privateConfig.sessionPublic);
  } catch (error) {
    if (
      !/does not exist|UNKNOWN_ACCESS_KEY|ACCESS_KEY_DOES_NOT_EXIST/i.test(
        String(error),
      )
    )
      throw error;
  }
  if (!keyExists)
    await owner.addFunctionCallAccessKey({
      publicKey: privateConfig.sessionPublic,
      contractId,
      methodNames: [
        "begin_draw",
        "begin_degen_draw",
        "begin_proximity_draw",
        "authorize_attempt",
        "request_exit",
        "revoke_session",
      ],
      allowance: 10n ** 24n,
    });
  const activation = reuse
    ? null
    : await owner.callFunctionRaw({
        contractId,
        methodName: "create_session",
        args: {
          expected_id: sid,
          source: source.toBase58(),
          usdc_ata: usdcAta.address.toBase58(),
          token_atas: tokenAtas,
          session_key: privateConfig.sessionPublic,
        },
        gas: 50000000000000n,
        waitUntil: "FINAL",
      });
  const session = await nearView(provider, contractId, "get_session");
  publicConfig = {
    ...publicConfig,
    mappingHash: current.mapping_hash,
    session,
    activationTransaction:
      activation?.transaction.hash ?? publicConfig.activationTransaction,
    solFunding: funding,
    usdcFunding,
    activatedAt: new Date().toISOString(),
  };
  writeFileSync(PUBLIC_CONFIG, JSON.stringify(publicConfig, null, 2));
  const setup = JSON.parse(readFileSync(".data/setup-status.json", "utf8"));
  writeFileSync(
    ".data/setup-status.json",
    JSON.stringify(
      {
        ...setup,
        solBalance: (await c.getBalance(payer.publicKey, "finalized")) / 1e9,
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(
    "Activated bounded session",
    sid,
    "MPC address",
    source.toBase58(),
  );
  return publicConfig;
}
