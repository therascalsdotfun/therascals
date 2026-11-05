import { IntentsExecution } from "../intents/execution.ts";
import { IntentsFunding } from "../mainnet/funding.ts";
import { registerIntentsExecution } from "../intents/http.ts";
import Fastify from "fastify";
import { registerWalletAuth, cookies } from "../auth/http.ts";
import { z } from "zod";
import {
  filterPatchSchema as filters,
  validFilterRanges,
} from "../../../../packages/shared/src/filter-schema.ts";
import { discoveryPreset } from "../../../../packages/shared/src/discovery-presets.ts";
import { validMint } from "../market/gecko.ts";
import { PortfolioPositions } from "../portfolio/positions.ts";
import { PortfolioService } from "../portfolio/service.ts";
import { WalletAuthService, AuthError } from "../auth/service.ts";
import { runtimeOptions, type RuntimeOptions } from "./runtime.ts";
import { MarketStore } from "../market/store.ts";
import { BetaRegistry } from "../beta/registry.ts";
import { VisitorProfiles } from "../beta/visitors.ts";
import { subjectFor } from "../beta/access.ts";
import { clientMessage } from "../client-message.ts";
import { IntentsError, IntentsService } from "../intents/service.ts";
import { registerPerps } from "../perps/http.ts";
import type { PerpsService } from "../perps/execution.ts";
import { registerRewards } from "../rewards/http.ts";
import { RewardsError, RewardsService } from "../rewards/service.ts";
import { verifyMainnetBuy } from "../rewards/receipt.ts";
import { registerMainnet } from "../mainnet/http.ts";
import { cspHeader } from "./csp.ts";
export type AppOptions = {
  runtime?: RuntimeOptions;
  store?: MarketStore;
  auth?: WalletAuthService;
  beta?: Pick<BetaRegistry, "snapshot" | "claim" | "activate" | "forIdentity">;
  /** Proxy addresses allowed to name a client, or false for socket only. */
  trustProxy?: string | false;
  intents?: Pick<IntentsService, "catalog" | "quote"> &
    Partial<Pick<IntentsService, "hyperliquidQuote">>;
  intentsExecution?: IntentsExecution;
  intentsFunding?: IntentsFunding;
  perps?: PerpsService;
  rewards?: RewardsService;
};
/**
 * A roll id only ever names a commitment the server issued. Draw outcomes come
 * from the committed seed, never from anything the client sends.
 */
