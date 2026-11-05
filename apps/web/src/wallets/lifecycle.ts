/** Orders provider events against asynchronous permission/restore responses. */
export class WalletLifecycle {
  private generation = 0;
  private connection: number | null = null;
  private nextConnection = 0;
  private observedAddress: string | null | undefined;
  private observedChain: string | undefined;
  get connecting() {
    return this.connection !== null;
  }
  stamp() {
    return this.generation;
  }
  isCurrent(stamp: number) {
    return stamp === this.generation;
  }
  beginConnect() {
    ++this.generation;
    this.observedAddress = undefined;
    this.observedChain = undefined;
    this.connection = ++this.nextConnection;
    return this.connection;
  }
  accountChanged(address: string | null) {
    this.observedAddress = address;
    return ++this.generation;
  }
  chainChanged(chain: string) {
    this.observedChain = chain;
    return ++this.generation;
  }
  disconnect() {
    this.connection = null;
    this.observedAddress = null;
    ++this.generation;
  }
  finishConnect(id: number, address: string, chainId?: string) {
    if (this.connection !== id) return null;
    this.connection = null;
    const selected =
      this.observedAddress === undefined ? address : this.observedAddress;
    if (!selected) return null;
    return {
      address: selected,
      ...((this.observedChain ?? chainId)
        ? { chainId: this.observedChain ?? chainId }
        : {}),
    };
  }
  cancelConnect(id: number) {
    if (this.connection === id) this.disconnect();
  }
}
