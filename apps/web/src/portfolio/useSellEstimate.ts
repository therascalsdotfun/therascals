import { useEffect, useState } from "react";
import {
  matchesSellEstimate,
  type SellEstimate,
  type SellOutput,
} from "../../../../packages/shared/src/sell-output.ts";

export function useSellEstimate(
  enabled: boolean,
  inputMint: string,
  output: SellOutput,
  amount: string,
) {
  const [result, setResult] = useState<{
      key: string;
      quote?: SellEstimate;
      error?: string;
    }>(),
    [refresh, setRefresh] = useState(0),
    [clock, setClock] = useState(Date.now());
  const key = [inputMint, output, amount].join(":");
  useEffect(() => {
    if (!enabled) return;
    const abort = new AbortController();
    setResult(undefined);
    const timer = setTimeout(async () => {
      try {
        const r = await fetch("/api/mainnet/solana/sell-quote", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ inputMint, output, amount }),
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(35000)]),
        });
        const q = await r.json();
        if (!r.ok || !matchesSellEstimate(q, inputMint, output, amount))
          throw Error();
        if (!abort.signal.aborted) {
          setClock(Date.now());
          setResult({ key, quote: q });
        }
      } catch {
        if (!abort.signal.aborted)
          setResult({
            key,
            error:
              "No receive estimate available. Try another amount or receive token, or retry.",
          });
      }
    }, 450);
    // Drop expired estimates even when the user does not interact, then refresh.
    const interval = setInterval(() => {
      setClock(Date.now());
      setRefresh((n) => n + 1);
    }, 20000);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      abort.abort();
    };
  }, [enabled, key, refresh, inputMint, output, amount]);
  const quote =
    enabled &&
    result?.key === key &&
    matchesSellEstimate(result.quote, inputMint, output, amount, clock)
      ? result.quote
      : undefined;
  return {
    quote,
    error: enabled && result?.key === key ? result.error : undefined,
    retry: () => setRefresh((n) => n + 1),
  };
}
