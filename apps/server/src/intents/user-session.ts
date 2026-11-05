import { createHash, randomBytes } from "node:crypto";
import bs58 from "bs58";
import nacl from "tweetnacl";
import type { WalletIdentity } from "../../../../packages/shared/src/wallet-auth.ts";
import type { WalletAuthService } from "../auth/service.ts";
import { IntentsError, jsonBounded } from "./service.ts";

const BASE = "https://1click.chaindefuser.com/v0";
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
type Challenge = {
  id: string;
  payload: string;
  expires: number;
  origin: string;
  address: string;
};
type Session = { accessToken: string; expires: number; address: string };

/** Credentials never leave this process or survive the browser's Rascals login. */
export class IntentsUserSessions {
  private challenges = new Map<string, Challenge>();
  private sessions = new Map<string, Session>();
  constructor(
    private auth: WalletAuthService,
    private fetcher: typeof fetch = fetch,
    private now = Date.now,
  ) {}
  private identity(token: string): WalletIdentity {
    const u = this.auth.session(token);
    if (!u)
      throw new IntentsError(
        "Verify your wallet again before authorizing Confidential Intents.",
        401,
      );
    return u;
  }
  private prune() {
    for (const [k, c] of this.challenges)
      if (c.expires <= this.now()) this.challenges.delete(k);
    for (const [k, s] of this.sessions)
      if (s.expires <= this.now()) this.sessions.delete(k);
  }
  status(token: string) {
    const u = this.identity(token);
    this.prune();
    const s = this.sessions.get(digest(token));
    return {
      authorized: !!s && s.address === u.address && u.kind === "phantom",
      expiresAt: s ? new Date(s.expires).toISOString() : null,
      supported: u.kind === "phantom",
      quoteAvailable: false,
    };
  }
  access(token: string, required = false): string | undefined {
    const status = this.status(token);
    if (status.authorized) return this.sessions.get(digest(token))!.accessToken;
    if (required)
      throw new IntentsError(
        "Authorize a Confidential Intents session with your verified Phantom wallet first.",
        401,
      );
    return undefined;
  }
  revoke(token: string) {
    this.sessions.delete(digest(token));
  }
  async challenge(token: string, origin: string) {
    const u = this.identity(token);
    if (u.kind !== "phantom")
      throw new IntentsError(
        "Confidential session authorization currently supports Phantom. NEAR requires a separately registered Intents key.",
        422,
      );
    this.prune();
    if (this.challenges.size >= 2000)
      throw new IntentsError(
        "Session authorization is busy. Try again shortly.",
        429,
      );
    const key = bs58.decode(u.address);
    if (key.length !== 32)
      throw new IntentsError("Invalid Solana wallet.", 400);
    // Same version-0 layout as Intents SDK VersionedNonceBuilder (0.95.0).
    const response = await this.fetcher("https://rpc.mainnet.near.org", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(12000),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "salt",
        method: "query",
        params: {
          request_type: "call_function",
          finality: "final",
          account_id: "intents.near",
          method_name: "current_salt",
          args_base64: "e30=",
        },
      }),
    });
    const result = await jsonBounded(response);
    const bytes = result?.result?.result;
    if (
      !response.ok ||
      !Array.isArray(bytes) ||
      bytes.length > 100 ||
      !bytes.every(
        (b: unknown) =>
          Number.isInteger(b) && Number(b) >= 0 && Number(b) <= 255,
      )
    )
      throw new IntentsError("Intents nonce salt is unavailable. Try again.");
    const salt = JSON.parse(Buffer.from(bytes).toString());
    if (typeof salt !== "string" || !/^[0-9a-f]{8}$/i.test(salt))
      throw new IntentsError("Unexpected Intents nonce salt.");
    // Start the two-minute signing window after the chain read completes.
    const start = this.now(),
      expires = start + 120000;
    const nonce = Buffer.alloc(32);
    nonce.set([86, 40, 246, 198, 0]);
    nonce.set(Buffer.from(salt, "hex"), 5);
    nonce.writeBigUInt64LE(BigInt(expires) * 1000000n, 9);
    nonce.writeBigUInt64LE(BigInt(start) * 1000000n, 17);
    nonce.set(randomBytes(7), 25);
    const payload = JSON.stringify({
      signer_id: Buffer.from(key).toString("hex"),
      verifying_contract: "intents.near",
      deadline: new Date(expires).toISOString(),
      nonce: nonce.toString("base64"),
      intents: [],
    });
    const challenge = {
      id: randomBytes(32).toString("hex"),
      payload,
      expires,
      origin,
      address: u.address,
    };
    // Reject completion if the Rascals login changed during the chain read.
    if (this.identity(token).address !== u.address)
      throw new IntentsError("Wallet session changed.", 401);
    this.challenges.set(digest(token), challenge);
    return {
      id: challenge.id,
      payload,
      expiresAt: new Date(expires).toISOString(),
      address: u.address,
    };
  }
  async verify(token: string, origin: string, id: string, signature: string) {
    const u = this.identity(token),
      k = digest(token),
      c = this.challenges.get(k);
    this.challenges.delete(k); // Consume before verification or any provider request.
    if (
      !c ||
      c.id !== id ||
      c.expires <= this.now() ||
      c.origin !== origin ||
      c.address !== u.address ||
      u.kind !== "phantom"
    )
      throw new IntentsError(
        "Confidential session challenge expired or changed. Request a new one.",
        401,
      );
    let valid = false;
    try {
      valid = nacl.sign.detached.verify(
        new TextEncoder().encode(c.payload),
        bs58.decode(signature),
        bs58.decode(u.address),
      );
    } catch {}
    if (!valid)
      throw new IntentsError(
        "Signature does not match the verified wallet.",
        401,
      );
    const response = await this.fetcher(BASE + "/auth/authenticate", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(12000),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        signedData: {
          standard: "raw_ed25519",
          payload: c.payload,
          public_key: "ed25519:" + u.address,
          signature: "ed25519:" + signature,
        },
      }),
    });
    if (!response.ok)
      throw new IntentsError(
        "Intents rejected session authorization. Request a new signature and try again.",
        response.status === 429 ? 429 : 401,
      );
    const result = await jsonBounded(response);
    if (
      typeof result?.accessToken !== "string" ||
      !result.accessToken ||
      result.accessToken.length > 16000 ||
      !Number.isInteger(result.expiresIn) ||
      result.expiresIn < 1 ||
      result.expiresIn > 86400
    )
      throw new IntentsError("Invalid Intents session response.");
    if (this.identity(token).address !== u.address)
      throw new IntentsError("Wallet session changed.", 401);
    const expires = Math.min(
      this.now() + result.expiresIn * 1000,
      Date.parse(u.expiresAt),
    );
    this.sessions.set(k, {
      accessToken: result.accessToken,
      expires,
      address: u.address,
    });
    // Refresh credentials are deliberately discarded; expiry requires fresh consent.
    return this.status(token);
  }
}
