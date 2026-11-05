import {
  PublicKey,
  TransactionInstruction,
  Connection,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
export const CPMM_PROGRAM = new PublicKey(
  "DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb",
);
export const CONFIG = new PublicKey(
  "5MxLgy9oPdTC3YgkiePHqr3EoCRD9uLVYRQS2ANAs7wy",
);
export const CREATION_FEE_ACCOUNT = new PublicKey(
  "3oE58BKVt8KuYkGxx8zBojugnymWmBiyafWgMrnb6eYy",
);
export interface DemoMarket {
  id: string;
  symbol: string;
  program: string;
  config: string;
  pool: string;
  authority: string;
  observation: string;
  lpMint: string;
  mintUsdc: string;
  mintToken: string;
  mint0: string;
  mint1: string;
  vaultUsdc: string;
  vaultToken: string;
  decimals: number;
}
const pda = (seed: string, ...keys: PublicKey[]) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from(seed), ...keys.map((k) => k.toBuffer())],
    CPMM_PROGRAM,
  )[0];
export function deriveMarket(
  id: string,
  symbol: string,
  usdc: PublicKey,
  token: PublicKey,
): DemoMarket {
  const [a, b] = [usdc, token].sort((a, b) =>
      Buffer.compare(a.toBuffer(), b.toBuffer()),
    ),
    pool = pda("pool", CONFIG, a, b);
  return {
    id,
    symbol,
    program: CPMM_PROGRAM.toBase58(),
    config: CONFIG.toBase58(),
    pool: pool.toBase58(),
    authority: pda("vault_and_lp_mint_auth_seed").toBase58(),
    observation: pda("observation", pool).toBase58(),
    lpMint: pda("pool_lp_mint", pool).toBase58(),
    mintUsdc: usdc.toBase58(),
    mintToken: token.toBase58(),
    mint0: a.toBase58(),
    mint1: b.toBase58(),
    vaultUsdc: pda("pool_vault", pool, usdc).toBase58(),
    vaultToken: pda("pool_vault", pool, token).toBase58(),
    decimals: 6,
  };
}
const key = (
  pubkey: PublicKey | string,
  isWritable = false,
  isSigner = false,
) => ({
  pubkey: typeof pubkey === "string" ? new PublicKey(pubkey) : pubkey,
  isWritable,
  isSigner,
});
const u64 = (n: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
};
export function initializeInstruction(
  m: DemoMarket,
  creator: PublicKey,
  usdcAmount: bigint,
  tokenAmount: bigint,
) {
  const mint0 = new PublicKey(m.mint0),
    mint1 = new PublicKey(m.mint1),
    usdcIs0 = m.mintUsdc === m.mint0;
  return new TransactionInstruction({
    programId: CPMM_PROGRAM,
    data: Buffer.concat([
      Buffer.from("afaf6d1f0d989bed", "hex"),
      u64(usdcIs0 ? usdcAmount : tokenAmount),
      u64(usdcIs0 ? tokenAmount : usdcAmount),
      u64(0n),
    ]),
    keys: [
      key(creator, true, true),
      key(CONFIG),
      key(m.authority),
      key(m.pool, true),
      key(mint0),
      key(mint1),
      key(m.lpMint, true),
      key(getAssociatedTokenAddressSync(mint0, creator), true),
      key(getAssociatedTokenAddressSync(mint1, creator), true),
      key(
        getAssociatedTokenAddressSync(new PublicKey(m.lpMint), creator),
        true,
      ),
      key(usdcIs0 ? m.vaultUsdc : m.vaultToken, true),
      key(usdcIs0 ? m.vaultToken : m.vaultUsdc, true),
      key(CREATION_FEE_ACCOUNT, true),
      key(m.observation, true),
      key(TOKEN_PROGRAM_ID),
      key(TOKEN_PROGRAM_ID),
      key(TOKEN_PROGRAM_ID),
      key(ASSOCIATED_TOKEN_PROGRAM_ID),
      key(SystemProgram.programId),
      key(SYSVAR_RENT_PUBKEY),
    ],
  });
}
export function swapInstruction(
  m: DemoMarket,
  owner: PublicKey,
  buy: boolean,
  amount: bigint,
  minOut: bigint,
) {
  const input = new PublicKey(buy ? m.mintUsdc : m.mintToken),
    output = new PublicKey(buy ? m.mintToken : m.mintUsdc);
  return new TransactionInstruction({
    programId: CPMM_PROGRAM,
    data: Buffer.concat([
      Buffer.from("8fbe5adac41e33de", "hex"),
      u64(amount),
      u64(minOut),
    ]),
    keys: [
      key(owner, false, true),
      key(m.authority),
      key(m.config),
      key(m.pool, true),
      key(getAssociatedTokenAddressSync(input, owner), true),
      key(getAssociatedTokenAddressSync(output, owner), true),
      key(buy ? m.vaultUsdc : m.vaultToken, true),
      key(buy ? m.vaultToken : m.vaultUsdc, true),
      key(TOKEN_PROGRAM_ID),
      key(TOKEN_PROGRAM_ID),
      key(input),
      key(output),
      key(m.observation, true),
    ],
  });
}
export function quoteExactIn(
  amount: bigint,
  input: bigint,
  output: bigint,
  feeRate: bigint,
) {
  if (
    amount <= 0n ||
    input <= 0n ||
    output <= 0n ||
    feeRate < 0n ||
    feeRate >= 1000000n
  )
    throw new Error("Invalid reserves or input");
  const fee = (amount * feeRate + 999999n) / 1000000n,
    net = amount - fee,
    out = (net * output) / (input + net);
  if (out <= 0n) throw new Error("No executable output");
  return { fee, output: out };
}
export async function verifyAndQuote(
  c: Connection,
  m: DemoMarket,
  buy: boolean,
  amount: bigint,
) {
  const ids = [
      CPMM_PROGRAM,
      CONFIG,
      new PublicKey(m.pool),
      new PublicKey(m.vaultUsdc),
      new PublicKey(m.vaultToken),
    ],
    r = await c.getMultipleAccountsInfoAndContext(ids, {
      commitment: "finalized",
    }),
    [program, config, pool, a, b] = r.value;
  if (
    !program?.executable ||
    !config?.owner.equals(CPMM_PROGRAM) ||
    !pool?.owner.equals(CPMM_PROGRAM) ||
    !a?.owner.equals(TOKEN_PROGRAM_ID) ||
    !b?.owner.equals(TOKEN_PROGRAM_ID)
  )
    throw new Error("Unverified Devnet market accounts");
  const bytes = pool.data;
  if (
    bytes.length !== 637 ||
    new PublicKey(bytes.subarray(8, 40)).toBase58() !== m.config ||
    new PublicKey(bytes.subarray(168, 200)).toBase58() !== m.mint0 ||
    new PublicKey(bytes.subarray(200, 232)).toBase58() !== m.mint1 ||
    new PublicKey(bytes.subarray(296, 328)).toBase58() !== m.observation ||
    (bytes[329] & 4) !== 0 ||
    bytes[390] !== 0
  )
    throw new Error("Pool configuration differs from fixed market");
  const is0 = m.mintUsdc === m.mint0,
    fees0 =
      bytes.readBigUInt64LE(341) +
      bytes.readBigUInt64LE(357) +
      bytes.readBigUInt64LE(397),
    fees1 =
      bytes.readBigUInt64LE(349) +
      bytes.readBigUInt64LE(365) +
      bytes.readBigUInt64LE(405),
    reserveU = a.data.readBigUInt64LE(64) - (is0 ? fees0 : fees1),
    reserveT = b.data.readBigUInt64LE(64) - (is0 ? fees1 : fees0),
    feeRate = config.data.readBigUInt64LE(12);
  const q = quoteExactIn(
    amount,
    buy ? reserveU : reserveT,
    buy ? reserveT : reserveU,
    feeRate,
  );
  return {
    ...q,
    minOut: (q.output * 98n) / 100n,
    reserveUsdc: reserveU,
    reserveToken: reserveT,
    feeRate,
    slot: r.context.slot,
  };
}
