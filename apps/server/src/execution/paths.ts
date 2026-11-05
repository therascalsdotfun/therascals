import { validSlot } from "../http/runtime.ts";
export type ExecutionPaths = {
  publicConfig: string;
  privateConfig: string;
  proof: string;
  database: string;
  contractPrefix: string;
  settlerPrefix: string;
  ownerWallet?: string;
  marketManifest?: string;
};
export function executionPaths(slot?: string): ExecutionPaths {
  if (slot && !validSlot(slot)) throw Error("Invalid fixed beta slot");
  return slot
    ? {
        publicConfig: `.data/beta/${slot}/session-config.json`,
        privateConfig: `.credentials/beta/${slot}/execution.json`,
        proof: `docs/evidence/beta/${slot}/near-cpmm-smoke.json`,
        database: `.data/beta/${slot}/execution.sqlite`,
        contractPrefix: slot,
        settlerPrefix: "pay" + slot,
        ownerWallet: `.credentials/beta/${slot}/near-owner.json`,
        marketManifest: `.data/beta/${slot}/markets.json`,
      }
    : {
        publicConfig: "docs/evidence/session-config.json",
        privateConfig: ".credentials/execution.json",
        proof: "docs/evidence/near-cpmm-smoke.json",
        database: ".data/jackpot.sqlite",
        contractPrefix: "session",
        settlerPrefix: "settle",
      };
}
export const operatorPaths = executionPaths(process.env.JACKPOT_SLOT);
