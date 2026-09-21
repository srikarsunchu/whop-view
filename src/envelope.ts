// Shapes the real CLI returns with --format json --full-output.

export interface Cta {
  description?: string;
  commands?: { command: string; description?: string }[];
}

export interface FieldError {
  path: string;
  message: string;
}

export interface WhopError {
  code: string;
  message: string;
  fieldErrors?: FieldError[];
  cta?: Cta;
  durationMs?: number;
}

export interface PageInfo {
  start_cursor: string | null;
  end_cursor: string | null;
  has_next_page: boolean;
  has_previous_page: boolean;
}

export type Rec = Record<string, unknown>;

export type Payload =
  | { kind: "page"; rows: Rec[]; page: PageInfo; extra?: Rec }
  | { kind: "record"; record: Rec }
  | { kind: "series"; points: { timestamp: number; value: number }[]; currency?: string }
  | { kind: "report"; reportType: string; rows: Rec[]; total?: number }
  | { kind: "summary"; total: number; groups: Record<string, Record<string, number>> }
  | { kind: "status"; record: Rec }
  | { kind: "other"; record: Rec };

export type Parsed = { ok: true; payload: Payload; durationMs?: number } | { ok: false; error: WhopError };

const isObj = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);

const ms = (d: unknown) => (typeof d === "string" && /^\d+ms$/.test(d) ? Number(d.slice(0, -2)) : undefined);

/** Accepts both the --full-output envelope and the bare payload the CLI prints without it. */
export function parseEnvelope(text: string): Parsed {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    const first = text.trim().split("\n")[0] || "";
    if (/^\s*<(!doctype|html)/i.test(text)) return { ok: false, error: { code: "NOT_JSON", message: "Whop answered with a web page instead of JSON. The resource may not exist or the endpoint may be down." } };
    return { ok: false, error: { code: "UNKNOWN", message: first || "Empty response" } };
  }
  if (!isObj(raw)) return { ok: true, payload: { kind: "other", record: { value: raw } } };
  if (raw.ok === false && isObj(raw.error)) {
    const meta = isObj(raw.meta) ? raw.meta : {};
    return {
      ok: false,
      error: {
        code: String(raw.error.code ?? "UNKNOWN"),
        message: String(raw.error.message ?? ""),
        fieldErrors: Array.isArray(raw.error.fieldErrors) ? (raw.error.fieldErrors as FieldError[]) : undefined,
        cta: isObj(meta.cta) ? (meta.cta as Cta) : isObj(raw.cta) ? (raw.cta as Cta) : undefined,
        durationMs: ms(meta.duration),
      },
    };
  }
  if (typeof raw.code === "string" && typeof raw.message === "string" && !("data" in raw) && !("id" in raw)) {
    return { ok: false, error: { code: raw.code, message: raw.message, cta: isObj(raw.cta) ? (raw.cta as Cta) : undefined } };
  }
  const data = raw.ok === true && "data" in raw ? raw.data : raw;
  const durationMs = isObj(raw.meta) ? ms(raw.meta.duration) : undefined;
  return { ok: true, payload: classify(data), durationMs };
}

export function classify(data: unknown): Payload {
  if (!isObj(data)) return { kind: "other", record: { value: data } };
  if (Array.isArray(data.data) && isObj(data.page_info)) {
    // Siblings of the page, like `limits` on `payouts methods --include_limits`.
    const { data: _rows, page_info: _page, recommended_action: _ra, ...extra } = data;
    return { kind: "page", rows: data.data.filter(isObj), page: data.page_info as unknown as PageInfo, extra: Object.keys(extra).length ? extra : undefined };
  }
  if (isObj(data.data) && Array.isArray(data.data.points)) {
    return { kind: "series", points: data.data.points as { timestamp: number; value: number }[], currency: data.data.currency as string | undefined };
  }
  if (typeof data.report_type === "string" && Array.isArray(data.rows)) {
    return { kind: "report", reportType: data.report_type, rows: data.rows.filter(isObj), total: typeof data.total === "number" ? data.total : undefined };
  }
  if ("loggedIn" in data) return { kind: "status", record: data };
  // `disputes summary`, `resolution-center-cases summary`: a count and one bucket of counts per facet.
  if (typeof data.total === "number" && isObj(data.groups) && Object.values(data.groups).every(isObj)) {
    const groups: Record<string, Record<string, number>> = {};
    for (const [k, v] of Object.entries(data.groups as Record<string, Rec>)) groups[k] = Object.fromEntries(Object.entries(v).filter(([, n]) => typeof n === "number")) as Record<string, number>;
    return { kind: "summary", total: data.total, groups };
  }
  if (typeof data.id === "string") return { kind: "record", record: data };
  if (Array.isArray(data.data)) return { kind: "page", rows: data.data.filter(isObj), page: { start_cursor: null, end_cursor: null, has_next_page: false, has_previous_page: false } };
  return { kind: "other", record: data };
}
