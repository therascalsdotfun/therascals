import type { IntentsAsset } from "../../../packages/shared/src/intents.ts";
import { AssetIcon, AssetLabel } from "./portfolio/AssetIcon.tsx";
/** Catalog identities supply the chain and contract; names never choose branding. */
export function IntentsAssetLabel({
  asset,
  size = 18,
  iconOnly = false,
}: {
  asset: IntentsAsset;
  size?: number;
  iconOnly?: boolean;
}) {
  const near = asset.blockchain === "near";
  const native =
    (near && asset.assetId === "nep141:wrap.near") ||
    (asset.blockchain === "sol" && asset.assetId === "nep141:sol.omft.near");
  const Component = iconOnly ? AssetIcon : AssetLabel;
  return (
    <Component
      asset={{
        mint: native ? "native" : (asset.contractAddress ?? asset.assetId),
        symbol: asset.symbol,
        icon: asset.icon,
      }}
      network={
        near
          ? "NEAR mainnet"
          : asset.blockchain === "sol"
            ? "Solana mainnet"
            : "EVM mainnet"
      }
      chainId={
        asset.blockchain === "bsc"
          ? "0x38"
          : asset.blockchain === "base"
            ? "0x2105"
            : undefined
      }
      size={size}
    />
  );
}
