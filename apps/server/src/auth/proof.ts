import { createHash } from "node:crypto";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import type {
  AuthChallenge,
  WalletProof,
} from "../../../../packages/shared/src/wallet-auth.ts";
function nearPayload(c: AuthChallenge) {
  const str = (s: string) => {
    const b = Buffer.from(s, "utf8"),
      len = Buffer.alloc(4);
    len.writeUInt32LE(b.length);
    return Buffer.concat([len, b]);
  };
  const tag = Buffer.alloc(4);
  tag.writeUInt32LE(2147484061);
  return createHash("sha256")
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
}
export function validProof(c: AuthChallenge, proof: WalletProof): boolean {
  try {
    if (c.kind === "phantom")
      return nacl.sign.detached.verify(
        Buffer.from(c.message, "utf8"),
        bs58.decode(proof.signature),
        bs58.decode(c.address),
      );
    if (c.kind === "near") {
      if (
        !proof.publicKey?.startsWith("ed25519:") ||
        !/^[A-Za-z0-9+/]{86}==$/.test(proof.signature)
      )
        return false;
      return nacl.sign.detached.verify(
        nearPayload(c),
        Buffer.from(proof.signature, "base64"),
        bs58.decode(proof.publicKey.slice(8)),
      );
    }
    if (!/^0x[0-9a-fA-F]{130}$/.test(proof.signature)) return false;
    const bytes = Buffer.from(proof.signature.slice(2), "hex"),
      v = bytes[64],
      recovery = v >= 27 ? v - 27 : v;
    if (recovery !== 0 && recovery !== 1) return false;
    const msg = Buffer.from(c.message, "utf8"),
      hash = keccak_256(
        Buffer.concat([
          Buffer.from("\x19Ethereum Signed Message:\n" + msg.length),
          msg,
        ]),
      );
    const pub = secp256k1.Signature.fromCompact(bytes.subarray(0, 64))
      .addRecoveryBit(recovery)
      .recoverPublicKey(hash)
      .toRawBytes(false);
    return (
      "0x" +
        Buffer.from(keccak_256(pub.slice(1)).slice(-20)).toString("hex") ===
      c.address.toLowerCase()
    );
  } catch {
    return false;
  }
}
export async function nearFullAccessKey(
  account: string,
  publicKey: string,
): Promise<unknown> {
  const r = await fetch("https://rpc.mainnet.near.org", {
    method: "POST",
    redirect: "error",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "wallet-auth",
      method: "query",
      params: {
        request_type: "view_access_key",
        account_id: account,
        public_key: publicKey,
        finality: "final",
      },
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw Error("NEAR key lookup unavailable");
  const data = (await r.json()) as any;
  if (data.error) {
    const name = data.error?.cause?.name ?? data.error?.data?.name;
    if (["UNKNOWN_ACCESS_KEY", "UNKNOWN_ACCOUNT"].includes(name)) return null;
    throw Error("NEAR key lookup failed");
  }
  return data.result?.permission ?? null;
}
