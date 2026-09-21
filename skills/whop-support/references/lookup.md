# Who is this

Part of the whop-support skill; `references/gate.md` has the rules. Reads only.

```bash
wv support lookup ada@example.com --format json
wv support lookup mem_kfT4Jl8Pb8DlWE        # a membership id or a software license key
wv support lookup pay_JFHAhioMdPL1ts        # a payment id
```

The key is classified by shape: an email goes through `people list --email` and, failing that, `payments list --query`; `user_`, `mem_`, `pay_`, `mber_`, and `prsn_` ids go through their `get`; anything else is tried as a license key on `memberships get`. Once the buyer resolves, five reads run at once: `memberships list --user_id`, `payments list --user_id --first 10`, `disputes list` (narrowed to the buyer's payments, since disputes have no user filter), `resolution-center-cases list --user_id`, and `members list --user_ids`.

`--format json` is the screen as data: `user` (id, name, username, email), `person` (ltv, purchase_count, first and last seen, sources), `member` (joined, last access), the four lists, and `actions`: the `wv` commands the screen suggests, always from ids it found: `wv support refund <latest refundable paid payment>`, `wv memberships extend <active mem> --days 7`, `wv memberships cancel <active mem> --cancel_at_period_end true`, `wv support dispute <needs_response dsp> --evidence <file_id>`, `wv resolution-center-cases reply <awaiting_merchant case> --message <text>`. `ok: false` with no `user` means nothing matched; try another key.

Done when the person on the screen is the person on the ticket: the email matches, or the membership id does. Then act with one of `actions`, never with an id typed from memory.
