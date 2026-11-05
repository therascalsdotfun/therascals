/** Fail release builds if local-only fixtures or demo controls enter any client chunk. */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const forbidden = [
  "warmisland6465.near",
  "Sample points",
  "Sample leaderboard",
  "sampleLeaderboard",
  "Preview sample data",
  "Simulate buy",
  "Demo chart",
  "Demo pops",
  "SIMULATED ENTRY",
  "Fee discount lab",
  "Test Mode",
  "TEST-USDC",
  "Set up test funds",
  ".local-dev/",
];
let checked = 0;
function inspect(directory: string) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) inspect(file);
    else if (/\.(?:js|css|html|map)$/.test(entry.name)) {
      checked++;
      const source = readFileSync(file, "utf8");
      for (const marker of forbidden) {
        if (source.includes(marker))
          throw Error(
            `Local-only UI marker ${JSON.stringify(marker)} leaked into ${file}`,
          );
      }
    }
  }
}
inspect("dist/web");
if (!checked) throw Error("No release assets found.");
console.log(
  `Release UI boundary passed: ${checked} assets contain no demo/test UI or fixture markers.`,
);
