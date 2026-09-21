// Spawns the real `whop`. Decides passthrough. Caches --schema.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseEnvelope, type Parsed } from "./envelope.ts";
import { readConfig, type Config } from "./config.ts";

export const WHOP = process.env.WV_WHOP_BIN ?? "whop";

export type Mode = "production" | "sandbox";

// The CLI joins paths onto the base as given, so the version prefix has to be here. Without it every call is a bare 404.
export const SANDBOX_URL = "https://sandbox-api.whop.com/api/v1";
const SANDBOX_HOST = /sandbox-api\.whop\.com/;

/**
 * `--sandbox`, `WV_SANDBOX=1`, or a shell whose `WHOP_API_BASE_URL` already points at the sandbox host.
 * The last one matters for honesty: the banner must never say production while the calls go elsewhere.
 */
export function modeFrom(sandboxFlag: boolean, env: NodeJS.ProcessEnv = process.env): Mode {
  if (sandboxFlag) return "sandbox";
  if (env.WV_SANDBOX !== undefined && env.WV_SANDBOX !== "" && env.WV_SANDBOX !== "0") return "sandbox";
  if (env.WHOP_API_BASE_URL && SANDBOX_HOST.test(env.WHOP_API_BASE_URL)) return "sandbox";
  return "production";
}

export type Source = "env" | "config" | "default" | "none";

/** The sandbox key wv knows about: `WV_SANDBOX_KEY` first, then the config file. */
export function sandboxKey(env: NodeJS.ProcessEnv = process.env, config: Config = readConfig(env)): { key?: string; source: Source } {
  if (env.WV_SANDBOX_KEY) return { key: env.WV_SANDBOX_KEY, source: "env" };
  if (config.sandbox?.key) return { key: config.sandbox.key, source: "config" };
  return { source: "none" };
}

/** The sandbox host: `WV_SANDBOX_URL`, then the config file, then Whop's published sandbox server. */
export function sandboxUrl(env: NodeJS.ProcessEnv = process.env, config: Config = readConfig(env)): { url: string; source: Source } {
  if (env.WV_SANDBOX_URL) return { url: env.WV_SANDBOX_URL, source: "env" };
  if (config.sandbox?.url) return { url: config.sandbox.url, source: "config" };
  return { url: SANDBOX_URL, source: "default" };
}

/**
 * Environment for the child `whop`. Two rules, both tested: a sandbox key never reaches production, and
 * a production key never reaches the sandbox. Production mode passes the shell through untouched; the
 * config file's sandbox key is never injected there. Sandbox mode forces the host, hands over the sandbox
 * key when wv has one, and otherwise removes `WHOP_API_KEY` so whatever the shell exported stays home.
 * The sandbox host rejects the OAuth token that remains with 401, and the error names the fix.
 */
export function whopEnv(mode: Mode, env: NodeJS.ProcessEnv = process.env, config: Config = readConfig(env)): NodeJS.ProcessEnv {
  if (mode !== "sandbox") return env;
  const out: NodeJS.ProcessEnv = { ...env, WHOP_API_BASE_URL: sandboxUrl(env, config).url };
  const { key } = sandboxKey(env, config);
  if (key) out.WHOP_API_KEY = key;
  else delete out.WHOP_API_KEY;
  return out;
}

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
export function passthrough(argv: string[], env: NodeJS.ProcessEnv = process.env): never {
  const r = spawnSync(WHOP, argv, { stdio: "inherit", env });
  if (r.error) {
    process.stderr.write(`wv: could not run ${WHOP}: ${r.error.message}\n`);
    process.exit(127);
  }
  process.exit(r.status ?? 1);
}

/** How much of the child's stdout to keep for the exit code. Error envelopes are small; a page is not needed. */
const TAIL_BYTES = 64 * 1024;

/**
 * Exec whop for a pipe: stdout is forwarded byte for byte as it arrives, and the exit code is `decide(status, tail)`
 * over whop's status and the last `TAIL_BYTES` of what it printed. stdin and stderr are inherited. Never returns.
 */
export function passthroughPiped(argv: string[], env: NodeJS.ProcessEnv, decide: (status: number, tail: string) => number): Promise<never> {
  return new Promise(() => {
    const child = spawn(WHOP, argv, { stdio: ["inherit", "pipe", "inherit"], env });
    let tail = "";
    child.stdout.on("data", (d: Buffer) => {
      process.stdout.write(d);
      tail = (tail + d.toString("utf8")).slice(-TAIL_BYTES);
    });
    child.on("error", (e: NodeJS.ErrnoException) => {
      process.stderr.write(`wv: could not run ${WHOP}: ${e.message}\n`);
      process.exit(127);
    });
    child.on("close", (status) => process.exit(decide(status ?? 1, tail)));
  });
}

export interface RunResult {
  parsed: Parsed;
  code: number;
  stderr: string;
}

/** Runs `whop <argv> --format json --full-output` and parses stdout. stderr is forwarded. */
export function run(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(WHOP, [...argv, "--format", "json", "--full-output"], { stdio: ["inherit", "pipe", "pipe"], env });
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

/**
 * `whop --llms-full`, 338 KB, with the same one-day cache as help. It is whop's own list of which commands
 * write, read by `status.ts`. Best effort: without it the hand list still gates.
 */
export function cachedLlmsFull(): string {
  const file = join(cacheDir, "llms-full.md");
  try {
    if (existsSync(file) && Date.now() - statSync(file).mtimeMs < HELP_TTL_MS) return readFileSync(file, "utf8");
  } catch {
    /* refetch */
  }
  const r = spawnSync(WHOP, ["--llms-full"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const text = r.status === 0 && r.stdout.startsWith("# whop") ? r.stdout : "";
  if (text) {
    try {
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(file, text);
    } catch {
      /* cache is best effort */
    }
  }
  return text;
}
