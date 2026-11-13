import {
  WalletMetamask,
  WalletPhantom,
  NetworkNearProtocol,
  NetworkSolana,
} from "@web3icons/react";
import type { WalletKind } from "../../../packages/shared/src/wallet-auth.ts";
export function WalletLogo({
  kind,
  size = 24,
}: {
  kind: WalletKind;
  size?: number;
}) {
  const Logo =
    kind === "metamask"
      ? WalletMetamask
      : kind === "phantom"
        ? WalletPhantom
        : NetworkNearProtocol;
  return (
    <Logo
      size={size}
      variant="branded"
      aria-hidden="true"
      className="wallet-brand-icon"
    />
  );
}
export function SolanaLogo({ size = 18 }: { size?: number }) {
  return (
    <NetworkSolana
      size={size}
      variant="branded"
      aria-hidden="true"
      className="chain-logo"
    />
  );
}

export function ChainLogo({
  chain,
  size = 20,
}: {
  chain: import("../../../packages/shared/src/token-selection.ts").DiscoveryChain;
  size?: number;
}) {
  if (chain === "near")
    return (
      <NetworkNearProtocol
        size={size}
        variant="branded"
        aria-hidden="true"
        className="chain-logo"
      />
    );
  if (chain === "bsc")
    return (
      <img
        src="/brands/bnb-chain.svg"
        width={size}
        height={size}
        alt=""
        aria-hidden="true"
        className="chain-logo"
      />
    );
  return chain === "solana" ? (
    <SolanaLogo size={size} />
  ) : (
    <img
      src="/brands/chains/base.png"
      width={size}
      height={size}
      className="chain-logo"
      alt=""
      aria-hidden="true"
    />
  );
}

export function JustHootLogo({
  size = 20,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src="/brands/justhoot/logo.png"
      width={size}
      height={size}
      alt="JustHoot"
      aria-hidden="true"
      className={`justhoot-logo ${className}`}
      style={{ borderRadius: 4, objectFit: "contain", verticalAlign: "middle" }}
    />
  );
}
