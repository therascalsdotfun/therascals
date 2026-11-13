import { FrozenPools } from "./frozen-pools.ts";
import { DrawdownGuard } from "./drawdown.ts";
import { clientMessage, UserError } from "../client-message.ts";
import {
  prioritizePicks,
  tokenKey,
  selectedChains,
  tokenChain,
} from "../../../../packages/shared/src/token-selection.ts";
import { BaseDiscovery } from "./base.ts";
import { readFileSync } from "node:fs";
import { createHash, randomInt } from "node:crypto";
import type {
  FilterSpec,
  MarketResponse,
  ProviderHealth,
  RoutePair,
  TokenObservation,
} from "../../../../packages/shared/src/market.ts";
import { MarketStore } from "./store.ts";
import {
  normalizeJupiter,
  DEFAULT_FILTERS,
  evaluateFilters,
  admissionReasons,
} from "./model.ts";
import {
  RequestScheduler,
  checkRoutePair,
  selectPool,
} from "../routes/eligibility.ts";
import {
  commitRoll,
  committedView,
  settleRoll,
  type CommittedRoll,
  type RollAmountMode,
} from "../routes/manifest.ts";
import { GeckoData, type ChartRange } from "./gecko.ts";
import { DexData } from "./dexscreener.ts";
import { RiskData, riskReasons } from "./security.ts";
import { resolveTokenIdentities } from "./identity.ts";
import { ActivityFeed } from "./activity.ts";
import { desiredPoolSize } from "../../../../packages/shared/src/pool-controls.ts";
import {
  findJustHootEntry,
  justHootTokenObservations,
} from "../../../../packages/shared/src/justhoot-tokens.ts";
import { tokenImageUrl } from "../../../../packages/shared/src/token-media.ts";
import { SnapshotReader } from "./snapshot-client.ts";
import type { SnapshotReadState, SnapshotOptions } from "./snapshot-state.ts";
const jsonFileCache = new Map<string, { at: number; value: any }>();
function readCachedJson(path: string, ttlMs = 10000): any {
  const now = Date.now(),
    hit = jsonFileCache.get(path);
  if (hit && now - hit.at < ttlMs) return hit.value;
  let value: any = {};
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {}
  jsonFileCache.set(path, { at: now, value });
  return value;
}

