import { it, expect } from "vitest";
import { createServer } from "vite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

it("does not serve test credentials or runtime data through Vite", async () => {
  // A verification server must never invalidate the running app's Three.js cache.
  const cacheDir = mkdtempSync(join(tmpdir(), "rascals-vite-verification-"));
  const server = await createServer({ cacheDir, server: { port: 0 } });
  await server.listen();
  try {
    const address = server.httpServer!.address() as { port: number };
    for (const path of [
      "/.credentials/wallets.json",
      `/@fs${process.cwd()}/.credentials/wallets.json`,
      "/.data/jackpot.sqlite",
      "/.superpowers/server.log",
      "/.credentials/missing-file.json",
      "/%2ecredentials/missing-file.json",
      "/.env.never-created",
      "/.git/config",
    ]) {
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`);
      await response.body?.cancel();
      expect(response.status, path).toBe(403);
    }
  } finally {
    await server.close();
    rmSync(cacheDir, { recursive: true, force: true });
  }
});
