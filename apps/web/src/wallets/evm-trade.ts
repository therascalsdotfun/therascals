import {
  EVM_MAINNET,
  sameEvm,
  validateEvmQuote,
  type EvmTradeQuote,
  type EvmPreflight,
} from "../../../../packages/shared/src/evm-mainnet.ts";
import type { EvmProvider } from "./providers.ts";
export async function assertEvmWallet(
  provider: EvmProvider,
  quote: EvmTradeQuote,
  current: () => boolean,
) {
  if (!current())
    throw Error("Wallet or token changed. Review the trade again.");
  const accounts = await provider.request({ method: "eth_accounts" });
  const chainId = await provider.request({ method: "eth_chainId" });
  if (
    !current() ||
    !Array.isArray(accounts) ||
    !sameEvm(accounts[0], quote.wallet) ||
    String(chainId).toLowerCase() !== EVM_MAINNET[quote.chain].hex
  )
    throw Error(
      "MetaMask account or network changed. Review the correct wallet and chain.",
    );
}
export async function switchEvmTradeNetwork(
  provider: EvmProvider,
  chain: "base" | "bsc",
) {
  const network = EVM_MAINNET[chain];
  if (
    String(await provider.request({ method: "eth_chainId" })).toLowerCase() ===
    network.hex
  )
    return;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: network.hex }],
    });
  } catch (e: any) {
    if (e?.code !== 4902) throw e;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: network.hex,
          chainName: network.name,
          nativeCurrency: {
            name: network.symbol,
            symbol: network.symbol,
            decimals: 18,
          },
          rpcUrls: [network.rpc],
          blockExplorerUrls: [network.explorer],
        },
      ],
    });
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: network.hex }],
    });
  }
  if (
    String(await provider.request({ method: "eth_chainId" })).toLowerCase() !==
    network.hex
  )
    throw Error("Wallet did not switch to " + network.name);
}
export async function submitReviewedEvmTrade(
  provider: EvmProvider,
  quote: EvmTradeQuote,
  simulation: EvmPreflight,
  current: () => boolean,
  beforeRequest: () => void,
) {
  const age = Date.now() - Date.parse(simulation.checkedAt);
  if (
    simulation.status !== "passed" ||
    !simulation.gas ||
    !simulation.gasPrice ||
    age < 0 ||
    age > 20000 ||
    Date.parse(quote.expiresAt) <= Date.now()
  )
    throw Error("Quote or simulation expired. Check the trade again.");
  const validated = validateEvmQuote(quote.routeQuote, {
    chain: quote.chain,
    wallet: quote.wallet,
    mint: quote.mint,
    amountAtomic: quote.nativeAmount,
  });
  if (JSON.stringify(validated) !== JSON.stringify(quote.transaction))
    throw Error("Reviewed transaction changed");
  await assertEvmWallet(provider, quote, current);
  const tx = {
    ...validated,
    gas: simulation.gas,
    gasPrice: simulation.gasPrice,
  };
  // Wallet-local preflight uses its real state. No balance overrides or allowances.
  await provider.request({
    method: "eth_call",
    params: [
      { from: tx.from, to: tx.to, value: tx.value, data: tx.data, gas: tx.gas },
      "latest",
    ],
  });
  await assertEvmWallet(provider, quote, current);
  if (Date.parse(quote.expiresAt) <= Date.now())
    throw Error("Quote expired during preflight. Refresh the route.");
  beforeRequest(); // Persist ambiguity lock before the only broadcast-capable request.
  const hash = await provider.request({
    method: "eth_sendTransaction",
    params: [tx],
  });
  if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash))
    throw Error(
      "Wallet returned no valid transaction hash. Inspect wallet activity before doing anything else.",
    );
  return hash;
}
