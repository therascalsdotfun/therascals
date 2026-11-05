import { randomBytes, createHash } from "node:crypto";
import bs58 from "bs58";
import type {
  AuthChallenge,
  WalletIdentity,
  WalletKind,
  WalletProof,
} from "../../../../packages/shared/src/wallet-auth.ts";
import { nearFullAccessKey, validProof } from "./proof.ts";
import { UserError } from "../client-message.ts";
export class AuthError extends UserError {
  constructor(
    public code: string,
    message: string,
    public status = 401,
  ) {
    super(message);
  }
}
type ChallengeRecord = {
  challenge: AuthChallenge;
  browser: string;
  origin: string;
  expires: number;
};
const random = () => randomBytes(32).toString("hex"),
  digest = (s: string) => createHash("sha256").update(s).digest("hex");
export class WalletAuthService {
  private browsers = new Map<string, number>();
  private latest = new Map<string, string>();
  private challenges = new Map<string, ChallengeRecord>();
  private sessions = new Map<
    string,
    { browser: string; identity: WalletIdentity; expires: number }
  >();
  private rates = new Map<string, { start: number; count: number }>();
  private now: () => number;
  private nearKey: (account: string, publicKey: string) => Promise<unknown>;
  constructor(
    options: {
      now?: () => number;
      nearKey?: (account: string, publicKey: string) => Promise<unknown>;
    } = {},
  ) {
    this.now = options.now ?? Date.now;
    this.nearKey = options.nearKey ?? nearFullAccessKey;
  }
  private prune() {
    const now = this.now();
    for (const [k, t] of this.browsers)
      if (t <= now) {
        this.browsers.delete(k);
        this.latest.delete(k);
      }
    for (const [k, c] of this.challenges)
      if (c.expires <= now || !this.browsers.has(c.browser))
        this.challenges.delete(k);
    for (const [k, s] of this.sessions)
      if (s.expires <= now || !this.browsers.has(s.browser))
        this.sessions.delete(k);
    for (const [k, r] of this.rates)
      if (r.start + 60000 <= now) this.rates.delete(k);
  }
  rate(key: string, max = 30) {
    this.prune();
    let r = this.rates.get(key);
    if (!r) {
      if (this.rates.size >= 10000)
        throw new AuthError(
          "RATE_LIMITED",
          "Sign-in is busy. Try again shortly.",
          429,
        );
      this.rates.set(key, (r = { start: this.now(), count: 0 }));
    }
    if (++r.count > max)
      throw new AuthError(
        "RATE_LIMITED",
        "Too many sign-in requests. Wait a minute and try again.",
        429,
      );
  }
  createBrowser() {
    this.prune();
    if (this.browsers.size >= 2000)
      throw new AuthError(
        "RATE_LIMITED",
        "Sign-in is busy. Try again shortly.",
        429,
      );
    const b = random();
    this.browsers.set(b, this.now() + 3600000);
    return b;
  }
  hasBrowser(browser: string) {
    this.prune();
    return this.browsers.has(browser);
  }
  issue(
    browser: string,
    origin: string,
    input: { kind: WalletKind; address: string; chainId?: string },
  ): AuthChallenge {
    this.rate("challenge:" + browser, 6);
    if (!this.browsers.has(browser))
      throw new AuthError(
        "CHALLENGE_EXPIRED",
        "Sign-in expired. Request a new message.",
      );
    let address = input.address,
      chainId = input.chainId;
    if (input.kind === "phantom") {
      try {
        if (bs58.decode(address).length !== 32) throw Error();
      } catch {
        throw new AuthError("INVALID_ACCOUNT", "Invalid Solana account.", 400);
      }
    } else if (input.kind === "metamask") {
      if (
        !/^0x[0-9a-fA-F]{40}$/.test(address) ||
        !chainId ||
        !/^0x[0-9a-fA-F]{1,16}$/.test(chainId)
      )
        throw new AuthError(
          "INVALID_ACCOUNT",
          "Invalid EVM account or network.",
          400,
        );
      address = address.toLowerCase();
      chainId = chainId.toLowerCase();
    } else if (input.kind === "near") {
      if (
        !/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/.test(address) ||
        address.length < 2 ||
        address.length > 64 ||
        address.endsWith(".testnet")
      )
        throw new AuthError(
          "INVALID_ACCOUNT",
          "Use a valid NEAR mainnet account.",
          400,
        );
    } else throw new AuthError("INVALID_ACCOUNT", "Unsupported wallet.", 400);
    if (input.kind !== "metamask" && chainId)
      throw new AuthError("INVALID_ACCOUNT", "Unexpected network.", 400);
    const nonce = random(),
      issued = this.now(),
      expiresAt = new Date(issued + 300000).toISOString(),
      recipient = new URL(origin).host;
    const challenge: AuthChallenge = {
      id: random(),
      kind: input.kind,
      address,
      ...(chainId ? { chainId } : {}),
      nonce,
      recipient,
      expiresAt,
      message: [
        `${recipient} requests a Jackpot wallet sign-in.`,
        `Account: ${address}`,
        `Wallet: ${input.kind}`,
        ...(chainId ? [`Chain ID: ${chainId}`] : []),
        `URI: ${origin}`,
        `Nonce: ${nonce}`,
        `Issued At: ${new Date(issued).toISOString()}`,
        `Expiration Time: ${expiresAt}`,
        "No transaction, token approval, deposit or spending permission.",
      ].join("\n"),
    };
    for (const [id, c] of this.challenges)
      if (c.browser === browser) this.challenges.delete(id);
    this.latest.set(browser, challenge.id);
    this.challenges.set(challenge.id, {
      challenge,
      browser,
      origin,
      expires: issued + 300000,
    });
    return challenge;
  }
  async verify(browser: string, origin: string, proof: WalletProof) {
    this.rate("verify:" + browser, 8);
    const row = this.challenges.get(proof.id);
    if (
      !row ||
      row.browser !== browser ||
      row.origin !== origin ||
      !this.browsers.has(browser) ||
      row.expires <= this.now()
    )
      throw new AuthError(
        "CHALLENGE_EXPIRED",
        "Sign-in expired or cancelled. Request a new message.",
      );
    this.challenges.delete(proof.id);
    const c = row.challenge;
    if (!validProof(c, proof))
      throw new AuthError(
        "INVALID_SIGNATURE",
        "Signature does not match this account and sign-in message.",
      );
    if (c.kind === "near") {
      let permission: unknown;
      try {
        permission = await this.nearKey(c.address, proof.publicKey!);
      } catch {
        throw new AuthError(
          "RPC_UNAVAILABLE",
          "NEAR key verification is unavailable. Try again shortly.",
          503,
        );
      }
      if (permission !== "FullAccess")
        throw new AuthError(
          "KEY_NOT_AUTHORIZED",
          "This signing key is not a current full-access key for this NEAR account.",
        );
    }
    this.prune();
    if (
      !this.browsers.has(browser) ||
      this.latest.get(browser) !== c.id ||
      row.expires <= this.now()
    )
      throw new AuthError(
        "CHALLENGE_EXPIRED",
        "Sign-in expired or cancelled. Request a new message.",
      );
    if (this.sessions.size >= 2000)
      throw new AuthError(
        "RATE_LIMITED",
        "Sign-in is busy. Try again shortly.",
        429,
      );
    for (const [k, s] of this.sessions)
      if (s.browser === browser) this.sessions.delete(k);
    const token = random(),
      expires = this.now() + 3600000,
      identity: WalletIdentity = {
        kind: c.kind,
        address: c.address,
        ...(c.chainId ? { chainId: c.chainId } : {}),
        expiresAt: new Date(expires).toISOString(),
      };
    this.browsers.set(browser, expires);
    this.sessions.set(digest(token), { browser, identity, expires });
    return { token, identity };
  }
  session(token: string | undefined): WalletIdentity | null {
    this.prune();
    return token ? (this.sessions.get(digest(token))?.identity ?? null) : null;
  }
  logout(browser: string, token?: string) {
    const sessionKey = token ? digest(token) : null;
    const bound = sessionKey
      ? this.sessions.get(sessionKey)?.browser
      : undefined;
    const browsers = new Set([browser, ...(bound ? [bound] : [])]);
    for (const b of browsers) {
      this.browsers.delete(b);
      this.latest.delete(b);
    }
    for (const [id, c] of this.challenges)
      if (browsers.has(c.browser)) this.challenges.delete(id);
    for (const [id, s] of this.sessions)
      if (browsers.has(s.browser) || id === sessionKey)
        this.sessions.delete(id);
  }
}
