import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Wallet } from "ethers";
import type {
  PerpsNetwork,
  PerpsRevokedAgent,
} from "../../../../packages/shared/src/perps.ts";
import type { WalletIdentity } from "../../../../packages/shared/src/wallet-auth.ts";
import { subjectFor } from "../beta/access.ts";
import type { MarketStore } from "../market/store.ts";
import { PerpsError } from "./errors.ts";

export type StoredPerpsAgent = {
  owner: string;
  network: PerpsNetwork;
  master: string;
  agentAddress: string;
  ciphertext: string;
  iv: string;
  tag: string;
  createdAt: number;
  approvedAt?: number;
};

export function perpsAgentSecret(
  env: Record<string, string | undefined> = process.env,
): Buffer {
  const raw = env.JACKPOT_PERPS_SECRET;
  if (raw) {
    const secret = /^[0-9a-f]{64}$/i.test(raw)
      ? Buffer.from(raw, "hex")
      : Buffer.from(raw, "base64");
    if (secret.length !== 32)
      throw Error("JACKPOT_PERPS_SECRET must be 32 bytes (hex or base64)");
    return secret;
  }
  const path = ".data/perps-secret";
  if (existsSync(path)) {
    const secret = readFileSync(path);
    if (secret.length !== 32)
      throw Error("The stored perps secret is not 32 bytes");
    return secret;
  }
  if ((env.JACKPOT_MODE ?? "local") !== "local")
    throw Error(
      "Public mode needs JACKPOT_PERPS_SECRET or the mounted .data/perps-secret: a key invented at boot cannot decrypt the agent keys already stored, and the site would come up healthy with every open position unmanageable.",
    );
  const secret = randomBytes(32);
  mkdirSync(".data", { recursive: true });
  writeFileSync(path, secret, { mode: 0o600 });
  return secret;
}

export function requireEvmIdentity(identity: WalletIdentity): string {
  if (identity.kind !== "metamask")
    throw new PerpsError(
      "Connect and verify MetaMask to trade Hyperliquid perps.",
      400,
      "EVM_REQUIRED",
    );
  return identity.address.toLowerCase();
}

export class PerpsAgents {
  constructor(
    private store: MarketStore,
    private network: PerpsNetwork,
    private secret: Buffer,
    private now = Date.now,
  ) {}

  status(identity: WalletIdentity): StoredPerpsAgent | null {
    requireEvmIdentity(identity);
    const record = this.store.getRecord<StoredPerpsAgent>(this.key(identity));
    if (!record) return null;
    if (
      record.network !== this.network ||
      record.master !== identity.address.toLowerCase()
    )
      throw new PerpsError(
        "The saved Hyperliquid agent belongs to another network or wallet.",
        409,
        "AGENT_MISMATCH",
      );
    return record;
  }

  ensure(identity: WalletIdentity): {
    record: StoredPerpsAgent;
    agentKey: string;
  } {
    const master = requireEvmIdentity(identity);
    const existing = this.status(identity);
    if (existing)
      return {
        record: existing,
        agentKey: this.decrypt(existing),
      };
    const agentKey = Wallet.createRandom().privateKey;
    const agentAddress = new Wallet(agentKey).address.toLowerCase();
    const sealed = this.encrypt(agentKey, master, agentAddress);
    const record: StoredPerpsAgent = {
      owner: subjectFor(identity),
      network: this.network,
      master,
      agentAddress,
      ...sealed,
      createdAt: this.now(),
    };
    this.store.putRecord(this.key(identity), record);
    return { record, agentKey };
  }

  agentKey(identity: WalletIdentity): string {
    const record = this.status(identity);
    if (!record)
      throw new PerpsError(
        "Enable one-tap trading before opening a position.",
        403,
        "AGENT_REQUIRED",
      );
    return this.decrypt(record);
  }

  markApproved(identity: WalletIdentity): StoredPerpsAgent {
    const record = this.status(identity);
    if (!record)
      throw new PerpsError(
        "Prepare an agent before approving it.",
        403,
        "AGENT_REQUIRED",
      );
    if (!record.approvedAt) {
      record.approvedAt = this.now();
      this.store.putRecord(this.key(identity), record);
    }
    return record;
  }

  key(identity: WalletIdentity): string {
    return `perps-agent:${this.network}:${subjectFor(identity)}`;
  }

  /**
   * Forgets the delegated key. Hyperliquid has no master-signed removal action,
   * so the approval itself only disappears when the wallet owner revokes the
   * address in their own agent settings; this stops Jackpot from ever signing
   * with it again.
   */
  revoke(identity: WalletIdentity): PerpsRevokedAgent {
    const record = this.status(identity);
    if (!record)
      throw new PerpsError(
        "This wallet has no trading agent to revoke.",
        409,
        "AGENT_REQUIRED",
      );
    const revoked: PerpsRevokedAgent = {
      owner: record.owner,
      network: record.network,
      master: record.master,
      agentAddress: record.agentAddress,
      revokedAt: this.now(),
    };
    this.store.transaction(() => {
      this.store.putRecord(this.revokedKey(identity), [
        ...this.revokedAll(identity),
        revoked,
      ]);
      this.store.deleteRecord(this.key(identity));
    });
    return revoked;
  }

  revoked(identity: WalletIdentity): PerpsRevokedAgent | null {
    return this.revokedAll(identity).at(-1) ?? null;
  }

  revokedAll(identity: WalletIdentity): PerpsRevokedAgent[] {
    requireEvmIdentity(identity);
    // Older deployments stored only the most recent revocation at this key.
    const saved = this.store.getRecord<PerpsRevokedAgent | PerpsRevokedAgent[]>(
      this.revokedKey(identity),
    );
    return saved ? (Array.isArray(saved) ? saved : [saved]) : [];
  }

  private revokedKey(identity: WalletIdentity): string {
    return `perps-agent-revoked:${this.network}:${subjectFor(identity)}`;
  }

  private prefix(master: string, agentAddress: string): string {
    return `perps-agent:${this.network}:${master}:${agentAddress}|`;
  }

  private encrypt(
    agentKey: string,
    master: string,
    agentAddress: string,
  ): {
    ciphertext: string;
    iv: string;
    tag: string;
  } {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.secret, iv);
    const ciphertext = Buffer.concat([
      cipher.update(this.prefix(master, agentAddress) + agentKey, "utf8"),
      cipher.final(),
    ]);
    return {
      ciphertext: ciphertext.toString("base64"),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
    };
  }

  private decrypt(record: StoredPerpsAgent): string {
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.secret,
        Buffer.from(record.iv, "base64"),
      );
      decipher.setAuthTag(Buffer.from(record.tag, "base64"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(record.ciphertext, "base64")),
        decipher.final(),
      ]).toString("utf8");
      const prefix = this.prefix(record.master, record.agentAddress);
      if (!plaintext.startsWith(prefix))
        throw Error("Agent key prefix mismatch");
      return plaintext.slice(prefix.length);
    } catch {
      throw new PerpsError(
        "The saved trading agent cannot be decrypted. Generate a new agent and approve it again.",
        409,
        "AGENT_CORRUPT",
      );
    }
  }
}
