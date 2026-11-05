import { it, expect, vi } from "vitest";
import { MarketStore } from "../apps/server/src/market/store.ts";
import { ExecutionService } from "../apps/server/src/execution/service.ts";
it("paces independent expiry RPC requests instead of bursting into public rate limits", async () => {
  vi.useFakeTimers();
  const starts: number[] = [],
    redirects: unknown[] = [];
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    starts.push(Date.now());
    redirects.push(init.redirect);
    const body = JSON.parse(String(init.body));
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result:
          body.method === "getGenesisHash"
            ? "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
            : 123,
      }),
      { headers: { "content-type": "application/json" } },
    );
  });
  const store = new MarketStore(":memory:");
  try {
    const e: any = new ExecutionService(store, {} as any);
    const calls = Promise.all([
      e.secondary.getGenesisHash(),
      e.secondary.getBlockHeight("finalized"),
    ]);
    await vi.advanceTimersByTimeAsync(4000);
    await calls;
    expect(starts).toHaveLength(2);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(3500);
    // A devnet RPC that redirected would move a signed transaction elsewhere.
    expect(redirects).toEqual(["error", "error"]);
  } finally {
    store.close();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});
