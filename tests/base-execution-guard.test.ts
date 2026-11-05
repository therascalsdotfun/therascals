import { expect, it } from "vitest";
import { ExecutionService } from "../apps/server/src/execution/service.ts";
import { MarketStore } from "../apps/server/src/market/store.ts";
import { commitRoll, settleRoll } from "../apps/server/src/routes/manifest.ts";
/**
 * Runs the real committed-roll derivation over the stub field so these guards
 * are exercised against the same settle path production uses, not a mock.
 */
const settleField = (chains: string[]) => {
  const snapshot = {
    filters: { chains },
    ticketAtomic: "1000000",
    configurationHash: "a".repeat(64),
    now: new Date().toISOString(),
    pool: chains.flatMap((chain, c) =>
      [0, 1].map((i) => ({
        chain,
        mint: chain === "solana" ? `SOL${c}${i}` : `0x${c}${i}`.padEnd(42, "0"),
      })),
    ),
  } as any;
  const roll = commitRoll(snapshot, snapshot.configurationHash, "fixed");
  return () => ({ roll, snapshot, preview: settleRoll(snapshot, roll) });
};
it.each([
  { chains: ["base"] },
  { chains: ["solana", "base"] },
  { chains: ["bsc"] },
  { chains: ["near"] },
  { chains: ["solana", "base", "bsc", "near"] },
])(
  "rejects $chains pools before storing or authorizing a test draw",
  async ({ chains }) => {
    const store = new MarketStore(":memory:");
    const e: any = new ExecutionService(store, {
      snapshot: () => ({
        filters: { chains },
        pool: [],
        configurationHash: "a".repeat(64),
      }),
      settleForExecution: settleField(chains),
    } as any);
    e.verified = () => true;
    e.refresh = async () => {
      e.chain = {
        session: {
          issued: "0",
          expires_ms: Date.now() + 60000,
          revoked: false,
          pending: null,
        },
      };
    };
    try {
      await expect(e.draw("roll-test", "reveal")).rejects.toThrow(
        /preview-only/,
      );
      expect(store.getRecord("execution-current")).toBe(null);
    } finally {
      store.close();
    }
  },
);
