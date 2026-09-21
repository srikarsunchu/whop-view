---
name: whop-support
description: Customer support on Whop from the terminal, through wv over the Whop CLI, so every refund, cancellation, extension, dispute response, or case reply is a plan the person approves before it runs — one customer joined on one screen from an email, license key, membership, or payment id; refunds with what was already refunded; chargebacks and inquiries with their evidence deadline; resolution-center cases and who they wait on. Use when asked to look up a customer, refund, cancel, pause, extend, or reactivate a membership, check a license, answer a dispute or chargeback, reply to a case, or when the user says ticket, refund, chargeback, dispute, evidence, license, cancel, past due, or "who is this customer" about a Whop business. Not for selling, ads, or treasury (use whop-gtm or whop-money).
---

# Whop Support

A ticket is one customer, their memberships and payments, and one action. The support groups of the Whop CLI (`memberships`, `members`, `people`, `payments`, `refunds`, `disputes`, `dispute-alerts`, `resolution-center-cases`) read and write them one at a time with no join and no deadline warning. `wv` supplies the join, the deadline, and the gate: `wv support lookup` is the customer on one screen, `wv support refund` and `wv support dispute` are the two writes that cost money as recipes, and every other write is a plan first. The rules every wv skill shares are in `references/gate.md`; read it once. This file is the map.

## Rules for support

1. **Look up before you act.** `wv support lookup <email | user_id | mem_id | license key | pay_id> --format json` resolves the key to the buyer and returns their `memberships`, `payments` (with `refunded_amount`), `disputes` narrowed to their payments, `cases`, and `actions`: the writes the screen suggests, as `wv` commands. Every write in this skill starts from an id that screen showed.
2. **A refund is money out.** `wv support refund <pay_id>` reads the payment first and refunds what is left; `--amount` makes it partial. It refuses when the payment is not `paid`, when Whop marks it not refundable, when it is already refunded in full, or when the amount is over what remains. The person types the amount back. A payment carrying a dispute alert is worth refunding before it becomes a chargeback; the plan says so.
3. **A dispute has a clock.** `evidence_due_at` is the deadline, and Whop reserves the last 24 hours before the processor's cutoff to forward the submission, so a dispute due in 30 hours is due today. `wv support dispute <dsp_id> --evidence file_x[:type] …` uploads the full set of documents and submits, as one plan; it refuses without evidence, after the window, or when evidence is locked (`submitted`, `response_window_closed`, `not_contestable`). Submitting is final. An `inquiry` is not a chargeback yet and moves no funds; a good response ends it.
4. **Evidence is the person's documents, uploaded first.** With no `--evidence` named, stop and ask which documents exist (receipts, delivery or access logs, screenshots, the terms shown at checkout); never write a document yourself and submit it as evidence, and never try `disputes update` or raw `whop` to get around the refusal. `wv files create --filename receipt.pdf` (a write, gated) uploads one the person hands you and returns a `file_` id; `--evidence file_x:document_type` names it and its type (`digital_fulfillment` by default; `product_image`, `customer_order_history`, `customer_session`, `prior_transactions`, `subscription`, `return_policy`, `shipping_policy`, `physical_fulfillment`). `upload_evidence` replaces the whole set, so name every document each time.
5. **A case waits on someone.** `resolution-center-cases` `status` is `awaiting_merchant` or `awaiting_customer`; `response_due_at` is the clock. `reply`, `request_info`, `accept` (with `--terminate_membership` when the person wants the access gone too), and `deny --message` are writes; `accept` refunds. `available_actions` on the case says which apply.
6. **Memberships change with a plan that shows the change.** `wv memberships cancel <mem_id> --cancel_at_period_end true` keeps access to period end; without it access ends now. `extend --days N` adds free days (1 to 1095). `pause` and `resume` stop and restart billing. Each shows `status  active → canceled` style rows read from the record before anything runs.
7. **Never expose more than the ticket needs.** `wv` hides phone numbers and addresses in lists and shows an email only on a detail card. Quote the id, not the person, in anything written down.
8. **Every playbook ends with reads that prove it.** A refund is done at `succeeded` on `refunds list --payment_id`, not when `payments refund` returned; a dispute is answered at `under_review` with `evidence_submitted_at` set.

## The loop

| stage | groups | what they give you |
|---|---|---|
| find | `wv support lookup`, `people list --email`, `memberships get <mem_ or license>`, `payments list --query` | the buyer from any key, with everything attached |
| read | `memberships list --user_id`, `payments list --user_id`, `refunds list --payment_id`, `disputes list --status needs_response`, `dispute-alerts list`, `resolution-center-cases list --status awaiting_merchant` | state, money, and clocks |
| act | `wv support refund`, `wv support dispute`, `memberships cancel` / `extend` / `pause` / `resume`, `resolution-center-cases reply` / `accept` / `deny` / `request_info` | one gated write per ticket |
| prove | `refunds list`, `payments get`, `disputes get`, `memberships get`, `resolution-center-cases get` | the state the ticket promised |

## Preflight

```bash
wv doctor --format json                                         # signed in, the account, an api-key profile when webhooks matter
wv disputes list --status needs_response --order evidence_due_at --direction asc --format json    # the clocks, soonest first
wv resolution-center-cases list --status awaiting_merchant --order response_due_at --direction asc --format json
```

## Playbooks

| playbook | command | reference |
|---|---|---|
| Who is this | `wv support lookup <key>` | `references/lookup.md` |
| Refund | `wv support refund <pay_id> [--amount N]` | `references/refund.md` |
| Answer a dispute | `wv support dispute <dsp_id> --evidence file_x[:type] …` | `references/dispute.md` |
| Cases and memberships | `resolution-center-cases`, `memberships` | `references/cases.md` |

## Deciding and failing

- `references/failures.md`: every refusal and error a support command returns, the recorded message, and the fix.
- `references/gate.md`: the rules every wv skill shares.
- `references/commands.md`: the generated command map for the support groups.
