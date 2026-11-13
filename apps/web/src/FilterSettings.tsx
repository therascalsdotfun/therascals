import { useId, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { FilterSpec } from "../../../packages/shared/src/market.ts";
import {
  DISCOVERY_PRESETS,
  discoveryPreset,
  presetFor,
} from "../../../packages/shared/src/discovery-presets.ts";
import { filterInput } from "./filter-input.ts";
import {
  filterMilestones,
  milestonePosition,
  milestoneValue,
  milestoneLabel,
  MAX_AGE_THREE_MONTHS,
  MAX_AGE_ANY_STOP,
} from "./filter-milestones.ts";
import "./filter-settings.css";
import { FilterCodePanel } from "./FilterCodePanel.tsx";
import { CommunityPresets } from "./CommunityPresets.tsx";

const criteria = [
  {
    key: "minPoolSize",
    label: "Minimum coins in the cage",
    min: 2,
    max: 32,
    unit: "coins",
  },
  {
    key: "maxPoolSize",
    label: "Maximum coins in the cage",
    min: 2,
    max: 32,
    unit: "coins",
  },
  {
    key: "minAgeMinutes",
    label: "Minimum age",
    min: 0,
    max: MAX_AGE_THREE_MONTHS,
    unit: "min",
  },
  {
    key: "maxAgeMinutes",
    label: "Maximum age",
    min: 0,
    max: MAX_AGE_THREE_MONTHS,
    unit: "min",
    optional: true,
  },
  {
    key: "minMarketCap",
    label: "Minimum market cap",
    min: 0,
    max: 99999999,
    unit: "USD",
    log: true,
    optional: true,
  },
  {
    key: "maxMarketCap",
    label: "Maximum market cap",
    min: 0,
    max: 99999999,
    unit: "USD",
    log: true,
    optional: true,
  },
  {
    key: "minLiquidity",
    label: "Minimum liquidity",
    min: 0,
    max: 1000000000000,
    unit: "USD",
    log: true,
    optional: true,
  },
  {
    key: "minVolume5m",
    label: "Minimum 5m volume",
    min: 0,
    max: 1000000000000,
    unit: "USD",
    log: true,
    optional: true,
  },
  {
    key: "minBuys5m",
    label: "Minimum 5m buys",
    min: 0,
    max: 1000000000000,
    unit: "buys",
    log: true,
  },
  {
    key: "minSells5m",
    label: "Minimum 5m sells",
    min: 0,
    max: 1000000000000,
    unit: "sells",
    log: true,
  },
  {
    key: "minHolders",
    label: "Minimum holders",
    min: 0,
    max: 1000000000000,
    unit: "holders",
    log: true,
  },
  {
    key: "maxLiquidity",
    label: "Maximum liquidity",
    min: 0,
    max: 1e12,
    unit: "USD",
    log: true,
    optional: true,
  },
  {
    key: "maxVolume5m",
    label: "Maximum 5m volume",
    min: 0,
    max: 1e12,
    unit: "USD",
    log: true,
    optional: true,
  },
  {
    key: "maxBuys5m",
    label: "Maximum 5m buys",
    min: 0,
    max: 1e12,
    unit: "buys",
    log: true,
    optional: true,
  },
  {
    key: "maxSells5m",
    label: "Maximum 5m sells",
    min: 0,
    max: 1e12,
    unit: "sells",
    log: true,
    optional: true,
  },
  {
    key: "maxHolders",
    label: "Maximum holders",
    min: 0,
    max: 1e12,
    unit: "holders",
    log: true,
    optional: true,
  },
  {
    key: "minBuyShare5m",
    label: "Minimum 5m buy share",
    min: 0,
    max: 100,
    unit: "%",
    optional: true,
  },
  {
    key: "maxBuyShare5m",
    label: "Maximum 5m buy share",
    min: 0,
    max: 100,
    unit: "%",
    optional: true,
  },
] as const;

export function FilterSettings({
  value,
  onChange,
  children,
  activePresetId = null,
  activePresetTitle = null,
  onPresetSelect,
  userAddress,
  disabled,
}: {
  value: FilterSpec;
  onChange: (next: FilterSpec) => void;
  children?: ReactNode;
  activePresetId?: string | null;
  activePresetTitle?: string | null;
  onPresetSelect?: (presetId: string | null, title?: string) => void;
  userAddress?: string | null;
  disabled?: boolean;
}) {
  const prefix = useId(),
    preset = presetFor(value);
  const presetIndex = DISCOVERY_PRESETS.findIndex((p) => p.id === preset);
  function choosePreset(index: number) {
    const p =
      DISCOVERY_PRESETS[
        (index + DISCOVERY_PRESETS.length) % DISCOVERY_PRESETS.length
      ];
    onChange({
      ...discoveryPreset(p.id, value.memeTypes),
      chains: value.chains,
      tokenSelection: value.tokenSelection,
    });
  }
  const presetName =
    preset === "broad"
      ? "Loose"
      : preset === "tight"
        ? "Tight"
        : preset === "strict"
          ? "Balanced"
          : "Custom";
  return (
    <div className="filter-settings">
      <CommunityPresets
        currentFilters={value}
        activePresetId={activePresetId}
        onApplyPreset={(id, next, title) => {
          onChange(next);
          onPresetSelect?.(id, title);
        }}
        userAddress={userAddress}
        disabled={disabled}
      />
      {activePresetId && activePresetTitle && (
        <div className="presets-status-banner">
          <span>&gt;&gt; Active Preset: <strong>{activePresetTitle}</strong> (attribution ready on Apply)</span>
        </div>
      )}
      <FilterCodePanel
        value={value}
        onChange={(next) => {
          onPresetSelect?.(null);
          onChange(next);
        }}
      />
      <div className="settings-preset">
        <div>
          <span className="settings-eyebrow">YOUR PLAY STYLE</span>
          <label htmlFor={`${prefix}-preset`}>Preset</label>
        </div>
        <div className="settings-preset-control">
          <button
            type="button"
            aria-label="Previous filter preset"
            onClick={() =>
              choosePreset((presetIndex < 0 ? 1 : presetIndex) - 1)
            }
          >
            <ChevronLeft size={20} />
          </button>
          <select
            id={`${prefix}-preset`}
            aria-label="Filter preset"
            value={preset}
            onChange={(e) =>
              choosePreset(
                DISCOVERY_PRESETS.findIndex((p) => p.id === e.target.value),
              )
            }
          >
            <option value="broad">Loose</option>
            <option value="strict">Balanced</option>
            <option value="tight">Tight</option>
            <option value="custom" disabled>
              Custom
            </option>
          </select>
          <button
            type="button"
            aria-label="Next filter preset"
            onClick={() =>
              choosePreset((presetIndex < 0 ? 1 : presetIndex) + 1)
            }
          >
            <ChevronRight size={20} />
          </button>
        </div>
        <div className="settings-preset-track" aria-hidden="true">
          {DISCOVERY_PRESETS.map((p) => (
            <i key={p.id} className={preset === p.id ? "active" : ""} />
          ))}
        </div>
      </div>
      <p className="settings-caption" aria-live="polite">
        {presetName === "Custom"
          ? "Your own mix. Apply when you’re ready."
          : `${presetName} preset · tweak any setting to make it yours.`}
      </p>
      <p className="settings-caption">
        Buy share is buys ÷ (buys + sells), using transaction counts, not traded
        dollars. It requires a complete reported 5m window. Limits needing
        unavailable data exclude the token; holder coverage varies by chain.
      </p>
      <div className="settings-rows">
        {criteria.map((c) => {
          const id = `${prefix}-${c.key}`,
            optional = "optional" in c && c.optional;
          const lowerKey = c.key.replace(/^max/, "min") as keyof FilterSpec;
          const upperKey = c.key.replace(/^min/, "max") as keyof FilterSpec;
          const min = c.key.startsWith("max")
            ? Number(
                c.key === "maxPoolSize"
                  ? (value.minPoolSize ?? c.min)
                  : (value[lowerKey] ?? c.min),
              )
            : c.min;
          const max = c.key.startsWith("min")
            ? Number(
                c.key === "minPoolSize"
                  ? (value.maxPoolSize ?? value.poolSize ?? c.max)
                  : (value[upperKey] ?? c.max),
              )
            : c.max;
          const sliderMax =
            c.key === "maxAgeMinutes" ? MAX_AGE_ANY_STOP : max;
          const current =
            c.key === "maxAgeMinutes" && value.maxAgeMinutes === null
              ? MAX_AGE_ANY_STOP
              : c.key === "minPoolSize"
                ? (value.minPoolSize ?? 2)
                : c.key === "maxPoolSize"
                  ? (value.maxPoolSize ?? value.poolSize ?? 8)
                  : (value[c.key] ??
                    (c.key.startsWith("max") ? c.max : 0));
          const stops = filterMilestones(c.key);
          const from = milestonePosition(min, stops);
          const to = milestonePosition(sliderMax, stops);
          const ticks = stops.filter((n) => n >= min && n <= sliderMax);
          const numeric =
            c.key === "minPoolSize"
              ? (value.minPoolSize ?? 2)
              : c.key === "maxPoolSize"
                ? (value.maxPoolSize ?? value.poolSize ?? 8)
                : (value[c.key] ?? null);
          const text =
            numeric === null ? "Any" : `${numeric.toLocaleString()} ${c.unit}`;
          const applyCriterionValue = (nextVal: number | null) => {
            if (c.key === "maxPoolSize" && typeof nextVal === "number") {
              onChange({
                ...value,
                maxPoolSize: nextVal,
                poolSize: nextVal,
              });
              return;
            }
            if (c.key === "minPoolSize" && typeof nextVal === "number") {
              const nextMax = Math.max(
                nextVal,
                value.maxPoolSize ?? value.poolSize ?? 8,
              );
              onChange({
                ...value,
                minPoolSize: nextVal,
                maxPoolSize: nextMax,
                poolSize: nextMax,
              });
              return;
            }
            onChange({
              ...value,
              [c.key]: nextVal,
            });
          };
          return (
            <div className="setting-row" key={c.key}>
              <label htmlFor={id}>{c.label}</label>
              <div className="setting-value">
                <input
                  id={id}
                  aria-label={`${c.label} value`}
                  type="number"
                  min={min}
                  max={max}
                  step={1}
                  required={!optional}
                  placeholder="Any"
                  value={numeric ?? ""}
                  onChange={(e) =>
                    applyCriterionValue(filterInput(c.key, e.target.value))
                  }
                />
                <span>{c.unit}</span>
              </div>
              <div className="setting-slider">
                <div className="setting-slider-scale">
                  <input
                    type="range"
                    aria-label={`${c.label} slider`}
                    aria-valuetext={text}
                    min={from}
                    max={to}
                    step="any"
                    value={milestonePosition(current, stops)}
                    onKeyDown={(e) => {
                      const direction = ["ArrowRight", "ArrowUp"].includes(
                        e.key,
                      )
                        ? 1
                        : ["ArrowLeft", "ArrowDown"].includes(e.key)
                          ? -1
                          : 0;
                      if (!direction) return;
                      e.preventDefault();
                      const step =
                        "log" in c
                          ? Math.max(1, Math.round(current * 0.05))
                          : 1;
                      applyCriterionValue(
                        Math.max(
                          min,
                          Math.min(max, current + direction * step),
                        ),
                      );
                    }}
                    onChange={(e) => {
                      const rawVal = milestoneValue(
                        Number(e.target.value),
                        stops,
                      );
                      if (
                        c.key === "maxAgeMinutes" &&
                        rawVal > MAX_AGE_THREE_MONTHS
                      ) {
                        onChange({
                          ...value,
                          maxAgeMinutes: null,
                        });
                        return;
                      }
                      applyCriterionValue(
                        Math.max(min, Math.min(max, rawVal)),
                      );
                    }}
                  />
                  <div
                    className="setting-milestones"
                    aria-label={`${c.label} milestones`}
                  >
                    {ticks.map((n, index) => {
                      const position =
                        to === from
                          ? 0
                          : (100 * (milestonePosition(n, stops) - from)) /
                            (to - from);
                      return (
                        <span
                          key={n}
                          className={`setting-milestone lane-${index % 2}`}
                          style={{ left: `${position}%` }}
                          data-edge={
                            position < 5
                              ? "start"
                              : position > 95
                                ? "end"
                                : undefined
                          }
                        >
                          <i aria-hidden="true" />
                          {milestoneLabel(c.key, n)}
                        </span>
                      );
                    })}
                  </div>
                </div>
                {optional && (
                  <button
                    type="button"
                    className="setting-clear"
                    disabled={numeric === null}
                    aria-label={`Clear ${c.label.toLowerCase()} limit`}
                    onClick={() => onChange({ ...value, [c.key]: null })}
                  >
                    Any
                  </button>
                )}
              </div>
            </div>
          );
        })}
        <div className="setting-row setting-choice">
          <label htmlFor={`${prefix}-age`}>Age measured from</label>
          <select
            id={`${prefix}-age`}
            value={value.ageBasis}
            onChange={(e) =>
              onChange({
                ...value,
                ageBasis: e.target.value as FilterSpec["ageBasis"],
              })
            }
          >
            <option value="first_pool">First liquidity pool</option>
            <option value="mint">Token creation</option>
          </select>
        </div>
        <div className="setting-row setting-choice">
          <label htmlFor={`${prefix}-x`}>Require an X link</label>
          <input
            id={`${prefix}-x`}
            type="checkbox"
            checked={value.hasX}
            onChange={(e) => onChange({ ...value, hasX: e.target.checked })}
          />
        </div>
        <div className="setting-row setting-choice">
          <label htmlFor={`${prefix}-telegram`}>Require a Telegram link</label>
          <input
            id={`${prefix}-telegram`}
            type="checkbox"
            checked={value.hasTelegram ?? false}
            onChange={(e) =>
              onChange({ ...value, hasTelegram: e.target.checked })
            }
          />
        </div>
        <div className="setting-row setting-choice">
          <label htmlFor={`${prefix}-website`}>Require a website</label>
          <input
            id={`${prefix}-website`}
            type="checkbox"
            checked={value.hasWebsite}
            onChange={(e) =>
              onChange({ ...value, hasWebsite: e.target.checked })
            }
          />
        </div>
        <div className="setting-row setting-choice">
          <label htmlFor={`${prefix}-bonding-curve`}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <img
                src="/brands/justhoot/logo.png"
                alt=""
                width={16}
                height={16}
                style={{ borderRadius: 3, verticalAlign: "middle" }}
              />
              Include bonding-curve tokens (JustHoot)
            </span>
          </label>
          <input
            id={`${prefix}-bonding-curve`}
            type="checkbox"
            checked={value.includeBondingCurve ?? false}
            onChange={(e) =>
              onChange({ ...value, includeBondingCurve: e.target.checked })
            }
          />
        </div>
      </div>
      <div className="settings-themes">
        <h3>Meme themes</h3>
        {children}
      </div>
    </div>
  );
}
