import type { FastifyInstance } from "fastify";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { RequestScheduler } from "../routes/eligibility.ts";
import { UserError } from "../client-message.ts";
import {
  SOLANA_SELL_OUTPUTS,
  type SellEstimate,
  type SellOutput,
} from "../../../../packages/shared/src/sell-output.ts";

const mint = z.string().refine((s) => {
  try {
    return new PublicKey(s).toBase58() === s;
  } catch {
    return false;
  }
});
export const saleQuoteInput = z
  .object({
    inputMint: mint,
    output: z.enum(["USDC", "SOL"]),
    amount: z
      .string()
      .regex(/^[1-9]\d{0,19}$/)
      .refine(
        (s) => /^[1-9]\d{0,19}$/.test(s) && BigInt(s) <= 18446744073709551615n,
      ),
  })
  .strict()
  .refine((x) => x.inputMint !== SOLANA_SELL_OUTPUTS[x.output].mint);

export class SellQuotes {
  private cache = new Map<string, SellEstimate>();
  private pending = new Map<string, Promise<SellEstimate>>();
  private scheduler = new RequestScheduler(2500);
  constructor(
    private get: typeof fetch = fetch,
    private now = () => Date.now(),
  ) {}
  async quote(input: {
    inputMint: string;
    output: SellOutput;
    amount: string;
  }): Promise<SellEstimate> {
    const data = saleQuoteInput.parse(input),
      outputMint = SOLANA_SELL_OUTPUTS[data.output].mint;
    const key = [data.inputMint, outputMint, data.amount].join(":");
    const cached = this.cache.get(key);
    if (cached && cached.observedAt > this.now() - 10000) return { ...cached };
    const pending = this.pending.get(key);
    if (pending) return { ...(await pending) };
    if (this.pending.size >= 8)
      throw new UserError("Quote service is busy. Try again shortly.");
    const task = this.scheduler.run(async () => {
      const url =
        "https://api.jup.ag/swap/v2/order?" +
        new URLSearchParams({
          inputMint: data.inputMint,
          outputMint,
          amount: data.amount,
        });
      // No taker: a quote only. Never return or execute provider transactions here.
      const r = await this.get(url, {
        redirect: "error",
        signal: AbortSignal.timeout(12000),
        headers: {
          accept: "application/json",
          ...(process.env.JUPITER_API_KEY
            ? { "x-api-key": process.env.JUPITER_API_KEY }
            : {}),
        },
      });
      if (!r.ok)
        throw new UserError("Receive estimate unavailable. Try again shortly.");
      const q = (await r.json()) as any;
      if (
        q.error ||
        q.errorCode ||
        q.transaction !== null ||
        q.inputMint !== data.inputMint ||
        q.outputMint !== outputMint ||
        q.inAmount !== data.amount ||
        q.swapMode !== "ExactIn" ||
        typeof q.outAmount !== "string" ||
        !/^[1-9]\d{0,19}$/.test(q.outAmount) ||
        BigInt(q.outAmount) > 18446744073709551615n ||
        !Array.isArray(q.routePlan) ||
        !q.routePlan.length
      )
        throw new UserError(
          "No receive route is available for this amount and token.",
        );
      const observedAt = this.now();
      const result: SellEstimate = {
        inputMint: data.inputMint,
        outputMint,
        inAmount: data.amount,
        outAmount: q.outAmount,
        observedAt,
        expiresAt: observedAt + 30000,
      };
      if (this.cache.size >= 128)
        this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, result);
      return result;
    });
    this.pending.set(key, task);
    try {
      return { ...(await task) };
    } finally {
      this.pending.delete(key);
    }
  }
}
export function registerSellQuotes(
  app: FastifyInstance,
  rate: (key: string, max: number) => void,
  quotes = new SellQuotes(),
) {
  app.post("/api/mainnet/solana/sell-quote", async (req, reply) => {
    rate("solana-sell-quote:" + req.ip, 30);
    const p = saleQuoteInput.safeParse(req.body);
    if (!p.success)
      return reply.code(400).send({
        error: "Choose a token, receive currency and positive amount.",
      });
    try {
      return await quotes.quote(p.data);
    } catch (e) {
      return reply.code(503).send({
        error:
          e instanceof UserError
            ? e.message
            : "Receive estimate unavailable. Try again shortly.",
      });
    }
  });
}
