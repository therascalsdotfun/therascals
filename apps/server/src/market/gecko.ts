import bs58 from "bs58";
import { RequestScheduler } from "../routes/eligibility.ts";
import { clientMessage, UserError } from "../client-message.ts";
export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};
export type ChartRange = "1m" | "5m" | "1h";
export type SourceChart = {
  mint: string;
  pool: string;
  chain: "solana-mainnet";
  currency: "USD";
  source: "GeckoTerminal";
  range: ChartRange;
  fetchedAt: string;
  stale: boolean;
  error?: string;
  candles: Candle[];
};
export function validMint(value: string) {
  try {
    const b = bs58.decode(value);
    return b.length === 32 && bs58.encode(b) === value;
  } catch {
    return false;
  }
}
export function parseCandles(raw: unknown, now = Date.now()): Candle[] {
  if (!Array.isArray(raw)) throw new Error("Invalid OHLCV response");
  const unique = new Map<number, Candle>();
  for (const row of raw) {
    if (
      !Array.isArray(row) ||
      row.length !== 6 ||
      !row.every((x) => typeof x === "number" && Number.isFinite(x))
    )
      continue;
    const [time, open, high, low, close, volume] = row;
    if (
      !Number.isInteger(time) ||
      time <= 0 ||
      time > now / 1000 + 60 ||
      Math.min(open, high, low, close) <= 0 ||
      volume < 0 ||
      high < Math.max(open, close) ||
      low > Math.min(open, close) ||
      low > high
    )
      continue;
    unique.set(time, { time, open, high, low, close, volume });
  }
  return [...unique.values()].sort((a, b) => a.time - b.time);
}
const root = "https://api.geckoterminal.com/api/v2/networks/solana";
export class GeckoData {
  private scheduler: RequestScheduler;
  private cache = new Map<string, { at: number; body: any }>();
  private flights = new Map<string, Promise<any>>();
  private charts = new Map<string, SourceChart>();
  private backoff = 0;
  constructor(
    private fetcher: typeof fetch = fetch,
    interval = 7000,
    private now = () => Date.now(),
  ) {
    this.scheduler = new RequestScheduler(interval);
  }
  private async get(path: string, priority = 0): Promise<any> {
    const saved = this.cache.get(path);
    if (saved && this.now() - saved.at < 60000) return saved.body;
    if (this.flights.has(path)) return this.flights.get(path);
    const promise = this.scheduler
      .run(async () => {
        if (this.now() < this.backoff)
          throw new UserError("GeckoTerminal cooling down after rate limit");
        const r = await this.fetcher(root + path, {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(12000),
          redirect: "error",
        });
        if (!r.ok) {
          if (r.status === 429)
            this.backoff =
              this.now() +
              Math.max(60000, Number(r.headers.get("retry-after") ?? 0) * 1000);
          throw new Error("GeckoTerminal HTTP " + r.status);
        }
        const body = await r.json();
        if (body.errors) throw new Error("GeckoTerminal returned an error");
        this.cache.set(path, { at: this.now(), body });
        if (this.cache.size > 200)
          this.cache.delete(this.cache.keys().next().value!);
        return body;
      }, priority)
      .finally(() => this.flights.delete(path));
    this.flights.set(path, promise);
    return promise;
  }
  async newMints(): Promise<string[]> {
    const raw = await this.get(
      "/new_pools?include=base_token,quote_token&page=1",
    );
    if (!Array.isArray(raw.data)) throw new Error("Invalid new-pool response");
    return [
      ...new Set<string>(
        raw.data
          .flatMap((p: any) => [
            p.relationships?.base_token?.data?.id,
            p.relationships?.quote_token?.data?.id,
          ])
          .filter(
            (id: unknown) => typeof id === "string" && id.startsWith("solana_"),
          )
          .map((id: string) => id.slice(7))
          .filter(
            (m: string) =>
              validMint(m) &&
              ![
                "So11111111111111111111111111111111111111112",
                "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
              ].includes(m),
          ),
      ),
    ];
  }
  private async poolFor(mint: string, reference?: string): Promise<string> {
    if (!validMint(mint)) throw new Error("Invalid Solana mint");
    if (reference) {
      if (!validMint(reference)) throw Error("Invalid reference pool");
      const raw = await this.get(
          `/pools/${reference}?include=base_token,quote_token`,
          2,
        ),
        p = raw.data;
      if (
        p?.attributes?.address !== reference ||
        ![
          p?.relationships?.base_token?.data?.id,
          p?.relationships?.quote_token?.data?.id,
        ].includes("solana_" + mint)
      )
        throw Error("Selected reference pool is not indexed for this mint");
      return reference;
    }
    const raw = await this.get(
      `/tokens/${mint}/pools?include=base_token,quote_token&page=1`,
      2,
    );
    const pools = (Array.isArray(raw.data) ? raw.data : [])
      .filter(
        (p: any) =>
          validMint(p.attributes?.address ?? "") &&
          [
            p.relationships?.base_token?.data?.id,
            p.relationships?.quote_token?.data?.id,
          ].includes("solana_" + mint),
      )
      .sort(
        (a: any, b: any) =>
          Number(b.attributes.reserve_in_usd ?? 0) -
          Number(a.attributes.reserve_in_usd ?? 0),
      );
    const pool = pools[0]?.attributes.address;
    if (!pool) throw new Error("No indexed pool for this source token yet");
    return pool;
  }
  async trades(mint: string) {
    const pool = await this.poolFor(mint);
    const raw = await this.get(
      `/pools/${pool}/trades?token=${mint}&include_anomalous=false&trade_volume_in_usd_greater_than=1`,
    );
    if (!Array.isArray(raw.data))
      throw new Error("Invalid pool trades response");
    return { pool, rows: raw.data };
  }
  async chart(
    mint: string,
    range: ChartRange,
    reference?: string,
  ): Promise<SourceChart> {
    if (!validMint(mint)) throw new Error("Invalid Solana mint");
    const key = mint + ":" + range + ":" + (reference ?? "auto"),
      prior = this.charts.get(key);
    if (prior && this.now() - Date.parse(prior.fetchedAt) < 60000) return prior;
    try {
      const pool = await this.poolFor(mint, reference);
      const interval = range === "1h" ? "hour" : "minute",
        aggregate = range === "5m" ? 5 : 1;
      const body = await this.get(
        `/pools/${pool}/ohlcv/${interval}?aggregate=${aggregate}&limit=120&currency=usd&token=${mint}&include_empty_intervals=false`,
        2,
      );
      const chart: SourceChart = {
        mint,
        pool,
        chain: "solana-mainnet",
        currency: "USD",
        source: "GeckoTerminal",
        range,
        fetchedAt: new Date(this.now()).toISOString(),
        stale: false,
        candles: parseCandles(body.data?.attributes?.ohlcv_list, this.now()),
      };
      this.charts.set(key, chart);
      if (this.charts.size > 100)
        this.charts.delete(this.charts.keys().next().value!);
      return chart;
    } catch (e) {
      if (prior)
        return {
          ...prior,
          stale: true,
          error: clientMessage(e, "Chart provider unavailable.", "chart"),
        };
      throw e;
    }
  }
}
