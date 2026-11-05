import type { ReactNode } from "react";
import { ArrowRightLeft } from "lucide-react";
import { StatusJourney } from "./StatusJourney.tsx";
import { reportedJourney } from "./status-journey.ts";
import { WalletLogo } from "./Icons.tsx";
export function ReportedSwapJourney({
  input,
  output,
  inputIcon,
  outputIcon,
  submitted,
  busy,
  error,
  detail,
}: {
  input: string;
  output: string;
  inputIcon: ReactNode;
  outputIcon: ReactNode;
  submitted: boolean;
  busy: boolean;
  error: boolean;
  detail?: string;
}) {
  const view = reportedJourney(submitted, busy, error);
  return (
    <StatusJourney
      {...view}
      detail={detail}
      nodes={[
        {
          id: "input",
          name: input,
          label: input,
          icon: inputIcon,
          state: view.states[0],
          detail: "Input",
        },
        {
          id: "wallet",
          name: "Phantom",
          label: "Phantom",
          icon: <WalletLogo kind="phantom" size={30} />,
          state: view.states[1],
          detail: submitted ? "Signed" : "Approval",
        },
        {
          id: "route",
          name: "Jupiter",
          label: "Jupiter",
          icon: <ArrowRightLeft size={26} />,
          state: view.states[2],
          detail: submitted ? "Reported" : "Swap route",
        },
        {
          id: "output",
          name: output,
          label: output,
          icon: outputIcon,
          state: view.states[3],
          detail: submitted ? "Verify receipt" : "Receive",
        },
      ]}
    />
  );
}
