import type { TokenRisk } from "../../../../packages/shared/src/token-security.ts";
import { validMint } from "./gecko.ts";
import { RequestScheduler } from "../routes/eligibility.ts";
import { clientMessage, UserError } from "../client-message.ts";
const PROGRAMS = new Set([
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
]);
export function parseRiskReport(
  raw: unknown,
  mint: string,
  now: number,
): TokenRisk {
  const r = raw as any,
    at = Date.parse(r?.detectedAt);
  if (
    !r ||
    r.mint !== mint ||
    !PROGRAMS.has(r.tokenProgram) ||
    typeof r.rugged !== "boolean" ||
    !Array.isArray(r.risks) ||
    r.risks.length > 100 ||
    !Number.isFinite(at) ||
    at > now + 60000 ||
    !r.token ||
    !Object.hasOwn(r.token, "mintAuthority") ||
    !Object.hasOwn(r.token, "freezeAuthority")
  )
    throw Error("Incomplete or mismatched RugCheck report");
  const risks = r.risks.map((risk: any) => {
    if (
      !risk ||
      typeof risk.name !== "string" ||
      typeof risk.level !== "string" ||
      !["info", "warn", "danger"].includes(risk.level) ||
      typeof risk.description !== "string"
    )
      throw Error("Invalid RugCheck risk");
    return {
      name: risk.name.slice(0, 160),
      level: risk.level,
      description: risk.description.slice(0, 500),
    };
  });
  for (const field of ["mintAuthority", "freezeAuthority"]) {
    const value = r.token[field];
    if (value !== null && (typeof value !== "string" || !validMint(value)))
      throw Error("Invalid authority evidence");
    if (value !== null)
      risks.push({
        name:
          field === "mintAuthority"
            ? "Mint authority active"
            : "Freeze authority active",
        level: "danger",
        description: "Reported by RugCheck token inspection.",
      });
  }
  if (r.rugged)
    risks.push({
      name: "Reported rugged",
      level: "danger",
      description: "RugCheck reports a rugged token.",
    });
  return {
    mint,
    source: "RugCheck",
    // RugCheck's detectedAt describes token launch/detection, not when a
    // report was generated. Only our successful receipt time can expire a
    // fetched check; this does not attest a fresh provider-side rescan.
    status: risks.length ? "flagged" : "checked",
    checkedAt: new Date(now).toISOString(),
    reportAt: new Date(at).toISOString(),
    score:
      typeof r.score_normalised === "number" &&
      Number.isFinite(r.score_normalised)
        ? r.score_normalised
        : null,
    risks,
  };
}
export function riskReasons(r: TokenRisk | undefined, now: number): string[] {
  if (!r) return ["security_pending"];
  if (r.status === "unavailable") return ["security_unavailable"];
  if (
    r.status === "stale" ||
    !Number.isFinite(Date.parse(r.checkedAt)) ||
    Date.parse(r.checkedAt) > now + 60000 ||
    now - Date.parse(r.checkedAt) > 300000
  )
    return ["security_stale"];
  return r.status === "checked" && !r.risks.length ? [] : ["security_flagged"];
}
export class RiskData {
  private cache = new Map<string, TokenRisk>();
  private flights = new Map<string, Promise<TokenRisk>>();
  private scheduler: RequestScheduler;
  private backoff = 0;
  constructor(
    private fetcher: typeof fetch = fetch,
    interval = 2000,
    private now = () => Date.now(),
  ) {
    this.scheduler = new RequestScheduler(interval);
  }
  peek(mint: string): TokenRisk | undefined {
    return this.cache.get(mint);
  }
  readCache() {
    return Object.fromEntries(this.cache);
  }
  private unavailable(mint: string, message: string): TokenRisk {
    const result: TokenRisk = {
      mint,
      source: "RugCheck",
      status: "unavailable",
      checkedAt: new Date(this.now()).toISOString(),
      reportAt: null,
      score: null,
      risks: [],
      error: message,
    };
    this.cache.set(mint, result);
    return result;
  }
  private bounded(task: Promise<TokenRisk>, mint: string): Promise<TokenRisk> {
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<TokenRisk>((resolve) => {
      timer = setTimeout(
        () =>
          resolve(
            this.unavailable(mint, "RugCheck queue or request timed out"),
          ),
        20000,
      );
    });
    return Promise.race([task, deadline]).finally(() => clearTimeout(timer));
  }
  async scan(mint: string, maxAge = 300000, priority = 0): Promise<TokenRisk> {
    if (!validMint(mint)) throw Error("Invalid Solana mint");
    const cached = this.cache.get(mint),
      at = this.now();
    if (
      cached &&
      at - Date.parse(cached.checkedAt) <
        (cached.status === "unavailable" ? 30000 : maxAge)
    )
      return cached;
    const prior = this.flights.get(mint);
    if (prior) return this.bounded(prior, mint);
    const task = this.scheduler
      .run(async () => {
        try {
          if (this.now() < this.backoff)
            throw new UserError("RugCheck cooling down after rate limit");
          const response = await this.fetcher(
            `https://api.rugcheck.xyz/v1/tokens/${mint}/report`,
            {
              headers: { accept: "application/json" },
              signal: AbortSignal.timeout(12000),
              redirect: "error",
            },
          );
          if (!response.ok) {
            if (response.status === 429) this.backoff = this.now() + 60000;
            throw Error(`RugCheck HTTP ${response.status}`);
          }
          if (!response.body) throw Error("Empty RugCheck response");
          const reader = response.body.getReader(),
            chunks: Uint8Array[] = [];
          let size = 0;
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              size += value.byteLength;
              if (size > 2_000_000) {
                await reader.cancel();
                throw new UserError("RugCheck report too large");
              }
              chunks.push(value);
            }
          } finally {
            reader.releaseLock();
          }
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
          }
          const body = new TextDecoder().decode(bytes);
          const result = parseRiskReport(JSON.parse(body), mint, this.now());
          this.cache.set(mint, result);
          return result;
        } catch (e) {
          const result: TokenRisk = {
            mint,
            source: "RugCheck",
            status: "unavailable",
            checkedAt: new Date(this.now()).toISOString(),
            reportAt: null,
            score: null,
            risks: [],
            error: clientMessage(
              e,
              "Risk provider unavailable.",
              "risk report",
            ),
          };
          this.cache.set(mint, result);
          return result;
        }
      }, priority)
      .catch((e) =>
        this.unavailable(
          mint,
          clientMessage(e, "Risk queue unavailable.", "risk queue"),
        ),
      )
      .finally(() => {
        this.flights.delete(mint);
        while (this.cache.size > 500)
          this.cache.delete(this.cache.keys().next().value!);
      });
    this.flights.set(mint, task);
    return this.bounded(task, mint);
  }
}
