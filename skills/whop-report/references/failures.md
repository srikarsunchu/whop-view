# When it fails

What a failed read looks like in the brief and what to do. Part of the whop-report skill; `references/gate.md` has the rules.

| where | what it looks like | what it means | what to do |
|---|---|---|---|
| `kpis[].error` · `VALIDATION_ERROR` | a metric row reads an error | `stats get` needs `--from` and `--to`; wv sets them, so this is a metric the account cannot read | `wv stats list --format json` for the metrics this account has |
| `kpis[].error` · `HTTP_403` | a metric row reads 403 | the credential lacks `stats:read` | `wv doctor` names the scope; an API-key profile with it |
| `recommendations.error` · `HTTP_403` "You don't have access to Economic Intelligence yet." | the section shows the 403 | the preference is off | `wv accounts update-preferences --economic_intelligence true`, which `next` already lists |
| `doctor.failing` with `level: fail` | a blocking check | signed out, identity, or no product with a plan | the `fix` on the row; the other skills own the writes |
| `money.balances[].error` | a currency reads an error | `ledgers report` refused or the scope is missing | `wv money` for the words |
| `campaigns` empty with live campaigns in `wv gtm` | no rank rows | `ad-groups list` answered an error for that campaign | `wv gtm rank <id>` shows the error in place |
| exit 1 from `wv report` | the brief printed but a metric failed | see `kpis[].error` | the brief is still usable; say which number is missing |
| exit 2 · `NEEDS_TERMINAL` | a wv screen without a JSON face was piped | `home`, `help`, `sandbox` draw only | use `wv report`, `wv gtm --format json`, `wv doctor --format json`, `wv money --format json`, `wv store --format json`, `wv dev --format json` |

Two things are not errors: a `change` of `—` means last week was zero or unreadable, not that nothing happened; and `visits` at zero on an account with revenue is the pixel not being installed, which `gaps` names with its fix.
