// Clipboard, best effort. OSC 52 reaches through ssh and tmux; a local tool covers terminals that ignore it.
import { spawn } from "node:child_process";

/** Command and args for the platform's clipboard tool, tried in order. */
function tools(platform = process.platform): [string, string[]][] {
  if (platform === "darwin") return [["pbcopy", []]];
  if (platform === "win32") return [["clip", []]];
  return [
    ["wl-copy", []],
    ["xclip", ["-selection", "clipboard"]],
    ["xsel", ["--clipboard", "--input"]],
  ];
}

function pipeTo(cmd: string, args: string[], text: string): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      resolve(ok);
    };
    try {
      const child = spawn(cmd, args, { stdio: ["pipe", "ignore", "ignore"] });
      child.on("error", () => finish(false));
      child.on("close", (code) => finish(code === 0));
      child.stdin.on("error", () => finish(false));
      child.stdin.end(text);
      setTimeout(() => finish(false), 1000).unref();
    } catch {
      finish(false);
    }
  });
}

/** The OSC 52 sequence that asks the terminal to set its clipboard. */
export const osc52 = (text: string) => `\x1b]52;c;${Buffer.from(text, "utf8").toString("base64")}\x07`;

/**
 * Writes `text` to the clipboard. Always emits OSC 52 on `out`, then tries the local tools.
 * Resolves true when any path may have worked; OSC 52 cannot be observed, so it counts.
 */
export async function copyText(text: string, out: NodeJS.WritableStream = process.stdout): Promise<boolean> {
  let ok = false;
  try {
    out.write(osc52(text));
    ok = true;
  } catch {
    /* not a terminal */
  }
  for (const [cmd, args] of tools()) {
    if (await pipeTo(cmd, args, text)) return true;
  }
  return ok;
}
