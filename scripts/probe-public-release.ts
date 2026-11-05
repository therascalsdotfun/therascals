/** Starts the actual production entry point in an owned temporary directory.
 * No sponsored slots, operator credentials, wallet signatures or trade requests.
 * Discovery workers make normal read-only provider requests until shutdown.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { createServer } from "node:net";
const repo = resolve("."),
  dir = mkdtempSync(join(tmpdir(), "rascals-release-"));
symlinkSync(join(repo, "dist"), join(dir, "dist"), "dir");
const socket = createServer();
socket.listen(0, "127.0.0.1");
await once(socket, "listening");
const port = (socket.address() as { port: number }).port;
await new Promise<void>((r, j) => socket.close((e) => (e ? j(e) : r())));
const child = spawn(
  process.execPath,
  [
    "--import",
    join(repo, "node_modules/tsx/dist/loader.mjs"),
    join(repo, "apps/server/src/main.ts"),
  ],
  {
    cwd: dir,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: "production",
      JACKPOT_MODE: "public",
      JACKPOT_PUBLIC_ORIGIN: "https://rascals.example",
      JACKPOT_PERPS_SECRET: randomBytes(32).toString("hex"),
      HOST: "127.0.0.1",
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let logs = "";
child.stdout.on("data", (d) => (logs += d));
child.stderr.on("data", (d) => (logs += d));
const base = `http://127.0.0.1:${port}`;
const get = async (path: string) =>
  fetch(base + path, { signal: AbortSignal.timeout(5000) });
const report: Record<string, unknown> = {
  checkedAt: new Date().toISOString(),
  origin: "loopback",
  mode: "public",
  funded: false,
};
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null)
      throw Error(`Public process exited ${child.exitCode}`);
    try {
      if ((await get("/api/health")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(ready, "Public server did not start within 8 seconds");
  const runtime = await (await get("/api/runtime")).json();
  assert.equal(runtime.mode, "public");
  assert.equal(runtime.sponsored, false);
  assert.equal(runtime.mainnet.intentsExecutable, true);
  assert.equal(runtime.perps.network, "testnet");
  report.runtime = runtime;
  const page = await get("/");
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.ok(html.includes("/assets/"));
  assert.equal(page.headers.get("x-frame-options"), "DENY");
  const asset = html.match(/src="(\/assets\/[^\"]+\.js)"/)?.[1];
  assert.ok(asset);
  assert.equal((await get(asset)).status, 200);
  // The built page must be able to hand its own `script-src` nonce to the NEAR
  // connector: the value the page reads has to be the one the response header
  // allows, and the rewritten body has to arrive at the right length.
  const policy = page.headers.get("content-security-policy") ?? "";
  const headerNonce = /'nonce-([^']+)'/.exec(policy)?.[1],
    pageNonce = /<meta name="csp-nonce" content="([^"]+)">/.exec(html)?.[1];
  assert.match(policy, /script-src 'self' https:\/\/plugin\.jup\.ag/);
  assert.ok(headerNonce, "Public page has no script-src nonce");
  assert.equal(pageNonce, headerNonce);
  assert.equal(
    page.headers.get("content-length"),
    String(Buffer.byteLength(html)),
    "Stamped HTML kept the streamed content length",
  );
  assert.notEqual(
    (await get("/")).headers.get("content-security-policy"),
    policy,
    "Entry document reused a nonce across responses",
  );
  report.cspNonceHandshake = true;
  for (const logo of [
    "/brands/rascals/rascal-mascot.png",
    "/brands/chains/base.png",
    "/brands/rascals/favicon.svg",
  ])
    assert.equal(
      (await get(logo)).status,
      200,
      `Missing production brand asset: ${logo}`,
    );
  for (const path of [
    "/.credentials/wallets.json",
    "/.data/public.sqlite",
    "/README.md",
    "/api/events",
  ])
    assert.equal((await get(path)).status, 404);
  const agentGuide = await get("/llms.txt"),
    guideAlias = await get("/llm.txt");
  assert.equal(agentGuide.status, 200);
  assert.equal(guideAlias.status, 200);
  const guideText = await agentGuide.text();
  assert.equal(await guideAlias.text(), guideText);
  assert.ok(
    guideText.includes("local stdio MCP adapter") &&
      guideText.includes("/api/perps/funding-quote"),
  );
  report.agentDiscoveryDocs = true;
  const mutation = await fetch(base + "/api/intents/operations", {
    method: "POST",
    headers: {
      origin: "https://evil.example",
      "content-type": "application/json",
    },
    body: "{}",
  });
  assert.equal(mutation.status, 403);
  report.productionAssets = true;
  report.brandAssets = true;
  report.privatePathsDenied = true;
  report.originGuard = true;
  const exit = once(child, "exit");
  child.kill("SIGTERM");
  const code = await Promise.race([
    exit,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(Error("Shutdown timeout")), 10000),
    ),
  ]);
  assert.equal(code[0], 0);
  report.gracefulShutdown = true;
  report.limits =
    "HTTP loopback production-process smoke only; HTTPS proxy, deployed origin, wallet extensions, Docker image and funded settlement remain unverified.";
  mkdirSync(join(repo, "docs/evidence/release-audit"), { recursive: true });
  writeFileSync(
    join(repo, "docs/evidence/release-audit/public-process.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  // Runtime logs are intentionally not printed: downstream errors may include URLs.
  process.exitCode = 1;
} finally {
  if (child.exitCode === null) {
    child.kill("SIGTERM");
    await Promise.race([
      once(child, "exit"),
      new Promise((r) => setTimeout(r, 1000)),
    ]);
  }
  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await once(child, "exit");
  }
  rmSync(dir, { recursive: true, force: true });
}
