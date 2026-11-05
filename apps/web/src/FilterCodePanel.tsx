import { useEffect, useId, useState } from "react";
import { Copy, Download } from "lucide-react";
import type { FilterSpec } from "../../../packages/shared/src/market.ts";
import {
  decodeFilterCode,
  encodeFilterCode,
  FILTER_CODE_LIMIT,
} from "../../../packages/shared/src/filter-code.ts";

export function FilterCodePanel({
  value,
  onChange,
}: {
  value: FilterSpec;
  onChange: (next: FilterSpec) => void;
}) {
  const id = useId();
  const [incoming, setIncoming] = useState(""),
    [outgoing, setOutgoing] = useState(""),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    setOutgoing("");
  }, [value]);
  async function copy() {
    setError("");
    setMessage("");
    let code: string;
    try {
      code = encodeFilterCode(value);
      setOutgoing(code);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
      setMessage("Code copied. Pass your setup around.");
    } catch {
      setMessage("Code ready below. Select it and copy to share.");
    }
  }
  function load() {
    setError("");
    setMessage("");
    try {
      const next = decodeFilterCode(incoming);
      onChange(next);
      setOutgoing("");
      setMessage("Code loaded. Review the settings, then Apply filters.");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="filter-code-panel" aria-labelledby={`${id}-title`}>
      <div className="filter-code-heading">
        <div>
          <h3 id={`${id}-title`}>Degen Codes</h3>
          <p>Pass your setup around.</p>
        </div>
        <button type="button" className="secondary" onClick={() => void copy()}>
          <Copy size={15} /> Copy my code
        </button>
      </div>
      <p className="disclosure">
        Shares your filters, chains and token picks. Live pools can change.
        Loading a code never places a trade.
      </p>
      {outgoing && (
        <div>
          <label htmlFor={`${id}-out`}>Your share code</label>
          <textarea
            id={`${id}-out`}
            readOnly
            value={outgoing}
            rows={2}
            onFocus={(e) => e.target.select()}
          />
        </div>
      )}
      <label htmlFor={`${id}-in`}>Got a community code?</label>
      <textarea
        id={`${id}-in`}
        rows={2}
        maxLength={FILTER_CODE_LIMIT}
        value={incoming}
        placeholder="Paste DEGEN1.…"
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        onChange={(e) => {
          setIncoming(e.target.value);
          setError("");
          setMessage("");
        }}
      />
      <button
        type="button"
        className="secondary"
        disabled={!incoming.trim()}
        onClick={load}
      >
        <Download size={15} /> Load code
      </button>
      {message && (
        <p className="filter-code-status" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="filter-code-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
