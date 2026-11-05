import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { AuthError, WalletAuthService } from "./service.ts";
import { localOrigins } from "../http/runtime.ts";
const input = z
  .object({
    kind: z.enum(["near", "metamask", "phantom"]),
    address: z.string().min(2).max(80),
    chainId: z.string().max(18).optional(),
  })
  .strict();
const proof = z
  .object({
    id: z.string().regex(/^[a-f0-9]{64}$/),
    signature: z.string().min(1).max(180),
    publicKey: z.string().max(80).optional(),
  })
  .strict();
export function cookies(req: FastifyRequest) {
  return Object.fromEntries(
    (req.headers.cookie ?? "")
      .split(";")
      .map((s) => s.trim().split("="))
      .filter((s) => s.length === 2),
  );
}
function cookie(name: string, value: string, origin: string, age = 3600) {
  return `${name}=${value}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${age}${origin.startsWith("https:") ? "; Secure" : ""}`;
}
export function registerWalletAuth(
  app: FastifyInstance,
  auth = new WalletAuthService(),
  origins: Set<string> = localOrigins,
) {
  const mutation =
    (
      handler: (
        req: FastifyRequest,
        reply: FastifyReply,
        origin: string,
      ) => unknown,
    ) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      reply.header("cache-control", "no-store");
      const origin = req.headers.origin;
      if (!origin || !origins.has(origin))
        return reply.code(403).send({
          code: "ORIGIN_REQUIRED",
          error: "Open sign-in from Jackpot on this browser.",
        });
      try {
        if (req.url !== "/api/auth/logout") auth.rate("ip:" + req.ip, 30);
        return await handler(req, reply, origin);
      } catch (e) {
        const error =
          e instanceof AuthError
            ? e
            : new AuthError(
                "AUTH_UNAVAILABLE",
                "Wallet verification is unavailable. Try again shortly.",
                503,
              );
        if (error.status === 429) reply.header("retry-after", "60");
        return reply
          .code(error.status)
          .send({ code: error.code, error: error.message });
      }
    };
  app.post(
    "/api/auth/challenge",
    mutation((req, reply, origin) => {
      const parsed = input.safeParse(req.body);
      if (!parsed.success)
        throw new AuthError(
          "INVALID_REQUEST",
          "Invalid wallet sign-in request.",
          400,
        );
      let browser = cookies(req).jackpot_login;
      if (!browser || !auth.hasBrowser(browser)) browser = auth.createBrowser();
      const challenge = auth.issue(browser, origin, parsed.data);
      reply.header("set-cookie", cookie("jackpot_login", browser, origin));
      return challenge;
    }),
  );
  app.post(
    "/api/auth/verify",
    mutation(async (req, reply, origin) => {
      const parsed = proof.safeParse(req.body);
      if (!parsed.success)
        throw new AuthError(
          "INVALID_REQUEST",
          "Invalid wallet signature request.",
          400,
        );
      const result = await auth.verify(
        cookies(req).jackpot_login ?? "",
        origin,
        parsed.data,
      );
      reply.header("set-cookie", [
        cookie("jackpot_session", "", origin, 0).replace(
          "Path=/api;",
          "Path=/api/auth;",
        ),
        cookie("jackpot_login", "", origin, 0).replace(
          "Path=/api;",
          "Path=/api/auth;",
        ),
        cookie("jackpot_session", result.token, origin),
        cookie("jackpot_login", cookies(req).jackpot_login, origin),
      ]);
      return { identity: result.identity };
    }),
  );
  app.get("/api/auth/session", (req, reply) => {
    reply.header("cache-control", "no-store");
    return { identity: auth.session(cookies(req).jackpot_session) };
  });
  app.post(
    "/api/auth/logout",
    mutation((req, reply, origin) => {
      const c = cookies(req);
      auth.logout(c.jackpot_login ?? "", c.jackpot_session);
      reply.header("set-cookie", [
        cookie("jackpot_session", "", origin, 0).replace(
          "Path=/api;",
          "Path=/api/auth;",
        ),
        cookie("jackpot_login", "", origin, 0).replace(
          "Path=/api;",
          "Path=/api/auth;",
        ),
        cookie("jackpot_session", "", origin, 0),
        cookie("jackpot_login", "", origin, 0),
      ]);
      return { identity: null };
    }),
  );
}
