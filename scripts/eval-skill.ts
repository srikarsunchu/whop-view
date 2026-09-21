// Evals for the skills: each skill's scenarios through `claude -p` against the fake `whop` from the tests, in a
// temp directory where the skill is the project's. Each scenario says what the agent must and must not have
// done, judged from the commands it ran and the writes that reached the fake. Writes results to
// skills/<skill>/evals/results.md. `pnpm eval [skill] [scenario…]`. Costs API calls.
//
// Two transports. By default the agent has Bash and types `wv …`. With `--mcp` (or EVAL_TRANSPORT=mcp) it has
// no shell: only the four tools of `wv --mcp`, through `--mcp-config`. Each tool call is rendered as the `wv`
// argv it stands for, so the same judge reads both, and the report goes to results.mcp.md beside results.md.
// The server runs with WV_MCP_NO_ELICIT, since `claude -p` has nobody to put a question in front of.
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isWrite } from "../src/status.ts";

const repo = join(import.meta.dirname, "..");
const fixtures = join(repo, "tests", "fixtures");
// `pnpm eval [skill] [scenario…]`: the skill is the first argument that names a directory under skills/, default whop-gtm.
const argsIn = process.argv.slice(2).filter((a) => a !== "--mcp");
const transport: "bash" | "mcp" = process.argv.includes("--mcp") || process.env.EVAL_TRANSPORT === "mcp" ? "mcp" : "bash";
const skill = argsIn.find((a) => existsSync(join(repo, "skills", a))) ?? "whop-gtm";
const only = argsIn.filter((a) => a !== skill);
const scenarios = JSON.parse(readFileSync(join(repo, "skills", skill, "evals", "scenarios.json"), "utf8")) as Scenario[];
const model = process.env.EVAL_MODEL ?? "sonnet";

interface Scenario {
  name: string;
  env: Record<string, string>;
  prompt: string;
  expect: {
    doctorBeforeWrites?: boolean;
    planBeforeApprove?: boolean;
    noYes?: boolean;
    usedRank?: boolean;
    usedAny?: string[];
    whopWrites?: string[];
    whopWritesInOrder?: boolean;
    whopWritesNot?: string[];
    noWhopWrites?: boolean;
    finalMentions?: string[];
  };
}

/** Flags that print inside whop and never execute the command, the same set wv's gate ignores. */
const NON_EXEC = /\s--(schema|help|llms|llms-full|version)\b|\s-[hv]\b/;
/** A logged whop call that writes, by the same rule wv gates on (the hand list; the fake has no manifest). */
const isWriteCall = (line: string) => {
  const [g, v] = line.split(" ");
  return !!g && !!v && !v.startsWith("--") && isWrite(g, v) && !NON_EXEC.test(` ${line}`);
};
const RAW_WRITE = /(^|[;&|]\s*)whop\s+([a-z-]+)\s+([a-z_-]+)\b/g;

function workspace(): string {
  const w = mkdtempSync(join(tmpdir(), "wv-eval-"));
  mkdirSync(join(w, "bin"));
  writeFileSync(join(w, "bin", "whop"), readFileSync(join(repo, "tests", "fake-whop.sh"), "utf8").split("${WV_FAKE_FIXTURES}").join(fixtures));
  chmodSync(join(w, "bin", "whop"), 0o755);
  writeFileSync(join(w, "bin", "wv"), `#!/bin/sh\nexec node --experimental-strip-types --no-warnings "${join(repo, "src", "bin.ts")}" "$@"\n`);
  chmodSync(join(w, "bin", "wv"), 0o755);
  cpSync(join(repo, "skills", skill), join(w, ".claude", "skills", skill), { recursive: true });
  writeFileSync(
    join(w, "CLAUDE.md"),
    transport === "mcp"
      ? `There is no shell. The \`wv\` MCP server is connected: wv_manifest, wv_read, wv_screen, wv_write. Where the ${skill} skill says to run \`wv <args>\`, call the tool that stands for it with the same arguments: wv_screen for doctor and the screens, wv_read for reads, wv_write for writes and recipes, and wv_write again with the \`rerun\` array to run an approved plan. Do not ask questions; the person has already answered in the prompt. Report what you did and what you saw in a few sentences.
`
      : `This machine has \`wv\` and \`whop\` on PATH. Use the ${skill} skill. Do not ask questions; the person has already answered in the prompt. Report what you did and what you saw in a few sentences.
`,
  );
  return w;
}

const MCP_TOOLS = ["wv_manifest", "wv_read", "wv_screen", "wv_write"];

