import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** A field's kind as the OpenAPI spec settles it, from `src/hints/_spec.json` (`pnpm spec`). */
export type SpecKind = "id" | "money" | "date" | "status" | "relation" | "plan" | "count" | "hidden";

export interface Hints {
  /** Per field, the kind the spec settles. Runtime inference consults this before its own guesses. */
  kinds?: Record<string, SpecKind>;
  primary?: string;
  status?: string;
  money?: string[];
  date?: string;
  relation?: string;
  columns?: string[];
  hidden?: string[];
  labels?: Record<string, string>;
  /** Field name whose object should render through planPrice(). */
  plan?: string;
  /** Prefer this preformatted string over a numeric money field. */
  formatted?: Record<string, string>;
}

const dir = join(import.meta.dirname, "hints");
const cache = new Map<string, Hints>();

/** The derived hints, one entry per `group verb`, keyed the way the spec maps the CLI. Missing file means none. */
let specHints: Record<string, { kinds?: Record<string, SpecKind> }> | undefined;
function derived(group: string, verb?: string): Record<string, SpecKind> | undefined {
  if (!specHints) {
    const file = join(dir, "_spec.json");
    specHints = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as typeof specHints) : {};
  }
  // The verb's own entry, else the group's list (a `get` returns the same record a `list` pages).
  return specHints?.[`${group} ${verb ?? "list"}`]?.kinds ?? specHints?.[`${group} list`]?.kinds ?? specHints?.[`${group} get`]?.kinds;
}

const load = (name: string): Hints | undefined => {
  const file = join(dir, `${name}.json`);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Hints) : undefined;
};

/**
 * Hints for a group, or for one verb of it when `<group>.<verb>.json` exists. A verb file wins
 * whole, never merges: `payouts methods` rows share nothing with `payouts list` rows. Under the hand
 * file sit the kinds the spec settles; a hand file only says what the spec cannot. `WV_NO_HINTS`
 * drops the hand files and `WV_NO_SPEC` the derived kinds, for the coverage run.
 */
export function hintsFor(group: string, verb?: string): Hints {
  const key = verb ? `${group}.${verb}` : group;
  const hit = cache.get(key);
  if (hit) return hit;
  const h = hintsWith(group, verb, { hand: !process.env.WV_NO_HINTS, spec: !process.env.WV_NO_SPEC });
  cache.set(key, h);
  return h;
}

/** The same, with each source switched on or off and no cache: what the coverage run compares. */
export function hintsWith(group: string, verb: string | undefined, use: { hand: boolean; spec: boolean }): Hints {
  const hand = use.hand ? (verb && load(`${group}.${verb}`)) || load(group) || {} : {};
  const kinds = use.spec ? derived(group, verb) : undefined;
  return kinds ? { kinds, ...hand } : hand;
}

/** Whether a hand file exists for the group or the verb. */
export function hasHandHints(group: string, verb?: string): boolean {
  return (!!verb && existsSync(join(dir, `${group}.${verb}.json`))) || existsSync(join(dir, `${group}.json`));
}
