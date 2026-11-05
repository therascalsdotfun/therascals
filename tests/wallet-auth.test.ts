import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { WalletAuthService } from "../apps/server/src/auth/service.ts";
const origin = "http://127.0.0.1:5177",
  key = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(71)),
  address = bs58.encode(key.publicKey);
const sign = (c: any) =>
  bs58.encode(
    nacl.sign.detached(new TextEncoder().encode(c.message), key.secretKey),
  );
const make = (options: any = {}) => new WalletAuthService(options);
function nearSignature(c: any) {
  const str = (s: string) => {
    const b = Buffer.from(s);
    const len = Buffer.alloc(4);
    len.writeUInt32LE(b.length);
    return Buffer.concat([len, b]);
  };
  const tag = Buffer.alloc(4);
  tag.writeUInt32LE(2147484061);
  const hash = createHash("sha256")
    .update(
      Buffer.concat([
        tag,
        str(c.message),
        Buffer.from(c.nonce, "hex"),
        str(c.recipient),
        Buffer.from([0]),
      ]),
    )
    .digest();
  return Buffer.from(nacl.sign.detached(hash, key.secretKey)).toString(
    "base64",
  );
}
describe("wallet identity proofs", () => {
  it("accepts a real Phantom message, issues a bounded session and consumes its challenge", async () => {
    let now = Date.now();
    const s = make({ now: () => now }),
      b = s.createBrowser(),
      c = s.issue(b, origin, { kind: "phantom", address });
    expect(c.message).toContain(origin);
    expect(c.message).toContain(address);
    expect(c.message).toContain("No transaction");
    const r = await s.verify(b, origin, { id: c.id, signature: sign(c) });
    expect(s.session(r.token)?.address).toBe(address);
    await expect(
      s.verify(b, origin, { id: c.id, signature: sign(c) }),
    ).rejects.toMatchObject({ code: "CHALLENGE_EXPIRED" });
    now += 3600001;
    expect(s.session(r.token)).toBeNull();
  });
  it("rejects forged signatures, foreign browsers/origins and expired challenges", async () => {
    let now = Date.now();
    const s = make({ now: () => now }),
      b = s.createBrowser(),
      other = s.createBrowser();
    const c = s.issue(b, origin, { kind: "phantom", address });
    await expect(
      s.verify(other, origin, { id: c.id, signature: sign(c) }),
    ).rejects.toMatchObject({ code: "CHALLENGE_EXPIRED" });
    await expect(
      s.verify(b, "https://evil.example", { id: c.id, signature: sign(c) }),
    ).rejects.toMatchObject({ code: "CHALLENGE_EXPIRED" });
    await expect(
      s.verify(b, origin, {
        id: c.id,
        signature: bs58.encode(new Uint8Array(64)),
      }),
    ).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
    const old = s.issue(b, origin, { kind: "phantom", address });
    now += 300001;
    await expect(
      s.verify(b, origin, { id: old.id, signature: sign(old) }),
    ).rejects.toMatchObject({ code: "CHALLENGE_EXPIRED" });
  });
  it("recovers the EIP-191 signer and binds the declared address and chain", async () => {
    const secret = new Uint8Array(32).fill(9),
      pub = secp256k1.getPublicKey(secret, false),
      a =
        "0x" + Buffer.from(keccak_256(pub.slice(1)).slice(-20)).toString("hex");
    const s = make(),
      b = s.createBrowser(),
      c = s.issue(b, origin, { kind: "metamask", address: a, chainId: "0x1" });
    expect(c.message).toContain("Chain ID: 0x1");
    const msg = Buffer.from(c.message),
      hash = keccak_256(
        Buffer.concat([
          Buffer.from("\x19Ethereum Signed Message:\n" + msg.length),
          msg,
        ]),
      );
    const sig = secp256k1.sign(hash, secret),
      signature =
        "0x" +
        Buffer.from(sig.toCompactRawBytes()).toString("hex") +
        (sig.recovery + 27).toString(16);
    expect(
      (await s.verify(b, origin, { id: c.id, signature })).identity.address,
    ).toBe(a);
    const changed = s.issue(b, origin, {
      kind: "metamask",
      address: a,
      chainId: "0xa",
    });
    await expect(
      s.verify(b, origin, { id: changed.id, signature }),
    ).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
  });
  it("requires a valid NEP-413 proof and a current full-access key on the claimed NEAR account", async () => {
    const pk = "ed25519:" + address,
      calls: any[] = [];
    const s = make({
        nearKey: async (a: string, k: string) => {
          calls.push([a, k]);
          return "FullAccess";
        },
      }),
      b = s.createBrowser(),
      c = s.issue(b, origin, { kind: "near", address: "example.near" });
    const r = await s.verify(b, origin, {
      id: c.id,
      signature: nearSignature(c),
      publicKey: pk,
    });
    expect(r.identity.address).toBe("example.near");
    expect(calls).toEqual([["example.near", pk]]);
    for (const permission of [
      null,
      { FunctionCall: { receiver_id: "example.near" } },
    ]) {
      const s = make({ nearKey: async () => permission }),
        b = s.createBrowser(),
        c = s.issue(b, origin, { kind: "near", address: "example.near" });
      await expect(
        s.verify(b, origin, {
          id: c.id,
          signature: nearSignature(c),
          publicKey: pk,
        }),
      ).rejects.toMatchObject({ code: "KEY_NOT_AUTHORIZED" });
    }
  });
  it("fails closed on NEAR lookup errors and cannot finish login after logout during lookup", async () => {
    const bad = make({
        nearKey: async () => {
          throw Error("upstream unavailable");
        },
      }),
      bb = bad.createBrowser(),
      bc = bad.issue(bb, origin, { kind: "near", address: "example.near" });
    await expect(
      bad.verify(bb, origin, {
        id: bc.id,
        signature: nearSignature(bc),
        publicKey: "ed25519:" + address,
      }),
    ).rejects.toMatchObject({ code: "RPC_UNAVAILABLE" });
    let release!: (v: string) => void;
    const s = make({ nearKey: () => new Promise((r) => (release = r)) }),
      b = s.createBrowser(),
      c = s.issue(b, origin, { kind: "near", address: "example.near" });
    const pending = s.verify(b, origin, {
      id: c.id,
      signature: nearSignature(c),
      publicKey: "ed25519:" + address,
    });
    await expect(
      s.verify(b, origin, {
        id: c.id,
        signature: nearSignature(c),
        publicKey: "ed25519:" + address,
      }),
    ).rejects.toMatchObject({ code: "CHALLENGE_EXPIRED" });
    s.logout(b);
    release("FullAccess");
    await expect(pending).rejects.toMatchObject({ code: "CHALLENGE_EXPIRED" });
  });
  it("revokes every browser session on logout and rate-limits challenge spam", async () => {
    const s = make(),
      b = s.createBrowser(),
      c = s.issue(b, origin, { kind: "phantom", address });
    const r = await s.verify(b, origin, { id: c.id, signature: sign(c) });
    s.logout(b, r.token);
    expect(s.session(r.token)).toBeNull();
    const fresh = s.createBrowser();
    for (let i = 0; i < 6; i++)
      s.issue(fresh, origin, { kind: "phantom", address });
    expect(() => s.issue(fresh, origin, { kind: "phantom", address })).toThrow(
      /Too many/,
    );
  });
});
it("a newer challenge supersedes an in-flight NEAR verification", async () => {
  let release!: (v: string) => void;
  const s = make({ nearKey: () => new Promise((r) => (release = r)) }),
    b = s.createBrowser(),
    c = s.issue(b, origin, { kind: "near", address: "example.near" });
  const pending = s.verify(b, origin, {
    id: c.id,
    signature: nearSignature(c),
    publicKey: "ed25519:" + address,
  });
  s.issue(b, origin, { kind: "phantom", address });
  release("FullAccess");
  await expect(pending).rejects.toMatchObject({ code: "CHALLENGE_EXPIRED" });
});
it("logout revokes the browser binding even if only the session cookie remains", async () => {
  const s = make(),
    b = s.createBrowser(),
    c = s.issue(b, origin, { kind: "phantom", address });
  const login = await s.verify(b, origin, { id: c.id, signature: sign(c) });
  const later = s.issue(b, origin, { kind: "phantom", address });
  s.logout("", login.token);
  await expect(
    s.verify(b, origin, { id: later.id, signature: sign(later) }),
  ).rejects.toMatchObject({ code: "CHALLENGE_EXPIRED" });
  expect(s.session(login.token)).toBeNull();
});
