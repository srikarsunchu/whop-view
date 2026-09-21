import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface Hints {
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

const load = (name: string): Hints | undefined => {
  const file = join(dir, `${name}.json`);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Hints) : undefined;
};

/**
 * Hints for a group, or for one verb of it when `<group>.<verb>.json` exists. A verb file wins
 * whole, never merges: `payouts methods` rows share nothing with `payouts list` rows.
 */
export function hintsFor(group: string, verb?: string): Hints {
  const key = verb ? `${group}.${verb}` : group;
  const hit = cache.get(key);
  if (hit) return hit;
  const h = (verb && load(`${group}.${verb}`)) || load(group) || {};
  cache.set(key, h);
  return h;
}
