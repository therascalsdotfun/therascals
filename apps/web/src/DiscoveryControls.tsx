import { Minus, Plus, RotateCcw, Info } from "lucide-react";
import type { FilterSpec } from "../../../packages/shared/src/market.ts";
import {
  discoveryPreset,
  presetFor,
} from "../../../packages/shared/src/discovery-presets.ts";
import {
  MEME_TYPES,
  type MemeType,
} from "../../../packages/shared/src/meme-types.ts";
import {
  desiredPoolSize,
  MAX_DRAW_COINS,
} from "../../../packages/shared/src/pool-controls.ts";
export function MemeTypePicker({
  value = [],
  onChange,
  disabled = false,
}: {
  value?: MemeType[];
  onChange: (v: MemeType[]) => void;
  disabled?: boolean;
}) {
  return (
    <div className="meme-picker">
      <div className="meme-type-options" role="group" aria-label="Meme types">
        <button
          type="button"
          aria-pressed={!value.length}
          disabled={disabled}
          onClick={() => onChange([])}
        >
          All types
        </button>
        {MEME_TYPES.map((c) => (
          <button
            type="button"
            key={c.id}
            aria-pressed={value.includes(c.id)}
            disabled={disabled}
            onClick={() =>
              onChange(
                value.includes(c.id)
                  ? value.filter((v) => v !== c.id)
                  : [...value, c.id],
              )
            }
          >
            {c.label}
          </button>
        ))}
      </div>
      <p className="disclosure">
        Matches any selected type. Inferred from names and tickers; unverified.
        No match stays uncategorized.
      </p>
    </div>
  );
}
export function DiscoveryControls({
  filters,
  disabled,
  onApply,
  onAdjust,
  adjustDisabled = disabled,
  ready = 0,
  pending = false,
}: {
  filters: FilterSpec;
  disabled: boolean;
  onApply: (f: FilterSpec, preset: string) => void;
  onAdjust: (direction: 1 | -1) => void;
  adjustDisabled?: boolean;
  ready?: number;
  pending?: boolean;
}) {
  const active = presetFor(filters);
  return (
    <div className="discovery-controls">
      <div
        className="discovery-presets"
        role="group"
        aria-label="Adjust coin pool"
      >
        <button
          type="button"
          disabled={adjustDisabled || desiredPoolSize(filters) <= 2}
          aria-label="Fewer coins"
          title="One fewer coin · tighter filters"
          onClick={() => onAdjust(-1)}
        >
          <Minus size={14} /> Fewer
        </button>
        <button
          type="button"
          disabled={disabled}
          title="Reset to balanced filters and 8 coins"
          onClick={() =>
            onApply(
              {
                ...discoveryPreset("strict", filters.memeTypes),
                chains: filters.chains,
                tokenSelection: filters.tokenSelection,
              },
              "strict",
            )
          }
        >
          <RotateCcw size={12} /> Reset
        </button>
        <button
          type="button"
          disabled={
            adjustDisabled || desiredPoolSize(filters) >= MAX_DRAW_COINS
          }
          aria-label="More coins"
          title="One more coin · looser filters"
          onClick={() => onAdjust(1)}
        >
          More <Plus size={14} />
        </button>
      </div>
      <div className="pool-meter" aria-live="polite">
        <span>
          Target <b>{desiredPoolSize(filters)}</b>
        </span>
        <span className="pool-ready">
          <i /> {ready} ready {pending ? <i className="spinner" /> : null}
        </span>
        <span
          className="pool-help"
          title="Requested target: 2–32. Each click adjusts by one. Only matching coins with fresh two-way quotes are ready."
        >
          <Info size={13} />
        </span>
      </div>
      <p className="pool-adjust-note">
        More loosens your filters; Fewer tightens them. Risk checks stay on.
      </p>
      <details className="narrative-disclosure">
        <summary>
          Meme types{" "}
          <span>
            {filters.memeTypes?.length
              ? filters.memeTypes
                  .map((id) => MEME_TYPES.find((c) => c.id === id)?.label)
                  .join(", ")
              : "All types"}{" "}
            <b>⌄</b>
          </span>
        </summary>
        <MemeTypePicker
          value={filters.memeTypes}
          disabled={disabled}
          onChange={(memeTypes) => onApply({ ...filters, memeTypes }, active)}
        />
      </details>
    </div>
  );
}
