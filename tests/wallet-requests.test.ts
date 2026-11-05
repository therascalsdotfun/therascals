import { expect, it, vi } from "vitest";
import {
  WalletRequestGate,
  walletRequest,
} from "../apps/web/src/wallets/requests.ts";
it("cancels an unresponsive popup and ignores its late approval while allowing another request", async () => {
  const gate = new WalletRequestGate();
  let release!: (v: string) => void;
  const pending = gate.run(() => new Promise((r) => (release = r)));
  expect(gate.pending).toBe(true);
  await Promise.resolve();
  const rejected = expect(pending).rejects.toMatchObject({
    code: "REQUEST_CANCELLED",
  });
  gate.cancel();
  await rejected;
  expect(await gate.run(async () => "new")).toBe("new");
  release("stale");
  expect(gate.pending).toBe(false);
});
it("times out a request and aborts its work signal so late signatures cannot reach verification", async () => {
  vi.useFakeTimers();
  try {
    let observed: AbortSignal | undefined;
    const pending = walletRequest(
      (signal) => {
        observed = signal;
        return new Promise(() => {});
      },
      { timeoutMs: 100 },
    );
    const rejected = expect(pending).rejects.toMatchObject({
      code: "REQUEST_TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(101);
    await rejected;
    expect(observed?.aborted).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});
it("does not open a second popup while one is already pending", async () => {
  const gate = new WalletRequestGate(),
    pending = gate.run(() => new Promise(() => {}));
  const rejected = expect(pending).rejects.toMatchObject({
    code: "REQUEST_CANCELLED",
  });
  await expect(gate.run(async () => "second")).rejects.toMatchObject({
    code: "REQUEST_PENDING",
  });
  gate.cancel();
  await rejected;
});
