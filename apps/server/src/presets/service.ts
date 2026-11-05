import { createHash, randomUUID } from "node:crypto";
import type { WalletIdentity } from "../../../../packages/shared/src/wallet-auth.ts";
import type { FilterSpec } from "../../../../packages/shared/src/market.ts";
import type { CommunityPreset } from "../../../../packages/shared/src/community-presets.ts";
import { encodeFilterCode, decodeFilterCode } from "../../../../packages/shared/src/filter-code.ts";
import { MarketStore } from "../market/store.ts";
import { subjectFor } from "../beta/access.ts";
import { UserError } from "../client-message.ts";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export class PresetError extends UserError {
  constructor(message: string, readonly status = 400) { super(message); }
}
type StoredPreset = CommunityPreset & { owner: string; requestId: string };
type Active = { presetId: string; code: string };
type Roll = Active & { owner: string; expires: number };
const zero = () => ({ adoptingWallets: 0, completedReveals: 0, qualifiedUses: 0, executedTrades: 0 });
/** Immutable, wallet-authenticated publication. Usage is evidence, not money. */
export class CommunityPresets {
  constructor(private store: MarketStore, private now = Date.now) {}
  private wallet(user: WalletIdentity) { return hash(subjectFor(user)); }
  private record(id: string) {
    const p = this.store.getRecord<StoredPreset>("preset:version:" + id);
    if (!p) throw new PresetError("Preset not found.", 404);
    return p;
  }
  private view(p: StoredPreset): CommunityPreset {
    const {owner: _owner, requestId: _requestId, ...publicPreset} = p;
    return publicPreset;
  }
  get(id: string) {
    const p = this.record(id);
    if (!p.published) throw new PresetError("Preset not found.", 404);
    return this.view(p);
  }
  list(
    user?: WalletIdentity,
    options: boolean | {
      mine?: boolean;
      sort?: "recent" | "popular" | "trades";
      search?: string;
      limit?: number;
      offset?: number;
    } = {},
  ) {
    const opts = typeof options === "boolean" ? { mine: options } : options;
    const { mine = false, sort = "recent", search, limit = 50, offset = 0 } = opts;
    if (mine && !user) throw new PresetError("Verify your wallet to see your published presets.", 401);
    let items = this.store.records<StoredPreset>("preset:version:")
      .filter(p => mine ? p.owner === this.wallet(user!) : p.published);
    if (search && search.trim()) {
      const term = search.trim().toLowerCase();
      items = items.filter(
        p =>
          p.title.toLowerCase().includes(term) ||
          p.creator.address.toLowerCase().includes(term) ||
          p.creator.kind.toLowerCase().includes(term),
      );
    }
    if (sort === "popular") {
      items.sort((a, b) => {
        const scoreA =
          (a.usage.adoptingWallets ?? 0) * 3 +
          (a.usage.completedReveals ?? 0) +
          (a.usage.executedTrades ?? 0) * 5;
        const scoreB =
          (b.usage.adoptingWallets ?? 0) * 3 +
          (b.usage.completedReveals ?? 0) +
          (b.usage.executedTrades ?? 0) * 5;
        return scoreB - scoreA || b.createdAt.localeCompare(a.createdAt);
      });
    } else if (sort === "trades") {
      items.sort((a, b) => {
        const tradesA = a.usage.executedTrades ?? 0;
        const tradesB = b.usage.executedTrades ?? 0;
        return tradesB - tradesA || b.createdAt.localeCompare(a.createdAt);
      });
    } else {
      items.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    }
    const total = items.length;
    const paginated = items.slice(offset, offset + limit).map(p => this.view(p));
    return {
      presets: paginated,
      total,
      rewardPolicy: "not_enabled" as const,
    };
  }
  publish(user: WalletIdentity, input: {requestId: string; title: string; code: string}) {
    const owner = this.wallet(user), code = encodeFilterCode(decodeFilterCode(input.code));
    const title = input.title.trim();
    if (!title || title.length > 60 || /[\u0000-\u001f\u007f]/.test(title)) throw new PresetError("Use a preset name between 1 and 60 characters.");
    return this.store.transaction(() => {
      const retry = this.store.getRecord<{id: string}>("preset:publish:" + owner + ":" + input.requestId);
      if (retry) {
        const p = this.record(retry.id);
        if (p.code !== code || p.title !== title) throw new PresetError("This request was already used for another preset.",409);
        return this.view(p);
      }
      if (this.store.recordCount("preset:version:") >= 2000 || this.store.recordCount("preset:publish:" + owner + ":") >= 100)
        throw new PresetError("The preset publication limit has been reached.",429);
      const p: StoredPreset = {id:randomUUID(),requestId:input.requestId,owner,title,code,
        creator:{kind:user.kind,address:user.address},createdAt:new Date(this.now()).toISOString(),published:true,usage:zero()};
      this.store.putRecord("preset:version:" + p.id,p);
      this.store.putRecord("preset:publish:" + owner + ":" + input.requestId,{id:p.id});
      return this.view(p);
    });
  }
  unpublish(user: WalletIdentity,id: string) {
    return this.store.transaction(() => {
      const p=this.record(id);
      if (p.owner!==this.wallet(user)) throw new PresetError("Only the preset creator can unpublish it.",403);
      p.published=false;this.store.putRecord("preset:version:"+id,p);
      return this.view(p);
    });
  }
  validateApply(user: WalletIdentity, id: string, filters: FilterSpec) {
    const p=this.record(id);
    if (!p.published) throw new PresetError("This preset is no longer published.",409);
    if (p.code!==encodeFilterCode(filters)) throw new PresetError("These settings differ from the published preset. Load it again or apply your changes without attribution.",409);
    return p;
  }
  applied(user: WalletIdentity, id: string | undefined, filters: FilterSpec) {
    const owner=this.wallet(user), key="preset:active:"+owner;
    if (!id) {this.store.deleteRecord(key);return;}
    this.store.transaction(() => {
      const p=this.validateApply(user,id,filters);
      this.store.putRecord(key,{presetId:p.id,code:p.code});
      // A distinct wallet is not a distinct human. Creator self-use is excluded.
      if (p.owner!==owner && this.store.putRecordIfAbsent("preset:adopter:"+p.id+":"+owner,{at:this.now()})) {
        p.usage.adoptingWallets++;this.store.putRecord("preset:version:"+p.id,p);
      }
    });
  }
  begin(user: WalletIdentity, filters: FilterSpec, rollId: string) {
    const owner=this.wallet(user), active=this.store.getRecord<Active>("preset:active:"+owner);
    if (!active || active.code!==encodeFilterCode(filters)) return;
    const p=this.record(active.presetId);
    if (!p.published) return;
    this.store.sweepRecords([{prefix:"preset:roll:",ttlMs:1200000}],this.now());
    this.store.putRecordIfAbsent("preset:roll:"+rollId,{...active,owner,expires:this.now()+600000} satisfies Roll);
  }
  revealed(user: WalletIdentity,rollId: string) {
    this.store.transaction(() => {
      const owner=this.wallet(user), key="preset:roll:"+rollId;
      const roll=this.store.getRecord<Roll>(key);
      if (!roll || roll.owner!==owner || roll.expires<this.now()) return;
      const p=this.record(roll.presetId);
      // Keep attribution bound to the original roll even after settings change
      // or unpublication. Retain a consumed marker for repeated reveal requests.
      this.store.deleteRecord(key);
      this.store.putRecord("preset:roll-attribution:" + rollId, { presetId: roll.presetId, owner: roll.owner, expires: this.now() + 86400000 });
      p.usage.completedReveals++;
      const day=new Date(this.now()).toISOString().slice(0,10);
      if (p.owner!==owner && this.store.putRecordIfAbsent("preset:qualified:"+p.id+":"+owner+":"+day,{at:this.now(),rollId})) p.usage.qualifiedUses++;
      this.store.putRecord("preset:version:"+p.id,p);
    });
  }
  activeFor(user: WalletIdentity, filters?: FilterSpec): string | null {
    const owner = this.wallet(user);
    const active = this.store.getRecord<Active>("preset:active:" + owner);
    if (!active) return null;
    if (filters && active.code !== encodeFilterCode(filters)) return null;
    return active.presetId;
  }
  presetForRoll(user: WalletIdentity, rollId: string): string | null {
    const attr = this.store.getRecord<{ presetId: string; owner: string; expires: number }>("preset:roll-attribution:" + rollId);
    if (!attr || attr.owner !== this.wallet(user) || attr.expires < this.now()) return null;
    return attr.presetId;
  }
  tradeExecuted(user: WalletIdentity, presetId: string, signature: string) {
    this.store.transaction(() => {
      const owner = this.wallet(user);
      const p = this.record(presetId);
      // A distinct wallet is not a distinct human. Creator self-trade is excluded.
      if (p.owner !== owner && this.store.putRecordIfAbsent("preset:trade:" + p.id + ":" + signature, { at: this.now() })) {
        p.usage.executedTrades = (p.usage.executedTrades ?? 0) + 1;
        this.store.putRecord("preset:version:" + p.id, p);
      }
    });
  }
  tradeExecutedForRoll(user: WalletIdentity, rollId: string, signature: string) {
    const attr = this.store.getRecord<{ presetId: string; owner: string; expires: number }>("preset:roll-attribution:" + rollId);
    if (!attr || attr.owner !== this.wallet(user) || attr.expires < this.now()) return;
    this.tradeExecuted(user, attr.presetId, signature);
  }
}
