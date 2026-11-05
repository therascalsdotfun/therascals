import type {
  TokenObservation,
  RoutePair,
  RouteQuote,
} from "../../../../packages/shared/src/market.ts";
import { admissionReasons } from "../market/model.ts";
import { clientMessage, UserError } from "../client-message.ts";
export const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export class RequestScheduler {
  private queue: {
    fn: () => Promise<any>;
    resolve: (x: any) => void;
    reject: (e: unknown) => void;
    priority: number;
    sequence: number;
  }[] = [];
  private running = false;
  private sequence = 0;
  private priorityRuns = 0;
  private last = -Infinity;
  constructor(
    private interval = 2500,
    private now = () => Date.now(),
    private sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  ) {}
  run<T>(fn: () => Promise<T>, priority = 0): Promise<T> {
    if (this.queue.length >= 64)
      return Promise.reject(
        new UserError("Provider queue is busy. Try again shortly."),
      );
    return new Promise((resolve, reject) => {
      this.queue.push({
        fn,
        resolve,
        reject,
        priority,
        sequence: this.sequence++,
      });
      void this.drain();
    });
  }
  private async drain() {
    if (this.running) return;
    this.running = true;
    while (this.queue.length) {
      this.queue.sort((a, b) =>
        this.priorityRuns >= 3
          ? a.sequence - b.sequence
          : b.priority - a.priority || a.sequence - b.sequence,
      );
      const x = this.queue.shift()!;
      this.priorityRuns = x.priority > 0 ? this.priorityRuns + 1 : 0;
      const wait = this.last + this.interval - this.now();
      if (wait > 0) await this.sleep(wait);
      this.last = this.now();
      try {
        x.resolve(await x.fn());
      } catch (e) {
        x.reject(e);
      }
    }
    this.running = false;
  }
}
function parseQuote(
  raw: any,
  inputMint: string,
  outputMint: string,
  amount: string,
  now: number,
): RouteQuote {
  if (
    !raw ||
    raw.error ||
    raw.errorCode ||
    raw.transaction !== null ||
    raw.inputMint !== inputMint ||
    raw.outputMint !== outputMint ||
    raw.inAmount !== amount ||
    typeof raw.outAmount !== "string" ||
    !/^\d+$/.test(raw.outAmount) ||
    BigInt(raw.outAmount) <= 0n ||
    !Array.isArray(raw.routePlan) ||
    !raw.routePlan.length
  )
    throw new Error(raw?.error || "No valid quote-only route");
  return {
    inputMint,
    outputMint,
    inAmount: amount,
    outAmount: raw.outAmount,
    router: String(raw.router ?? "unknown"),
    routeLabels: raw.routePlan.map((x: any) =>
      String(x.swapInfo?.label ?? "Unknown venue"),
    ),
    feeBps: typeof raw.feeBps === "number" ? raw.feeBps : null,
    priceImpactPct:
      typeof raw.priceImpactPct === "string" ? raw.priceImpactPct : null,
    observedAt: now,
  };
}
export async function checkRoutePair(
  mint: string,
  ticketAtomic: string,
  get: (url: string) => Promise<unknown>,
  now = () => Date.now(),
): Promise<RoutePair> {
  const url = (a: string, b: string, n: string) =>
    `https://api.jup.ag/swap/v2/order?${new URLSearchParams({ inputMint: a, outputMint: b, amount: n })}`;
  try {
    const buy = parseQuote(
      await get(url(USDC, mint, ticketAtomic)),
      USDC,
      mint,
      ticketAtomic,
      now(),
    );
    const sell = parseQuote(
      await get(url(mint, USDC, buy.outAmount)),
      mint,
      USDC,
      buy.outAmount,
      now(),
    );
    const checkedAt = now();
    return {
      mint,
      ticketAtomic,
      status: "eligible",
      buy,
      sell,
      checkedAt,
      expiresAt: Math.min(buy.observedAt, sell.observedAt) + 90000,
      error: null,
    };
  } catch (e) {
    return {
      mint,
      ticketAtomic,
      status: "unavailable",
      buy: null,
      sell: null,
      checkedAt: now(),
      expiresAt: now() + 15000,
      error: clientMessage(e, "Trade provider unavailable.", "eligibility"),
    };
  }
}
export function selectPool(
  tokens: TokenObservation[],
  routes: Map<string, RoutePair>,
  ticket: string,
  now: number,
  limit = 8,
  included: string[] = [],
): TokenObservation[] {
  return [...new Map(tokens.map((t) => [t.mint, t])).values()]
    .filter((t) => {
      const r = routes.get(t.mint + ":" + ticket);
      return (
        !admissionReasons(t, now).length &&
        r?.status === "eligible" &&
        r.ticketAtomic === ticket &&
        r.mint === t.mint &&
        r.expiresAt > now
      );
    })
    .sort(
      (a, b) =>
        (included.includes(a.mint) ? included.indexOf(a.mint) : 1000) -
          (included.includes(b.mint) ? included.indexOf(b.mint) : 1000) ||
        (Date.parse(b.firstPoolCreatedAt ?? "") || 0) -
          (Date.parse(a.firstPoolCreatedAt ?? "") || 0) ||
        a.mint.localeCompare(b.mint),
    )
    .slice(0, Math.max(2, Math.min(32, limit)));
}
