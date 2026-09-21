// A tiny stand-in for the sandbox host, for the demo tapes only. `WV_SANDBOX_URL=http://127.0.0.1:8931/api/v1`
// points the child `whop` here. It answers the two reads the sandbox-status and logs-follow tapes need:
// the account behind the key, and an app's logs that gain a line every couple of seconds so `--follow`
// has something to show. Everything else is a 404 in the API's own error shape.
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_PORT ?? 8931);
const started = Date.now();

const ACCOUNT = { id: "biz_sandboxAb12", title: "Frame (sandbox)", route: "frame-sandbox", logo_url: null };

const LINES = [
  { level: "info", source: "console", message: "booted · build abld_x1AbCdEfGh" },
  { level: "info", source: "request", message: "ok", request_method: "GET", request_path: "/", response_status: 200 },
  { level: "debug", source: "console", message: "cache miss for user_ICLAwIXM9zFfz" },
  { level: "error", source: "exception", message: "TypeError: Cannot read properties of undefined (reading 'slotId')", request_method: "GET", request_path: "/api/slots", response_status: 500 },
  { level: "warn", source: "request", message: "slow response · 2.4s", request_method: "POST", request_path: "/api/checkout", response_status: 200 },
  { level: "info", source: "request", message: "ok", request_method: "GET", request_path: "/api/slots", response_status: 200 },
  { level: "info", source: "console", message: "webhook payment.succeeded handled" },
];

/** One log line every 1.8 s since the server started, newest first, so each poll of `--follow` finds one. */
function logs(after?: string) {
  const n = Math.min(LINES.length, 1 + Math.floor((Date.now() - started) / 1800));
  const rows = LINES.slice(0, n).map((l, i) => ({
    app_id: "app_mock1",
    app_build_id: "abld_x1AbCdEfGh",
    request_id: `req_${i + 1}`,
    created_at: new Date(started + i * 1800).toISOString(),
    truncated: false,
    ...l,
  }));
  const cut = after ? Date.parse(after) : -Infinity;
  return rows.filter((r) => Date.parse(r.created_at) > cut).reverse();
}

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const json = (code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (!/^Bearer whop_/.test(req.headers.authorization ?? "")) return json(401, { error: { type: "authentication_error", message: "Authentication failed" } });
  if (url.pathname === "/api/v1/accounts/me") return json(200, ACCOUNT);
  const m = /^\/api\/v1\/apps\/([^/]+)\/logs$/.exec(url.pathname);
  if (m) return json(200, { data: logs(url.searchParams.get("created_after") ?? undefined), page_info: { start_cursor: null, end_cursor: null, has_next_page: false, has_previous_page: false } });
  return json(404, { error: { type: "invalid_request_error", message: "Resource not found" } });
}).listen(PORT, "127.0.0.1", () => console.log(`mock api on http://127.0.0.1:${PORT}/api/v1`));
