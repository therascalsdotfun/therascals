import type {
  IntentsAsset,
  IntentsCatalog,
  IntentsDryQuote,
  HyperliquidCollateral,
  HyperliquidFundingQuote,
} from "../../../../packages/shared/src/intents.ts";
import { HYPERLIQUID_PERPS_USDC } from "../../../../packages/shared/src/intents.ts";
import { validMint } from "../market/gecko.ts";

const BASE = "https://1click.chaindefuser.com/v0";
import { tokenImageUrl } from "../../../../packages/shared/src/token-media.ts";
const ORIGIN = "nep141:wrap.near";
const SOL_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
// Pricing-only placeholders used exclusively by quote(). Executable operations
// use verified wallet routing in execution.ts and never reuse these addresses.
const PREVIEW_REFUND = "0".repeat(64);
const PREVIEW_RECIPIENT = "GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB";
import { UserError } from "../client-message.ts";
export class IntentsError extends UserError {
  constructor(
    message: string,
    readonly status = 503,
    readonly details?: {
      code: "PROVIDER_MINIMUM_USD";
      minimumUsd: string;
      exceedsTradeCap: boolean;
    },
  ) {
    super(message);
  }
}
/** Recognize a bounded known error shape; never reflect arbitrary provider text. */
function providerMinimum(raw: unknown): IntentsError | null {
  const message = (raw as any)?.message;
  if (typeof message !== "string" || message.length > 100) return null;
  const match =
    /^(?:Temporary swap limits:\s*)?minimum swap amount is \$((?:[1-9]\d{0,2}(?:,\d{3})+|(?:0|[1-9]\d{0,8}))(?:\.\d{1,2})?)\.?$/i.exec(
      message,
    );
  if (!match) return null;
  const minimumUsd = match[1].replaceAll(",", ""),
    amount = Number(minimumUsd);
  if (!(amount > 0) || amount > 1e9) return null;
  const exceedsTradeCap = amount > 100;
  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(amount);
  return new IntentsError(
    `Provider minimum for this route is $${formatted}. ${exceedsTradeCap ? "This exceeds Rascals' $100 trade cap. " : ""}Nothing was funded.`,
    422,
    { code: "PROVIDER_MINIMUM_USD", minimumUsd, exceedsTradeCap },
  );
}
export function nearQuoteAmount(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^(?:0|[1-9]\d{0,2})(?:\.\d{1,6})?$/.test(value)
  )
    throw new IntentsError(
      "Use 0.1–100 NEAR, with at most six decimal places.",
      400,
    );
  const [whole, fraction = ""] = value.split(".");
  const atomic = BigInt(whole) * 10n ** 24n + BigInt(fraction.padEnd(24, "0"));
  if (atomic < 10n ** 23n || atomic > 100n * 10n ** 24n)
    throw new IntentsError("Use 0.1–100 NEAR for this quote preview.", 400);
  return String(atomic);
}
export async function jsonBounded(response: Response): Promise<any> {
  if (!response.body)
    throw new IntentsError("Empty Intents response. Try again.");
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1_000_000) {
        await reader.cancel();
        throw new IntentsError("Intents response exceeded its limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(body));
}
export function parseIntentsCatalog(raw: unknown, now: number): IntentsCatalog {
  if (!Array.isArray(raw) || raw.length > 10000)
    throw new IntentsError("Invalid Intents asset catalog.");
  const assets = new Map<string, IntentsAsset>();
  let perpsCollateral: HyperliquidCollateral | undefined;
  for (const item of raw) {
    if (item?.assetId === HYPERLIQUID_PERPS_USDC) {
      if (
        perpsCollateral ||
        item.blockchain !== "hypercore" ||
        item.symbol !== "USDC" ||
        item.decimals !== 8 ||
        item.contractAddress !== "0x6d1e7cde53ba9467b783cb7c530ce054"
      )
        throw new IntentsError("Unexpected Hyperliquid collateral identity.");
      perpsCollateral = {
        assetId: item.assetId,
        symbol: "USDC",
        decimals: 8,
        blockchain: "hypercore",
        contractAddress: item.contractAddress,
      };
    }
    if (
      !item ||
      !["near", "sol", "base", "bsc"].includes(item.blockchain) ||
      typeof item.assetId !== "string" ||
      !/^[a-zA-Z0-9_:.-]{1,250}$/.test(item.assetId) ||
      typeof item.symbol !== "string" ||
      !item.symbol.trim() ||
      item.symbol.length > 40 ||
      !Number.isInteger(item.decimals) ||
      item.decimals < 0 ||
      item.decimals > 30 ||
      (["base", "bsc"].includes(item.blockchain) &&
        !/^0x[a-fA-F0-9]{40}$/.test(item.contractAddress ?? "")) ||
      (item.blockchain === "sol" &&
        item.contractAddress != null &&
        !validMint(item.contractAddress))
    )
      continue;
    if (assets.has(item.assetId))
      throw new IntentsError("Ambiguous Intents asset catalog.");
    assets.set(item.assetId, {
      assetId: item.assetId,
      symbol: item.symbol,
      icon: tokenImageUrl(item.icon ?? item.iconUrl ?? item.logoURI),
      decimals: item.decimals,
      blockchain: item.blockchain,
      ...(typeof item.contractAddress === "string"
        ? { contractAddress: item.contractAddress.slice(0, 100) }
        : {}),
    });
  }
  const origin = assets.get(ORIGIN),
    destination = [...assets.values()].find(
      (a) => a.blockchain === "sol" && a.contractAddress === SOL_USDC,
    );
  if (
    origin?.blockchain !== "near" ||
    origin.decimals !== 24 ||
    !destination ||
    destination.decimals !== 6
  )
    throw new IntentsError(
      "Intents funding assets are unavailable. Try again later.",
    );
  return {
    assets: [...assets.values()],
    fetchedAt: new Date(now).toISOString(),
    originAsset: ORIGIN,
    defaultDestination: destination.assetId,
    ...(perpsCollateral ? { perpsCollateral } : {}),
  };
}
export class IntentsService {
  private cache?: IntentsCatalog;
  private catalogFlight?: Promise<IntentsCatalog>;
  private quoting = false;
  private nextQuoteAt = 0;
  private cooldown = 0;
  constructor(
    private fetcher: typeof fetch = fetch,
    private now = () => Date.now(),
    private apiKey = process.env.NEAR_INTENTS_API_KEY,
  ) {}
  private async request(
    path: "/tokens" | "/quote" | "/deposit/submit" | `/status?${string}`,
    payload?: unknown,
  ) {
    if (this.now() < this.cooldown)
      throw new IntentsError(
        "NEAR Intents is cooling down after a rate limit. Try again in a minute.",
        429,
      );
    let response: Response;
    try {
      response = await this.fetcher(BASE + path, {
        method: payload ? "POST" : "GET",
        signal: AbortSignal.timeout(12000),
        headers: {
          accept: "application/json",
          ...(payload ? { "content-type": "application/json" } : {}),
          ...(this.apiKey ? { "X-API-Key": this.apiKey } : {}),
        },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
        redirect: "error",
      });
    } catch {
      throw new IntentsError(
        "NEAR Intents did not respond. Try the quote again.",
      );
    }
    if (!response.ok) {
      if (response.status === 429) {
        this.cooldown = this.now() + 60000;
        throw new IntentsError(
          "NEAR Intents is rate limited. Try again in a minute.",
          429,
        );
      }
      if ([401, 403].includes(response.status)) {
        if (path === "/quote" && (payload as any)?.confidentiality === "basic")
          throw new IntentsError(
            "Confidential quote access is not available for this integration yet. No swap was funded.",
            503,
          );
        throw new IntentsError(
          "NEAR Intents quote access needs a configured provider key.",
        );
      }
      if (response.status === 400) {
        if (path === "/quote") {
          let known: IntentsError | null = null;
          try {
            known = providerMinimum(await jsonBounded(response));
          } catch {
            /* Use the generic error for malformed/unbounded provider output. */
          }
          if (known) throw known;
        }
        throw new IntentsError(
          "NEAR Intents rejected this amount or pair. Try a different supported asset or amount.",
          422,
        );
      }
      throw new IntentsError(
        "NEAR Intents quote is unavailable. Try again later.",
      );
    }
    try {
      return await jsonBounded(response);
    } catch (e) {
      if (e instanceof IntentsError) throw e;
      throw new IntentsError("Invalid NEAR Intents response. Try again.");
    }
  }
  async executableRequest(
    path: "/quote" | "/deposit/submit" | `/status?${string}`,
    payload?: unknown,
  ) {
    return this.request(path, payload);
  }
  async catalog(): Promise<IntentsCatalog> {
    if (this.cache && this.now() - Date.parse(this.cache.fetchedAt) < 300000)
      return this.cache;
    if (this.catalogFlight) return this.catalogFlight;
    this.catalogFlight = this.request("/tokens")
      .then((raw) => (this.cache = parseIntentsCatalog(raw, this.now())))
      .finally(() => {
        this.catalogFlight = undefined;
      });
    return this.catalogFlight;
  }
  async quote(
    destinationAsset: string,
    amount: string,
  ): Promise<IntentsDryQuote> {
    nearQuoteAmount(amount);
    const catalog = await this.catalog();
    const destination = catalog.assets.find(
      (a) =>
        a.assetId === destinationAsset && a.assetId !== catalog.originAsset,
    );
    if (!destination)
      throw new IntentsError(
        "Choose an exact supported destination asset from the Intents catalog.",
        400,
      );
    return this.dryQuote(destination, amount);
  }
  async hyperliquidQuote(amount: string): Promise<HyperliquidFundingQuote> {
    nearQuoteAmount(amount);
    const destination = (await this.catalog()).perpsCollateral;
    if (!destination)
      throw new IntentsError(
        "Hyperliquid perps collateral is not available in the provider catalog.",
      );
    return this.dryQuote(destination, amount);
  }
  private async dryQuote<D extends IntentsAsset | HyperliquidCollateral>(
    destination: D,
    amount: string,
  ): Promise<Omit<IntentsDryQuote, "destination"> & { destination: D }> {
    const atomic = nearQuoteAmount(amount);
    const catalog = await this.catalog();
    const origin = catalog.assets.find(
      (a) => a.assetId === catalog.originAsset,
    )!;
    const destinationAsset = destination.assetId;
    if (this.quoting || this.now() < this.nextQuoteAt)
      throw new IntentsError(
        "A quote is already running. Try again shortly.",
        429,
      );
    this.quoting = true;
    this.nextQuoteAt = this.now() + 1000;
    const recipient =
      destination.blockchain === "sol"
        ? PREVIEW_RECIPIENT
        : destination.blockchain === "near"
          ? PREVIEW_REFUND
          : "0x" + "1".repeat(40);
    const payload = {
      dry: true,
      swapType: "EXACT_INPUT",
      slippageTolerance: 100,
      originAsset: origin.assetId,
      depositType: "ORIGIN_CHAIN",
      destinationAsset,
      amount: atomic,
      refundTo: PREVIEW_REFUND,
      refundType: "ORIGIN_CHAIN",
      recipient,
      recipientType: "DESTINATION_CHAIN",
      deadline: new Date(this.now() + 600000).toISOString(),
    };
    try {
      const result = await this.request("/quote", payload),
        q = result?.quote,
        echo = result?.quoteRequest;
      if (
        !q ||
        !echo ||
        Object.hasOwn(q, "depositAddress") ||
        Object.hasOwn(result, "depositAddress") ||
        echo.dry !== true ||
        echo.originAsset !== origin.assetId ||
        echo.destinationAsset !== destinationAsset ||
        echo.amount !== atomic ||
        echo.swapType !== "EXACT_INPUT" ||
        echo.slippageTolerance !== 100 ||
        echo.depositType !== "ORIGIN_CHAIN" ||
        echo.recipientType !== "DESTINATION_CHAIN" ||
        echo.refundType !== "ORIGIN_CHAIN" ||
        echo.recipient !== recipient ||
        echo.refundTo !== PREVIEW_REFUND ||
        q.amountIn !== atomic ||
        ![q.amountOut, q.minAmountOut].every(
          (v) => typeof v === "string" && /^[1-9]\d{0,79}$/.test(v),
        ) ||
        BigInt(q.minAmountOut) > BigInt(q.amountOut) ||
        !Number.isFinite(Date.parse(result.timestamp)) ||
        Math.abs(this.now() - Date.parse(result.timestamp)) > 120000 ||
        !Array.isArray(echo.appFees) ||
        echo.appFees.some(
          (fee: any) =>
            !Number.isInteger(fee.fee) || fee.fee < 0 || fee.fee > 10000,
        )
      )
        throw new IntentsError(
          "Intents returned an unexpected or non-dry quote. Nothing was submitted.",
        );
      const fees = echo.appFees.reduce(
        (sum: number, fee: any) => sum + fee.fee,
        0,
      );
      if (fees > 10000) throw new IntentsError("Invalid Intents fee response.");
      return {
        dry: true,
        network: "mainnet",
        origin,
        destination,
        amountIn: atomic,
        amountOut: q.amountOut,
        minAmountOut: q.minAmountOut,
        observedAt: new Date(this.now()).toISOString(),
        refreshAfter: new Date(this.now() + 30000).toISOString(),
        providerAt: new Date(result.timestamp).toISOString(),
        timeEstimateSeconds:
          Number.isFinite(q.timeEstimate) && q.timeEstimate >= 0
            ? q.timeEstimate
            : null,
        appFeeBps: fees,
        slippageBps: 100,
      };
    } finally {
      this.quoting = false;
    }
  }
}
