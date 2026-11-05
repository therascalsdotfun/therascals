import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { WalletProvider } from "./wallets/Wallets.tsx";
import { RewardsProvider } from "./rewards/Rewards.tsx";
createRoot(document.getElementById("root")!).render(
  <WalletProvider>
    <RewardsProvider>
      <App />
    </RewardsProvider>
  </WalletProvider>,
);
