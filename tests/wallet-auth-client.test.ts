import { expect, it } from "vitest";
import bs58 from "bs58";
import {
  authenticateWallet,
  signWalletChallenge,
} from "../apps/web/src/wallets/auth-client.ts";
const phantom = "So11111111111111111111111111111111111111112",
  evm = "0x" + "1".repeat(40);
const challenge = (kind: any, address: string, chainId?: string) => ({
  id: "a".repeat(64),
  nonce: "b".repeat(64),
  kind,
  address,
  ...(chainId ? { chainId } : {}),
  recipient: "127.0.0.1:5177",
  expiresAt: new Date(Date.now() + 300000).toISOString(),
  message:
    "127.0.0.1:5177 requests a Jackpot wallet sign-in.\nURI: http://127.0.0.1:5177\nNo transaction, token approval, deposit or spending permission.",
});
it("signs only a message with Phantom and refuses a changed signer", async () => {
  const c = challenge("phantom", phantom),
    p = {
      publicKey: { toBase58: () => phantom },
      signMessage: async (bytes: Uint8Array, format: string) => {
        expect(new TextDecoder().decode(bytes)).toBe(c.message);
        expect(format).toBe("utf8");
        return {
          signature: new Uint8Array(64),
          publicKey: { toBase58: () => phantom },
        };
      },
    };
  const proof = await signWalletChallenge(c, { phantom: p });
  expect(proof.signature).toBe(bs58.encode(new Uint8Array(64)));
  p.publicKey = { toBase58: () => bs58.encode(new Uint8Array(32).fill(15)) };
  await expect(signWalletChallenge(c, { phantom: p })).rejects.toMatchObject({
    code: "ACCOUNT_CHANGED",
  });
});
it("uses personal_sign and refuses to sign when the EVM chain has changed", async () => {
  const methods: string[] = [];
  let chain = "0x1";
  const p = {
    request: async ({ method, params }: any) => {
      methods.push(method);
      if (method === "eth_accounts") return [evm];
      if (method === "eth_chainId") return chain;
      expect(params[1]).toBe(evm);
      expect(Buffer.from(params[0].slice(2), "hex").toString()).toContain(
        "No transaction",
      );
      return "0x" + "11".repeat(65);
    },
  };
  await signWalletChallenge(challenge("metamask", evm, "0x1"), { evm: p });
  expect(methods).toContain("personal_sign");
  expect(methods).not.toContain("eth_sign");
  chain = "0xa";
  await expect(
    signWalletChallenge(challenge("metamask", evm, "0x1"), { evm: p }),
  ).rejects.toMatchObject({ code: "ACCOUNT_CHANGED" });
});
it("passes the exact NEP-413 nonce, recipient and signer account to the connected NEAR wallet", async () => {
  const c = challenge("near", "example.near"),
    proof = await signWalletChallenge(c, {
      near: {
        signMessage: async (p: any) => {
          expect(p.signerId).toBe("example.near");
          expect(p.recipient).toBe("127.0.0.1:5177");
          expect(p.nonce).toEqual(new Uint8Array(32).fill(187));
          return {
            accountId: "example.near",
            publicKey: "ed25519:" + phantom,
            signature: "signature",
          };
        },
      },
    });
  expect(proof.publicKey).toBe("ed25519:" + phantom);
});
it("refuses a challenge for another account before requesting a signature", async () => {
  let signed = false;
  await expect(
    authenticateWallet(
      { kind: "phantom", address: phantom },
      {
        phantom: {
          signMessage: async () => {
            signed = true;
          },
        },
      },
      {
        origin: "http://127.0.0.1:5177",
        fetcher: async () =>
          new Response(
            JSON.stringify(
              challenge("phantom", bs58.encode(new Uint8Array(32).fill(15))),
            ),
          ),
      },
    ),
  ).rejects.toMatchObject({ code: "CHALLENGE_MISMATCH" });
  expect(signed).toBe(false);
});
it("does not submit a verification after the popup was cancelled locally", async () => {
  const ctl = new AbortController(),
    calls: string[] = [];
  const rejected = authenticateWallet(
    { kind: "phantom", address: phantom },
    {
      phantom: {
        publicKey: { toBase58: () => phantom },
        signMessage: async () => {
          ctl.abort();
          return { signature: new Uint8Array(64) };
        },
      },
    },
    {
      origin: "http://127.0.0.1:5177",
      signal: ctl.signal,
      fetcher: async (url: any) => {
        calls.push(url);
        return new Response(JSON.stringify(challenge("phantom", phantom)));
      },
    },
  );
  await expect(rejected).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });
  expect(calls).toEqual(["/api/auth/challenge"]);
});
it("reports a structured expired challenge error without retrying signatures", async () => {
  let signed = 0;
  await expect(
    authenticateWallet(
      { kind: "phantom", address: phantom },
      {
        phantom: {
          publicKey: { toBase58: () => phantom },
          signMessage: async () => {
            signed++;
            return { signature: new Uint8Array(64) };
          },
        },
      },
      {
        origin: "http://127.0.0.1:5177",
        fetcher: async (url: any) =>
          new Response(
            JSON.stringify(
              url.endsWith("challenge")
                ? challenge("phantom", phantom)
                : {
                    code: "CHALLENGE_EXPIRED",
                    error: "Request a new message.",
                  },
            ),
            { status: url.endsWith("challenge") ? 200 : 401 },
          ),
      },
    ),
  ).rejects.toMatchObject({ code: "CHALLENGE_EXPIRED" });
  expect(signed).toBe(1);
});
it("sends only identity fields even when the connected wallet includes display metadata", async () => {
  const wallet = {
    kind: "phantom" as const,
    address: phantom,
    network: "Solana mainnet",
  };
  let body: any;
  const r = await authenticateWallet(
    wallet,
    {
      phantom: {
        publicKey: { toBase58: () => phantom },
        signMessage: async () => ({ signature: new Uint8Array(64) }),
      },
    },
    {
      origin: "http://127.0.0.1:5177",
      fetcher: async (url: any, init: any) => {
        if (url.endsWith("challenge")) {
          body = JSON.parse(init.body);
          return new Response(JSON.stringify(challenge("phantom", phantom)));
        }
        return new Response(
          JSON.stringify({
            identity: {
              kind: "phantom",
              address: phantom,
              expiresAt: new Date(Date.now() + 3600000).toISOString(),
            },
          }),
        );
      },
    },
  );
  expect(body).toEqual({ kind: "phantom", address: phantom });
  expect(r.address).toBe(phantom);
});
it("reconnects before retrying verification when the wallet was disconnected", async () => {
  const { retryWalletIssue } =
    await import("../apps/web/src/wallets/auth-client.ts");
  const calls: string[] = [];
  await retryWalletIssue({ kind: "metamask", action: "verify" }, false, {
    connect: async () => {
      calls.push("connect");
    },
    verify: async () => {
      calls.push("verify");
    },
    signOut: async () => {
      calls.push("logout");
    },
  });
  expect(calls).toEqual(["connect"]);
});
