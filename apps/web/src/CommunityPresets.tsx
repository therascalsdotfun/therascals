import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Download,
  Globe,
  RefreshCw,
  Search,
  Share2,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import type { FilterSpec } from "../../../packages/shared/src/market.ts";
import type { CommunityPreset } from "../../../packages/shared/src/community-presets.ts";
import {
  decodeFilterCode,
  encodeFilterCode,
} from "../../../packages/shared/src/filter-code.ts";

function shortAddress(addr: string) {
  if (!addr || addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function CommunityPresets({
  currentFilters,
  activePresetId,
  onApplyPreset,
  userAddress,
  disabled,
}: {
  currentFilters: FilterSpec;
  activePresetId: string | null;
  onApplyPreset: (presetId: string, filters: FilterSpec, title: string) => void;
  userAddress?: string | null;
  disabled?: boolean;
}) {
  const [tab, setTab] = useState<"community" | "mine" | "publish">("community");
  const [presets, setPresets] = useState<CommunityPreset[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  // Search & sort state
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"recent" | "popular" | "trades">("popular");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedRules, setExpandedRules] = useState<FilterSpec | null>(null);

  // Publish form state
  const [publishTitle, setPublishTitle] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [publishSuccess, setPublishSuccess] = useState("");

  async function loadPresets(mine = false) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (mine) params.set("mine", "true");
      if (sort !== "recent") params.set("sort", sort);
      if (search.trim()) params.set("q", search.trim());
      params.set("limit", "50");

      const url = `/api/presets?${params.toString()}`;
      const r = await fetch(url);
      const data = await r.json().catch(() => null);
      if (!r.ok) {
        throw new Error(data?.error || "Could not load presets.");
      }
      setPresets(Array.isArray(data.presets) ? data.presets : []);
      setTotalCount(typeof data.total === "number" ? data.total : data.presets?.length ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load presets.");
      setPresets([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      if (tab === "community") {
        void loadPresets(false);
      } else if (tab === "mine") {
        void loadPresets(true);
      }
    }, search ? 200 : 0);
    return () => clearTimeout(timer);
  }, [tab, sort, search, userAddress]);

  async function handlePublish(e: React.FormEvent) {
    e.preventDefault();
    if (!publishTitle.trim()) {
      setError("Please enter a title for your preset.");
      return;
    }
    setPublishing(true);
    setError("");
    setPublishSuccess("");
    try {
      const code = encodeFilterCode(currentFilters);
      const requestId = crypto.randomUUID();
      const r = await fetch("/api/presets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestId,
          title: publishTitle.trim(),
          code,
        }),
      });
      const data = await r.json().catch(() => null);
      if (!r.ok) {
        throw new Error(data?.error || "Failed to publish preset.");
      }
      setPublishSuccess(`>> Published "${data.title || publishTitle.trim()}". Available in community presets.`);
      setPublishTitle("");
      void loadPresets(tab === "mine");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Publish failed.");
    } finally {
      setPublishing(false);
    }
  }

  async function handleUnpublish(preset: CommunityPreset) {
    if (!confirm(`Unpublish "${preset.title}"? It will no longer appear in community presets.`)) {
      return;
    }
    setError("");
    try {
      const r = await fetch(`/api/presets/${preset.id}/unpublish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await r.json().catch(() => null);
      if (!r.ok) {
        throw new Error(data?.error || "Failed to unpublish preset.");
      }
      setStatus(`>> Preset "${preset.title}" unpublished.`);
      void loadPresets(tab === "mine");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unpublish failed.");
    }
  }

  function handleSelect(p: CommunityPreset) {
    setError("");
    setStatus("");
    try {
      const decoded = decodeFilterCode(p.code);
      onApplyPreset(p.id, decoded, p.title);
      setStatus(`>> Loaded preset "${p.title}". Click "Apply filters" below to update the cage pool.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cannot decode preset code.");
    }
  }

  function toggleExpand(p: CommunityPreset) {
    if (expandedId === p.id) {
      setExpandedId(null);
      setExpandedRules(null);
    } else {
      try {
        setExpandedRules(decodeFilterCode(p.code));
        setExpandedId(p.id);
      } catch {
        setExpandedRules(null);
        setExpandedId(null);
      }
    }
  }

  async function handleShare(p: CommunityPreset) {
    const url = `${window.location.origin}${window.location.pathname}?preset=${p.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setStatus(`>> Share link for "${p.title}" copied to clipboard.`);
    } catch {
      setStatus(`>> Share URL: ${url}`);
    }
  }

  return (
    <div className="community-presets-container">
      <div className="community-presets-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "community"}
          className={`tab-btn ${tab === "community" ? "active" : ""}`}
          onClick={() => {
            setTab("community");
            setError("");
            setStatus("");
          }}
        >
          <Globe size={14} /> Community Presets
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "mine"}
          className={`tab-btn ${tab === "mine" ? "active" : ""}`}
          onClick={() => {
            setTab("mine");
            setError("");
            setStatus("");
          }}
        >
          <Users size={14} /> My Presets
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "publish"}
          className={`tab-btn ${tab === "publish" ? "active" : ""}`}
          onClick={() => {
            setTab("publish");
            setError("");
            setStatus("");
          }}
        >
          <Upload size={14} /> Publish My Setup
        </button>
      </div>

      {status && (
        <p className="presets-status-banner" role="status">
          {status}
        </p>
      )}

      {error && (
        <p className="presets-error-banner" role="alert">
          {error}
        </p>
      )}

      {tab === "publish" ? (
        <form className="publish-preset-card" onSubmit={handlePublish}>
          <div className="publish-header">
            <h4>Publish Current Setup</h4>
            <p className="disclosure">
              Saves your current filters, chains and token picks under your verified wallet.
              Anyone in the arcade can discover and roll with your setup.
            </p>
          </div>

          <div className="publish-input-group">
            <label htmlFor="publish-preset-title">Preset Name</label>
            <input
              id="publish-preset-title"
              type="text"
              maxLength={60}
              placeholder="e.g. Low Cap Solana Runners"
              value={publishTitle}
              disabled={disabled || publishing}
              onChange={(e) => setPublishTitle(e.target.value)}
              required
            />
            <span className="char-count">{publishTitle.length}/60</span>
          </div>

          <div className="publish-summary">
            <span className="summary-title">Summary of shared rules:</span>
            <ul className="summary-rules">
              <li>- Cage size: {currentFilters.poolSize ?? 8} coins</li>
              <li>- Chains: {currentFilters.chains?.join(", ") || "solana"}</li>
              <li>- Min liquidity: {currentFilters.minLiquidity ? `$${currentFilters.minLiquidity.toLocaleString()}` : "Any"}</li>
              <li>- Max market cap: {currentFilters.maxMarketCap ? `$${currentFilters.maxMarketCap.toLocaleString()}` : "Any"}</li>
              <li>- Socials: {[currentFilters.hasX && "X", currentFilters.hasTelegram && "Telegram", currentFilters.hasWebsite && "Website"].filter(Boolean).join(", ") || "None required"}</li>
            </ul>
          </div>

          <p className="disclosure note">
            Usage tracking is recorded for attribution. Rewards policy is currently unreleased.
          </p>

          <button
            type="submit"
            className="primary publish-submit-btn"
            disabled={disabled || publishing || !publishTitle.trim()}
          >
            {publishing ? "Publishing…" : "Publish to Community"}
          </button>

          {publishSuccess && (
            <p className="presets-success-banner" role="status">
              {publishSuccess}
            </p>
          )}
        </form>
      ) : (
        <div className="presets-list-view">
          <div className="presets-filter-bar">
            <div className="search-box-wrap">
              <Search size={14} className="search-icon" />
              <input
                type="text"
                placeholder="Search by title or wallet address…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="presets-search-input"
                aria-label="Search presets"
              />
              {search && (
                <button
                  type="button"
                  className="search-clear-btn"
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                >
                  ×
                </button>
              )}
            </div>

            <div className="sort-selector-wrap">
              <label htmlFor="preset-sort-select">Sort:</label>
              <select
                id="preset-sort-select"
                value={sort}
                onChange={(e) => setSort(e.target.value as any)}
                className="preset-sort-select"
              >
                <option value="popular">Most Popular</option>
                <option value="trades">Most Traded</option>
                <option value="recent">Newest</option>
              </select>
            </div>
          </div>

          <div className="presets-list-actions">
            <span className="presets-count-label">
              {loading ? "Searching presets…" : `${totalCount} preset${totalCount === 1 ? "" : "s"}`}
            </span>
            <button
              type="button"
              className="refresh-btn secondary"
              disabled={loading}
              onClick={() => void loadPresets(tab === "mine")}
              aria-label="Refresh presets list"
            >
              <RefreshCw size={13} className={loading ? "spin" : ""} /> Refresh
            </button>
          </div>

          {loading && presets.length === 0 && (
            <div className="presets-loading-placeholder">
              <p>Fetching community presets from server…</p>
            </div>
          )}

          {!loading && presets.length === 0 && (
            <div className="presets-empty-state">
              <p>
                {search
                  ? `No presets found matching "${search}".`
                  : tab === "mine"
                    ? userAddress
                      ? "You haven't published any presets yet. Use the 'Publish My Setup' tab to share your first."
                      : "Connect and verify your wallet to view your published presets."
                    : "No community presets published yet. Be the first to share your filter setup!"}
              </p>
            </div>
          )}

          <div className="presets-grid">
            {presets.map((p) => {
              const isActive = activePresetId === p.id;
              const isExpanded = expandedId === p.id;
              const isCreator = userAddress && p.creator?.address?.toLowerCase() === userAddress.toLowerCase();

              return (
                <div
                  key={p.id}
                  className={`preset-card ${isActive ? "preset-card-active" : ""}`}
                >
                  <div className="preset-card-header">
                    <div className="preset-title-wrap">
                      <h4 className="preset-title">{p.title}</h4>
                      {isActive && <span className="preset-active-tag">Active</span>}
                    </div>
                    <span className="preset-author">
                      by {shortAddress(p.creator?.address)} ({p.creator?.kind || "wallet"})
                    </span>
                  </div>

                  <div className="preset-metrics">
                    <span className="metric-pill" title="Distinct adopting wallets">
                      - {p.usage?.adoptingWallets ?? 0} adopters
                    </span>
                    <span className="metric-pill" title="Completed rolls revealed">
                      - {p.usage?.completedReveals ?? 0} reveals
                    </span>
                    <span className="metric-pill" title="Daily qualified uses">
                      - {p.usage?.qualifiedUses ?? 0} qualified
                    </span>
                    {(p.usage?.executedTrades ?? 0) > 0 && (
                      <span className="metric-pill trade-metric" title="Verified trades executed">
                        - {p.usage.executedTrades} trades
                      </span>
                    )}
                  </div>

                  {isExpanded && expandedRules && (
                    <div className="preset-rules-drawer">
                      <span className="drawer-title">Rule Details:</span>
                      <ul className="drawer-list">
                        <li>Pool: {expandedRules.poolSize ?? 8} coins ({expandedRules.chains?.join(", ") || "solana"})</li>
                        {expandedRules.minLiquidity ? <li>Min Liq: ${expandedRules.minLiquidity.toLocaleString()}</li> : null}
                        {expandedRules.maxMarketCap ? <li>Max MCap: ${expandedRules.maxMarketCap.toLocaleString()}</li> : null}
                        {expandedRules.minAgeMinutes ? <li>Min Age: {expandedRules.minAgeMinutes}m</li> : null}
                        {expandedRules.hasX ? <li>Requires X link</li> : null}
                        {expandedRules.hasTelegram ? <li>Requires Telegram link</li> : null}
                        {expandedRules.hasWebsite ? <li>Requires Website</li> : null}
                      </ul>
                    </div>
                  )}

                  <div className="preset-card-actions">
                    <button
                      type="button"
                      className={`secondary load-preset-btn ${isActive ? "btn-active" : ""}`}
                      disabled={disabled}
                      onClick={() => handleSelect(p)}
                    >
                      <Download size={13} /> {isActive ? "Reload" : "Load preset"}
                    </button>
                    <button
                      type="button"
                      className="details-toggle-btn secondary"
                      title={isExpanded ? "Hide rules" : "View rules"}
                      onClick={() => toggleExpand(p)}
                    >
                      {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </button>
                    <button
                      type="button"
                      className="share-preset-btn secondary"
                      title="Copy share link"
                      onClick={() => void handleShare(p)}
                    >
                      <Share2 size={13} />
                    </button>
                    {(tab === "mine" || isCreator) && (
                      <button
                        type="button"
                        className="unpublish-btn"
                        title="Unpublish preset"
                        onClick={() => void handleUnpublish(p)}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
