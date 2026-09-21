import { createInterface } from "node:readline";
import { paint, type Theme } from "../tokens.ts";
import { copy } from "../copy.ts";

/**
 * Prints `question [y/N]`, reads one line from the TTY. Default no.
 * Ctrl-C, Ctrl-D, and a closed stdin all resolve `false`: readline swallows Ctrl-C when the
 * terminal is in raw mode, so without these handlers the prompt would sit forever and, once
 * stdin closed, exit 0 as if the write had gone through.
 */
export function prompt(question: string, theme: Theme, input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input, output });
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      rl.close();
      resolve(ok);
    };
    rl.on("SIGINT", () => {
      output.write("\n");
      finish(false);
    });
    rl.on("close", () => {
      if (!done) output.write("\n");
      finish(false);
    });
    rl.question(" " + paint(theme, "accent", question) + " " + paint(theme, "muted", copy.confirm.yesNo) + " ", (answer) => finish(/^y(es)?$/i.test(answer.trim())));
  });
}
