# The same code inside the whop binary

`wv` renders the Whop CLI from outside: it spawns `whop … --format json --full-output`, parses the envelope, and draws a table or a card. This note is what the same rendering is once it lives inside the binary as `--format human`, the sixth format beside `toon`, `json`, `yaml`, `md`, and `jsonl`. It is written against `whop` 0.18.2 and the spec at `https://api.whop.com/openapi.json` on 2026-09-21, and it is a design with a working proof in this repo, not a branch of the CLI: the binary is a compiled executable and its source is not published, so the proof is that every piece below already runs here with no spawn for the schema.

## What the binary already has

The whop executable embeds the OpenAPI spec: the strings in it carry every `operationId` (294) and the `x-whop-summary` and `x-whop-docs-subgroup` extensions the docs use, and `--schema` on any verb prints the operation's request options from it. What `--schema` and `--llms-full` do not print is the response schema, which is the half a renderer needs. It is in the same document.

## The pieces, and where they run today

| piece | in wv | inside the CLI |
|---|---|---|
| the kinds the spec settles per response field (`scripts/spec.ts`: `derive`, `kindOf`, `commandFor`) | run once by `pnpm spec` against the downloaded spec, written to `src/hints/_spec.json` (105 KB), read at startup | run once at build time against the embedded spec; the table is a constant next to the operation table, no file, no download |
| the sixteen inference rules on the data (`src/infer.ts`) | pure: field in, cell out | unchanged |
| column choice (`chooseColumns`) | pure: rows and hints in, columns out | unchanged |
| the hand hints for what the spec cannot say (`src/hints/*.json`: primary, columns, labels) | 49 files, 920 facts, read at startup | `x-whop-cli` annotations on the operation in the spec (`x-whop-cli-columns`, `x-whop-cli-primary`, `x-whop-cli-labels`), so the product choice lives next to the schema it is about and ships with it |
| the envelope parser (`src/envelope.ts`) | classifies a parsed body: page, record, report, series, summary, status | not needed: the binary has the typed response before it serializes |
| the primitives (`src/primitives/*`: table, kv, callout, footer) and the list, detail, error, help views | pure: data and width in, lines out | unchanged; they take a width and a color switch and nothing else |
| `--format human` | wv's own flag, stripped before the spawn, turns the pipe rule around (`ownFlags` in `src/bin.ts`) | a real value of `--format`; `human` in a TTY by default would be the product decision, `toon` stays the default on a pipe |
| the gate (a write is a plan with a signed rerun), the screens, the recipes, the MCP server | wv | out of scope for this note: the gate is a policy the CLI could adopt, the screens are products on top of it |

Two spawns disappear. Today every render is `whop <argv> --format json --full-output` plus, the first time a verb is seen, `whop <group> <verb> --schema` for the options (cached on disk). Inside the binary the response is in memory and the schema is a constant.

## What the measurement says

`docs/coverage.md` (`pnpm coverage`) renders every recorded envelope with the hand file over the derived kinds, with the derived kinds alone, and with inference alone. On 2026-09-21: the spec settles nearly every money, status, date, and plan fact the hand files used to state, and `pnpm spec --trim` removed those 130 facts from the files with the snapshots byte-identical. What the hand files still carry is column choice and labels, and one recorded list in twelve renders the same columns from the derived kinds alone. So the split is: kinds from the spec, product choices as annotations. That is the version of "global views" that survives being a feature: a new operation renders on day one from its schema, and the product choice for it is a line in the spec, reviewed with the endpoint.

## Coverage of the CLI's own commands

`pnpm spec` maps 370 commands across 84 groups from 296 paths, and 46 of the CLI's 294 commands have no derived kinds: `auth`, `apps dev|init|pull|secrets`, `skills`, `webhooks test|replay`, `permissions check`, and a handful whose 200 carries no record. Inside the binary the mapping is not a heuristic, since each command already knows its operation.
