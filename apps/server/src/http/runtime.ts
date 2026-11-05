import { isIP } from "node:net";
export type RuntimeOptions = {
  mode: "local" | "public" | "public-testnet";
  origins: Set<string>;
  slots: string[];
  /**
   * Always set by runtimeOptions(); hand-built options in tests and scripts
   * leave it out, which falls back to BetaAccess's own default policy.
   */
  beta?: BetaClaimPolicy;
};
export type BetaClaimPolicy = {
  /** Wallet addresses allowed to claim, when the beta is invite-only. */
  allowlist: string[] | null;
  /** New claims accepted per source network per day. */
  perNetworkPerDay: number;
};
export const localOrigins = new Set([
  "http://localhost:5177",
  "http://127.0.0.1:5177",
  "http://localhost:4317",
  "http://127.0.0.1:4317",
]);
export function validSlot(slot: string) {
  return /^beta0[1-8]$/.test(slot);
}
/**
 * Which peers may name a client address in `X-Forwarded-For`.
 *
 * Fastify's `trustProxy: true` believes the leftmost entry, which is whatever
 * the request itself wrote, so one header would reset every per-source limit;
 * its hop-count form disables header trust outright, which would pool every
 * player behind the proxy into one shared budget. Naming the proxy addresses is
 * the only form that honours the header for a real client while ignoring a
 * client-written prefix, so `1`/`true` expands to the same-host proxy and
 * anything that is not an address or CIDR fails at startup.
 */
export function trustedProxies(
  env: Record<string, string | undefined> = process.env,
): string | false {
  const raw = env.JACKPOT_TRUST_PROXY;
  if (!raw || raw === "0" || raw === "false") return false;
  if (raw === "1" || raw === "true")
    // The documented layout: a reverse proxy on this same host.
    return "127.0.0.1, ::1";
  const usage =
      "JACKPOT_TRUST_PROXY must be 0, 1, or a comma-separated list of proxy IP addresses or CIDRs",
    entries = raw.split(",").filter(Boolean);
  if (!entries.length) throw Error(usage);
  for (const entry of entries) {
    const parts = entry.trim().split("/"),
      address = parts[0],
      mask = parts[1],
      version = isIP(address);
    if (
      !version ||
      parts.length > 2 ||
      (mask !== undefined &&
        (!/^\d{1,3}$/.test(mask) || Number(mask) > (version === 6 ? 128 : 32)))
    )
      throw Error(usage);
  }
  return entries.map((entry) => entry.trim()).join(", ");
}
export function betaClaimPolicy(
  env: Record<string, string | undefined> = process.env,
): BetaClaimPolicy {
  const raw = env.JACKPOT_BETA_CLAIMS_PER_NETWORK_PER_DAY,
    perNetworkPerDay = raw === undefined ? 2 : Number(raw);
  if (!Number.isInteger(perNetworkPerDay) || perNetworkPerDay < 0)
    throw Error(
      "JACKPOT_BETA_CLAIMS_PER_NETWORK_PER_DAY must be a whole number, 0 to close claims",
    );
  const allowlist = env.JACKPOT_BETA_ALLOWLIST;
  return {
    // An empty list is a closed beta, not an unlisted one.
    allowlist:
      allowlist === undefined
        ? null
        : allowlist
            .split(",")
            .map((entry) => entry.trim().toLowerCase())
            .filter(Boolean),
    perNetworkPerDay,
  };
}
export function runtimeOptions(
  env: Record<string, string | undefined> = process.env,
): RuntimeOptions {
  const mode = env.JACKPOT_MODE ?? "local";
  if (mode !== "local" && mode !== "public" && mode !== "public-testnet")
    throw Error("Unknown JACKPOT_MODE");
  if (mode === "local") {
    if (env.HOST && !["127.0.0.1", "localhost", "::1"].includes(env.HOST))
      throw Error("Local operator mode must bind to loopback");
    return {
      mode,
      origins: new Set(localOrigins),
      slots: [],
      beta: betaClaimPolicy(env),
    };
  }
  let origin: URL;
  try {
    origin = new URL(env.JACKPOT_PUBLIC_ORIGIN ?? "");
  } catch {
    throw Error("Set JACKPOT_PUBLIC_ORIGIN to the exact HTTPS site origin");
  }
  if (
    origin.protocol !== "https:" ||
    origin.origin !== env.JACKPOT_PUBLIC_ORIGIN ||
    origin.username ||
    origin.password
  )
    throw Error(
      "Public origin must be an exact HTTPS origin without a path or credentials",
    );
  const slots = (env.JACKPOT_BETA_SLOTS ?? "").split(",").filter(Boolean);
  if (
    (mode === "public-testnet" && !slots.length) ||
    slots.length > 8 ||
    new Set(slots).size !== slots.length ||
    !slots.every(validSlot)
  )
    throw Error(
      "Configure 1–8 unique pre-provisioned slots: beta01 through beta08",
    );
  if (env.JACKPOT_VERIFY_EXECUTION === "1")
    throw Error("Smoke bypass is forbidden in public mode");
  return {
    mode,
    origins: new Set([origin.origin]),
    slots,
    beta: betaClaimPolicy(env),
  };
}
