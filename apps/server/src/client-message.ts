/**
 * Copy Jackpot wrote for a player, and the only message text safe to show them.
 * Domain error classes extend this; a bare `Error` describes somebody else's
 * system (a provider's own error string, an RPC fault with node internals) or a
 * bug in ours. Neither tells the player what to do about their action, and both
 * hand a scanner our internals.
 */
export class UserError extends Error {}

/**
 * The message to return to a browser. Anything outside the `UserError`
 * hierarchy is replaced by `fallback`; the original still reaches the operator's
 * log, named by `log`.
 */
export function clientMessage(e: unknown, fallback: string, log?: string) {
  if (e instanceof UserError) return e.message;
  if (log)
    console.warn(log + ":", e instanceof Error ? (e.stack ?? e.message) : e);
  return fallback;
}
