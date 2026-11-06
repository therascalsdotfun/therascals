import { randomUUID } from "node:crypto";
import { formatUnits, toQuantity } from "ethers";
import { clientMessage } from "../client-message.ts";
import {
  EVM_MAINNET,
  LIFI_NATIVE,
  nativeForDollars,
  sameEvm,
  validateEvmQuote,
  type EvmTradeChain,
  type EvmTradeQuote,
  type EvmPreflight,
} from "../../../../packages/shared/src/evm-mainnet.ts";

import { UserError } from "../client-message.ts";
export class EvmTradeError extends UserError {
  constructor(
    message: string,
    readonly status = 409,
    readonly rpcReason?: "insufficient_funds",
  ) {
    super(message);
  }
}
export class EvmMainnet {
  private drafts = new Map<string, EvmTradeQuote>();
  private prices = new Map<EvmTradeChain, { price: string; at: number }>();
  constructor(
    private fetcher: typeof fetch = fetch,
    private now = () => Date.now(),
  ) {}
  private async json(url: string, options?: RequestInit) {
    const response = await this.fetcher(url, {
      ...options,
      // A redirect would resend this request, and its body, to a host the
      // operator never configured.
      redirect: "error",
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok)
      throw new EvmTradeError(
        response.status === 429
          ? "Quote provider is busy. Wait a moment and retry."
          : "Quote provider is unavailable. No transaction was sent.",
        503,
      );
    const body = response.body?.getReader();
    if (!body) throw new EvmTradeError("Empty provider response", 503);
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await body.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 500000)
          throw new EvmTradeError("Provider response too large", 503);
        chunks.push(value);
      }
    } finally {
      await body.cancel().catch(() => {});
    }
    return JSON.parse(Buffer.concat(chunks).toString()) as any;
  }
  async rpc(chain: EvmTradeChain, method: string, params: unknown[]) {
    if (
      ![
        "eth_chainId",
        "eth_getBalance",
        "eth_getCode",
        "eth_gasPrice",
        "eth_call",
        "eth_estimateGas",
        "eth_getTransactionReceipt",
      ].includes(method)
    )
      throw Error("Forbidden RPC method");
    const j = await this.json(EVM_MAINNET[chain].rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (j.error) {
      // EvmTradeError copy is displayable, so the node's own wording (which
      // names internals and varies by provider) goes to the log, not the error.
      console.warn(
        "evm rpc error:",
        chain,
        method,
        String(j.error.message ?? "").slice(0, 240),
      );
      const e = new EvmTradeError(
        "The chain node rejected this request.",
        422,
        /insufficient funds|OutOfFunds|insufficient balance/i.test(
          String(j.error.message ?? ""),
        )
          ? "insufficient_funds"
          : undefined,
      );
      Object.assign(e, { rpcCode: j.error.code });
      throw e;
    }
    return j.result;
  }
  async quote(input: {
    chain: EvmTradeChain;
    mint: string;
    wallet: string;
    amount: string;
    symbol: string;
    presetId?: string;
  }) {
    const chain = EVM_MAINNET[input.chain];
    let native = this.prices.get(input.chain);
    if (!native || this.now() - native.at > 15000) {
      const t = await this.json(
        `https://li.quest/v1/token?${new URLSearchParams({ chain: String(chain.id), token: LIFI_NATIVE })}`,
      );
      if (
        !sameEvm(t.address, LIFI_NATIVE) ||
        t.chainId !== chain.id ||
        t.decimals !== 18 ||
        t.symbol !== chain.symbol ||
        typeof t.priceUSD !== "string"
      )
        throw new EvmTradeError(
          "Native token price could not be verified",
          503,
        );
      native = { price: t.priceUSD, at: this.now() };
      this.prices.set(input.chain, native);
    }
    const amountAtomic = nativeForDollars(input.amount, native.price);
    const raw = await this.json(
      "https://li.quest/v1/quote?" +
        new URLSearchParams({
          fromChain: String(chain.id),
          toChain: String(chain.id),
          fromToken: LIFI_NATIVE,
          toToken: input.mint,
          fromAmount: amountAtomic,
          fromAddress: input.wallet,
          toAddress: input.wallet,
          slippage: "0.01",
        }),
    );
    const transaction = validateEvmQuote(raw, { ...input, amountAtomic });
    const quote: EvmTradeQuote = {
      id: randomUUID(),
      chain: input.chain,
      wallet: input.wallet,
      mint: input.mint,
      symbol: input.symbol,
      decimals: raw.action.toToken.decimals,
      requestedUsd: input.amount,
      nativePriceUsd: native.price,
      nativeAmount: amountAtomic,
      outputAtomic: raw.estimate.toAmount,
      minimumOutputAtomic: raw.estimate.toAmountMin,
      createdAt: new Date(this.now()).toISOString(),
      expiresAt: new Date(this.now() + 45000).toISOString(),
      provider: "LI.FI",
      route: (raw.includedSteps ?? [])
        .filter((s: any) => s.type === "swap")
        .map((s: any) => String(s.tool).slice(0, 40))
        .slice(0, 12),
      fees: (raw.estimate.feeCosts ?? []).slice(0, 10).map((f: any) => ({
        name: String(f.name).slice(0, 80),
        usd: String(f.amountUSD).slice(0, 24),
        included: f.included === true,
      })),
      transaction,
      ...(input.presetId ? { presetId: input.presetId } : {}),
      routeQuote: {
        action: raw.action,
        estimate: {
          fromAmount: raw.estimate.fromAmount,
          toAmount: raw.estimate.toAmount,
          toAmountMin: raw.estimate.toAmountMin,
        },
        transactionRequest: raw.transactionRequest,
      },
    };
    this.drafts.set(quote.id, quote);
    for (const [id, q] of this.drafts)
      if (Date.parse(q.expiresAt) < this.now() - 60000) this.drafts.delete(id);
    while (this.drafts.size > 200)
      this.drafts.delete(this.drafts.keys().next().value!);
    return structuredClone(quote);
  }
  getDraft(id: string): EvmTradeQuote | undefined {
    return this.drafts.get(id);
  }
  get(id: string, wallet: string) {
    const quote = this.drafts.get(id);
    if (!quote || !sameEvm(quote.wallet, wallet))
      throw new EvmTradeError(
        "Trade quote does not belong to this wallet",
        404,
      );
    if (Date.parse(quote.expiresAt) <= this.now())
      throw new EvmTradeError(
        "Quote expired. Request a fresh route before approving.",
      );
    return structuredClone(quote);
  }
  async simulate(quote: EvmTradeQuote): Promise<EvmPreflight> {
    const checkedAt = new Date(this.now()).toISOString(),
      chain = EVM_MAINNET[quote.chain];
    try {
      if ((await this.rpc(quote.chain, "eth_chainId", [])) !== chain.hex)
        throw new EvmTradeError("RPC is not the selected mainnet", 503);
      if (
        (await this.rpc(quote.chain, "eth_getCode", [
          chain.router,
          "latest",
        ])) === "0x"
      )
        throw new EvmTradeError("Trading contract unavailable", 503);
      const balance = BigInt(
        await this.rpc(quote.chain, "eth_getBalance", [quote.wallet, "latest"]),
      );
      if (balance <= BigInt(quote.nativeAmount))
        return {
          status: "insufficient_funds",
          message: `Add ${chain.symbol} on ${chain.name} for this trade and gas. No approval was requested.`,
          checkedAt,
        };
      const { chainId: _, ...transaction } = quote.transaction;
      await this.rpc(quote.chain, "eth_call", [
        { ...transaction, gas: "0x2dc6c0" },
        "latest",
      ]);
      const gas = BigInt(
        await this.rpc(quote.chain, "eth_estimateGas", [transaction]),
      );
      const gasPrice = BigInt(await this.rpc(quote.chain, "eth_gasPrice", []));
      if (
        gas <= 0n ||
        gas > 3000000n ||
        gasPrice <= 0n ||
        gasPrice > 500000000000n
      )
        throw new EvmTradeError("Gas estimate is outside this MVP's limit");
      const limit = (gas * 125n) / 100n;
      if (
        Number(formatUnits(limit * gasPrice, 18)) *
          Number(quote.nativePriceUsd) >
        5
      )
        throw new EvmTradeError(
          "Estimated gas exceeds this MVP's $5 network-fee limit. Wait for lower fees or use the advanced trading venue.",
        );
      if (balance < BigInt(quote.nativeAmount) + limit * gasPrice)
        return {
          status: "insufficient_funds",
          message: `Not enough ${chain.symbol} for the trade plus estimated gas.`,
          checkedAt,
        };
      return {
        status: "passed",
        message: "Mainnet simulation passed with your wallet balance",
        gas: toQuantity(limit),
        gasPrice: toQuantity(gasPrice),
        gasCostNative: formatUnits(limit * gasPrice, 18),
        checkedAt,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : "RPC unavailable";
      const funds =
        (e instanceof EvmTradeError && e.rpcReason === "insufficient_funds") ||
        /insufficient funds|OutOfFunds|insufficient balance/i.test(message);
      return {
        status: funds ? "insufficient_funds" : "failed",
        // An RPC's own wording names node internals and changes shape between
        // providers, so only our own EvmTradeError copy reaches the player.
        message: funds
          ? `Not enough ${chain.symbol} for this trade and gas.`
          : clientMessage(
              e,
              "The chain rejected this trade before it was sent.",
              "evm preflight",
            ),
        checkedAt,
      };
    }
  }
  async receipt(chain: EvmTradeChain, hash: string) {
    if ((await this.rpc(chain, "eth_chainId", [])) !== EVM_MAINNET[chain].hex)
      throw new EvmTradeError("Wrong RPC network", 503);
    const r = await this.rpc(chain, "eth_getTransactionReceipt", [hash]);
    if (!r) return { status: "pending", hash, chain };
    if (!sameEvm(r.to, EVM_MAINNET[chain].router))
      throw new EvmTradeError("Receipt is not a supported token swap");
    if (
      typeof r.transactionHash !== "string" ||
      r.transactionHash.toLowerCase() !== hash.toLowerCase()
    )
      throw new EvmTradeError(
        "Receipt hash does not match the requested transaction",
      );
    return {
      status: r.status === "0x1" ? "success" : "reverted",
      hash,
      chain,
      wallet: r.from,
      blockNumber: r.blockNumber,
      gasUsed: r.gasUsed,
    };
  }
}
