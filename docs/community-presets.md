# Community Presets and Usage Attribution

Rascals lets users and agents discover, share, and publish custom filter configurations as immutable presets. Presets are identified by a unique UUID and encoded as a deterministic Degen Code string.

## HTTP API

### List Presets
`GET /api/presets`

Query parameters:
- `sort`: `"recent"` (default), `"popular"` (weighted by adopters, reveals, and trades), `"trades"` (ranked by executed trades)
- `q`: search keyword matching preset title or creator wallet address
- `mine`: `"true"` to list only presets authored by the verified connected wallet
- `limit`: number of items to return (1..100, default 50)
- `offset`: pagination offset (default 0)

Response:
```json
{
  "presets": [
    {
      "id": "uuid",
      "title": "Low Cap Solana Runners",
      "code": "DEGEN1....",
      "creator": { "kind": "phantom", "address": "1111...1111" },
      "createdAt": "2026-11-05T12:00:00.000Z",
      "published": true,
      "usage": {
        "adoptingWallets": 5,
        "completedReveals": 24,
        "qualifiedUses": 12,
        "executedTrades": 3
      }
    }
  ],
  "total": 1,
  "rewardPolicy": "not_enabled"
}
```

### Get Single Preset
`GET /api/presets/:id`

Returns the published preset object or 404 if not found or unpublished.

### Publish Preset
`POST /api/presets`

Requires a verified wallet session cookie (`jackpot_session`).

Request body:
```json
{
  "requestId": "uuid",
  "title": "Low Cap Solana Runners",
  "code": "DEGEN1...."
}
```

Constraints:
- Title must be between 1 and 60 characters with no control characters.
- Code must decode to a valid, schema-compliant `FilterSpec`.
- Publishing is idempotent per `(creator, requestId)`.

### Unpublish Preset
`POST /api/presets/:id/unpublish`

Requires verified wallet session cookie. Only the original creator wallet can unpublish a preset. Unpublished presets are immediately removed from public listing and direct lookup.

## Attribution Model

1. **Adoption**: When a verified wallet applies a preset via `POST /api/discovery` with `presetId`, `adoptingWallets` increments once per distinct adopting wallet (excluding creator self-use).
2. **Reveals**: When a lottery roll is begun with an active preset and revealed via `POST /api/preview/reveal`, `completedReveals` increments.
3. **Qualified Daily Uses**: A wallet that reveals an attributed roll counts towards `qualifiedUses` at most once per UTC day per preset.
4. **Executed Trades**: When a trade is executed and verified on-chain (Solana buy reward claim, EVM receipt confirmation, or NEAR Intents deposit), `executedTrades` increments. Duplicate receipt claims are deduplicated by transaction signature/hash, and creator self-trades are excluded.

## Security Boundaries

- Presets contain filter rules, chain selections, and token picks. They never carry private keys, execution authority, or amount commitments.
- Modifying filter settings after loading a preset clears preset attribution, preventing altered configurations from falsely claiming authorship.
- Reward policy is `not_enabled`: usage metrics serve as verifiable adoption evidence. Any monetary incentive or creator payout requires an explicit, separate economic governance decision.
