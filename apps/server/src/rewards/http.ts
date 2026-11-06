import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { WalletIdentity } from "../../../../packages/shared/src/wallet-auth.ts";
import { AuthError, type WalletAuthService } from "../auth/service.ts";
import { RewardsError, RewardsService } from "./service.ts";
import { validMint } from "../market/gecko.ts";
import { validRewardSignature } from "./receipt.ts";
import { subjectFor } from "../beta/access.ts";
import type { CommunityPresets } from "../presets/service.ts";
export function registerRewards(
  app: FastifyInstance,
  rewards: RewardsService | undefined,
  identity: (req: any) => WalletIdentity | null,
  auth: WalletAuthService,
  presets?: CommunityPresets,
) {
  const handle =
    (
      work: (
        req: any,
        user: WalletIdentity,
        service: RewardsService,
      ) => unknown,
    ) =>
    async (req: any, reply: any) => {
      try {
        const user = identity(req);
        if (!user)
          throw new RewardsError(
            "Connect and verify your wallet to use points.",
            401,
          );
        if (!rewards)
          throw new RewardsError(
            "Points are unavailable on this deployment.",
            503,
          );
        // Keyed on the verified wallet, which `handle` has just required, so a
        // shared office address does not spend everyone's allowance together.
        auth.rate("points:" + subjectFor(user), req.method === "GET" ? 60 : 20);
        return await work(req, user, rewards);
      } catch (e) {
        if (e instanceof AuthError || e instanceof RewardsError) {
          if (e.status === 429) reply.header("retry-after", "60");
          return reply.code(e.status).send({ error: e.message });
        }
        return reply.code(503).send({
          error:
            "Points could not be updated. Retry the same receipt or purchase; nothing is rerolled.",
        });
      }
    };
  app.get(
    "/api/rewards",
    handle((_req, user, service) => service.snapshot(user)),
  );
  app.get("/api/rewards/promotions", () => ({
    promotions: rewards?.publicPromotions() ?? [],
  }));
  app.get("/api/rewards/leaderboard", (req, reply) => {
    try {
      auth.rate("points-leaderboard:" + req.ip, 60);
      const parsed = z
        .object({ lane: z.enum(["mainnet", "practice"]).default("mainnet") })
        .strict()
        .safeParse(req.query);
      if (!parsed.success)
        return reply
          .code(400)
          .send({ error: "Choose mainnet or practice points." });
      if (!rewards)
        return reply.code(503).send({ error: "Leaderboard unavailable." });
      reply.header("cache-control", "private, no-store");
      return rewards.leaderboard(parsed.data.lane, identity(req));
    } catch (e) {
      if (e instanceof AuthError && e.status === 429) {
        reply.header("retry-after", "60");
        return reply.code(429).send({ error: e.message });
      }
      return reply
        .code(503)
        .send({ error: "Leaderboard unavailable. Please retry." });
    }
  });
  app.post(
    "/api/rewards/practice-starter",
    handle((req, user, service) => {
      if (!z.object({}).strict().safeParse(req.body).success)
        throw new RewardsError("Practice starter takes no amount.", 400);
      return service.practiceStarter(user);
    }),
  );
  app.post(
    "/api/rewards/claim",
    handle((req, user, service) => {
      const body = z
        .discriminatedUnion("lane", [
          z
            .object({
              lane: z.literal("mainnet"),
              ticketId: z.string().uuid(),
              signature: z.string().refine(validRewardSignature),
            })
            .strict(),
          z
            .object({
              lane: z.literal("practice"),
              operationId: z.string().uuid(),
            })
            .strict(),
        ])
        .safeParse(req.body);
      if (!body.success)
        throw new RewardsError(
          "Choose a completed buy receipt, not an amount or a multiplier.",
          400,
        );
      return body.data.lane === "mainnet"
        ? service.claimMainnet(
            user,
            body.data.ticketId,
            body.data.signature,
            (ticket, sig) => {
              if (ticket.presetId && presets) {
                presets.tradeExecuted(user, ticket.presetId, sig);
              }
            },
          )
        : service.claimPractice(user, body.data.operationId);
    }),
  );
  app.post(
    "/api/rewards/promotions",
    handle((req, user, service) => {
      auth.rate("points-promote:" + subjectFor(user), 6);
      const body = z
        .object({
          requestId: z.string().uuid(),
          lane: z.enum(["mainnet", "practice"]),
          mint: z.string().refine(validMint),
          message: z.string().trim().max(96),
          placement: z.enum(["market", "detail"]),
          durationHours: z.union([
            z.literal(24),
            z.literal(72),
            z.literal(168),
          ]),
        })
        .strict()
        .safeParse(req.body);
      if (!body.success)
        throw new RewardsError("Check the token, placement and duration.", 400);
      return service.purchasePromotion(user, body.data);
    }),
  );
}
