// A recipe is a playbook as one plan: writes in order, each with its own idempotency key from one base, later
// steps fed by earlier results through `{step.field}` placeholders. One approval covers the sequence; the pipe
// gets one envelope and one rerun. `launch.ts` and `winback.ts` build plans; this file draws and serializes
// them and fills the placeholders. Pure: bin.ts gathers, runs, and prints.
import type { Rec } from "../envelope.ts";
import { copy, type Mode } from "../copy.ts";
import { callout } from "../primitives/callout.ts";
import { footer, type FooterLine } from "../primitives/footer.ts";
import { kv, type KvRow, type KvSection } from "../primitives/kv.ts";
import { paint, type Role, type Theme } from "../tokens.ts";
import { truncate, wrap } from "../ansi.ts";
import { shellJoin } from "../argv.ts";

export interface RecipeStep {
  key: string;
  /** The row label on the card: `promo code`, `checkout link`. */
  label: string;
  /** What the step makes, in words. */
  what: string;
  group: string;
  verb: string;
  /** The whop argv, with `{step.field}` placeholders for results of earlier steps. */
  argv: string[];
  /** Why this step will not run. The plan lists it anyway so the person sees what is missing. */
  skipped?: string;
}

export interface RecipeRow {
  key: string;
  value: string;
  role?: Role;
}

export interface RecipePlan {
  /** `launch`, `winback`: the `wv gtm <name>` verb. */
  name: string;
  title: string;
  /** The wv argv that made this plan, key base included. */
  argv: string[];
  mode: Mode;
  account?: { id?: string; title?: string };
  /** Summary rows above the steps. */
  summary: RecipeRow[];
  steps: RecipeStep[];
  /** Reasons the recipe will not run at all. Empty means approvable. */
  blockers: string[];
  warnings: string[];
  /** The daily amount the person types back to approve, when the recipe spends. */
  typedAmount?: { amount: number; currency: string };
  /** Anything else the pipe should carry in `plan`. */
  data?: Rec;
  /** "Done when": the reads that prove it, given what the run made. */
  done: (results: Partial<Record<string, Rec>>) => { label: string; argv: string[] }[];
}

/** The base every step key derives from. A rerun carries it, so a retry of an approved recipe writes nothing twice. */
export const stepKey = (base: string, step: string) => `${base}-${step}`;

/** Fills `{step.field}` from earlier results. An unresolved reference stays as written, so the failure is visible. */
export function substitute(argv: string[], results: Partial<Record<string, Rec>>): string[] {
  return argv.map((a) =>
    a.replace(/\{([a-z_]+)\.([a-z_]+)\}/g, (whole, step: string, field: string) => {
      const v = results[step]?.[field];
      return v === undefined || v === null ? whole : String(v);
    }),
  );
}

const commandLine = (argv: string[]) => shellJoin(["whop", ...argv]);

/** The plan as data, for the pipe. */
export function recipeData(plan: RecipePlan): Rec {
  return {
    kind: plan.name,
    command: shellJoin(["wv", ...plan.argv]),
    mode: plan.mode,
    account: plan.account,
    steps: plan.steps.map((s) => ({ key: s.key, label: s.label, what: s.what, command: commandLine(s.argv), argv: s.argv, skipped: s.skipped })),
    blockers: plan.blockers,
    warnings: plan.warnings,
    typedAmount: plan.typedAmount,
    ...(plan.data ?? {}),
  };
}

export interface RecipeViewOptions {
  planOnly?: boolean;
}

export function recipeView(plan: RecipePlan, theme: Theme, opts: RecipeViewOptions = {}): string[] {
  const c = copy.recipe;
  const blocked = plan.blockers.length > 0;
  const role: Role = opts.planOnly ? "accent" : blocked ? "bad" : "warn";
  const tag = opts.planOnly ? copy.adplan.planBadge : blocked ? c.blocked : copy.confirm.badge(plan.mode);
  const out = callout(role, plan.title, [paint(theme, "mono", shellJoin(["wv", ...plan.argv]))], theme, tag);
  out.push("");
  // One line per command: an ad group's JSON would wrap into a wall. `--plan` in a pipe carries every argv in full.
  const keyWidth = Math.max(...plan.steps.map((s, i) => `${i + 1}  ${s.label}`.length));
  const commandWidth = Math.max(20, theme.width - keyWidth - 14);
  const stepRows: KvRow[] = plan.steps.map((s, i) => ({
    key: `${i + 1}  ${s.label}`,
    value: s.skipped ? `${s.what}  ${paint(theme, "muted", `${c.skipped} · ${s.skipped}`)}` : s.what,
    role: s.skipped ? "muted" : "text",
    extra: s.skipped ? undefined : [[c.runs, truncate(commandLine(s.argv), commandWidth)]],
  }));
  const summary: KvRow[] = plan.summary.map((r) => ({ key: r.key, value: r.value, role: r.role }));
  if (plan.account) summary.push({ key: copy.confirm.from, value: `${plan.account.title ?? ""}  ${plan.account.id ?? ""}`.trim() });
  const sections: KvSection[] = [{ rows: summary }, { title: c.steps, rows: stepRows }];
  out.push(...kv(sections, theme));
  out.push("");
  for (const b of plan.blockers) for (const l of wrap(`${c.blockerMark} ${b}`, theme.width - 3)) out.push("   " + paint(theme, "bad", l));
  for (const w of plan.warnings) for (const l of wrap(`${c.warnMark} ${w}`, theme.width - 3)) out.push("   " + paint(theme, "warn", l));
  if (plan.blockers.length || plan.warnings.length) out.push("");
  const note = plan.mode === "sandbox" ? copy.confirm.sandboxWarning : c.warning(plan.steps.filter((s) => !s.skipped).length);
  for (const l of wrap(note, theme.width - 3)) out.push("   " + paint(theme, "muted", l));
  out.push("");
  const lines: FooterLine[] = [[c.fullArgv, ["wv", ...plan.argv, "--plan", "|", "cat"]]];
  if (blocked) lines.unshift([copy.doctor.fix, ["wv", "doctor"]]);
  out.push(...footer(lines, theme), "");
  return out;
}

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

/** After the run: what each step made, or where it stopped, and the checks that say the recipe landed. */
export function recipeDoneView(plan: RecipePlan, results: Partial<Record<string, Rec>>, failed: { step: string; message: string } | undefined, theme: Theme): string[] {
  const c = copy.recipe;
  const rows: KvRow[] = [];
  for (const s of plan.steps) {
    if (s.skipped) continue;
    const r = results[s.key];
    if (r) rows.push({ key: s.label, value: [str(r.code) ?? str(r.name) ?? str(r.title) ?? "", str(r.id) ?? "", str(r.status) ?? str(r.purchase_url) ?? ""].filter(Boolean).join("  "), role: "good" });
    else if (failed?.step === s.key) rows.push({ key: s.label, value: `${c.failed} · ${failed.message}`, role: "bad" });
    else rows.push({ key: s.label, value: c.notRun, role: "muted" });
  }
  const out = callout(failed ? "bad" : "good", failed ? c.stopped : c.done(plan.name), [], theme);
  out.push(...kv([{ rows }], theme));
  out.push("");
  if (failed) {
    for (const l of wrap(c.resume, theme.width - 3)) out.push("   " + paint(theme, "muted", l));
    out.push("");
  }
  out.push(...footer(plan.done(results).map((l) => [l.label, l.argv] as FooterLine), theme), "");
  return out;
}
