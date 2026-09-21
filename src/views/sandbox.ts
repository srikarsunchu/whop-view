// The sandbox as a first-class mode: the screen that appears when the mode is on but no key is known, and
// `wv sandbox status`, which pings the sandbox host and says which base URL and key were used.
import type { Parsed, Rec } from "../envelope.ts";
import { callout } from "../primitives/callout.ts";
import { footer } from "../primitives/footer.ts";
import { kv, type KvRow } from "../primitives/kv.ts";
import { paint, type Theme } from "../tokens.ts";
import { wrap } from "../ansi.ts";
import { copy } from "../copy.ts";
import { maskKey } from "../config.ts";
import { errorView } from "./error.ts";
import type { Source } from "../runner.ts";

export interface SandboxStatusInput {
  url: string;
  urlSource: Source;
  key?: string;
  keySource: Source;
  /** Where the key or the config lives, for the person who wants to change it. */
  configPath: string;
  /** `accounts get me` against the sandbox host. */
  account: Parsed;
}

const record = (p: Parsed): Rec | undefined => (p.ok && "record" in p.payload ? p.payload.record : undefined);

/** The agent form of the ping: the env on the command line, the key as a placeholder, never the value. */
export function sandboxTeach(url: string, hasKey: boolean): string {
  return `WHOP_API_BASE_URL=${url}${hasKey ? " WHOP_API_KEY=<sandbox_key>" : ""} whop accounts get me --format json`;
}

export function sandboxStatusView(input: SandboxStatusInput, theme: Theme): string[] {
  const c = copy.sandbox;
  const rows: KvRow[] = [
    { key: c.host, value: `${input.url}  ${c.source(input.urlSource, input.configPath)}` },
    input.key
      ? { key: c.key, value: `${maskKey(input.key)}  ${c.source(input.keySource, input.configPath)}`, role: "good" }
      : { key: c.key, value: c.noKey, role: "warn" },
  ];
  const acct = record(input.account);
  if (acct) rows.push({ key: c.account, value: [acct.title, acct.id].filter(Boolean).join("  "), role: "good" });
  else if (!input.account.ok) rows.push({ key: c.account, value: `${input.account.error.code} ${input.account.error.message.split("\n")[0]}`, role: "bad" });
  const out: string[] = [" " + paint(theme, "accent", c.title) + "  " + paint(theme, input.account.ok ? "good" : "warn", input.account.ok ? c.reachable : c.unreachable), ""];
  out.push(...kv([{ rows }], theme));
  out.push("");
  if (!input.account.ok && !input.key) out.push(...missingKeyLines(input.configPath, theme), "");
  out.push(...footer([[copy.list.json, sandboxTeach(input.url, !!input.key)]], theme));
  return out;
}

/** The lines that explain a missing key, wrapped, for the status screen. */
function missingKeyLines(configPath: string, theme: Theme): string[] {
  const c = copy.sandbox;
  const w = theme.width - 1;
  return [...wrap(c.rejectsOauth + " " + c.whereFrom, w).map((l) => " " + l), ...wrap(c.docs, w).map((l) => " " + paint(theme, "muted", l)), ...wrap(c.saveHint(configPath), w).map((l) => " " + l)];
}

/** Sandbox mode with no key: printed before any command runs, then the save offer follows. */
export function sandboxMissingKeyView(configPath: string, theme: Theme): string[] {
  const c = copy.sandbox;
  return callout("warn", c.missingTitle, [c.rejectsOauth + " " + c.whereFrom, paint(theme, "muted", c.docs), c.saveHint(configPath)], theme, c.badge);
}

/** After a save: one green line naming the file. */
export function sandboxSavedView(configPath: string, theme: Theme): string[] {
  return [" " + paint(theme, "good", "✓") + " " + copy.sandbox.saved(configPath)];
}

export { errorView };
