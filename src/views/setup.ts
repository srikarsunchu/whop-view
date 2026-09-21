// `wv setup`: the first hour as a numbered list. Every doctor check that is not green becomes a step with who
// does it: the CLI through wv (a gated write), the person in a browser (the dashboard, a DNS panel, a pixel in
// a page), or an interactive whop command that owns the terminal. Blocking checks first. Reads only; the steps
// it prints are the writes, and each is a plan when run.
import type { Rec } from "../envelope.ts";
import { copy } from "../copy.ts";
import { footer, type FooterLine } from "../primitives/footer.ts";
import { kv, type KvRow } from "../primitives/kv.ts";
import { breadcrumb } from "../primitives/rule.ts";
import { teach } from "../argv.ts";
import { paint, type Role, type Theme } from "../tokens.ts";
import { wrap } from "../ansi.ts";
import { checks, dashboardUrl, type Check, type DoctorInput } from "./doctor.ts";
import { isWrite } from "../status.ts";

export type How = "cli" | "terminal" | "browser" | "both";

export interface SetupStep {
  n: number;
  key: string;
  label: string;
  level: Check["level"];
  blocking: boolean;
  /** The doctor's detail: what is wrong, in Whop's words where it has them. */
  detail: string;
  how: How;
  /** The command to run, when the CLI does it or starts it. */
  command?: string[];
  /** Where the person goes, when a browser does it or finishes it. */
  url?: string;
  /** What to do there, in one sentence. */
  then: string;
}

/** A fix the doctor spells as `whop <write>` runs through wv here, since a write gets a plan. Reads and interactive commands stay `whop`. */
export const viaWv = (argv: string[] | undefined): string[] | undefined => (argv && argv[0] === "whop" && argv.length > 2 && isWrite(argv[1], argv[2]) ? ["wv", ...argv.slice(1)] : argv);

/** Who does what, per check. The doctor knows the fix; this knows whether a terminal can finish it. */
export function stepFor(check0: Check, accountId?: string): Omit<SetupStep, "n"> {
  const check = { ...check0, fix: viaWv(check0.fix) };
  const c = copy.setup.steps;
  const base = { key: check.key, label: check.label, level: check.level, blocking: check.blocking, detail: check.detail };
  const dash = check.dashboard ?? dashboardUrl(accountId);
  switch (check.key) {
    case "auth":
      return { ...base, how: "terminal", command: check.fix ?? ["whop", "login"], then: c.auth };
    case "identity":
      return { ...base, how: "both", command: check.fix, url: dash, then: c.identity };
    case "apikey":
      return check.fix && check.fix[0] === "wv" ? { ...base, how: "cli", command: check.fix, then: c.apikeySwitch } : { ...base, how: "both", command: check.fix, url: dash, then: c.apikeyNew };
    case "pixel":
      return { ...base, how: "both", command: ["whop", "events", "validate_pixel"], url: "https://docs.whop.com/developer/ads/pixel", then: c.pixel };
    case "page":
      return { ...base, how: "both", command: check.fix ?? ["wv", "social-accounts", "connect", "--platform", "meta_business", "--scopes", "advertise", "--redirect_url", "<url>"], then: c.page };
    case "payment":
      return { ...base, how: "browser", url: dash, then: c.payment };
    case "ei":
      return { ...base, how: "cli", command: check.fix ?? ["wv", "accounts", "update-preferences", "--economic_intelligence", "true"], then: c.ei };
    case "products":
      return { ...base, how: "cli", command: ["wv", "products", "create", "--title", "<name>"], then: c.products };
    case "webhooks":
      return { ...base, how: "cli", command: ["wv", "dev", "hook", "https://<your host>/hooks", "--plan"], then: c.webhooks };
    default:
      return { ...base, how: check.fix ? "cli" : "browser", command: check.fix, url: check.dashboard, then: check.detail };
  }
}

/** Every check that is not green, blocking first, numbered. */
export function setupSteps(input: DoctorInput): SetupStep[] {
  const list = checks(input).filter((ch) => ch.level !== "ok");
  const ordered = [...list.filter((ch) => ch.blocking), ...list.filter((ch) => !ch.blocking)];
  return ordered.map((ch, i) => ({ n: i + 1, ...stepFor(ch, input.accountId) }));
}

export function setupData(input: DoctorInput): Rec {
  const steps = setupSteps(input);
  const all = checks(input);
  return {
    ok: steps.length === 0,
    account: input.accountId || input.accountTitle ? { id: input.accountId, title: input.accountTitle } : undefined,
    mode: input.mode ?? "production",
    green: all.filter((ch) => ch.level === "ok").map((ch) => ch.key),
    steps,
    blocking: steps.filter((s) => s.blocking).length,
    commands: input.commands.map((c) => teach(c)),
  };
}

const HOW_ROLE: Record<How, Role> = { cli: "good", terminal: "accent", browser: "warn", both: "warn" };

export function setupView(input: DoctorInput, theme: Theme): string[] {
  const c = copy.setup;
  const steps = setupSteps(input);
  const all = checks(input);
  const out: string[] = [];
  out.push(...breadcrumb(theme, [[input.accountTitle ?? "", "accent"], [input.accountId ?? "", "muted"], [copy.session.mode(input.mode ?? "production"), input.mode === "sandbox" ? "good" : "warn"], [c.title, "accent"], [c.progress(all.length - steps.length, all.length), steps.length ? "muted" : "good"]]));
  out.push("");
  if (!steps.length) {
    out.push(...wrap(c.allGreen, theme.width - 1).map((l) => " " + paint(theme, "good", l)), "");
    out.push(...footer([[copy.report.title, ["wv", "report"]], [copy.gtm.title, ["wv", "gtm"]]], theme), "");
    return out;
  }
  const rows: KvRow[] = steps.map((s) => ({
    key: `${s.n}  ${s.label}`,
    value: `${s.blocking ? `${c.blocking} · ` : ""}${c.how[s.how]}`,
    role: s.blocking ? "bad" : HOW_ROLE[s.how],
    extra: [[c.why, s.detail], [c.then, s.then], ...(s.command ? [[c.run, s.command.join(" ")] as [string, string]] : []), ...(s.url ? [[c.open, s.url] as [string, string]] : [])],
  }));
  out.push(...kv([{ rows }], theme), "");
  for (const l of wrap(c.loop, theme.width - 3)) out.push("   " + paint(theme, "muted", l));
  out.push("");
  const lines: FooterLine[] = [[c.again, ["wv", "setup"]], [copy.doctor.title, ["wv", "doctor", "--format", "json"]]];
  out.push(...footer(lines, theme), "");
  return out;
}
