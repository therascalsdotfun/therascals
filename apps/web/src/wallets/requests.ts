export class WalletRequestError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
const cancelled = () =>
  new WalletRequestError(
    "REQUEST_CANCELLED",
    "Request cancelled. Close the old wallet popup before trying again.",
  );
export function throwIfCancelled(signal?: AbortSignal) {
  if (signal?.aborted)
    throw signal.reason instanceof WalletRequestError
      ? signal.reason
      : cancelled();
}
export function walletRequest<T>(
  work: (signal: AbortSignal) => Promise<T>,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const ctl = new AbortController();
    let settled = false;
    const finish = (ok: boolean, value: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      ctl.signal.removeEventListener("abort", aborted);
      ok ? resolve(value as T) : reject(value);
    };
    const aborted = () => finish(false, ctl.signal.reason),
      abort = () =>
        ctl.abort(
          options.signal?.reason instanceof WalletRequestError
            ? options.signal.reason
            : cancelled(),
        );
    const timer = setTimeout(
      () =>
        ctl.abort(
          new WalletRequestError(
            "REQUEST_TIMEOUT",
            "Wallet request timed out. Close the old popup, unlock your wallet and try again.",
          ),
        ),
      options.timeoutMs ?? 60000,
    );
    ctl.signal.addEventListener("abort", aborted, { once: true });
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) {
      abort();
      return;
    }
    Promise.resolve()
      .then(() => {
        throwIfCancelled(ctl.signal);
        return work(ctl.signal);
      })
      .then(
        (v) => finish(true, v),
        (e) => finish(false, e),
      );
  });
}
export class WalletRequestGate {
  private controller: AbortController | null = null;
  get pending() {
    return this.controller !== null;
  }
  async run<T>(
    work: (signal: AbortSignal) => Promise<T>,
    timeoutMs = 60000,
  ): Promise<T> {
    if (this.controller)
      throw new WalletRequestError(
        "REQUEST_PENDING",
        "A request is already waiting in your wallet.",
      );
    const ctl = new AbortController();
    this.controller = ctl;
    try {
      return await walletRequest(work, { signal: ctl.signal, timeoutMs });
    } finally {
      if (this.controller === ctl) this.controller = null;
    }
  }
  cancel() {
    const ctl = this.controller;
    this.controller = null;
    ctl?.abort(cancelled());
  }
}
