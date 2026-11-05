import bs58 from "bs58";
import {
  sameWallet,
  type AuthChallenge,
  type WalletIdentity,
  type WalletProof,
} from "../../../../packages/shared/src/wallet-auth.ts";
import type { EvmProvider } from "./providers.ts";
import { throwIfCancelled, WalletRequestError } from "./requests.ts";
export type AuthProviders = {
  evm?: EvmProvider | null;
  phantom?: any;
  near?: { signMessage: (params: any) => Promise<any> };
};
export type AuthStage = "challenge" | "signature" | "verification";
const changed = () =>
  new WalletRequestError(
    "ACCOUNT_CHANGED",
    "Wallet account or network changed. Connect the intended account and verify again.",
  );
export async function signWalletChallenge(
  c: AuthChallenge,
  providers: AuthProviders,
  signal?: AbortSignal,
): Promise<WalletProof> {
  throwIfCancelled(signal);
  if (c.kind === "phantom") {
    const p = providers.phantom;
    if (!p?.signMessage)
      throw new WalletRequestError(
        "SIGNING_UNSUPPORTED",
        "This Phantom connection cannot sign messages. Open Rascals in the Phantom wallet browser or extension.",
      );
    const address = () =>
      p.publicKey?.toBase58?.() ?? p.publicKey?.toString?.();
    if (address() !== c.address) throw changed();
    const r = await p.signMessage(new TextEncoder().encode(c.message), "utf8");
    throwIfCancelled(signal);
    if (
      address() !== c.address ||
      (r.publicKey &&
        (r.publicKey.toBase58?.() ?? r.publicKey.toString?.()) !== c.address)
    )
      throw changed();
    if (!(r.signature instanceof Uint8Array) || r.signature.length !== 64)
      throw new WalletRequestError(
        "INVALID_SIGNATURE",
        "The wallet returned an invalid message signature.",
      );
    return { id: c.id, signature: bs58.encode(r.signature) };
  }
  if (c.kind === "metamask") {
    const p = providers.evm;
    if (!p)
      throw new WalletRequestError(
        "PROVIDER_MISSING",
        "MetaMask is unavailable. Reconnect your wallet.",
      );
    const check = async () => {
      const accounts = await p.request({ method: "eth_accounts" }),
        chain = await p.request({ method: "eth_chainId" });
      throwIfCancelled(signal);
      if (
        !sameWallet(c, {
          kind: "metamask",
          address: accounts?.[0] ?? "",
          chainId: chain,
        })
      )
        throw changed();
    };
    await check();
    const hex =
      "0x" +
      Array.from(new TextEncoder().encode(c.message), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
    const signature = await p.request({
      method: "personal_sign",
      params: [hex, c.address],
    });
    throwIfCancelled(signal);
    await check();
    if (typeof signature !== "string")
      throw new WalletRequestError(
        "INVALID_SIGNATURE",
        "The wallet returned an invalid message signature.",
      );
    return { id: c.id, signature };
  }
  const p = providers.near;
  if (!p?.signMessage)
    throw new WalletRequestError(
      "SIGNING_UNSUPPORTED",
      "This NEAR wallet cannot sign NEP-413 messages. Choose a wallet with message-signing support.",
    );
  const r = await p.signMessage({
    message: c.message,
    recipient: c.recipient,
    nonce: Uint8Array.from(c.nonce.match(/../g)!, (b) => parseInt(b, 16)),
    signerId: c.address,
    network: "mainnet",
  });
  throwIfCancelled(signal);
  if (r?.accountId !== c.address) throw changed();
  return { id: c.id, signature: r.signature, publicKey: r.publicKey };
}
export async function authenticateWallet(
  wallet: Pick<WalletIdentity, "kind" | "address" | "chainId">,
  providers: AuthProviders,
  options: {
    origin: string;
    signal?: AbortSignal;
    onStage?: (stage: AuthStage) => void;
    fetcher?: typeof fetch;
  },
): Promise<WalletIdentity> {
  const fetcher = options.fetcher ?? fetch,
    signal = options.signal;
  const post = async (path: string, body: unknown) => {
    throwIfCancelled(signal);
    const r = await fetcher(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    const data = await r.json();
    throwIfCancelled(signal);
    if (!r.ok)
      throw new WalletRequestError(
        data.code ?? "AUTH_UNAVAILABLE",
        data.error ?? "Wallet verification is unavailable.",
      );
    return data;
  };
  options.onStage?.("challenge");
  const c: AuthChallenge = await post("/api/auth/challenge", {
    kind: wallet.kind,
    address: wallet.address,
    ...(wallet.chainId ? { chainId: wallet.chainId } : {}),
  });
  if (
    !sameWallet(wallet, c) ||
    !/^[a-f0-9]{64}$/.test(c.id) ||
    !/^[a-f0-9]{64}$/.test(c.nonce) ||
    c.recipient !== new URL(options.origin).host ||
    typeof c.message !== "string" ||
    c.message.length > 2000 ||
    !c.message.includes("URI: " + options.origin) ||
    !(Date.parse(c.expiresAt) > Date.now())
  )
    throw new WalletRequestError(
      "CHALLENGE_MISMATCH",
      "The sign-in message does not match this wallet or site. Try again.",
    );
  options.onStage?.("signature");
  const proof = await signWalletChallenge(c, providers, signal);
  throwIfCancelled(signal);
  options.onStage?.("verification");
  const result = await post("/api/auth/verify", proof);
  if (
    !sameWallet(wallet, result.identity) ||
    !(Date.parse(result.identity.expiresAt) > Date.now())
  )
    throw new WalletRequestError(
      "ACCOUNT_CHANGED",
      "Wallet verification returned a different or expired account. Try again.",
    );
  return result.identity;
}
export async function retryWalletIssue(
  issue: {
    kind: WalletIdentity["kind"];
    action: "connect" | "verify" | "logout";
  },
  connected: boolean,
  actions: {
    connect: (kind: WalletIdentity["kind"]) => Promise<void>;
    verify: (kind: WalletIdentity["kind"]) => Promise<void>;
    signOut: () => Promise<void>;
  },
) {
  if (issue.action === "logout") return actions.signOut();
  return issue.action === "verify" && connected
    ? actions.verify(issue.kind)
    : actions.connect(issue.kind);
}
