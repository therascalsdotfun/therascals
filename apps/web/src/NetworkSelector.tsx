import { ChevronDown, FlaskConical, Globe } from "lucide-react";
import type { AppNetwork } from "../../../packages/shared/src/app-network.ts";
import "./intents.css";
export function NetworkSelector({
  value,
  disabled,
  onChange,
}: {
  value: AppNetwork;
  disabled: boolean;
  onChange: (network: AppNetwork) => void;
}) {
  return (
    <label
      className="app-network"
      title={
        disabled
          ? "Finish the current draw or testnet operation before changing networks."
          : "Testnet: faucet trades. Mainnet: live NEAR Intents quotes only. This does not switch your wallet network."
      }
    >
      {value === "testnet" ? <FlaskConical size={15} /> : <Globe size={15} />}
      <select
        aria-label="Network"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as AppNetwork)}
      >
        <option value="testnet">Testnet</option>
        <option value="mainnet">Mainnet</option>
      </select>
      <ChevronDown size={12} />
    </label>
  );
}
