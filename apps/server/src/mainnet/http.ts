import { solanaReceipt } from "./solana-receipt.ts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { EvmMainnet, EvmTradeError } from "./evm.ts";
import { mainnetConnection } from "./funding.ts";
import { simulateSolanaMessage } from "./preflight.ts";
import { clientMessage } from "../client-message.ts";
import type { Connection } from "@solana/web3.js";
import { registerSellQuotes } from "../portfolio/sell-quote.ts";
import type { CommunityPresets } from "../presets/service.ts";
import type { WalletIdentity } from "../../../../packages/shared/src/wallet-auth.ts";
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  chain = z.enum(["base", "bsc"]);
export function registerMainnet(
  app: FastifyInstance,
  options: {
    market: (req: any, reply: any) => any;
    rate: (key: string, max: number) => void;
    evm?: EvmMainnet;
    solana?: Connection;
    presets?: CommunityPresets;
    identity?: (req: any) => WalletIdentity | null;
  },
) {
  registerSellQuotes(app, options.rate);
  const evm = options.evm ?? new EvmMainnet(),
    solana = options.solana ?? mainnetConnection();
  function failure(reply: any, e: unknown) {
    return reply.code(e instanceof EvmTradeError ? e.status : 409).send({
      error: clientMessage(
        e,
        "Trade unavailable. No transaction was sent.",
        "mainnet trade",
      ),
    });
  }
  app.get("/api/mainnet/solana/receipt", async (req, reply) => {
    reply.header("cache-control", "no-store");
    options.rate("solana-receipt:" + req.ip, 40);
    const p = z
      .object({
        signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{80,90}$/),
        blockhash: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
        observedSlot: z.coerce
          .number()
          .int()
          .positive()
          .max(Number.MAX_SAFE_INTEGER),
      })
      .strict()
      .safeParse(req.query);
    if (!p.success)
      return reply
        .code(400)
        .send({ error: "Invalid Solana signature or blockhash" });
    try {
      return await solanaReceipt(
        p.data.signature,
        p.data.blockhash,
        p.data.observedSlot,
        solana,
      );
    } catch (e) {
      return reply
        .code(503)
        .send({
          error:
            "Original transaction status is unavailable. Keep this submission pending.",
        });
    }
  });
  app.post("/api/mainnet/solana/simulate", async (req, reply) => {
    options.rate("solana-simulate:" + req.ip, 12);
    const p = z
      .object({
        transaction: z
          .string()
          .min(1)
          .max(1644)
          .regex(/^[A-Za-z0-9+/]+={0,2}$/),
        wallet: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
      })
      .strict()
      .safeParse(req.body);
    if (!p.success)
      return reply.code(400).send({
        error: "Invalid wallet or transaction; Solana's limit is 1232 bytes.",
      });
    try {
      return await simulateSolanaMessage(
        p.data.transaction,
        p.data.wallet,
        solana,
      );
    } catch (e) {
      return failure(reply, e);
    }
  });
  app.post("/api/mainnet/evm/quote", async (req, reply) => {
    options.rate("evm-quote:" + req.ip, 8);
    const p = z
      .object({
        chain,
        mint: address,
        wallet: address,
        amount: z
          .string()
          .regex(/^(?:[1-9]\d?|100)(?:\.\d{1,2})?$/)
          .refine((v) => Number(v) <= 100),
        rollId: z.string().regex(/^[a-f0-9]{64}$/).optional(),
        presetId: z.string().uuid().optional(),
      })
      .strict()
      .safeParse(req.body);
    if (!p.success)
      return reply.code(400).send({
        error:
          "Choose Base or BNB, an exact token contract, wallet and $1–$100.",
      });
    try {
      const market = options.market(req, reply),
        token = await market.revalidateEvmSelected(
          p.data.chain,
          p.data.mint,
          market.snapshot().filters,
        );
      const user = options.identity?.(req);
      const attributedPreset =
        p.data.presetId ??
        (user && p.data.rollId ? options.presets?.presetForRoll(user, p.data.rollId) : null) ??
        (user ? options.presets?.activeFor(user) : null);
      return await evm.quote({
        ...p.data,
        symbol: token.symbol,
        ...(attributedPreset ? { presetId: attributedPreset } : {}),
      });
    } catch (e) {
      return failure(reply, e);
    }
  });
  app.post("/api/mainnet/evm/simulate", async (req, reply) => {
    options.rate("evm-simulate:" + req.ip, 12);
    const p = z
      .object({ quoteId: z.string().uuid(), wallet: address })
      .strict()
      .safeParse(req.body);
    if (!p.success)
      return reply.code(400).send({ error: "Invalid quote or wallet" });
    try {
      const quote = evm.get(p.data.quoteId, p.data.wallet),
        market = options.market(req, reply);
      await market.revalidateEvmSelected(
        quote.chain,
        quote.mint,
        market.snapshot().filters,
      );
      evm.get(p.data.quoteId, p.data.wallet);
      return await evm.simulate(quote);
    } catch (e) {
      return failure(reply, e);
    }
  });
  app.get("/api/mainnet/evm/receipt", async (req, reply) => {
    options.rate("evm-receipt:" + req.ip, 40);
    const p = z
      .object({
        chain,
        hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
        quoteId: z.string().uuid().optional(),
        presetId: z.string().uuid().optional(),
      })
      .strict()
      .safeParse(req.query);
    if (!p.success)
      return reply
        .code(400)
        .send({ error: "Invalid network or transaction hash" });
    try {
      const receipt = await evm.receipt(p.data.chain, p.data.hash);
      if (receipt?.status === "confirmed" && options.presets) {
        const draft = p.data.quoteId ? evm.getDraft(p.data.quoteId) : undefined;
        const preset = p.data.presetId ?? draft?.presetId;
        const u =
          options.identity?.(req) ??
          (draft
            ? {
                kind: "metamask" as const,
                address: draft.wallet,
                expiresAt: new Date(Date.now() + 86400000).toISOString(),
              }
            : null);
        if (u) {
          const finalPreset = preset ?? options.presets.activeFor(u);
          if (finalPreset) options.presets.tradeExecuted(u, finalPreset, p.data.hash);
        }
      }
      return receipt;
    } catch (e) {
      return failure(reply, e);
    }
  });
}
