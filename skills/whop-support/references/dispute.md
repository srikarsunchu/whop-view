# Answer a dispute

Part of the whop-support skill; `references/gate.md` has the rules. This playbook is one command, and it has a clock.

```bash
wv disputes list --status needs_response --order evidence_due_at --direction asc --format json   # soonest first
wv files create --filename receipt.pdf                                                           # a write; returns file_x
wv support dispute dsp_x1 --evidence file_x1:digital_fulfillment --evidence file_x2:customer_order_history --plan
wv support dispute dsp_x1 --evidence file_x1:digital_fulfillment,file_x2:customer_order_history
```

The plan reads `disputes get` first: amount, `reason` (`product_not_received`, `fraudulent`, `subscription_canceled`, `credit_not_processed`, and so on), `inquiry` (a pre-dispute inquiry moves no funds), `evidence_due_at` and the hours left, `evidence_editable` with `evidence_locked_reason` when not, the buyer, the payment, and how many documents are already uploaded. Two steps: `disputes upload_evidence <id> --documents [{id, document_type}…]`, which replaces the whole set, then `disputes submit <id>`, which is final. Blockers: the dispute could not be read, is not `needs_response`, evidence is locked, the window closed, or no `--evidence` was named. A warning under 48 hours says to submit today, since Whop reserves the last 24 hours before the processor's cutoff. `DISPUTE_BLOCKED` carries the reasons. No money moves at submit, so the prompt is a plain yes.

What to send, by reason: `product_not_received` and `not_as_described` want `digital_fulfillment` or `physical_fulfillment` (access logs, delivery) and `product_image`; `fraudulent` and `unrecognized` want `customer_session` (IP, device, login history from `people get`) and `prior_transactions`; `subscription_canceled` wants `subscription` (the terms shown at checkout) and `customer_order_history`; `credit_not_processed` wants the refund policy and any refund already issued. The `evidence` object on the dispute also takes text fields (`product_description`, `refund_policy_disclosure`, `customer_communication_attachment`) through `wv disputes update` when the CLI exposes them; check `wv agent disputes`.

Done when: `wv disputes get <dsp_id> --format json` shows `status` `under_review` and `evidence_submitted_at` set; the outcome arrives later as `won` or `lost`, weeks out. Tell the person when a dispute is under 24 hours from due (submit whatever exists now; an empty response loses by default), and when a payment shows a `dispute-alerts` row (`early_fraud_warning`, `dispute_alert`, `rapid_dispute_resolution`), since a refund before the chargeback is cheaper than losing it.
