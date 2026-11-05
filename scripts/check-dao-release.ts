/** The real-testnet UI is built separately; fictional tooling must never enter it. */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const forbidden = [
  "Start local demo",
  "Reset local",
  "advance_time",
  "/api/dao/call",
  "/api/dao/state",
  "127.0.0.1",
  "localhost",
  ".local-dev/",
  "LocalDaoClient",
];
let checked = 0;
function inspect(directory: string) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) inspect(file);
    else if (/\.(?:js|css|html|map)$/.test(entry.name)) {
      checked++;
      const source = readFileSync(file, "utf8");
      for (const marker of forbidden)
        if (source.includes(marker))
          throw Error(
            `Non-release marker ${JSON.stringify(marker)} leaked into ${file}`,
          );
    }
  }
}
inspect("dist/dao");
if (!checked) throw Error("No DAO release assets found");
console.log(
  `DAO release boundary passed: ${checked} assets, no local simulator or loopback endpoint.`,
);
