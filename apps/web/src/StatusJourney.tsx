import { useId, type ReactNode, type CSSProperties } from "react";
import { Check, CircleHelp, X } from "lucide-react";
import type { JourneyStepState, JourneyTone } from "./status-journey.ts";
import "./status-journey.css";
export type JourneyNode = {
  id: string;
  label: ReactNode;
  name: string;
  icon: ReactNode;
  detail?: ReactNode;
  state: JourneyStepState;
};
export function StatusJourney({
  headline,
  badge,
  tone,
  nodes,
  detail,
}: {
  headline: ReactNode;
  badge: string;
  tone: JourneyTone;
  nodes: JourneyNode[];
  detail?: ReactNode;
}) {
  const id = useId();
  return (
    <section className="status-journey" data-tone={tone} aria-labelledby={id}>
      <div className="journey-banner" role="status" aria-live="polite">
        {tone === "success" ? (
          <Check size={20} aria-hidden="true" />
        ) : tone === "failed" ? (
          <X size={20} aria-hidden="true" />
        ) : tone === "attention" ? (
          <CircleHelp size={20} aria-hidden="true" />
        ) : (
          <i className="journey-busy" aria-hidden="true" />
        )}
        <strong id={id}>{headline}</strong>
        <span className="journey-badge">{badge}</span>
      </div>
      <ol
        className="journey-nodes"
        style={{ "--journey-count": nodes.length } as CSSProperties}
      >
        {nodes.map((node) => (
          <li
            key={node.id}
            data-state={node.state}
            aria-label={`${node.name}: ${node.state}`}
          >
            <div className="journey-icon" aria-hidden="true">
              {node.icon}
              {node.state === "complete" && (
                <span className="journey-mark">
                  <Check size={12} />
                </span>
              )}
              {node.state === "failed" && (
                <span className="journey-mark">
                  <X size={12} />
                </span>
              )}
              {node.state === "unresolved" && (
                <span className="journey-mark">
                  <CircleHelp size={12} />
                </span>
              )}
            </div>
            <strong className="journey-node-label">{node.label}</strong>
            {node.detail && (
              <span className="journey-node-detail">{node.detail}</span>
            )}
          </li>
        ))}
      </ol>
      {detail && <p className="journey-detail">{detail}</p>}
    </section>
  );
}
