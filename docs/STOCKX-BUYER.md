# StockX buyer (Shopify + Galaxus)

One worker, one lock, one Chrome at a time. Buys open Shopify lines and Galaxus units on
StockX without AI in the loop. Code: `lib/stockxBuyer/`, CLI: `scripts/stockx-buyer.ts`,
MCP: `scripts/stockx-buyer-mcp.ts`.

## Cycle

1. Rebuy sweep (every 15 min): cancelled StockX orders whose Shopify order is alive.
   Rebought only if the pair is still buyable. Sold out / over margin / excluded → skipped.
2. Shopify: Express and rebuys first, then oldest. Batches of 5 on one browser session.
3. Galaxus (direct delivery + warehouse): existing night-buyer state machine, same lock.
4. Per pair: ledger block check → GOAT watch → buy → classify → ledger + learning.

## Dedupe layers (a pair is never bought twice)

| Layer | Where |
| --- | --- |
| Ledger (`ledger.jsonl`), keyed `shopify:<lineItemId>` / `galaxus:<lineId>:<unit>` | `policy.ts` `stateBlocks` |
| `OrderMatch` by line item (cancelled matches excluded, rebuy owns them) | `shopifyQueue.ts`, `shopifyBatchBuy.ts` |
| `GalaxusStockxMatch` / `GalaxusExternalBuy` per unit | `buildNightQueue` |
| Prebuy: Gmail receipts (StockX **and GOAT**) + StockX buying list + unlinked match | `prebuyDedupe.ts` |
| In-flight marker: `attempt` with no result on restart → buying list check, then `needs_review` | `supervisor.ts` |
| Paid without order number → halt, never retry blind | `policy.ts`, night buyer |
| Single instance lock (`night-buyer.lock`), one Chrome per profile | `galaxusNightBuyer.ts` |

## GOAT watch (alert only)

Before each buy, KicksDB `/goat/products` gives the lowest ask (USD, US size). All-in estimate =
`(ask + GOAT_SHIP_USD) * GOAT_USD_CHF * (1 + GOAT_IMPORT_VAT)`. If it beats the StockX all-in by
`GOAT_MIN_SAVING_CHF` (30) and `GOAT_MIN_SAVING_PCT` (12%): Slack alert, StockX buy of that pair
pauses `GOAT_HOLD_MINUTES` (30), then resumes by itself. `buyer_hold` blocks it for good.
The buyer never buys on GOAT.

## Failure learning

Every non-bought outcome is stored with a normalised signature (`learnings.jsonl`). `PLAYBOOK` in
`learnings.ts` maps known signatures to a remedy (halt, rotate session, reload page, park for
review). Unknown signatures seen 3 times raise a Slack alert. `buyer_learnings` shows the table.

## Outcomes

`bought` `done` `held` `too_expensive` (90 min) `no_sellers` (90 min) `not_stockx` (12 h)
`needs_review` (3 h) `retry` (30 s → 15 min backoff, 6 tries) `parked` (15 min).

## Run

```bash
npx tsx scripts/stockx-buyer.ts once --dry --orders=#7661     # lane check only
npx tsx scripts/stockx-buyer.ts run --force                   # supervisor loop
npx tsx scripts/stockx-buyer.ts status | queue | report | learnings
npx tsx scripts/stockx-buyer.ts hold "#7707" "buy on GOAT"
npx tsx scripts/stockx-buyer.ts halt "why" | resume | stop
```

State lives in `.data/stockx-buyer/` (`buyer.on`, `buyer.halt`, `ledger.jsonl`, `status.json`,
`report.md`, `learnings.jsonl`). Remove `buyer.on` to stop after the current pair.

## MCP

```json
{
  "mcpServers": {
    "stockx-buyer": {
      "command": "ssh",
      "args": ["resell-vps", "docker exec -i resell-web-1 npx tsx scripts/stockx-buyer-mcp.ts"]
    }
  }
}
```

Tools: `buyer_status` `buyer_queue` `buyer_report` `buyer_learnings` `buyer_explain`
`buyer_order_links` `buyer_start` `buyer_stop` `buyer_halt` `buyer_resume` `buyer_hold`
`buyer_release` `buyer_goat_check` `buyer_run_once` `buyer_chrome_hygiene`.

## Env

`STOCKX_BUYER_SHOPIFY_SINCE` (2026-10-01) · `STOCKX_BUYER_GALAXUS_SINCE` (2026-10-22) ·
`STOCKX_BUYER_GALAXUS_UNTIL` · `STOCKX_BUYER_GALAXUS_SKIP_ORDERS` · `STOCKX_BUYER_BATCH` (5) ·
`STOCKX_BUYER_GALAXUS_PER_CYCLE` (12) · `STOCKX_BUYER_MAX_TRIES` (6) · `STOCKX_BUYER_GOAT_WATCH` (1) ·
`GOAT_USD_CHF` `GOAT_SHIP_USD` `GOAT_IMPORT_VAT` `GOAT_MIN_SAVING_CHF` `GOAT_MIN_SAVING_PCT`
`GOAT_HOLD_MINUTES` · `STOCKX_BUYER_DRY=1` · `STOCKX_BUYER_REBUY=0`.

Proxy env stays as before: `STOCKX_PROXY_PIN=1 STOCKX_BROWSER_PROXY_MODE=on_fail DISPLAY=:99`.

## Not covered yet

- GOAT checkout worker (alert only).
- Shopify margin fallback to the other lane after Review Order (margin gate fails closed).
- Alerting channel needs `STOCKX_ALERT_SLACK_WEBHOOK_URL` (or `SLACK_WEBHOOK_URL`).
