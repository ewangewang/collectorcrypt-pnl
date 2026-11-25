# Collector Crypt PnL

Cash profit and loss for a Collector Crypt wallet. Paste a Solana address. The app reads public history only. It never asks for a wallet connection or a signature.

```bash
npm install
npm run dev
```

Open [https://collectorcrypt-pnl-curve.vercel.app/).

`npm test` checks the PnL math, Jakarta day boundaries, and chart bucketing.

## What the page shows

- Total spent, total returned, and net PnL
- Win days, loss days, best day, and worst day, in the selected timezone
- A chart with daily, weekly, or monthly bars and a cumulative line
- Range presets: 7D, 30D, 90D, and All
- A transaction table under the chart

The summary is the full history. The chart follows the range. The timezone starts at `Asia/Jakarta`. If the browser reports a different zone, it is listed in the timezone menu. Day boundaries, the table, and the chart all use the selected zone.

## Endpoints

The browser talks only to this app. The server route `GET /api/pnl?wallet=<address>` proxies two public, unauthenticated reads. Collector Crypt does not send `Access-Control-Allow-Origin` for these URLs, so the browser cannot call them directly.

### Pack history

`GET https://gacha.collectorcrypt.com/api/userStats?wallet=<address>&count=1000`

This is the same history the Collector Crypt gacha site loads. The response is:

```json
{
  "success": true,
  "data": {
    "linkedAll": [],
    "pagination": { "count": 1000, "lastId": 10952712, "hasMore": true }
  }
}
```

Follow `pagination.lastId` with `&last_id=<lastId>` until `hasMore` is false. `lastId` (camelCase) does not advance the page. `count=1000` is the page size used here.

Fields used:

| Field | Meaning |
| --- | --- |
| `spin_txn_created_at` | When the pack was opened. PnL is booked on this instant. |
| `spin_cost` | Price in whole USDC. Free spins in the sample data are already `0`. |
| `spin_free_spin` | If true, spent is `0` even when a nominal cost is present. |
| `spin_refunded` | `true` spins are excluded from totals, the chart, and the default table. |
| `spin_status` | Counted only when missing or `confirmed`. |
| `buyback_refund_amount` | Buyback in micro-USDC. Divide by `1_000_000`. |
| `buyback_webhook_confirmed` | Only a confirmed buyback is cash returned. |
| `buyback_transaction_signature` | Solscan link. If this exists without a confirmed webhook, the amount is shown as unconfirmed and left out of the total. |
| `hashlist_metadata.content.metadata` | Card name and traits. Missing names render as unavailable. |
| `memo` | Source prefix before the UUID (`slabz`, `cc`, and so on). |

### Marketplace buys and sales

`GET https://api.collectorcrypt.com/card-activity?wallet=<address>&v2=true`

This is the feed behind a public Collector Crypt profile activity tab (`card-activity?wallet=…&v2=true` in the site bundle). It returns a JSON array. There is no documented cursor. The app uses the list it gets.

A settled action is `Sale`, `Sell`, `Buy`, or an accepted offer. Direction comes from `from.wallet` and `to.wallet`:

- You are `to` and not `from`: a buy. Spent is the USDC amount, returned is `0`.
- You are `from` and not `to`: a sale. Returned is the USDC amount, spent is `0`.

USDC comes from `priceInfo.splPrice.rawAmount` and `decimals` (USDC uses 6). If that object is missing, `amount` is treated as whole USDC. A SOL price, or any non-USDC price, is unavailable and is not converted. Lists, offers that were not accepted, transfers, mints, and burns are not cash.

If this request fails, pack PnL still loads. Card buys and sales are labeled unavailable instead of `$0`.

`ccstats.knutegil.dev` exposes `GET /api/wallet-stats?wallet=…` as newline-delimited JSON. That route returns aggregates only, with no timestamps, so it cannot drive the chart or the table. It was used to cross-check pack totals.

## PnL math

Amounts are kept as integer micro-USDC (6 decimals) and displayed as US dollars.

For each counted pack:

```text
spent    = spin_free_spin ? 0 : round(spin_cost × 1_000_000)
returned = buyback_webhook_confirmed
             ? buyback_refund_amount          // already micro-USDC
             : (no amount and no signature ? 0 : unavailable)
pnl      = returned − spent                  // only when both are numbers
```

`returned = 0` means the card was kept. That is a real zero, not a missing field. Insured value is never used. An unconfirmed buyback amount is shown on the row and excluded from returned, so the total does not invent a payout.

```text
total spent    = pack spend + marketplace buys
total returned = confirmed buybacks + marketplace sales
net PnL        = total returned − total spent
```

A day is a calendar day in the selected timezone. Win days have a positive sum, loss days a negative sum, and a zero sum is flat. A day with any unavailable amount is unscored. Best and worst are the highest and lowest scored days. Ties go to the later day.

Chart buckets:

- Daily: that calendar day
- Weekly: the Monday of that week in the selected timezone
- Monthly: that calendar month

`7D`, `30D`, and `90D` are rolling windows of 7, 30, and 90 times 24 hours, ending now. `All` runs from the first dated transaction through today. A bucket with no transactions is omitted, so quiet days are not drawn as empty slots. The curve is the running sum of the buckets that remain, starting at zero for the range. Candles under the curve are each bucket’s own PnL. Transactions with an unavailable amount are counted in the summary when one side is known, and they are left off the candles.

The example address in the form is `7nB56jAXaU6qdQcDCH4MvPbztoemeZvAGpworbEHnPKW`. Totals are whatever the API returns at request time.
