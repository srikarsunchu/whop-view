# Domain

Part of the whop-dev skill; `references/gate.md` has the rules. The DNS step is the person's.

```bash
wv domains create --app_id app_x --domain app.example.com --plan    # the plan; a write when approved
wv domains get dom_x --format json                                    # dns_records to set, dns_status, certificate_status
wv domains list --app_id app_x --format json
wv domains create --app_id app_x --domain app.example.com --replace_existing true   # move it from another owner, after the TXT proof
```

`domains create` claims a bare hostname for an app (no scheme, path, port, or wildcard) and returns `dns_records`: the CNAME or A records and a TXT proof the person adds at their DNS provider. Whop checks on its own; `status` goes `pending_verification` → `provisioning` (DNS seen, certificate issuing) → `active`. `action_required` means a record is wrong or the claim is contested; `issues` says which. `verification_expires_at` is how long the claim waits for DNS. `update` changes metadata; `delete` releases the hostname.

Done when: `domains get` shows `status: active`, `dns_status` verified, `certificate_status` active, and the hostname serves the app over https. Tell the person the records to set, verbatim from `dns_records`, and that propagation can take up to a day; do not create the domain twice while waiting.
