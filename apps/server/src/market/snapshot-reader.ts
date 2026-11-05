import { parentPort, workerData } from "node:worker_threads";
import { createHash } from "node:crypto";
import { PageCache } from "./page-cache.ts";
import { MarketStore } from "./store.ts";
import { MarketService } from "./service.ts";
import type { SnapshotReadState, SnapshotOptions } from "./snapshot-state.ts";
import type { DiscoveryConfiguration } from "./service.ts";
const store = new MarketStore(workerData.database, true);
const service = new MarketService(store);
const pages = new PageCache();
// This worker never starts collectors, signs, configures sessions or writes SQL.
parentPort!.on(
  "message",
  (request: {
    id: number;
    kind?: "snapshot" | "candidates";
    state: SnapshotReadState;
    options: SnapshotOptions;
    configuration: DiscoveryConfiguration;
  }) => {
    try {
      service.useReadState(request.state);
      const value =
        request.kind === "candidates"
          ? service.warmingCandidates(request.configuration)
          : request.options.matchingOnly
            ? service.snapshot(request.options, request.configuration)
            : pages.read(
                createHash("sha256")
                  .update(
                    JSON.stringify([
                      store.catalogVersion(),
                      request.configuration,
                      request.state,
                    ]),
                  )
                  .digest("hex"),
                request.options,
                request.state,
                () =>
                  service.snapshot(
                    { limit: Number.MAX_SAFE_INTEGER },
                    request.configuration,
                  ),
              );
      parentPort!.postMessage({
        id: request.id,
        value:
          request.kind === "candidates"
            ? value
            : service.refreshPageRows(
                value as import("../../../../packages/shared/src/market.ts").MarketResponse,
              ),
      });
    } catch {
      parentPort!.postMessage({
        id: request.id,
        error: "Market view unavailable. Retry shortly.",
      });
    }
  },
);
