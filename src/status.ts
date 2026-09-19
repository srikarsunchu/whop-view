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

/** Write verbs from whop-desktop src/views/Terminal.tsx, plus the CLI's own extra verbs. */
export const WRITE_VERBS = new Set([
  "create", "delete", "update", "cancel", "pause", "unpause", "resume", "transfer", "deploy", "publish", "unpublish",
  "replay", "extend", "invite", "logout", "switch", "mark_read", "form_company", "transfer_ownership", "duplicate",
  "retry_payment", "return_url", "update-preferences", "promote", "init", "pull", "send",
]);

/** Every verb under these groups moves money. */
export const MONEY_GROUPS = new Set(["payouts", "swaps", "transfers", "cards", "deposits"]);

export const DESTRUCTIVE_VERBS = new Set(["delete", "cancel", "transfer_ownership"]);

export function isWrite(group: string, verb: string | undefined): boolean {
  if (!verb) return false;
  if (MONEY_GROUPS.has(group) && verb !== "list" && verb !== "get") return true;
  return WRITE_VERBS.has(verb);
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
  if (g === "events" && v === "pulse") return false;
  if (
    ["products", "plans", "memberships", "members", "people", "payouts", "bounties", "team-members", "disputes", "events"].includes(g) &&
    ["get", "update", "delete", "publish", "unpublish", "pause", "resume", "cancel", "invite", "submissions", "get-submission"].includes(v)
  )
    return false;
  return true;
}
