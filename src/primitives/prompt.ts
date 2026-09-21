import { createInterface } from "node:readline";
import { paint, type Theme } from "../tokens.ts";
import { copy } from "../copy.ts";

/**
 * Prints `question [y/N]`, reads one line from the TTY. Default no. Optionally expires.
 * Ctrl-C, Ctrl-D, and a closed stdin all resolve `false`: readline swallows Ctrl-C when the
 * terminal is in raw mode, so without these handlers the prompt would sit forever and, once
 * stdin closed, exit 0 as if the write had gone through.
 */
export type Answer = "yes" | "no" | "timeout";

export interface PromptOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  /** Give up and answer `timeout` after this long. A money prompt left on screen is not consent. */
  timeoutMs?: number;
}

export function prompt(question: string, theme: Theme, opts: PromptOptions = {}): Promise<Answer> {
  const input = opts.input ?? process.stdin;
  const output = opts.output ?? process.stdout;
  return new Promise((resolve) => {
    const rl = createInterface({ input, output });
    let done = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (answer: Answer) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      rl.close();
      resolve(answer);
    };
    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timer = setTimeout(() => {
        output.write("\n");
        finish("timeout");
      }, opts.timeoutMs);
      timer.unref();
    }
    rl.on("SIGINT", () => {
      output.write("\n");
      finish("no");
    });
    rl.on("close", () => {
      if (!done) output.write("\n");
      finish("no");
    });
    rl.question(" " + paint(theme, "accent", question) + " " + paint(theme, "muted", copy.confirm.yesNo) + " ", (answer) => finish(/^y(es)?$/i.test(answer.trim()) ? "yes" : "no"));
  });
}
