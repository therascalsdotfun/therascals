import { randomUUID } from "node:crypto";
import {
  verifyQuoteSignature,
  quoteHash,
} from "@defuse-protocol/one-click-sdk-typescript";
import { PublicKey } from "@solana/web3.js";
import type { WalletIdentity } from "../../../../packages/shared/src/wallet-auth.ts";
import type { IntentsAsset } from "../../../../packages/shared/src/intents.ts";
import {
  intentsPhase,
  intentsFundingPending,
  type IntentsSwapOperation,
} from "../../../../packages/shared/src/intents-execution.ts";
import { subjectFor } from "../beta/access.ts";
import type { MarketStore } from "../market/store.ts";
import { IntentsError, IntentsService } from "./service.ts";
const NEAR = "nep141:wrap.near",
  SOL = "nep141:sol.omft.near",
  USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export function validChainAddress(chain: string, address: string): boolean {
  if (typeof address !== "string" || address.length > 80) return false;
  if (chain === "sol") {
    try {
      return (
        new PublicKey(address).toBase58() === address &&
        PublicKey.isOnCurve(new PublicKey(address).toBytes())
      );
    } catch {
      return false;
    }
  }
  if (chain === "near")
    return (
      address.length >= 2 &&
      address.length <= 64 &&
      /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(address)
    );
  return (
    ["base", "bsc"].includes(chain) &&
    /^0x[0-9a-fA-F]{40}$/.test(address) &&
    !/^0x0{40}$/i.test(address)
  );
}
export function intentsAtomic(value: string, asset: IntentsAsset): string {
  if (!/^(?:0|[1-9]\d{0,2})(?:\.\d{1,9})?$/.test(value))
    throw new IntentsError(
      "Enter a decimal amount with up to nine places.",
      400,
    );
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > asset.decimals)
    throw new IntentsError("Too many decimal places for this asset.", 400);
  const atomic =
    BigInt(whole) * 10n ** BigInt(asset.decimals) +
    BigInt(fraction.padEnd(asset.decimals, "0") || "0");
  const max =
    asset.assetId === SOL
      ? 1n * 10n ** 9n
      : 100n * 10n ** BigInt(asset.decimals);
  if (atomic <= 0n || atomic > max)
    throw new IntentsError(
      "Use a positive amount, at most 1 SOL or 100 units of the selected funding asset.",
      400,
    );
  return String(atomic);
}
const positive = (s: any) => typeof s === "string" && /^[1-9]\d{0,79}$/.test(s);
export class IntentsExecution {
  private inflight = new Set<string>();
  private lastPoll = new Map<string, number>();
  constructor(
    private store: MarketStore,
    private provider: IntentsService,
    private now = () => Date.now(),
    private verify: (response: any) => boolean = verifyQuoteSignature,
  ) {}
  get(identity: WalletIdentity, id: string): IntentsSwapOperation {
    const op = this.store.getRecord<IntentsSwapOperation>("intents-op:" + id);
    if (!op || op.owner !== subjectFor(identity))
      throw new IntentsError("Swap not found for this wallet.", 404);
    return op;
  }
  list(identity: WalletIdentity) {
    return this.store
      .records<IntentsSwapOperation>("intents-op:")
      .filter((o) => o.owner === subjectFor(identity))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 20);
  }
  save(op: IntentsSwapOperation) {
    this.store.putRecord("intents-op:" + op.id, op);
    return op;
  }
  async prepare(
    identity: WalletIdentity,
    input: {
      requestId: string;
      confidentiality?: "public" | "basic";
      originAsset: string;
      destinationAsset: string;
      amount: string;
      recipient: string;
      presetId?: string;
    },
  ) {
    if (
      input.confidentiality !== undefined &&
      !["public", "basic"].includes(input.confidentiality)
    )
      throw new IntentsError("Unsupported swap confidentiality mode.", 400);
    const confidentiality = input.confidentiality ?? "public";
    const owner = subjectFor(identity),
      previous = this.list(identity).find(
        (o) => o.requestId === input.requestId,
      );
    if (previous) {
      if (
        (previous.confidentiality ?? "public") !== confidentiality ||
        previous.origin.assetId !== input.originAsset ||
        previous.destination.assetId !== input.destinationAsset ||
        previous.recipient !== input.recipient ||
        previous.amountIn !== intentsAtomic(input.amount, previous.origin)
      )
        throw new IntentsError(
          "Request ID was already used for another swap.",
          409,
        );
      return previous;
    }
    if (this.inflight.has(owner))
      throw new IntentsError(
        "A quote is already being prepared for this wallet.",
        429,
      );
    if (
      this.list(identity).some(
        (o) =>
          !["success", "refunded", "funding_failed"].includes(o.phase) &&
          (intentsFundingPending(o) || Date.parse(o.fundBefore) > this.now()),
      )
    )
      throw new IntentsError(
        "Reconcile the existing swap before preparing another one.",
        409,
      );
    this.inflight.add(owner);
    try {
      const catalog = await this.provider.catalog(),
        origin = catalog.assets.find((a) => a.assetId === input.originAsset),
        destination = catalog.assets.find(
          (a) => a.assetId === input.destinationAsset,
        );
      if (!origin || !destination || origin.assetId === destination.assetId)
        throw new IntentsError(
          "Choose two different exact catalog assets.",
          400,
        );
      if (
        (origin.assetId === NEAR &&
          (origin.blockchain !== "near" ||
            origin.decimals !== 24 ||
            origin.contractAddress !== "wrap.near")) ||
        (origin.assetId === SOL &&
          (origin.blockchain !== "sol" ||
            origin.decimals !== 9 ||
            origin.contractAddress != null)) ||
        (origin.blockchain === "sol" &&
          origin.contractAddress === USDC &&
          (origin.decimals !== 6 ||
            origin.assetId !==
              "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near"))
      )
        throw new IntentsError(
          "Unexpected funding asset identity or precision. Nothing was sent.",
        );
      const allowed =
        identity.kind === "near"
          ? origin.assetId === NEAR
          : identity.kind === "phantom" &&
            origin.blockchain === "sol" &&
            (origin.assetId === SOL || origin.contractAddress === USDC);
      if (!allowed)
        throw new IntentsError(
          "Fund with native NEAR from a NEAR wallet, or SOL / Solana USDC from Phantom.",
          400,
        );
      if (
        !validChainAddress(origin.blockchain, identity.address) ||
        !validChainAddress(destination.blockchain, input.recipient)
      )
        throw new IntentsError(
          "Check the recipient address and destination chain.",
          400,
        );
      const amount = intentsAtomic(input.amount, origin),
        deadline = new Date(this.now() + 600000).toISOString();
      const payload = {
        dry: false,
        ...(confidentiality === "basic" ? { confidentiality: "basic" } : {}),
        swapType: "EXACT_INPUT",
        slippageTolerance: 100,
        originAsset: origin.assetId,
        destinationAsset: destination.assetId,
        depositType: "ORIGIN_CHAIN",
        recipientType: "DESTINATION_CHAIN",
        refundType: "ORIGIN_CHAIN",
        amount,
        refundTo: identity.address,
        recipient: input.recipient,
        deadline,
        depositMode: "SIMPLE",
      };
      const response = await this.provider.executableRequest("/quote", payload),
        q = response?.quote,
        echo = response?.quoteRequest;
      if (!response || !this.verify(response) || !q || !echo)
        throw new IntentsError(
          "Intents quote signature is invalid. Funding is disabled.",
        );
      for (const [key, value] of Object.entries(payload))
        if (echo[key] !== value)
          throw new IntentsError(
            "Intents changed the requested route. Funding is disabled.",
          );
      const fees = Array.isArray(echo.appFees) ? echo.appFees : [];
      if (
        fees.some(
          (f: any) => !Number.isInteger(f.fee) || f.fee < 0 || f.fee > 100,
        ) ||
        fees.reduce((sum: number, f: any) => sum + f.fee, 0) > 100 ||
        echo.insured === true ||
        (echo.confidentiality ?? "public") !== confidentiality ||
        echo.customRecipientMsg ||
        echo.virtualChainRecipient ||
        echo.virtualChainRefundRecipient
      )
        throw new IntentsError(
          "Unexpected quote fees or routing options. Funding is disabled.",
        );
      if (
        !validChainAddress(origin.blockchain, q.depositAddress) ||
        q.depositAddress === identity.address ||
        q.depositAddress === input.recipient ||
        q.depositMemo
      )
        throw new IntentsError(
          "Unsupported deposit address or memo. Nothing was sent.",
        );
      const times = [
        Date.parse(response.timestamp),
        Date.parse(q.deadline),
        Date.parse(q.timeWhenInactive),
      ];
      if (
        times.some((t) => !Number.isFinite(t)) ||
        Math.abs(this.now() - times[0]) > 120000 ||
        Math.min(times[1], times[2]) <= this.now() + 15000 ||
        q.amountIn !== amount ||
        !positive(q.amountOut) ||
        !positive(q.minAmountOut) ||
        BigInt(q.minAmountOut) > BigInt(q.amountOut)
      )
        throw new IntentsError(
          "Invalid or expired Intents quote. Nothing was sent.",
        );
      if (
        q.amountInUsd != null &&
        (!Number.isFinite(Number(q.amountInUsd)) || Number(q.amountInUsd) > 100)
      )
        throw new IntentsError(
          "This quote exceeds the public-release limit of $100. Choose a smaller amount.",
          400,
        );
      return this.save({
        id: randomUUID(),
        owner,
        requestId: input.requestId,
        confidentiality,
        ...(input.presetId ? { presetId: input.presetId } : {}),
        createdAt: new Date(this.now()).toISOString(),
        origin,
        destination,
        amountIn: amount,
        amountOut: q.amountOut,
        minAmountOut: q.minAmountOut,
        recipient: input.recipient,
        refundTo: identity.address,
        depositAddress: q.depositAddress,
        fundBefore: new Date(
          Math.min(
            this.now() + 60000,
            Date.parse(deadline),
            times[1],
            times[2],
          ),
        ).toISOString(),
        refundDeadline: q.deadline,
        quoteHash: quoteHash(response),
        quoteResponse: response,
        appFeeBps: fees.reduce((s: number, f: any) => s + f.fee, 0),
        phase: "prepared",
        providerStatus: "PENDING_DEPOSIT",
      });
    } finally {
      this.inflight.delete(owner);
    }
  }
  assertFundable(identity: WalletIdentity, id: string) {
    const op = this.get(identity, id);
    if (
      op.fundingSignature ||
      !["prepared", "awaiting_wallet"].includes(op.phase) ||
      Date.parse(op.fundBefore) <= this.now()
    )
      throw new IntentsError(
        "This quote cannot be funded again. Refresh its original status.",
        409,
      );
    if (
      (op.quoteResponse?.quoteRequest?.confidentiality ?? "public") !==
        (op.confidentiality ?? "public") ||
      !this.verify(op.quoteResponse) ||
      quoteHash(op.quoteResponse) !== op.quoteHash
    )
      throw new IntentsError("Stored quote no longer verifies.");
    return op;
  }
  async refresh(identity: WalletIdentity, id: string) {
    let op = this.get(identity, id);
    // Preserve approval ownership for records created before fundingRequestedAt
    // was introduced, before any provider response can replace their phase.
    if (op.phase === "awaiting_wallet" && !op.fundingRequestedAt) {
      op.fundingRequestedAt = op.createdAt;
      this.save(op);
    }
    if (this.now() - (this.lastPoll.get(id) ?? 0) < 7000) return op;
    if (this.lastPoll.size > 2000) {
      for (const [key, at] of this.lastPoll)
        if (this.now() - at > 60000) this.lastPoll.delete(key);
      if (this.lastPoll.size > 2000)
        this.lastPoll.delete(this.lastPoll.keys().next().value!);
    }
    this.lastPoll.set(id, this.now());
    try {
      const result = await this.provider.executableRequest(
        `/status?${new URLSearchParams({ depositAddress: op.depositAddress })}`,
      );
      op = this.get(identity, id);
      if (
        (result?.quoteResponse?.quoteRequest?.confidentiality ?? "public") !==
          (op.confidentiality ?? "public") ||
        !result?.quoteResponse ||
        !this.verify(result.quoteResponse) ||
        quoteHash(result.quoteResponse) !== op.quoteHash
      )
        throw new IntentsError(
          "Status does not match the signed original swap.",
        );
      if (
        ![
          "KNOWN_DEPOSIT_TX",
          "PENDING_DEPOSIT",
          "INCOMPLETE_DEPOSIT",
          "PROCESSING",
          "SUCCESS",
          "REFUNDED",
          "FAILED",
        ].includes(result.status)
      )
        throw new IntentsError(
          "Unknown Intents status. Check again before taking action.",
        );
      // Completed records are durable receipts. A lagging provider must not
      // turn a completed swap back into a fundable quote.
      if (["success", "refunded", "funding_failed"].includes(op.phase))
        return op;
      op.providerStatus = result.status;
      // A pending provider read must never erase a submitted/uncertain funding attempt.
      if (
        result.status !== "PENDING_DEPOSIT" ||
        (!op.fundingSignature && op.phase !== "awaiting_wallet")
      )
        op.phase = intentsPhase(result.status);
      op.swapDetails = result.swapDetails ?? null;
      op.error =
        result.status === "INCOMPLETE_DEPOSIT"
          ? "Deposit is incomplete. Do not automatically top up or fund again."
          : result.status === "FAILED"
            ? "Provider reports failure. A refund is not yet confirmed."
            : undefined;
      return this.save(op);
    } catch (e) {
      op = this.get(identity, id);
      op.error =
        e instanceof Error
          ? e.message
          : "Status unavailable. Keep the original swap.";
      return this.save(op);
    }
  }
  async notify(identity: WalletIdentity, id: string, txHash: string) {
    const op = this.get(identity, id);
    if (op.fundingSignature && op.fundingSignature !== txHash)
      throw new IntentsError(
        "A different deposit transaction is already recorded.",
        409,
      );
    op.fundingSignature = txHash;
    if (!["success", "refunded", "funding_failed"].includes(op.phase))
      op.phase = "deposit_submitted";
    this.save(op);
    try {
      await this.provider.executableRequest("/deposit/submit", {
        txHash,
        depositAddress: op.depositAddress,
        ...(op.origin.blockchain === "near"
          ? { nearSenderAccount: identity.address }
          : {}),
      });
    } catch {
      const current = this.get(identity, id);
      current.error =
        "Deposit notification is unavailable. Check the original swap; do not send again.";
      this.save(current);
    }
    return this.get(identity, id);
  }
}
