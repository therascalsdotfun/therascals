# TheRascalsDotFun

A memecoin discovery arcade and NEAR testnet Contributor DAO. Set a screened token pool, reveal a token through Lottery, Case or Full Degen, and review a route in your own wallet. A free reveal places no trade.

## Try the deployed prototype

1. Open https://therascals.fun and try a free reveal. Review the token and market view; no deposit is needed.
2. Open https://therascals.fun/#dao in the same page. Programs shows the funded NEAR testnet review program. Reviews shows finalized job #1, its merge SHA, score, challenge outcome and paid status.
3. Inspect the deployed accounts and public transaction links in [NEAR testnet](docs/dao/testnet.md). Test tokens have no monetary value.

The DAO contract is `v2.rascals-dao-1104.testnet`. Council votes authorize an exact merged PR and beneficiary. A trusted deterministic worker scores the contribution, binds an evidence digest to the exact work, and submits the result. Challenge rules gate claims. NEAR enforces treasury reservations, contributor claims and agent service fees. The DAO uses a custom NEAR contract.

Confidential quote access and funded mainnet trading acceptance remain incomplete. Hosted OutLayer execution, NEAR AI inference, an automatic merge watcher and a protocol-token economy are not active. Do not fund an unaccepted route based on this README. The current DAO is a governed testnet prototype; connecting a wallet does not grant council membership or payout rights.

## Run locally

Requirements: Node.js 24, pnpm 10.33.0. Rust is needed for contract/worker tests, not the browser preview.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

In a second terminal:

```sh
pnpm dev:web
```

Open http://127.0.0.1:5177. Discovery reads public providers; rate limits and availability can affect the eligible pool. No production wallet key or database is included. Do not put keys into source files.

For the real-testnet DAO frontend:

```sh
pnpm dao:release
pnpm dao:serve
```

Open http://127.0.0.1:4321/dao/. It reads the deployed testnet contract. Connect an owner-controlled testnet wallet only when you intend to approve an action.

## Verify

```sh
pnpm exec vitest run --maxWorkers=4 --no-file-parallelism
pnpm build
pnpm dao:release
cargo test --workspace --locked
```



## Source map and technologies

| Location | Purpose |
| --- | --- |
| `apps/web` | React/TypeScript/Vite arcade; Three.js and cannon-es cage; wallet UI |
| `apps/server` | Fastify/TypeScript, SQLite state, market screening, wallet proof, route/receipt verification |
| `apps/dao` | Main-page-compatible NEAR testnet DAO frontend and release server |
| `packages/shared` | Shared protocol types and validation |
| `contracts` | Rust/NEAR policy and Contributor DAO contracts |
| `workers/contributor-verdict` | Deterministic review worker; native and WASI/OutLayer integration source |
| `tests` | App, auth, route, receipt, recovery and governance regressions |
| `deploy` | Docker and Compose service definitions |
| `docs/dao` | Contract API, worker integration and public testnet references |
| `public` | Product assets, fonts and third-party license notices |

Integrations include NEAR wallets (`@hot-labs/near-connect`), NEAR Intents 1Click SDK, NEAR policy/Chain Signatures source, Phantom/Solana/Jupiter, MetaMask/LI.FI and Hyperliquid. Presence of an adapter does not mean funded acceptance is complete. Third-party libraries, services, assets and licenses remain their authors' work.

## License

Project source is licensed under MIT. See [LICENSE](LICENSE). Preserve third-party license/copyright notices and comply with their separate terms.
