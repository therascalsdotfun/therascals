import { it, expect } from "vitest";
import { WalletLifecycle } from "../apps/web/src/wallets/lifecycle.ts";
it("disconnect invalidates a pending connect result", () => {
  const life = new WalletLifecycle(),
    id = life.beginConnect();
  life.disconnect();
  expect(life.finishConnect(id, "old", "0x1")).toBeNull();
});
it("account and chain changes during connect replace the stale handshake identity", () => {
  const life = new WalletLifecycle(),
    id = life.beginConnect();
  life.accountChanged("latest");
  life.chainChanged("0xa");
  expect(life.finishConnect(id, "old", "0x1")).toEqual({
    address: "latest",
    chainId: "0xa",
  });
});
it("a silent restore cannot overwrite a newer account change or disconnect", () => {
  const life = new WalletLifecycle(),
    stamp = life.stamp();
  life.accountChanged("new");
  expect(life.isCurrent(stamp)).toBe(false);
  const next = life.stamp();
  life.disconnect();
  expect(life.isCurrent(next)).toBe(false);
});
it("newer account and chain reads invalidate older async responses", () => {
  const life = new WalletLifecycle(),
    first = life.accountChanged("new"),
    second = life.chainChanged("0xa");
  expect(life.isCurrent(first)).toBe(false);
  expect(life.isCurrent(second)).toBe(true);
});
