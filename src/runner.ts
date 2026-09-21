// Spawns the real `whop`. Decides passthrough. Caches --schema.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseEnvelope, type Parsed } from "./envelope.ts";

export const WHOP = process.env.WV_WHOP_BIN ?? "whop";

const PASSTHROUGH_FLAGS = ["--format", "--full-output", "--filter-output", "--llms", "--llms-full", "--schema", "--help", "-h", "--version", "-v"];
const OWN_TERMINAL = new Set(["login", "logout", "quickstart", "upgrade"]);
const OWN_TERMINAL_APPS = new Set(["dev", "deploy", "init", "pull"]);

export function shouldPassthrough(argv: string[], env: NodeJS.ProcessEnv = process.env, isTTY = !!process.stdout.isTTY): boolean {
  if (!isTTY) return true;
  if (env.WV_RAW) return true;
  if (argv.some((a) => PASSTHROUGH_FLAGS.includes(a) || a.startsWith("--format=") || a.startsWith("--token-"))) return true;
  if (OWN_TERMINAL.has(argv[0])) return true;
  if (argv[0] === "apps" && OWN_TERMINAL_APPS.has(argv[1])) return true;
  return false;
}

/** Exec whop with the original argv, inheriting stdio. Never returns. */
export function passthrough(argv: string[]): never {
  const r = spawnSync(WHOP, argv, { stdio: "inherit" });
  if (r.error) {
    process.stderr.write(`wv: could not run ${WHOP}: ${r.error.message}\n`);
    process.exit(127);
  }
  process.exit(r.status ?? 1);
}

export interface RunResult {
  parsed: Parsed;
  code: number;
  stderr: string;
}

/** Runs `whop <argv> --format json --full-output` and parses stdout. stderr is forwarded. */
export function run(argv: string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(WHOP, [...argv, "--format", "json", "--full-output"], { stdio: ["inherit", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => {
      err += d;
      process.stderr.write(d);
    });
    child.on("error", (e: NodeJS.ErrnoException) => {
      resolve({ parsed: { ok: false, error: { code: e.code === "ENOENT" ? "ENOENT" : "UNKNOWN", message: e.message } }, code: 127, stderr: err });
    });
    child.on("close", (code) => resolve({ parsed: parseEnvelope(out), code: code ?? 1, stderr: err }));
  });
}

const cacheDir = join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "whop-view");

/** Fetches `whop <group> <verb> --schema` once and caches it. Returns null when unavailable. */
export function schema(group: string, verb: string): unknown | null {
  const file = join(cacheDir, `${group}.${verb}.json`);
  if (existsSync(file)) {
    try {
      return JSON.parse(readFileSync(file, "utf8"));
    } catch {
      /* refetch */
    }
  }
  const r = spawnSync(WHOP, [group, verb, "--schema", "--format", "json"], { encoding: "utf8" });
  if (r.status !== 0 || !r.stdout.trim().startsWith("{")) return null;
  try {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(file, r.stdout);
  } catch {
    /* cache is best effort */
  }
  try {
    return JSON.parse(r.stdout);
  } catch {
    return null;
  }
}

/** Plain-text help, used by the help view. */
export function helpText(argv: string[]): string {
  const r = spawnSync(WHOP, [...argv, "--help"], { encoding: "utf8" });
  return r.stdout || r.stderr || "";
}

const HELP_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * `helpText` with a one-day disk cache. Each `whop --help` costs a quarter second, and the session
 * asks for dozens while completing. Best effort: any cache failure falls back to a live call.
 */
export function cachedHelpText(argv: string[]): string {
  const file = join(cacheDir, "help", (argv.join(".") || "root") + ".txt");
  try {
    if (existsSync(file) && Date.now() - statSync(file).mtimeMs < HELP_TTL_MS) return readFileSync(file, "utf8");
  } catch {
    /* refetch */
  }
  const text = helpText(argv);
  if (text) {
    try {
      mkdirSync(join(cacheDir, "help"), { recursive: true });
      writeFileSync(file, text);
    } catch {
      /* cache is best effort */
    }
  }
  return text;
}
