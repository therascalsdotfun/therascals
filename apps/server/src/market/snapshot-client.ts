import { Worker } from "node:worker_threads";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import type {
  MarketResponse,
  TokenObservation,
} from "../../../../packages/shared/src/market.ts";
import type { DiscoveryConfiguration } from "./service.ts";
import type { SnapshotOptions, SnapshotReadState } from "./snapshot-state.ts";
export class SnapshotReader {
  private worker?: Worker;
  private sequence = 0;
  private pending = new Map<
    number,
    {
      resolve: (x: unknown) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private flights = new Map<string, Promise<unknown>>();
  constructor(private database: string) {}
  private start() {
    if (this.worker) return this.worker;
    const worker = new Worker(
      new URL("./snapshot-reader.mjs", import.meta.url),
      { workerData: { database: resolve(this.database) } },
    );
    this.worker = worker;
    worker.on(
      "message",
      (message: { id: number; value?: unknown; error?: string }) => {
        if (this.worker !== worker) return;
        const pending = this.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        if (message.error || !message.value)
          pending.reject(new Error("Market view unavailable. Retry shortly."));
        else pending.resolve(message.value);
      },
    );
    const failed = () => {
      if (this.worker === worker) this.close();
    };
    worker.on("error", failed);
    worker.on("exit", failed);
    worker.unref();
    return worker;
  }
  read(
    state: SnapshotReadState,
    options: SnapshotOptions,
    configuration: DiscoveryConfiguration,
    catalogVersion?: number,
  ) {
    return this.request<MarketResponse>(
      "snapshot",
      state,
      options,
      configuration,
      catalogVersion,
    );
  }
  candidates(
    state: SnapshotReadState,
    configuration: DiscoveryConfiguration,
    catalogVersion?: number,
  ) {
    return this.request<TokenObservation[]>(
      "candidates",
      state,
      {},
      configuration,
      catalogVersion,
    );
  }
  private request<T>(
    kind: "snapshot" | "candidates",
    state: SnapshotReadState,
    options: SnapshotOptions,
    configuration: DiscoveryConfiguration,
    catalogVersion?: number,
  ): Promise<T> {
    // A new risk flag, route invalidation or catalog write cannot inherit an
    // earlier in-flight result merely because its filters are identical.
    const key = createHash("sha256")
      .update(
        JSON.stringify([kind, options, configuration, state, catalogVersion]),
      )
      .digest("hex");
    const current = this.flights.get(key);
    if (current) return current as Promise<T>;
    if (this.pending.size >= 8)
      return Promise.reject(new Error("Market view is busy. Retry shortly."));
    const id = ++this.sequence;
    const value = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => this.close(), 30000);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      try {
        this.start().postMessage({ id, kind, state, options, configuration });
      } catch {
        this.close();
      }
    });
    const result = value.finally(() => {
      if (this.flights.get(key) === result) this.flights.delete(key);
    });
    this.flights.set(key, result);
    return result;
  }
  close() {
    const worker = this.worker;
    this.worker = undefined;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Market view unavailable. Retry shortly."));
    }
    this.pending.clear();
    this.flights.clear();
    if (worker) void worker.terminate();
  }
}
