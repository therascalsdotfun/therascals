import { randomBytes } from "node:crypto";

/** Third-party hosts the built page loads executable script from.
 * `apps/web/src/JupiterTrade.tsx` injects the Jupiter swap plugin. */
const scriptHosts = ["https://plugin.jup.ag"],
  baseline = "base-uri 'none'; object-src 'none'; frame-ancestors 'none'",
  nonceShape = /^[A-Za-z0-9+/]+={0,2}$/;

/** Standard base64, not base64url: @hot-labs/near-connect rebuilds the nonce it
 * puts on the wallet iframe through a `[^A-Za-z0-9+/=]` strip, so `-` and `_`
 * would silently shorten it and the bridge would stay blocked. */
export function newCspNonce() {
  return randomBytes(16).toString("base64");
}

/** Without a nonce the policy stays the baseline API responses already carry,
 * so only a document that can hand one to the page gets `script-src`. */
export function cspHeader(nonce?: string) {
  if (!nonce) return baseline;
  if (!nonceShape.test(nonce)) throw Error("Unusable CSP nonce");
  return (
    baseline +
    "; script-src 'self' " +
    scriptHosts.join(" ") +
    " 'nonce-" +
    nonce +
    "'"
  );
}

const headTag = /<head\b[^>]*>/i,
  existingMeta = /<meta\b[^>]*\bname=["']csp-nonce["'][^>]*>/i;

/** The nonce travels in a meta tag rather than on the entry script: once a
 * script element runs, the browser blanks its `nonce` attribute, so the common
 * `script[nonce]` read gives the connector an empty value and its `srcdoc`
 * iframe, which inherits this document's policy, never executes its bridge. */
export function withCspNonce(html: string, nonce: string) {
  if (!nonceShape.test(nonce)) throw Error("Unusable CSP nonce");
  const meta = `<meta name="csp-nonce" content="${nonce}">`;
  if (existingMeta.test(html)) return html.replace(existingMeta, meta);
  return html.replace(headTag, (head) => head + meta);
}