const rollId = z
  .string()
  .regex(/^roll-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const configuration = z
  .object({
    ticket: z
      .string()
      .regex(/^(?:[1-9]\d?|100)(?:\.\d{1,2})?$/)
      .refine((x) => Number(x) <= 100),
    preset: z.enum(["strict", "broad", "tight"]).default("strict"),
    filters: filters.optional(),
  })
  .strict();
export async function createApp(
  service: any,
  execution?: any,
  options: AppOptions = {},
) {
  const runtime = options.runtime ?? runtimeOptions(),
    isPublic = runtime.mode !== "local";
  const auth = options.auth ?? new WalletAuthService();
  const beta = runtime.mode === "public" ? undefined : options.beta;
  const releasePerps =
    options.perps &&
    (runtime.mode !== "public" || options.perps.network === "mainnet")
      ? options.perps
      : undefined;
  if (
    isPublic &&
    (!options.store || (runtime.mode === "public-testnet" && !beta))
  )
    throw Error(
      "Public mode requires isolated testnet registry and persistent store",
    );
  const visitors = options.store ? new VisitorProfiles(options.store) : null;
  const identity = (req: any) => auth.session(cookies(req).jackpot_session);
  /**
   * Prefer the verified wallet over the address it came from. An office or
   * carrier NAT would otherwise hand every player one shared budget and throttle
   * them for each other, while a wallet that misbehaves is best limited against
   * itself. The IP stays for callers with nothing verified yet.
   */
  const limitKey = (req: any, prefix: string) => {
    const user = identity(req);
    return prefix + ":" + (user ? subjectFor(user) : req.ip);
  };
  function rate(req: any, prefix: string, budget: number) {
    // Give verified neighbours independent allowances while bounding a farm of
    // cheap wallet identities on the same network. Eight matches beta capacity.
    if (identity(req))
      auth.rate("network:" + prefix + ":" + req.ip, budget * 8);
    auth.rate(limitKey(req, prefix), budget);
  }
  function discovery(req: any, reply: any) {
    if (!isPublic) return service;
    const user = identity(req);
    if (user) return service.scoped("user:" + subjectFor(user));
    const viewer = visitors!.resolve(cookies(req).jackpot_view, () =>
      auth.rate("visitor:" + req.ip, 12),
    );
    if (viewer.token) {
      reply.header(
        "set-cookie",
        `jackpot_view=${viewer.token}; Path=/api; HttpOnly; SameSite=Strict; Secure; Max-Age=86400`,
      );
    }
    return service.scoped(viewer.scope);
  }
  const portfolios = new PortfolioService(service);
  const portfolioPositions = new PortfolioPositions(options.store);
  const intents = options.intents ?? new IntentsService();
  const app = Fastify({
    bodyLimit: 16384,
    forceCloseConnections: true,
    // Only named proxy addresses may speak for a client. `true` would take the
    // client-written leftmost X-Forwarded-For entry, and a hop count disables
    // header trust outright in Fastify 5, collapsing every proxied player onto
    // one shared budget. See trustedProxies() in http/runtime.ts.
    trustProxy: options.trustProxy ?? false,
  });
  app.setErrorHandler((e, req, reply) => {
    if (e instanceof AuthError) {
      if (e.status === 429) reply.header("retry-after", "60");
      return reply.code(e.status).send({ code: e.code, error: e.message });
    }
    const error = e as Error & { statusCode?: number };
    return reply
      .code(error.statusCode && error.statusCode < 500 ? error.statusCode : 503)
      .send({ error: "Request unavailable. Refresh and try again." });
  });
  app.addHook("preValidation", async (req, reply) => {
    if (
      runtime.mode === "public" &&
      req.url.startsWith("/api/rewards") &&
      (req.body as { lane?: unknown } | null)?.lane === "practice"
    ) {
      return reply.code(404).send({ error: "Not found" });
    }
  });
  app.addHook("onRequest", async (req, reply) => {
    // Production never exposes sponsored testing, faucet points or testnet agents.
    const path = req.url.split("?")[0];
    if (
      runtime.mode === "public" &&
      (/^\/api\/execution(?:\/|$)/.test(path) ||
        /^\/api\/rewards\/practice(?:-|\/|$)/.test(path) ||
        (/^\/api\/perps(?:\/|$)/.test(path) && !releasePerps) ||
        /^\/api\/portfolio\/solana-devnet(?:\/|$)/.test(path) ||
        (path.startsWith("/api/rewards") &&
          new URL(req.url, "http://localhost").searchParams.get("lane") ===
            "practice"))
    )
      return reply.code(404).send({ error: "Not found" });
    reply.header("referrer-policy", "no-referrer");
    reply.header("x-frame-options", "DENY");
    reply.header("content-security-policy", cspHeader());
    if (req.url.startsWith("/api/")) {
      reply.header("cache-control", "no-store");
      reply.header("x-content-type-options", "nosniff");
      if (
        isPublic &&
        req.url !== "/api/health" &&
        req.url !== "/api/auth/logout"
      )
        rate(req, "api", 240);
    }
    if (req.method !== "POST") return;
    const origin = req.headers.origin;
    if ((isPublic && !origin) || (origin && !runtime.origins.has(origin)))
      return reply.code(403).send({
        error: "Open this action from the Jackpot site.",
        code: "ORIGIN_REQUIRED",
      });
  });
  registerWalletAuth(app, auth, runtime.origins);
  registerMainnet(app, {
    market: discovery,
    rate: (key, max) => auth.rate(key, max),
  });
  const rewards =
    options.rewards ??
    (options.store
      ? new RewardsService(options.store, {
          verifyMainnet: verifyMainnetBuy,
          promotionVisible: (mint) =>
            typeof service.promotionVisible === "function" &&
            service.promotionVisible(mint),
          practiceReceipt: (user, operationId) => {
            const snapshot = isPublic
              ? beta?.snapshot(user)
              : execution?.snapshot();
            const binding = options.store!.getRecord<{
              owner: string;
              session: string;
              drawId: string;
              createdAt: string;
            }>("points:practice-op:" + operationId);
            if (
              !binding ||
              binding.owner !== subjectFor(user) ||
              binding.session == null ||
              binding.drawId == null ||
              !Number.isFinite(Date.parse(binding.createdAt))
            )
              throw new RewardsError(
                "This wallet has no completed eligible test buy for that operation.",
              );
            const fill = snapshot?.receipts?.find(
              (r: any) =>
                r.buy === true &&
                r.success === true &&
                String(r.session) === String(binding.session) &&
                String(r.drawId) === String(binding.drawId) &&
                Number.isFinite(Date.parse(r.createdAt)) &&
                Date.parse(r.createdAt) >= Date.parse(binding.createdAt),
            );
            if (!fill?.signature || !fill.source?.mint)
              throw new RewardsError(
                "Finalized buy evidence is not ready. Retry after confirmation.",
              );
            return {
              signature: fill.signature,
              volumeAtomic: fill.input,
              mint: fill.source.mint,
              confirmedAt: fill.createdAt,
            };
          },
          promotionToken: async (mint) => {
            const [token, risk] = await Promise.all([
              service.tokenInfo(mint),
              service.tokenRisk(mint),
            ]);
            const fresh = (at: unknown, max: number) =>
              typeof at === "string" &&
              Number.isFinite(Date.parse(at)) &&
              Date.parse(at) <= Date.now() &&
              Date.now() - Date.parse(at) <= max;
            if (
              !token ||
              token.mint !== mint ||
              token.stale ||
              !fresh(token.fetchedAt, 60000) ||
              !(token.liquidity > 0) ||
              risk?.mint !== mint ||
              risk.status !== "checked" ||
              !Array.isArray(risk.risks) ||
              risk.risks.length ||
              risk.drawdown ||
              !fresh(risk.checkedAt, 300000)
            )
              throw new RewardsError(
                "A fresh, unflagged token report and positive reference-pair liquidity are required for promotion.",
              );
            return {
              mint,
              symbol: token.symbol,
              name: token.name,
              icon: token.icon,
            };
          },
        })
      : undefined);
  registerRewards(app, rewards, identity, auth);
  const swaps =
    options.intentsExecution ??
    (options.store && !options.intents
      ? new IntentsExecution(options.store, intents as IntentsService)
      : undefined);
  const funding =
    options.intentsFunding ??
    (options.store && swaps
      ? new IntentsFunding(options.store, swaps)
      : undefined);
  registerIntentsExecution(app, swaps, funding, identity, auth);
  if (releasePerps) registerPerps(app, releasePerps, identity, auth);
  app.get("/api/runtime", () => ({
    mode: runtime.mode,
    testnetOnly: false,
    defaultMode: "mainnet",
    sponsored: !!beta,
    mainnet: {
      execution: true,
      walletApprovalRequired: true,
      intentsDryQuotes: true,
      intentsExecutable: !!swaps,
      evmNativeBuys: ["base", "bsc"],
      simulationBeforeWalletApproval: true,
    },
    perps: releasePerps
      ? {
          enabled: true,
          network: releasePerps.network,
          agentTrading: true,
        }
      : { enabled: false },
  }));
  app.post("/api/mainnet/recheck", async (req, reply) => {
    rate(req, "mainnet-check", 6);
    const body = z
      .object({
        rollId,
        mint: z.string().refine(validMint),
        amount: z
          .string()
          .regex(/^(?:[1-9]\d?|100)(?:\.\d{1,2})?$/)
          .refine((s) => Number(s) <= 100),
      })
      .strict()
      .safeParse(req.body);
    if (!body.success)
      return reply.code(400).send({
        error:
          "Send the committed roll, a valid Solana token and a 1–100 USDC amount.",
      });
    try {
      const market = discovery(req, reply),
        revealed = market.revealRoll(body.data.rollId),
        snapshot = market.snapshot();
      // The buy target must be the token this roll already committed to, so a
      // caller can never name their own token and have it treated as a win.
      if (revealed.selected.mint !== body.data.mint)
        return reply.code(409).send({
          error:
            "That token is not the committed winner of this roll. Start a new roll.",
        });
      const checked = await market.revalidateSelected(
        body.data.mint,
        String(Math.round(Number(body.data.amount) * 1e6)),
        { ...snapshot.filters, chains: ["solana"] },
      );
      return {
        mint: body.data.mint,
        rollId: revealed.id,
        commitment: revealed.commitment,
        checkedAt: new Date().toISOString(),
        riskStatus: checked.token.security?.status ?? null,
        rewardTicket:
          identity(req)?.kind === "phantom" && rewards
            ? rewards.createTradeTicket(
                identity(req)!,
                body.data.mint,
                String(Math.round(Number(body.data.amount) * 1e6)),
              )
            : null,
      };
    } catch {
      return reply.code(409).send({
        error:
          "This token did not pass a fresh route and risk check. Retry the same token when providers recover; no trade was sent.",
      });
    }
  });
  app.get("/api/intents/tokens", async (req, reply) => {
    rate(req, "intents-catalog", 30);
    try {
      return await intents.catalog();
    } catch (e) {
      return reply.code(e instanceof IntentsError ? e.status : 503).send({
        ...(e instanceof IntentsError ? e.details : {}),
        error:
          e instanceof IntentsError
            ? e.message
            : "Intents catalog unavailable.",
      });
    }
  });
  app.post("/api/intents/quote", async (req, reply) => {
    rate(req, "intents-quote", 12);
    const body = z
      .object({
        destinationAsset: z.string().min(1).max(250),
        amount: z.string().max(20),
      })
      .strict()
      .safeParse(req.body);
    if (!body.success)
      return reply.code(400).send({
        error:
          "Choose an Intents asset and NEAR amount. This endpoint only previews dry quotes.",
      });
    try {
      return await intents.quote(body.data.destinationAsset, body.data.amount);
    } catch (e) {
      return reply.code(e instanceof IntentsError ? e.status : 503).send({
        ...(e instanceof IntentsError ? e.details : {}),
        error:
          e instanceof IntentsError
            ? e.message
            : "Intents quote unavailable. Try again.",
      });
    }
  });
  app.get("/api/activity", () => service.activitySnapshot());
  // Mainnet pricing only. No recipient, deposit, signature or order accepted.
  app.post("/api/perps/funding-quote", async (req, reply) => {
    // Its own bucket: sharing one with /api/intents/quote meant quoting a
    // deposit drained the swap-preview allowance, and the other way round.
    rate(req, "perps-funding-quote", 12);
    const body = z
      .object({ amount: z.string().max(20) })
      .strict()
      .safeParse(req.body);
    if (!body.success)
      return reply.code(400).send({
        error: "Use a NEAR amount for a dry mainnet collateral quote.",
      });
    try {
      if (!intents.hyperliquidQuote)
        throw new IntentsError(
          "Hyperliquid funding quotes are not configured.",
        );
      return await intents.hyperliquidQuote(body.data.amount);
    } catch (e) {
      return reply.code(e instanceof IntentsError ? e.status : 503).send({
        ...(e instanceof IntentsError ? e.details : {}),
        error:
          e instanceof IntentsError
            ? e.message
            : "Perps funding quote unavailable.",
      });
    }
  });
  app.get("/api/base/tokens", (req) => {
    rate(req, "base-catalog", 30);
    return {
      tokens: service.baseTokens().map((t: any) => ({
        address: t.mint,
        symbol: t.symbol,
        name: t.name,
        icon: t.icon,
      })),
      coverage:
        "Indexed Base tokens only; not a complete ERC-20 portfolio index.",
    };
  });
  app.get("/api/evm/tokens/:chain", (req, reply) => {
    rate(req, "evm-catalog", 30);
    const chain = (req.params as any).chain;
    if (chain !== "base" && chain !== "bsc")
      return reply.code(400).send({ error: "Unsupported chain" });
    return {
      tokens: service.evmTokens(chain).map((t: any) => ({
        address: t.mint,
        symbol: t.symbol,
        name: t.name,
        icon: t.icon,
      })),
      coverage: "Indexed token contracts only; not a complete portfolio index.",
    };
  });
  app.post("/api/pool/import", async (req, reply) => {
    rate(req, "pool-import", 12);
    const body = z
      .object({
        chain: z.enum(["solana", "base", "bsc", "near"]),
        mint: z.string().max(100),
      })
      .strict()
      .safeParse(req.body);
    if (
      !body.success ||
      (body.data.chain === "solana"
        ? !validMint(body.data.mint)
        : body.data.chain === "near"
          ? !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(body.data.mint) ||
            body.data.mint.length < 2 ||
            body.data.mint.length > 64
          : !/^0x[0-9a-fA-F]{40}$/.test(body.data.mint))
    )
      return reply
        .code(400)
        .send({ error: "Choose a chain and valid token address." });
    try {
      const token = await service.importToken(body.data.mint, body.data.chain);
      return { token };
    } catch (e) {
      return reply.code(503).send({
        error: clientMessage(e, "Token lookup unavailable.", "token import"),
      });
    }
  });
  app.get("/api/tokens/:mint", async (req, reply) => {
    if (isPublic) rate(req, "detail", 30);
    const mint = (req.params as any).mint;
    if (!validMint(mint))
      return reply.code(400).send({ error: "Invalid Solana mint" });
    try {
      const info = await service.tokenInfo(mint);
      return (
        info ??
        reply.code(404).send({ error: "No indexed DEX Screener pool yet" })
      );
    } catch (e) {
      return reply.code(503).send({
        error: clientMessage(e, "Token data unavailable.", "token detail"),
      });
    }
  });
  app.get("/api/execution", (req) => {
    const state = isPublic
      ? (beta?.snapshot(identity(req)) ?? {
          ready: false,
          busy: false,
          phase: "unavailable",
          positions: [],
          receipts: [],
          operation: null,
          session: null,
          access: {
            public: true,
            available: false,
            claimed: false,
            signedIn: !!identity(req),
            identity: identity(req),
          },
          error:
            "Sponsored test trades are not configured on this release. Free test previews remain available.",
        })
      : (execution?.snapshot() ?? {
          ready: false,
          phase: "setup",
          mode: "testnet-only",
        });
    const user = identity(req),
      id = state.operation?.id;
    const binding =
      id &&
      options.store?.getRecord<{ owner: string }>("points:practice-op:" + id);
    return {
      ...state,
      rewardEligibleOperationId:
        user && binding?.owner === subjectFor(user) ? id : null,
    };
  });
  app.get("/api/events", (req, reply) => {
    if (isPublic)
      return reply.code(404).send({ error: "Use private execution polling" });
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const send = () =>
      reply.raw.write(
        "data: " +
          JSON.stringify({ type: "execution", at: new Date().toISOString() }) +
          "\n\n",
      );
    send();
    const unsubscribe = execution?.subscribe(send);
    reply.raw.on("close", () => unsubscribe?.());
  });
  app.post("/api/execution/:action", async (req, reply) => {
    const action = (req.params as any).action;
    if (isPublic && action === "smoke-draw")
      return reply.code(404).send({ error: "No such operation" });
    if (isPublic && !beta)
      return reply.code(503).send({
        error: "Sponsored test execution is not configured on this release.",
      });
    const user = isPublic ? identity(req) : null;
    if (isPublic && !user)
      throw new AuthError(
        "SIGN_IN_REQUIRED",
        "Connect and verify your wallet before using a testnet account.",
      );
    if (isPublic) {
      auth.rate("execution:" + subjectFor(user!), 30);
      if (action === "claim") {
        if (Object.keys((req.body ?? {}) as object).length)
          return reply
            .code(400)
            .send({ error: "Claim has no account parameters" });
        return beta!.claim(user!, req.ip);
      }
      if (
        ["activate", "revoke", "recover"].includes(action) &&
        Object.keys((req.body ?? {}) as object).length
      )
        return reply
          .code(400)
          .send({ error: "This action has no account parameters" });
      if (action === "activate") return beta!.activate(user!);
    }
    const target = isPublic ? beta!.forIdentity(user!) : execution;
    if (!target)
      return reply
        .code(503)
        .send({ error: "Execution service not initialized" });
    try {
      const body = req.body as any;
      if (action === "activate") return await target.activate();
      if (action === "revoke") return await target.revoke();
      if (action === "recover") {
        await target.tick();
        return target.snapshot();
      }
      if (action === "draw" || action === "smoke-draw") {
        const parsed = z
          .object({
            rollId,
            mode: z.enum(["auto", "reveal"]).default("auto"),
          })
          .strict()
          .safeParse(body);
        if (!parsed.success)
          return reply.code(400).send({ error: "Invalid draw request" });
        if (
          action === "smoke-draw" &&
          process.env.JACKPOT_VERIFY_EXECUTION !== "1"
        )
          return reply.code(404).send({ error: "No such operation" });
        const result = await target.draw(
          parsed.data.rollId,
          parsed.data.mode,
          action === "smoke-draw",
        );
        const pointsUser = identity(req);
        if (
          pointsUser &&
          result?.operation?.id &&
          options.store &&
          action === "draw"
        )
          options.store.putRecordIfAbsent(
            "points:practice-op:" + result.operation.id,
            {
              owner: subjectFor(pointsUser),
              session: result.operation.session,
              drawId: result.operation.expectedDraw,
              createdAt: result.operation.createdAt,
            },
          );
        return result;
      }
      if (action === "confirm" || action === "retry") {
        const p = z.object({ id: z.string().uuid() }).strict().safeParse(body);
        if (!p.success)
          return reply.code(400).send({ error: "Invalid selected operation" });
        return action === "confirm"
          ? await target.confirm(p.data.id)
          : await target.retry(p.data.id);
      }
      if (action === "exit") {
        const p = z
          .object({
            marketIndex: z.number().int().min(0).max(2),
            amountAtomic: z
              .string()
              .regex(/^[1-9]\d{0,19}$/)
              .optional(),
          })
          .strict()
          .safeParse(body);
        if (!p.success)
          return reply.code(400).send({ error: "Invalid test market" });
        return await target.exit(p.data.marketIndex, p.data.amountAtomic);
      }
      return reply.code(404).send({ error: "No such operation" });
    } catch (e) {
      if (e instanceof AuthError) throw e;
      return reply.code(409).send({
        error: clientMessage(e, "Execution unavailable.", "test exit"),
      });
    }
  });
  app.get("/api/health", () => ({
    ok: true,
    mode: "live-discovery-wallet-approved",
    deployment: runtime.mode,
  }));
  app.get("/api/security/:mint", async (req, reply) => {
    if (isPublic) rate(req, "security", 12);
    const mint = (req.params as any).mint;
    if (!validMint(mint))
      return reply.code(400).send({ error: "Invalid Solana mint" });
    return service.tokenRisk(mint);
  });
  app.get("/api/price-trends/:mint", async (req, reply) => {
    if (isPublic) rate(req, "price-trend", 120);
    const mint = (req.params as any).mint;
    if (!validMint(mint))
      return reply.code(400).send({ error: "Invalid Solana mint" });
    return options.store
      ? options.store.priceTrend(mint)
      : reply.code(503).send({ error: "Price history unavailable" });
  });
  app.get("/api/charts/:mint", async (req, reply) => {
    if (isPublic) rate(req, "chart", 20);
    const mint = (req.params as any).mint;
    const q = z
      .object({ range: z.enum(["1m", "5m", "1h"]).default("1m") })
      .strict()
      .safeParse(req.query);
    if (!validMint(mint) || !q.success)
      return reply.code(400).send({ error: "Invalid mint or chart range" });
    try {
      return await service.sourceChart(mint, q.data.range);
    } catch (e) {
      return reply.code(503).send({
        error: clientMessage(e, "Source chart unavailable.", "source chart"),
      });
    }
  });
  app.post("/api/portfolio/solana/:address/positions", async (req, reply) => {
    rate(req, "portfolio-positions", 6);
    const address = (req.params as any).address;
    const parsed = z
      .object({ signatures: z.array(z.string().min(80).max(90)).max(20) })
      .strict()
      .safeParse(req.body);
    if (!validMint(address) || !parsed.success)
      return reply.code(400).send({ error: "Invalid address or receipt list" });
    if (!parsed.data.signatures.length)
      return {
        wallet: address,
        positions: [],
        warnings: [],
        coverage: "No recorded receipts",
      };
    try {
      return await portfolioPositions.read(address, parsed.data.signatures);
    } catch (e) {
      return reply.code(503).send({
        error: clientMessage(
          e,
          "Entry history unavailable.",
          "portfolio entry",
        ),
      });
    }
  });
  app.get("/api/portfolio/:kind/:address", async (req, reply) => {
    if (isPublic) rate(req, "portfolio", 12);
    const { kind, address } = req.params as any;
    if (!["near", "solana", "solana-devnet"].includes(kind))
      return reply.code(400).send({ error: "Unsupported portfolio network" });
    try {
      return await portfolios.read(kind, address);
    } catch (e) {
      const message = clientMessage(
        e,
        "Portfolio unavailable.",
        "portfolio read",
      );
      return reply
        .code(
          message.startsWith("Invalid") || message.startsWith("Use a valid")
            ? 400
            : 503,
        )
        .send({ error: message });
    }
  });
  app.addHook("onClose", async () => service.closeSnapshotReader?.());
  app.get("/api/markets", async (req, reply) => {
    const query = z
      .object({
        offset: z.coerce.number().int().min(0).max(200000).default(0),
        limit: z.coerce.number().int().min(1).max(200).default(200),
        matchingOnly: z.enum(["true", "false"]).default("false"),
      })
      .strict()
      .safeParse(req.query);
    if (!query.success) return reply.code(400).send({ error: "Invalid page" });
    const target = discovery(req, reply);
    const options = {
      ...query.data,
      matchingOnly: query.data.matchingOnly === "true",
    };
    let snapshot;
    try {
      snapshot = target.snapshotAsync
        ? await target.snapshotAsync(options)
        : target.snapshot(options);
    } catch {
      return reply
        .code(503)
        .send({ error: "Market view is busy or unavailable. Retry shortly." });
    }
    return isPublic
      ? { ...snapshot, viewer: { identity: identity(req) } }
      : snapshot;
  });
  /**
   * Begins a roll: the server freezes the field, commits to a winner and returns
   * only the commitment. The winner leaves this server nowhere but /reveal.
   */
  app.post("/api/preview", async (req, reply) => {
    rate(req, "preview", 30);
    const body = z
      .object({
        configurationHash: z.string().regex(/^[a-f0-9]{64}$/),
        amountMode: z.enum(["fixed", "full_degen"]).default("fixed"),
        poolKeys: z.array(z.string().min(1).max(120)).min(2).max(32).optional(),
      })
      .strict()
      .safeParse(req.body);
    if (!body.success)
      return reply.code(400).send({ error: "Invalid configuration hash" });
    try {
      return discovery(req, reply).beginRoll(
        body.data.configurationHash,
        body.data.amountMode,
        body.data.poolKeys,
      );
    } catch (e) {
      if (e instanceof AuthError) throw e;
      return reply.code(409).send({
        error: clientMessage(e, "Preview unavailable.", "preview"),
      });
    }
  });
  /** Reveals the committed winner and the seed so the roll can be re-verified. */
  app.post("/api/preview/reveal", async (req, reply) => {
    rate(req, "preview", 30);
    const body = z.object({ rollId }).strict().safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid roll" });
    try {
      return discovery(req, reply).revealRoll(body.data.rollId);
    } catch (e) {
      if (e instanceof AuthError) throw e;
      return reply.code(409).send({
        error: e instanceof Error ? e.message : "Reveal unavailable",
      });
    }
  });
  app.post("/api/discovery", async (req, reply) => {
    const parsed = configuration.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "Invalid ticket or filters" });
    const x = parsed.data,
      f = {
        ...discoveryPreset(x.preset),
        ...x.filters,
      };
    if (!validFilterRanges(f))
      return reply.code(400).send({ error: "Minimum exceeds maximum" });
    discovery(req, reply).configure({
      filters: f,
      ticketAtomic: String(Math.round(Number(x.ticket) * 1e6)),
    });
    return { ok: true };
  });
  return app;
}
