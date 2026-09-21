# Refund

Part of the whop-support skill; `references/gate.md` has the rules. This playbook is one command.

```bash
wv support refund pay_JFHAhioMdPL1ts --plan          # the payment, what was refunded, what would be refunded now
wv support refund pay_JFHAhioMdPL1ts                 # CONFIRMATION_REQUIRED with plan and rerun, in full
wv support refund pay_JFHAhioMdPL1ts --amount 4      # partial
```

The plan reads `payments get` first: `plan.payment` carries `total` (the presentment total the buyer paid), `refunded` so far, `remaining`, `status`, the buyer, and the membership and product. `plan.amount` is the remaining amount unless `--amount` says less; `partial` is true when it does. Blockers, before any write: the payment could not be read, is not `paid`, is marked `refundable: false`, is already refunded in full, or the amount is over what remains. `REFUND_BLOCKED` carries them. A warning names an earlier partial refund or a dispute alert on the payment. The person types the amount back.

The write is `payments refund <pay_id> [--partial_amount N]`, one step with its idempotency key. `refunds create` exists in the CLI but takes no flags; the refund lives on the payment.

Done when: `wv refunds list --payment_id <pay_id> --format json` shows the refund `succeeded` (`pending` and `requires_action` are not done; `failed` carries `failure_reason`), and `wv payments get <pay_id> --format json` shows `refunded_amount` up by the amount. Tell the person the buyer sees the money in three to ten business days depending on the card, and that a refunded one-time payment does not cancel a membership by itself; `wv memberships cancel` is a separate plan.
