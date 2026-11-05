import { protocolFeeSplit } from "../../../../packages/shared/src/protocol-fee.ts";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { Account, JsonRpcProvider } from "near-api-js";
import {
  Connection,
  PublicKey,
  Message,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { MarketStore } from "../market/store.ts";
import { MarketService } from "../market/service.ts";
import type { DemoMarket } from "./cpmm.ts";
import { verifyAndQuote } from "./cpmm.ts";
import {
  NEAR_RPC,
  DEVNET_RPC,
  SECONDARY_DEVNET_RPC,
  devnetConnection,
  secondaryDevnetConnection,
  assertDevnetGenesis,
} from "./network.ts";
import { nearView, setupSession } from "./setup.ts";
import { clientMessage, UserError } from "../client-message.ts";
import {
  canonicalSwapMessage,
  manifestBytes,
  proximityBytes,
  quoteBytes,
  degenAmountFromSeed,
} from "./policy-wire.ts";
import { DEGEN_ODDS_VERSION } from "../../../../packages/shared/src/degen-amount.ts";
import { operatorPaths, type ExecutionPaths } from "./paths.ts";
import { Outbox, expiryDecision, type RpcObservation } from "./outbox.ts";
const digest = (x: Uint8Array | string) =>
  createHash("sha256").update(x).digest("hex");
const terminal = new Set([
  "finalized_success",
  "finalized_failure",
  "expired",
  "signing_failed",
  "selection_failed",
  "failed_near",
]);
export class ExecutionService {
  private provider = new JsonRpcProvider({ url: NEAR_RPC });
  private rpc = devnetConnection();
  private secondary = secondaryDevnetConnection();
  private box: Outbox;
  private config: any = null;
  private privateConfig: any = null;
  private scoped: Account | null = null;
  private settler: Account | null = null;
  private chain: any = null;
  private op: any;
  private processing = false;
  private ticking = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<() => void>();
  private error: string | null = null;
  private policyCodeVerified = false;
  private policyCheckedAt = 0;
  private cash: string | null = null;
  private quotes = new Map<number, any>();
  private lastBalance = 0;
  constructor(
    private store: MarketStore,
    private markets: Pick<
      MarketService,
      "snapshot" | "ticketSize" | "revalidateSelected" | "settleForExecution"
    >,
    private paths: ExecutionPaths = operatorPaths,
  ) {
    this.box = new Outbox(store);
    this.op = store.getRecord("execution-current");
    if (
      this.op &&
      [
        "drawing",
        "selected",
        "checking_source",
        "quoting_exit",
        "authorizing",
      ].includes(this.op.phase)
    ) {
      this.op.phase = "unknown";
      this.op.error =
        "Interrupted request: reconciling the original operation.";
      this.persist();
    }
  }
  private loadConfig() {
    if (
      !existsSync(this.paths.publicConfig) ||
      !existsSync(this.paths.privateConfig)
    )
      return false;
    this.config = JSON.parse(readFileSync(this.paths.publicConfig, "utf8"));
    this.privateConfig = JSON.parse(
      readFileSync(this.paths.privateConfig, "utf8"),
    );
    this.scoped = new Account(
      this.config.ownerAccount,
      this.provider,
      this.privateConfig.sessionSecret,
    );
    this.settler = new Account(
      this.config.settlerAccount,
      this.provider,
      this.privateConfig.settlerSecret,
    );
    return true;
  }
  private async refresh() {
    if (!this.config && !this.loadConfig()) return;
    try {
      const network: any = await this.provider.sendJsonRpc("status", []);
      if (network.chain_id !== "testnet")
        throw new UserError("NEAR RPC is not testnet");
      const account: any = await this.provider.query({
        request_type: "view_account",
        account_id: this.config.contractId,
        finality: "final",
      });
      if (
        account.code_hash !==
        bs58.encode(Buffer.from(this.config.wasmSha256, "hex"))
      )
        throw new UserError(
          "Deployed policy code changed. Execution is paused for verification.",
        );
      this.chain = await nearView(
        this.provider,
        this.config.contractId,
        "get_state",
      );
      if (
        this.config.mappingHash &&
        this.chain.mapping_hash !== this.config.mappingHash
      )
        throw new UserError("Pinned market mapping changed");
      const feePolicy = this.chain.fee_policy;
      if (
        feePolicy &&
        (feePolicy.version !== "usdc-entry-v1" ||
          feePolicy.fee_bps !== 50 ||
          feePolicy.vault_ata !== this.config.feeVaultAta)
      )
        throw new UserError("Pinned fee policy mismatch");
      if (this.config.feeVaultAta && !feePolicy)
        throw new UserError(
          "Fee vault configured but policy contract does not collect fees",
        );
      this.policyCodeVerified = true;
      this.policyCheckedAt = Date.now();
      this.error = null;
    } catch (e) {
      this.policyCodeVerified = false;
      throw e;
    }
  }
  private persist() {
    if (this.op) {
      this.op.timeline ??= [];
      if (this.op.timeline.at(-1)?.phase !== this.op.phase)
        this.op.timeline.push({ phase: this.op.phase, at: Date.now() });
      this.op.updatedAt = new Date().toISOString();
      this.store.putRecord("op:" + this.op.id, this.op);
      this.store.putRecord("execution-current", this.op);
    }
    for (const listener of this.listeners) listener();
  }
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private locked() {
    return (
      !!this.op &&
      !terminal.has(this.op.phase) &&
      this.op.phase !== "awaiting_confirmation"
    );
  }
  snapshot() {
    const session = this.chain?.session ?? null,
      positions = this.positions(),
      verified = this.verified();
    const operation = this.op ? { ...this.op } : null;
    if (
      operation?.solanaSignature &&
      !operation.fillEvidence &&
      ["finalized_success", "finalized_failure"].includes(operation.phase)
    ) {
      const fill = this.store.getRecord<any>(
        "fill:" + operation.solanaSignature,
      );
      if (
        fill &&
        fill.session === operation.session &&
        fill.drawId === operation.draw?.id &&
        fill.marketIndex === operation.marketIndex
      )
        operation.fillEvidence = {
          signature: fill.signature,
          success: fill.success,
          slot: fill.slot,
          input: fill.input,
          output: fill.output,
          fee: fill.fee,
          ...(fill.protocolFee ? { protocolFee: fill.protocolFee } : {}),
          evidenceHash: fill.evidenceHash,
        };
    }
    return {
      mode: "dedicated-local-test-wallet",
      verified,
      ready:
        verified &&
        !!session &&
        !session.pending &&
        !session.revoked &&
        BigInt(session.issued) + BigInt(this.markets.ticketSize()) <=
          100000000n &&
        Number(session.expires_ms) > Date.now() &&
        !this.locked() &&
        !this.processing,
      busy: this.processing || this.locked(),
      maxBuyAtomic: "100000000",
      sessionLimitAtomic: "100000000",
      fullDegenReady:
        verified &&
        !!session &&
        this.chain?.policy_version === DEGEN_ODDS_VERSION &&
        !session.pending &&
        !session.revoked &&
        Number(session.expires_ms) > Date.now() &&
        session.issued === "0" &&
        this.cash !== null &&
        BigInt(this.cash) >= 100000000n &&
        !this.locked() &&
        !this.processing,
      phase:
        this.processing && !this.op
          ? "activating"
          : (this.op?.phase ?? (session ? "active" : "setup")),
      session,
      cashAtomic: this.cash,
      protocolFee: this.chain?.fee_policy ?? null,
      contractId: this.config?.contractId ?? null,
      ownerAccount: this.config?.ownerAccount ?? null,
      markets: this.config?.markets ?? [],
      positions,
      operation,
      error: this.error,
      remainingAuthorizedAtomic: session
        ? String(100000000n - BigInt(session.issued))
        : null,
      receipts: this.store
        .records<any>("fill:")
        .sort((a, b) => b.slot - a.slot)
        .slice(0, 20),
    };
  }
  private verified() {
    try {
      const p = JSON.parse(readFileSync(this.paths.proof, "utf8"));
      return (
        p.buyFinalized === true &&
        p.sellFinalized === true &&
        p.contractId === this.config?.contractId &&
        p.wasmSha256 === this.config?.wasmSha256 &&
        this.policyCodeVerified &&
        Date.now() - this.policyCheckedAt < 30000
      );
    } catch {
      return false;
    }
  }
  private positions() {
    if (!this.config) return [];
    const fills = this.store
        .records<any>("fill:")
        .sort((a, b) => a.slot - b.slot),
      session = this.chain?.session;
    if (!session) return [];
    return this.config.markets
      .map((m: DemoMarket, i: number) => {
        let cost = 0n,
          owned = 0n,
          sources: any[] = [];
        for (const f of fills.filter(
          (f) => f.session === session.id && f.marketIndex === i && f.success,
        )) {
          if (f.buy) {
            cost += BigInt(f.input);
            owned += BigInt(f.output);
            sources.push(f.source);
          } else {
            if (BigInt(f.input) === owned) {
              cost = 0n;
              owned = 0n;
              sources = [];
            } else {
              // Retain only the acquisition cost of the remaining quantity.
              // Sale proceeds are not the remaining position's cost basis.
              cost =
                owned > 0n ? (cost * (owned - BigInt(f.input))) / owned : 0n;
              owned -= BigInt(f.input);
            }
          }
        }
        const quantity = BigInt(session.balances[i]),
          quote = this.quotes.get(i),
          known = owned === quantity;
        return {
          marketIndex: i,
          market: m,
          quantityAtomic: quantity.toString(),
          costAtomic: known ? cost.toString() : null,
          exitQuoteAtomic: quote?.output?.toString() ?? null,
          price: quote
            ? Number(quote.reserveUsdc) / Number(quote.reserveToken)
            : null,
          quoteAt: quote?.observedAt ?? null,
          history:
            this.store.getRecord<any[]>("history:" + session.id + ":" + i) ??
            [],
          sources,
          drawId:
            [...fills]
              .reverse()
              .find(
                (f) =>
                  f.session === session.id &&
                  f.marketIndex === i &&
                  f.buy &&
                  f.success,
              )?.drawId ?? null,
        };
      })
      .filter((p: any) => BigInt(p.quantityAtomic) > 0n);
  }
  async activate() {
    if (this.processing || this.locked())
      throw new UserError("Resolve the current operation before activation");
    this.processing = true;
    this.error = null;
    this.persist();
    try {
      await setupSession(true, this.paths);
      this.loadConfig();
      await this.refresh();
      this.op = null;
      this.store.putRecord("execution-current", null);
      await this.refreshBalances();
      this.persist();
      return this.snapshot();
    } catch (e) {
      this.error = this.message(e);
      throw e;
    } finally {
      this.processing = false;
      this.persist();
    }
  }
  async draw(rollId: string, mode: "auto" | "reveal", probe = false) {
    if (this.processing || this.locked())
      throw new UserError("A previous operation remains unresolved");
    if (!this.verified() && !probe)
      throw new UserError("End-to-end test gate not passed");
    await this.refresh();
    if (this.processing || this.locked())
      throw new UserError("A concurrent operation was accepted first");
    const session = this.chain?.session;
    if (!session || session.revoked || Number(session.expires_ms) <= Date.now())
      throw new UserError("Activate a fresh bounded test session");
    if (session.pending)
      throw new UserError("NEAR still has an unresolved attempt");
    // The winner comes from the committed roll, never from the caller. Re-settling
    // here re-checks the frozen field, so preview and buy can never diverge.
    const settled = this.markets.settleForExecution(rollId),
      snapshot = settled.snapshot,
      preview = settled.preview,
      amountMode = settled.roll.amountMode;
    if (
      snapshot.filters.chains?.some((chain) => chain !== "solana") ||
      snapshot.pool.some((t) => t.chain && t.chain !== "solana")
    )
      throw new UserError(
        "Non-Solana and mixed-chain pools are preview-only. Choose Solana only for test execution.",
      );
    if (snapshot.pool.length < 2)
      throw new UserError("Two fresh, two-way quoted tokens are required");
    if (amountMode === "full_degen") {
      if (this.chain.policy_version !== DEGEN_ODDS_VERSION)
        throw new UserError("Full degen policy update is not deployed");
      if (BigInt(session.issued) !== 0n)
        throw new UserError(
          "Full degen requires 100 unused demo USDC authorization",
        );
      if (this.cash === null || BigInt(this.cash) < 100000000n)
        throw new UserError(
          "Full degen requires 100 demo USDC in the test account",
        );
    } else if (!this.chain.selection_modes?.includes("proximity-v1")) {
      // A committed winner is only trustworthy if the deployed contract records
      // it; without this policy the roll could not be attested on-chain.
      throw new UserError(
        "Committed-roll policy is not deployed on this test account yet",
      );
    }
    if (BigInt(session.issued) + BigInt(preview.ticketAtomic) > 100000000n)
      throw new UserError(
        "The chosen ticket exceeds the remaining session authorization",
      );
    this.processing = true;
    // Only a fixed-amount Lottery draw can carry the committed winner to the
    // deployed contract; Full Degen is drawn by the contract itself, so nothing
    // about its outcome may be asserted as attested.
    const committed = amountMode !== "full_degen";
    this.op = {
      id: randomUUID(),
      phase: "drawing",
      mode,
      amountMode,
      committed,
      rollId: preview.id,
      commitment: committed ? preview.commitment : null,
      seed: preview.seed,
      selectedMint: committed ? preview.selected.mint : null,
      // Kept as the wire label the deployed contract reports for this policy.
      selectionPolicy: committed ? "proximity-v1" : "contract-drawn-v1",
      amount: committed ? preview.ticketAtomic : null,
      manifest: {
        pool: structuredClone(preview.pool),
        filters: structuredClone(snapshot.filters),
        configurationHash: snapshot.configurationHash,
        createdAt: Date.now(),
      },
      expectedDraw: this.chain.next_draw,
      session: session.id,
      createdAt: new Date().toISOString(),
      nearTransactions: [],
    };
    this.persist();
    void this.runDraw().finally(() => {
      this.processing = false;
      this.persist();
    });
    return this.snapshot();
  }
  private async runDraw() {
    try {
      const op = this.op,
        session = this.chain.session,
        created = String(op.manifest.createdAt),
        mints = op.manifest.pool.map((t: any) => t.mint),
        bytes = manifestBytes(
          session.id,
          created,
          op.manifest.configurationHash,
          mints,
        ),
        signature = Array.from(
          nacl.sign.detached(
            bytes,
            Uint8Array.from(this.privateConfig.quoteSecret),
          ),
        );
      // The roll commitment is what the contract records in place of the old
      // browser release payload: it binds this draw to a winner nobody could
      // choose after seeing the field.
      const committed = op.committed === true,
        releaseHash = committed ? op.commitment : null,
        selectedMint = committed ? op.selectedMint : null;
      const proximitySignature =
        selectedMint && releaseHash
          ? Array.from(
              nacl.sign.detached(
                proximityBytes(bytes, selectedMint, releaseHash),
                Uint8Array.from(this.privateConfig.quoteSecret),
              ),
            )
          : null;
      const tx = await this.scoped!.callFunctionRaw({
        contractId: this.config.contractId,
        methodName: committed
          ? "begin_proximity_draw"
          : op.amountMode === "full_degen"
            ? "begin_degen_draw"
            : "begin_draw",
        args: {
          mints,
          configuration_hash: op.manifest.configurationHash,
          created_ms: created,
          manifest_signature: signature,
          ...(committed
            ? {
                selected_mint: selectedMint,
                release_hash: releaseHash,
                selection_signature: proximitySignature,
              }
            : {}),
        },
        gas: 50000000000000n,
        waitUntil: "FINAL",
      });
      op.nearTransactions.push({ stage: "draw", hash: tx.transaction.hash });
      op.draw = await nearView(
        this.provider,
        this.config.contractId,
        "get_draw",
        { draw_id: op.expectedDraw },
      );
      if (
        committed &&
        (op.draw.selection_policy !== "proximity-v1" ||
          op.draw.release_hash !== releaseHash ||
          op.draw.source_mint !== selectedMint)
      )
        throw new UserError(
          "NEAR proximity receipt does not match the attested release",
        );
      this.adoptDrawAmount(op);
      op.source = op.manifest.pool.find(
        (t: any) => t.mint === op.draw.source_mint,
      );
      if (!op.source)
        throw new UserError(
          "Contract selected a source outside the frozen manifest",
        );
      op.marketIndex = op.draw.market_index;
      op.phase =
        op.mode === "reveal" || op.amountMode === "full_degen"
          ? "awaiting_confirmation"
          : "selected";
      this.persist();
      if (op.mode === "auto" && op.amountMode !== "full_degen")
        await this.authorize(true);
    } catch (e) {
      this.op.phase = (e as any)?.transactionResult?.status?.Failure
        ? "failed_near"
        : "unknown";
      this.op.error = this.message(e);
      this.persist();
    }
  }
  private adoptDrawAmount(op: any) {
    if (op.amountMode !== "full_degen") return;
    if (
      op.draw?.amount_mode !== "full_degen" ||
      op.draw.amount_odds_version !== DEGEN_ODDS_VERSION ||
      op.draw.amount !== degenAmountFromSeed(op.draw.selection_seed)
    )
      throw new UserError(
        "Contract amount does not match published Full degen odds",
      );
    op.amount = op.draw.amount;
  }
  async confirm(id: string) {
    if (
      this.processing ||
      this.op?.id !== id ||
      !["awaiting_confirmation", "selection_failed"].includes(this.op.phase)
    )
      throw new UserError("No selected draw is awaiting confirmation");
    this.processing = true;
    void this.authorize(this.op.buy !== false).finally(() => {
      this.processing = false;
      this.persist();
    });
    return this.snapshot();
  }
  async retry(id: string) {
    if (
      this.processing ||
      this.op?.id !== id ||
      !["expired", "signing_failed", "finalized_failure"].includes(
        this.op.phase,
      )
    )
      throw new UserError(
        "Retry requires a definitively reconciled failed attempt",
      );
    await this.refresh();
    if (this.processing || this.locked())
      throw new UserError("A concurrent operation was accepted first");
    if (this.chain.session.pending)
      throw new UserError("NEAR pending lock is still set");
    this.processing = true;
    this.op.previousAttempts = [
      ...(this.op.previousAttempts ?? []),
      this.op.attemptId,
    ];
    void this.authorize(this.op.buy !== false).finally(() => {
      this.processing = false;
      this.persist();
    });
    return this.snapshot();
  }
  async exit(marketIndex: number, amountAtomic?: string) {
    if (this.processing || this.locked())
      throw new UserError("Resolve the current operation before exiting");
    await this.refresh();
    if (this.processing || this.locked())
      throw new UserError("A concurrent operation was accepted first");
    const position = this.positions().find(
      (p: any) => p.marketIndex === marketIndex,
    );
    if (!position?.drawId || !this.chain.session || this.chain.session.pending)
      throw new UserError("No reconciled position available");
    const amount = amountAtomic ?? position.quantityAtomic;
    if (
      !/^[1-9]\d{0,19}$/.test(amount) ||
      BigInt(amount) > BigInt(position.quantityAtomic)
    )
      throw new UserError(
        "Choose an amount within the reconciled position balance",
      );
    const draw = await nearView(
      this.provider,
      this.config.contractId,
      "get_draw",
      { draw_id: position.drawId },
    );
    if (this.processing || this.locked())
      throw new UserError("A concurrent operation was accepted first");
    this.processing = true;
    this.op = {
      id: randomUUID(),
      phase: "selected",
      buy: false,
      mode: "exit",
      session: this.chain.session.id,
      draw,
      source: position.sources.at(-1) ?? {
        mint: draw.source_mint,
        symbol: "Source token",
      },
      sources: position.sources,
      marketIndex,
      amount,
      createdAt: new Date().toISOString(),
      nearTransactions: [],
    };
    this.persist();
    void this.authorize(false).finally(() => {
      this.processing = false;
      this.persist();
    });
    return this.snapshot();
  }
  private async authorize(buy: boolean) {
    const op = this.op;
    try {
      op.buy = buy;
      delete op.attemptId;
      delete op.attempt;
      delete op.checkEvidence;
      delete op.verification;
      delete op.broadcastEvidence;
      delete op.fillEvidence;
      op.error = null;
      op.phase = buy ? "checking_source" : "quoting_exit";
      this.persist();
      await this.refresh();
      const session = this.chain.session;
      if (!session || session.id !== op.session || session.pending)
        throw new UserError("Session changed or an operation is pending");
      const m = this.config.markets[op.marketIndex] as DemoMarket;
      // Independent read-only checks run together after the session read, so
      // slow RPCs do not consume the source's entire authorization window.
      const [sourceCheck, { q, block }] = await Promise.all([
        buy
          ? this.markets.revalidateSelected(
              op.source.mint,
              op.amount,
              op.manifest.filters,
            )
          : Promise.resolve(null),
        (async () => ({
          q: await verifyAndQuote(
            this.rpc,
            m,
            buy,
            BigInt(
              buy && this.config.feeVaultAta
                ? protocolFeeSplit(op.amount).principalAtomic
                : op.amount,
            ),
          ),
          block: await this.rpc.getLatestBlockhash("finalized"),
        }))(),
      ]);
      const expires = String(Date.now() + 15000),
        aid = this.chain.next_attempt;
      const bytes = quoteBytes({
        session: session.id,
        attempt: aid,
        draw: op.draw,
        buy,
        amount: op.amount,
        minOut: q.minOut.toString(),
        blockhash: block.blockhash,
        lastValid: String(block.lastValidBlockHeight),
        slot: String(q.slot),
        expires,
        mappingHash: this.chain.mapping_hash,
      });
      if (
        sourceCheck &&
        (Date.now() - Date.parse(sourceCheck.token.sourceUpdatedAt!) > 15000 ||
          Date.now() -
            Math.min(
              sourceCheck.pair.buy!.observedAt,
              sourceCheck.pair.sell!.observedAt,
            ) >
            15000)
      )
        throw new UserError(
          "Selected source check aged out before authorization. No signature was requested.",
        );
      op.checkEvidence = {
        attemptId: aid,
        checkedAt: new Date().toISOString(),
        sourceMint: op.source?.mint,
        sourceUpdatedAt: sourceCheck?.token.sourceUpdatedAt ?? null,
        sourceBuyObservedAt: sourceCheck?.pair.buy?.observedAt ?? null,
        sourceSellObservedAt: sourceCheck?.pair.sell?.observedAt ?? null,
        riskProvider: sourceCheck?.token.security?.source ?? null,
        riskStatus: sourceCheck?.token.security?.status ?? null,
        amountAtomic: op.amount,
        minimumOutputAtomic: q.minOut.toString(),
        observedDevnetSlot: q.slot,
        quoteExpiresMs: expires,
      };
      op.attemptId = aid;
      op.phase = "authorizing";
      op.quote = {
        minOut: q.minOut.toString(),
        blockhash: block.blockhash,
        lastValid: block.lastValidBlockHeight,
        slot: q.slot,
        expires,
      };
      this.persist();
      let outcome: any;
      try {
        outcome = await this.scoped!.callFunctionRaw({
          contractId: this.config.contractId,
          methodName: buy ? "authorize_attempt" : "request_exit",
          args: {
            draw_id: op.draw.id,
            expected_attempt: aid,
            amount: op.amount,
            min_out: q.minOut.toString(),
            blockhash: block.blockhash,
            last_valid: String(block.lastValidBlockHeight),
            observed_slot: String(q.slot),
            quote_expires_ms: expires,
            quote_signature: Array.from(
              nacl.sign.detached(
                bytes,
                Uint8Array.from(this.privateConfig.quoteSecret),
              ),
            ),
          },
          gas: 200000000000000n,
          waitUntil: "FINAL",
        });
        op.nearTransactions.push({
          stage: buy ? "authorize buy" : "authorize exit",
          hash: outcome.transaction.hash,
        });
      } catch (e) {
        await this.refresh();
        if (BigInt(this.chain.next_attempt) <= BigInt(aid)) {
          if ((e as any)?.transactionResult?.status?.Failure) {
            op.phase = "failed_near";
            op.error = this.message(e);
            this.persist();
            return;
          }
          throw e;
        }
      }
      const a = await nearView(
        this.provider,
        this.config.contractId,
        "get_attempt",
        { attempt_id: aid },
      );
      await this.acceptAttempt(a);
    } catch (e) {
      op.phase = op.attemptId ? "unknown" : "selection_failed";
      op.error = this.message(e);
      this.persist();
    }
  }
  private async acceptAttempt(a: any) {
    const op = this.op;
    if (a.status === "signing_failed") {
      op.phase = "signing_failed";
      op.error = "MPC signing failed. Authorization remains consumed.";
      this.persist();
      return;
    }
    if (a.status === "signing") {
      op.phase = "signing";
      this.persist();
      return;
    }
    if (a.status !== "signed") return;
    const session = this.chain.session,
      m = this.config.markets[a.market_index],
      bytes = Buffer.from(a.message_hex, "hex"),
      signature = bs58.decode(a.signature),
      expected = canonicalSwapMessage(
        m,
        session.source,
        session.usdc_ata,
        session.token_atas[a.market_index],
        a.buy,
        a.amount,
        a.min_out,
        a.blockhash,
        this.config.feeVaultAta,
      );
    if (
      !bytes.equals(expected) ||
      digest(bytes) !== a.message_hash ||
      !nacl.sign.detached.verify(
        bytes,
        signature,
        new PublicKey(session.source).toBytes(),
      )
    )
      throw new UserError(
        "Issued signature/message failed independent policy verification",
      );
    op.verification = {
      attemptId: a.id,
      verifiedAt: new Date().toISOString(),
      messageHash: a.message_hash,
      signature: a.signature,
      signer: session.source,
      signatureVerified: true,
      messageMatchesPolicy: true,
    };
    const tx = new VersionedTransaction(Message.from(bytes));
    tx.signatures = [signature];
    this.box.save(a.id, {
      wire: Buffer.from(tx.serialize()).toString("base64"),
      signature: a.signature,
      messageHash: a.message_hash,
    });
    op.attempt = a;
    op.phase = "signed";
    this.persist();
    const row = await this.box.relay(a.id, async (wire) => {
      assertDevnetGenesis(await this.rpc.getGenesisHash());
      return this.rpc.sendRawTransaction(wire, {
        skipPreflight: false,
        maxRetries: 0,
      });
    });
    op.broadcastEvidence = {
      attemptId: a.id,
      signature: row.signature,
      messageHash: row.messageHash,
      state: row.state,
      broadcasts: row.broadcasts,
      lastBroadcast: row.lastBroadcast,
      error: row.error ?? null,
    };
    op.phase = row.state;
    op.solanaSignature = a.signature;
    if (row.error) op.error = row.error;
    this.persist();
  }
  private async reconcile(a: any) {
    const op = this.op;
    if (a.signature) op.solanaSignature = a.signature;
    if (
      [
        "finalized_success",
        "finalized_failure",
        "expired",
        "signing_failed",
      ].includes(a.status)
    ) {
      if (a.status.startsWith("finalized_") && a.signature)
        await this.captureFill(a);
      if (a.status.startsWith("finalized_")) await this.refreshBalances();
      op.phase = a.status;
      op.error = null;
      op.attempt = a;
      this.persist();
      return;
    }
    if (a.status !== "signed") {
      op.phase = "signing";
      this.persist();
      return;
    }
    if (!this.box.read(a.id)) {
      await this.acceptAttempt(a);
      return;
    }
    const status = (
      await this.rpc.getSignatureStatuses([a.signature], {
        searchTransactionHistory: true,
      })
    ).value[0];
    if (status?.confirmationStatus === "finalized") {
      const fill = await this.readFill(a);
      if (!fill) return;
      const outcome = fill.success ? "finalized_success" : "finalized_failure";
      op.phase = "settling";
      this.persist();
      const tx = await this.settler!.callFunctionRaw({
        contractId: this.config.contractId,
        methodName: "reconcile_attempt",
        args: {
          attempt_id: a.id,
          outcome,
          message_hash: a.message_hash,
          signature: a.signature,
          input: fill.input,
          output: fill.output,
          fee: fill.fee,
          evidence: fill.evidenceHash,
        },
        gas: 50000000000000n,
        waitUntil: "FINAL",
      });
      op.nearTransactions.push({
        stage: "settlement",
        hash: tx.transaction.hash,
      });
      await this.captureFill({ ...a, status: outcome }, fill);
      op.attempt = await nearView(
        this.provider,
        this.config.contractId,
        "get_attempt",
        { attempt_id: a.id },
      );
      await this.refresh();
      await this.refreshBalances();
      // Publish the success handoff only when the corresponding position/cash
      // snapshot is ready; opening Portfolio must not briefly show no holdings.
      op.phase = outcome;
      this.persist();
      return;
    }
    if (status) {
      op.phase = "confirming";
      this.persist();
      return;
    }
    const height = await this.rpc.getBlockHeight("finalized");
    if (height > a.last_valid) {
      const observations: RpcObservation[] = [
        {
          url: DEVNET_RPC,
          healthy: true,
          genesisValid: true,
          height,
          status: null,
        },
      ];
      try {
        assertDevnetGenesis(await this.secondary.getGenesisHash());
        const secondStatus = (
            await this.secondary.getSignatureStatuses([a.signature], {
              searchTransactionHistory: true,
            })
          ).value[0],
          secondHeight = await this.secondary.getBlockHeight("finalized");
        observations.push({
          url: SECONDARY_DEVNET_RPC,
          healthy: true,
          genesisValid: true,
          height: secondHeight,
          status: secondStatus,
        });
      } catch (e) {
        op.error =
          "Awaiting a second healthy RPC before expiry reconciliation: " +
          this.message(e);
      }
      if (expiryDecision(Number(a.last_valid), observations) === "expired") {
        const tx = await this.settler!.callFunctionRaw({
          contractId: this.config.contractId,
          methodName: "reconcile_attempt",
          args: {
            attempt_id: a.id,
            outcome: "expired",
            message_hash: a.message_hash,
            signature: a.signature,
            input: "0",
            output: "0",
            fee: "0",
            evidence: digest(JSON.stringify(observations)),
          },
          gas: 50000000000000n,
          waitUntil: "FINAL",
        });
        op.nearTransactions.push({
          stage: "expiry reconciliation",
          hash: tx.transaction.hash,
        });
        op.phase = "expired";
        op.error = null;
        this.persist();
        await this.refresh();
        return;
      }
      op.phase = "unknown";
      this.persist();
      return;
    }
    const row = this.box.read(a.id)!;
    if (Date.now() - row.lastBroadcast > 10000) {
      const r = await this.box.relay(a.id, async (wire) => {
        assertDevnetGenesis(await this.rpc.getGenesisHash());
        return this.rpc.sendRawTransaction(wire, {
          skipPreflight: false,
          maxRetries: 0,
        });
      });
      op.broadcastEvidence = {
        attemptId: a.id,
        signature: r.signature,
        messageHash: r.messageHash,
        state: r.state,
        broadcasts: r.broadcasts,
        lastBroadcast: r.lastBroadcast,
        error: r.error ?? null,
      };
      op.phase = r.state;
      if (r.error) op.error = r.error;
      this.persist();
    }
  }
  private async readFill(a: any) {
    const tx = await this.rpc.getTransaction(a.signature, {
      commitment: "finalized",
      maxSupportedTransactionVersion: 0,
    });
    if (!tx?.meta) return null;
    if (digest(tx.transaction.message.serialize()) !== a.message_hash)
      throw new UserError("Finalized transaction has an unexpected message");
    const source = this.chain.session.source,
      m = this.config.markets[a.market_index],
      delta = (mint: string) => {
        const sum = (rows: any[] | null | undefined) =>
          rows
            ?.filter((b) => b.owner === source && b.mint === mint)
            .reduce((n, b) => n + BigInt(b.uiTokenAmount.amount), 0n) ?? 0n;
        return sum(tx.meta!.postTokenBalances) - sum(tx.meta!.preTokenBalances);
      },
      input = tx.meta.err ? 0n : -delta(a.buy ? m.mintUsdc : m.mintToken),
      output = tx.meta.err ? 0n : delta(a.buy ? m.mintToken : m.mintUsdc);
    if (
      !tx.meta.err &&
      (input !== BigInt(a.amount) || output < BigInt(a.min_out))
    )
      throw new UserError(
        "Finalized token deltas differ from the authorized intent",
      );
    const protocolFee =
      a.buy && this.config.feeVaultAta && !tx.meta.err
        ? protocolFeeSplit(a.amount)
        : null;
    if (protocolFee) {
      const keys = tx.transaction.message.getAccountKeys().staticAccountKeys;
      const vaultIndex = keys.findIndex(
        (k) => k.toBase58() === this.config.feeVaultAta,
      );
      const balance = (rows: any[] | null | undefined) =>
        rows?.find(
          (b) => b.accountIndex === vaultIndex && b.mint === m.mintUsdc,
        )?.uiTokenAmount.amount ?? "0";
      if (
        vaultIndex < 0 ||
        BigInt(balance(tx.meta.postTokenBalances)) -
          BigInt(balance(tx.meta.preTokenBalances)) !==
          BigInt(protocolFee.feeAtomic)
      )
        throw new UserError(
          "Finalized protocol fee does not match the configured vault",
        );
    }
    return {
      protocolFee: protocolFee
        ? {
            ...protocolFee,
            vaultAta: this.config.feeVaultAta,
            chain: "solana-devnet",
          }
        : null,
      input: input.toString(),
      output: output.toString(),
      fee: String(tx.meta.fee),
      slot: tx.slot,
      success: !tx.meta.err,
      evidenceHash: digest(
        JSON.stringify({
          signature: a.signature,
          slot: tx.slot,
          meta: tx.meta,
        }),
      ),
    };
  }
  private async captureFill(a: any, supplied?: any) {
    const prior = this.store.getRecord<any>("fill:" + a.signature);
    if (prior) {
      this.op.fillEvidence = {
        signature: prior.signature,
        success: prior.success,
        slot: prior.slot,
        input: prior.input,
        output: prior.output,
        fee: prior.fee,
        ...(prior.protocolFee ? { protocolFee: prior.protocolFee } : {}),
        evidenceHash: prior.evidenceHash,
      };
      return;
    }
    const f = supplied ?? (await this.readFill(a));
    if (!f) return;
    this.op.fillEvidence = {
      signature: a.signature,
      success: f.success,
      slot: f.slot,
      input: f.input,
      output: f.output,
      fee: f.fee,
      ...(f.protocolFee ? { protocolFee: f.protocolFee } : {}),
      evidenceHash: f.evidenceHash,
    };

    const position = this.positions().find(
      (p: any) => p.marketIndex === a.market_index,
    );
    this.store.putRecord("fill:" + a.signature, {
      ...f,
      signature: a.signature,
      session: a.session,
      drawId: a.draw,
      marketIndex: a.market_index,
      buy: a.buy,
      costBasisAtomic: a.buy ? f.input : (position?.costAtomic ?? null),
      sources: a.buy ? [this.op?.source] : (position?.sources ?? []),
      source: this.op?.source ?? {
        mint: (
          await nearView(this.provider, this.config.contractId, "get_draw", {
            draw_id: a.draw,
          })
        ).source_mint,
        symbol: "Source token",
      },
      nearTransactions: this.op?.nearTransactions ?? [],
      createdAt: new Date().toISOString(),
    });
  }
  private async refreshBalances() {
    const s = this.chain?.session;
    if (!s) return;
    this.cash = (
      await this.rpc.getTokenAccountBalance(
        new PublicKey(s.usdc_ata),
        "finalized",
      )
    ).value.amount;
    for (let i = 0; i < 3; i++) {
      const qty = BigInt(s.balances[i]);
      if (qty > 0n) {
        try {
          const quote = {
            ...(await verifyAndQuote(
              this.rpc,
              this.config.markets[i],
              false,
              qty,
            )),
            observedAt: new Date().toISOString(),
          };
          this.quotes.set(i, quote);
          const history =
            this.store.getRecord<any[]>("history:" + s.id + ":" + i) ?? [];
          history.push({
            at: Date.now(),
            price: Number(quote.reserveUsdc) / Number(quote.reserveToken),
          });
          this.store.putRecord(
            "history:" + s.id + ":" + i,
            history.slice(-120),
          );
        } catch {
          this.quotes.delete(i);
        }
      } else this.quotes.delete(i);
    }
    this.lastBalance = Date.now();
  }
  async tick() {
    if (this.processing || this.ticking) return;
    this.ticking = true;
    try {
      await this.refresh();
      if (!this.chain) return;
      const pending = this.chain.session?.pending;
      if (pending && (!this.op || this.op.attemptId !== pending)) {
        const a = await nearView(
            this.provider,
            this.config.contractId,
            "get_attempt",
            { attempt_id: pending },
          ),
          draw = await nearView(
            this.provider,
            this.config.contractId,
            "get_draw",
            { draw_id: a.draw },
          );
        this.op = {
          id: randomUUID(),
          phase: "unknown",
          attemptId: a.id,
          attempt: a,
          draw,
          session: a.session,
          source: { mint: draw.source_mint, symbol: "Recovered source" },
          marketIndex: a.market_index,
          amount: a.amount,
          buy: a.buy,
          nearTransactions: [],
        };
        this.persist();
      }
      if (
        this.op?.phase === "unknown" &&
        !this.op.attemptId &&
        (this.op.draw ||
          (this.op.expectedDraw &&
            BigInt(this.chain.next_draw) > BigInt(this.op.expectedDraw)))
      ) {
        this.op.draw ??= await nearView(
          this.provider,
          this.config.contractId,
          "get_draw",
          { draw_id: this.op.expectedDraw },
        );
        if (this.op.committed) {
          const source = this.op.manifest?.pool.find(
            (t: any) => t.mint === this.op.selectedMint,
          );
          if (
            this.op.draw.selection_policy !== "proximity-v1" ||
            this.op.draw.release_hash !== this.op.commitment ||
            this.op.draw.source_mint !== source?.mint
          )
            throw new UserError(
              "Recovered receipt does not match the committed roll",
            );
        }
        this.adoptDrawAmount(this.op);
        this.op.mode = "reveal";
        this.op.source ??= this.op.manifest?.pool.find(
          (t: any) => t.mint === this.op.draw.source_mint,
        );
        if (!this.op.source)
          throw new UserError(
            "Recovered source is outside the frozen manifest",
          );
        this.op.marketIndex = this.op.draw.market_index;
        this.op.phase = "awaiting_confirmation";
        this.op.error =
          "Recovered the original selection. Confirm explicitly to resume.";
        this.persist();
      }
      if (this.op?.attemptId && !terminal.has(this.op.phase)) {
        const a = await nearView(
          this.provider,
          this.config.contractId,
          "get_attempt",
          { attempt_id: this.op.attemptId },
        );
        await this.reconcile(a);
      }
      if (!this.locked() && Date.now() - this.lastBalance > 12000)
        await this.refreshBalances();
      this.persist();
    } catch (e) {
      this.error = this.message(e);
      if (
        this.op &&
        !terminal.has(this.op.phase) &&
        this.op.phase !== "awaiting_confirmation"
      ) {
        this.op.phase = "unknown";
        this.op.error = this.error;
        this.persist();
      }
    } finally {
      this.ticking = false;
    }
  }
  async revoke() {
    if (this.processing)
      throw new UserError("Wait for the current NEAR request");
    if (!this.scoped) throw new UserError("No test session");
    this.processing = true;
    try {
      await this.scoped.callFunctionRaw({
        contractId: this.config.contractId,
        methodName: "revoke_session",
        args: {},
        gas: 30000000000000n,
        waitUntil: "FINAL",
      });
      await this.refresh();
      this.persist();
      return this.snapshot();
    } finally {
      this.processing = false;
      this.persist();
    }
  }
  async start() {
    this.loadConfig();
    await this.tick();
    this.timer = setInterval(() => void this.tick(), 5000);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
  }
  private message(e: unknown) {
    // These land in a field the wallet owner reads. Provider RPC text, contract
    // internals and our own invariant messages stay in the operator log instead.
    return clientMessage(
      e,
      "The test account did not respond. Refresh before trying again.",
      "test execution failure",
    );
  }
}
