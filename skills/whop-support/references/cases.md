# Cases and memberships

Part of the whop-support skill; `references/gate.md` has the rules.

## Resolution-center cases

```bash
wv resolution-center-cases list --status awaiting_merchant --order response_due_at --direction asc --format json
wv resolution-center-cases get rcc_x --format json                    # available_actions says what applies
wv resolution-center-cases reply rcc_x --message "…" --attachments '["file_x"]'
wv resolution-center-cases request_info rcc_x --message "…"
wv resolution-center-cases accept rcc_x --message "…" --terminate_membership true   # refunds; a money prompt
wv resolution-center-cases deny rcc_x --message "…"
```

A case is a customer claim inside Whop, before or instead of a chargeback; `reason` shares the disputes vocabulary. `status` names who owes a move: `awaiting_merchant` is the clock on you, `response_due_at` says how long. `accept` refunds the payment (the plan shows the money) and can end the membership; `deny` needs a `--message` the customer will read; `request_info` moves the clock to the customer. Attachments are up to three `file_` ids.

Done when: `get` shows `status` no longer `awaiting_merchant`, and on close an `outcome` (`customer_won`, `merchant_won`, `withdrawn`) with `refund` saying whether money moved. A case the customer `escalated` becomes a dispute; then `references/dispute.md` applies.

## Memberships

```bash
wv memberships get mem_x --format json                                # or a license key
wv memberships cancel mem_x --cancel_at_period_end true --reason "…"  # access to period end
wv memberships cancel mem_x                                          # access ends now
wv memberships extend mem_x --days 7
wv memberships pause mem_x
wv memberships resume mem_x
wv memberships check <license_key>                                    # valid, invalid, unknown; exit 0, 1, 2
```

Each write reads the record first and the plan shows what changes: `status  active → canceled`, `cancel_at_period_end  false → true`. `past_due` is the grace period after a failed renewal (`payments list --status open` shows the charge and `recovery_url` the link to send); `canceling` is active with cancel scheduled. `memberships check` is the license verdict a support page can call.

Done when: `memberships get` shows the status the ticket promised, and for a cancel at period end, `current_period_end` unchanged with `cancel_at_period_end: true`. Tell the person an immediate cancel does not refund; that is `wv support refund`.
