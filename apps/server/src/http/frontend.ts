import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import staticFiles from "@fastify/static";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import type { FastifyInstance } from "fastify";
import { cspHeader, newCspNonce, withCspNonce } from "./csp.ts";

export async function registerFrontend(
  app: FastifyInstance,
  directory = "dist/web",
  prefix = "/",
  allowSameOriginFrame = false,
) {
  if (!/^\/(?:[a-z0-9-]+\/)*$/.test(prefix))
    throw Error("Invalid frontend prefix");
  const root = resolve(directory);
  if (!existsSync(resolve(root, "index.html")))
    throw Error("Build the frontend with pnpm build before public startup");
  // `@fastify/static` streams the entry document byte for byte and owns both
  // `/` and `/index.html`, so the per-response `script-src` nonce that the NEAR
  // connector iframe needs is stamped here instead of by a separate route.
  app.addHook("onSend", async (req, reply, payload) => {
    const path = req.url.split("?")[0];
    if (path !== prefix && path !== prefix + "index.html") return payload;
    if (!String(reply.getHeader("content-type") ?? "").includes("text/html"))
      return payload;
    if (payload instanceof Readable) {
      // The replacement response must not leave a pending file open behind it.
      // In particular, shutdown/cleanup may remove the old build directory as
      // soon as the response finishes. Observe closure before returning HTML.
      const closed = finished(payload, { cleanup: true });
      payload.destroy();
      try {
        await closed;
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== "ERR_STREAM_PREMATURE_CLOSE"
        )
          throw error;
      }
    }
    const nonce = newCspNonce(),
      // Read per request so a rebuilt bundle is served without a restart.
      stamped = withCspNonce(
        readFileSync(resolve(root, "index.html"), "utf8"),
        nonce,
      );
    reply.header(
      "content-security-policy",
      allowSameOriginFrame
        ? cspHeader(nonce).replace(
            "frame-ancestors 'none'",
            "frame-ancestors 'self'",
          )
        : cspHeader(nonce),
    );
    if (allowSameOriginFrame) reply.header("x-frame-options", "SAMEORIGIN");
    reply.header("content-length", Buffer.byteLength(stamped));
    return stamped;
  });
  await app.register(staticFiles, {
    root,
    prefix,
    wildcard: false,
    index: ["index.html"],
    dotfiles: "deny",
    setHeaders: (res, path) => {
      res.header("x-content-type-options", "nosniff");
      res.header(
        "cache-control",
        path.includes("/assets/")
          ? "public, max-age=31536000, immutable"
          : "no-cache",
      );
    },
  });
}
