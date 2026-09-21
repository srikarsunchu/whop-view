// wv's own config file. Today it holds one thing: the sandbox key, so it lives in a 0600 file under
// XDG_CONFIG_HOME instead of a shell variable a person has to know about. Never whop's own config.
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface Config {
  sandbox?: {
    key?: string;
    url?: string;
  };
  /** The secret that signs approvals. Generated on first use, never shown. */
  approve?: {
    secret?: string;
  };
}

/** `WV_CONFIG` overrides the path, for tests and for people who keep config elsewhere. */
export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.WV_CONFIG) return env.WV_CONFIG;
  return join(env.XDG_CONFIG_HOME || join(env.HOME || homedir(), ".config"), "whop-view", "config.json");
}

/** Missing or unreadable is an empty config, never an error: a broken file must not block production commands. */
export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const file = configPath(env);
  if (!existsSync(file)) return {};
  try {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    return raw && typeof raw === "object" ? (raw as Config) : {};
  } catch {
    return {};
  }
}

/** Writes the whole config, owner-only, creating the directory. Returns the path written. */
export function writeConfig(config: Config, env: NodeJS.ProcessEnv = process.env): string {
  const file = configPath(env);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  chmodSync(file, 0o600);
  return file;
}

/** Saves a sandbox key, keeping everything else in the file. */
export function saveSandboxKey(key: string, env: NodeJS.ProcessEnv = process.env): string {
  const current = readConfig(env);
  return writeConfig({ ...current, sandbox: { ...current.sandbox, key } }, env);
}

/** `whop_abc…wxyz`: enough to tell two keys apart, never enough to use. */
export function maskKey(key: string): string {
  if (key.length <= 12) return key.slice(0, 4) + "…";
  return `${key.slice(0, 8)}…${key.slice(-4)}`;
}

/**
 * The approval secret: `WV_APPROVE_SECRET`, else the config file's, else a fresh one saved there. When the file
 * cannot be written the secret lives for this process only, so a token minted here will not verify later; the
 * gate still works, the approval just has to be re-planned.
 */
export function approveSecret(env: NodeJS.ProcessEnv = process.env): string {
  if (env.WV_APPROVE_SECRET) return env.WV_APPROVE_SECRET;
  const current = readConfig(env);
  if (current.approve?.secret) return current.approve.secret;
  const secret = randomBytes(32).toString("hex");
  // A file that exists but does not parse is somebody's config with a typo; it is never overwritten.
  const file = configPath(env);
  if (existsSync(file) && Object.keys(current).length === 0 && readFileSync(file, "utf8").trim() !== "" && readFileSync(file, "utf8").trim() !== "{}") return secret;
  try {
    writeConfig({ ...current, approve: { ...current.approve, secret } }, env);
  } catch {
    /* process-local secret */
  }
  return secret;
}
