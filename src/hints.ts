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

export function hintsFor(group: string): Hints {
  const hit = cache.get(group);
  if (hit) return hit;
  const file = join(dir, `${group}.json`);
  const h: Hints = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  cache.set(group, h);
  return h;
}
