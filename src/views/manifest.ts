// `wv agent [group]`: the manifest an agent reads before it runs a group. One Markdown page per group,
// built from `whop <group> <verb> --schema`: the flag table, whether each verb writes, moves money, or
// destroys, the gate protocol for writes, the wv spellings that apply, and the doctor checks the group
// depends on. The tier between `whop --llms` (a command list, no flags) and `--llms-full` (338 KB).
// Plain Markdown, no color, no width: it is read by a program.
import type { Rec } from "../envelope.ts";
import type { ParsedHelp } from "./help.ts";
import { copy } from "../copy.ts";
import { DESTRUCTIVE_VERBS, isWrite, MONEY_GROUPS, MONEY_READ_VERBS } from "../status.ts";
import type { HelpGroup } from "./help.ts";
import { takesDates } from "../dates.ts";

export interface VerbSchema {
  verb: string;
  desc: string;
  /** `whop <group> <verb> --schema`, or null when the verb has none (a nested command group). */
  schema: unknown | null;
}

export interface ManifestInput {
  group: string;
  /** The group's one-line description from `whop --help`. */
  desc?: string;
  verbs: VerbSchema[];
  /** `whop@0.18.2` and the API version, from the root help. */
  version?: string;
  api?: string;
}

/** Doctor checks a group's writes depend on. Keys are `Check.key` values in `doctor.ts`. */
export const PREREQS: Record<string, string[]> = {
  ads: ["pixel", "page", "payment"],
  "ad-groups": ["pixel", "page", "payment"],
  "ad-campaigns": ["pixel", "page", "payment"],
  audiences: ["pixel"],
  "social-accounts": ["page"],
  webhooks: ["apiKey"],
  payouts: ["identity"],
  cards: ["identity"],
  transfers: ["identity"],
  swaps: ["identity"],
  "economic-intelligence": ["ei"],
};

export type Marker = "read" | "write" | "money" | "destructive";

/** Every marker that applies to a verb. A money verb is also a write; a destructive one is both. */
export function markers(group: string, verb: string): Marker[] {
  const out: Marker[] = [];
  if (!isWrite(group, verb)) return ["read"];
  out.push("write");
  if (MONEY_GROUPS.has(group) && !MONEY_READ_VERBS.has(verb)) out.push("money");
  if (DESTRUCTIVE_VERBS.has(verb)) out.push("destructive");
  return out;
}

interface Prop {
  description?: string;
  type?: string | string[];
  anyOf?: { type?: string | string[] }[];
  example?: unknown;
  enum?: unknown[];
  default?: unknown;
}

interface SchemaPart {
  properties?: Record<string, Prop>;
  required?: string[];
}

const isObj = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);
const part = (schema: unknown, key: "options" | "args"): SchemaPart | undefined => (isObj(schema) && isObj(schema[key]) ? (schema[key] as SchemaPart) : undefined);

/** `string`, `string | null`, `object`. Whop spells nullable as `anyOf`. */
export function typeOf(p: Prop): string {
  const types = new Set<string>();
  const add = (t?: string | string[]) => (Array.isArray(t) ? t.forEach((x) => types.add(x)) : t && types.add(t));
  add(p.type);
  for (const a of p.anyOf ?? []) add(a.type);
  return types.size ? [...types].join(" | ") : "unknown";
}

/** One table cell: one line, pipes escaped, backticks kept. */
const cell = (s: string) => s.replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|").trim();

const list = (v: unknown[]) => v.map((x) => `\`${String(x)}\``).join(", ");

/** Whether any flag takes an object or an array, so the wv spellings paragraph applies. */
export function takesJson(schema: unknown): boolean {
  const props = part(schema, "options")?.properties ?? {};
  return Object.values(props).some((p) => /\b(object|array)\b/.test(typeOf(p)));
}

function flagTable(schema: unknown): string[] {
  const opts = part(schema, "options");
  const props = opts?.properties ?? {};
  const names = Object.keys(props);
  if (!names.length) return [copy.manifest.noFlags];
  const required = new Set(opts?.required ?? []);
  const out = [`| ${copy.manifest.cols.join(" | ")} |`, `|${copy.manifest.cols.map(() => "---").join("|")}|`];
  for (const name of names) {
    const p = props[name];
    const extra: string[] = [];
    if (p.enum?.length) extra.push(copy.manifest.oneOf(list(p.enum)));
    if (p.default !== undefined) extra.push(copy.manifest.defaultIs(JSON.stringify(p.default)));
    if (p.example !== undefined && !p.enum) extra.push(copy.manifest.example(typeof p.example === "string" ? p.example : JSON.stringify(p.example)));
    const desc = [p.description ?? "", ...extra].filter(Boolean).join(" ");
    out.push(`| \`--${name}\` | ${typeOf(p)} | ${required.has(name) ? copy.manifest.yes : copy.manifest.no} | ${cell(desc)} |`);
  }
  return out;
}

function argsLine(schema: unknown): string | undefined {
  const args = part(schema, "args");
  const props = args?.properties ?? {};
  const names = Object.keys(props);
  if (!names.length) return undefined;
  const required = new Set(args?.required ?? []);
  return copy.manifest.args(names.map((n) => `${required.has(n) ? `<${n}>` : `[${n}]`}${props[n].description ? ` ${cell(props[n].description ?? "")}` : ""}`).join("; "));
}

/** The gate protocol, once per page. Every write in the group follows it. */
export function protocol(group: string): string[] {
  return copy.manifest.protocol(group);
}

