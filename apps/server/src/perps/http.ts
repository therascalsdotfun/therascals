import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { WalletIdentity } from "../../../../packages/shared/src/wallet-auth.ts";
import { AuthError, type WalletAuthService } from "../auth/service.ts";
import { PerpsError } from "./errors.ts";
import type { PerpsService } from "./execution.ts";
import { NearPerpsTestnetService } from "./near-testnet.ts";
import { subjectFor } from "../beta/access.ts";

const empty = z.object({}).strict();

export function registerPerpsTestnet(
  app: FastifyInstance,
  identity: (req: any) => WalletIdentity | null,
  auth: WalletAuthService,
  testnetPerps: NearPerpsTestnetService = new NearPerpsTestnetService(),
) {
  if ((app as any).__perpsTestnetRegistered) return;
  (app as any).__perpsTestnetRegistered = true;

  function verifiedWallet(req: any): WalletIdentity {
    const wallet = identity(req);
    if (!wallet)
      throw new PerpsError(
        "Connect and verify your wallet first before rolling on Perps Testnet.",
        401,
        "AUTH_REQUIRED",
      );
    auth.rate("perps-testnet:" + subjectFor(wallet), 120);
    return wallet;
  }
  const handle =
    (work: (req: any) => Promise<any> | any) =>
    async (req: any, reply: any) => {
      try {
        return await work(req);
      } catch (error) {
        if (error instanceof AuthError) {
          if (error.status === 429) reply.header("retry-after", "60");
          return reply
            .code(error.status)
            .send({ error: error.message, code: error.code });
        }
        if (error instanceof PerpsError)
          return reply
            .code(error.status)
            .send({ error: error.message, code: error.code });
        return reply.code(503).send({
          error:
            "Perps Testnet is temporarily unavailable. Check your operation before retrying.",
          code: "VENUE_UNAVAILABLE",
        });
      }
    };
  const id = (value: unknown) => {
    if (!z.string().uuid().safeParse(value).success)
      throw new PerpsError("Invalid position ID.", 400, "INVALID_ID");
    return value as string;
  };

  app.get(
    "/api/perps/testnet/catalog",
    handle(async (req) => {
      auth.rate("perps-testnet-catalog:" + req.ip, 120);
      return testnetPerps.catalog();
    }),
  );
  app.get(
    "/api/perps/testnet/agent",
    handle((req) => testnetPerps.agentStatus(verifiedWallet(req))),
  );
  app.post(
    "/api/perps/testnet/spin",
    handle((req) => {
      const wallet = verifiedWallet(req);
      const body = z
        .object({
          universe: z.enum(["perp", "meme", "custom"]),
          marketNames: z
            .array(z.string().min(1).max(64))
            .min(2)
            .max(32)
            .refine((names) => new Set(names).size === names.length)
            .optional(),
          amountCap: z.number().int().min(5).max(25),
          closeSeconds: z.union([
            z.literal(30),
            z.literal(60),
            z.literal(300),
            z.null(),
          ]),
          clientSeedHash: z.string().regex(/^[0-9a-f]{64}$/i),
        })
        .strict()
        .refine((body) => (body.universe === "custom") === !!body.marketNames)
        .safeParse(req.body);
      if (!body.success)
        throw new PerpsError(
          "Check the universe, stake cap and close window.",
          400,
          "INVALID_SPIN",
        );
      return testnetPerps.startSpin(wallet, body.data);
    }),
  );
  app.post(
    "/api/perps/testnet/spin/:id/reveal",
    handle((req) => {
      const wallet = verifiedWallet(req);
      const body = z
        .object({ clientSeed: z.string().regex(/^[0-9a-f]{64}$/i) })
        .strict()
        .safeParse(req.body);
      if (!body.success)
        throw new PerpsError(
          "Reveal the original client seed.",
          400,
          "INVALID_SEED",
        );
      return testnetPerps.reveal(
        wallet,
        id(req.params.id),
        body.data.clientSeed,
      );
    }),
  );
  app.post(
    "/api/perps/testnet/spin/:id/open",
    handle((req) => {
      const wallet = verifiedWallet(req);
      if (!empty.safeParse(req.body ?? {}).success)
        throw new PerpsError("Opening uses the revealed spin only.", 400);
      return testnetPerps.open(wallet, id(req.params.id));
    }),
  );
  app.get(
    "/api/perps/testnet/positions",
    handle((req) => testnetPerps.list(verifiedWallet(req))),
  );
  app.post(
    "/api/perps/testnet/positions/:id/close",
    handle((req) => {
      const wallet = verifiedWallet(req);
      if (!empty.safeParse(req.body ?? {}).success)
        throw new PerpsError("Close uses the original position only.", 400);
      return testnetPerps.close(wallet, id(req.params.id));
    }),
  );
}