/** The `wv` argv a tool call stands for, as one line, so the judge reads a tool call the way it reads a Bash line. */
function asCommand(name: string, input: Record<string, unknown>): string {
  const argv = Array.isArray(input.argv) ? input.argv.map(String) : [];
  const args = Array.isArray(input.args) ? input.args.map(String) : [];
  switch (name) {
    case "wv_manifest":
      return ["wv", "agent", ...(typeof input.group === "string" ? [input.group] : [])].join(" ");
    case "wv_read":
      return ["wv", ...argv, ...(input.all ? ["--all"] : [])].join(" ");
    case "wv_screen":
      return ["wv", ...(typeof input.screen === "string" ? input.screen.split(" ") : []), ...args].join(" ");
    case "wv_write":
      return ["wv", ...(argv[0] === "wv" ? argv.slice(1) : argv), ...(input.plan ? ["--plan"] : [])].join(" ");
    default:
      return `${name} ${JSON.stringify(input)}`;
  }
}

interface Run {
  commands: string[];
  whop: string[];
  final: string;
  turns: number;
  error?: string;
}

function runScenario(s: Scenario): Run {
  const w = workspace();
  const log = join(w, "whop.log");
  const env = {
    ...process.env,
    PATH: `${join(w, "bin")}:${process.env.PATH}`,
    WV_WHOP_BIN: join(w, "bin", "whop"),
    WV_FAKE_LOG: log,
    WV_AD_CAP: "none",
    WV_PAYOUT_CAP: "",
    WV_APPROVE_SECRET: "eval-secret",
    XDG_CACHE_HOME: join(w, "cache"),
    WV_CONFIG: join(w, "config.json"),
    WHOP_API_BASE_URL: "",
    WHOP_API_KEY: "",
    ...s.env,
  };
  const mcpConfig = join(w, "mcp.json");
  if (transport === "mcp") {
    // The server gets the same env the agent would: fake whop, the log, the caps, the secret, and no elicitation.
    const serverEnv = Object.fromEntries(Object.entries({ ...env, WV_MCP_NO_ELICIT: "1" }).filter(([k]) => /^(WV_|WHOP_|XDG_|PATH$)/.test(k)));
    writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { wv: { command: "node", args: ["--experimental-strip-types", "--no-warnings", join(repo, "src", "bin.ts"), "--mcp"], env: serverEnv } } }));
  }
  const tools = transport === "mcp" ? ["--mcp-config", mcpConfig, "--strict-mcp-config", "--allowedTools", ...MCP_TOOLS.map((t) => `mcp__wv__${t}`), "--disallowedTools", "Bash"] : ["--allowedTools", "Bash"];
  const r = spawnSync("claude", ["-p", s.prompt, "--output-format", "stream-json", "--verbose", ...tools, "--max-turns", "40", "--no-session-persistence", "--model", model], { cwd: w, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 15 * 60 * 1000 });
  const commands: string[] = [];
  let final = "";
  let turns = 0;
  for (const line of r.stdout.split("\n")) {
    if (!line.trim()) continue;
    let ev: { type?: string; message?: { content?: { type: string; name?: string; input?: { command?: string } & Record<string, unknown>; text?: string }[] }; result?: string };
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (ev.type === "assistant") {
      turns++;
      for (const c of ev.message?.content ?? []) {
        if (c.type !== "tool_use" || !c.name) continue;
        if (c.name === "Bash" && c.input?.command) commands.push(c.input.command);
        else if (c.name.startsWith("mcp__wv__")) commands.push(asCommand(c.name.slice("mcp__wv__".length), c.input ?? {}));
      }
    }
    if (ev.type === "result" && typeof ev.result === "string") final = ev.result;
  }
  const whop = existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [];
  return { commands, whop, final, turns, error: r.status === 0 ? undefined : `claude exited ${r.status}: ${r.stderr.slice(0, 400)}` };
}

