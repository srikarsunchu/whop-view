import { createInterface } from "node:readline";
import { paint, type Theme } from "../tokens.ts";
import { copy } from "../copy.ts";

/** Prints `question [y/N]`, reads one line from the TTY. Default no. */
export function prompt(question: string, theme: Theme): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(" " + paint(theme, "accent", question) + " " + paint(theme, "muted", copy.confirm.yesNo) + " ", (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}
