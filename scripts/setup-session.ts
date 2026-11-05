import { setupSession } from "../apps/server/src/execution/setup.ts";
await setupSession(process.argv.includes("--activate"));