export function manifest(input: ManifestInput): string[] {
  const { group } = input;
  const c = copy.manifest;
  const out: string[] = [`# wv agent ${group}`, ""];
  if (input.desc) out.push(input.desc, "");
  out.push(c.generated([input.version, input.api ? `API ${input.api}` : ""].filter(Boolean).join(" · "), group), "");
  const writes = input.verbs.filter((v) => isWrite(group, v.verb));
  if (writes.length) out.push(...protocol(group), "");
  const prereqs = PREREQS[group];
  if (prereqs?.length) out.push(c.prereqs(prereqs.map((k) => `\`${k}\` (${(copy.doctor.labels as Record<string, string>)[k] ?? k})`).join(", ")), "");
  if (input.verbs.some((v) => takesJson(v.schema))) out.push(...c.jsonSpellings, "");
  if (input.verbs.some((v) => takesDates([group, v.verb]))) out.push(c.datePresets, "");

  out.push(`## ${c.commands}`, "");
  out.push(`| ${c.indexCols.join(" | ")} |`, `|${c.indexCols.map(() => "---").join("|")}|`);
  for (const v of input.verbs) out.push(`| \`whop ${group} ${v.verb}\` | ${markers(group, v.verb).join(", ")} | ${cell(v.desc)} |`);
  out.push("");

  for (const v of input.verbs) {
    const m = markers(group, v.verb);
    out.push(`## ${group} ${v.verb} · ${m.join(" · ")}`, "");
    if (v.desc) out.push(v.desc, "");
    if (v.schema === null) {
      out.push(c.noSchema(group, v.verb), "");
      continue;
    }
    const args = argsLine(v.schema);
    if (args) out.push(args, "");
    out.push(...flagTable(v.schema), "");
    const notes: string[] = [];
    if (m.includes("write")) notes.push(c.gated(m.includes("money")));
    if (takesDates([group, v.verb])) notes.push(c.datePresetsShort);
    if (takesJson(v.schema)) notes.push(c.jsonShort);
    for (const n of notes) out.push(`> ${n}`);
    if (notes.length) out.push("");
  }
  return out;
}

/** A group's verbs from its help, for the index. */
export type VerbsByGroup = Record<string, HelpGroup["entries"]>;

/**
 * `wv agent` with no group: every group by section, with the protocol once. With `verbs`, every verb and its
 * kind under each group, so one page carries the whole write map in a few KB and a skill can preload it.
 */
export function manifestIndex(root: ParsedHelp, version?: string, verbs?: VerbsByGroup): string[] {
  const c = copy.manifest;
  const out: string[] = ["# wv agent", ""];
  out.push(c.indexIntro([version, root.api ? `API ${root.api}` : ""].filter(Boolean).join(" · ")), "");
  out.push(...c.protocol(), "");
  for (const g of root.groups) {
    out.push(`## ${g.title.toLowerCase()}`, "");
    for (const e of g.entries) {
      out.push(`- \`wv agent ${e.name}\` · ${cell(e.desc)}`);
      for (const v of verbs?.[e.name] ?? []) out.push(`  - \`whop ${e.name} ${v.name}\` · ${markers(e.name, v.name).join(", ")} · ${cell(v.desc)}`);
    }
    out.push("");
  }
  return out;
}

/** One verb as data: kind, required flags, arguments, and the schema's flags as whop wrote them. */
function verbData(group: string, v: VerbSchema): Rec {
  const opts = part(v.schema, "options");
  const args = part(v.schema, "args");
  return {
    verb: v.verb,
    description: v.desc,
    kind: markers(group, v.verb),
    gated: isWrite(group, v.verb),
    required: opts?.required ?? [],
    args: args?.properties ? Object.entries(args.properties).map(([name, p]) => ({ name, required: (args.required ?? []).includes(name), description: p.description })) : [],
    flags: opts?.properties ? Object.fromEntries(Object.entries(opts.properties).map(([name, p]) => [name, { type: typeOf(p), required: (opts.required ?? []).includes(name), description: p.description, enum: p.enum, default: p.default, example: p.example }])) : v.schema === null ? undefined : {},
    takesJson: takesJson(v.schema),
    datePresets: !!takesDates([group, v.verb]),
    schema: v.schema === null ? undefined : v.schema,
  };
}

/** `wv agent <group> --format json`: the page as data, schema included. */
export function manifestData(input: ManifestInput): Rec {
  const { group } = input;
  return {
    group,
    description: input.desc,
    version: input.version,
    api: input.api,
    prerequisites: PREREQS[group] ?? [],
    protocol: { plan: `wv ${group} <verb> … --plan`, confirm: "CONFIRMATION_REQUIRED", rerun: "--approve <token>", refusals: ["WHOP_LIMIT", "WV_CAP", "INSUFFICIENT_BALANCE", "WV_AD_CAP"] },
    verbs: input.verbs.map((v) => verbData(group, v)),
  };
}

/** `wv agent --format json`: every group, its section, and its verbs with their kind. No schemas: that is one group's page. */
export function manifestIndexData(root: ParsedHelp, version?: string, verbs?: VerbsByGroup): Rec {
  return {
    version,
    api: root.api,
    groups: root.groups.flatMap((g) =>
      g.entries.map((e) => ({
        group: e.name,
        section: g.title.toLowerCase(),
        description: e.desc,
        prerequisites: PREREQS[e.name] ?? [],
        verbs: (verbs?.[e.name] ?? []).map((v) => ({ verb: v.name, description: v.desc, kind: markers(e.name, v.name), gated: isWrite(e.name, v.name) })),
      })),
    ),
  };
}
