import { BrandedTokenIcon, hasBrandedTokenIcon } from "./BrandedTokenIcon.tsx";
import {
  tokenTicker,
  tokenIconSymbol,
} from "../../../packages/shared/src/token-ticker.ts";
import { useEffect, useState, type CSSProperties } from "react";
import { PromotionTag, RiskDetails } from "./TokenScreening.tsx";
import type { TokenRisk } from "../../../packages/shared/src/token-security.ts";
import {
  tokenImageUrl,
  type DexToken,
} from "../../../packages/shared/src/token-media.ts";
// Virtual reel cards remount as they pass the pointer. Do not retry a blocked
// external image on every lap; keep a short, bounded negative cache.
const failedImages = new Map<string, number>();
export function TokenIcon({
  src,
  symbol,
  size = 40,
  branded = false,
}: {
  src?: string | null;
  symbol: string;
  size?: number;
  branded?: boolean;
}) {
  const url = tokenImageUrl(src),
    [failed, setFailed] = useState<string | null>(null);
  const recentlyFailed =
    !!url && Date.now() - (failedImages.get(url) ?? 0) < 60_000;
  return (
    <span
      className="token-art"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {url && url !== failed && !recentlyFailed ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => {
            failedImages.set(url, Date.now());
            if (failedImages.size > 256)
              failedImages.delete(failedImages.keys().next().value!);
            setFailed(url);
          }}
        />
      ) : branded && hasBrandedTokenIcon(symbol) ? (
        <BrandedTokenIcon symbol={symbol} size={size} />
      ) : (
        <span>{symbol.replace(/^\$+/, "").slice(0, 2)}</span>
      )}
    </span>
  );
}
/** Token art + normalized display ticker. Identity remains the exact mint. */
export function TokenTicker({
  symbol,
  src,
  size = 20,
  branded = false,
}: {
  symbol: string;
  src?: string | null;
  size?: number;
  branded?: boolean;
}) {
  return (
    <span
      className="token-ticker"
      style={
        { "--ticker-letters": tokenTicker(symbol).length } as CSSProperties
      }
    >
      <TokenIcon symbol={symbol} src={src} size={size} branded={branded} />
      <span>{tokenTicker(symbol)}</span>
    </span>
  );
}
const perpsArtwork = new Set([
  "BTC",
  "ETH",
  "SOL",
  "BNB",
  "XRP",
  "AVAX",
  "LINK",
  "LTC",
  "SUI",
  "APT",
  "ARB",
  "OP",
  "DOGE",
  "PEPE",
  "WIF",
  "BOME",
  "POPCAT",
  "TURBO",
  "BRETT",
  "MEW",
  "PENGU",
  "FARTCOIN",
  "TRUMP",
  "MEME",
]);
export function PerpsIcon({
  symbol,
  size = 32,
}: {
  symbol: string;
  size?: number;
}) {
  const asset = tokenIconSymbol(symbol);
  return (
    <TokenIcon
      symbol={symbol}
      size={size}
      branded
      src={
        hasBrandedTokenIcon(asset)
          ? undefined
          : perpsArtwork.has(asset)
            ? `https://app.hyperliquid.xyz/coins/${asset}.svg`
            : undefined
      }
    />
  );
}
export function PerpsTicker({
  symbol,
  size = 22,
}: {
  symbol: string;
  size?: number;
}) {
  const asset = tokenIconSymbol(symbol);
  return (
    <TokenTicker
      symbol={symbol}
      size={size}
      branded
      src={
        hasBrandedTokenIcon(asset)
          ? undefined
          : perpsArtwork.has(asset)
            ? `https://app.hyperliquid.xyz/coins/${asset}.svg`
            : undefined
      }
    />
  );
}
const money = (n: number | null) =>
  n === null
    ? "Unknown"
    : new Intl.NumberFormat("en", {
        style: "currency",
        currency: "USD",
        notation: n < 0.01 ? "standard" : "compact",
        maximumSignificantDigits: 4,
      }).format(n);
export function TokenDetails({
  mint,
  symbol,
  onMetadata,
}: {
  mint: string;
  symbol: string;
  onMetadata?: (record: DexToken) => void;
}) {
  const [risk, setRisk] = useState<TokenRisk | undefined>();
  useEffect(() => {
    const abort = new AbortController();
    setRisk(undefined);
    fetch("/api/security/" + mint, { signal: abort.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((r) => {
        if (!abort.signal.aborted && r?.mint === mint) setRisk(r);
      })
      .catch(() => {});
    return () => abort.abort();
  }, [mint]);
  const [record, setRecord] = useState<DexToken | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError("");
    setRecord(null);
    fetch("/api/tokens/" + mint, { signal: abort.signal })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error ?? "Token details unavailable");
        if (d.mint !== mint) throw Error("Token source mismatch");
        return d;
      })
      .then((d) => {
        if (!abort.signal.aborted) {
          setRecord(d);
          onMetadata?.(d);
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [mint, onMetadata]);
  const d = record?.mint === mint ? record : null;
  return (
    <div className="token-context">
      <div className="token-context-head">
        <TokenIcon src={d?.icon} symbol={d?.symbol ?? symbol} size={56} />
        <div>
          <strong>{d?.name ?? symbol}</strong>
          <PromotionTag dex={d} />
          <span>
            {tokenTicker(d?.symbol ?? symbol)} <i>Solana mainnet</i>
          </span>
        </div>
        <a
          className="text-link"
          href={"https://dexscreener.com/solana/" + (d?.pool ?? mint)}
          target="_blank"
          rel="noreferrer"
        >
          DEX Screener ↗
        </a>
      </div>
      <RiskDetails risk={risk} mint={mint} />
      {d ? (
        <>
          <div className="token-metrics">
            {[
              ["Market cap", d.marketCap],
              ["5m volume", d.volume5m],
              ["24h volume", d.volume24h],
              ["Pool liquidity", d.liquidity],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <span>{label}</span>
                <strong>{money(value as number | null)}</strong>
              </div>
            ))}
          </div>
          <p className="token-context-source">
            {d.stale ? "Cached · " : ""}DEX Screener · {d.dex} pool · retrieved{" "}
            {new Date(d.fetchedAt).toLocaleString()}. Pool metrics; filters use
            Jupiter token-wide data.
          </p>
        </>
      ) : (
        <p className="token-context-source">
          {loading ? "Loading DEX Screener token context…" : error}
        </p>
      )}
    </div>
  );
}
