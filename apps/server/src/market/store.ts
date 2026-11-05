import { DatabaseSync } from "node:sqlite";
import type { TokenObservation } from "../../../../packages/shared/src/market.ts";
function freezeObservation<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeObservation(child);
    Object.freeze(value);
  }
  return value;
}
const compareObservation = (a: TokenObservation, b: TokenObservation) =>
  (Date.parse(b.sourceUpdatedAt ?? "") || 0) -
    (Date.parse(a.sourceUpdatedAt ?? "") || 0) ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
export class MarketStore {
  private db: DatabaseSync;
  private tokenCache: TokenObservation[] | null = null;
  private dataVersion = -1;
  private hasCatalogRevision = false;
  constructor(
    readonly file: string,
    readonly readOnly = false,
  ) {
    this.db = new DatabaseSync(file, { readOnly });
    if (readOnly) {
      this.hasCatalogRevision = !!this.db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='catalog_revision'",
        )
        .get();
      return;
    }
    this.db.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS tokens (id TEXT PRIMARY KEY, observed INTEGER NOT NULL, source_updated INTEGER NOT NULL, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, data TEXT NOT NULL, writtenAt INTEGER NOT NULL DEFAULT 0);",
    );
    // Cross-connection invalidation must follow token writes, not wallet,
    // visitor, receipt or other records sharing this WAL database.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS catalog_revision (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL);
      INSERT OR IGNORE INTO catalog_revision VALUES(1,0);
      CREATE TRIGGER IF NOT EXISTS catalog_insert AFTER INSERT ON tokens BEGIN UPDATE catalog_revision SET version=version+1 WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS catalog_update AFTER UPDATE ON tokens BEGIN UPDATE catalog_revision SET version=version+1 WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS catalog_delete AFTER DELETE ON tokens BEGIN UPDATE catalog_revision SET version=version+1 WHERE id=1; END;
    `);
    this.hasCatalogRevision = true;
    // Databases created before records.writtenAt exist: age their rows from the
    // upgrade moment rather than guessing, so nothing looks ancient on boot.
    if (
      !this.db
        .prepare(
          "SELECT 1 FROM pragma_table_info('records') WHERE name='writtenAt'",
        )
        .get()
    ) {
      this.db.exec(
        "ALTER TABLE records ADD COLUMN writtenAt INTEGER NOT NULL DEFAULT 0",
      );
      this.db
        .prepare("UPDATE records SET writtenAt=? WHERE writtenAt=0")
        .run(Date.now());
    }
  }
  catalogVersion() {
    return this.hasCatalogRevision
      ? Number(
          (
            this.db
              .prepare("SELECT version FROM catalog_revision WHERE id=1")
              .get() as { version: number }
          ).version,
        )
      : Number(
          (
            this.db.prepare("PRAGMA data_version").get() as {
              data_version: number;
            }
          ).data_version,
        );
  }
  upsert(tokens: TokenObservation[]) {
    this.db.exec("SAVEPOINT catalog_refresh");
    try {
      this.upsertRows(tokens);
      this.db.exec("RELEASE catalog_refresh");
    } catch (error) {
      this.db.exec("ROLLBACK TO catalog_refresh; RELEASE catalog_refresh");
      this.tokenCache = null;
      this.dataVersion = -1;
      throw error;
    }
  }
  private upsertRows(tokens: TokenObservation[]) {
    const version = this.catalogVersion();
    const cached = version === this.dataVersion ? this.tokenCache : null;
    const changed = new Map<string, TokenObservation>();
    let writes = 0;
    this.tokenCache = null;
    const read = this.db.prepare(
        "SELECT observed,source_updated,data FROM tokens WHERE id=?",
      ),
      put = this.db.prepare(
        "INSERT INTO tokens(id,observed,source_updated,data) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET source_updated=excluded.source_updated,data=excluded.data",
      );
    for (const t of tokens) {
      const old = read.get(t.id) as
          | { observed: number; source_updated: number; data: string }
          | undefined,
        updated = t.sourceUpdatedAt ? Date.parse(t.sourceUpdatedAt) : 0;
      if (old && old.source_updated > updated) continue;
      const observed = old?.observed ?? Date.parse(t.firstObservedAt);
      const prior: TokenObservation | null = old ? JSON.parse(old.data) : null;
      const earliest = (a: string | null | undefined, b: string | null) =>
        !a ? b : !b ? a : a < b ? a : b;
      const retainPool =
        !!prior?.firstPoolCreatedAt &&
        (!t.firstPoolCreatedAt ||
          prior.firstPoolCreatedAt <= t.firstPoolCreatedAt);
      const stored = {
        ...t,
        mintCreatedAt: earliest(prior?.mintCreatedAt, t.mintCreatedAt),
        firstPoolCreatedAt: earliest(
          prior?.firstPoolCreatedAt,
          t.firstPoolCreatedAt,
        ),
        firstPoolId: retainPool ? prior!.firstPoolId : t.firstPoolId,
        firstObservedAt: new Date(observed).toISOString(),
      };
      put.run(t.id, observed, updated, JSON.stringify(stored));
      writes++;
      if (cached) changed.set(t.id, freezeObservation(stored));
    }
    // Provider refreshes usually change a few rows. Reuse immutable unchanged
    // observations instead of reparsing/deep-freezing the entire persisted catalog.
    // A different SQLite writer invalidates this path via the catalog revision above.
    const checkedVersion = this.catalogVersion();
    if (cached && checkedVersion === version + writes) {
      const remaining = cached.filter((t) => !changed.has(t.id));
      const updates = [...changed.values()].sort(compareObservation);
      const merged: TokenObservation[] = [];
      let i = 0,
        j = 0;
      while (i < remaining.length && j < updates.length)
        merged.push(
          compareObservation(remaining[i], updates[j]) <= 0
            ? remaining[i++]
            : updates[j++],
        );
      this.tokenCache = merged.concat(remaining.slice(i), updates.slice(j));
      this.dataVersion = checkedVersion;
    }
  }
  /** Bounded history for viewed holdings, sampled only from existing collector data. */
  priceTrend(mint: string, now = Date.now()) {
    const key = "price-trend:" + mint;
    const saved = this.getRecord<{ points: { time: number; price: number }[] }>(
      key,
    );
    const points = (saved?.points ?? []).filter(
      (p) => p.time >= now - 86_400_000 && p.time <= now,
    );
    const row = this.db
      .prepare("SELECT data FROM tokens WHERE id=?")
      .get("solana-mainnet:" + mint) as { data: string } | undefined;
    const token: TokenObservation | null = row ? JSON.parse(row.data) : null;
    const time = Date.parse(
      token?.price.asOf ?? token?.sourceUpdatedAt ?? token?.fetchedAt ?? "",
    );
    const price = token?.price.value;
    const last = points.at(-1);
    if (
      token?.mint === mint &&
      typeof price === "number" &&
      Number.isFinite(price) &&
      price > 0 &&
      Number.isFinite(time) &&
      time <= now &&
      now - time < 600_000 &&
      (!last || time - last.time >= 60_000)
    ) {
      points.push({ time, price });
      if (points.length > 1440) points.splice(0, points.length - 1440);
      // Never create unbounded history records from arbitrary public mint requests.
      if (!this.readOnly && (saved || this.recordCount("price-trend:") < 512))
        this.putRecord(key, { points });
    }
    return {
      mint,
      chain: "solana-mainnet",
      currency: "USD",
      source: "Observed market prices",
      points,
      stale: !points.length || now - points.at(-1)!.time > 600_000,
    };
  }
  all(): TokenObservation[] {
    // Cache raw observations only. Eligibility, risk freshness and routes are
    // still evaluated on every request. The token-only revision detects other catalog writers.
    const version = this.catalogVersion();
    if (!this.tokenCache || version !== this.dataVersion) {
      this.tokenCache = (
        this.db
          .prepare(
            "SELECT data FROM tokens ORDER BY source_updated DESC,id ASC",
          )
          .all() as { data: string }[]
      ).map((x) => freezeObservation(JSON.parse(x.data)));
      this.dataVersion = version;
    }
    return [...this.tokenCache];
  }
  prune(before: number) {
    const version = this.catalogVersion();
    const cached = version === this.dataVersion ? this.tokenCache : null;
    const removed = this.db
      .prepare("DELETE FROM tokens WHERE observed < ? RETURNING id")
      .all(before) as { id: string }[];
    if (!removed.length) return;
    // A collector expiring even one observation must not force the request
    // thread to parse and freeze the entire catalog on its next read.
    const ids = new Set(removed.map((row) => row.id));
    const checkedVersion = this.catalogVersion();
    this.tokenCache =
      cached && checkedVersion === version + removed.length
        ? cached.filter((token) => !ids.has(token.id))
        : null;
    this.dataVersion = checkedVersion;
  }
  putRecord(id: string, data: unknown) {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO records(id,data,writtenAt) VALUES(?,?,?)",
      )
      .run(id, JSON.stringify(data), Date.now());
  }
  /** Synchronous SQLite transaction: no network or async work in this callback. */
  transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      if (result instanceof Promise)
        throw Error("Async work is not allowed in a store transaction");
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  putRecordIfAbsent(id: string, data: unknown) {
    return (
      this.db
        .prepare(
          "INSERT OR IGNORE INTO records(id,data,writtenAt) VALUES(?,?,?)",
        )
        .run(id, JSON.stringify(data), Date.now()).changes === 1
    );
  }
  deleteRecord(id: string) {
    this.db.prepare("DELETE FROM records WHERE id=?").run(id);
  }
  /**
   * Age out ephemeral records. Only the listed prefixes are touched: issued
   * signatures, spend evidence and reward ledgers are history and are never
   * swept by age. Returns the number of rows removed.
   */
  sweepRecords(rules: { prefix: string; ttlMs: number }[], now = Date.now()) {
    const sweep = this.db.prepare(
      "DELETE FROM records WHERE substr(id,1,?)=? AND writtenAt < ?",
    );
    let removed = 0;
    for (const { prefix, ttlMs } of rules)
      removed += Number(sweep.run(prefix.length, prefix, now - ttlMs).changes);
    return removed;
  }
  recordCount(prefix?: string) {
    const row =
      prefix === undefined
        ? this.db.prepare("SELECT COUNT(*) AS n FROM records").get()
        : this.db
            .prepare("SELECT COUNT(*) AS n FROM records WHERE substr(id,1,?)=?")
            .get(prefix.length, prefix);
    return Number((row as { n: number }).n);
  }
  getRecord<T>(id: string): T | null {
    const r = this.db.prepare("SELECT data FROM records WHERE id=?").get(id) as
      { data: string } | undefined;
    return r ? JSON.parse(r.data) : null;
  }
  records<T>(prefix: string): T[] {
    return (
      this.db
        .prepare("SELECT data FROM records WHERE substr(id,1,?)=? ORDER BY id")
        .all(prefix.length, prefix) as { data: string }[]
    ).map((x) => JSON.parse(x.data));
  }
  /** Bounded public ranking projection. Starter grants and spending never affect rank. */
  pointsLeaders(lane: "practice" | "mainnet") {
    const path = `$.balances.${lane}.earned`;
    return this.db
      .prepare(
        `
      SELECT substr(a.id,16) AS owner,
        max(0, coalesce(json_extract(a.data, ?),0) -
          CASE WHEN ? = 'practice' AND s.id IS NOT NULL THEN 1000 ELSE 0 END) AS points
      FROM records a LEFT JOIN records s ON s.id = 'points:starter:' || substr(a.id,16)
      WHERE substr(a.id,1,15) = 'points:account:' AND points > 0
      ORDER BY points DESC, a.id ASC LIMIT 50
    `,
      )
      .all(path, lane) as { owner: string; points: number }[];
  }
  close() {
    this.db.close();
  }
}
