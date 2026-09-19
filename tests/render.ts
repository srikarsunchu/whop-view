// Renders every view from fixtures. Shared by snapshot tests and `pnpm demo:offline`.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnvelope } from "../src/envelope.ts";
import { hintsFor } from "../src/hints.ts";
import { makeTheme, type Theme } from "../src/tokens.ts";
import { setNow } from "../src/format.ts";
import { listView } from "../src/views/list.ts";
import { detailView } from "../src/views/detail.ts";
import { confirmView } from "../src/views/confirm.ts";
import { errorView } from "../src/views/error.ts";
import { helpView, parseHelp } from "../src/views/help.ts";
import { homeView } from "../src/views/home.ts";

export const FIXTURES = join(import.meta.dirname, "fixtures");
export const fixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");
export const envelope = (name: string) => parseEnvelope(fixture(`${name}.json`));

/** Freeze the clock one day after the newest fixture so relative times are stable. */
setNow(() => Date.parse("2026-09-19T12:00:00Z"));

export function theme(width: number, color: boolean): Theme {
  return { ...makeTheme({ width, color }), color };
}

function page(name: string, group: string, argv: string[], t: Theme, accountTitle?: string) {
  const p = envelope(name);
  if (!p.ok || p.payload.kind !== "page") throw new Error(`${name} is not a page`);
  return listView({ group, argv, rows: p.payload.rows, page: p.payload.page, hints: hintsFor(group), accountTitle }, t);
}

function record(name: string, group: string, argv: string[], t: Theme) {
  const p = envelope(name);
  if (!p.ok || !("record" in p.payload)) throw new Error(`${name} is not a record`);
  return detailView({ group, argv, record: p.payload.record, hints: hintsFor(group) }, t);
}

function error(name: string, t: Theme) {
  const p = envelope(name);
  if (p.ok) throw new Error(`${name} is not an error`);
  return errorView(p.error, t);
}

export const SCENES: Record<string, (t: Theme) => string[]> = {
  "list.products": (t) => page("products.list", "products", ["products", "list"], t, "Hypermotion"),
  "list.plans": (t) => page("plans.list", "plans", ["plans", "list"], t),
  "list.memberships": (t) => page("memberships.list", "memberships", ["memberships", "list"], t),
  "list.members": (t) => page("members.list", "members", ["members", "list"], t),
  "list.ledgers": (t) => page("ledgers.list", "ledgers", ["ledgers", "list"], t),
  "list.apps": (t) => page("apps.list", "apps", ["apps", "list"], t),
  "list.empty": (t) => page("payouts.list", "payouts", ["payouts", "list"], t),
  "detail.membership": (t) => record("memberships.get", "memberships", ["memberships", "get", "mem_kfT4Jl8Pb8DlWE"], t),
  "detail.product": (t) => record("products.get", "products", ["products", "get", "prod_iQ2Zub6GFQS5Q"], t),
  "confirm.payout": (t) =>
    confirmView(
      { group: "payouts", verb: "create", argv: ["payouts", "create", "--amount", "250", "--currency", "usd", "--payout_method_id", "potk_x1", "--speed", "standard"], hints: hintsFor("payouts"), accountTitle: "Hypermotion", accountId: "biz_VraUMckluH8dzV" },
      t,
    ),
  "confirm.delete": (t) => confirmView({ group: "products", verb: "delete", argv: ["products", "delete", "prod_DQf7IZAtveRoK"], hints: hintsFor("products"), accountTitle: "Hypermotion", accountId: "biz_VraUMckluH8dzV" }, t),
  "confirm.update": (t) => confirmView({ group: "products", verb: "update", argv: ["products", "update", "prod_DQf7IZAtveRoK", "--title", "Frame Pro", "--visibility", "hidden"], hints: hintsFor("products") }, t),
  "error.typo": (t) => error("error.typo", t),
  "error.404": (t) => error("error.404", t),
  "error.validation": (t) => error("error.validation", t),
  "error.unknown_flag": (t) => error("error.unknown_flag", t),
  "error.401": (t) => errorView({ code: "HTTP_401", message: "Unauthorized" }, t),
  "error.scope": (t) => errorView({ code: "HTTP_403", message: "Missing required permission: developer:manage_webhook" }, t),
  "error.enoent": (t) => errorView({ code: "ENOENT", message: "spawn whop ENOENT" }, t),
  help: (t) => helpView(parseHelp(fixture("help.txt")), t),
  "help.products": (t) => helpView(parseHelp(fixture("help.products.txt")), t, "products"),
  home: (t) =>
    homeView(
      {
        auth: envelope("auth.status"),
        balance: envelope("ledgers.report"),
        revenue: envelope("stats.net_revenue"),
        from: "2026-09-12",
        to: "2026-09-18",
        commands: ["auth status", "ledgers report --report_type balance_summary", "stats get net_revenue --from 2026-09-12 --to 2026-09-18 --interval day"],
      },
      t,
    ),
};

if (process.argv[1] === import.meta.filename) {
  const only = process.argv[2];
  const width = Number(process.argv[3] ?? 80);
  const t = theme(width, process.env.NO_COLOR === undefined);
  for (const [name, scene] of Object.entries(SCENES)) {
    if (only && !name.startsWith(only)) continue;
    console.log(`\n${"─".repeat(width)}\n ${name} @ ${width}\n${"─".repeat(width)}`);
    console.log(scene(t).join("\n"));
  }
}
