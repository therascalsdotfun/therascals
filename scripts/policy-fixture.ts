import { writeFileSync, mkdirSync } from "node:fs";
import { Keypair } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { deriveMarket } from "../apps/server/src/execution/cpmm.ts";
import { canonicalSwapMessage } from "../apps/server/src/execution/policy-wire.ts";
const source = Keypair.fromSeed(new Uint8Array(32).fill(3)).publicKey,
  u = Keypair.fromSeed(new Uint8Array(32).fill(1)).publicKey,
  t = Keypair.fromSeed(new Uint8Array(32).fill(2)).publicKey,
  m = deriveMarket("demo-1", "DEMO-1", u, t),
  usdcAta = getAssociatedTokenAddressSync(u, source).toBase58(),
  tokenAta = getAssociatedTokenAddressSync(t, source).toBase58(),
  blockhash = u.toBase58();
mkdirSync("tests/fixtures", { recursive: true });
writeFileSync(
  "tests/fixtures/policy-wire.json",
  JSON.stringify(
    {
      source: source.toBase58(),
      usdcAta,
      tokenAta,
      blockhash,
      amount: "5000000",
      minOut: "4000000000",
      addresses: [
        m.pool,
        m.vaultUsdc,
        m.vaultToken,
        m.observation,
        m.authority,
        m.config,
        m.mintUsdc,
        m.mintToken,
      ],
      feeVaultAta: Keypair.fromSeed(
        new Uint8Array(32).fill(4),
      ).publicKey.toBase58(),
      feeBuyHex: canonicalSwapMessage(
        m,
        source.toBase58(),
        usdcAta,
        tokenAta,
        true,
        "5000000",
        "4000000000",
        blockhash,
        Keypair.fromSeed(new Uint8Array(32).fill(4)).publicKey.toBase58(),
      ).toString("hex"),
      buyHex: canonicalSwapMessage(
        m,
        source.toBase58(),
        usdcAta,
        tokenAta,
        true,
        "5000000",
        "4000000000",
        blockhash,
      ).toString("hex"),
      sellHex: canonicalSwapMessage(
        m,
        source.toBase58(),
        usdcAta,
        tokenAta,
        false,
        "5000000",
        "4000",
        blockhash,
      ).toString("hex"),
    },
    null,
    2,
  ),
);
