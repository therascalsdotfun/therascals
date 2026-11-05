import "./loading-skeleton.css";
export function LoadingSkeleton({
  kind = "machine",
}: {
  kind?: "machine" | "rows" | "panel" | "summary";
}) {
  return (
    <div
      className={`loading-skeleton skeleton-${kind}`}
      role="status"
      aria-label="Loading tokens"
      aria-busy="true"
    >
      <span className="sr-only">Loading tokens</span>
      {kind === "machine" ? (
        <>
          <div className="skeleton-cage" />
          <div className="skeleton-base" />
          <div className="skeleton-bar" />
        </>
      ) : kind === "rows" ? (
        Array.from({ length: 5 }, (_, i) => (
          <div className="skeleton-row" key={i}>
            <i />
            <span />
            <span />
            <span />
          </div>
        ))
      ) : kind === "summary" ? (
        <div className="skeleton-bar" />
      ) : (
        <>
          <div className="skeleton-bar" />
          <div className="skeleton-bar" />
          <div className="skeleton-row">
            <i />
            <span />
            <span />
          </div>
        </>
      )}
    </div>
  );
}
