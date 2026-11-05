import { expect, it } from "vitest";
import { ExclusiveWallet } from "../apps/web/src/wallets/exclusive.ts";
it("keeps only the latest remembered connector and ignores inactive provider events", () => {
  const w = new ExclusiveWallet(["near", "phantom", "metamask"]);
  expect(w.current).toBe("metamask");
  expect(w.accepts("phantom")).toBe(false);
  w.select("phantom");
  expect(w.accepts("metamask")).toBe(false);
  expect(w.accepts("phantom")).toBe(true);
  w.select("near");
  expect(w.accepts("phantom")).toBe(false);
});
it("disconnect prevents late restoration and does not clear a newer selected connector", () => {
  const w = new ExclusiveWallet(["phantom"]);
  w.select("phantom");
  w.select("near");
  w.clear("phantom");
  expect(w.current).toBe("near");
  w.clear("near");
  expect(w.current).toBeNull();
  expect(w.accepts("phantom")).toBe(false);
});
