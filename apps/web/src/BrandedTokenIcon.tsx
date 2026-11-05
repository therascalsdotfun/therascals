import {
  TokenBTC,
  TokenETH,
  TokenSOL,
  TokenBNB,
  TokenXRP,
  TokenAVAX,
  TokenLINK,
  TokenLTC,
  TokenSUI,
  TokenAPT,
  TokenARB,
  TokenOP,
  TokenDOGE,
  TokenPEPE,
  TokenPOPCAT,
  TokenMEME,
  TokenUSDC,
  TokenUSDT,
  TokenNEAR,
} from "@web3icons/react";
import { tokenIconSymbol } from "../../../packages/shared/src/token-ticker.ts";
const icons: Record<string, typeof TokenBTC> = {
  BTC: TokenBTC,
  ETH: TokenETH,
  SOL: TokenSOL,
  BNB: TokenBNB,
  XRP: TokenXRP,
  AVAX: TokenAVAX,
  LINK: TokenLINK,
  LTC: TokenLTC,
  SUI: TokenSUI,
  APT: TokenAPT,
  ARB: TokenARB,
  OP: TokenOP,
  DOGE: TokenDOGE,
  PEPE: TokenPEPE,
  POPCAT: TokenPOPCAT,
  MEME: TokenMEME,
  USDC: TokenUSDC,
  USDT: TokenUSDT,
  NEAR: TokenNEAR,
};
export function BrandedTokenIcon({
  symbol,
  size,
}: {
  symbol: string;
  size: number;
}) {
  const Icon = icons[tokenIconSymbol(symbol)];
  return Icon ? (
    <Icon size={size} variant="branded" aria-hidden="true" />
  ) : null;
}
export function hasBrandedTokenIcon(symbol: string) {
  return !!icons[tokenIconSymbol(symbol)];
}
