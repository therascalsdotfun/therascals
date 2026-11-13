import { useRef, useState } from "react";
import { Plus, X, Search, Check } from "lucide-react";
import { PerpsTicker } from "../TokenMedia.tsx";
import { LoadingSkeleton } from "../LoadingSkeleton.tsx";
import type { PerpsGame } from "./PerpsGame.tsx";

export function PerpsTokenPool({ game }: { game: PerpsGame }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const disabled =
    game.busy ||
    ["spinning", "opening", "open"].includes(game.phase) ||
    (!!game.operation &&
      ["opening", "open", "closing"].includes(game.operation.phase));
  const markets = game.catalog?.markets ?? [];
  const frozen =
    game.spin &&
    ["spinning", "opening", "open", "revealed"].includes(game.phase)
      ? game.spin.markets
      : game.selectedMarkets;
  const visible = markets.filter((m) =>
    `${m.name} ${m.display}`
      .toLowerCase()
      .includes(search.toLowerCase().replace(/^\$/, "")),
  );
  function open() {
    setDraft(game.selectedMarkets.map((m) => m.name));
    setSearch("");
    dialog.current?.showModal();
  }
  return (
    <section className="perps-token-pool" aria-label="Perp token pool">
      <div className="perps-pool-heading">
        <h3>
          Your token pile <span>{frozen.length}</span>
        </h3>
        <button
          type="button"
          className="perps-add-tokens"
          onClick={open}
          disabled={disabled || !game.catalog}
        >
          <Plus size={15} />
          Add tokens
        </button>
      </div>
      {!game.catalog ? (
        !game.testnetRoute && game.mainnetEnabled === false ? (
          <p className="perps-note" style={{ margin: "0.4rem 0 0" }}>
            Mainnet Perps arcade pool is not enabled on this server.
          </p>
        ) : (
          <LoadingSkeleton kind="summary" />
        )
      ) : (
        <div className="perps-pool-chips">
          {frozen.map((m) => (
            <span key={m.name}>
              <PerpsTicker symbol={m.display} size={20} />
              <button
                type="button"
                aria-label={`Remove $${m.display} from Perp pool`}
                disabled={disabled}
                onClick={() =>
                  game.changePool(
                    game.selectedMarkets
                      .filter((p) => p.name !== m.name)
                      .map((p) => p.name),
                  )
                }
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <p
        className={
          frozen.length < 2 && game.catalog
            ? "perps-pool-warning"
            : "perps-pool-note"
        }
      >
        {frozen.length < 2 && game.catalog
          ? "Add at least 2 tokens to spin."
          : disabled
            ? "Pool frozen for this round."
            : "Core + meme perps. Your picks. Equal token odds."}
      </p>
      <dialog
        ref={dialog}
        className="perps-pool-dialog"
        aria-labelledby="perps-pool-title"
      >
        <button
          className="dialog-close"
          type="button"
          aria-label="Close token picker"
          onClick={() => dialog.current?.close()}
        >
          <X size={18} />
        </button>
        <h2 id="perps-pool-title">Pick your troublemakers.</h2>
        <p>
          Listed Hyperliquid perpetuals only. Pick 2–32; leverage limits apply
          to each market.
        </p>
        <label className="perps-pool-search">
          <Search size={17} />
          <input
            type="search"
            aria-label="Search Perp tokens"
            placeholder="Find a ticker…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="perps-pool-tools">
          <span>{draft.length} selected</span>
          <button
            type="button"
            onClick={() => setDraft(markets.slice(0, 32).map((m) => m.name))}
          >
            Select all
          </button>
          <button type="button" onClick={() => setDraft([])}>
            Clear
          </button>
        </div>
        <div className="perps-pool-options">
          {visible.map((m) => (
            <label key={m.name}>
              <input
                type="checkbox"
                aria-label={`Include $${m.display}`}
                checked={draft.includes(m.name)}
                disabled={!draft.includes(m.name) && draft.length >= 32}
                onChange={(e) =>
                  setDraft((old) =>
                    e.target.checked
                      ? [...old, m.name]
                      : old.filter((n) => n !== m.name),
                  )
                }
              />
              <PerpsTicker symbol={m.display} size={29} />
              <small>
                {m.universe === "meme" ? "Meme perp" : "Core perp"} · up to{" "}
                {m.maxLeverage}x
              </small>
            </label>
          ))}
          {!visible.length && <p>No listed ticker matches that search.</p>}
        </div>
        <div className="perps-pool-apply">
          <button
            type="button"
            className="secondary"
            onClick={() => dialog.current?.close()}
          >
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={draft.length < 2 || draft.length > 32 || disabled}
            onClick={() => {
              game.changePool(draft);
              dialog.current?.close();
            }}
          >
            <Check size={16} />
            Use {draft.length} tokens
          </button>
        </div>
      </dialog>
    </section>
  );
}
