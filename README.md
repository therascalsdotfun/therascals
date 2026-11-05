# TheRascalsDotFun

A memecoin discovery arcade and NEAR testnet Contributor DAO. Set a screened token pool, reveal a token through Lottery, Case or Full Degen, and review a route in your own wallet. A free reveal places no trade.

## Try the deployed prototype

1. Open https://therascals.fun and try a free reveal. Review the token and market view; no deposit is needed.
2. Open https://therascals.fun/#dao in the same page. Programs shows the funded NEAR testnet review program. Reviews shows finalized job #1, its merge SHA, score, challenge outcome and paid status.
3. Inspect the contributor/agent payout transactions in [testnet acceptance evidence](docs/dao/reward-test-2026-11-04.md). These are test tokens with no monetary value.

The DAO contract is `v2.rascals-dao-1104.testnet`. Council votes authorize an exact merged PR and beneficiary. A trusted deterministic worker scores the contribution, binds an evidence digest to the exact work, and submits the result. Challenge rules gate claims. NEAR enforces treasury reservations, contributor claims and agent service fees. This is a custom NEAR contract, not a SputnikDAO/Trezu deployment.

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

Open http://127.0.0.1:4321/dao/. It reads the deployed testnet contract. Connect an owner-controlled testnet wallet only when you intend to approve an action. The separate historical local model is not the deployed DAO and is excluded from public release bundles.

## Verify

```sh
pnpm exec vitest run --maxWorkers=4 --no-file-parallelism
pnpm build
pnpm dao:release
cargo test --workspace --locked
```

File parallelism is disabled in this example to avoid resource contention affecting the bounded physics checks. Test assertions and timeouts are unchanged.

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
| `deploy` | Docker/Compose deployment candidates; production rollout requires owner approval |
| `docs/dao` | Contract ABI, integration boundaries and sanitized testnet evidence |
| `public` | Product assets, fonts and third-party license notices |

Integrations include NEAR wallets (`@hot-labs/near-connect`), NEAR Intents 1Click SDK, NEAR policy/Chain Signatures source, Phantom/Solana/Jupiter, MetaMask/LI.FI and Hyperliquid. Presence of an adapter does not mean funded acceptance is complete. Third-party libraries, services, assets and licenses remain their authors' work.

## Hackathon provenance

The official rules allow work since the October 19, 2026 announcement. Private development history begins October 23 local time (October 22 UTC); work before the November 1 form opening is not automatically excluded. This public candidate is an exported source snapshot. It does not rewrite private Git history, and its publication commit date is not a claim that all code was authored on that day. See [source provenance](SOURCE_PROVENANCE.md).

Owner-selected tracks: Unstoppable DeFi, Agent Economy, Memecoins With Mechanics, Social Money and Open Innovation. The implemented mechanics and limits above are what judges can verify; track selection does not imply a shipped protocol token or private execution.

## License

Project source is MIT, selected by the owner. See [LICENSE](LICENSE). Preserve third-party license/copyright notices and comply with their separate terms.
