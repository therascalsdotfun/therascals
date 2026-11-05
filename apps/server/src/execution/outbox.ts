import { MarketStore } from "../market/store.ts";
import { clientMessage } from "../client-message.ts";
export interface SignedRecord {
  wire: string;
  signature: string;
  messageHash: string;
  state: "signed" | "submitted" | "unknown";
  broadcasts: number;
  lastBroadcast: number;
  error?: string;
}
export class Outbox {
  constructor(private store: MarketStore) {}
  save(
    id: string,
    binding: { wire: string; signature: string; messageHash: string },
  ) {
    const old = this.read(id);
    if (old) {
      if (
        old.wire !== binding.wire ||
        old.signature !== binding.signature ||
        old.messageHash !== binding.messageHash
      )
        throw new Error("An issued signature/message cannot be replaced");
      return old;
    }
    const row: SignedRecord = {
      ...binding,
      state: "signed",
      broadcasts: 0,
      lastBroadcast: 0,
    };
    this.store.putRecord("outbox:" + id, row);
    return row;
  }
  read(id: string): SignedRecord | null {
    return this.store.getRecord("outbox:" + id);
  }
  async relay(id: string, send: (bytes: Uint8Array) => Promise<string>) {
    const row = this.read(id);
    if (!row) throw new Error("Persist exact signed bytes before relay");
    row.broadcasts++;
    row.lastBroadcast = Date.now();
    this.store.putRecord("outbox:" + id, row);
    try {
      const signature = await send(Buffer.from(row.wire, "base64"));
      if (signature !== row.signature)
        throw new Error("RPC returned a different signature");
      row.state = "submitted";
      row.error = undefined;
    } catch (e) {
      row.state = "unknown";
      // This string lands in the player's operation panel through
      // op.error/broadcastEvidence, so only our own copy may be stored.
      row.error = clientMessage(e, "Unacknowledged broadcast", "outbox relay");
    }
    this.store.putRecord("outbox:" + id, row);
    return row;
  }
}
export interface RpcObservation {
  url: string;
  healthy: boolean;
  genesisValid: boolean;
  height: number;
  status: unknown | null;
}
export function expiryDecision(
  lastValid: number,
  observations: RpcObservation[],
): "unknown" | "expired" {
  const unique = new Map(
    observations.map((o) => [
      new URL(o.url).origin + new URL(o.url).pathname,
      o,
    ]),
  );
  const good = [...unique.values()].filter(
    (o) =>
      o.healthy && o.genesisValid && o.height > lastValid && o.status === null,
  );
  return good.length >= 2 ? "expired" : "unknown";
}
