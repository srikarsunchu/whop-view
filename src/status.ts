// STATUS_COLOR ported from whop-desktop src/components/UserCell.tsx, mapped onto roles.
import type { Role } from "./tokens.ts";

const STATUS_COLOR: Record<string, "green" | "gray" | "red" | "amber" | "blue"> = {
  active: "green",
  joined: "green",
  paid: "green",
  live: "green",
  visible: "green",
  completed: "green",
  succeeded: "green",
  trialing: "blue",
  pending: "amber",
  preview: "amber",
  past_due: "amber",
  canceling: "amber",
  needs_response: "red",
  paused: "gray",
  canceled: "gray",
  expired: "gray",
  hidden: "gray",
  failed: "red",
};

const TO_ROLE: Record<string, Role> = { green: "good", amber: "warn", red: "bad", blue: "accent", gray: "muted" };

export function statusRole(status: string): Role {
  return TO_ROLE[STATUS_COLOR[status] ?? ""] ?? "text";
}

export const statusLabel = (status: string) => status.replace(/_/g, " ");

/**
 * Write verbs from whop-desktop src/views/Terminal.tsx, plus the CLI's own extra verbs, plus every verb
 * `whop --llms-full` tags "Confirm with the user before executing this destructive command" that changes
 * state (checked 2026-09-21 against 0.18.2: 149 tagged commands, 40 of them missing here before). Left out on
 * purpose, tagged by whop but compute-only: `estimate_reach`, `validate_pixel`, `calculate_tax`, `quotes`,
 * `quote`, `passkey-challenge`, and `webhooks test`, which the webhook round-trip view runs unprompted.
 */
export const WRITE_VERBS = new Set([
  "create", "delete", "update", "cancel", "pause", "unpause", "resume", "transfer", "deploy", "publish", "unpublish",
  "replay", "extend", "invite", "logout", "switch", "mark_read", "form_company", "transfer_ownership", "duplicate",
  "retry_payment", "return_url", "update-preferences", "promote", "init", "pull", "send",
  "suspend", "permissions", "add_people", "submit", "upload_evidence", "activate", "deactivate", "end", "complete",
  "resync_access", "verify", "replace", "capture", "refund", "retry", "void", "accept", "appeal", "deny", "reply",
  "request_info", "withdraw", "connect", "authorize-app", "delete-passkey", "register-passkey",
  "set-notification-preferences", "deliveries-replay", "generate",
]);

/** Every verb under these groups moves money. */
export const MONEY_GROUPS = new Set(["payouts", "swaps", "transfers", "cards", "deposits"]);

/** Reads under a money group. `cards transactions` looks at spend; it moves nothing. */
export const MONEY_READ_VERBS = new Set(["list", "get", "methods", "transactions", "get-transaction", "recipients", "quote", "quotes", "status", "supported-methods"]);

export const DESTRUCTIVE_VERBS = new Set(["delete", "cancel", "transfer_ownership"]);

/**
 * Tagged by whop as needing confirmation, but they only compute: an estimate, a check, a tax figure, a quote,
 * a challenge, a test event. Gating them would break the ads plan, which runs `estimate_reach` itself.
 */
export const COMPUTE_ONLY = new Set(["ad-groups estimate_reach", "events validate_pixel", "plans calculate_tax", "payouts quotes", "swaps quote", "users passkey-challenge", "webhooks test", "apps builds"]);

/** `whop --llms-full` marks every command that is not a plain read with this line. */
const CONFIRM_TAG = "Confirm with the user before executing this destructive command";

/**
 * The commands `whop --llms-full` tags for confirmation, as `group verb`. This is whop's own write list,
 * so a verb that ships tomorrow is gated tomorrow. Pure: the runner fetches and caches the text.
 */
export function taggedWrites(llmsFull: string): Set<string> {
  const out = new Set<string>();
  for (const section of llmsFull.split(/^### whop /m).slice(1)) {
    const [group, verb] = section.split("\n", 1)[0].trim().split(/\s+/);
    if (group && verb && section.includes(CONFIRM_TAG)) out.add(`${group} ${verb}`);
  }
  return out;
}

let whopWrites: Set<string> | null = null;

/** Hands `isWrite` whop's list. Called once at startup with the cached manifest; an empty text changes nothing. */
export function loadWhopWrites(llmsFull: string | null | undefined): Set<string> {
  whopWrites = llmsFull ? taggedWrites(llmsFull) : null;
  return whopWrites ?? new Set();
}

/** Whether a verb writes: whop's own tag when the manifest is loaded, the hand lists always, compute-only never. */
export function isWrite(group: string, verb: string | undefined): boolean {
  if (!verb) return false;
  const key = `${group} ${verb}`;
  if (COMPUTE_ONLY.has(key)) return false;
  if (MONEY_GROUPS.has(group) && !MONEY_READ_VERBS.has(verb)) return true;
  if (WRITE_VERBS.has(verb)) return true;
  return whopWrites?.has(key) ?? false;
}

/**
 * Account scoping from whop-desktop src/lib/whop.ts withAccount. Only used to decide whether the
 * teaching footer mentions --account_id.
 */
export function takesAccount(args: string[]): boolean {
  const [g, v] = args;
  if (args.includes("--account_id")) return false;
  if (["auth", "upgrade", "accounts", "partners", "files", "--version"].includes(g)) return false;
  if (g === "apps" && v !== "list") return false;
  // A webhook's own verbs take the hook id; only the list and create take an account.
  if (g === "webhooks" && v !== "list" && v !== "create") return false;
  if (g === "events" && v === "pulse") return false;
  if (
    ["products", "plans", "memberships", "members", "people", "payouts", "bounties", "team-members", "disputes", "events"].includes(g) &&
    ["get", "update", "delete", "publish", "unpublish", "pause", "resume", "cancel", "invite", "submissions", "get-submission"].includes(v)
  )
    return false;
  return true;
}
