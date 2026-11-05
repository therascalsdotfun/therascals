import {
  assertNoPendingSolana,
  rememberSolanaSubmission,
} from "../solana-recovery.ts";
import { PublicKey } from "@solana/web3.js";
import { SOLANA_MAINNET_GENESIS } from "../../../../packages/shared/src/solana-network.ts";
import { phantomProvider } from "../wallets/providers.ts";
/** Same preflight and immutable-message safeguards as the wallet-approved buy path. */
export function sellWalletContext(options: {
  address: string;
  current: () => boolean;
  status: (s: string) => void;
  signing: (v: boolean) => void;
  connect: () => Promise<unknown>;
  disconnect: () => Promise<unknown>;
}) {
  const { address, current, status, signing } = options;
  const provider = phantomProvider();
  const assert = () => {
    if (!current() || provider?.publicKey?.toString() !== address)
      throw Error("Wallet, token or amount changed. Review the sale again.");
  };
  assert();
  async function sign(tx: any, batchSignatures?: string[]) {
    const batch = !!batchSignatures;
    assert();
    if (!batch) assertNoPendingSolana(address);
    signing(true);
    try {
      const bytes = tx.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      });
      if (bytes.length > 1232)
        throw Error(
          "Route exceeds the transaction size limit. Choose another route.",
        );
      status("Simulating on Solana mainnet…");
      const r = await fetch("/api/mainnet/solana/simulate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          wallet: address,
          transaction: btoa(
            Array.from(bytes as Uint8Array, (b) => String.fromCharCode(b)).join(
              "",
            ),
          ),
        }),
        signal: AbortSignal.timeout(20000),
      });
      const d = await r.json();
      if (!r.ok || d.status !== "passed")
        throw Error(d.error ?? "Preflight failed. No approval requested.");
      assert();
      const before = tx.message
        ? tx.message.serialize()
        : tx.serializeMessage();
      status(
        "Simulation passed. Review the exact amount and output in Phantom.",
      );
      const signed = await provider!.signTransaction(tx);
      const after = signed.message
        ? signed.message.serialize()
        : signed.serializeMessage();
      if (
        before.length !== after.length ||
        before.some((b: number, i: number) => b !== after[i])
      )
        throw Error(
          "Wallet returned a different transaction. Nothing was submitted by Rascals.",
        );
      assert();
      if (!batch) assertNoPendingSolana(address);
      const saved = await rememberSolanaSubmission(
        address,
        signed,
        d.blockhashSlot,
        undefined,
        batchSignatures ?? [],
      );
      batchSignatures?.push(saved.signature);
      return signed;
    } finally {
      signing(false);
    }
  }
  const adapter = {
    name: "Phantom",
    url: "https://phantom.app",
    icon: "https://phantom.app/favicon.ico",
    readyState: "Installed",
    publicKey: new PublicKey(address),
    connected: true,
    connecting: false,
    connect: options.connect,
    disconnect: options.disconnect,
    signTransaction: (tx: any) => sign(tx),
    signAllTransactions: async (txs: any[]) => {
      assertNoPendingSolana(address);
      const batchSignatures: string[] = [];
      const result = [];
      for (const tx of txs) result.push(await sign(tx, batchSignatures));
      return result;
    },
    sendTransaction: async (tx: any, c: any, opts: any) => {
      assert();
      if ((await c.getGenesisHash()) !== SOLANA_MAINNET_GENESIS)
        throw Error("Swap connection is not mainnet");
      return c.sendRawTransaction((await sign(tx)).serialize(), opts);
    },
  };
  return {
    wallets: [],
    wallet: { adapter, readyState: "Installed" },
    publicKey: adapter.publicKey,
    connected: true,
    connecting: false,
    disconnecting: false,
    autoConnect: false,
    select: () => {},
    connect: adapter.connect,
    disconnect: adapter.disconnect,
    signTransaction: adapter.signTransaction,
    signAllTransactions: adapter.signAllTransactions,
    sendTransaction: adapter.sendTransaction,
  };
}
