import { expect, it } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { Readable } from "node:stream";
import { publicProcessLock } from "../apps/server/src/beta/process-lock.ts";
import { registerFrontend } from "../apps/server/src/http/frontend.ts";
it("permits one public process per volume and releases the OS lock on shutdown", () => {
  const dir = mkdtempSync(join(tmpdir(), "jackpot-lock-")),
    file = join(dir, "lock.sqlite"),
    release = publicProcessLock(file);
  expect(() => publicProcessLock(file)).toThrow(/one process/i);
  release();
  const again = publicProcessLock(file);
  again();
  rmSync(dir, { recursive: true });
});
it("serves only the production frontend, leaving API misses and private paths as 404", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jackpot-web-"));
  writeFileSync(join(dir, "index.html"), "<h1>Jackpot</h1>");
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "assets/app-abc.js"), "console.log('hello')");
  const app = Fastify();
  await registerFrontend(app, dir);
  expect((await app.inject("/")).body).toContain("Jackpot");
  expect((await app.inject("/")).headers["cache-control"]).toBe("no-cache");
  expect(
    (await app.inject("/assets/app-abc.js")).headers["cache-control"],
  ).toContain("immutable");
  for (const path of [
    "/api/missing",
    "/.credentials/wallets.json",
    "/.data/public.sqlite",
    "/README.md",
  ])
    expect((await app.inject(path)).statusCode).toBe(404);
  await app.close();
  rmSync(dir, { recursive: true });
});
it("gives the entry document a script-src nonce the page can read back", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jackpot-csp-"));
  writeFileSync(
    join(dir, "index.html"),
    '<!doctype html><html><head><title>rascals</title></head><body><script type="module" crossorigin src="/assets/index-abc.js"></script></body></html>',
  );
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "assets/index-abc.js"), "console.log('hello')");
  const app = Fastify();
  await registerFrontend(app, dir);
  const served = async (path: string) => {
    const res = await app.inject(path),
      policy = String(res.headers["content-security-policy"]);
    return {
      policy,
      header: /'nonce-([^']+)'/.exec(policy)?.[1],
      meta: /<meta name="csp-nonce" content="([^"]+)">/.exec(res.body)?.[1],
    };
  };
  const first = await served("/"),
    again = await served("/"),
    named = await served("/index.html");
  expect(first.policy).toContain("script-src 'self' https://plugin.jup.ag");
  expect(first.policy).toContain("base-uri 'none'");
  expect(first.meta).toBe(first.header);
  expect(named.meta).toBe(named.header);
  expect(again.header).not.toBe(first.header);
  expect(first.meta).toBe(first.meta?.replace(/[^A-Za-z0-9+/=]/g, ""));
  expect(first.meta).not.toMatch(/["<>]/);
  const asset = await app.inject("/assets/index-abc.js");
  expect(asset.statusCode).toBe(200);
  expect(String(asset.headers["content-security-policy"])).not.toMatch(/nonce/);
  expect(String(asset.headers["cache-control"])).toContain("immutable");
  const page = await app.inject("/");
  expect(page.headers["content-type"]).toContain("text/html");
  expect(String(page.headers["cache-control"])).toBe("no-cache");
  expect(String(page.headers["x-content-type-options"])).toBe("nosniff");
  await app.close();
  rmSync(dir, { recursive: true });
});
it("closes replaced entry streams before finishing the stamped response", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jackpot-csp-close-"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><html></html>");
  const app = Fastify(),
    streams: Readable[] = [];
  app.addHook("onSend", async (_req, _reply, payload) => {
    if (payload instanceof Readable) streams.push(payload);
    return payload;
  });
  try {
    await registerFrontend(app, dir);
    const response = await app.inject("/");
    expect(response.statusCode).toBe(200);
    expect(streams).toHaveLength(1);
    expect(streams[0].closed).toBe(true);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true });
  }
});
