import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
  SendTransactionError,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
} from "@solana/spl-token";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { JsonRpcProvider } from "near-api-js";
import { intentsFundingPending } from "../../../../packages/shared/src/intents-execution.ts";
import type { WalletIdentity } from "../../../../packages/shared/src/wallet-auth.ts";
import type { MarketStore } from "../market/store.ts";
import type { IntentsExecution } from "../intents/execution.ts";
import { IntentsError } from "../intents/service.ts";
import { SOLANA_MAINNET_GENESIS } from "../../../../packages/shared/src/solana-network.ts";
import { simulateSolanaMessage } from "./preflight.ts";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export function assertSolanaMainnet(hash: string) {
  if (hash !== SOLANA_MAINNET_GENESIS)
    throw new IntentsError(
      "Funding RPC is not Solana mainnet. Nothing was sent.",
    );
}
export function mainnetConnection() {
  return new Connection(
    process.env.SOLANA_MAINNET_RPC ?? "https://api.mainnet-beta.solana.com",
    {
      commitment: "confirmed",
      disableRetryOnRateLimit: true,
      fetch: (url, init) =>
        fetch(url, {
          ...init,
          redirect: "error",
          signal: AbortSignal.timeout(15000),
        }),
    },
  );
}
export function fundingInstructions(
  sender: string,
  recipient: string,
  assetId: string,
  contract: string | undefined,
  amount: string,
) {
  const from = new PublicKey(sender),
    to = new PublicKey(recipient);
  if (assetId === "nep141:sol.omft.near")
    return [
      SystemProgram.transfer({
        fromPubkey: from,
        toPubkey: to,
        lamports: BigInt(amount),
      }),
    ];
  if (contract !== USDC)
    throw new IntentsError("This funding asset is not supported.", 400);
  const mint = new PublicKey(USDC),
    source = getAssociatedTokenAddressSync(mint, from),
    target = getAssociatedTokenAddressSync(mint, to);
  return [
    createAssociatedTokenAccountIdempotentInstruction(from, target, to, mint),
    createTransferCheckedInstruction(
      source,
      mint,
      target,
      from,
      BigInt(amount),
      6,
    ),
  ];
}
export function verifyFundingTransaction(
  encoded: string,
  expectedMessage: string,
  sender: string,
) {
  const tx = VersionedTransaction.deserialize(Buffer.from(encoded, "base64")),
    message = tx.message.serialize();
  if (
    Buffer.from(message).toString("base64") !== expectedMessage ||
    tx.message.header.numRequiredSignatures !== 1 ||
    tx.message.staticAccountKeys[0]?.toBase58() !== sender ||
    tx.signatures.length !== 1 ||
    !nacl.sign.detached.verify(
      message,
      tx.signatures[0],
      new PublicKey(sender).toBytes(),
    )
  )
    throw new IntentsError(
      "Wallet returned a different or invalid deposit transaction. Nothing was sent.",
      400,
    );
  return { tx, signature: bs58.encode(tx.signatures[0]) };
}
export class IntentsFunding {
  private busy = new Set<string>();
  constructor(
    private store: MarketStore,
    private swaps: IntentsExecution,
    private rpc = mainnetConnection(),
    private near = new JsonRpcProvider({ url: "https://rpc.mainnet.near.org" }),
  ) {}
  async prepare(identity: WalletIdentity, id: string) {
    if (this.busy.has(id))
      throw new IntentsError("Funding preparation is already running.", 409);
    this.busy.add(id);
    try {
      let op = this.swaps.assertFundable(identity, id);
      if (op.phase !== "prepared" || intentsFundingPending(op))
        throw new IntentsError(
          "Wallet approval was already requested. Check the original wallet activity; do not send again.",
          409,
        );
      if (op.origin.blockchain === "near") {
        op.phase = "awaiting_wallet";
        op.fundingRequestedAt = new Date().toISOString();
        this.swaps.save(op);
        return {
          network: "mainnet",
          chain: "near",
          operationId: id,
          signerId: identity.address,
          receiverId: op.depositAddress,
          amount: op.amountIn,
        };
      }
      if (identity.kind !== "phantom")
        throw new IntentsError("Connect the original Phantom wallet.", 403);
      assertSolanaMainnet(await this.rpc.getGenesisHash());
      const prior = this.store.getRecord<any>("intents-funding:" + id);
      if (prior?.signature)
        throw new IntentsError(
          "Deposit already signed. Refresh the original swap.",
          409,
        );
      const block = await this.rpc.getLatestBlockhash("confirmed"),
        tx = new Transaction({
          feePayer: new PublicKey(identity.address),
          recentBlockhash: block.blockhash,
        });
      tx.add(
        ...fundingInstructions(
          identity.address,
          op.depositAddress,
          op.origin.assetId,
          op.origin.contractAddress,
          op.amountIn,
        ),
      );
      const encoded = tx
        .serialize({ requireAllSignatures: false, verifySignatures: false })
        .toString("base64");
      const preflight = await simulateSolanaMessage(
        encoded,
        identity.address,
        this.rpc,
      );
      op = this.swaps.assertFundable(identity, id);
      this.store.putRecord("intents-funding:" + id, {
        message: tx.serializeMessage().toString("base64"),
        unsignedTransaction: encoded,
        blockhash: block.blockhash,
        lastValidBlockHeight: block.lastValidBlockHeight,
      });
      op.phase = "awaiting_wallet";
      op.fundingRequestedAt = new Date().toISOString();
      this.swaps.save(op);
      return {
        network: "mainnet",
        chain: "sol",
        operationId: id,
        transaction: encoded,
        preflight,
        expiresAt: op.fundBefore,
      };
    } finally {
      this.busy.delete(id);
    }
  }
  async submit(
    identity: WalletIdentity,
    id: string,
    signedTransaction: string,
  ) {
    if (this.busy.has(id))
      throw new IntentsError(
        "A deposit submission is already running. Check the original swap.",
        409,
      );
    this.busy.add(id);
    try {
      let op = this.swaps.get(identity, id);
      const draft = this.store.getRecord<any>("intents-funding:" + id);
      if (
        identity.kind !== "phantom" ||
        op.origin.blockchain !== "sol" ||
        !draft
      )
        throw new IntentsError(
          "No deposit transaction prepared for this wallet.",
          400,
        );
      const { tx, signature } = verifyFundingTransaction(
        signedTransaction,
        draft.message,
        identity.address,
      );
      if (draft.signature) {
        if (draft.signature !== signature)
          throw new IntentsError("Another deposit is already recorded.", 409);
        return this.status(identity, id);
      }
      this.swaps.assertFundable(identity, id);
      assertSolanaMainnet(await this.rpc.getGenesisHash());
      op = this.swaps.assertFundable(identity, id);
      // Persist exact bytes and signature before the first network send. Ambiguity
      // never creates another signed transfer or deposit address.
      this.store.putRecord("intents-funding:" + id, {
        ...draft,
        signature,
        wire: Buffer.from(tx.serialize()).toString("base64"),
      });
      op.fundingSignature = signature;
      op.phase = "unknown";
      this.swaps.save(op);
      try {
        const returned = await this.rpc.sendRawTransaction(tx.serialize(), {
          skipPreflight: false,
          maxRetries: 0,
        });
        if (returned !== signature) throw Error("RPC signature mismatch");
      } catch (e) {
        op = this.swaps.get(identity, id);
        // web3.js creates this exact error only for an RPC preflight rejection.
        // There was no earlier send for this persisted attempt.
        if (
          e instanceof SendTransactionError &&
          e.message.startsWith("Simulation failed.")
        ) {
          op.phase = "funding_failed";
          op.fundingChainStatus = "preflight_rejected";
          op.error =
            "Deposit rejected before broadcast. Nothing was sent. Check your source balance and network fees, then prepare a new quote.";
          return this.swaps.save(op);
        }
        op.error =
          "Deposit submission is uncertain. Refresh its original transaction; do not fund again.";
        this.swaps.save(op);
        return op;
      }
      return await this.swaps.notify(identity, id, signature);
    } finally {
      this.busy.delete(id);
    }
  }
  async status(identity: WalletIdentity, id: string) {
    let op = this.swaps.get(identity, id);
    if (
      op.origin.blockchain === "sol" &&
      op.fundingSignature &&
      !["success", "refunded", "funding_failed"].includes(op.phase)
    ) {
      try {
        assertSolanaMainnet(await this.rpc.getGenesisHash());
        const result = await this.rpc.getSignatureStatuses(
          [op.fundingSignature],
          { searchTransactionHistory: true },
        );
        const status = result.value[0];
        op = this.swaps.get(identity, id);
        if (
          status?.confirmationStatus === "finalized" &&
          status.err &&
          !["success", "refunded"].includes(op.phase)
        ) {
          op.phase = "funding_failed";
          op.fundingChainStatus = "finalized_failed";
          op.error =
            "Source transaction finalized with an error. No deposit transfer completed; a network fee may have been charged. Prepare a new quote.";
          return this.swaps.save(op);
        }
      } catch {
        /* RPC uncertainty never unlocks a signed attempt. */
      }
    }
    return this.swaps.refresh(identity, id);
  }
  async notifyNear(identity: WalletIdentity, id: string, hash: string) {
    if (this.busy.has(id))
      throw new IntentsError(
        "The original deposit is being checked. Try again shortly.",
        409,
      );
    this.busy.add(id);
    try {
      let op = this.swaps.get(identity, id);
      if (op.origin.blockchain !== "near" || identity.kind !== "near")
        throw new IntentsError(
          "Only the original NEAR funding wallet can confirm this transfer.",
          403,
        );
      if (op.fundingSignature && op.fundingSignature !== hash)
        throw new IntentsError(
          "A verified deposit hash is already recorded.",
          409,
        );
      // A pasted hash is a candidate, not a verified deposit artifact. Keep
      // funding locked while allowing a wrong candidate to be corrected.
      op.nearCandidateHash = hash;
      op.fundingRequestedAt ??= new Date().toISOString();
      if (!["success", "refunded"].includes(op.phase))
        op.phase = "awaiting_wallet";
      this.swaps.save(op);
      try {
        const network: any = await this.near.sendJsonRpc("status", []);
        if (network.chain_id !== "mainnet")
          throw Error("NEAR RPC is not mainnet");
        const result: any = await this.near.sendJsonRpc("tx", [
          hash,
          identity.address,
        ]);
        const t = result.transaction,
          a = t?.actions;
        if (
          t?.hash !== hash ||
          t.signer_id !== identity.address ||
          t.receiver_id !== op.depositAddress ||
          a?.length !== 1 ||
          a[0]?.Transfer?.deposit !== op.amountIn ||
          !Object.hasOwn(result.status ?? {}, "SuccessValue")
        )
          throw Error("Transfer not verified");
      } catch {
        op = this.swaps.get(identity, id);
        op.error =
          "NEAR candidate transaction is not verified. Check the original wallet activity and correct its hash if necessary; do not send another deposit.";
        return this.swaps.save(op);
      }
      op = this.swaps.get(identity, id);
      op.fundingSignature = hash;
      op.fundingChainStatus = "finalized";
      this.swaps.save(op);
      return await this.swaps.notify(identity, id, hash);
    } finally {
      this.busy.delete(id);
    }
  }
  reject(identity: WalletIdentity, id: string) {
    const op = this.swaps.get(identity, id),
      draft = this.store.getRecord<any>("intents-funding:" + id);
    if (op.fundingSignature || op.nearCandidateHash || draft?.signature)
      throw new IntentsError(
        "A signed deposit is already recorded. Reconcile it first.",
        409,
      );
    op.phase = "prepared";
    delete op.fundingRequestedAt;
    return this.swaps.save(op);
  }
}
