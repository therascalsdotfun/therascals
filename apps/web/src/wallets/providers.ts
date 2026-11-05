export type EvmProvider = {
  request: (args: {
    method: string;
    params?: unknown[] | object;
  }) => Promise<any>;
  on?: (event: string, callback: (...args: any[]) => void) => void;
  removeListener?: (event: string, callback: (...args: any[]) => void) => void;
  [key: string]: any;
};
export type Announcement = {
  info: { uuid?: string; rdns: string; name?: string; icon?: string };
  provider: EvmProvider;
};
export function selectMetaMask(
  announcements: Announcement[],
  legacy?: any,
): EvmProvider | null {
  const announced = announcements.find((a) => a.info.rdns === "io.metamask");
  if (announced) return announced.provider;
  const candidates = legacy?.providers ?? [legacy];
  return (
    candidates.find(
      (p: any) =>
        p?.isMetaMask &&
        p?._metamask &&
        !p.isPhantom &&
        !p.isRabby &&
        !p.isBraveWallet,
    ) ?? null
  );
}
export function phantomProvider(env: any = window): any | null {
  return env.phantom?.solana?.isPhantom ? env.phantom.solana : null;
}
export function walletError(e: any): string {
  const code = e?.code ?? e?.error?.code;
  if (
    code === 4001 ||
    code === "ACTION_REJECTED" ||
    e?.message === "User rejected" ||
    e?.message === "Wallet closed"
  )
    return "Request cancelled in your wallet. No transaction or spending permission was requested.";
  if (code === -32002 || code === "REQUEST_PENDING")
    return "A request is already waiting in your wallet. Open it, or close the old popup before retrying.";
  if (code === 4100)
    return "Unlock your wallet and allow account access, then reconnect.";
  if (code === 4200 || code === -32601 || code === "SIGNING_UNSUPPORTED")
    return "This wallet does not support the requested message-signing method. Choose a compatible wallet or keep using read-only balances.";
  if (code === 4900 || code === 4901)
    return "Your wallet is disconnected from its network. Check the wallet connection and try again.";
  const messages: Record<string, string> = {
    REQUEST_CANCELLED:
      "Request cancelled here. Close the old wallet popup before trying again; late approvals will be ignored.",
    REQUEST_TIMEOUT:
      "Wallet request timed out. Close the old popup, unlock your wallet and try again.",
    ACCOUNT_CHANGED:
      "Wallet account or network changed. Verify the currently selected account again.",
    PROVIDER_MISSING:
      "Wallet extension not found. Open Rascals in the browser where this wallet is installed, then retry.",
    CHALLENGE_EXPIRED:
      "The sign-in message expired or was cancelled. Verify again to request a fresh message.",
    CHALLENGE_MISMATCH:
      "The sign-in message does not match this wallet or site. Reconnect and try again.",
    INVALID_SIGNATURE:
      "The signature did not match this wallet. Reconnect the intended account and verify again.",
    KEY_NOT_AUTHORIZED:
      "The signing key is not a current full-access key of this NEAR account. Choose the correct account or wallet.",
    RPC_UNAVAILABLE:
      "NEAR key verification is temporarily unavailable. Your account remains unverified; try again shortly.",
    RATE_LIMITED:
      "Too many sign-in requests. Wait a minute before trying again.",
    SESSION_EXPIRED:
      "Your wallet sign-in expired. Balances remain available; verify again when ready.",
    AUTH_UNAVAILABLE:
      "Wallet verification is unavailable. Check your connection and try again.",
    LOGOUT_TIMEOUT:
      "Server sign-out timed out. Check your connection and retry sign-out before verifying again; no new wallet signature is needed for sign-out.",
    LOGOUT_NETWORK:
      "Signed out on this device, but the sign-out server could not be reached. Check your connection and retry sign-out before verifying again.",
    LOGOUT_ORIGIN:
      "The server rejected sign-out from this site address. Open the configured app address and retry sign-out before verifying again.",
    LOGOUT_RATE_LIMITED:
      "The sign-out server is busy. Wait a moment and retry sign-out before verifying again.",
    LOGOUT_SERVER:
      "The server could not complete sign-out. Retry sign-out before verifying again.",
    LOGOUT_RESPONSE:
      "The server returned an unexpected sign-out response. Retry sign-out before verifying again.",
    LOGOUT_UNCONFIRMED:
      "Signed out here, but server sign-out could not be confirmed. Retry sign-out before verifying again.",
  };
  return (
    messages[code] ??
    "Could not complete this wallet request. Check your connection, unlock your wallet and try again."
  );
}
export type WalletAsset = {
  mint: string;
  symbol: string;
  name?: string;
  icon?: string | null;
  raw: string;
  decimals: number;
  priceUsd?: number | null;
  valueUsd?: number | null;
};
export type WalletPortfolio = {
  address: string;
  network: string;
  chainId?: string;
  assets: WalletAsset[];
  asOf: string;
  coverage: string;
  warnings?: string[];
};
export function formatUnits(raw: string, decimals: number, digits = 6) {
  if (
    !/^\d+$/.test(raw) ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 36
  )
    return "Unknown";
  const n = BigInt(raw),
    scale = 10n ** BigInt(decimals),
    whole = n / scale,
    fraction = (n % scale)
      .toString()
      .padStart(decimals, "0")
      .slice(0, digits)
      .replace(/0+$/, "");
  return whole.toLocaleString("en") + (fraction ? "." + fraction : "");
}
const evmNetworks: Record<string, string> = {
  "0x1": "Ethereum mainnet",
  "0xaa36a7": "Ethereum Sepolia",
  "0x2105": "Base mainnet",
  "0x38": "BNB Chain mainnet",
  "0x14a34": "Base Sepolia",
  "0xa": "Optimism mainnet",
  "0xa4b1": "Arbitrum One",
};
export async function readEvmPortfolio(
  provider: EvmProvider,
  address: string,
  trackedTokens: {
    address: string;
    symbol: string;
    name?: string;
    icon?: string | null;
  }[] = [],
): Promise<WalletPortfolio> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address))
    throw Error("Invalid Ethereum address");
  const chainId = String(
    await provider.request({ method: "eth_chainId" }),
  ).toLowerCase();
  const raw = await provider.request({
    method: "eth_getBalance",
    params: [address, "latest"],
  });
  if (typeof raw !== "string" || !/^0x[0-9a-fA-F]+$/.test(raw))
    throw Error("Invalid native balance response");
  const known = !!evmNetworks[chainId];
  const assets: WalletAsset[] = [
    {
      mint: "native",
      symbol: chainId === "0x38" ? "BNB" : known ? "ETH" : "Native wei",
      raw: BigInt(raw).toString(),
      decimals: known ? 18 : 0,
    },
  ];
  const usdc: Record<string, string> = {
    "0x1": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    "0x2105": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "0x14a34": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    "0xaa36a7": "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    "0x38": "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
  };
  const warnings: string[] = [];
  if (usdc[chainId])
    try {
      const balance = await provider.request({
        method: "eth_call",
        params: [
          {
            to: usdc[chainId],
            data:
              "0x70a08231" + address.slice(2).toLowerCase().padStart(64, "0"),
          },
          "latest",
        ],
      });
      if (typeof balance !== "string" || !/^0x[0-9a-fA-F]+$/.test(balance))
        throw Error("Invalid USDC balance");
      assets.push({
        mint: usdc[chainId],
        symbol: "USDC",
        raw: BigInt(balance).toString(),
        decimals: chainId === "0x38" ? 18 : 6,
      });
    } catch {
      warnings.push("USDC balance unavailable on this RPC.");
    }
  if (chainId === "0x38") {
    try {
      const balance = await provider.request({
        method: "eth_call",
        params: [
          {
            to: "0x55d398326f99059ff775485246999027b3197955",
            data:
              "0x70a08231" + address.slice(2).toLowerCase().padStart(64, "0"),
          },
          "latest",
        ],
      });
      if (typeof balance !== "string" || !/^0x[0-9a-fA-F]+$/.test(balance))
        throw Error("Invalid USDT balance");
      assets.push({
        mint: "0x55d398326f99059ff775485246999027b3197955",
        symbol: "USDT",
        raw: BigInt(balance).toString(),
        decimals: 18,
      });
    } catch {
      warnings.push("USDT balance unavailable on this RPC.");
    }
  }
  if (chainId === "0x2105" || chainId === "0x38") {
    const tokens = [
      ...new Map(
        trackedTokens
          .filter(
            (t) =>
              /^0x[0-9a-fA-F]{40}$/.test(t.address) &&
              t.address.toLowerCase() !== usdc[chainId]?.toLowerCase() &&
              t.address.toLowerCase() !==
                "0x55d398326f99059ff775485246999027b3197955",
          )
          .map((t) => [t.address.toLowerCase(), t]),
      ).values(),
    ].slice(0, 20);
    for (let start = 0; start < tokens.length; start += 4) {
      const results = await Promise.allSettled(
        tokens.slice(start, start + 4).map(async (token) => {
          const balance = await provider.request({
            method: "eth_call",
            params: [
              {
                to: token.address,
                data:
                  "0x70a08231" +
                  address.slice(2).toLowerCase().padStart(64, "0"),
              },
              "latest",
            ],
          });
          if (typeof balance !== "string" || !/^0x[0-9a-fA-F]+$/.test(balance))
            throw Error("Bad token balance");
          if (BigInt(balance) === 0n) return null;
          const rawDecimals = await provider.request({
            method: "eth_call",
            params: [{ to: token.address, data: "0x313ce567" }, "latest"],
          });
          if (
            typeof rawDecimals !== "string" ||
            !/^0x[0-9a-fA-F]+$/.test(rawDecimals) ||
            BigInt(rawDecimals) > 36n
          )
            throw Error("Unknown decimals");
          return {
            mint: token.address.toLowerCase(),
            symbol: token.symbol.slice(0, 24),
            name: token.name?.slice(0, 100),
            icon: token.icon,
            raw: BigInt(balance).toString(),
            decimals: Number(BigInt(rawDecimals)),
          };
        }),
      );
      for (const result of results)
        if (result.status === "fulfilled" && result.value)
          assets.push(result.value);
        else if (result.status === "rejected")
          warnings.push("An indexed token could not be read.");
    }
    warnings.push(
      `Only ${chainId === "0x38" ? "BNB, known USDC/USDT" : "ETH, native USDC"} and up to 20 indexed tokens were checked. Other holdings may exist; values are unpriced.`,
    );
  }
  if (
    String(await provider.request({ method: "eth_chainId" })).toLowerCase() !==
    chainId
  )
    throw Error("Wallet network changed. Refreshing balances is required.");
  return {
    address,
    chainId,
    network: evmNetworks[chainId] ?? "EVM " + chainId,
    assets,
    asOf: new Date().toISOString(),
    coverage:
      chainId === "0x2105" || chainId === "0x38"
        ? `${chainId === "0x38" ? "BNB + known USDC/USDT" : "Base ETH + native Circle USDC"} + up to 20 indexed token contracts. Unpriced and incomplete; no transfers or approvals.`
        : usdc[chainId]
          ? "ETH + Circle USDC on this network. Other ERC-20 tokens are not indexed."
          : "Native balance on your wallet-selected network. This is not a complete ERC-20 index.",
    warnings,
  };
}

export async function switchToBase(provider: EvmProvider) {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x2105" }],
    });
  } catch (e: any) {
    if (e?.code !== 4902) throw e;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: "0x2105",
          chainName: "Base",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: ["https://mainnet.base.org"],
          blockExplorerUrls: ["https://basescan.org"],
        },
      ],
    });
  }
  if (
    String(await provider.request({ method: "eth_chainId" })).toLowerCase() !==
    "0x2105"
  )
    throw Error("Base network switch was not confirmed.");
}
