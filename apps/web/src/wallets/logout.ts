import { throwIfCancelled, WalletRequestError } from "./requests.ts";
/** Idempotent sign-out. Never treat an HTML/proxy response as session revocation. */
export async function confirmLogout(
  signal: AbortSignal,
  request: typeof fetch = fetch,
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    throwIfCancelled(signal);
    let response: Response;
    try {
      response = await request("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { accept: "application/json" },
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (attempt === 0) continue;
      throw new WalletRequestError(
        "LOGOUT_NETWORK",
        "The sign-out server could not be reached.",
      );
    }
    if (response.status >= 500 && attempt === 0) continue;
    if (!response.ok)
      throw new WalletRequestError(
        response.status === 403
          ? "LOGOUT_ORIGIN"
          : response.status === 429
            ? "LOGOUT_RATE_LIMITED"
            : "LOGOUT_SERVER",
        "Server did not confirm sign-out.",
      );
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new WalletRequestError(
        "LOGOUT_RESPONSE",
        "Unexpected sign-out response.",
      );
    }
    if (
      !body ||
      typeof body !== "object" ||
      !("identity" in body) ||
      body.identity !== null
    )
      throw new WalletRequestError(
        "LOGOUT_RESPONSE",
        "Unexpected sign-out response.",
      );
    return;
  }
}
