// Every string a person reads.

export const copy = {
  list: {
    of: (n: number, total: number | null) => (total == null || total === n ? `${n} ${n === 1 ? "row" : "rows"}` : `${n} of ${total}`),
    noMore: "no more pages",
    next: (cursor: string) => `next: --after ${cursor}`,
    empty: (group: string) => `No ${group.replace(/-/g, " ")} yet.`,
    emptyHint: (group: string) => `whop ${group} create --help`,
    json: "json",
  },
  detail: {
    sections: {
      identity: "Identity",
      status: "Status",
      money: "Money",
      dates: "Dates",
      relations: "Relations",
      other: "Details",
    },
    yes: "yes",
    no: "no",
    empty: "—",
  },
  confirm: {
    title: (group: string, verb: string) => `${VERB_TITLES[verb] ?? titleVerb(verb)} ${GROUP_NOUNS[group] ?? group.replace(/-/g, " ")}`,
    badge: "writes to production",
    warning: "This runs against production. The Whop CLI has no dry-run.",
    money: "This moves real money.",
    question: "Run it?",
    yesNo: "[y/N]",
    aborted: "Not run.",
  },
  error: {
    titles: {
      COMMAND_NOT_FOUND: "Not a command",
      HTTP_400: "Whop refused the request",
      HTTP_404: "Not found",
      HTTP_422: "Whop refused the request",
      UNAVAILABLE: "Not available on this business yet",
      HTTP_401: "Not signed in",
      HTTP_403: "Missing permission",
      HTTP_429: "Rate limited",
      VALIDATION_ERROR: "Missing or invalid flags",
      UNKNOWN: "Whop returned an error",
      NOT_JSON: "Not a JSON response",
      ENOENT: "Whop CLI not found",
      NO_TTY: "Needs a terminal",
    } as Record<string, string>,
    fixes: {
      HTTP_401: "whop login",
      HTTP_403: "whop login --api-key",
      ENOENT: "curl -fsSL https://whop.com/install.sh | sh",
    } as Record<string, string>,
    fix: "fix",
    field: (path: string, msg: string) => `--${path}  ${msg}`,
    suggested: "Suggested commands:",
  },
  help: {
    hint: "type wv <group> --help",
    groupHint: (group: string) => `type wv ${group} <command> --help`,
    api: "API",
  },
  home: {
    balance: "Balance",
    revenue: (days: number) => `Net revenue · ${days}d`,
    range: (from: string, to: string) => `${from} to ${to}`,
    notSignedIn: "Not signed in. Run whop login.",
  },
  spinner: "Running whop…",
};

const VERB_TITLES: Record<string, string> = {
  create: "Create",
  update: "Update",
  delete: "Delete",
  cancel: "Cancel",
  pause: "Pause",
  resume: "Resume",
  publish: "Publish",
  unpublish: "Unpublish",
  deploy: "Deploy",
  transfer: "Transfer",
  duplicate: "Duplicate",
  invite: "Invite to",
  extend: "Extend",
  replay: "Replay",
  retry_payment: "Retry payment for",
  transfer_ownership: "Transfer ownership of",
  form_company: "Form company for",
};

const GROUP_NOUNS: Record<string, string> = {
  payouts: "a payout",
  products: "a product",
  plans: "a plan",
  memberships: "a membership",
  "ad-campaigns": "an ad campaign",
  "ad-groups": "an ad group",
  ads: "an ad",
  apps: "an app",
  transfers: "a transfer",
  swaps: "a swap",
  cards: "a card",
  deposits: "a deposit",
  bounties: "a bounty",
  webhooks: "a webhook",
  "promo-codes": "a promo code",
  "api-keys": "an API key",
};

function titleVerb(v: string) {
  return v.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
