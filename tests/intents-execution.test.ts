import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  verifyQuoteSignature,
  quoteHash,
} from "@defuse-protocol/one-click-sdk-typescript";
import {
  IntentsExecution,
  validChainAddress,
} from "../apps/server/src/intents/execution.ts";
import { IntentsService } from "../apps/server/src/intents/service.ts";
import { MarketStore } from "../apps/server/src/market/store.ts";
import { intentsPhase } from "../packages/shared/src/intents-execution.ts";
const signed = JSON.parse(
  readFileSync("tests/fixtures/intents-mainnet-quote.json", "utf8"),
);
const near = {
    assetId: signed.quoteRequest.originAsset,
    symbol: "NEAR",
    decimals: 24,
    blockchain: "near" as const,
    contractAddress: "wrap.near",
  },
  sol = {
    assetId: signed.quoteRequest.destinationAsset,
    symbol: "USDC",
    decimals: 6,
    blockchain: "sol" as const,
    contractAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  };
function fixture(
  patch: (value: any) => any = (value) => value,
  verify = verifyQuoteSignature,
) {
  let now = Date.parse(signed.quoteRequest.deadline) - 600000,
    status = "PENDING_DEPOSIT",
    pause: (() => Promise<void>) | undefined;
  const store = new MarketStore(":memory:"),
    calls: any[] = [];
  const provider = {
    catalog: async () => ({
      assets: [near, sol],
      fetchedAt: new Date(now).toISOString(),
      originAsset: near.assetId,
      defaultDestination: sol.assetId,
    }),
    executableRequest: async (path: string, payload?: any) => {
      calls.push({ path, payload });
      if (path.startsWith("/status") && pause) await pause();
      return path === "/quote"
        ? patch(structuredClone(signed))
        : {
            quoteResponse: structuredClone(signed),
            status,
            swapDetails: { refundedAmount: "990000000000000000000000" },
          };
    },
  } as unknown as IntentsService;
  const api = new IntentsExecution(store, provider, () => now, verify),
    identity = {
      kind: "near" as const,
      address: signed.quoteRequest.refundTo,
      expiresAt: new Date(now + 3600000).toISOString(),
    },
    input = {
      requestId: crypto.randomUUID(),
      originAsset: near.assetId,
      destinationAsset: sol.assetId,
      amount: "1",
      recipient: signed.quoteRequest.recipient,
    };
  return {
    store,
    api,
    identity,
    input,
    calls,
    pauseStatus: (fn: () => Promise<void>) => {
      pause = fn;
    },
    advance: () => {
      now += 8000;
    },
    status: (s: string) => {
      status = s;
    },
  };
}
it("verifies the live unfunded production quote and rejects signed-field substitutions", () => {
  expect(verifyQuoteSignature(signed)).toBe(true);
  expect(
    verifyQuoteSignature({
      ...signed,
      quote: { ...signed.quote, depositAddress: "0".repeat(64) },
    }),
  ).toBe(false);
  expect(
    verifyQuoteSignature({
      ...signed,
      quoteRequest: { ...signed.quoteRequest, recipient: "wrong" },
    }),
  ).toBe(false);
});
it("binds wallet/recipient/amount, persists the full signed quote, and reuses the same request ID", async () => {
  const f = fixture();
  try {
    const op = await f.api.prepare(f.identity, f.input);
    expect(op.quoteHash).toBe(quoteHash(signed));
    expect(op.quoteResponse.signature).toBe(signed.signature);
    expect(op.appFeeBps).toBe(20);
    expect(Date.parse(op.fundBefore)).toBeLessThan(
      Date.parse(signed.quoteRequest.deadline),
    );
    expect(op.refundDeadline).toBe(signed.quote.deadline);
    expect((await f.api.prepare(f.identity, f.input)).id).toBe(op.id);
    expect(f.calls.filter((c) => c.path === "/quote")).toHaveLength(1);
    expect(() =>
      f.api.get({ ...f.identity, address: "other.near" }, op.id),
    ).toThrow("not found");
    await expect(
      f.api.prepare(f.identity, { ...f.input, recipient: "different" }),
    ).rejects.toThrow("Request ID");
  } finally {
    f.store.close();
  }
});
it("keeps pending/unknown funding locked and distinguishes failure from a confirmed net refund", async () => {
  const f = fixture();
  try {
    let op = await f.api.prepare(f.identity, f.input);
    op.fundingSignature = "original";
    op.phase = "unknown";
    f.api.save(op);
    f.advance();
    expect((await f.api.refresh(f.identity, op.id)).phase).toBe("unknown");
    await expect(
      f.api.prepare(f.identity, { ...f.input, requestId: crypto.randomUUID() }),
    ).rejects.toThrow("Reconcile");
    f.status("FAILED");
    f.advance();
    expect((await f.api.refresh(f.identity, op.id)).phase).toBe(
      "needs_attention",
    );
    f.status("REFUNDED");
    f.advance();
    op = await f.api.refresh(f.identity, op.id);
    expect(op.phase).toBe("refunded");
    expect(op.swapDetails.refundedAmount).not.toBe(op.amountIn);
  } finally {
    f.store.close();
  }
});
it("validates destination chain identities and never treats incomplete funding as refunded", () => {
  expect(validChainAddress("bsc", "0x" + "1".repeat(40))).toBe(true);
  expect(validChainAddress("near", "https://evil.example")).toBe(false);
  expect(validChainAddress("sol", "0x" + "1".repeat(40))).toBe(false);
  expect(intentsPhase("INCOMPLETE_DEPOSIT")).toBe("needs_attention");
});

