import { it, expect, vi } from "vitest";
import { MarketStore } from "../apps/server/src/market/store.ts";
import { Outbox, expiryDecision } from "../apps/server/src/execution/outbox.ts";
it("persists signed bytes before relay, rebroadcasts identical bytes after restart and rejects replacement signatures", async () => {
  const s = new MarketStore(":memory:"),
    b = new Outbox(s);
  expect(() =>
    b.save("1", { wire: "AQID", signature: "sig", messageHash: "hash" }),
  ).not.toThrow();
  const reopened = new Outbox(s),
    sent: string[] = [];
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    await reopened.relay("1", async (bytes) => {
      sent.push(Buffer.from(bytes).toString("base64"));
      throw new Error("timeout after broadcast 10.4.1.9:8899 slot=3");
    });
    expect(reopened.read("1")?.state).toBe("unknown");
    // op.error mirrors this row into the panel, so it must stay our own copy.
    expect(reopened.read("1")?.error).toBe("Unacknowledged broadcast");
    expect(warn.mock.calls.join(" ")).toContain("slot=3");
    await reopened.relay("1", async (bytes) => {
      sent.push(Buffer.from(bytes).toString("base64"));
      return "sig";
    });
  } finally {
    warn.mockRestore();
  }
  expect(sent).toEqual(["AQID", "AQID"]);
  expect(() =>
    b.save("1", { wire: "BAUG", signature: "other", messageHash: "hash" }),
  ).toThrow();
  expect(() =>
    b.save("1", { wire: "AQID", signature: "sig", messageHash: "other" }),
  ).toThrow();
  s.close();
});
it("requires two distinct healthy finalized RPC observations beyond expiry with null statuses", () => {
  const a = {
    url: "https://one.example",
    healthy: true,
    genesisValid: true,
    height: 101,
    status: null,
  };
  expect(expiryDecision(100, [a])).toBe("unknown");
  expect(expiryDecision(100, [a, { ...a }])).toBe("unknown");
  expect(
    expiryDecision(100, [
      a,
      { ...a, url: "https://two.example", healthy: false },
    ]),
  ).toBe("unknown");
  expect(
    expiryDecision(100, [a, { ...a, url: "https://two.example", height: 99 }]),
  ).toBe("unknown");
  expect(
    expiryDecision(100, [
      a,
      {
        ...a,
        url: "https://two.example",
        status: { confirmationStatus: "confirmed" },
      },
    ]),
  ).toBe("unknown");
  expect(expiryDecision(100, [a, { ...a, url: "https://two.example" }])).toBe(
    "expired",
  );
});
