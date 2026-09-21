import { paint, type Theme } from "../tokens.ts";
import { truncate } from "../ansi.ts";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export interface Spinner {
  /** Swap the label. Takes effect on the next frame, so a spinner that has not shown yet just starts with the new one. */
  update(label: string): void;
  stop(): void;
}

/** One-line braille spinner. Appears after 300 ms, clears itself on stop. Only when stderr is a TTY. */
export function spinner(label: string, theme: Theme, delay = 300): Spinner {
  if (!process.stderr.isTTY) return { update() {}, stop() {} };
  let i = 0;
  let timer: NodeJS.Timeout | null = null;
  let shown = false;
  let text = label;
  const frame = () => process.stderr.write(`\r\x1b[2K ${paint(theme, "accent", FRAMES[i++ % FRAMES.length])} ${paint(theme, "muted", truncate(text, theme.width - 4))}`);
  const start = setTimeout(() => {
    shown = true;
    timer = setInterval(frame, 80);
  }, delay);
  return {
    update(next) {
      text = next;
    },
    stop() {
      clearTimeout(start);
      if (timer) clearInterval(timer);
      if (shown) process.stderr.write("\r\x1b[2K");
    },
  };
}