export function registerPerps(
  app: FastifyInstance,
  perps: PerpsService,
  identity: (req: any) => WalletIdentity | null,
  auth: WalletAuthService,
  testnetPerps?: NearPerpsTestnetService,
) {
  registerPerpsTestnet(app, identity, auth, testnetPerps);
  function user(req: any): WalletIdentity {
    const wallet = identity(req);
    if (!wallet)
      throw new PerpsError(
        "Verify your connected MetaMask wallet before trading perps.",
        401,
        "AUTH_REQUIRED",
      );
    auth.rate("perps:" + subjectFor(wallet), 120);
    return wallet;
  }
  const handle =
    (work: (req: any) => Promise<any> | any) =>
    async (req: any, reply: any) => {
      try {
        return await work(req);
      } catch (error) {
        if (error instanceof AuthError) {
          if (error.status === 429) reply.header("retry-after", "60");
          return reply
            .code(error.status)
            .send({ error: error.message, code: error.code });
        }
        if (error instanceof PerpsError)
          return reply
            .code(error.status)
            .send({ error: error.message, code: error.code });
        return reply.code(503).send({
          error:
            "Hyperliquid is unavailable. No new position was opened; check the operation before retrying.",
          code: "VENUE_UNAVAILABLE",
        });
      }
    };
  const id = (value: unknown) => {
    if (!z.string().uuid().safeParse(value).success)
      throw new PerpsError("Invalid position ID.", 400, "INVALID_ID");
    return value as string;
  };

  app.get(
    "/api/perps/catalog",
    handle(async (req) => {
      auth.rate("perps-catalog:" + req.ip, 60);
      return perps.catalog();
    }),
  );
  app.get(
    "/api/perps/agent",
    handle((req) => perps.agentStatus(user(req))),
  );
  app.post(
    "/api/perps/agent/prepare",
    handle((req) => {
      const wallet = user(req);
      if (!empty.safeParse(req.body ?? {}).success)
        throw new PerpsError("Invalid agent request.", 400);
      return perps.prepareAgent(wallet);
    }),
  );
  app.post(
    "/api/perps/agent/approve",
    handle(async (req) => {
      const wallet = user(req);
      const body = z
        .object({
          signature: z.string().regex(/^0x[0-9a-f]{130}$/i),
          nonce: z.number().int().positive(),
        })
        .strict()
        .safeParse(req.body);
      if (!body.success)
        throw new PerpsError(
          "Sign the agent approval with MetaMask first.",
          400,
          "INVALID_APPROVAL",
        );
      return perps.approveAgent(wallet, body.data);
    }),
  );
  app.post(
    "/api/perps/agent/revoke",
    handle(async (req) => {
      const wallet = user(req);
      if (!empty.safeParse(req.body ?? {}).success)
        throw new PerpsError("Invalid revoke request.", 400);
      return perps.revokeAgent(wallet);
    }),
  );
  app.post(
    "/api/perps/spin",
    handle((req) => {
      const wallet = user(req);
      const body = z
        .object({
          universe: z.enum(["perp", "meme", "custom"]),
          marketNames: z
            .array(z.string().min(1).max(64))
            .min(2)
            .max(32)
            .refine((names) => new Set(names).size === names.length)
            .optional(),
          amountCap: z.number().int().min(5).max(25),
          closeSeconds: z.union([
            z.literal(30),
            z.literal(60),
            z.literal(300),
            z.null(),
          ]),
          clientSeedHash: z.string().regex(/^[0-9a-f]{64}$/i),
        })
        .strict()
        .refine((body) => (body.universe === "custom") === !!body.marketNames)
        .safeParse(req.body);
      if (!body.success)
        throw new PerpsError(
          "Check the universe, stake cap and close window.",
          400,
          "INVALID_SPIN",
        );
      return perps.startSpin(wallet, body.data);
    }),
  );
  app.post(
    "/api/perps/spin/:id/reveal",
    handle((req) => {
      const wallet = user(req);
      const body = z
        .object({ clientSeed: z.string().regex(/^[0-9a-f]{64}$/i) })
        .strict()
        .safeParse(req.body);
      if (!body.success)
        throw new PerpsError(
          "Reveal the original client seed.",
          400,
          "INVALID_SEED",
        );
      return perps.reveal(wallet, id(req.params.id), body.data.clientSeed);
    }),
  );
  app.post(
    "/api/perps/spin/:id/open",
    handle((req) => {
      const wallet = user(req);
      if (!empty.safeParse(req.body ?? {}).success)
        throw new PerpsError("Opening uses the revealed spin only.", 400);
      return perps.open(wallet, id(req.params.id));
    }),
  );
  app.get(
    "/api/perps/positions",
    handle((req) => perps.list(user(req))),
  );
  app.post(
    "/api/perps/positions/:id/close",
    handle((req) => {
      const wallet = user(req);
      if (!empty.safeParse(req.body ?? {}).success)
        throw new PerpsError("Close uses the original position only.", 400);
      return perps.close(wallet, id(req.params.id));
    }),
  );
}
