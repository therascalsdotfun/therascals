import { it, expect } from "vitest";
import Fastify from "fastify";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerFrontend } from "../apps/server/src/http/frontend.ts";
it("serves a separately mounted DAO document with a fresh connector nonce, assets and no simulator routes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rascals-dao-release-"));
  mkdirSync(join(directory, "assets"));
  writeFileSync(
    join(directory, "index.html"),
    '<html><head></head><body><script src="/dao/assets/main.js"></script></body></html>',
  );
  writeFileSync(join(directory, "assets/main.js"), 'console.log("release")');
  const app = Fastify();
  try {
    await registerFrontend(app, directory, "/dao/");
    const first = await app.inject({ url: "/dao/" }),
      second = await app.inject({ url: "/dao/index.html" });
    expect(first.statusCode).toBe(200);
    const nonce = first.body.match(/name="csp-nonce" content="([^"]+)"/)?.[1];
    expect(nonce).toBeTruthy();
    expect(first.headers["content-security-policy"]).toContain(
      "nonce-" + nonce,
    );
    expect(second.body).not.toContain(nonce);
    expect(second.headers["content-security-policy"]).toContain(
      "frame-ancestors 'none'",
    );
    const asset = await app.inject({ url: "/dao/assets/main.js" });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers["cache-control"]).toContain("immutable");
    expect((await app.inject({ url: "/api/dao/state" })).statusCode).toBe(404);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/dao/call",
          payload: { method: "reset" },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ url: "/dao/.local-dev/state.json" })).statusCode,
    ).toBe(404);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("permits only same-origin embedding for the integrated DAO tab", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rascals-dao-embedded-"));
  writeFileSync(
    join(directory, "index.html"),
    "<html><head></head><body>DAO</body></html>",
  );
  const app = Fastify();
  try {
    await registerFrontend(app, directory, "/dao/", true);
    const result = await app.inject({ url: "/dao/?embedded=1" });
    expect(result.headers["content-security-policy"]).toContain(
      "frame-ancestors 'self'",
    );
    expect(result.headers["x-frame-options"]).toBe("SAMEORIGIN");
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
