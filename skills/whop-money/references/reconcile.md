# Reconcile

Part of the whop-money skill; `references/gate.md` has the rules. Reads only.

```bash
wv ledgers list --currency usd --posted_after 2026-09-01T00:00:00Z --posted_before 2026-10-01T00:00:00Z --all   # every line, one per row
wv ledgers report --report_type income_statement --currency usd --from 2026-09-01T00:00:00Z --to 2026-10-01T00:00:00Z --group_by month --format json
wv ledgers report --report_type balance_activity --currency usd --from … --to … --group_by day --direction money_out --format json
wv ledgers breakdown --bucket withdrawals --direction money_out --currency usd --from … --to … --format json
wv payouts list --status completed --created_after 2026-09-01T00:00:00Z --all
```

What the rows carry: a ledger line has `line_type`, `amount` (in the currency's precision units, `100000000` per unit for usd), `usd_amount` in dollars, `posted_at`, `available_at` (when the funds became withdrawable; null until they do), and the `source` payment with its status, method, and card brand, plus the product, plan, and user. Use `usd_amount`, not `amount`. `available_after` and `available_before` filter by settlement date rather than posting date, which is the question a close asks.

Matching: every payout in `payouts list` should appear as a `withdrawal` line in the ledger for the same amount and day; every `payment.succeeded` webhook or `payments list` row as a payment line net of `payment_processing_*_fee` lines. `ledgers breakdown --bucket <name>` explains one bucket of the report (`payments`, `refunds`, `withdrawals`, `disputes`, `ads`, `affiliate_payouts`, `swaps`, and so on).

Done when: the income statement's net for the period equals the change in `available` plus what was paid out, within the pending amount; every payout has its withdrawal line; the export from `wv money close` opens and its row count matches `ledgers list --all | wc -l` for the same window and currency. A gap is usually a line type left out of `--line_types` (some, like `onchain_deposit`, only appear when named) or a payout that `reversed`.
