import { paint, type Theme } from "../tokens.ts";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** One-line braille spinner. Appears after 300 ms, clears itself on stop. Only when stderr is a TTY. */
export function spinner(label: string, theme: Theme, delay = 300) {
  if (!process.stderr.isTTY) return { stop() {} };
  let i = 0;
  let timer: NodeJS.Timeout | null = null;
  let shown = false;
  const start = setTimeout(() => {
    shown = true;
    timer = setInterval(() => {
      process.stderr.write(`\r ${paint(theme, "accent", FRAMES[i++ % FRAMES.length])} ${paint(theme, "muted", label)}`);
    }, 80);
  }, delay);
  return {
    stop() {
      clearTimeout(start);
      if (timer) clearInterval(timer);
      if (shown) process.stderr.write("\r\x1b[2K");
    },
  };
}
