import type { WalletAsset } from "../wallets/providers.ts";
import { TokenIcon } from "../TokenMedia.tsx";
import { assetBrand } from "./asset-art.ts";
import type { ReactNode } from "react";
export function AssetLabel({
  asset,
  network,
  chainId,
  size = 18,
  children,
}: {
  asset: Pick<WalletAsset, "mint" | "symbol" | "icon">;
  network: string;
  chainId?: string;
  size?: number;
  children?: ReactNode;
}) {
  return (
    <span className="inline-token-identity">
      <AssetIcon
        asset={asset}
        network={network}
        chainId={chainId}
        size={size}
      />
      <span>{children ?? asset.symbol}</span>
    </span>
  );
}
export function AssetIcon({
  asset,
  network,
  chainId,
  size = 24,
}: {
  asset: Pick<WalletAsset, "mint" | "symbol" | "icon">;
  network: string;
  chainId?: string;
  size?: number;
}) {
  const brand = assetBrand(asset.mint, network, chainId);
  return (
    <TokenIcon
      src={asset.icon}
      symbol={brand ?? (asset.symbol || "??")}
      size={size}
      branded={!!brand}
    />
  );
}
