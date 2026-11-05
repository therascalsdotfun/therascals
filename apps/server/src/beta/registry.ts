import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { WalletIdentity } from "../../../../packages/shared/src/wallet-auth.ts";
import { AuthError } from "../auth/service.ts";
import { MarketStore } from "../market/store.ts";
import { MarketService } from "../market/service.ts";
import { ExecutionService } from "../execution/service.ts";
import { executionPaths, type ExecutionPaths } from "../execution/paths.ts";
import { BetaAccess } from "./access.ts";
import type { BetaClaimPolicy } from "../http/runtime.ts";
type Engine = Pick<
  ExecutionService,
  | "snapshot"
  | "activate"
  | "draw"
  | "confirm"
  | "retry"
  | "exit"
  | "tick"
  | "revoke"
  | "start"
  | "stop"
>;
type Entry = { engine: Engine; initializing: boolean; failure: string | null };
type Dependencies = {
  paths?: (slot: string) => ExecutionPaths;
  expectedWasm?: string;
  claimPolicy?: BetaClaimPolicy;
  create?: (slot: string, subject: string) => { engine: Engine };
};
export class BetaRegistry {
  private access: BetaAccess;
  private engines = new Map<string, Entry>();
  private funding = false;
  private paths: (slot: string) => ExecutionPaths;
  constructor(
    private store: MarketStore,
    private markets: MarketService,
    private slots: string[],
    private dependencies: Dependencies = {},
  ) {
    this.access = new BetaAccess(
      store,
      slots,
      Date.now,
      dependencies.claimPolicy,
    );
    this.paths = dependencies.paths ?? executionPaths;
    const contracts = new Set<string>(),
      keys = new Set<string>();
    for (const slot of slots) {
      const p = this.paths(slot);
      if (
        ![
          p.publicConfig,
          p.privateConfig,
          p.proof,
          ...(p.ownerWallet ? [p.ownerWallet] : []),
        ].every(existsSync)
      )
        throw Error(
          `Slot ${slot} must be provisioned and verified before public startup`,
        );
      const config = JSON.parse(readFileSync(p.publicConfig, "utf8")),
        proof = JSON.parse(readFileSync(p.proof, "utf8"));
      if (
        !config.contractId?.startsWith(slot + ".") ||
        !config.contractId.endsWith(".testnet") ||
        !config.settlerAccount?.startsWith("pay" + slot + ".") ||
        !config.scopedPublicKey ||
        keys.has(config.scopedPublicKey) ||
        contracts.has(config.contractId) ||
        !proof.buyFinalized ||
        !proof.sellFinalized ||
        !proof.ownerExitAfterRevocation ||
        !proof.newBuyAfterRevocationRejected ||
        proof.contractId !== config.contractId ||
        proof.wasmSha256 !== config.wasmSha256 ||
        (dependencies.expectedWasm !== undefined &&
          config.wasmSha256 !== dependencies.expectedWasm)
      )
        throw Error(`Slot ${slot} has no matching isolated buy/exit proof`);
      contracts.add(config.contractId);
      keys.add(config.scopedPublicKey);
    }
  }
  private entry(slot: string) {
    let entry = this.engines.get(slot);
    if (!entry) {
      const subject = this.access.owner(slot)?.subject;
      if (!subject) throw Error("Unassigned beta slot");
      let engine: Engine;
      if (this.dependencies.create)
        engine = this.dependencies.create(slot, subject).engine;
      else {
        const paths = this.paths(slot);
        mkdirSync(dirname(paths.database), { recursive: true });
        engine = new ExecutionService(
          new MarketStore(paths.database),
          this.markets.scoped("user:" + subject),
          paths,
        );
      }
      entry = { engine, initializing: true, failure: null };
      this.engines.set(slot, entry);
      const current = entry;
      void engine
        .start()
        .catch(() => {
          current.failure =
            "Test account initialization failed. Ask the operator to check its configuration.";
        })
        .finally(() => {
          current.initializing = false;
        });
    }
    return entry;
  }
  snapshot(identity: WalletIdentity | null) {
    const slot = identity ? this.access.slot(identity) : null,
      entry = slot ? this.entry(slot) : null;
    const base = entry?.engine.snapshot() ?? {
      ready: false,
      verified: false,
      busy: false,
      phase: "setup",
      session: null,
      positions: [],
      receipts: [],
      operation: null,
      contractId: null,
      markets: [],
      cashAtomic: null,
      remainingAuthorizedAtomic: null,
      ownerAccount: null,
      error: null,
    };
    const claimedAt = slot ? (this.access.owner(slot)?.claimedAt ?? 0) : 0;
    const receipts = (base.receipts ?? []).filter(
      (r: any) => Date.parse(r.createdAt ?? "") >= claimedAt,
    );
    const operation =
      base.operation?.createdAt &&
      Date.parse(base.operation.createdAt) < claimedAt
        ? null
        : base.operation;
    return {
      ...base,
      receipts,
      operation,
      ...(entry?.initializing
        ? { busy: true, ready: false, phase: "initializing" }
        : {}),
      ...(entry?.failure ? { ready: false, error: entry.failure } : {}),
      mode: "sponsored-testnet-beta",
      access: {
        public: true,
        signedIn: !!identity,
        identity,
        claimed: !!slot,
        available: this.access.available(),
        inviteOnly: this.access.inviteOnly(),
        dailyActivation: true,
      },
    };
  }
  claim(identity: WalletIdentity, origin?: string | null) {
    this.access.claim(identity, origin);
    return this.snapshot(identity);
  }
  forIdentity(identity: WalletIdentity) {
    const slot = this.access.slot(identity);
    if (!slot)
      throw new AuthError(
        "CLAIM_REQUIRED",
        "Claim a sponsored testnet slot first.",
        403,
      );
    const entry = this.entry(slot);
    if (entry.initializing)
      throw new AuthError(
        "ACCOUNT_WARMING",
        "Your test account is initializing. Wait for its on-chain state to load, then refresh.",
        409,
      );
    if (entry.failure)
      throw new AuthError("ACCOUNT_UNAVAILABLE", entry.failure, 503);
    return entry.engine;
  }
  async activate(identity: WalletIdentity) {
    const engine = this.forIdentity(identity),
      state = engine.snapshot();
    if (this.funding || state.busy)
      throw new AuthError(
        "FUNDING_BUSY",
        "Testnet funding is in progress. Wait, then refresh before trying again.",
        409,
      );
    if (!state.verified)
      throw new AuthError(
        "ACCOUNT_UNVERIFIED",
        "The testnet policy is not verified or RPC is unavailable. Refresh before activating.",
        503,
      );
    if (
      state.positions.length ||
      (state.session &&
        !state.session.revoked &&
        Number(state.session.expires_ms) > Date.now() &&
        BigInt(state.session.issued) < 100000000n)
    )
      throw new AuthError(
        "SESSION_EXISTS",
        "Use your current session or close existing positions before activation.",
        409,
      );
    this.funding = true;
    try {
      this.access.reserveActivation(identity);
      await engine.activate();
      return this.snapshot(identity);
    } finally {
      this.funding = false;
    }
  }
  start() {
    for (const slot of this.slots)
      if (this.store.getRecord("beta-owner:" + slot)) this.entry(slot);
  }
  stop() {
    for (const { engine } of this.engines.values()) engine.stop();
  }
}