it("retains terminal outcomes when the provider later returns a stale pending response", async () => {
  const f = fixture();
  try {
    const op = await f.api.prepare(f.identity, f.input);
    f.status("SUCCESS");
    f.advance();
    expect((await f.api.refresh(f.identity, op.id)).phase).toBe("success");
    f.status("PENDING_DEPOSIT");
    f.advance();
    expect((await f.api.refresh(f.identity, op.id)).phase).toBe("success");
    await f.api.notify(f.identity, op.id, "original");
    expect(f.api.get(f.identity, op.id).phase).toBe("success");
  } finally {
    f.store.close();
  }
});
it("does not erase a funding hash recorded while a status request was in flight", async () => {
  const f = fixture();
  try {
    const op = await f.api.prepare(f.identity, f.input);
    let release!: () => void;
    f.pauseStatus(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    f.advance();
    const pending = f.api.refresh(f.identity, op.id);
    const current = f.api.get(f.identity, op.id);
    current.fundingSignature = "original";
    current.phase = "unknown";
    f.api.save(current);
    release();
    expect((await pending).fundingSignature).toBe("original");
    expect(f.api.get(f.identity, op.id).phase).toBe("unknown");
  } finally {
    f.store.close();
  }
});

it("separately rejects unsigned excessive fees even when the provider signature remains valid", async () => {
  const altered = structuredClone(signed);
  altered.quoteRequest.appFees = [{ recipient: "fees.near", fee: 101 }];
  expect(verifyQuoteSignature(altered)).toBe(true);
  const f = fixture(() => altered);
  try {
    await expect(f.api.prepare(f.identity, f.input)).rejects.toThrow("fees");
    expect(f.api.list(f.identity)).toEqual([]);
  } finally {
    f.store.close();
  }
});
it("expires local funding without treating the later provider refund deadline as permission to fund", async () => {
  const f = fixture();
  try {
    const op = await f.api.prepare(f.identity, f.input);
    for (let i = 0; i < 8; i++) f.advance();
    expect(() => f.api.assertFundable(f.identity, op.id)).toThrow(
      "cannot be funded",
    );
  } finally {
    f.store.close();
  }
});

it("permits a new quote after a source transfer conclusively failed, while preserving its original receipt", async () => {
  const f = fixture();
  try {
    const op = await f.api.prepare(f.identity, f.input);
    op.phase = "funding_failed";
    op.fundingSignature = "failed-original";
    f.api.save(op);
    const next = await f.api.prepare(f.identity, {
      ...f.input,
      requestId: crypto.randomUUID(),
    });
    expect(next.id).not.toBe(op.id);
    expect(f.api.get(f.identity, op.id).fundingSignature).toBe(
      "failed-original",
    );
  } finally {
    f.store.close();
  }
});

it.each(["FAILED", "INCOMPLETE_DEPOSIT", "PROCESSING", "PENDING_DEPOSIT"])(
  "keeps an unresolved NEAR candidate locked after quote expiry and provider %s",
  async (status) => {
    const f = fixture();
    try {
      const op = await f.api.prepare(f.identity, f.input);
      op.nearCandidateHash = "unverified-original";
      op.phase = "awaiting_wallet";
      f.api.save(op);
      for (let i = 0; i < 8; i++) f.advance();
      f.status(status);
      await f.api.refresh(f.identity, op.id);
      await expect(
        f.api.prepare(f.identity, {
          ...f.input,
          requestId: crypto.randomUUID(),
        }),
      ).rejects.toThrow("Reconcile");
    } finally {
      f.store.close();
    }
  },
);
it.each(["FAILED", "INCOMPLETE_DEPOSIT", "PROCESSING"])(
  "keeps a claimed wallet approval locked independently of provider %s",
  async (status) => {
    const f = fixture();
    try {
      const op = await f.api.prepare(f.identity, f.input);
      (op as any).fundingRequestedAt = new Date().toISOString();
      op.phase = "awaiting_wallet";
      f.api.save(op);
      for (let i = 0; i < 8; i++) f.advance();
      f.status(status);
      await f.api.refresh(f.identity, op.id);
      await expect(
        f.api.prepare(f.identity, {
          ...f.input,
          requestId: crypto.randomUUID(),
        }),
      ).rejects.toThrow("Reconcile");
    } finally {
      f.store.close();
    }
  },
);

// These mode-binding tests use an explicitly mocked signature verifier because
// no funded or freshly provider-signed confidential quote is claimed here.
it("binds confidential mode to the quote, retry identity and stored funding operation", async () => {
  const f = fixture(
    (value) => {
      value.quoteRequest.confidentiality = "basic";
      return value;
    },
    () => true,
  );
  try {
    const input = { ...f.input, confidentiality: "basic" as const };
    const op = await f.api.prepare(f.identity, input);
    expect(f.calls[0].payload.confidentiality).toBe("basic");
    expect(op.confidentiality).toBe("basic");
    expect((await f.api.prepare(f.identity, input)).id).toBe(op.id);
    await expect(
      f.api.prepare(f.identity, { ...input, confidentiality: "public" }),
    ).rejects.toThrow("Request ID");
    expect(f.api.assertFundable(f.identity, op.id).confidentiality).toBe(
      "basic",
    );
    op.confidentiality = "public";
    f.api.save(op);
    expect(() => f.api.assertFundable(f.identity, op.id)).toThrow("verifies");
  } finally {
    f.store.close();
  }
});
it("rejects a provider public fallback rather than funding a different privacy mode", async () => {
  const f = fixture(
    (value) => value,
    () => true,
  );
  try {
    await expect(
      f.api.prepare(f.identity, { ...f.input, confidentiality: "basic" }),
    ).rejects.toThrow(/changed|routing/);
    expect(f.api.list(f.identity)).toHaveLength(0);
  } finally {
    f.store.close();
  }
});
it("still requires a valid provider signature for confidential quotes", async () => {
  const f = fixture((value) => {
    value.quoteRequest.confidentiality = "basic";
    value.signature = "invalid";
    return value;
  });
  try {
    await expect(
      f.api.prepare(f.identity, { ...f.input, confidentiality: "basic" }),
    ).rejects.toThrow("signature");
    expect(f.api.list(f.identity)).toHaveLength(0);
  } finally {
    f.store.close();
  }
});

it("records that the installed provider signature format does not attest confidentiality", () => {
  const changed = structuredClone(signed);
  changed.quoteRequest.confidentiality = "basic";
  expect(verifyQuoteSignature(changed)).toBe(true);
  expect(quoteHash(changed)).toBe(quoteHash(signed));
});
