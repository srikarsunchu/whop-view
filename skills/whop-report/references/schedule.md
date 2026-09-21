# On a schedule

Part of the whop-report skill; `references/gate.md` has the rules. Reads only, so this can run unattended.

`wv report --md` prints the brief as Markdown and exits 0 when every metric read succeeded, 1 otherwise. It writes nothing, so it is safe in a cron job, a CI step, or a Claude scheduled task. It needs a signed-in `whop` (`whop auth status` answers), and for the recommendations section an account with Economic Intelligence on; without it that section shows the 403 and `next` carries the fix.

```bash
# every Monday 08:00 local, into a file the person reads
0 8 * * 1  cd ~/work && wv report --md > ~/briefs/$(date +%F).md 2>> ~/briefs/errors.log

# or piped to whatever posts a message; the Markdown is the body
wv report --md | <post-to-channel>
```

For a Claude scheduled task: the task's prompt is "run `wv report --md` and post the output as the message; do not run anything in its Next section". The agent that runs it has this skill, so it knows the `next` commands are plans for a person, not steps for the schedule. A schedule that started approving recommendations or pausing ad groups on its own would be a different, and worse, product.

What to watch in the output over weeks: `payoutsBlocked` flipping to `null` when identity clears; `gaps` shrinking to `[]` as setup completes; the `change` column, since a brief is only as good as the week before it. Keep the Markdown files; `stats get` covers any window, but a brief already written is the one the person read.

Done when: the brief lands on schedule with the same window each week (Monday to Sunday, UTC, the previous seven whole days), every section present, errors named in place rather than dropped, and nothing written to the account.