export type DiscoveryConfiguration = {
  filters: FilterSpec;
  ticketAtomic: string;
};
export class MarketService {
  private snapshotReader?: SnapshotReader;
  private readState?: SnapshotReadState;
  private drawdowns: DrawdownGuard;
  private frozenPools = new FrozenPools();
  private visitors = new Map<
    string,
    { configuration: DiscoveryConfiguration; seen: number }
  >();
  private warmCursor = 0;
  private dexWarmCursors = new Map<string, number>();
  private base = new BaseDiscovery();
  private bsc = new BaseDiscovery(fetch, () => Date.now(), "bsc");
  private near = new BaseDiscovery(fetch, () => Date.now(), "near");
  private gecko = new GeckoData();
  private dex = new DexData();
  private risk = new RiskData();
  private activity = new ActivityFeed(this.gecko);
  private dexEnriching = false;
  private activityCursor = 0;
  private expanding = false;
  private expansion = {
    lastSuccess: null as string | null,
    error: null as string | null,
  };
  private scheduler = new RequestScheduler();
  private routes = new Map<string, RoutePair>();
  private filters = { ...DEFAULT_FILTERS };
  private ticketAtomic = "5000000";
  private startedAt = new Date().toISOString();
  private timers: ReturnType<typeof setInterval>[] = [];
  private collecting = false;
  private enriching = false;
  private checking = false;
  private backoffUntil = 0;
  health: ProviderHealth = {
    state: "starting",
    lastSuccess: null,
    error: null,
    observed: 0,
    requests: 0,
  };
  constructor(private store: MarketStore) {
    this.drawdowns = new DrawdownGuard(store);
    const saved = store.getRecord<{
      filters: FilterSpec;
      ticketAtomic: string;
    }>("discovery-configuration");
    this.base.restore(
      this.store.records<
        import("../../../../packages/shared/src/market.ts").TokenObservation
      >("base-observation:"),
    );
    this.bsc.restore(this.store.records("bsc-observation:"));
    this.near.restore(this.store.records("near-observation:"));
    if (saved) {
      this.filters =
        saved.filters.minMarketCap === 50000 &&
        saved.filters.minLiquidity === 10000
          ? { ...DEFAULT_FILTERS }
          : saved.filters;
      this.ticketAtomic = saved.ticketAtomic;
    }
  }
  configure(x: { filters: FilterSpec; ticketAtomic: string }) {
    this.filters = x.filters;
    this.ticketAtomic = x.ticketAtomic;
    this.store.putRecord("discovery-configuration", x);
    void this.warm();
  }
  scoped(scope: string) {
    const configuration = () => {
      let entry = this.visitors.get(scope);
      if (!entry) {
        entry = {
          configuration: this.store.getRecord<DiscoveryConfiguration>(
            "discovery:" + scope,
          ) ?? { filters: { ...DEFAULT_FILTERS }, ticketAtomic: "5000000" },
          seen: Date.now(),
        };
        if (this.visitors.size >= 128)
          this.visitors.delete(this.visitors.keys().next().value!);
        this.visitors.set(scope, entry);
      }
      entry.seen = Date.now();
      return entry.configuration;
    };
    return {
      configure: (x: DiscoveryConfiguration) => {
        configuration();
        this.visitors.set(scope, {
          configuration: structuredClone(x),
          seen: Date.now(),
        });
        this.store.putRecord("discovery:" + scope, x);
        setTimeout(() => void this.warm(x), 15).unref?.();
      },
      snapshot: (
        options: {
          offset?: number;
          limit?: number;
          matchingOnly?: boolean;
        } = {},
      ) => this.snapshot(options, configuration()),
      snapshotAsync: (options: SnapshotOptions = {}) =>
        this.snapshotAsync(options, configuration()),
      ticketSize: () => configuration().ticketAtomic,
      frozenSnapshot: (keys: string[]) =>
        this.frozenSnapshot(keys, configuration()),
      revalidateSelected: (mint: string, ticket: string, filters: FilterSpec) =>
        this.revalidateSelected(mint, ticket, filters),
      revalidateEvmSelected: (
        chain: "base" | "bsc",
        mint: string,
        filters: FilterSpec,
      ) => this.revalidateEvmSelected(chain, mint, filters),
      beginRoll: (
        expected: string,
        amountMode: RollAmountMode = "fixed",
        poolKeys?: string[],
      ) =>
        this.rollBegin(scope, configuration(), expected, amountMode, poolKeys),
      revealRoll: (rollId: string) =>
        this.rollReveal(scope, configuration(), rollId),
      settleForExecution: (rollId: string) =>
        this.rollSettle(scope, configuration(), rollId),
    };
  }
  /** A committed roll belongs to the scope that opened it; no one else may settle it. */
  private rollLoad(scope: string, rollId: string) {
    const roll = this.store.getRecord<CommittedRoll>("roll:" + rollId);
    if (!roll || roll.scope !== scope)
      throw Error("Unknown roll. Start a new one.");
    if (roll.expiresAt <= Date.now())
      throw Error("The roll expired. Start a new one; no buy was sent.");
    return roll;
  }
  private rollBegin(
    scope: string,
    configuration: DiscoveryConfiguration,
    expected: string,
    amountMode: RollAmountMode,
    poolKeys?: string[],
  ) {
    const snapshot = poolKeys
      ? this.frozenSnapshot(poolKeys, configuration)
      : this.snapshot({ matchingOnly: true }, configuration);
    const roll = commitRoll(snapshot, expected, amountMode, scope);
    this.frozenPools.remember(snapshot);
    this.store.putRecord("roll:" + roll.id, roll);
    return committedView(roll, snapshot);
  }
  private rollSettle(
    scope: string,
    configuration: DiscoveryConfiguration,
    rollId: string,
  ) {
    const roll = this.rollLoad(scope, rollId),
      snapshot = this.frozenSnapshot(roll.poolKeys, configuration);
    return { roll, snapshot, preview: settleRoll(snapshot, roll) };
  }
  private rollReveal(
    scope: string,
    configuration: DiscoveryConfiguration,
    rollId: string,
  ) {
    return this.rollSettle(scope, configuration, rollId).preview;
  }
  beginRoll(
    expected: string,
    amountMode: RollAmountMode = "fixed",
    poolKeys?: string[],
  ) {
    return this.rollBegin(
      "operator",
      this.operatorConfiguration(),
      expected,
      amountMode,
      poolKeys,
    );
  }
  revealRoll(rollId: string) {
    return this.rollReveal("operator", this.operatorConfiguration(), rollId);
  }
  settleForExecution(rollId: string) {
    return this.rollSettle("operator", this.operatorConfiguration(), rollId);
  }
  private operatorConfiguration(): DiscoveryConfiguration {
    return { filters: this.filters, ticketAtomic: this.ticketAtomic };
  }
  private async warmVisitors() {
    // A busy refresh has not serviced the next visitor. Do not consume that
    // visitor's turn while the previous DEX/risk/two-way quote is in flight.
    if (this.checking || Date.now() < this.backoffUntil) return;
    const active = [...this.visitors.values()].filter(
      (x) => x.seen > Date.now() - 600000,
    );
    const configurations = [
      ...new Map(
        active.map((x) => [JSON.stringify(x.configuration), x.configuration]),
      ).values(),
    ];
    await this.warm(
      configurations.length
        ? configurations[this.warmCursor++ % configurations.length]
        : undefined,
    );
  }
  private get(url: string, priority = 0): Promise<any> {
    return this.scheduler.run(async () => {
      if (Date.now() < this.backoffUntil)
        throw new UserError("Provider cooling down after rate limit");
      this.health.requests++;
      const r = await fetch(url, {
        signal: AbortSignal.timeout(12000),
        // The request carries JUPITER_API_KEY; following a redirect would hand
        // that key to whatever host the provider points at next.
        redirect: "error",
        headers: {
          accept: "application/json",
          ...(process.env.JUPITER_API_KEY
            ? { "x-api-key": process.env.JUPITER_API_KEY }
            : {}),
        },
      });
      if (!r.ok) {
        if (r.status === 429) {
          this.backoffUntil =
            Date.now() +
            Math.max(30000, Number(r.headers.get("retry-after") ?? 0) * 1000);
          this.health.state = "rate_limited";
        }
        throw new UserError("Jupiter HTTP " + r.status);
      }
      const body = await r.json();
      if (body && typeof body === "object" && "error" in body)
        throw new Error(String((body as any).error));
      return body;
    }, priority);
  }
  private ingest(raw: any) {
    if (!Array.isArray(raw)) throw new Error("Unexpected token response");
    const now = Date.now();
    const observations = raw
      .map((x) => normalizeJupiter(x, now))
      .filter((x) => x !== null);
    this.drawdowns.observe(observations);
    this.store.upsert(observations);
    this.store.prune(now - 86400000);
    this.health = {
      ...this.health,
      state: "live",
      lastSuccess: new Date().toISOString(),
      error: null,
      observed: this.store.all().length,
    };
  }
  private failure(e: unknown) {
    this.health.error = clientMessage(
      e,
      "Token provider unavailable.",
      "discovery collect",
    );
    if (this.health.state !== "rate_limited") this.health.state = "error";
  }
  async collect() {
    if (this.collecting) return;
    this.collecting = true;
    try {
      this.ingest(await this.get("https://api.jup.ag/tokens/v2/recent"));
    } catch (e) {
      this.failure(e);
    } finally {
      this.collecting = false;
    }
  }
  async enrich() {
    if (this.enriching) return;
    const tokens = this.store
      .all()
      .filter((t) => evaluateFilters(t, this.filters, Date.now()).matches)
      .slice(0, 100);
    if (!tokens.length) return;
    this.enriching = true;
    try {
      this.ingest(
        await this.get(
          "https://api.jup.ag/tokens/v2/search?query=" +
            tokens.map((t) => t.mint).join(","),
          1,
        ),
      );
    } catch (e) {
      this.failure(e);
    } finally {
      this.enriching = false;
    }
  }
  async expand() {
    if (this.expanding) return;
    this.expanding = true;
    try {
      const category = await this.get(
        "https://api.jup.ag/tokens/v2/toptraded/24h?limit=100",
      );
      if (!Array.isArray(category))
        throw new Error("Unexpected category response");
      this.ingest(
        category.filter((r: any) => {
          const created = Date.parse(
            r.firstPool?.createdAt ?? r.createdAt ?? "",
          );
          return (
            Number.isFinite(created) &&
            created <= Date.now() &&
            created >= Date.now() - 86400000
          );
        }),
      );
      const mints = await this.gecko.newMints();
      if (mints.length)
        this.ingest(
          await this.get(
            "https://api.jup.ag/tokens/v2/search?query=" +
              mints.slice(0, 100).join(","),
          ),
        );
      this.expansion = { lastSuccess: new Date().toISOString(), error: null };
    } catch (e) {
      this.expansion.error = clientMessage(
        e,
        "Discovery expansion unavailable.",
        "discovery expansion",
      );
    } finally {
      this.expanding = false;
    }
  }
  async enrichDex() {
    if (this.dexEnriching) return;
    this.dexEnriching = true;
    try {
      const all = this.store.all(),
        now = Date.now();
      const matches = all.filter(
        (t) => evaluateFilters(t, this.filters, now).matches,
      );
      const mints = [
        ...new Set(
          [...matches.slice(0, 20), ...all.slice(0, 15)].map((t) => t.mint),
        ),
      ].slice(0, 30);
      await this.dex.tokens(mints);
    } catch {
      /* Missing or stale DEX evidence keeps candidates outside the draw. */
    } finally {
      this.dexEnriching = false;
    }
  }
  async tokenInfo(mint: string) {
    const rows = await this.dex.tokens([mint]);
    return rows[0] ?? null;
  }
  baseTokens() {
    return this.base.tokens();
  }
  evmTokens(chain: "base" | "bsc") {
    return this[chain].tokens();
  }
  activitySnapshot() {
    return this.activity.snapshot();
  }
  async collectActivity() {
    const candidates = this.store
      .all()
      .filter((t) => {
        const d = this.dex.peek(t.mint);
        return (
          d && !d.stale && (d.volume5m ?? 0) > 0 && (d.liquidity ?? 0) >= 1000
        );
      })
      .sort(
        (a, b) =>
          (this.dex.peek(b.mint)?.volume5m ?? 0) -
          (this.dex.peek(a.mint)?.volume5m ?? 0),
      )
      .slice(0, 3);
    const token = candidates.length
      ? candidates[this.activityCursor++ % candidates.length]
      : null;
    await this.activity.refresh(
      token ? { ...token, dex: this.dex.peek(token.mint) } : null,
    );
  }
  async sourceChart(mint: string, range: ChartRange) {
    const dex = (await this.dex.tokens([mint]))[0];
    if (!dex || dex.stale || (dex.liquidity ?? 0) <= 0)
      throw new UserError("Fresh highest-liquidity reference pair unavailable");
    return this.gecko.chart(mint, range, dex.pool);
  }
  observedIconUrl(mint: string): string | null {
    const jh = findJustHootEntry(mint);
    if (jh) return tokenImageUrl(jh.icon);
    const dex = this.readDex(mint);
    const fromDex = tokenImageUrl(dex?.icon);
    if (fromDex) return fromDex;
    const all = [
      ...this.store.all(),
      ...this.chainState("base").tokens,
      ...this.chainState("bsc").tokens,
      ...this.chainState("near").tokens,
    ];
    for (const token of all) {
      if (token.mint === mint) {
        const url = tokenImageUrl(token.dex?.icon ?? token.icon);
        if (url) return url;
      }
    }
    return null;
  }
  async tokenRisk(mint: string) {
    return {
      ...(await this.risk.scan(mint)),
      drawdown: this.drawdowns.evidence(mint) ?? null,
    };
  }
  promotionVisible(mint: string) {
    const risk = this.risk.peek(mint),
      dex = this.dex.peek(mint),
      now = Date.now();
    return (
      !this.drawdowns.evidence(mint) &&
      !riskReasons(risk, now).length &&
      !!dex &&
      !dex.stale &&
      (dex.liquidity ?? 0) > 0 &&
      Number.isFinite(Date.parse(dex.fetchedAt)) &&
      now >= Date.parse(dex.fetchedAt) &&
      now - Date.parse(dex.fetchedAt) <= 60000
    );
  }
  async lookup(mints: string[]) {
    return this.get(
      "https://api.jup.ag/tokens/v2/search?query=" +
        mints.slice(0, 100).join(","),
      1,
    );
  }
  async importToken(
    mint: string,
    chain: import("../../../../packages/shared/src/token-selection.ts").DiscoveryChain = "solana",
  ) {
    if (chain !== "solana") {
      const adapter =
        chain === "base" ? this.base : chain === "bsc" ? this.bsc : this.near;
      const t = await adapter.import(mint);
      this.store.putRecord(chain + "-observation:" + t.mint, t);
      return t;
    }
    const raw = await this.lookup([mint]);
    const exact = Array.isArray(raw)
      ? raw.filter((t: any) => t.id === mint)
      : [];
    if (!exact.length)
      throw new UserError("Token not found by exact mint. Check the address.");
    this.ingest(exact);
    return this.store.all().find((t) => t.mint === mint) ?? null;
  }
  private decorate(
    token: import("../../../../packages/shared/src/market.ts").TokenObservation,
  ) {
    return {
      ...token,
      dex: this.readDex(token.mint),
      security: this.readState
        ? this.readState.risk[token.mint]
        : this.risk.peek(token.mint),
    };
  }
  private candidateTokens(
    configuration: DiscoveryConfiguration,
    eligibleOnly = false,
    matchingOnly = false,
    source?: TokenObservation[],
  ) {
    const now = Date.now(),
      observations = source ?? [
        ...this.store.all(),
        ...this.chainState("base").tokens,
        ...this.chainState("bsc").tokens,
        ...this.chainState("near").tokens,
        ...(configuration.filters.includeBondingCurve
          ? justHootTokenObservations(now)
          : []),
      ];
    // Warming only needs the eligible identity universe. Reject observations
    // using the same raw-metric filters before allocating decorated copies for
    // tens of thousands of historical tokens. Manual exclusions must not alter
    // which lookalike wins, so identity filtering still ignores tokenSelection.
    const identityFilters = {
      ...configuration.filters,
      tokenSelection: undefined,
    };
    const all: TokenObservation[] = (
      eligibleOnly || matchingOnly
        ? observations.filter(
            (t) =>
              (evaluateFilters(t, identityFilters, now).matches &&
                (!eligibleOnly || !admissionReasons(t, now).length)) ||
              (matchingOnly &&
                [
                  ...(configuration.filters.tokenSelection?.included ?? []),
                  ...(configuration.filters.tokenSelection?.excluded ?? []),
                ].includes(tokenKey(t))),
          )
        : observations
    ).map((t) => (tokenChain(t) === "solana" ? this.decorate(t) : { ...t }));
    const identities = new Map<
      string,
      import("../../../../packages/shared/src/token-security.ts").TokenIdentity
    >();
    // Manual membership must not make a weaker lookalike become the winner.
    for (const chain of ["solana", "base", "bsc", "near"] as const) {
      const grouped = resolveTokenIdentities(
        all.filter(
          (t) =>
            tokenChain(t) === chain &&
            evaluateFilters(t, identityFilters, now).matches &&
            !admissionReasons(t, now).length,
        ),
      );
      for (const [key, value] of grouped) identities.set(key, value);
    }
    // These are private presentation copies. Enrich them in place rather than
    // copying every historical observation a second time on each request.
    for (const t of all) {
      t.identity = identities.get(t.mint);
      t.drawdown = this.readDrawdown(tokenKey(t));
    }
    return all;
  }
  private screeningReasons(
    token: import("../../../../packages/shared/src/market.ts").TokenObservation,
    now: number,
  ) {
    return [
      ...(this.readDrawdown(tokenKey(token))
        ? ["severe_drawdown_quarantine"]
        : []),
      ...riskReasons(token.security, now),
      ...(!token.dex ||
      token.dex.stale ||
      now - Date.parse(token.dex.fetchedAt) >=
        (tokenChain(token) !== "solana" ? 120000 : 60000)
        ? ["reference_pair_pending"]
        : (token.dex.liquidity ?? 0) <= 0
          ? ["unknown_pair_liquidity"]
          : []),
      ...(token.identity && token.identity.winnerMint !== token.mint
        ? ["duplicate_name_or_ticker"]
        : []),
    ];
  }
  private cacheRoute(key: string, route: RoutePair) {
    this.routes.delete(key);
    this.routes.set(key, route);
    for (const [id, value] of this.routes)
      if (value.expiresAt < Date.now()) this.routes.delete(id);
    while (this.routes.size > 300)
      this.routes.delete(this.routes.keys().next().value!);
  }
  /** Re-screen returned historical rows even when a shared projection remains valid. */
  refreshPageRows(view: MarketResponse): MarketResponse {
    const now = Date.now();
    const refresh = (rows: MarketResponse["rows"]) =>
      rows.map((row) => {
        const token =
          tokenChain(row.token) === "solana"
            ? this.decorate(row.token)
            : row.token;
        return {
          ...row,
          token,
          ...evaluateFilters(token, view.filters, now),
          admissionReasons: [
            ...admissionReasons(token, now),
            ...this.screeningReasons(token, now),
          ],
          route:
            row.route && row.route.expiresAt <= now
              ? { ...row.route, status: "stale" as const }
              : row.route,
        };
      });
    return {
      ...view,
      rows: refresh(view.rows),
      manualRows: refresh(view.manualRows ?? []),
    };
  }
  /** Shared read worker performs the catalog scan, never provider calls or writes. */
  warmingCandidates(configuration: DiscoveryConfiguration) {
    return this.candidateTokens(configuration, true);
  }
  private async warmCandidates(configuration: DiscoveryConfiguration) {
    if (this.store.file === ":memory:" || this.store.readOnly)
      return this.warmingCandidates(configuration);
    this.snapshotReader ??= new SnapshotReader(this.store.file);
    return this.snapshotReader.candidates(
      this.snapshotReadState(),
      configuration,
      this.store.catalogVersion(),
    );
  }
  async warm(
    configuration: DiscoveryConfiguration = {
      filters: this.filters,
      ticketAtomic: this.ticketAtomic,
    },
  ) {
    if (selectedChains(configuration.filters).includes("base"))
      void this.base.collect();
    if (selectedChains(configuration.filters).includes("bsc"))
      void this.bsc.collect();
    if (selectedChains(configuration.filters).includes("near"))
      void this.near.collect();
    if (this.checking || Date.now() < this.backoffUntil) return;
    this.checking = true;
    try {
      const at = Date.now();
      let candidates = (await this.warmCandidates(configuration)).filter(
        (t) =>
          tokenChain(t) === "solana" &&
          evaluateFilters(t, configuration.filters, at).matches &&
          !admissionReasons(t, at).length,
      );
      // Round-robin all exact mints, including lookalikes and missing pairs.
      // Display data is absent for a cached miss, so its timestamp cannot be
      // used for rotation: a full batch of misses would starve deeper tokens.
      candidates.sort(
        (a, b) =>
          (b.liquidity.value ?? 0) - (a.liquidity.value ?? 0) ||
          a.mint.localeCompare(b.mint),
      );
      const cursorKey = createHash("sha256")
          .update(JSON.stringify(configuration.filters))
          .digest("hex"),
        count = Math.min(30, candidates.length),
        start = candidates.length
          ? (this.dexWarmCursors.get(cursorKey) ?? 0) % candidates.length
          : 0,
        leading = Array.from(
          { length: count },
          (_, i) => candidates[(start + i) % candidates.length],
        );
      // Each filter universe keeps its progress when other visitors warm.
      this.dexWarmCursors.delete(cursorKey);
      this.dexWarmCursors.set(
        cursorKey,
        candidates.length ? (start + count) % candidates.length : 0,
      );
      while (this.dexWarmCursors.size > 128)
        this.dexWarmCursors.delete(this.dexWarmCursors.keys().next().value!);
      await this.dex.tokens(leading.map((t) => t.mint));
      const pinned = candidates
        .filter((t) => t.security?.status === "checked")
        .slice(0, 20)
        .map((t) => t.mint)
        .filter((m) => !leading.some((l) => l.mint === m));
      if (pinned.length) await this.dex.tokens(pinned);
      candidates = candidates
        .map((t) => (tokenChain(t) === "solana" ? this.decorate(t) : t))
        .filter(
          (t) =>
            tokenChain(t) === "solana" &&
            evaluateFilters(t, configuration.filters, Date.now()).matches &&
            !admissionReasons(t, Date.now()).length &&
            (!t.identity || t.identity.winnerMint === t.mint),
        );
      const hasFreshDex = (t: TokenObservation) =>
        Boolean(
          t.dex &&
            !t.dex.stale &&
            Date.now() - Date.parse(t.dex.fetchedAt) < 60000 &&
            (t.dex.liquidity ?? 0) > 0,
        );
      const needsScan = candidates
        .filter(
          (t) =>
            !t.security ||
            Date.now() - Date.parse(t.security.checkedAt) >=
              (t.security.status === "unavailable" ? 30000 : 300000),
        )
        .sort(
          (a, b) =>
            Number(hasFreshDex(b)) - Number(hasFreshDex(a)) ||
            (Date.parse(a.security?.checkedAt ?? "") || 0) -
              (Date.parse(b.security?.checkedAt ?? "") || 0),
        );
      for (const target of needsScan.slice(0, 3)) {
        await this.risk.scan(target.mint);
      }
      const now = Date.now(),
        ticket = configuration.ticketAtomic;
      const routeTargets = candidates
        .map((t) => (tokenChain(t) === "solana" ? this.decorate(t) : t))
        .filter(
          (t) =>
            tokenChain(t) === "solana" &&
            evaluateFilters(t, configuration.filters, now).matches &&
            !admissionReasons(t, now).length &&
            !this.screeningReasons(t, now).length,
        )
        .filter((t) => {
          const r = this.routes.get(t.mint + ":" + ticket);
          return (
            !r ||
            (r.status === "eligible"
              ? r.expiresAt < now + 20000
              : r.expiresAt <= now)
          );
        })
        .sort(
          (a, b) =>
            (this.routes.get(a.mint + ":" + ticket)?.checkedAt ?? 0) -
            (this.routes.get(b.mint + ":" + ticket)?.checkedAt ?? 0),
        );
      for (const token of routeTargets.slice(0, 2)) {
        this.cacheRoute(
          token.mint + ":" + ticket,
          await checkRoutePair(token.mint, ticket, (url) => this.get(url, 2)),
        );
      }
    } catch {
      /* Missing provider data fails closed in every snapshot and buy check. */
    } finally {
      this.checking = false;
    }
  }
  snapshot(
    options: { offset?: number; limit?: number; matchingOnly?: boolean } = {},
    configuration: DiscoveryConfiguration = {
      filters: this.filters,
      ticketAtomic: this.ticketAtomic,
    },
  ): MarketResponse {
    const now = Date.now(),
      observations = [
        ...this.store.all(),
        ...this.chainState("base").tokens,
        ...this.chainState("bsc").tokens,
        ...this.chainState("near").tokens,
        ...(configuration.filters.includeBondingCurve
          ? justHootTokenObservations(now)
          : []),
      ],
      all = this.candidateTokens(
        configuration,
        false,
        options.matchingOnly === true,
        observations,
      );
    const rows = all.map((token) => {
      const decision = evaluateFilters(token, configuration.filters, now),
        route =
          this.routes.get(token.mint + ":" + configuration.ticketAtomic) ??
          null;
      return {
        token,
        ...decision,
        admissionReasons: [
          ...admissionReasons(token, now),
          ...this.screeningReasons(token, now),
        ],
        route:
          route && route.expiresAt <= now
            ? { ...route, status: "stale" as const }
            : route,
      };
    });
    const candidates = rows.filter(
      (r) => r.matches && !r.admissionReasons.length,
    );
    const solana = selectPool(
      candidates
        .filter((r) => tokenChain(r.token) === "solana")
        .map((r) => r.token),
      this.routes,
      configuration.ticketAtomic,
      now,
      32,
      configuration.filters.tokenSelection?.included,
    );
    const base = candidates
      .filter(
        (r) =>
          tokenChain(r.token) !== "solana" && (r.token.dex?.liquidity ?? 0) > 0,
      )
      .map((r) => r.token);
    const pool = prioritizePicks(
      [...solana, ...base].sort((a, b) => {
        const ra = findJustHootEntry(a.mint)?.rank,
          rb = findJustHootEntry(b.mint)?.rank;
        if (ra !== undefined || rb !== undefined)
          return (ra ?? 999) - (rb ?? 999);
        return (
          Date.parse(b.firstPoolCreatedAt ?? "") -
          Date.parse(a.firstPoolCreatedAt ?? "")
        );
      }),
      configuration.filters,
    ).slice(0, desiredPoolSize(configuration.filters));
    const setup = readCachedJson(".data/setup-status.json"),
      mpc = readCachedJson("docs/evidence/mpc-transfer.json");
    const offset = options.offset ?? 0,
      limit = options.limit ?? 200,
      chainRows = rows
        .filter((r) =>
          selectedChains(configuration.filters).includes(tokenChain(r.token)),
        )
        .sort((a, b) => {
          const ra = findJustHootEntry(a.token.mint)?.rank,
            rb = findJustHootEntry(b.token.mint)?.rank;
          if (ra !== undefined || rb !== undefined)
            return (ra ?? 999) - (rb ?? 999);
          return (
            Date.parse(b.token.sourceUpdatedAt ?? "") -
            Date.parse(a.token.sourceUpdatedAt ?? "")
          );
        }),
      listed = options.matchingOnly
        ? chainRows.filter(
            (r) =>
              r.matches &&
              (!r.token.identity ||
                r.token.identity.winnerMint === r.token.mint),
          )
        : chainRows;
    const result: MarketResponse = {
      now: new Date(now).toISOString(),
      filters: configuration.filters,
      ticketAtomic: configuration.ticketAtomic,
      configurationHash: createHash("sha256")
        .update(
          JSON.stringify({
            filters: configuration.filters,
            ticketAtomic: configuration.ticketAtomic,
          }),
        )
        .digest("hex"),
      rows: listed.slice(offset, offset + limit),
      manualRows: rows.filter((r) =>
        [
          ...(configuration.filters.tokenSelection?.included ?? []),
          ...(configuration.filters.tokenSelection?.excluded ?? []),
        ].includes(tokenKey(r.token)),
      ),
      page: {
        offset,
        limit,
        total: listed.length,
        nextOffset: offset + limit < listed.length ? offset + limit : null,
      },
      matching: rows.filter(
        (r) =>
          r.matches &&
          (!r.token.identity || r.token.identity.winnerMint === r.token.mint),
      ).length,
      observed: observations.filter((t) =>
        selectedChains(configuration.filters).includes(tokenChain(t)),
      ).length,
      eligible: pool.length,
      pool: pool.map((t) =>
        tokenChain(t) !== "solana" ? t : { ...t, dex: this.readDex(t.mint) },
      ),
      health: this.health,
      coverage: {
        chainSources: Object.fromEntries(
          (["solana", "base", "bsc", "near"] as const).map((chain) => {
            const observedCount = observations.filter(
                (t) => tokenChain(t) === chain,
              ).length,
              observed = rows.filter((r) => tokenChain(r.token) === chain),
              matching = observed.filter((r) => r.matches),
              admitted = candidates.filter(
                (r) => tokenChain(r.token) === chain,
              ),
              blockers: Record<string, number> = {};
            for (const row of matching) {
              const reasons = [...row.admissionReasons];
              if (
                chain === "solana" &&
                !reasons.length &&
                row.route?.status !== "eligible"
              )
                reasons.push("route_pending");
              for (const reason of new Set(reasons))
                blockers[reason] = (blockers[reason] ?? 0) + 1;
            }
            return [
              chain,
              {
                observed: observedCount,
                loading:
                  chain === "solana"
                    ? (this.readState?.collecting ?? this.collecting) &&
                      !observedCount
                    : this.chainState(chain).loading,
                matching: matching.length,
                eligible: chain === "solana" ? solana.length : admitted.length,
                inDraw: pool.filter((t) => tokenChain(t) === chain).length,
                blockers,
                error:
                  chain === "solana"
                    ? this.health.error
                    : this.chainState(chain).error,
                previewOnly: chain === "near",
              },
            ];
          }),
        ),
        startedAt: this.startedAt,
        oldestObservation: observations.length
          ? observations.reduce(
              (a, t) => (a < t.firstObservedAt ? a : t.firstObservedAt),
              observations[0].firstObservedAt,
            )
          : null,
        description:
          "Real Solana, Base, BNB and NEAR observations. Solana: Jupiter recent/traded and GeckoTerminal new pools, token-wide metrics, RugCheck and two-way Jupiter routes. Base/BNB: GeckoTerminal new pools and DEX Screener profiles, strongest indexed reference-pool metrics, GoPlus; native mainnet buys require a fresh LI.FI route, actual-wallet simulation and MetaMask approval after selection. NEAR: indexed observations only, risk screening unavailable, excluded from draws. DEX Screener supplies reference pairs and paid-boost labels. Lookalikes collapse per chain to the strongest-liquidity candidate, with market cap as tie-breaker. This is a partial index, not every launch. Request 2–32 sources per draw; only fresh, screened sources with positive reference liquidity enter. No reported risks is not a safety guarantee.",
        expansion: this.expansion,
      },
      execution: {
        state:
          mpc.signatureVerified && !mpc.transferFinalized ? "blocked" : "setup",
        message: setup.nearReady
          ? "NEAR testnet wallet ready. MPC signing and Devnet swap gates are not yet passed."
          : "Testnet execution setup in progress.",
        nearAccount: setup.nearAccount,
        solanaAddress: setup.solanaAddress,
        solBalance: setup.solBalance,
        mpcSignatureVerified: mpc.signatureVerified === true,
        mpcNearTransaction: mpc.nearTransaction,
        mpcAddress: mpc.source,
        transferFinalized: mpc.transferFinalized === true,
      },
    };
    this.frozenPools.remember(result);
    return result;
  }
  frozenSnapshot(keys: string[], configuration?: DiscoveryConfiguration) {
    if (keys.some((key) => this.drawdowns.evidence(key)))
      throw new UserError(
        "A token in this roll was quarantined after a severe drawdown. Start a new roll; no buy was sent.",
      );
    const current = this.snapshot({ matchingOnly: true }, configuration);
    return this.frozenPools.resolve(current, keys);
  }
  start() {
    void this.collect();
    void this.base.collect();
    void this.bsc.collect();
    void this.near.collect();
    void this.expand();
    void this.enrichDex().then(() => this.collectActivity());
    this.timers = [
      setInterval(() => void this.collect(), 15000),
      setInterval(() => void this.enrich(), 30000),
      setInterval(() => void this.warmVisitors(), 3000),
      setInterval(() => void this.expand(), 60000),
      setInterval(() => void this.base.collect(), 90000),
      setInterval(() => void this.bsc.collect(), 90000),
      setInterval(() => void this.near.collect(), 90000),
      setInterval(() => void this.enrichDex(), 30000),
      setInterval(() => void this.collectActivity(), 60000),
      setInterval(
        () =>
          this.drawdowns.observe([
            ...this.base.tokens(),
            ...this.bsc.tokens(),
            ...this.near.tokens(),
          ]),
        600000,
      ),
    ];
  }
  stop() {
    this.timers.forEach(clearInterval);
    this.closeSnapshotReader();
  }
  closeSnapshotReader() {
    this.snapshotReader?.close();
    this.snapshotReader = undefined;
  }
  private chainState(chain: "base" | "bsc" | "near") {
    return (
      this.readState?.chains[chain] ?? {
        tokens: this[chain].tokens(),
        loading: this[chain].loading,
        error: this[chain].error,
      }
    );
  }
  private readDex(mint: string) {
    if (!this.readState) return this.dex.peek(mint);
    const entry = this.readState.dex[mint];
    return entry?.data
      ? {
          ...entry.data,
          stale: entry.data.stale || Date.now() - entry.at >= 60000,
        }
      : undefined;
  }
  private readDrawdown(key: string) {
    return this.readState
      ? this.readState.drawdowns[key]
      : this.drawdowns.evidence(key);
  }
  snapshotReadState(): SnapshotReadState {
    return {
      dex: this.dex.readCache(),
      risk: this.risk.readCache(),
      drawdowns: this.drawdowns.readEvidence(),
      routes: [...this.routes],
      chains: {
        base: this.chainState("base"),
        bsc: this.chainState("bsc"),
        near: this.chainState("near"),
      },
      health: this.health,
      collecting: this.collecting,
      startedAt: this.startedAt,
      expansion: this.expansion,
    };
  }
  /** Read-only worker hydration. Never called by an HTTP mutation or trade path. */
  useReadState(state: SnapshotReadState) {
    if (!this.store.readOnly)
      throw Error("Snapshot state requires a read-only store");
    this.readState = state;
    this.routes = new Map(state.routes);
    this.health = state.health;
    this.startedAt = state.startedAt;
    this.expansion = state.expansion;
  }
  async snapshotAsync(
    options: SnapshotOptions = {},
    configuration = this.operatorConfiguration(),
  ) {
    // Private in-memory unit/embedded stores have no cross-thread SQLite path.
    if (this.store.file === ":memory:")
      return this.snapshot(options, configuration);
    if (this.store.readOnly)
      throw Error("A read worker cannot start another worker");
    this.snapshotReader ??= new SnapshotReader(this.store.file);
    const result = await this.snapshotReader.read(
      this.snapshotReadState(),
      options,
      configuration,
      this.store.catalogVersion(),
    );
    this.frozenPools.remember(result);
    return structuredClone(result);
  }
  ticketSize() {
    return this.ticketAtomic;
  }
  async revalidateEvmSelected(
    chain: "base" | "bsc",
    mint: string,
    filters: FilterSpec,
  ) {
    const imported = await this.importToken(mint, chain);
    if (!imported) throw new UserError("Selected token is unavailable.");
    this.drawdowns.observe([imported]);
    const token = this.candidateTokens({
      filters: { ...filters, chains: [chain] },
      ticketAtomic: "1000000",
    }).find(
      (t) =>
        tokenChain(t) === chain && t.mint.toLowerCase() === mint.toLowerCase(),
    );
    if (
      !token ||
      token.security?.chain !== chain ||
      token.security?.mint.toLowerCase() !== mint.toLowerCase() ||
      admissionReasons(token, Date.now()).length ||
      this.screeningReasons(token, Date.now()).length ||
      !evaluateFilters(token, { ...filters, chains: [chain] }, Date.now())
        .matches
    )
      throw new UserError(
        "Selected token failed fresh risk, liquidity, identity or filter checks. No trade was sent.",
      );
    return token;
  }
  async revalidateSelected(mint: string, ticket: string, filters: FilterSpec) {
    if (selectedChains(filters).some((chain) => chain !== "solana"))
      throw new UserError(
        "Non-Solana and mixed pools are preview-only. Select Solana only for test execution.",
      );
    await this.dex.tokens([mint]);
    await this.risk.scan(mint, 60000, 3);
    const configuration = { filters, ticketAtomic: ticket };
    const screened = this.candidateTokens(configuration).find(
      (t) => t.mint === mint,
    );
    if (!screened || this.screeningReasons(screened, Date.now()).length)
      throw new UserError(
        "Selected source failed reference-pair, identity or external security checks; no replacement will be chosen",
      );
    const cachedToken = screened,
      cached = this.routes.get(mint + ":" + ticket),
      at = Date.now();
    if (
      cachedToken &&
      cached?.status === "eligible" &&
      cached.ticketAtomic === ticket &&
      cached.mint === mint &&
      cached.expiresAt > at &&
      !admissionReasons(cachedToken, at).length &&
      evaluateFilters(cachedToken, filters, at).matches &&
      cachedToken.sourceUpdatedAt &&
      at - Date.parse(cachedToken.sourceUpdatedAt) <= 15000 &&
      cached.buy &&
      cached.sell &&
      at - Math.min(cached.buy.observedAt, cached.sell.observedAt) <= 15000
    )
      return { token: cachedToken, pair: cached };
    this.ingest(
      await this.get("https://api.jup.ag/tokens/v2/search?query=" + mint, 3),
    );
    const now = Date.now();
    let token = this.candidateTokens(configuration).find(
      (t) => t.mint === mint,
    );
    if (
      !token ||
      admissionReasons(token, now).length ||
      this.screeningReasons(token, now).length ||
      !evaluateFilters(token, filters, now).matches
    )
      throw new UserError("Selected source no longer meets the frozen filters");
    const pair = await checkRoutePair(mint, ticket, (url) => this.get(url, 3));
    this.cacheRoute(mint + ":" + ticket, pair);
    // Quoting is serialized with provider work. If that wait aged metadata,
    // refresh this exact source once, then check every gate again. Never widen
    // either 15-second freshness window or substitute another token.
    if (
      pair.status === "eligible" &&
      Date.now() - Date.parse(token.sourceUpdatedAt ?? "") > 15000
    ) {
      this.ingest(
        await this.get("https://api.jup.ag/tokens/v2/search?query=" + mint, 3),
      );
      token = this.candidateTokens(configuration).find((t) => t.mint === mint);
    }
    if (
      !token ||
      admissionReasons(token, Date.now()).length ||
      this.screeningReasons(token, Date.now()).length ||
      !evaluateFilters(token, filters, Date.now()).matches ||
      pair.status !== "eligible" ||
      Date.now() - Math.min(pair.buy!.observedAt, pair.sell!.observedAt) >
        15000 ||
      !token.sourceUpdatedAt ||
      Date.now() - Date.parse(token.sourceUpdatedAt) > 15000
    ) {
      const metadataAge = token?.sourceUpdatedAt
        ? Date.now() - Date.parse(token.sourceUpdatedAt)
        : Infinity;
      const quoteAge =
        pair.buy && pair.sell
          ? Date.now() - Math.min(pair.buy.observedAt, pair.sell.observedAt)
          : Infinity;
      throw new UserError(
        pair.status !== "eligible"
          ? "Selected source routes are unavailable. Retry this ticker; no replacement is chosen."
          : metadataAge > 15000
            ? `Selected source metadata is ${Math.ceil(metadataAge / 1000)}s old (15s maximum). Retry this ticker when data updates.`
            : quoteAge > 15000
              ? `Selected source quotes expired while checking (${Math.ceil(quoteAge / 1000)}s; 15s maximum). Retry the same ticker.`
              : "Selected source no longer passes its frozen filters or security checks. No buy was sent.",
      );
    }
    return { token, pair };
  }
}
