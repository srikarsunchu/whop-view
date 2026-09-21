// Approval bound to the plan. The gate's `rerun` used to be the same argv plus `--yes`, an honor system: an
// agent could edit the command after the person saw the plan, or reuse an old approval. Now `rerun` carries
// `--approve <token>`, an HMAC over the exact argv and the mode with a short expiry, minted with a secret only
// this machine holds. The write that runs is the one that was planned, unmodified, and not stale. `--yes`
// stays for a person at a keyboard, and for a script that chooses the honor system on purpose.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Mode } from "./copy.ts";

export const DEFAULT_APPROVE_TTL_SECONDS = 600;

/** How long an approval is good for, from `WV_APPROVE_TTL` seconds. */
export function approveTtlFrom(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.WV_APPROVE_TTL);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_APPROVE_TTL_SECONDS;
}

/** The bytes the token signs: every argv element as given, then the mode, then the expiry. */
const message = (argv: string[], mode: Mode, expiresAt: number) => [...argv, mode, String(expiresAt)].join("\0");

const sign = (argv: string[], mode: Mode, expiresAt: number, secret: string) => createHmac("sha256", secret).update(message(argv, mode, expiresAt)).digest("hex").slice(0, 32);

/** `<expires>.<hmac>`: the expiry in seconds since the epoch, then 128 bits of the signature. */
export function mintApproval(argv: string[], mode: Mode, secret: string, expiresAt: number): string {
  return `${expiresAt}.${sign(argv, mode, expiresAt, secret)}`;
}

export type Approval = "ok" | "expired" | "invalid";

/** Whether a token approves exactly this argv in this mode, now. Constant-time on the signature. */
export function checkApproval(token: string, argv: string[], mode: Mode, secret: string, now: number = Math.floor(Date.now() / 1000)): Approval {
  const m = /^(\d+)\.([0-9a-f]{32})$/.exec(token);
  if (!m) return "invalid";
  const expiresAt = Number(m[1]);
  const expected = sign(argv, mode, expiresAt, secret);
  if (!timingSafeEqual(Buffer.from(m[2]), Buffer.from(expected))) return "invalid";
  return now > expiresAt ? "expired" : "ok";
}

/** Pulls `--approve <token>` or `--approve=<token>` out of an argv. The rest is what the token must match. */
export function splitApprove(argv: string[]): { argv: string[]; token?: string } {
  const out: string[] = [];
  let token: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--approve") token = argv[++i] ?? "";
    else if (a.startsWith("--approve=")) token = a.slice(10);
    else out.push(a);
  }
  return { argv: out, token };
}
