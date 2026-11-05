import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { WalletIdentity } from "../../../../packages/shared/src/wallet-auth.ts";
import { AuthError, type WalletAuthService } from "../auth/service.ts";
import type { IntentsExecution } from "./execution.ts";
import type { IntentsFunding } from "../mainnet/funding.ts";
import { IntentsError } from "./service.ts";
import { subjectFor } from "../beta/access.ts";
import { cookies } from "../auth/http.ts";
import { IntentsUserSessions } from "./user-session.ts";
import type { CommunityPresets } from "../presets/service.ts";
export function registerIntentsExecution(
  app: FastifyInstance,
  swaps: IntentsExecution | undefined,
  funding: IntentsFunding | undefined,
  identity: (req: any) => WalletIdentity | null,
  auth: WalletAuthService,
  sessions = new IntentsUserSessions(auth),
  presets?: CommunityPresets,
) {
  function user(req: any) {
    const u = identity(req);
    if (!u)
      throw new IntentsError(
        "Verify your connected wallet before preparing a real swap.",
        401,
      );
    auth.rate("intents-execution:" + subjectFor(u), 30);
    if (!swaps || !funding)
      throw new IntentsError(
        "Executable swaps are unavailable on this server.",
      );
    return u;
  }
  const handle =
    (work: (req: any) => Promise<any> | any) =>
    async (req: any, reply: any) => {
      try {
        return await work(req);
      } catch (e) {
        if (e instanceof AuthError) {
          if (e.status === 429) reply.header("retry-after", "60");
          return reply.code(e.status).send({ error: e.message, code: e.code });
        }
        return reply.code(e instanceof IntentsError ? e.status : 503).send({
          ...(e instanceof IntentsError ? e.details : {}),
          error:
            e instanceof IntentsError
              ? e.message
              : "Swap request unavailable. Keep the original operation and try checking its status.",
        });
      }
    };
  app.get(
    "/api/intents/session",
    handle((req) => {
      user(req);
      return sessions.status(cookies(req).jackpot_session ?? "");
    }),
  );
  app.post(
    "/api/intents/session/challenge",
    handle((req) => {
      user(req);
      if (!req.headers.origin)
        throw new IntentsError(
          "Open session authorization from the Rascals website.",
          403,
        );
      if (Object.keys(req.body ?? {}).length)
        throw new IntentsError("Invalid session challenge request.", 400);
      return sessions.challenge(
        cookies(req).jackpot_session ?? "",
        req.headers.origin ?? "",
      );
    }),
  );
  app.post(
    "/api/intents/session/verify",
    handle((req) => {
      user(req);
      if (!req.headers.origin)
        throw new IntentsError(
          "Open session authorization from the Rascals website.",
          403,
        );
      const body = z
        .object({
          id: z.string().regex(/^[a-f0-9]{64}$/),
          signature: z.string().min(80).max(90),
        })
        .strict()
        .safeParse(req.body);
      if (!body.success) throw new IntentsError("Invalid session proof.", 400);
      return sessions.verify(
        cookies(req).jackpot_session ?? "",
        req.headers.origin ?? "",
        body.data.id,
        body.data.signature,
      );
    }),
  );
  app.get(
    "/api/intents/operations",
    handle((req) => swaps!.list(user(req))),
  );
  app.post(
    "/api/intents/operations",
    handle(async (req) => {
      const u = user(req),
        body = z
          .object({
            requestId: z.string().uuid(),
            confidentiality: z.enum(["public", "basic"]).optional(),
            originAsset: z.string().min(1).max(250),
            destinationAsset: z.string().min(1).max(250),
            amount: z.string().max(25),
            recipient: z.string().min(2).max(80),
            presetId: z.string().uuid().optional(),
            rollId: z.string().regex(/^[a-f0-9]{64}$/).optional(),
          })
          .strict()
          .safeParse(req.body);
      if (!body.success)
        throw new IntentsError(
          "Check the swap amount, exact assets and recipient.",
          400,
        );
      if (body.data.confidentiality === "basic") {
        sessions.access(cookies(req).jackpot_session ?? "", true);
        // Provider accepts the ownership session for account reads, but its
        // quote endpoint rejects that credential. Do not invent a transport or
        // silently downgrade to public settlement while this remains unresolved.
        throw new IntentsError(
          "Your wallet session is authorized, but confidential quote access is awaiting the provider. No swap was funded.",
          503,
        );
      }
      const attributedPreset =
        body.data.presetId ??
        (body.data.rollId ? presets?.presetForRoll(u, body.data.rollId) : null) ??
        presets?.activeFor(u);
      return swaps!.prepare(u, {
        ...body.data,
        ...(attributedPreset ? { presetId: attributedPreset } : {}),
      });
    }),
  );
  app.get(
    "/api/intents/operations/:id",
    handle((req) => {
      const u = user(req);
      if (!z.string().uuid().safeParse(req.params.id).success)
        throw new IntentsError("Invalid swap ID.", 400);
      return funding!.status(u, req.params.id);
    }),
  );
  app.post(
    "/api/intents/operations/:id/funding",
    handle((req) => {
      const u = user(req);
      if (Object.keys(req.body ?? {}).length)
        throw new IntentsError("Funding uses the original quote only.", 400);
      return funding!.prepare(u, req.params.id);
    }),
  );
  app.post(
    "/api/intents/operations/:id/rejected",
    handle((req) => {
      const u = user(req);
      if (Object.keys(req.body ?? {}).length)
        throw new IntentsError("Invalid rejection request.", 400);
      return funding!.reject(u, req.params.id);
    }),
  );
  app.post(
    "/api/intents/operations/:id/submit",
    handle(async (req) => {
      const u = user(req),
        body = z
          .object({ signedTransaction: z.string().min(1).max(12000) })
          .strict()
          .safeParse(req.body);
      if (!body.success)
        throw new IntentsError("Invalid signed funding transaction.", 400);
      const op = await funding!.submit(u, req.params.id, body.data.signedTransaction);
      const hash = op.fundingSignature || op.nearCandidateHash;
      if (presets && hash) {
        const preset = op.presetId ?? presets.activeFor(u);
        if (preset) presets.tradeExecuted(u, preset, hash);
      }
      return op;
    }),
  );
  app.post(
    "/api/intents/operations/:id/near-deposit",
    handle(async (req) => {
      const u = user(req),
        body = z
          .object({ txHash: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,90}$/) })
          .strict()
          .safeParse(req.body);
      if (!body.success)
        throw new IntentsError("Invalid NEAR transfer hash.", 400);
      const op = await funding!.notifyNear(u, req.params.id, body.data.txHash);
      if (presets) {
        const preset = op.presetId ?? presets.activeFor(u);
        if (preset) presets.tradeExecuted(u, preset, body.data.txHash);
      }
      return op;
    }),
  );
}
