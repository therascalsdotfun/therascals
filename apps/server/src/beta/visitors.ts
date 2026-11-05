import { randomBytes, createHash } from "node:crypto";
import { MarketStore } from "../market/store.ts";
import { AuthError } from "../auth/service.ts";
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export function requestCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((s) => s.trim().split("="))
      .filter((s) => s.length === 2),
  );
}
export class VisitorProfiles {
  constructor(private store: MarketStore) {}
  resolve(token?: string, beforeCreate = () => {}) {
    if (token && /^[a-f0-9]{64}$/.test(token)) {
      const id = hash(token),
        record = this.store.getRecord<{ expires: number }>("visitor:" + id);
      if (record && record.expires > Date.now())
        return { scope: "visitor:" + id, token: null };
    }
    beforeCreate();
    let active = 0;
    for (const row of this.store.records<{ id: string; expires: number }>(
      "visitor:",
    )) {
      if (row.expires <= Date.now()) {
        this.store.deleteRecord("visitor:" + row.id);
        this.store.deleteRecord("discovery:visitor:" + row.id);
      } else active++;
    }
    if (active >= 2000)
      throw new AuthError(
        "VISITOR_LIMIT",
        "The preview is busy. Please try again later.",
        503,
      );
    const next = randomBytes(32).toString("hex"),
      id = hash(next);
    this.store.putRecord("visitor:" + id, {
      id,
      expires: Date.now() + 86400000,
    });
    return { scope: "visitor:" + id, token: next };
  }
}
