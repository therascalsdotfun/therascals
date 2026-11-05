import { mkdirSync, existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { MarketStore } from "./market/store.ts";
import { startRecordRetention } from "./market/retention.ts";
import { MarketService } from "./market/service.ts";
import { createApp } from "./http/app.ts";
import { registerFrontend } from "./http/frontend.ts";
import { publicProcessLock } from "./beta/process-lock.ts";
import { runtimeOptions, trustedProxies } from "./http/runtime.ts";
import { BetaRegistry } from "./beta/registry.ts";
import { operatorPaths } from "./execution/paths.ts";
import { ExecutionService } from "./execution/service.ts";
import { PerpsAgents, perpsAgentSecret } from "./perps/agent.ts";
import { perpsNetwork } from "./perps/config.ts";
import { PerpsService } from "./perps/execution.ts";
import { HyperliquidClient } from "./perps/hyperliquid.ts";
const runtime = runtimeOptions();
const hasSponsored =
  runtime.mode === "public-testnet" && runtime.slots.length > 0;
const wasmFile = "target/wasm32-unknown-unknown/release/jackpot_session.wasm";
if (
  hasSponsored &&
  (!existsSync(".credentials/wallets.json") || !existsSync(wasmFile))
)
  throw Error(
    "Public mode requires the dedicated faucet wallet mount and verified WASM artifact",
  );
const expectedWasm = hasSponsored
  ? createHash("sha256").update(readFileSync(wasmFile)).digest("hex")
  : undefined;
mkdirSync(".data", { recursive: true });
const releaseLock = runtime.mode !== "local" ? publicProcessLock() : () => {};
const store = new MarketStore(
    process.env.JACKPOT_STATE_DB ??
      (runtime.mode !== "local"
        ? ".data/public.sqlite"
        : ".data/jackpot.sqlite"),
  ),
  service = new MarketService(store),
  executionStore =
    runtime.mode === "local" && process.env.JACKPOT_SLOT
      ? new MarketStore(operatorPaths.database)
      : store,
  execution =
    runtime.mode === "local"
      ? new ExecutionService(executionStore, service)
      : undefined,
  beta = hasSponsored
    ? new BetaRegistry(store, service, runtime.slots, {
        expectedWasm,
        claimPolicy: runtime.beta,
      })
    : undefined,
  perpsNetworkName = perpsNetwork(),
  perps =
    runtime.mode === "public" && perpsNetworkName !== "mainnet"
      ? undefined
      : new PerpsService(
          store,
          new HyperliquidClient(perpsNetworkName),
          new PerpsAgents(store, perpsNetworkName, perpsAgentSecret()),
        ),
  app = await createApp(service, execution, {
    runtime,
    store,
    beta,
    perps,
    trustProxy: trustedProxies(),
  });
if (runtime.mode !== "local" || process.env.JACKPOT_SERVE_WEB === "1")
  await registerFrontend(app);
await app.listen({
  port: Number(process.env.PORT ?? 4317),
  host: process.env.HOST ?? "127.0.0.1",
});
service.start();
const stopRetention = startRecordRetention(store, (removed, remaining) =>
  console.log(
    "record retention: aged out " +
      removed +
      " ephemeral rows, " +
      remaining +
      " records remain",
  ),
);
if (execution) void execution.start();
beta?.start();
perps?.start();
console.log(
  "Jackpot API ready: " +
    runtime.mode +
    " — wallet routes" +
    (perps ? "; " + perpsNetworkName + " perps" : ""),
);

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  service.stop();
  stopRetention();
  execution?.stop();
  beta?.stop();
  perps?.stop();
  await app.close();
  store.close();
  if (executionStore !== store) executionStore.close();
  releaseLock();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
