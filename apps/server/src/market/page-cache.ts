import type { MarketResponse } from "../../../../packages/shared/src/market.ts";
import type { SnapshotOptions, SnapshotReadState } from "./snapshot-state.ts";
/** Reuse a catalog projection only while the evidence and every time boundary
 * are unchanged. This cache is private to the read worker, never execution. */
export function projectionDeadline(
  view: MarketResponse,
  state: SnapshotReadState,
) {
  const now = Date.parse(view.now);
  let until = now + 5000;
  const boundary = (at: number) => {
    if (Number.isFinite(at) && at >= now) until = Math.min(until, at);
  };
  for (const row of [...view.rows, ...(view.manualRows ?? [])]) {
    // Nonmatching history cannot affect pool/counts unless its only blockers
    // can disappear as time advances. Returned rows are re-screened per page.
    if (
      !row.matches &&
      !row.reasons?.every((reason) =>
        [
          "age_too_young",
          "future_timestamp",
          "outside_fresh_cage_window",
          "removed_from_pool",
          "not_in_manual_pool",
        ].includes(reason),
      )
    )
      continue;
    const t = row.token;
    const pool = Date.parse(t.firstPoolCreatedAt ?? ""),
      age = Date.parse(
        (view.filters.ageBasis === "mint"
          ? t.mintCreatedAt
          : t.firstPoolCreatedAt) ?? "",
      );
    boundary(pool);
    boundary(pool + 86400000);
    boundary(age);
    boundary(age + view.filters.minAgeMinutes * 60000);
    boundary(age + view.filters.maxAgeMinutes * 60000);
    const source = Date.parse(t.sourceUpdatedAt ?? "");
    boundary(source);
    boundary(source + (t.chain && t.chain !== "solana" ? 120000 : 60000));
    const risk = Date.parse(t.security?.checkedAt ?? "");
    boundary(risk - 60000);
    boundary(risk + 300000);
    const dex = Date.parse(t.dex?.fetchedAt ?? "");
    boundary(dex + (t.chain && t.chain !== "solana" ? 120000 : 60000));
    if (row.route) boundary(row.route.expiresAt);
    const cachedDex = state.dex[t.mint];
    if (cachedDex) boundary(cachedDex.at + 60000);
  }
  return until;
}
export function pageProjection(
  view: MarketResponse,
  options: SnapshotOptions,
): MarketResponse {
  const offset = options.offset ?? 0,
    limit = options.limit ?? 200;
  const rows = options.matchingOnly
    ? view.rows.filter(
        (r) =>
          r.matches &&
          (!r.token.identity || r.token.identity.winnerMint === r.token.mint),
      )
    : view.rows;
  return {
    ...view,
    rows: rows.slice(offset, offset + limit),
    page: {
      offset,
      limit,
      total: rows.length,
      nextOffset: offset + limit < rows.length ? offset + limit : null,
    },
  };
}
export class PageCache {
  private entries = new Map<string, { view: MarketResponse; until: number }>();
  read(
    key: string,
    options: SnapshotOptions,
    state: SnapshotReadState,
    compute: () => MarketResponse,
    now = Date.now(),
  ) {
    let entry = this.entries.get(key);
    if (!entry || now >= entry.until || now < Date.parse(entry.view.now)) {
      const view = compute();
      entry = { view, until: projectionDeadline(view, state) };
      this.entries.delete(key);
      this.entries.set(key, entry);
      while (this.entries.size > 2)
        this.entries.delete(this.entries.keys().next().value!);
    }
    return pageProjection(entry.view, options);
  }
}
