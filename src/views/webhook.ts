// `webhooks test <id> --event <e>`: the test result and the newest delivery on one screen, so a person
// sees the round trip: what Whop sent, what the endpoint answered, and how long it took.
import type { Parsed, Rec } from "../envelope.ts";
import { longDate, relative } from "../format.ts";
import { footer } from "../primitives/footer.ts";
import { kv, type KvRow } from "../primitives/kv.ts";
import { teach } from "../argv.ts";
import { paint, type Theme } from "../tokens.ts";
import { copy } from "../copy.ts";
import { truncate, width } from "../ansi.ts";

export interface WebhookTestInput {
  argv: string[];
  /** The `{ status, body, success }` the test answered. */
  result: Rec;
  /** `webhooks deliveries <id> --first 1`, run right after. */
  delivery: Parsed;
  deliveryArgv: string[];
}

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

/** A response body as one line: a string as is, JSON compacted, nothing as a dash. */
export function bodyLine(body: unknown): string {
  if (body == null || body === "") return copy.detail.empty;
  if (typeof body === "string") return body.replace(/\s+/g, " ").trim() || copy.detail.empty;
  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
}

/** Rows for one delivery attempt from the API's `WebhookDelivery` shape. */
export function deliveryRows(d: Rec): KvRow[] {
  const c = copy.webhook;
  const ok = d.success === true;
  const rows: KvRow[] = [
    { key: c.event, value: str(d.event) ?? copy.detail.empty },
    { key: c.status, value: ok ? c.ok : c.failed, role: ok ? "good" : "bad" },
    { key: c.code, value: d.response_code != null ? String(d.response_code) : copy.detail.empty, role: ok ? "text" : "bad" },
    { key: c.time, value: typeof d.total_time === "number" ? c.seconds(d.total_time) : copy.detail.empty },
    { key: c.sent, value: str(d.sent_at) ? `${longDate(d.sent_at as string)} · ${relative(d.sent_at as string)}` : copy.detail.empty },
  ];
  if (str(d.replayed_from)) rows.push({ key: c.replayOf, value: d.replayed_from as string, role: "muted" });
  if (d.response_body != null) rows.push({ key: c.body, value: bodyLine(d.response_body) });
  if (str(d.id)) rows.push({ key: c.id, value: d.id as string, role: "muted" });
  return rows;
}

export function webhookTestView(input: WebhookTestInput, theme: Theme): string[] {
  const c = copy.webhook;
  const { argv, result } = input;
  const id = argv[2] ?? "";
  const at = argv.indexOf("--event");
  const event = at >= 0 ? argv[at + 1] : argv.find((a) => a.startsWith("--event="))?.slice(8);
  const ok = result.success === true;
  // Narrow terminals: the event drops before the id, and the id truncates before the title.
  const head = " " + paint(theme, "accent", c.title) + "  " + paint(theme, "muted", id);
  const withEvent = event ? head + "  " + paint(theme, "muted", event) : head;
  const out: string[] = [width(withEvent) <= theme.width - 1 ? withEvent : truncate(head, theme.width - 1), ""];
  const resultRows: KvRow[] = [
    { key: c.result, value: ok ? c.acknowledged : c.notAcknowledged, role: ok ? "good" : "bad" },
    { key: c.code, value: result.status != null ? String(result.status) : copy.detail.empty, role: ok ? "text" : "bad" },
    { key: c.body, value: bodyLine(result.body) },
  ];
  const d = input.delivery;
  const newest = d.ok && d.payload.kind === "page" ? d.payload.rows[0] : undefined;
  const deliveryRowsOut: KvRow[] = newest ? deliveryRows(newest) : d.ok ? [{ key: c.status, value: c.noDeliveries, role: "muted" }] : [{ key: c.status, value: `${d.error.code} ${d.error.message.split("\n")[0]}`, role: "warn" }];
  out.push(...kv([{ title: c.resultTitle, rows: resultRows }, { title: c.newest, rows: deliveryRowsOut }], theme));
  out.push("");
  out.push(...footer([[copy.list.json, teach(argv)], [" ".repeat(copy.list.json.length), teach(input.deliveryArgv)]], theme));
  return out;
}
