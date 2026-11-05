import { expect, it } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BetaRegistry } from "../apps/server/src/beta/registry.ts";
import { MarketStore } from "../apps/server/src/market/store.ts";
import { executionPaths } from "../apps/server/src/execution/paths.ts";
const alice = {
    kind: "phantom" as const,
    address: "alice",
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  },
  bob = { ...alice, address: "bob" };
function fixture(claimPolicy?: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), "jackpot-registry-")),
    store = new MarketStore(join(dir, "state.sqlite"));
  const paths = (slot: string) => {
    const p = {
      ...executionPaths(slot),
      publicConfig: join(dir, slot + "-config.json"),
      privateConfig: join(dir, slot + "-private.json"),
      proof: join(dir, slot + "-proof.json"),
      ownerWallet: join(dir, slot + "-owner.json"),
    };
    if (slot === "beta01" || slot === "beta02") {
      writeFileSync(
        p.publicConfig,
        JSON.stringify({
          contractId: slot + ".owner.testnet",
          scopedPublicKey: slot,
          settlerAccount: "pay" + slot + ".owner.testnet",
          wasmSha256: "a".repeat(64),
        }),
      );
      writeFileSync(p.privateConfig, "{}", { mode: 0o600 });
      writeFileSync(p.ownerWallet!, "{}", { mode: 0o600 });
      writeFileSync(
        p.proof,
        JSON.stringify({
          contractId: slot + ".owner.testnet",
          wasmSha256: "a".repeat(64),
          buyFinalized: true,
          sellFinalized: true,
          ownerExitAfterRevocation: true,
          newBuyAfterRevocationRejected: true,
        }),
      );
    }
    return p;
  };
  let release!: () => void, finish!: () => void;
  const startGate = new Promise<void>((r) => (release = r)),
    fundGate = new Promise<void>((r) => (finish = r)),
    calls: string[] = [];
  const create = (slot: string, subject: string) => ({
    engine: {
      start: () => startGate,
      stop: () => {},
      snapshot: () => ({
        verified: true,
        ready: false,
        busy: false,
        positions: [],
        session: null,
        contractId: slot + ".owner.testnet",
        operation: { createdAt: "1970-01-01T00:00:00Z" },
        receipts: [
          { createdAt: "1970-01-01T00:00:00Z", signature: "operator-proof" },
        ],
      }),
      activate: async () => {
        calls.push(slot);
        await fundGate;
        throw Error("Unknown funding outcome");
      },
    } as any,
  });
  const registry = new BetaRegistry(store, {} as any, ["beta01", "beta02"], {
    paths,
    create,
    ...(claimPolicy ? { claimPolicy: claimPolicy as any } : {}),
  });
  return {
    registry,
    store,
    dir,
    paths,
    create,
    calls,
    release,
    finish,
    close() {
      registry.stop();
      store.close();
      rmSync(dir, { recursive: true });
    },
  };
}
it("blocks cold-start activation before reserving the daily funding slot", async () => {
  const f = fixture();
  f.registry.claim(alice);
  expect(f.registry.snapshot(alice).busy).toBe(true);
  expect(f.registry.snapshot(alice).receipts).toEqual([]);
  expect(f.registry.snapshot(alice).operation).toBeNull();
  await expect(f.registry.activate(alice)).rejects.toThrow(/warming|initial/i);
  expect(f.store.records("beta-funding:")).toHaveLength(0);
  f.release();
  await new Promise((r) => setTimeout(r, 0));
  const activation = f.registry.activate(alice);
  expect(f.calls).toEqual(["beta01"]);
  f.finish();
  await expect(activation).rejects.toThrow(/Unknown/);
  expect(f.store.records("beta-funding:")).toHaveLength(1);
  f.close();
});
it("serializes real registry funding across identities and keeps a failed reservation after disk reopen", async () => {
  const f = fixture();
  f.registry.claim(alice);
  f.registry.claim(bob);
  f.release();
  await new Promise((r) => setTimeout(r, 0));
  const activation = f.registry.activate(alice);
  await expect(f.registry.activate(bob)).rejects.toThrow(/progress/i);
  expect(f.calls).toEqual(["beta01"]);
  f.finish();
  await expect(activation).rejects.toThrow(/Unknown/);
  await expect(f.registry.activate(alice)).rejects.toThrow(/Daily/);
  f.registry.stop();
  f.store.close();
  const reopened = new MarketStore(join(f.dir, "state.sqlite")),
    registry = new BetaRegistry(reopened, {} as any, ["beta01", "beta02"], {
      paths: f.paths,
      create: f.create,
    });
  expect(registry.snapshot(alice).contractId).toBe("beta01.owner.testnet");
  expect(registry.snapshot(bob).contractId).toBe("beta02.owner.testnet");
  expect(registry.snapshot(null).positions).toEqual([]);
  await new Promise((r) => setTimeout(r, 0));
  await expect(registry.activate(alice)).rejects.toThrow(/Daily/);
  registry.stop();
  reopened.close();
  rmSync(f.dir, { recursive: true });
});

it("limits one network's sponsored claims through the registry and says so in the snapshot", async () => {
  const f = fixture({ allowlist: null, perNetworkPerDay: 1 });
  expect(f.registry.snapshot(alice).access.inviteOnly).toBe(false);
  f.registry.claim(alice, "198.51.100.4");
  expect(() => f.registry.claim(bob, "198.51.100.9")).toThrow(/daily share/i);
  expect(f.registry.snapshot(bob).access.claimed).toBe(false);
  expect(f.registry.snapshot(alice).access.claimed).toBe(true);
  f.close();
});

it("marks an invite-only beta in the snapshot before any claim is attempted", async () => {
  const f = fixture({ allowlist: ["bob"], perNetworkPerDay: 5 });
  expect(f.registry.snapshot(alice).access.inviteOnly).toBe(true);
  expect(() => f.registry.claim(alice, "198.51.100.4")).toThrow(/invited/i);
  f.registry.claim(bob, "198.51.100.4");
  expect(f.registry.snapshot(bob).access.claimed).toBe(true);
  f.close();
});

it("rejects an image whose WASM differs from admitted deployment proofs", () => {
  const f = fixture();
  expect(
    () =>
      new BetaRegistry(f.store, {} as any, ["beta01"], {
        paths: f.paths,
        create: f.create,
        expectedWasm: "b".repeat(64),
      }),
  ).toThrow(/proof/i);
  f.close();
});