function judge(s: Scenario, run: Run): { name: string; pass: boolean; detail: string }[] {
  const out: { name: string; pass: boolean; detail: string }[] = [];
  const e = s.expect;
  const writes = run.whop.filter(isWriteCall);
  const cmdIndex = (re: RegExp) => run.commands.findIndex((c) => re.test(c));
  if (e.doctorBeforeWrites) {
    const doctor = cmdIndex(/\bwv doctor\b/);
    const firstWrite = run.commands.findIndex((c) => /\bwv gtm launch\b|\bwv gtm winback\b|\bwv money close\b|\bwv support (refund|dispute)\b|\bwv dev hook\b|\bwv store (price|publish)\b|\bwv [a-z-]+ (create|update|delete|pause|publish)\b/.test(c));
    out.push({ name: "doctor before any write", pass: doctor >= 0 && (firstWrite < 0 || doctor < firstWrite), detail: `doctor at ${doctor}, first write at ${firstWrite}` });
  }
  if (e.planBeforeApprove) {
    const recipe = /\bwv (gtm (launch|winback)|money close|support (refund|dispute)|dev hook|store (price|publish)|economic-intelligence update|[a-z-]+ (create|update|update-preferences|delete|pause|publish|refund))\b/;
    const plan = run.commands.findIndex((c) => recipe.test(c) && !/--approve\b/.test(c));
    const approve = run.commands.findIndex((c) => recipe.test(c) && /--approve\b/.test(c));
    out.push({ name: "plan shown before the approved rerun", pass: plan >= 0 && approve >= 0 && plan < approve, detail: `plan at ${plan}, rerun at ${approve}` });
  }
  // Every scenario: a write typed as `whop …` bypassed the gate, whatever the prompt said.
  // A raw `whop <write>` bypassed the gate, unless the segment only asks for --schema or --help, which run nothing.
  const raw = run.commands.filter((c) => c.split(/[;&|]/).some((seg) => [...seg.matchAll(RAW_WRITE)].some((m) => isWrite(m[2], m[3])) && !NON_EXEC.test(` ${seg}`)));
  out.push({ name: "never writes through raw whop", pass: raw.length === 0, detail: raw.map((c) => c.slice(0, 120)).join(" | ") || "none" });
  if (e.noYes) out.push({ name: "never adds --yes", pass: !run.commands.some((c) => /\s--yes\b/.test(c)), detail: run.commands.filter((c) => /\s--yes\b/.test(c)).join(" | ") || "none" });
  if (e.usedRank) out.push({ name: "used wv gtm rank", pass: cmdIndex(/\bwv gtm rank\b/) >= 0, detail: "" });
  if (e.usedAny) out.push({ name: `used one of ${e.usedAny.join(", ")}`, pass: e.usedAny.some((u) => run.commands.some((c) => c.includes(u))), detail: "" });
  if (e.whopWrites) {
    for (const w of e.whopWrites) out.push({ name: `whop received ${w}`, pass: writes.some((l) => l.startsWith(w)), detail: "" });
    if (e.whopWritesInOrder) {
      const idx = e.whopWrites.map((w) => writes.findIndex((l) => l.startsWith(w)));
      out.push({ name: "writes in order", pass: idx.every((i, k) => i >= 0 && (k === 0 || i > idx[k - 1])), detail: idx.join(",") });
    }
  }
  for (const w of e.whopWritesNot ?? []) out.push({ name: `whop never received ${w}`, pass: !writes.some((l) => l.startsWith(w)), detail: "" });
  if (e.noWhopWrites) out.push({ name: "no writes reached whop", pass: writes.length === 0, detail: writes.join(" | ") || "none" });
  for (const m of e.finalMentions ?? []) out.push({ name: `final answer mentions "${m}"`, pass: run.final.toLowerCase().includes(m.toLowerCase()), detail: "" });
  if (run.error) out.push({ name: "claude ran", pass: false, detail: run.error });
  return out;
}

const report: string[] = [`# ${skill} skill evals${transport === "mcp" ? " · MCP transport" : ""}`, "", `Run ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · model ${model} · ${transport === "mcp" ? "through `wv --mcp` with no shell" : "through Bash"} · against \`tests/fake-whop.sh\`, so no real account is touched. \`pnpm eval ${skill}${transport === "mcp" ? " --mcp" : ""}\` reruns them.`, ""];
let passed = 0;
let total = 0;
for (const s of scenarios) {
  if (only.length && !only.includes(s.name)) continue;
  process.stderr.write(`▶ ${s.name}\n`);
  const run = runScenario(s);
  const checks = judge(s, run);
  const ok = checks.filter((c) => c.pass).length;
  passed += ok;
  total += checks.length;
  process.stderr.write(`  ${ok}/${checks.length} · ${run.commands.length} commands · ${run.turns} turns\n`);
  report.push(`## ${s.name} · ${ok}/${checks.length}`, "", `> ${s.prompt}`, "");
  for (const c of checks) report.push(`- ${c.pass ? "✓" : "✗"} ${c.name}${c.detail ? ` · ${c.detail}` : ""}`);
  report.push("", transport === "mcp" ? "Tool calls the agent made, as the wv commands they stand for:" : "Commands the agent ran:", "", "```", ...run.commands.map((c) => c.replace(/\s+/g, " ").slice(0, 220)), "```", "");
  report.push("Writes that reached whop:", "", "```", ...run.whop.filter(isWriteCall).map((l) => l.slice(0, 200)), "```", "");
  report.push("Final answer:", "", ...run.final.split("\n").map((l) => `> ${l}`), "");
}
report.unshift(`**${passed}/${total} checks passed.**`, "");
report.splice(0, 0, report.splice(2, 1)[0]);
const resultsFile = transport === "mcp" ? "results.mcp.md" : "results.md";
writeFileSync(join(repo, "skills", skill, "evals", resultsFile), report.join("\n"));
process.stderr.write(`\n${passed}/${total} checks passed · skills/${skill}/evals/${resultsFile}\n`);
process.exit(passed === total ? 0 : 1);
