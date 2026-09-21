// Commands are argv arrays until the last moment. Quoting happens once, here.

const SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;
/** `<biz_id>` and friends: placeholders the teaching footer shows in place of a value. Never quoted. */
const PLACEHOLDER = /^<[a-z_]+>$/;

/** POSIX single-quoting. Product titles and notes are user text and will land in a command eventually. */
export function shellQuote(arg: string): string {
  if (arg === "") return "''";
  if (SAFE.test(arg) || PLACEHOLDER.test(arg) || arg === "|") return arg;
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

export const shellJoin = (argv: readonly string[]) => argv.map(shellQuote).join(" ");

/** `whop <argv> --format json`, the agent command a view teaches. */
export const teach = (argv: readonly string[], ...extra: string[]): string[] => ["whop", ...argv, "--format", "json", ...extra];
