// The only file that names a color. Everything else speaks in roles.

export type Role = "text" | "muted" | "accent" | "good" | "warn" | "bad" | "mono" | "selected";

const SGR: Record<Role, [string, string]> = {
  text: ["", ""],
  muted: ["\x1b[2m", "\x1b[22m"],
  accent: ["\x1b[1m", "\x1b[22m"],
  good: ["\x1b[32m", "\x1b[39m"],
  warn: ["\x1b[33m", "\x1b[39m"],
  bad: ["\x1b[31m", "\x1b[39m"],
  mono: ["\x1b[2m", "\x1b[22m"],
  /** Inverse video. The picked row in a session list. Inner color escapes survive it. */
  selected: ["\x1b[7m", "\x1b[27m"],
};

export interface Theme {
  color: boolean;
  width: number;
  breakpoint: "narrow" | "normal" | "wide";
}

export const GUTTER = 2;
export const INDENT = "  ";

export function colorEnabled(env: NodeJS.ProcessEnv = process.env, isTTY = !!process.stdout.isTTY): boolean {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  if (env.FORCE_COLOR === "0") return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "") return true;
  return isTTY;
}

export function makeTheme(opts: { width?: number; color?: boolean } = {}): Theme {
  const width = opts.width ?? process.stdout.columns ?? 80;
  const breakpoint = width < 80 ? "narrow" : width < 120 ? "normal" : "wide";
  return { color: opts.color ?? colorEnabled(), width, breakpoint };
}

export function paint(theme: Theme, role: Role, s: string): string {
  if (!theme.color || role === "text" || s === "") return s;
  const [open, close] = SGR[role];
  return open + s + close;
}
