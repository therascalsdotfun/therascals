/** Standalone real-testnet UI. No simulator routes, credentials or signer. */
import Fastify from "fastify";
import { registerFrontend } from "../server/src/http/frontend.ts";
const app = Fastify({ logger: true });
app.get("/api/health", () => ({
  ok: true,
  network: "testnet",
  application: "contributor-dao",
}));
app.get("/dao", (_req, reply) => reply.redirect("/dao/"));
await registerFrontend(app, "dist/dao", "/dao/", true);
await app.listen({
  host: process.env.DAO_HOST ?? "127.0.0.1",
  port: Number(process.env.DAO_PORT ?? 4321),
});
